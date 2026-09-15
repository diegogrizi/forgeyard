import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

import { Ajv, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";

import type { ProfileId } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";

const readFileAsync = promisify(readFile);

export interface InstalledFileRecord {
  path: string;
  componentId: string;
  ownership: "managed" | "seed";
  installedSha256: string;
  operationId: string;
}

export interface InstallManifest {
  schemaVersion: 1;
  forgeyardVersion: string;
  profile: ProfileId;
  adapter: "codex";
  latestOperationId: string;
  files: readonly InstalledFileRecord[];
}

export interface JournalEntry {
  path: string;
  action: "create" | "replace" | "delete" | "preserve" | "unchanged";
  ownership: "managed" | "seed";
  preSha256?: string;
  postSha256?: string;
  backupPath?: string;
}

export interface OperationJournal {
  schemaVersion: 1;
  operationId: string;
  kind: "install" | "update" | "rollback";
  status: "prepared" | "completed" | "recovered" | "recovery-failed";
  entries: readonly JournalEntry[];
  recoveryPaths: readonly string[];
  manifestBackupPath?: string;
  sourceOperationId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOperationJournal(source: string, sourcePath: string): OperationJournal {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw metadataError(`Operation journal '${sourcePath}' is not valid JSON.`, [sourcePath], error);
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.operationId !== "string" ||
    !["install", "update", "rollback"].includes(String(value.kind)) ||
    !["prepared", "completed", "recovered", "recovery-failed"].includes(String(value.status)) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.recoveryPaths)
  ) {
    throw metadataError(`Operation journal '${sourcePath}' has an invalid structure.`, [sourcePath]);
  }
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !["create", "replace", "delete", "preserve", "unchanged"].includes(String(entry.action)) ||
      !["managed", "seed"].includes(String(entry.ownership))
    ) {
      throw metadataError(`Operation journal '${sourcePath}' has an invalid entry.`, [sourcePath]);
    }
    normalizePortablePath(entry.path);
    if (entry.backupPath !== undefined && typeof entry.backupPath !== "string") {
      throw metadataError(`Operation journal '${sourcePath}' has an invalid backup path.`, [sourcePath]);
    }
  }
  return value as unknown as OperationJournal;
}

let validateManifest: ValidateFunction | undefined;

function metadataError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Restore or regenerate the Forgeyard install manifest.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function validator(): ValidateFunction {
  if (validateManifest !== undefined) return validateManifest;
  const url = new URL("../../schemas/install-manifest.schema.json", import.meta.url);
  const schemaPath = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false });
  formatsModule.default.default(ajv);
  const compiled = ajv.compile(schema);
  validateManifest = compiled;
  return compiled;
}

export function serializeInstallManifest(manifest: InstallManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseInstallManifest(source: string, sourcePath: string): InstallManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw metadataError(`Install manifest '${sourcePath}' is not valid JSON.`, [sourcePath], error);
  }
  const validate = validator();
  if (!validate(value)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("; ");
    throw metadataError(`Install manifest '${sourcePath}' failed schema validation: ${detail}`, [sourcePath]);
  }

  const manifest = value as InstallManifest;
  const normalized = manifest.files.map((record) => normalizePortablePath(record.path));
  if (normalized.some((entry, index) => entry !== manifest.files[index]!.path)) {
    throw metadataError(`Install manifest '${sourcePath}' contains a non-normalized path.`, [sourcePath]);
  }
  try {
    assertNoCaseCollisions(normalized);
  } catch (error) {
    throw metadataError(`Install manifest '${sourcePath}' contains colliding paths.`, [sourcePath], error);
  }
  return manifest;
}

export async function loadInstallManifest(root: string): Promise<InstallManifest> {
  const manifestPath = path.join(root, ".forgeyard", "manifest.json");
  let source: string;
  try {
    source = await readFileAsync(manifestPath, "utf8") as string;
  } catch (error) {
    throw metadataError(`Unable to read install manifest '${manifestPath}'.`, [manifestPath], error);
  }
  return parseInstallManifest(source, manifestPath);
}
