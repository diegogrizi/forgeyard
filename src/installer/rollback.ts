import path from "node:path";

import { resolveInsideRoot } from "../core/paths.js";
import {
  type ApplyOptions,
  type FileSystemPort,
  assertSafeDestination,
  digest,
  maybeStat,
  nodeFileSystem,
  optionalManifest,
  ownershipError,
  transactionError,
  writeJournal,
} from "./apply.js";
import {
  type InstallManifest,
  type OperationJournal,
  parseInstallManifest,
  parseOperationJournal,
  serializeInstallManifest,
} from "./manifest.js";

export interface RollbackAction {
  path: string;
  action: "remove" | "restore";
  preSha256: string;
  postSha256?: string;
  sourceBackupPath?: string;
  hadCurrent: boolean;
}

export interface RollbackPlan {
  operationId: string;
  sourceOperationId: string;
  targetRoot: string;
  sourceJournal: OperationJournal;
  currentManifest: InstallManifest;
  targetManifest: InstallManifest;
  actions: readonly RollbackAction[];
}

export interface RollbackResult {
  operationId: string;
  sourceOperationId: string;
  applied: boolean;
  removed: readonly string[];
  restored: readonly string[];
}

async function readJournal(
  root: string,
  operationId: string,
  fileSystem: FileSystemPort,
): Promise<OperationJournal> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/.test(operationId)) throw ownershipError([operationId]);
  const relative = `.forgeyard/state/operations/${operationId}.json`;
  const filePath = await assertSafeDestination(fileSystem, root, relative);
  const stats = await maybeStat(fileSystem, filePath);
  if (stats === undefined) throw ownershipError([relative]);
  return parseOperationJournal((await fileSystem.readFile(filePath)).toString("utf8"), filePath);
}

async function requiredBackup(
  fileSystem: FileSystemPort,
  root: string,
  relativePath: string,
  expectedSha256: string,
): Promise<void> {
  const filePath = await assertSafeDestination(fileSystem, root, relativePath);
  const stats = await maybeStat(fileSystem, filePath);
  if (stats === undefined || digest(await fileSystem.readFile(filePath)) !== expectedSha256) {
    throw transactionError("Rollback backup is missing or failed integrity validation.", [relativePath]);
  }
}

/**
 * The only reversible operation is the latest one, because planRollback refuses any other.
 * Resolving it here means a person does not have to find an identifier to undo the last
 * thing the factory did.
 */
export async function latestReversibleOperation(
  root: string,
  fileSystem: FileSystemPort = nodeFileSystem,
): Promise<string | null> {
  const current = await optionalManifest(path.resolve(root), fileSystem);
  return current.manifest?.latestOperationId ?? null;
}

export async function planRollback(
  root: string,
  sourceOperationId: string,
  fileSystem: FileSystemPort = nodeFileSystem,
): Promise<RollbackPlan> {
  const targetRoot = path.resolve(root);
  const operationId = `rollback-${sourceOperationId}`;
  const markerPath = path.join(targetRoot, ".forgeyard", "state", "operations", `${operationId}.json`);
  if ((await maybeStat(fileSystem, markerPath)) !== undefined) throw ownershipError([sourceOperationId]);

  const sourceJournal = await readJournal(targetRoot, sourceOperationId, fileSystem);
  if (sourceJournal.status !== "completed" || sourceJournal.kind === "rollback") {
    throw ownershipError([sourceOperationId]);
  }
  const current = await optionalManifest(targetRoot, fileSystem);
  if (current.manifest === undefined || current.manifest.latestOperationId !== sourceOperationId) {
    throw ownershipError([sourceOperationId]);
  }
  const currentManifest = current.manifest;
  const actions: RollbackAction[] = [];
  const conflicts: string[] = [];

  for (const entry of sourceJournal.entries) {
    if (entry.ownership === "seed" || entry.action === "unchanged" || entry.action === "preserve") continue;
    const destination = await assertSafeDestination(fileSystem, targetRoot, entry.path);
    const stats = await maybeStat(fileSystem, destination);
    const currentSha256 = stats === undefined ? undefined : digest(await fileSystem.readFile(destination));

    if (entry.action === "create") {
      if (entry.postSha256 === undefined || currentSha256 !== entry.postSha256) conflicts.push(entry.path);
      else actions.push({ path: entry.path, action: "remove", preSha256: currentSha256, hadCurrent: true });
      continue;
    }

    if (entry.preSha256 === undefined || entry.backupPath === undefined) {
      throw transactionError("Rollback journal lacks required preimage metadata.", [entry.path]);
    }
    await requiredBackup(fileSystem, targetRoot, entry.backupPath, entry.preSha256);
    if (entry.action === "replace") {
      if (entry.postSha256 === undefined || currentSha256 !== entry.postSha256) conflicts.push(entry.path);
      else {
        actions.push({
          path: entry.path,
          action: "restore",
          preSha256: entry.preSha256,
          postSha256: entry.postSha256,
          sourceBackupPath: entry.backupPath,
          hadCurrent: true,
        });
      }
    } else if (entry.action === "delete") {
      if (currentSha256 !== undefined) conflicts.push(entry.path);
      else {
        actions.push({
          path: entry.path,
          action: "restore",
          preSha256: entry.preSha256,
          sourceBackupPath: entry.backupPath,
          hadCurrent: false,
        });
      }
    }
  }

  if (conflicts.length > 0) throw ownershipError(conflicts.sort((a, b) => a.localeCompare(b, "en")));

  let restoredManifest: InstallManifest;
  if (sourceJournal.manifestBackupPath !== undefined) {
    const backupPath = await assertSafeDestination(fileSystem, targetRoot, sourceJournal.manifestBackupPath);
    const stats = await maybeStat(fileSystem, backupPath);
    if (stats === undefined) throw transactionError("Rollback manifest backup is missing.", [sourceJournal.manifestBackupPath]);
    restoredManifest = parseInstallManifest((await fileSystem.readFile(backupPath)).toString("utf8"), backupPath);
  } else {
    const removed = new Set(actions.filter((action) => action.action === "remove").map((action) => action.path));
    restoredManifest = { ...currentManifest, files: currentManifest.files.filter((record) => !removed.has(record.path)) };
  }
  const targetManifest: InstallManifest = { ...restoredManifest, latestOperationId: operationId };
  return { operationId, sourceOperationId, targetRoot, sourceJournal, currentManifest, targetManifest, actions };
}

function rollbackResult(plan: RollbackPlan, applied: boolean): RollbackResult {
  return {
    operationId: plan.operationId,
    sourceOperationId: plan.sourceOperationId,
    applied,
    removed: plan.actions.filter((action) => action.action === "remove").map((action) => action.path),
    restored: plan.actions.filter((action) => action.action === "restore").map((action) => action.path),
  };
}

export async function applyRollback(plan: RollbackPlan, options: ApplyOptions = {}): Promise<RollbackResult> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  if (options.dryRun) return rollbackResult(plan, false);

  const stateRoot = path.join(plan.targetRoot, ".forgeyard", "state");
  const stagingRoot = path.join(stateRoot, "staging", plan.operationId);
  const backupRoot = path.join(stateRoot, "backups", plan.operationId);
  const journalPath = path.join(stateRoot, "operations", `${plan.operationId}.json`);
  const manifestPath = path.join(plan.targetRoot, ".forgeyard", "manifest.json");
  const manifestBackupPath = path.join(backupRoot, "__manifest.json");
  const displaced: RollbackAction[] = [];
  const restored: RollbackAction[] = [];
  let manifestBackedUp = false;
  let manifestWritten = false;

  const journal: OperationJournal = {
    schemaVersion: 1,
    operationId: plan.operationId,
    sourceOperationId: plan.sourceOperationId,
    kind: "rollback",
    status: "prepared",
    entries: plan.actions.map((action) => ({
      path: action.path,
      action: action.action === "remove" ? "delete" : action.hadCurrent ? "replace" : "create",
      ownership: "managed",
      preSha256: action.preSha256,
      ...(action.postSha256 === undefined ? {} : { postSha256: action.postSha256 }),
      backupPath: `.forgeyard/state/backups/${plan.operationId}/${action.path}`,
    })),
    recoveryPaths: [],
    manifestBackupPath: `.forgeyard/state/backups/${plan.operationId}/__manifest.json`,
  };

  try {
    await fileSystem.mkdir(stagingRoot);
    await fileSystem.mkdir(backupRoot);
    for (const action of plan.actions.filter((item) => item.action === "restore")) {
      const source = resolveInsideRoot(plan.targetRoot, action.sourceBackupPath!);
      const staged = resolveInsideRoot(stagingRoot, action.path);
      await fileSystem.mkdir(path.dirname(staged));
      const content = await fileSystem.readFile(source);
      if (digest(content) !== action.preSha256) throw transactionError("Rollback preimage hash changed.", [action.path]);
      await fileSystem.writeFile(staged, content);
    }
    await writeJournal(fileSystem, journalPath, journal);

    for (const action of plan.actions.filter((item) => item.hadCurrent)) {
      const current = resolveInsideRoot(plan.targetRoot, action.path);
      const backup = resolveInsideRoot(plan.targetRoot, `.forgeyard/state/backups/${plan.operationId}/${action.path}`);
      await fileSystem.mkdir(path.dirname(backup));
      await fileSystem.rename(current, backup);
      displaced.push(action);
    }
    await fileSystem.rename(manifestPath, manifestBackupPath);
    manifestBackedUp = true;

    for (const action of plan.actions.filter((item) => item.action === "restore")) {
      const staged = resolveInsideRoot(stagingRoot, action.path);
      const destination = resolveInsideRoot(plan.targetRoot, action.path);
      await fileSystem.mkdir(path.dirname(destination));
      await fileSystem.rename(staged, destination);
      restored.push(action);
    }

    const stagedManifest = path.join(stagingRoot, "__manifest.json");
    await fileSystem.writeFile(stagedManifest, serializeInstallManifest(plan.targetManifest));
    await fileSystem.rename(stagedManifest, manifestPath);
    manifestWritten = true;
    await writeJournal(fileSystem, journalPath, { ...journal, status: "completed" });
    await fileSystem.rm(stagingRoot, { recursive: true, force: true });
    return rollbackResult(plan, true);
  } catch (error) {
    const failures: string[] = [];
    if (manifestWritten) {
      try {
        await fileSystem.rm(manifestPath, { recursive: false, force: true });
      } catch {
        failures.push(".forgeyard/manifest.json");
      }
    }
    for (const action of [...restored].reverse()) {
      try {
        await fileSystem.rm(resolveInsideRoot(plan.targetRoot, action.path), { recursive: false, force: true });
      } catch {
        failures.push(action.path);
      }
    }
    for (const action of [...displaced].reverse()) {
      try {
        await fileSystem.rename(
          resolveInsideRoot(plan.targetRoot, `.forgeyard/state/backups/${plan.operationId}/${action.path}`),
          resolveInsideRoot(plan.targetRoot, action.path),
        );
      } catch {
        failures.push(action.path);
      }
    }
    if (manifestBackedUp) {
      try {
        await fileSystem.rename(manifestBackupPath, manifestPath);
      } catch {
        failures.push(".forgeyard/manifest.json");
      }
    }
    try {
      await fileSystem.rm(stagingRoot, { recursive: true, force: true });
      await writeJournal(fileSystem, journalPath, {
        ...journal,
        status: failures.length === 0 ? "recovered" : "recovery-failed",
        recoveryPaths: failures,
      });
    } catch {
      failures.push(path.relative(plan.targetRoot, journalPath).replaceAll("\\", "/"));
    }
    throw transactionError(
      failures.length === 0
        ? "Rollback failed and the post-operation payload was restored."
        : "Rollback failed and recovery is incomplete.",
      failures.length === 0 ? undefined : failures,
      error,
    );
  }
}
