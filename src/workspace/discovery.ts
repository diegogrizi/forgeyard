import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export interface WorkspaceLimits { maxDepth: number; maxEntries: number; maxRepositories: number }
export interface WorkspaceRepository {
  path: string;
  kind: "repository" | "worktree" | "submodule";
  gitDirectory: string;
  commonDirectory: string;
}
export interface WorkspaceProject {
  path: string;
  repository: string | null;
  manifests: string[];
  languages: string[];
  frameworks: string[];
}
export interface WorkspaceWarning { code: string; path: string }
export interface WorkspaceDiscovery {
  schemaVersion: 1;
  root: string;
  kind: "empty" | "directory" | "repository" | "multi-repository";
  containingRepository: string | null;
  repositories: WorkspaceRepository[];
  projects: WorkspaceProject[];
  warnings: WorkspaceWarning[];
  scan: { status: "complete" | "limited"; visitedEntries: number; excludedDirectories: number; limits: WorkspaceLimits };
}

const DEFAULTS: WorkspaceLimits = { maxDepth: 6, maxEntries: 4096, maxRepositories: 64 };
const EXCLUDED = new Set([".git", ".forgeyard", ".agents", ".claude", ".codex", ".cursor", ".idea", ".vscode",
  ".ssh", ".aws", ".azure", ".gcloud", ".venv", "venv", "node_modules", "vendor", "dist", "build", "target",
  "coverage", ".next", ".gradle", "__pycache__"]);
const MANIFESTS = new Set(["package.json", "tsconfig.json", "angular.json", "pom.xml", "build.gradle",
  "build.gradle.kts", "CMakeLists.txt", "meson.build"]);
const execute = promisify(execFile);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export class WorkspaceDiscoveryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "WorkspaceDiscoveryError"; }
}
function safeName(name: string): boolean { return !/[\u0000-\u001f\u007f]/u.test(name); }
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
async function optionalStat(file: string) {
  try { return await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Solo metadati Git: nessun hook, fetch, checkout, status refresh o script applicativo. */
async function gitIdentity(directory: string): Promise<{ root: string; gitDirectory: string; commonDirectory: string; submodule: boolean } | null> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  // Il workspace esplicito non deve essere sostituito dal Git del processo chiamante.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[key];
  try {
    const result = await execute("git", ["--no-optional-locks", "-C", directory, "rev-parse", "--path-format=absolute",
      "--show-toplevel", "--git-dir", "--git-common-dir", "--show-superproject-working-tree"],
    { shell: false, env, timeout: 5000, maxBuffer: 65536, windowsHide: true });
    const lines = result.stdout.replaceAll("\r\n", "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines.length < 3 || lines.length > 4 || lines.some((line) => !safeName(line))) return null;
    const [root, gitDirectory, commonDirectory] = await Promise.all(lines.slice(0, 3).map((line) => realpath(path.resolve(directory, line))));
    return { root: root!, gitDirectory: gitDirectory!, commonDirectory: commonDirectory!, submodule: !!lines[3] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new WorkspaceDiscoveryError("FY_GIT_UNAVAILABLE", "Git non e disponibile nel PATH.");
    return null;
  }
}

/** Ricognizione locale: restituisce topologia e indizi, non installa una suite e non certifica uno stack. */
export async function discoverWorkspace(input: string, overrides: Partial<WorkspaceLimits> = {}): Promise<WorkspaceDiscovery> {
  const limits = { ...DEFAULTS, ...overrides };
  for (const [key, maximum, minimum] of [["maxDepth", 16, 0], ["maxEntries", 100000, 1], ["maxRepositories", 256, 1]] as const) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new WorkspaceDiscoveryError("FY_WORKSPACE_LIMIT", "Limiti di scansione non validi.");
  }
  let root: string;
  try {
    if (!safeName(input)) throw new Error("unsafe root");
    const requested = path.resolve(input);
    const stats = await lstat(requested);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("not a directory");
    root = await realpath(requested);
  } catch { throw new WorkspaceDiscoveryError("FY_WORKSPACE_ROOT", "Seleziona una cartella esistente, non un file o un collegamento simbolico."); }

  const repositories: WorkspaceRepository[] = [];
  const unresolvedGitRoots = new Set<string>();
  const projects: WorkspaceProject[] = [];
  const warnings: WorkspaceWarning[] = [];
  const warningKeys = new Set<string>();
  const relative = (absolute: string) => path.relative(root, absolute).split(path.sep).join("/") || ".";
  function warn(code: string, location: string): void {
    const key = `${code}\0${location}`;
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    if (warnings.length < 255) warnings.push({ code, path: location });
    else if (warnings.length === 255) warnings.push({ code: "warning-limit", path: "." });
  }
  let manifestBytes = 0;
  async function text(directory: string, name: string): Promise<string | undefined> {
    const absolute = path.join(directory, name);
    let handle;
    try {
      // Verifica anche i genitori prima di aprire un manifest. Non e una sandbox contro altri processi.
      if (!samePath(await realpath(directory), directory) || !within(root, directory)) {
        warn("changed-path", relative(directory)); return undefined;
      }
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink() || !stats.isFile()) { warn("symlink-skipped", relative(absolute)); return undefined; }
      if (stats.size > 131072) { warn("manifest-size-limit", relative(absolute)); return undefined; }
      if (manifestBytes + stats.size > 2097152) { warn("manifest-byte-limit", relative(absolute)); return undefined; }
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const actual = await handle.stat();
      if (!actual.isFile() || actual.size > 131072) { warn("changed-input", relative(absolute)); return undefined; }
      const buffer = Buffer.alloc(131073);
      let length = 0;
      while (length < buffer.length) {
        const part = await handle.read(buffer, length, buffer.length - length, length);
        if (part.bytesRead === 0) break;
        length += part.bytesRead;
      }
      if (length > 131072 || manifestBytes + length > 2097152) { warn("manifest-byte-limit", relative(absolute)); return undefined; }
      manifestBytes += length;
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    } catch { warn("unreadable-manifest", relative(absolute)); return undefined; }
    finally { await handle?.close(); }
  }
  async function project(directory: string, names: Set<string>): Promise<void> {
    const manifests = [...names].filter((name) => MANIFESTS.has(name)).sort(compare);
    if (manifests.length === 0) return;
    const languages = new Set<string>(); const frameworks = new Set<string>();
    if (names.has("tsconfig.json")) languages.add("typescript");
    if (names.has("angular.json")) frameworks.add("angular");
    if (names.has("package.json")) {
      const source = await text(directory, "package.json");
      if (source !== undefined) {
        try {
          const value: unknown = JSON.parse(source);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
          const record = value as Record<string, unknown>;
          const dependencies = new Set<string>();
          for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
            const dependency = record[field];
            if (dependency && typeof dependency === "object" && !Array.isArray(dependency))
              for (const name of Object.keys(dependency)) dependencies.add(name);
          }
          if (dependencies.has("typescript")) languages.add("typescript");
          if (!languages.has("typescript")) languages.add("javascript");
          for (const [dependency, framework] of [["react", "react"], ["@angular/core", "angular"],
            ["next", "next.js"], ["@nestjs/core", "nestjs"]]) if (dependencies.has(dependency!)) frameworks.add(framework!);
        } catch { warn("invalid-manifest", relative(path.join(directory, "package.json"))); }
      }
    }
    for (const name of ["pom.xml", "build.gradle", "build.gradle.kts"]) if (names.has(name)) {
      languages.add("jvm");
      const source = await text(directory, name);
      if (source && /org\.springframework|spring-boot/u.test(source)) frameworks.add("spring");
    }
    if (names.has("CMakeLists.txt")) {
      const source = await text(directory, "CMakeLists.txt");
      languages.add(source && /\bCXX\b/u.test(source) ? "cpp" : "c-or-cpp");
      frameworks.add("cmake");
    }
    if (names.has("meson.build")) frameworks.add("meson");
    projects.push({ path: relative(directory), repository: null, manifests,
      languages: [...languages].sort(compare), frameworks: [...frameworks].sort(compare) });
  }

  let visitedEntries = 0; let excludedDirectories = 0; let rootEmpty = false;
  let containingRepository: string | null = null;
  const queue = [{ directory: root, depth: 0 }];
  // Visita per livelli: un grande repository non deve consumare subito la profondita degli altri.
  for (let index = 0; index < queue.length; index++) {
    const { directory, depth } = queue[index]!;
    if (index >= 1024) { warn("directory-limit", relative(directory)); break; }
    if (visitedEntries >= limits.maxEntries) { warn("entry-limit", relative(directory)); break; }
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || !samePath(await realpath(directory), directory)) {
        warn("changed-path", relative(directory)); continue;
      }
      const marker = await optionalStat(path.join(directory, ".git"));
      if (marker) unresolvedGitRoots.add(relative(directory));
      if (marker?.isSymbolicLink()) warn("symlink-skipped", relative(path.join(directory, ".git")));
      else if (marker || directory === root) {
        if (marker && repositories.length >= limits.maxRepositories) warn("repository-limit", relative(directory));
        else {
          const identity = await gitIdentity(directory).catch((error: unknown) => {
            warn(error instanceof WorkspaceDiscoveryError ? error.code : "invalid-git", relative(directory));
            return null;
          });
          if (identity && samePath(identity.root, directory)) {
            unresolvedGitRoots.delete(relative(directory));
            repositories.push({ path: relative(directory),
              kind: identity.submodule ? "submodule" : samePath(identity.gitDirectory, identity.commonDirectory) ? "repository" : "worktree",
              gitDirectory: identity.gitDirectory, commonDirectory: identity.commonDirectory });
          }
          else if (marker) warn("invalid-git", relative(directory));
          else if (directory === root && identity) containingRepository = identity.root;
        }
      }
      const entries = [];
      const available = limits.maxEntries - visitedEntries;
      for await (const entry of await opendir(directory)) {
        if (entries.length >= available) { warn("entry-limit", relative(directory)); break; }
        entries.push(entry);
      }
      entries.sort((a, b) => compare(a.name, b.name));
      if (directory === root) rootEmpty = entries.length === 0;
      visitedEntries += entries.length;
      const names = new Set<string>();
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (EXCLUDED.has(entry.name)) { if (entry.isDirectory()) excludedDirectories++; continue; }
        if (!safeName(entry.name)) { warn("unsafe-name", relative(absolute)); continue; }
        if (entry.isSymbolicLink()) { warn("symlink-skipped", relative(absolute)); continue; }
        if (entry.isFile()) names.add(entry.name);
        if (entry.isDirectory()) {
          if (depth >= limits.maxDepth) warn("depth-limit", relative(absolute));
          else queue.push({ directory: absolute, depth: depth + 1 });
        }
      }
      await project(directory, names);
    } catch (error) {
      warn(error instanceof WorkspaceDiscoveryError ? error.code : "unreadable-directory", relative(directory));
    }
  }
  repositories.sort((a, b) => compare(a.path, b.path));
  projects.sort((a, b) => compare(a.path, b.path));
  for (const item of projects) {
    const owners = repositories.filter((repo) => repo.path === "." || item.path === repo.path || item.path.startsWith(`${repo.path}/`));
    owners.sort((a, b) => b.path.length - a.path.length);
    const owner = owners[0]?.path;
    const ambiguous = [...unresolvedGitRoots].some((boundary) =>
      (boundary === "." || item.path === boundary || item.path.startsWith(`${boundary}/`)) &&
      (owner === undefined || boundary.length >= owner.length));
    item.repository = ambiguous ? null : owner ?? null;
  }
  warnings.sort((a, b) => compare(a.path, b.path) || compare(a.code, b.code));
  return { schemaVersion: 1, root, kind: repositories.length > 1 ? "multi-repository"
    : repositories.some((repo) => repo.path === ".") ? "repository" : rootEmpty ? "empty" : "directory",
    containingRepository, repositories, projects, warnings,
    scan: { status: warnings.length ? "limited" : "complete", visitedEntries, excludedDirectories, limits } };
}
