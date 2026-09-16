import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { normalizePortablePath } from "../core/paths.js";
import { assertDirectoryChain, atomicText, regularBytes } from "../native/files.js";
import { discoverWorkspace, type WorkspaceDiscovery, type WorkspaceProject, type WorkspaceRepository } from "./discovery.js";

export interface PersonalRegistration {
  format: "forgeyard-personal-workspace";
  schemaVersion: 1;
  payload: {
    root: string;
    createdAt: string;
    connection: "not-connected";
    repositories: Array<Pick<WorkspaceRepository, "path" | "kind">>;
    projects: WorkspaceProject[];
  };
  sha256: string;
}
export interface PersonalPreview {
  root: string;
  discovery: WorkspaceDiscovery;
  current: PersonalRegistration | null;
  fingerprint: string;
}
export class PersonalWorkspaceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PersonalWorkspaceError"; }
}

const execute = promisify(execFile);
const DIRECTORY = ".forgeyard";
const REGISTRATION = ".forgeyard/workspace.json";
const IGNORE_PATH = ".forgeyard/.gitignore";
// Anche questa regola resta ignorata: nessuna modifica al .gitignore condiviso.
const IGNORE = "# Area personale Forgeyard: non includere nei commit.\n*\n";
const MAXIMUM = 1_048_576;
const fail = (code: string, message: string): never => { throw new PersonalWorkspaceError(code, message); };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}
function portable(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try { return normalizePortablePath(value) === value; } catch { return false; }
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every((item) =>
    typeof item === "string" && item.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(item));
}
function validRegistration(value: unknown, root: string): value is PersonalRegistration {
  if (!record(value) || !keys(value, ["format", "schemaVersion", "payload", "sha256"]) ||
    value.format !== "forgeyard-personal-workspace" || value.schemaVersion !== 1 || !record(value.payload)) return false;
  const payload = value.payload;
  if (!keys(payload, ["root", "createdAt", "connection", "repositories", "projects"]) || payload.root !== root ||
    payload.connection !== "not-connected" || typeof payload.createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload.createdAt) || Number.isNaN(Date.parse(payload.createdAt)) ||
    value.sha256 !== sha256Text(canonicalJson(payload)) || !Array.isArray(payload.repositories) ||
    payload.repositories.length > 256 || !Array.isArray(payload.projects) || payload.projects.length > 4096) return false;
  const owners = new Set<string>();
  for (const repo of payload.repositories) {
    if (!record(repo) || !keys(repo, ["path", "kind"]) || !portable(repo.path) || typeof repo.kind !== "string" ||
      !["repository", "worktree", "submodule"].includes(repo.kind) || owners.has(repo.path)) return false;
    owners.add(repo.path);
  }
  const paths = new Set<string>();
  for (const project of payload.projects) {
    if (!record(project) || !keys(project, ["path", "repository", "manifests", "languages", "frameworks"]) ||
      !portable(project.path) || paths.has(project.path) ||
      (project.repository !== null && (typeof project.repository !== "string" || !owners.has(project.repository))) ||
      !strings(project.manifests) || !strings(project.languages) || !strings(project.frameworks)) return false;
    paths.add(project.path);
  }
  return true;
}
async function optionalStat(target: string) {
  try { return await lstat(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function assertNotTracked(discovery: WorkspaceDiscovery): Promise<void> {
  if (discovery.containingRepository === null && !discovery.repositories.some((repo) => repo.path === ".")) return;
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[key];
  let tracked: string;
  try {
    tracked = (await execute("git", ["--no-optional-locks", "-C", discovery.root, "-c", "core.fsmonitor=false",
      "ls-files", "--cached", "-z", "--", DIRECTORY], { env, shell: false, timeout: 5000, maxBuffer: MAXIMUM, windowsHide: true })).stdout;
  } catch { return fail("FY_PERSONAL_GIT", "Impossibile verificare l'indice Git. Nessuna registrazione autorizzata."); }
  if (tracked.length) fail("FY_PERSONAL_TRACKED", "La cartella .forgeyard contiene file già tracciati. Un'esclusione non li rende personali: serve una migrazione esplicita.");
}

async function readCurrent(root: string): Promise<PersonalRegistration | null> {
  const stats = await optionalStat(path.join(root, DIRECTORY));
  if (!stats) return null;
  if (!stats.isDirectory() || stats.isSymbolicLink())
    return fail("FY_PERSONAL_CONFLICT", "La cartella .forgeyard non è un'area personale regolare; non verrà modificata.");
  if (!await optionalStat(path.join(root, REGISTRATION)))
    return fail("FY_PERSONAL_CONFLICT", "Esiste già un'area .forgeyard non riconosciuta o incompleta. È stata preservata; serve una migrazione esplicita.");
  try {
    const source = await regularBytes(root, REGISTRATION, MAXIMUM);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
    const ignore = await regularBytes(root, IGNORE_PATH, 1024);
    if (!validRegistration(value, root) || ignore.toString("utf8") !== IGNORE) throw new Error("drift");
    return value;
  } catch {
    return fail("FY_PERSONAL_DRIFT", "L'area personale è cambiata, incompleta o appartiene a un'altra cartella. I file non sono stati riscritti.");
  }
}

function fingerprint(discovery: WorkspaceDiscovery): string {
  // La presenza dei nostri file non cambia la topologia dei progetti.
  return sha256Text(canonicalJson({ root: discovery.root, containingRepository: discovery.containingRepository,
    repositories: discovery.repositories, projects: discovery.projects }));
}

/** Ricognizione e controllo della proprietà: nessuna creazione di file. */
export async function inspectPersonalWorkspace(root: string): Promise<PersonalPreview> {
  const discovery = await discoverWorkspace(root);
  await assertDirectoryChain(discovery.root);
  await assertNotTracked(discovery);
  const current = await readCurrent(discovery.root);
  return { root: discovery.root, discovery, current, fingerprint: fingerprint(discovery) };
}

/** Recupera soltanto byte creati da questa operazione. Non cancella mai ricorsivamente. */
async function rollbackCreated(root: string, identity: { dev: number; ino: number }, created: Map<string, string>): Promise<void> {
  const directory = path.join(root, DIRECTORY);
  const actual = await optionalStat(directory);
  if (!actual || !actual.isDirectory() || actual.isSymbolicLink() || actual.dev !== identity.dev || actual.ino !== identity.ino)
    return fail("FY_PERSONAL_RECOVERY", "La directory è cambiata durante il recupero. Nessuna rimozione automatica ulteriore.");
  for (const [relative, content] of [...created].reverse()) {
    if (relative === IGNORE_PATH) continue;
    const stats = await optionalStat(path.join(root, relative));
    if (!stats) continue;
    const bytes = await regularBytes(root, relative, MAXIMUM);
    if (sha256Text(bytes.toString("utf8")) !== sha256Text(content))
      return fail("FY_PERSONAL_RECOVERY", "Un file appena creato è stato modificato. L'area privata è conservata per evitare perdita di dati.");
    await unlink(path.join(root, relative));
  }
  const remaining = await readdir(directory);
  if (remaining.length === 1 && remaining[0] === ".gitignore" && created.has(IGNORE_PATH)) {
    if ((await regularBytes(root, IGNORE_PATH, 1024)).toString("utf8") !== IGNORE)
      return fail("FY_PERSONAL_RECOVERY", "La regola privata è stata modificata; il recupero non la sovrascrive.");
    await unlink(path.join(root, IGNORE_PATH));
  } else if (remaining.length !== 0) {
    return fail("FY_PERSONAL_RECOVERY", "L'area contiene file non riconosciuti. È stata mantenuta senza rimozioni ricorsive.");
  }
  await rmdir(directory);
}

/** Precondizione: la UI ha ottenuto consenso. Nessun modello o servizio nativo viene avviato. */
export async function createPersonalWorkspace(preview: PersonalPreview): Promise<PersonalRegistration> {
  if (preview.discovery.scan.status !== "complete")
    return fail("FY_PERSONAL_INCOMPLETE", "La scansione è parziale. Risolvi gli avvisi prima di registrare l'area personale.");
  const fresh = await inspectPersonalWorkspace(preview.root);
  if (fresh.discovery.scan.status !== "complete")
    return fail("FY_PERSONAL_INCOMPLETE", "La cartella non è più interamente ispezionabile. Nessuna area creata.");
  if (fresh.fingerprint !== preview.fingerprint)
    return fail("FY_PERSONAL_STALE", "La topologia è cambiata dopo l'anteprima. Riapri forgeyard per rivedere il riepilogo.");
  if (fresh.current) {
    if (preview.current?.sha256 === fresh.current.sha256) return fresh.current;
    return fail("FY_PERSONAL_CONFLICT", "Un'altra operazione ha già preparato l'area personale. Nessun file sovrascritto.");
  }
  const root = fresh.root;
  const payload: PersonalRegistration["payload"] = {
    root, createdAt: new Date().toISOString(), connection: "not-connected",
    repositories: fresh.discovery.repositories.map(({ path: memberPath, kind }) => ({ path: memberPath, kind })),
    projects: fresh.discovery.projects,
  };
  const registration: PersonalRegistration = { format: "forgeyard-personal-workspace", schemaVersion: 1, payload,
    sha256: sha256Text(canonicalJson(payload)) };
  const source = `${JSON.stringify(registration, null, 2)}\n`;
  if (Buffer.byteLength(source) > MAXIMUM) return fail("FY_PERSONAL_LIMIT", "La mappa supera il limite locale consentito.");
  await assertDirectoryChain(root);
  const directory = path.join(root, DIRECTORY);
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return fail("FY_PERSONAL_CONFLICT", "L'area personale esiste già. Nessun contenuto è stato sovrascritto.");
    throw error;
  }
  const identity = await lstat(directory);
  const created = new Map<string, string>();
  try {
    if (!identity.isDirectory() || identity.isSymbolicLink() || await realpath(directory) !== directory)
      return fail("FY_PERSONAL_CONFLICT", "La destinazione è cambiata durante la registrazione.");
    // La regola privata precede ogni dato: anche un setup interrotto resta escluso dai normali commit.
    await atomicText(path.join(root, IGNORE_PATH), IGNORE, null); created.set(IGNORE_PATH, IGNORE);
    await atomicText(path.join(root, REGISTRATION), source, null); created.set(REGISTRATION, source);
    const saved = await readCurrent(root);
    if (!saved || saved.sha256 !== registration.sha256) return fail("FY_PERSONAL_DRIFT", "La registrazione non corrisponde ai byte appena scritti.");
    return saved;
  } catch (error) {
    await rollbackCreated(root, identity, created);
    throw error;
  }
}
