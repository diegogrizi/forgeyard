import { lstat, open, opendir, realpath } from "node:fs/promises";
import { constants, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { NonEmptyArgv, ProjectKind, QualityCommand } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import type { InspectProjectInput, ProjectInspection, InspectionLimits, InspectionEvidence } from "./contracts.js";

const MAX_TEXT_BYTES = 256 * 1024;
const DEFAULT_LIMITS: InspectionLimits = { maxEntries: 4096, maxDepth: 6, maxFiles: 512, maxTotalBytes: 4 * 1024 * 1024 };
const EXCLUDED_DIRECTORIES = new Set([".git", ".forgeyard", "node_modules", "vendor", "dist", "build", "target", "coverage", ".next", ".venv", "venv", "__pycache__", ".gradle", ".idea", ".ssh", ".aws", ".azure", ".gcloud", ".npmrc", ".netrc", ".pypirc"]);
function excludedPath(candidate: string): boolean {
  return candidate.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part) || /^\.env(?:\.|$)/i.test(part) || /(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)/i.test(part) || /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(part));
}
const PRIMARY_MUTABLE_ROOTS = ["api", "app", "apps", "backend", "client", "frontend", "lib", "packages", "server", "src"];
const HOST_INSTRUCTIONS = new Map([
  ["AGENTS.md", "host-instructions:codex"],
  ["CLAUDE.md", "host-instructions:claude-code"],
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

async function boundedBytes(absolute: string): Promise<Buffer> {
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw intakeError("Inspection input changed from a regular file.");
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return Buffer.from(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

async function readBoundedText(root: string, relativePath: string, required: boolean, snapshot?: ReadonlyMap<string, Buffer>): Promise<ReadTextResult | undefined> {
  const portable = portableInputPath(relativePath);
  if (excludedPath(portable)) {
    if (required) throw intakeError("Excluded sensitive or generated inputs cannot be specifications.");
    return undefined;
  }
  for (const parent of portable.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))) {
    if ((await optionalStat(resolveInsideRoot(root, parent)))?.isSymbolicLink()) {
      if (required) throw intakeError("Specification parents must not be symbolic links.");
      return undefined;
    }
  }
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
    if (snapshot !== undefined && !snapshot.has(portable)) {
      if (required) throw intakeError("Required specification was not available within inspection bounds.");
      return undefined;
    }
    bytes = snapshot?.get(portable) ?? await boundedBytes(absolute);
  } catch (error) {
    throw intakeError("Unable to read a project input file.", [portable], error);
  }
  if (bytes.length > MAX_TEXT_BYTES) {
    if (required) throw intakeError("Specification changed beyond the bounded inspection limit.");
    return undefined;
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
  if ((input.brief !== undefined && (typeof input.brief !== "string" || input.brief.length > 20_000)) || (input.specificationPaths !== undefined && (!Array.isArray(input.specificationPaths) || input.specificationPaths.length > 128 || input.specificationPaths.some((file) => typeof file !== "string" || file.length > 1024)))) throw intakeError("Project input exceeds bounded text or specification counts.");
  let root = path.resolve(input.root);
  const rootStats = await optionalStat(root);
  if (rootStats !== undefined && (rootStats.isSymbolicLink() || !rootStats.isDirectory())) {
    throw intakeError("The selected project root must be a regular directory.", [root]);
  }
  if (rootStats !== undefined) root = await realpath(root);
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof InspectionLimits>) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_LIMITS[key]) throw intakeError("Inspection limits must be positive and not exceed built-in bounds.");
  }
  const limitations = new Set<string>();
  const hashes = new Map<string, string>();
  const snapshot = new Map<string, Buffer>();
  const scannedFiles: string[] = [];
  let children: Dirent[] = [];
  let visitedEntries = 0;
  let totalBytes = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    const entries: Dirent[] = [];
    const remaining = limits.maxEntries - visitedEntries;
    try {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (entries.length >= remaining) { limitations.add("entry-limit"); break; }
        entries.push(entry);
      }
    } catch { throw intakeError("Unable to enumerate a bounded project directory."); }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    if (depth === 0) children = entries;
    for (const entry of entries) {
      if (visitedEntries >= limits.maxEntries) { limitations.add("entry-limit"); return; }
      visitedEntries++;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink() || excludedPath(relative)) continue;
      if (entry.isDirectory()) {
        if (depth >= limits.maxDepth) { limitations.add("depth-limit"); continue; }
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        if (hashes.size >= limits.maxFiles) { limitations.add("file-limit"); continue; }
        const stat = await optionalStat(absolute);
        if (stat === undefined || stat.isSymbolicLink() || !stat.isFile()) { limitations.add("changed-input"); continue; }
        if (stat.size > MAX_TEXT_BYTES) { limitations.add("file-size-limit"); continue; }
        if (totalBytes + stat.size > limits.maxTotalBytes) { limitations.add("byte-limit"); continue; }
        let bytes: Buffer;
        try { bytes = await boundedBytes(absolute); } catch { limitations.add("changed-input"); continue; }
        if (bytes.length > MAX_TEXT_BYTES || totalBytes + bytes.length > limits.maxTotalBytes) { limitations.add("byte-limit"); continue; }
        totalBytes += bytes.length;
        hashes.set(relative, createHash("sha256").update(bytes).digest("hex"));
        snapshot.set(relative, bytes);
        scannedFiles.push(relative);
      }
    }
  }
  if (rootStats !== undefined) await walk(root, 0);

  const topLevel = new Set(children.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !excludedPath(entry.name) && hashes.has(entry.name)).map((entry) => entry.name));
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
    specifications.push((await readBoundedText(root, specificationPath, true, snapshot))!);
    addEvidence(evidence, specificationPath, "input:specification");
  }

  const packageFile = await readBoundedText(root, "package.json", false, snapshot);
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

  const pyproject = await readBoundedText(root, "pyproject.toml", false, snapshot);
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
  ];
  for (const [manifest, language, manager, argv] of manifestChecks) {
    if (!topLevel.has(manifest)) continue;
    languages.add(language);
    packageManagers.add(manager);
    qualityCommands.push({ name: "test", argv });
    addEvidence(evidence, manifest, `language:${language}`);
  }
  for (const manifest of scannedFiles.filter((file) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(path.posix.basename(file))).sort()) {
    const content = await readBoundedText(root, manifest, false, snapshot);
    if (content === undefined) continue;
    const maven = path.posix.basename(manifest) === "pom.xml";
    const manager = maven ? "maven" : "gradle";
    const cwd = path.posix.dirname(manifest);
    const wrapper = maven ? "mvnw" : "gradlew";
    const wrapperPath = cwd === "." ? wrapper : `${cwd}/${wrapper}`;
    const windowsWrapper = maven ? `${wrapper}.cmd` : `${wrapper}.bat`;
    const windowsPath = cwd === "." ? windowsWrapper : `${cwd}/${windowsWrapper}`;
    const command = hashes.has(wrapperPath) ? `./${wrapper}` : hashes.has(windowsPath) ? `./${windowsWrapper}` : maven ? "mvn" : "gradle";
    languages.add("java");
    packageManagers.add(manager);
    qualityCommands.push({ name: "test", argv: [command, "test"], ...(cwd === "." ? {} : { cwd }) });
    addEvidence(evidence, manifest, "language:java");
    if (/org\.springframework|spring-boot|org\.springframework\.boot/.test(content.text)) {
      frameworks.add("spring");
      addEvidence(evidence, manifest, "dependency:spring");
    }
    if (command.startsWith("./")) addEvidence(evidence, hashes.has(wrapperPath) ? wrapperPath : windowsPath, `wrapper:${manager}`);
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
  const readme = await readBoundedText(root, "README.md", false, snapshot);
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
  const evidenceRecords: InspectionEvidence[] = evidence.flatMap((item) => {
    const hash = item.path === "." ? sha256Text(explicitBrief) : hashes.get(item.path);
    if (hash === undefined) return [];
    const inference: InspectionEvidence["inference"] = item.signal.startsWith("input:") ? "explicit-input" : item.signal.startsWith("host-instructions:") || item.signal.startsWith("wrapper:") || item.signal.startsWith("package-manager:") ? "presence" : item.signal === "dependency:spring" || item.path.endsWith("pyproject.toml") || item.path.endsWith("README.md") ? "text-pattern" : "manifest";
    return [{ ...item, sha256: hash, locator: item.path === "." ? "brief" : "file", inference }];
  });
  for (const [file, sha256] of hashes) evidenceRecords.push({ path: file, signal: "file:observed", sha256, locator: "file", inference: "presence" });
  if (kind === "cli" || kind === "library") warnings.push("Project-kind keyword classification is a labeled compatibility fallback, not semantic interpretation.");
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
    evidenceRecords: evidenceRecords.sort((left, right) => left.path.localeCompare(right.path, "en") || left.signal.localeCompare(right.signal, "en")),
    scan: { status: limitations.size === 0 ? "complete" : "limited", visitedEntries, hashedFiles: hashes.size, limits, limitations: [...limitations].sort() },
    questions,
    warnings,
    confidence,
  };
  return { ...withoutHash, root, analysisSha256: canonicalFingerprint(withoutHash) };
}
