import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import type { InstallPlan, PlannedFile } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import {
  type InstallManifest,
  type InstalledFileRecord,
  type OperationJournal,
  parseInstallManifest,
  serializeInstallManifest,
} from "./manifest.js";

export interface FileSystemPort {
  lstat(filePath: string): Promise<Stats>;
  realpath(filePath: string): Promise<string>;
  readFile(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, content: string | Uint8Array): Promise<void>;
  mkdir(directory: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  rm(filePath: string, options: { force: boolean; recursive: boolean }): Promise<void>;
}

export const nodeFileSystem: FileSystemPort = {
  lstat: (filePath) => fs.lstat(filePath),
  realpath: (filePath) => fs.realpath(filePath),
  readFile: (filePath) => fs.readFile(filePath),
  writeFile: async (filePath, content) => {
    await fs.writeFile(filePath, content);
  },
  mkdir: async (directory) => {
    await fs.mkdir(directory, { recursive: true });
  },
  rename: async (source, destination) => {
    await fs.rename(source, destination);
  },
  rm: async (filePath, options) => {
    await fs.rm(filePath, options);
  },
};

export type InstallAction = "create" | "unchanged" | "preserve";

export interface InspectedFile {
  planned: PlannedFile;
  action: InstallAction;
  currentSha256?: string;
}

export interface InstallInspection {
  manifest?: InstallManifest;
  files: readonly InspectedFile[];
}

export interface ApplyOptions {
  dryRun?: boolean;
  fileSystem?: FileSystemPort;
}

export interface OperationResult {
  operationId: string;
  applied: boolean;
  created: readonly string[];
  unchanged: readonly string[];
  preserved: readonly string[];
}

function pathError(message: string, paths: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_PATH_UNSAFE",
    message,
    remediation: "Use regular files and directories confined to the selected project root.",
    exitCode: 4,
    paths,
    ...(cause === undefined ? {} : { cause }),
  });
}

function ownershipError(paths: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_OWNERSHIP_CONFLICT",
    message: "Forgeyard would replace an unknown or locally modified file.",
    remediation: "Move the file, restore its installed hash, or reconcile it explicitly before retrying.",
    exitCode: 4,
    paths,
  });
}

function transactionError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_TRANSACTION_FAILED",
    message,
    remediation: "Inspect the retained operation journal and recovery paths before retrying.",
    exitCode: 5,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function maybeStat(fileSystem: FileSystemPort, filePath: string): Promise<Stats | undefined> {
  try {
    return await fileSystem.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw pathError("Unable to inspect a destination path.", [filePath], error);
  }
}

async function assertSafeDestination(
  fileSystem: FileSystemPort,
  root: string,
  relativePath: string,
): Promise<string> {
  const destination = resolveInsideRoot(root, relativePath);
  const rootStats = await maybeStat(fileSystem, root);
  if (rootStats !== undefined && (rootStats.isSymbolicLink() || !rootStats.isDirectory())) {
    throw pathError("The selected project root is not a regular directory.", [root]);
  }

  let current = root;
  const segments = normalizePortablePath(relativePath).split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    const stats = await maybeStat(fileSystem, current);
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) throw pathError("A destination path crosses a symbolic link or junction.", [relativePath]);
    const isDestination = index === segments.length - 1;
    if ((!isDestination && !stats.isDirectory()) || (isDestination && !stats.isFile())) {
      throw pathError("A destination path has an incompatible filesystem object.", [relativePath]);
    }
  }
  return destination;
}

async function optionalManifest(
  root: string,
  fileSystem: FileSystemPort,
): Promise<{ manifest?: InstallManifest; source?: Buffer }> {
  const manifestPath = path.join(root, ".forgeyard", "manifest.json");
  const stats = await maybeStat(fileSystem, manifestPath);
  if (stats === undefined) return {};
  if (stats.isSymbolicLink() || !stats.isFile()) throw pathError("Install manifest is not a regular file.", [manifestPath]);
  const source = await fileSystem.readFile(manifestPath);
  return { manifest: parseInstallManifest(source.toString("utf8"), manifestPath), source };
}

function validatePlanShape(plan: InstallPlan): void {
  if (!path.isAbsolute(plan.targetRoot)) throw pathError("Install plan root must be absolute.", [plan.targetRoot]);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/.test(plan.operationId)) {
    throw pathError("Operation ID is unsafe for local state paths.", [plan.operationId]);
  }
  assertNoCaseCollisions(plan.files.map((file) => file.path));
  for (const file of plan.files) {
    if (normalizePortablePath(file.path) !== file.path) {
      throw pathError("Install plan contains a non-normalized path.", [file.path]);
    }
    if (sha256Text(file.content) !== file.sha256) {
      throw new ForgeyardError({
        code: "FY_REGISTRY_INVALID",
        message: `Planned content hash does not match '${file.path}'.`,
        remediation: "Re-render the install plan.",
        exitCode: 3,
        paths: [file.path],
      });
    }
  }
}

export async function inspectInstallPlan(
  plan: InstallPlan,
  fileSystem: FileSystemPort = nodeFileSystem,
): Promise<InstallInspection> {
  validatePlanShape(plan);
  for (const file of plan.files) await assertSafeDestination(fileSystem, plan.targetRoot, file.path);
  await assertSafeDestination(fileSystem, plan.targetRoot, ".forgeyard/manifest.json");

  const prior = await optionalManifest(plan.targetRoot, fileSystem);
  const records = new Map(prior.manifest?.files.map((record) => [record.path, record]) ?? []);
  const inspected: InspectedFile[] = [];
  const conflicts: string[] = [];

  for (const file of plan.files) {
    const destination = resolveInsideRoot(plan.targetRoot, file.path);
    const stats = await maybeStat(fileSystem, destination);
    const record = records.get(file.path);
    if (stats === undefined) {
      if (record !== undefined && record.ownership === "managed") conflicts.push(file.path);
      else inspected.push({ planned: file, action: "create" });
      continue;
    }
    const currentSha256 = digest(await fileSystem.readFile(destination));

    if (file.ownership === "seed") {
      if (record !== undefined && currentSha256 === record.installedSha256 && currentSha256 === file.sha256) {
        inspected.push({ planned: file, action: "unchanged", currentSha256 });
      } else {
        inspected.push({ planned: file, action: "preserve", currentSha256 });
      }
      continue;
    }

    if (record === undefined || record.ownership !== "managed") {
      conflicts.push(file.path);
    } else if (currentSha256 !== record.installedSha256 || file.sha256 !== record.installedSha256) {
      conflicts.push(file.path);
    } else {
      inspected.push({ planned: file, action: "unchanged", currentSha256 });
    }
  }

  if (conflicts.length > 0) throw ownershipError(conflicts.sort((left, right) => left.localeCompare(right, "en")));
  return { ...(prior.manifest === undefined ? {} : { manifest: prior.manifest }), files: inspected };
}

function journalText(journal: OperationJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

async function writeJournal(
  fileSystem: FileSystemPort,
  journalPath: string,
  journal: OperationJournal,
): Promise<void> {
  await fileSystem.mkdir(path.dirname(journalPath));
  await fileSystem.writeFile(journalPath, journalText(journal));
}

function resultFromInspection(plan: InstallPlan, inspection: InstallInspection, applied: boolean): OperationResult {
  return {
    operationId: plan.operationId,
    applied,
    created: inspection.files.filter((file) => file.action === "create").map((file) => file.planned.path),
    unchanged: inspection.files.filter((file) => file.action === "unchanged").map((file) => file.planned.path),
    preserved: inspection.files.filter((file) => file.action === "preserve").map((file) => file.planned.path),
  };
}

export async function applyInstallPlan(
  plan: InstallPlan,
  options: ApplyOptions = {},
): Promise<OperationResult> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const inspection = await inspectInstallPlan(plan, fileSystem);
  const creations = inspection.files.filter((file) => file.action === "create");
  if (options.dryRun || creations.length === 0) return resultFromInspection(plan, inspection, false);

  await fileSystem.mkdir(plan.targetRoot);
  const stateRoot = path.join(plan.targetRoot, ".forgeyard", "state");
  const stagingRoot = path.join(stateRoot, "staging", plan.operationId);
  const journalPath = path.join(stateRoot, "operations", `${plan.operationId}.json`);
  const manifestPath = path.join(plan.targetRoot, ".forgeyard", "manifest.json");
  const moved: string[] = [];
  let manifestWritten = false;
  let priorManifestSource: Buffer | undefined;

  const prepared: OperationJournal = {
    schemaVersion: 1,
    operationId: plan.operationId,
    kind: "install",
    status: "prepared",
    entries: inspection.files.map((file) => {
      const postSha256 = file.action === "preserve" ? file.currentSha256 : file.planned.sha256;
      return {
        path: file.planned.path,
        action: file.action,
        ...(file.currentSha256 === undefined ? {} : { preSha256: file.currentSha256 }),
        ...(postSha256 === undefined ? {} : { postSha256 }),
      };
    }),
    recoveryPaths: [],
  };

  try {
    await fileSystem.mkdir(stagingRoot);
    for (const item of creations) {
      const staged = resolveInsideRoot(stagingRoot, item.planned.path);
      await fileSystem.mkdir(path.dirname(staged));
      await fileSystem.writeFile(staged, item.planned.content);
    }
    for (const item of creations) {
      const staged = resolveInsideRoot(stagingRoot, item.planned.path);
      const actual = digest(await fileSystem.readFile(staged));
      if (actual !== item.planned.sha256) {
        throw transactionError("Staged content failed integrity validation.", [item.planned.path]);
      }
    }

    await writeJournal(fileSystem, journalPath, prepared);
    const priorManifest = await optionalManifest(plan.targetRoot, fileSystem);
    priorManifestSource = priorManifest.source;

    for (const item of creations) {
      const staged = resolveInsideRoot(stagingRoot, item.planned.path);
      const destination = resolveInsideRoot(plan.targetRoot, item.planned.path);
      await fileSystem.mkdir(path.dirname(destination));
      await fileSystem.rename(staged, destination);
      moved.push(destination);
    }

    const priorRecords = new Map(inspection.manifest?.files.map((record) => [record.path, record]) ?? []);
    const records: InstalledFileRecord[] = inspection.files.map((item) => {
      const prior = priorRecords.get(item.planned.path);
      if (item.action === "unchanged" && prior !== undefined) return prior;
      return {
        path: item.planned.path,
        componentId: item.planned.componentId,
        ownership: item.planned.ownership,
        installedSha256: item.action === "preserve" ? item.currentSha256! : item.planned.sha256,
        operationId: plan.operationId,
      };
    });
    const manifest: InstallManifest = {
      schemaVersion: 1,
      forgeyardVersion: JSON.parse(plan.files.find((file) => file.path === "forgeyard.lock")!.content).forgeyardVersion as string,
      profile: plan.profile,
      adapter: plan.adapter,
      latestOperationId: plan.operationId,
      files: records,
    };
    const stagedManifest = path.join(stagingRoot, "__manifest.json");
    await fileSystem.writeFile(stagedManifest, serializeInstallManifest(manifest));
    await fileSystem.mkdir(path.dirname(manifestPath));
    await fileSystem.rename(stagedManifest, manifestPath);
    manifestWritten = true;

    await writeJournal(fileSystem, journalPath, { ...prepared, status: "completed" });
    await fileSystem.rm(stagingRoot, { recursive: true, force: true });
    return resultFromInspection(plan, inspection, true);
  } catch (error) {
    const recoveryFailures: string[] = [];
    if (manifestWritten) {
      try {
        await fileSystem.rm(manifestPath, { recursive: false, force: true });
        if (priorManifestSource !== undefined) await fileSystem.writeFile(manifestPath, priorManifestSource);
      } catch {
        recoveryFailures.push(".forgeyard/manifest.json");
      }
    }
    for (const destination of [...moved].reverse()) {
      try {
        await fileSystem.rm(destination, { recursive: false, force: true });
      } catch {
        recoveryFailures.push(path.relative(plan.targetRoot, destination).replaceAll("\\", "/"));
      }
    }
    try {
      await fileSystem.rm(stagingRoot, { recursive: true, force: true });
    } catch {
      recoveryFailures.push(path.relative(plan.targetRoot, stagingRoot).replaceAll("\\", "/"));
    }
    try {
      await writeJournal(fileSystem, journalPath, {
        ...prepared,
        status: recoveryFailures.length === 0 ? "recovered" : "recovery-failed",
        recoveryPaths: recoveryFailures,
      });
    } catch {
      recoveryFailures.push(path.relative(plan.targetRoot, journalPath).replaceAll("\\", "/"));
    }
    throw transactionError(
      recoveryFailures.length === 0
        ? "Installation failed and the prior payload state was restored."
        : "Installation failed and recovery is incomplete.",
      recoveryFailures.length === 0 ? undefined : recoveryFailures,
      error,
    );
  }
}
