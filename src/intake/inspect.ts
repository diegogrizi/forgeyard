import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { NonEmptyArgv, ProjectKind, QualityCommand } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import type { InspectProjectInput, ProjectInspection } from "./contracts.js";

const MAX_TEXT_BYTES = 256 * 1024;
const PRIMARY_MUTABLE_ROOTS = ["api", "app", "apps", "backend", "client", "frontend", "lib", "packages", "server", "src"];
const HOST_INSTRUCTIONS = new Map([
  ["AGENTS.md", "host-instructions:codex"],
  ["CLAUDE.md", "host-instructions:claude-code"],
  [".cursor/rules", "host-instructions:cursor"],
]);

interface ReadTextResult {
  path: string;
  text: string;
}

function intakeError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_INTAKE_UNSAFE",
    message,
    remediation: "Use regular UTF-8 project files inside the selected project root.",
    exitCode: 4,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

async function optionalStat(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw intakeError("Unable to inspect a project path.", [filePath], error);
  }
}

function portableInputPath(candidate: string): string {
  if (path.isAbsolute(candidate)) {
    throw intakeError("Specification paths must be project-relative.", [candidate]);
  }
  try {
    const normalized = normalizePortablePath(candidate);
    if (normalized === ".") throw new TypeError("a file path is required");
    return normalized;
  } catch (error) {
    throw intakeError("Specification path is not a safe project-relative path.", [candidate], error);
  }
}

async function readBoundedText(root: string, relativePath: string, required: boolean): Promise<ReadTextResult | undefined> {
  const portable = portableInputPath(relativePath);
  const absolute = resolveInsideRoot(root, portable);
  const stats = await optionalStat(absolute);
  if (stats === undefined) {
    if (required) throw intakeError("Specification file does not exist.", [portable]);
    return undefined;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    if (required) throw intakeError("Specification must be a regular file and not a symbolic link.", [portable]);
    return undefined;
  }
  if (stats.size > MAX_TEXT_BYTES) {
    if (required) throw intakeError(`Specification exceeds the ${MAX_TEXT_BYTES}-byte inspection limit.`, [portable]);
    return undefined;
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw intakeError("Unable to read a project input file.", [portable], error);
  }
  if (bytes.includes(0)) {
    if (required) throw intakeError("Specification must be UTF-8 text, not binary data.", [portable]);
    return undefined;
  }
  try {
    return {
      path: portable,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    };
  } catch (error) {
    if (required) throw intakeError("Specification must contain valid UTF-8 text.", [portable], error);
    return undefined;
  }
}

function firstProseParagraph(text: string): string {
  const lines = text.split("\n");
  const collected: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (collected.length > 0) break;
      continue;
    }
    if (line.startsWith("#") || line.startsWith("---") || /^```/.test(line)) continue;
    collected.push(line);
  }
  return collected.join(" ").trim().slice(0, 20_000);
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function addEvidence(
  evidence: Array<{ path: string; signal: string }>,
  evidencePath: string,
  signal: string,
): void {
  if (!evidence.some((item) => item.path === evidencePath && item.signal === signal)) {
    evidence.push({ path: evidencePath, signal });
  }
}

function nodePackageManager(topLevel: ReadonlySet<string>): string {
  if (topLevel.has("pnpm-lock.yaml")) return "pnpm";
  if (topLevel.has("yarn.lock")) return "yarn";
  if (topLevel.has("bun.lock") || topLevel.has("bun.lockb")) return "bun";
  return "npm";
}

function nodeCommand(manager: string, script: string): NonEmptyArgv {
  if (manager === "npm") return script === "test" ? ["npm", "test"] : ["npm", "run", script];
  return [manager, script];
}

function classify(
  frameworks: ReadonlySet<string>,
  brief: string,
  topLevel: ReadonlySet<string>,
): ProjectKind {
  const frontend = ["angular", "next.js", "react", "svelte", "vue"].some((item) => frameworks.has(item));
  const backend = ["django", "express", "fastapi", "fastify", "flask", "nestjs", "spring"].some((item) => frameworks.has(item));
  if (frontend && backend) return "full-stack";
  if (frameworks.has("expo") || frameworks.has("react-native")) return "mobile";
  if (frontend) return "frontend";
  if (backend) return "backend";
  if (["pandas", "pytorch", "scikit-learn", "tensorflow"].some((item) => frameworks.has(item))) return "data";
  if (topLevel.has("main.tf") || topLevel.has("Pulumi.yaml") || topLevel.has("Chart.yaml")) return "infrastructure";
  if (/\b(command[- ]line|cli)\b/i.test(brief)) return "cli";
  if (/\b(library|sdk|package)\b/i.test(brief)) return "library";
  return "unknown";
}

function packageRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = packageRecord(value);
  if (record === undefined) return {};
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function canonicalFingerprint(inspection: Omit<ProjectInspection, "root" | "analysisSha256">): string {
  return sha256Text(JSON.stringify(inspection));
}

export async function inspectProject(input: InspectProjectInput): Promise<ProjectInspection> {
  const root = path.resolve(input.root);
  const rootStats = await optionalStat(root);
  if (rootStats !== undefined && (rootStats.isSymbolicLink() || !rootStats.isDirectory())) {
    throw intakeError("The selected project root must be a regular directory.", [root]);
  }

  const children = rootStats === undefined
    ? []
    : await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      throw intakeError("Unable to enumerate the selected project root.", [root], error);
    });
  const topLevel = new Set(children.map((entry) => entry.name));
  const mode: "new" | "existing" = children.length === 0 ? "new" : "existing";
  const evidence: Array<{ path: string; signal: string }> = [];
  const warnings: string[] = [];
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const qualityCommands: QualityCommand[] = [];
  const instructionSurfaces: string[] = [];
  let name = path.basename(root);

  const specificationPaths = sorted((input.specificationPaths ?? []).map(portableInputPath));
  const specifications: ReadTextResult[] = [];
  for (const specificationPath of specificationPaths) {
    specifications.push((await readBoundedText(root, specificationPath, true))!);
    addEvidence(evidence, specificationPath, "input:specification");
  }

  const packageFile = await readBoundedText(root, "package.json", false);
  if (packageFile !== undefined) {
    let packageJson: Record<string, unknown> | undefined;
    try {
      packageJson = packageRecord(JSON.parse(packageFile.text));
    } catch {
      warnings.push("package.json could not be parsed and was not used as evidence.");
    }
    if (packageJson !== undefined) {
      if (typeof packageJson.name === "string" && packageJson.name.trim().length > 0) name = packageJson.name.trim();
      const dependencies = {
        ...stringRecord(packageJson.dependencies),
        ...stringRecord(packageJson.devDependencies),
        ...stringRecord(packageJson.peerDependencies),
      };
      const dependencyNames = new Set(Object.keys(dependencies));
      const mappings = new Map<string, string>([
        ["@angular/core", "angular"], ["@anthropic-ai/sdk", "anthropic"], ["@nestjs/core", "nestjs"],
        ["expo", "expo"], ["express", "express"], ["fastify", "fastify"], ["langchain", "langchain"],
        ["next", "next.js"], ["openai", "openai"], ["react", "react"], ["react-native", "react-native"],
        ["svelte", "svelte"], ["vue", "vue"],
      ]);
      for (const [dependency, framework] of mappings) {
        if (dependencyNames.has(dependency)) {
          frameworks.add(framework);
          addEvidence(evidence, "package.json", `dependency:${dependency}`);
        }
      }
      const typescript = topLevel.has("tsconfig.json") || dependencyNames.has("typescript");
      languages.add(typescript ? "typescript" : "javascript");
      addEvidence(evidence, typescript && topLevel.has("tsconfig.json") ? "tsconfig.json" : "package.json", `language:${typescript ? "typescript" : "javascript"}`);
      const manager = nodePackageManager(topLevel);
      packageManagers.add(manager);
      const managerEvidence = manager === "pnpm" ? "pnpm-lock.yaml" : manager === "yarn" ? "yarn.lock" : manager === "bun"
        ? (topLevel.has("bun.lock") ? "bun.lock" : "bun.lockb") : (topLevel.has("package-lock.json") ? "package-lock.json" : "package.json");
      addEvidence(evidence, managerEvidence, `package-manager:${manager}`);
      const scripts = stringRecord(packageJson.scripts);
      for (const script of ["test", "lint", "build", "verify", "check"]) {
        if (scripts[script] !== undefined) {
          qualityCommands.push({ name: script, argv: nodeCommand(manager, script) });
          addEvidence(evidence, "package.json", `script:${script}`);
        }
      }
    }
  }

  const pyproject = await readBoundedText(root, "pyproject.toml", false);
  if (pyproject !== undefined) {
    languages.add("python");
    packageManagers.add("python");
    addEvidence(evidence, "pyproject.toml", "language:python");
    const projectName = /^name\s*=\s*["']([^"']+)["']/m.exec(pyproject.text)?.[1];
    if (projectName !== undefined) name = projectName;
    const lowered = pyproject.text.toLocaleLowerCase("en-US");
    for (const framework of ["django", "fastapi", "flask", "pandas", "pytorch", "scikit-learn", "tensorflow"]) {
      if (lowered.includes(framework)) {
        frameworks.add(framework);
        addEvidence(evidence, "pyproject.toml", `dependency:${framework}`);
      }
    }
    if (/\bpytest\b/.test(lowered)) {
      qualityCommands.push({ name: "test", argv: ["python", "-m", "pytest"] });
      addEvidence(evidence, "pyproject.toml", "test-runner:pytest");
    }
  }

  const manifestChecks: Array<[string, string, string, NonEmptyArgv]> = [
    ["go.mod", "go", "go", ["go", "test", "./..."]],
    ["Cargo.toml", "rust", "cargo", ["cargo", "test"]],
    ["pom.xml", "java", "maven", ["mvn", "test"]],
  ];
  for (const [manifest, language, manager, argv] of manifestChecks) {
    if (!topLevel.has(manifest)) continue;
    languages.add(language);
    packageManagers.add(manager);
    qualityCommands.push({ name: "test", argv });
    addEvidence(evidence, manifest, `language:${language}`);
  }
  if ([...topLevel].some((entry) => entry.endsWith(".sln") || entry.endsWith(".csproj"))) {
    languages.add("csharp");
    packageManagers.add("dotnet");
    qualityCommands.push({ name: "test", argv: ["dotnet", "test"] });
    const manifest = [...topLevel].find((entry) => entry.endsWith(".sln") || entry.endsWith(".csproj"))!;
    addEvidence(evidence, manifest, "language:csharp");
  }

  for (const [surface, signal] of HOST_INSTRUCTIONS) {
    const absolute = resolveInsideRoot(root, surface);
    const stats = await optionalStat(absolute);
    if (stats !== undefined && !stats.isSymbolicLink() && (stats.isFile() || stats.isDirectory())) {
      instructionSurfaces.push(surface);
      addEvidence(evidence, surface, signal);
    }
  }

  const explicitBrief = input.brief?.trim() ?? "";
  const specificationPurpose = specifications.map((item) => firstProseParagraph(item.text)).find((value) => value.length > 0) ?? "";
  const readme = await readBoundedText(root, "README.md", false);
  const readmePurpose = readme === undefined ? "" : firstProseParagraph(readme.text);
  const request = explicitBrief || specificationPurpose || readmePurpose;
  if (explicitBrief.length > 0) addEvidence(evidence, ".", "input:brief");
  else if (specificationPurpose.length > 0) addEvidence(evidence, specifications[0]!.path, "input:purpose");
  else if (readmePurpose.length > 0) addEvidence(evidence, "README.md", "input:purpose");

  const mutableRoots = sorted(PRIMARY_MUTABLE_ROOTS.filter((candidate) => {
    const entry = children.find((child) => child.name === candidate);
    return entry?.isDirectory() === true;
  }));
  if (mutableRoots.length === 0) mutableRoots.push("src");

  const kind = classify(frameworks, request, topLevel);
  const questions = request.length === 0 ? ["What outcome should this software deliver?"] : [];
  const confidence = request.length === 0 ? "low" : packageFile !== undefined || pyproject !== undefined ? "high" : "medium";
  const withoutHash: Omit<ProjectInspection, "root" | "analysisSha256"> = {
    schemaVersion: 1,
    name,
    request,
    mode,
    kind,
    languages: sorted(languages),
    frameworks: sorted(frameworks),
    packageManagers: sorted(packageManagers),
    qualityCommands: qualityCommands.length === 0
      ? [{ name: "diff-check", argv: ["git", "diff", "--check"] }]
      : qualityCommands,
    mutableRoots,
    instructionSurfaces: sorted(instructionSurfaces),
    sources: specificationPaths,
    evidence: [...evidence].sort((left, right) => left.path.localeCompare(right.path, "en") || left.signal.localeCompare(right.signal, "en")),
    questions,
    warnings,
    confidence,
  };
  return { ...withoutHash, root, analysisSha256: canonicalFingerprint(withoutHash) };
}
