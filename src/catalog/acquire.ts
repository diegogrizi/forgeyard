import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ComponentTreeFile, ResolvedComponent } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Bytes, sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath, resolveInsideRoot } from "../core/paths.js";

export interface ExternalCatalogReference {
  schemaVersion: 1;
  repository: string;
  revision: "HEAD";
  license: "MIT";
  plugins: readonly string[];
}
export interface CatalogDownloadOptions { cacheRoot?: string; revision?: string; fetcher?: typeof fetch }
export interface AcquiredCatalog { revision: string; files: readonly ComponentTreeFile[]; sha256: string }
interface Inventory { revision: string; repository: string; files: { path: string; sha256: string }[] }
const SHA = /^[a-f0-9]{40}$/;
const NAME = /^[a-z][a-z0-9-]{0,100}$/;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;

function failure(message: string, code = "FY_CATALOG_INVALID"): ForgeyardError {
  return new ForgeyardError({ code, message,
    remediation: "Controlla la fonte esterna e la connessione; il progetto non viene modificato se il recupero fallisce.", exitCode: 3 });
}
export function validateExternalCatalogReference(value: unknown): ExternalCatalogReference {
  const ref = value as Partial<ExternalCatalogReference> | null;
  if (!ref || typeof ref !== "object" || Array.isArray(ref) ||
    Object.keys(ref).some(key => !["schemaVersion", "repository", "revision", "license", "plugins"].includes(key)) ||
    ref.schemaVersion !== 1 || typeof ref.repository !== "string" ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(ref.repository) ||
    ref.revision !== "HEAD" || ref.license !== "MIT" || !Array.isArray(ref.plugins) ||
    ref.plugins.length === 0 || ref.plugins.length > 256 ||
    ref.plugins.some(name => typeof name !== "string" || !NAME.test(name)) || new Set(ref.plugins).size !== ref.plugins.length)
    throw failure("Il riferimento al catalogo esterno non è valido.");
  return { ...ref, plugins: [...ref.plugins].sort() } as ExternalCatalogReference;
}

async function bytesAt(url: string, fetcher: typeof fetch): Promise<Uint8Array> {
  try {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "Forgeyard", Accept: "application/vnd.github+json" } });
    if (!response.ok || !response.body) throw new Error("unavailable");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_FILE) throw new Error("oversized");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch { throw failure("Recupero del catalogo esterno non riuscito: controlla connessione e disponibilità della fonte.", "FY_CATALOG_DOWNLOAD_FAILED"); }
}
async function jsonAt(url: string, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  try { return JSON.parse(Buffer.from(await bytesAt(url, fetcher)).toString("utf8")) as Record<string, unknown>; }
  catch (error) { if (error instanceof ForgeyardError) throw error; throw failure("La fonte esterna ha restituito metadati non validi."); }
}

async function cached(directory: string, repository: string, revision: string): Promise<AcquiredCatalog | null> {
  let raw: string;
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure("La cache del catalogo non è una directory regolare.", "FY_CATALOG_INTEGRITY");
    raw = await readFile(path.join(directory, "inventory.json"), "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const inventory = JSON.parse(raw) as Inventory;
    if (inventory.repository !== repository || inventory.revision !== revision || !Array.isArray(inventory.files) || inventory.files.length > 2048)
      throw new Error("inventory");
    const canonicalRoot = await realpath(directory);
    const files: ComponentTreeFile[] = [];
    for (const file of inventory.files) {
      const relativePath = normalizePortablePath(file.path);
      const sourcePath = resolveInsideRoot(directory, relativePath);
      const info = await lstat(sourcePath);
      const canonical = await realpath(sourcePath);
      const relative = path.relative(canonicalRoot, canonical);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE || relative.startsWith("..") || path.isAbsolute(relative) ||
        sha256Bytes(await readFile(sourcePath)) !== file.sha256) throw new Error("digest");
      files.push({ relativePath, sourcePath, sha256: file.sha256 });
    }
    assertNoCaseCollisions(files.map(file => file.relativePath));
    return { revision, files, sha256: sha256Text(files.map(file => `${file.relativePath}\0${file.sha256}\n`).join("")) };
  } catch { throw failure("La cache del catalogo è cambiata o non è integra; rimuovi soltanto la voce del catalogo interessata e riprova.", "FY_CATALOG_INTEGRITY"); }
}

/** Resolve HEAD for each new preparation; an installed project supplies its exact revision. */
export async function acquireExternalCatalog(reference: ExternalCatalogReference, selection: readonly string[] | "all",
  options: CatalogDownloadOptions = {}): Promise<AcquiredCatalog> {
  const ref = validateExternalCatalogReference(reference);
  const selected = selection === "all" ? ref.plugins : [...new Set(selection)].sort();
  if (selected.length === 0 || selected.some(name => !ref.plugins.includes(name))) throw failure("Una capacità richiesta non è registrata nel catalogo esterno.");
  const fetcher = options.fetcher ?? fetch;
  const repositoryPath = ref.repository.slice("https://github.com/".length);
  const api = `https://api.github.com/repos/${repositoryPath}`;
  const revision = options.revision ?? (await jsonAt(`${api}/commits/HEAD`, fetcher)).sha;
  if (typeof revision !== "string" || !SHA.test(revision)) throw failure("La revisione risolta del catalogo non è un commit esatto.");
  const cacheRoot = path.resolve(options.cacheRoot ?? path.join(os.homedir(), ".cache", "forgeyard", "catalogs"));
  const key = sha256Text(JSON.stringify({ repository: ref.repository, revision, selected }));
  await mkdir(cacheRoot, { recursive: true });
  const directory = path.join(cacheRoot, key);
  const existing = await cached(directory, ref.repository, revision);
  if (existing) return existing;
  const metadata = await jsonAt(`${api}/git/trees/${revision}?recursive=1`, fetcher);
  if (metadata.truncated !== false || !Array.isArray(metadata.tree)) throw failure("L'indice remoto è incompleto o non valido.");
  const entries: { path: string; size: number }[] = [];
  for (const node of metadata.tree as Record<string, unknown>[]) {
    if (typeof node.path !== "string" || !(node.path === "LICENSE" || selected.some(id => node.path!.toString().startsWith(`plugins/${id}/`)))) continue;
    if (node.type === "tree") continue;
    if (node.type !== "blob" || !["100644", "100755"].includes(String(node.mode)) ||
      typeof node.size !== "number" || node.size < 0 || node.size > MAX_FILE) throw failure("La selezione remota contiene un file non supportato.");
    const portable = normalizePortablePath(node.path);
    if (portable !== node.path) throw failure("La selezione remota contiene un percorso non valido.");
    entries.push({ path: portable, size: node.size });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
  assertNoCaseCollisions(entries.map(entry => entry.path));
  if (!entries.some(entry => entry.path === "LICENSE") || selected.some(id => !entries.some(entry => entry.path === `plugins/${id}/.claude-plugin/plugin.json`)) ||
    entries.length > 2046 || entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_TOTAL)
    throw failure("La fonte non contiene tutti i plugin selezionati e la licenza, oppure supera i limiti del download.");
  const staging = await mkdtemp(path.join(cacheRoot, ".download-"));
  try {
    const inventory: Inventory = { repository: ref.repository, revision, files: [] };
    let cursor = 0;
    const downloaded = new Array<{ path: string; sha256: string }>(entries.length);
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (cursor < entries.length) {
        const index = cursor++; const entry = entries[index]!;
        const urlPath = entry.path.split("/").map(encodeURIComponent).join("/");
        const data = await bytesAt(`https://raw.githubusercontent.com/${repositoryPath}/${revision}/${urlPath}`, fetcher);
        if (data.byteLength !== entry.size) throw failure("La dimensione del file remoto non corrisponde all'indice.", "FY_CATALOG_INTEGRITY");
        const destination = resolveInsideRoot(staging, entry.path);
        await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, data);
        downloaded[index] = { path: entry.path, sha256: sha256Bytes(data) };
      }
    }));
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    const license = await readFile(path.join(staging, "LICENSE"), "utf8");
    if (!/\bMIT License\b/i.test(license)) throw failure("La licenza scaricata non corrisponde alla fonte MIT registrata.");
    const upstream = `${JSON.stringify({ schemaVersion: 1, source: ref.repository, revision, license: ref.license, selectedPlugins: selected }, null, 2)}\n`;
    await writeFile(path.join(staging, "UPSTREAM.json"), upstream);
    inventory.files = [...downloaded, { path: "UPSTREAM.json", sha256: sha256Text(upstream) }].sort((a,b) => a.path.localeCompare(b.path,"en"));
    await writeFile(path.join(staging, "inventory.json"), JSON.stringify(inventory));
    try { await rename(staging, directory); }
    catch (error) { if (!(await cached(directory, ref.repository, revision))) throw error; }
    return (await cached(directory, ref.repository, revision))!;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function materializeExternalCatalog(component: ResolvedComponent, options: CatalogDownloadOptions = {}): Promise<ResolvedComponent> {
  if (!component.externalCatalog) return component;
  const acquired = await acquireExternalCatalog(component.externalCatalog, component.catalogSelection ?? "all", options);
  return { ...component, entryType: "tree", treeFiles: acquired.files, sha256: acquired.sha256 };
}
