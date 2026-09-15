import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

type RuleId =
  | "release.private-deny-term"
  | "release.unfinished-prose"
  | "release.unresolved-template"
  | "release.committed-output"
  | "release.presentation-remote"
  | "release.presentation-identity";

interface AuditOptions {
  root: string;
  denyTerm?: string;
}

const EXCLUDED_DIRECTORIES = new Set([".git", ".worktrees", "coverage", "dist", "node_modules"]);
const BINARY_EXTENSIONS = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".pdf",
  ".png",
  ".webp",
  ".zip",
]);

function portableRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function redact(value: string, privateValue: string | undefined): string {
  if (privateValue === undefined || privateValue.length === 0) return value;
  const escaped = privateValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "giu"), "[redacted]");
}

async function repositoryFiles(root: string): Promise<string[]> {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) continue;
    if (stats.isFile()) {
      if (!BINARY_EXTENSIONS.has(path.extname(current).toLocaleLowerCase("en-US"))) files.push(current);
      continue;
    }
    if (!stats.isDirectory()) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name, "en"))) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name.toLocaleLowerCase("en-US"))) continue;
      pending.push(path.join(current, entry.name));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function intentionalTokenContext(relativePath: string): boolean {
  return relativePath.endsWith(".tpl")
    || relativePath.startsWith("tests/")
    || relativePath.startsWith("fixtures/")
    || relativePath.startsWith("docs/superpowers/");
}

function intentionalRuleFixture(relativePath: string): boolean {
  return relativePath === "scripts/release-audit.ts"
    || relativePath.startsWith("tests/")
    || relativePath.startsWith("docs/superpowers/");
}

function recordedOutput(relativePath: string): boolean {
  return /(?:^|\/)\.forgeyard\/(?:evidence|state)(?:\/|$)/i.test(relativePath)
    || /(?:^|\/)EVIDENCE_LOG\.md$/i.test(relativePath)
    || /\.log$/i.test(relativePath)
    || /(?:^|\/)(?:command-output|stdout|stderr)\.(?:txt|json)$/i.test(relativePath);
}

function presentationSource(relativePath: string): boolean {
  return relativePath.startsWith("packs/presentation/")
    && /\.(?:css|html|js)(?:\.tpl)?$/i.test(relativePath);
}

function addFinding(findings: Map<RuleId, Set<string>>, rule: RuleId, relativePath: string): void {
  const paths = findings.get(rule) ?? new Set<string>();
  paths.add(relativePath);
  findings.set(rule, paths);
}

async function runAudit(options: AuditOptions): Promise<Map<RuleId, Set<string>>> {
  const root = path.resolve(options.root);
  const findings = new Map<RuleId, Set<string>>();
  const privateNeedle = options.denyTerm === undefined ? undefined : normalized(options.denyTerm);

  for (const filePath of await repositoryFiles(root)) {
    const relativePath = portableRelative(root, filePath);
    if (recordedOutput(relativePath)) addFinding(findings, "release.committed-output", relativePath);
    const bytes = await readFile(filePath);
    if (bytes.includes(0)) continue;
    const source = bytes.toString("utf8");

    if (privateNeedle !== undefined && normalized(source).includes(privateNeedle)) {
      addFinding(findings, "release.private-deny-term", relativePath);
    }
    if (!intentionalRuleFixture(relativePath)
      && /\b(?:TODO|FIXME|TKTK)\b\s*(?::|\(|$)|\blorem ipsum\b|<insert\b[^>]*>/im.test(source)) {
      addFinding(findings, "release.unfinished-prose", relativePath);
    }
    if (!intentionalTokenContext(relativePath) && /\{\{[^}\r\n]+\}\}/.test(source)) {
      addFinding(findings, "release.unresolved-template", relativePath);
    }
    if (presentationSource(relativePath)) {
      if (/(?:https?:|wss?:)?\/\//i.test(source)) addFinding(findings, "release.presentation-remote", relativePath);
      if (
        /<meta\b[^>]*\bname\s*=\s*["'](?:author|organization|organizer|event|team)(?:[-_ ]?(?:id|name))?["']/i.test(source)
        || /^[ \t]*(?:author|organization|organizer|event|team)(?:Id|Name)?[ \t]*:/im.test(source)
        || /["'](?:author|organization|organizer|event|team)(?:Id|Name)?["']\s*:/i.test(source)
      ) addFinding(findings, "release.presentation-identity", relativePath);
    }
  }
  return findings;
}

function parseArguments(args: readonly string[]): { root: string; denyTermEnvironment?: string } | undefined {
  let root = ".";
  let denyTermEnvironment: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const value = args[index + 1];
    if (current === "--root" && value !== undefined) {
      root = value;
      index += 1;
    } else if (current === "--deny-term-env" && value !== undefined && /^[A-Z_][A-Z0-9_]*$/.test(value)) {
      denyTermEnvironment = value;
      index += 1;
    } else {
      return undefined;
    }
  }
  return { root, ...(denyTermEnvironment === undefined ? {} : { denyTermEnvironment }) };
}

async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === undefined) {
    process.stderr.write("release.invalid-arguments\n");
    return 2;
  }
  const denyTerm = parsed.denyTermEnvironment === undefined
    ? undefined
    : process.env[parsed.denyTermEnvironment];
  if (parsed.denyTermEnvironment !== undefined && (denyTerm === undefined || denyTerm.trim().length === 0)) {
    process.stderr.write("release.deny-term-unavailable\n");
    return 2;
  }

  const findings = await runAudit({
    root: parsed.root,
    ...(denyTerm === undefined ? {} : { denyTerm }),
  });
  if (findings.size === 0) {
    process.stdout.write(redact("Release audit passed.\n", denyTerm));
    return 0;
  }
  const lines = ["Release audit failed."];
  for (const [rule, paths] of [...findings].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    lines.push(rule, ...[...paths].sort((left, right) => left.localeCompare(right, "en")).map((filePath) => `  ${filePath}`));
  }
  process.stderr.write(redact(`${lines.join("\n")}\n`, denyTerm));
  return 1;
}

process.exitCode = await main().catch(() => 2);
