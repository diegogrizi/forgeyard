import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { PackManifest, SourceRecord } from "../core/contracts.js";
import type { VendorAttestation, VendorTreeSummary } from "./vendor-catalog.js";

const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const UNKNOWN_LICENSES = new Set(["", "UNKNOWN", "NOASSERTION", "NONE", "UNLICENSED"]);

export interface PackageManifestDocument {
  name: string;
  version: string;
  license: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface SourceCatalogDocument {
  schemaVersion: 1;
  sources: SourceRecord[];
}

export interface InstalledPackageMetadata {
  name: string;
  version: string;
  license?: string;
  repository?: string;
  homepage?: string;
}

export interface LockPackageRecord {
  name?: string;
  version: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dev?: boolean;
  optional?: boolean;
}

export interface PackageLockDocument {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, LockPackageRecord>;
}

export interface ProvenanceValidationInput {
  packageManifest: PackageManifestDocument;
  packageLock?: PackageLockDocument;
  catalog: SourceCatalogDocument;
  packs: PackManifest[];
  installedPackages: InstalledPackageMetadata[];
  vendoredSources?: readonly VendoredSourceMetadata[];
}

export interface ProvenanceWorkspace extends ProvenanceValidationInput {
  packageLock: PackageLockDocument;
  installedByPath: ReadonlyMap<string, InstalledPackageMetadata>;
}

export interface ValidatedProvenance {
  directDependencies: readonly SourceRecord[];
  referencedSourceIds: readonly string[];
  vendoredSources: readonly VendoredSourceMetadata[];
}

export interface VendoredSourceMetadata {
  packId: string;
  sourceId: string;
  licenseRelativePath: string;
  attestation: VendorAttestation;
  summary: VendorTreeSummary;
}

export class ProvenanceValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("Forgeyard provenance validation failed.");
    this.name = "ProvenanceValidationError";
    this.issues = issues;
  }
}

function knownLicense(value: unknown): value is string {
  return typeof value === "string" && !UNKNOWN_LICENSES.has(value.trim().toLocaleUpperCase("en-US"));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeRepositoryUrl(value: string): string | undefined {
  let candidate = value.trim();
  if (/^[^/:\s]+\/[^/\s]+$/.test(candidate)) candidate = `https://github.com/${candidate}`;
  if (candidate.startsWith("github:")) candidate = `https://github.com/${candidate.slice("github:".length)}`;
  candidate = candidate.replace(/^git\+/, "").replace(/^git:\/\//, "https://");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return undefined;
    const pathname = url.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
    return `${url.protocol}//${url.hostname.toLocaleLowerCase("en-US")}${pathname}`.toLocaleLowerCase("en-US");
  } catch {
    return undefined;
  }
}

function directVersions(manifest: PackageManifestDocument): Map<string, string> {
  return new Map(
    [...Object.entries(manifest.dependencies ?? {}), ...Object.entries(manifest.devDependencies ?? {})]
      .sort(([left], [right]) => left.localeCompare(right, "en")),
  );
}

export function validateProvenance(input: ProvenanceValidationInput): ValidatedProvenance {
  const issues: string[] = [];
  const referenced = new Set<string>();
  const sourceById = new Map<string, SourceRecord>();
  const ids = new Set<string>();
  const sourceIdentities = new Map<string, string>();

  if (!knownLicense(input.packageManifest.license)) issues.push("Root package license is missing or unknown.");
  if (input.packageLock !== undefined) {
    const lockRoot = input.packageLock.packages[""];
    if (
      input.packageLock.name !== input.packageManifest.name
      || input.packageLock.version !== input.packageManifest.version
      || lockRoot?.name !== input.packageManifest.name
      || lockRoot.version !== input.packageManifest.version
    ) issues.push("Root package metadata does not match package-lock.json.");
    if (lockRoot !== undefined && lockRoot.license !== input.packageManifest.license) {
      issues.push("Root package license does not match package-lock.json.");
    }
  }

  for (const source of input.catalog.sources) {
    if (ids.has(source.id)) issues.push(`Catalog has duplicate source ID '${source.id}'.`);
    ids.add(source.id);
    sourceById.set(source.id, source);
    if (normalizeRepositoryUrl(source.url) === undefined || !source.url.startsWith("https://")) {
      issues.push(`Source '${source.id}' must use a valid HTTPS source URL.`);
    }
    const identity = `${source.name.normalize("NFKC").toLocaleLowerCase("en-US")}\0${normalizeRepositoryUrl(source.url) ?? source.url}\0${source.revision}`;
    const existingIdentity = sourceIdentities.get(identity);
    if (existingIdentity !== undefined) {
      issues.push(`Catalog has duplicate source identity '${existingIdentity}' and '${source.id}'.`);
    } else {
      sourceIdentities.set(identity, source.id);
    }
    if (!knownLicense(source.license)) issues.push(`Source '${source.id}' has missing or unknown license metadata.`);
    if (!validDate(source.retrievedAt)) issues.push(`Source '${source.id}' has an invalid retrieval date.`);
    if (source.notes.trim().length === 0) issues.push(`Source '${source.id}' must include notes.`);
  }

  const direct: SourceRecord[] = [];
  for (const [name, version] of directVersions(input.packageManifest)) {
    if (!EXACT_VERSION.test(version)) issues.push(`Direct dependency '${name}' is not pinned to an exact version.`);
    const locked = input.packageLock?.packages[`node_modules/${name}`];
    if (input.packageLock !== undefined && locked?.version !== version) {
      issues.push(`Direct dependency '${name}' version does not match package-lock.json.`);
    }
    const records = input.catalog.sources.filter((source) => source.name === name && source.provenance === "dependency");
    if (records.length !== 1) {
      issues.push(`Direct dependency '${name}' must have exactly one dependency catalog record.`);
      for (const record of records) referenced.add(record.id);
      continue;
    }
    const record = records[0]!;
    direct.push(record);
    referenced.add(record.id);
    if (record.revision !== version) issues.push(`Direct dependency '${name}' catalog version does not match package.json.`);

    const installed = input.installedPackages.filter((entry) => entry.name === name);
    if (installed.length !== 1) {
      issues.push(`Direct dependency '${name}' must have exactly one installed metadata record.`);
      continue;
    }
    const metadata = installed[0]!;
    if (metadata.version !== version) issues.push(`Direct dependency '${name}' installed version does not match package.json.`);
    if (!knownLicense(metadata.license) || record.license !== metadata.license) {
      issues.push(`Direct dependency '${name}' catalog license does not match installed metadata.`);
    }
    const catalogUrl = normalizeRepositoryUrl(record.url);
    const installedUrl = metadata.repository === undefined ? undefined : normalizeRepositoryUrl(metadata.repository);
    if (catalogUrl === undefined || installedUrl === undefined || catalogUrl !== installedUrl) {
      issues.push(`Direct dependency '${name}' source URL does not match installed metadata.`);
    }
  }

  for (const pack of input.packs) {
    if (!knownLicense(pack.license)) issues.push(`Pack '${pack.id}' has missing or unknown license metadata.`);
    const { mode, sourceId } = pack.provenance;
    if (mode === "original") {
      if (sourceId !== undefined) issues.push(`Original pack '${pack.id}' must not declare sourceId.`);
      continue;
    }
    if (sourceId === undefined) {
      issues.push(`Non-original pack '${pack.id}' must declare sourceId.`);
      continue;
    }
    referenced.add(sourceId);
    const source = sourceById.get(sourceId);
    if (source === undefined) issues.push(`Non-original pack '${pack.id}' references unknown source '${sourceId}'.`);
    else if (source.provenance !== mode) {
      issues.push(`Non-original pack '${pack.id}' provenance mode does not match source '${sourceId}'.`);
    }
  }

  const vendoredSources = [...(input.vendoredSources ?? [])]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
  const vendorPackIds = new Set<string>();
  const vendorSourceIds = new Set<string>();
  for (const vendor of vendoredSources) {
    if (vendorPackIds.has(vendor.packId)) issues.push(`Vendored pack '${vendor.packId}' has duplicate attestations.`);
    if (vendorSourceIds.has(vendor.sourceId)) issues.push(`Vendored source '${vendor.sourceId}' has duplicate attestations.`);
    vendorPackIds.add(vendor.packId);
    vendorSourceIds.add(vendor.sourceId);
    const pack = input.packs.find((candidate) => candidate.id === vendor.packId);
    const source = sourceById.get(vendor.sourceId);
    if (pack?.provenance.mode !== "vendored-unmodified" || pack.provenance.sourceId !== vendor.sourceId) {
      issues.push(`Vendor attestation for '${vendor.packId}' does not match its pack provenance.`);
    }
    if (
      source === undefined ||
      normalizeRepositoryUrl(source.url) !== normalizeRepositoryUrl(vendor.attestation.source) ||
      source.revision !== vendor.attestation.revision ||
      source.license !== vendor.attestation.license
    ) {
      issues.push(`Vendor attestation for '${vendor.sourceId}' does not match its source catalog record.`);
    }
    for (const field of ["fileCount", "physicalLines", "bytes", "treeSha256", "licenseSha256"] as const) {
      if (vendor.attestation[field] !== vendor.summary[field]) {
        issues.push(`Vendor attestation field '${field}' does not match verified content for '${vendor.sourceId}'.`);
      }
    }
    if (!vendor.licenseRelativePath.endsWith("/LICENSE")) {
      issues.push(`Vendored source '${vendor.sourceId}' does not identify a preserved license notice.`);
    }
  }
  if (input.vendoredSources !== undefined) {
    for (const pack of input.packs.filter((candidate) => candidate.provenance.mode === "vendored-unmodified")) {
      if (!vendorPackIds.has(pack.id)) issues.push(`Vendored pack '${pack.id}' is missing a verified attestation.`);
    }
  }

  for (const source of input.catalog.sources) {
    if (!referenced.has(source.id)) issues.push(`Catalog source '${source.id}' is not referenced by a package or component.`);
  }

  if (issues.length > 0) {
    throw new ProvenanceValidationError([...new Set(issues)].sort((left, right) => left.localeCompare(right, "en")));
  }
  return {
    directDependencies: direct.sort((left, right) => left.name.localeCompare(right.name, "en")),
    referencedSourceIds: [...referenced].sort((left, right) => left.localeCompare(right, "en")),
    vendoredSources,
  };
}

function packageNameFromPath(lockPath: string): string {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  const tail = (index < 0 ? lockPath : lockPath.slice(index + marker.length)).split("/");
  return tail[0]?.startsWith("@") ? `${tail[0]}/${tail[1]}` : tail[0] ?? lockPath;
}

function repositoryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const url = (value as Record<string, unknown>).url;
    return typeof url === "string" ? url : undefined;
  }
  return undefined;
}

async function installedMetadata(filePath: string): Promise<InstalledPackageMetadata | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    if (typeof value.name !== "string" || typeof value.version !== "string") return undefined;
    return {
      name: value.name,
      version: value.version,
      ...(typeof value.license === "string" ? { license: value.license } : {}),
      ...(repositoryValue(value.repository) === undefined ? {} : { repository: repositoryValue(value.repository)! }),
      ...(typeof value.homepage === "string" ? { homepage: value.homepage } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadProvenanceWorkspace(root: string): Promise<ProvenanceWorkspace> {
  const absoluteRoot = path.resolve(root);
  const [packageManifest, rawLock, catalog, packDirectories] = await Promise.all([
    readFile(path.join(absoluteRoot, "package.json"), "utf8").then((source) => JSON.parse(source) as PackageManifestDocument),
    readFile(path.join(absoluteRoot, "package-lock.json"), "utf8").then((source) => JSON.parse(source) as PackageLockDocument),
    readFile(path.join(absoluteRoot, "sources", "catalog.yaml"), "utf8").then(
      (source) => parseYaml(source) as SourceCatalogDocument,
    ),
    readdir(path.join(absoluteRoot, "packs"), { withFileTypes: true }),
  ]);
  const loadedPacks = await Promise.all(
    packDirectories
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map(async (entry) => ({
        directory: path.join(absoluteRoot, "packs", entry.name),
        manifest: await readFile(path.join(absoluteRoot, "packs", entry.name, "pack.yaml"), "utf8")
          .then((source) => parseYaml(source) as PackManifest),
      })),
  );
  const packs = loadedPacks.map((entry) => entry.manifest);
  const packageLock: PackageLockDocument = {
    ...rawLock,
    packages: Object.fromEntries(Object.entries(rawLock.packages).map(([lockPath, record]) => [
      lockPath,
      lockPath === ""
        ? { ...record, name: record.name ?? packageManifest.name }
        : { ...record, name: record.name ?? packageNameFromPath(lockPath) },
    ])),
  };
  const installedByPath = new Map<string, InstalledPackageMetadata>();
  await Promise.all(Object.keys(packageLock.packages).map(async (lockPath) => {
    const metadata = await installedMetadata(path.join(absoluteRoot, ...lockPath.split("/").filter(Boolean), "package.json"));
    if (metadata !== undefined) installedByPath.set(lockPath, metadata);
  }));
  const installedPackages = [...directVersions(packageManifest).keys()]
    .map((name) => installedByPath.get(`node_modules/${name}`))
    .filter((entry): entry is InstalledPackageMetadata => entry !== undefined);

  const { readVendorAttestation, verifyVendorTree } = await import("./vendor-catalog.js");
  const vendoredSources: VendoredSourceMetadata[] = [];
  for (const loaded of loadedPacks.filter((entry) => entry.manifest.provenance.mode === "vendored-unmodified")) {
    const sourceId = loaded.manifest.provenance.sourceId;
    const trees = loaded.manifest.components.filter((component) => component.entryType === "tree");
    if (sourceId === undefined || trees.length !== 1) {
      throw new ProvenanceValidationError([
        `Vendored pack '${loaded.manifest.id}' must declare one source and one attested tree component.`,
      ]);
    }
    const vendorRoot = path.join(loaded.directory, trees[0]!.entry);
    const attestation = await readVendorAttestation(path.join(vendorRoot, "UPSTREAM.json"));
    const summary = await verifyVendorTree(vendorRoot, attestation);
    vendoredSources.push({
      packId: loaded.manifest.id,
      sourceId,
      licenseRelativePath: path.relative(absoluteRoot, path.join(vendorRoot, "LICENSE")).replaceAll("\\", "/"),
      attestation,
      summary,
    });
  }

  return { packageManifest, packageLock, catalog, packs, installedPackages, installedByPath, vendoredSources };
}
