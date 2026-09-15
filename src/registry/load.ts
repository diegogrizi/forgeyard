import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";
import { parse } from "yaml";

import type {
  PackManifest,
  ProfileManifest,
  SourceRecord,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";

export interface LoadedEntry {
  sourcePath: string;
  sha256: string;
}

export interface LoadedPack {
  directory: string;
  manifest: PackManifest;
  entries: ReadonlyMap<string, LoadedEntry>;
}

export interface RegistrySnapshot {
  root: string;
  profiles: ReadonlyMap<string, ProfileManifest>;
  packs: ReadonlyMap<string, LoadedPack>;
  sources: ReadonlyMap<string, SourceRecord>;
}

interface SourceCatalogDocument {
  schemaVersion: 1;
  sources: SourceRecord[];
}

function registryError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the registry manifest, source metadata, or component path.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ");
}

async function readYaml(filePath: string): Promise<unknown> {
  try {
    return parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw registryError(`Unable to parse registry document '${filePath}'.`, [filePath], error);
  }
}

async function compileSchema(schemaRoot: string, name: string): Promise<ValidateFunction> {
  const schemaPath = path.join(schemaRoot, name);
  try {
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
    const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false });
    formatsModule.default.default(ajv);
    return ajv.compile(schema);
  } catch (error) {
    throw registryError(`Unable to load registry schema '${name}'.`, [schemaPath], error);
  }
}

function requireValid<T>(validate: ValidateFunction, value: unknown, filePath: string): T {
  if (!validate(value)) {
    throw registryError(
      `Registry document '${filePath}' failed schema validation: ${formatErrors(validate.errors)}`,
      [filePath],
    );
  }
  return value as T;
}

async function yamlFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw registryError(`Unable to enumerate registry directory '${directory}'.`, [directory], error);
  }
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function ensureUnique<T>(map: Map<string, T>, id: string, value: T, kind: string): void {
  if (map.has(id)) throw registryError(`Duplicate ${kind} ID '${id}'.`);
  map.set(id, value);
}

function safeEntry(entry: string, packDirectory: string): string {
  if (/%(?:2e|2f|5c)/i.test(entry)) {
    throw registryError("Encoded traversal or separator characters are not allowed in component entries.", [entry]);
  }
  let portable: string;
  try {
    portable = normalizePortablePath(entry);
  } catch (error) {
    throw registryError("Component entry is not a safe portable path.", [entry], error);
  }
  if (portable === ".") throw registryError("A component entry must name a file.", [entry]);
  return resolveInsideRoot(packDirectory, portable);
}

async function loadEntries(packDirectory: string, manifest: PackManifest): Promise<ReadonlyMap<string, LoadedEntry>> {
  const entries = new Map<string, LoadedEntry>();
  const canonicalPackDirectory = await realpath(packDirectory);

  for (const component of manifest.components) {
    const candidate = safeEntry(component.entry, canonicalPackDirectory);
    let stats;
    try {
      stats = await lstat(candidate);
    } catch (error) {
      throw registryError(`Component entry '${component.entry}' does not exist.`, [candidate], error);
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw registryError(`Component entry '${component.entry}' must be a regular file.`, [candidate]);
    }

    const canonicalEntry = await realpath(candidate);
    const relative = path.relative(canonicalPackDirectory, canonicalEntry);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw registryError(`Component entry '${component.entry}' escapes its pack directory.`, [candidate]);
    }
    const source = await readFile(canonicalEntry, "utf8");
    entries.set(component.id, { sourcePath: canonicalEntry, sha256: sha256Text(source) });
  }

  return entries;
}

export async function loadRegistry(root: string): Promise<RegistrySnapshot> {
  const canonicalRoot = await realpath(path.resolve(root)).catch((error: unknown) => {
    throw registryError(`Registry root '${root}' does not exist.`, [root], error);
  });
  const schemaRoot = path.join(canonicalRoot, "schemas");
  const [validatePack, validateProfile, validateSources] = await Promise.all([
    compileSchema(schemaRoot, "pack.schema.json"),
    compileSchema(schemaRoot, "profile.schema.json"),
    compileSchema(schemaRoot, "source-catalog.schema.json"),
  ]);

  const profiles = new Map<string, ProfileManifest>();
  for (const filePath of await yamlFiles(path.join(canonicalRoot, "profiles"))) {
    const profile = requireValid<ProfileManifest>(validateProfile, await readYaml(filePath), filePath);
    ensureUnique(profiles, profile.id, profile, "profile");
  }

  const packs = new Map<string, LoadedPack>();
  let packDirectories;
  try {
    packDirectories = (await readdir(path.join(canonicalRoot, "packs"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
  } catch (error) {
    throw registryError("Unable to enumerate registry packs.", [path.join(canonicalRoot, "packs")], error);
  }

  for (const directoryEntry of packDirectories) {
    const directory = path.join(canonicalRoot, "packs", directoryEntry.name);
    const manifestPath = path.join(directory, "pack.yaml");
    const manifest = requireValid<PackManifest>(validatePack, await readYaml(manifestPath), manifestPath);
    if (manifest.id !== directoryEntry.name) {
      throw registryError(`Pack ID '${manifest.id}' does not match directory '${directoryEntry.name}'.`, [manifestPath]);
    }
    const entries = await loadEntries(directory, manifest);
    ensureUnique(packs, manifest.id, { directory, manifest, entries }, "pack");
  }

  const catalogPath = path.join(canonicalRoot, "sources", "catalog.yaml");
  const catalog = requireValid<SourceCatalogDocument>(validateSources, await readYaml(catalogPath), catalogPath);
  const sources = new Map<string, SourceRecord>();
  for (const source of [...catalog.sources].sort((left, right) => left.id.localeCompare(right.id, "en"))) {
    ensureUnique(sources, source.id, source, "source");
  }

  for (const loadedPack of packs.values()) {
    const provenance = loadedPack.manifest.provenance;
    if (provenance.mode !== "original" && (provenance.sourceId === undefined || !sources.has(provenance.sourceId))) {
      throw registryError(`Pack '${loadedPack.manifest.id}' references missing source metadata.`);
    }
  }

  return { root: canonicalRoot, profiles, packs, sources };
}
