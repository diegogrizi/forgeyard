import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";

export interface ContentAuditInput {
  root: string;
  paths: readonly string[];
  denyTerms?: readonly string[];
  importedPaths?: readonly string[];
}

export interface ContentFinding {
  ruleId: "content.deny-term" | "content.unresolved-template" | "content.unsafe-link" | "content.remote-asset";
  path: string;
}

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll(/\s+/g, " ").trim();
}

function excluded(relativePath: string): boolean {
  const segments = relativePath.split("/").map((segment) => segment.toLocaleLowerCase("en-US"));
  if (segments.some((segment) => segment === ".git" || segment === "node_modules" || segment === "coverage")) return true;
  const joined = segments.join("/");
  return joined.includes(".forgeyard/state/backups") || joined.includes(".forgeyard/state/staging");
}

function portableRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).replaceAll("\\", "/") || ".";
}

async function collectFiles(root: string, requested: string): Promise<{ files: string[]; findings: ContentFinding[] }> {
  const absolute = resolveInsideRoot(root, normalizePortablePath(requested));
  const pending = [absolute];
  const files: string[] = [];
  const findings: ContentFinding[] = [];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const relative = portableRelative(root, current);
    if (excluded(relative)) continue;
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      findings.push({ ruleId: "content.unsafe-link", path: relative });
      continue;
    }
    if (stats.isDirectory()) {
      const children = (await readdir(current)).sort((left, right) => right.localeCompare(left, "en"));
      for (const child of children) pending.push(path.join(current, child));
      continue;
    }
    if (stats.isFile() && TEXT_EXTENSIONS.has(path.extname(current).toLocaleLowerCase("en-US"))) files.push(current);
  }

  return { files, findings };
}

export async function scanGeneratedContent(input: ContentAuditInput): Promise<readonly ContentFinding[]> {
  const root = path.resolve(input.root);
  const denyTerms = (input.denyTerms ?? []).map(normalizedText).filter((term) => term.length > 0);
  const importedPaths = new Set(
    (input.importedPaths ?? []).map((candidate) => normalizePortablePath(candidate).toLocaleLowerCase("en-US")),
  );
  const files = new Set<string>();
  const findings: ContentFinding[] = [];

  for (const requested of input.paths) {
    const collected = await collectFiles(root, requested);
    for (const file of collected.files) files.add(file);
    findings.push(...collected.findings);
  }

  for (const filePath of files) {
    const bytes = await readFile(filePath);
    if (bytes.includes(0)) continue;
    const source = bytes.toString("utf8");
    const relative = portableRelative(root, filePath);
    const imported = importedPaths.has(normalizePortablePath(relative).toLocaleLowerCase("en-US"));
    const normalized = normalizedText(source);
    if (denyTerms.some((term) => normalized.includes(term))) {
      findings.push({ ruleId: "content.deny-term", path: relative });
    }
    if (!imported && /\{\{[^}]*\}\}/.test(source)) {
      findings.push({ ruleId: "content.unresolved-template", path: relative });
    }
    if (!imported && /\.(?:html|css|js|mjs|cjs)$/i.test(relative) && /(?:https?:)?\/\//i.test(source)) {
      findings.push({ ruleId: "content.remote-asset", path: relative });
    }
  }

  return [...new Map(findings.map((finding) => [`${finding.path}\0${finding.ruleId}`, finding])).values()].sort(
    (left, right) => left.path.localeCompare(right.path, "en") || left.ruleId.localeCompare(right.ruleId, "en"),
  );
}
