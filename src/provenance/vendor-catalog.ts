import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256Bytes, sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { ProvenanceValidationError } from "./validate.js";

export interface VendorAttestation {
  schemaVersion: 1;
  source: string;
  revision: string;
  license: string;
  contentRoot: string;
  fileCount: number;
  physicalLines: number;
  bytes: number;
  treeSha256: string;
  licenseSha256: string;
}

export interface VendorTreeSummary {
  ok: true;
  fileCount: number;
  physicalLines: number;
  bytes: number;
  treeSha256: string;
  licenseSha256: string;
}

interface VendorFile {
  relativePath: string;
  sha256: string;
  bytes: number;
  physicalLines: number;
}

function physicalLines(bytes: Uint8Array): number {
  if (bytes.byteLength === 0) return 0;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return 0;
  }
  const newlines = text.match(/\n/g)?.length ?? 0;
  return newlines + (text.endsWith("\n") ? 0 : 1);
}

function canonicalRepositoryBytes(bytes: Uint8Array): Uint8Array {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return new TextEncoder().encode(text.replaceAll("\r\n", "\n"));
  } catch {
    return bytes;
  }
}

function requireAttestation(value: unknown, filePath: string): VendorAttestation {
  const record = value as Partial<VendorAttestation> | null;
  const issues: string[] = [];
  if (record === null || typeof record !== "object") {
    throw new ProvenanceValidationError([`Vendor attestation '${filePath}' must be a JSON object.`]);
  }
  if (record.schemaVersion !== 1) issues.push("Vendor attestation schemaVersion must equal 1.");
  for (const field of ["source", "revision", "license", "contentRoot", "treeSha256", "licenseSha256"] as const) {
    if (typeof record[field] !== "string" || record[field]?.length === 0) {
      issues.push(`Vendor attestation field '${field}' must be a non-empty string.`);
    }
  }
  for (const field of ["fileCount", "physicalLines", "bytes"] as const) {
    if (!Number.isSafeInteger(record[field]) || (record[field] ?? -1) < 0) {
      issues.push(`Vendor attestation field '${field}' must be a non-negative safe integer.`);
    }
  }
  if (!/^https:\/\//.test(record.source ?? "")) issues.push("Vendor attestation source must use HTTPS.");
  if (!/^[0-9a-f]{40}$/.test(record.revision ?? "")) issues.push("Vendor attestation revision must be a full Git SHA-1.");
  if (!/^[0-9a-f]{64}$/.test(record.treeSha256 ?? "")) issues.push("Vendor tree SHA-256 is invalid.");
  if (!/^[0-9a-f]{64}$/.test(record.licenseSha256 ?? "")) issues.push("Vendor license SHA-256 is invalid.");
  if (issues.length > 0) throw new ProvenanceValidationError(issues);
  return record as VendorAttestation;
}

export async function readVendorAttestation(filePath: string): Promise<VendorAttestation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new ProvenanceValidationError([
      `Unable to read vendor attestation '${filePath}': ${error instanceof Error ? error.message : "unknown error"}`,
    ]);
  }
  return requireAttestation(parsed, filePath);
}

async function inventoryTree(root: string): Promise<readonly VendorFile[]> {
  const canonicalRoot = await realpath(root);
  const files: VendorFile[] = [];

  async function walk(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw new ProvenanceValidationError([`Vendor trees may not contain symbolic links: ${candidate}`]);
      }
      const relativePath = normalizePortablePath(
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`,
      );
      if (stats.isDirectory()) {
        const canonicalDirectory = await realpath(candidate);
        const relative = path.relative(canonicalRoot, canonicalDirectory);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new ProvenanceValidationError([`Vendor directory escapes the content root: ${candidate}`]);
        }
        await walk(canonicalDirectory, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new ProvenanceValidationError([`Vendor tree entry is not a regular file: ${candidate}`]);
      }
      const bytes = canonicalRepositoryBytes(await readFile(candidate));
      files.push({
        relativePath,
        sha256: sha256Bytes(bytes),
        bytes: bytes.byteLength,
        physicalLines: physicalLines(bytes),
      });
    }
  }

  await walk(canonicalRoot, "");
  assertNoCaseCollisions(files.map((file) => file.relativePath));
  return files;
}

export async function summarizeVendorTree(vendorRoot: string, contentRoot = "plugins"): Promise<VendorTreeSummary> {
  const portableContentRoot = normalizePortablePath(contentRoot);
  const contentPath = resolveInsideRoot(vendorRoot, portableContentRoot);
  const files = await inventoryTree(contentPath);
  const licenseBytes = canonicalRepositoryBytes(await readFile(resolveInsideRoot(vendorRoot, "LICENSE")));
  return {
    ok: true,
    fileCount: files.length,
    physicalLines: files.reduce((sum, file) => sum + file.physicalLines, 0),
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    treeSha256: sha256Text(files.map((file) => `${file.relativePath}\0${file.sha256}\n`).join("")),
    licenseSha256: sha256Bytes(licenseBytes),
  };
}

export async function verifyVendorTree(
  vendorRoot: string,
  attestation: VendorAttestation,
): Promise<VendorTreeSummary> {
  const summary = await summarizeVendorTree(vendorRoot, attestation.contentRoot);
  const issues: string[] = [];
  for (const field of ["fileCount", "physicalLines", "bytes", "treeSha256", "licenseSha256"] as const) {
    if (summary[field] !== attestation[field]) {
      issues.push(`Vendor ${field} mismatch: expected ${attestation[field]}, observed ${summary[field]}.`);
    }
  }
  if (issues.length > 0) throw new ProvenanceValidationError(issues);
  return summary;
}
