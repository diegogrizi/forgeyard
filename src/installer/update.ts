import path from "node:path";

import type { InstallPlan, PlannedFile } from "../core/contracts.js";
import type { InstallManifest, InstalledFileRecord, OperationJournal } from "./manifest.js";
import { serializeInstallManifest } from "./manifest.js";
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
  validatePlanShape,
  writeJournal,
} from "./apply.js";

export type UpdateActionKind = "create" | "replace" | "delete" | "unchanged" | "preserve";

export interface UpdateAction {
  path: string;
  action: UpdateActionKind;
  ownership: "managed" | "seed";
  planned?: PlannedFile;
  previous?: InstalledFileRecord;
  preSha256?: string;
  postSha256?: string;
  backupPath?: string;
}

export interface UpdatePlan {
  operationId: string;
  targetRoot: string;
  next: InstallPlan;
  previousManifest: InstallManifest;
  actions: readonly UpdateAction[];
}

export interface UpdateResult {
  operationId: string;
  applied: boolean;
  created: readonly string[];
  updated: readonly string[];
  removed: readonly string[];
  unchanged: readonly string[];
  preserved: readonly string[];
}

function actionResult(plan: UpdatePlan, applied: boolean): UpdateResult {
  return {
    operationId: plan.operationId,
    applied,
    created: plan.actions.filter((item) => item.action === "create").map((item) => item.path),
    updated: plan.actions.filter((item) => item.action === "replace").map((item) => item.path),
    removed: plan.actions.filter((item) => item.action === "delete").map((item) => item.path),
    unchanged: plan.actions.filter((item) => item.action === "unchanged").map((item) => item.path),
    preserved: plan.actions.filter((item) => item.action === "preserve").map((item) => item.path),
  };
}

async function currentHash(fileSystem: FileSystemPort, root: string, relativePath: string): Promise<string | undefined> {
  const destination = await assertSafeDestination(fileSystem, root, relativePath);
  const stats = await maybeStat(fileSystem, destination);
  if (stats === undefined) return undefined;
  return digest(await fileSystem.readFile(destination));
}

export async function planUpdate(
  root: string,
  next: InstallPlan,
  fileSystem: FileSystemPort = nodeFileSystem,
): Promise<UpdatePlan> {
  validatePlanShape(next);
  const targetRoot = path.resolve(root);
  if (targetRoot !== next.targetRoot) throw ownershipError([next.targetRoot]);
  const prior = await optionalManifest(targetRoot, fileSystem);
  if (prior.manifest === undefined) throw ownershipError([".forgeyard/manifest.json"]);
  const previousManifest = prior.manifest;
  const previousByPath = new Map(previousManifest.files.map((record) => [record.path, record]));
  const nextByPath = new Map(next.files.map((file) => [file.path, file]));
  const actions: UpdateAction[] = [];
  const conflicts: string[] = [];

  for (const planned of next.files) {
    const previous = previousByPath.get(planned.path);
    const preSha256 = await currentHash(fileSystem, targetRoot, planned.path);
    if (planned.ownership === "seed") {
      if (preSha256 === undefined) {
        conflicts.push(planned.path);
      } else if (previous !== undefined && preSha256 === previous.installedSha256 && preSha256 === planned.sha256) {
        actions.push({
          path: planned.path,
          action: "unchanged",
          ownership: "seed",
          planned,
          previous,
          preSha256,
          postSha256: preSha256,
        });
      } else {
        actions.push({
          path: planned.path,
          action: "preserve",
          ownership: "seed",
          planned,
          ...(previous === undefined ? {} : { previous }),
          preSha256,
          postSha256: preSha256,
        });
      }
      continue;
    }

    if (previous === undefined) {
      if (preSha256 === undefined) {
        actions.push({
          path: planned.path,
          action: "create",
          ownership: "managed",
          planned,
          postSha256: planned.sha256,
        });
      } else {
        conflicts.push(planned.path);
      }
      continue;
    }
    if (previous.ownership !== "managed" || preSha256 === undefined || preSha256 !== previous.installedSha256) {
      conflicts.push(planned.path);
      continue;
    }
    if (planned.sha256 === previous.installedSha256) {
      actions.push({
        path: planned.path,
        action: "unchanged",
        ownership: "managed",
        planned,
        previous,
        preSha256,
        postSha256: planned.sha256,
      });
    } else {
      actions.push({
        path: planned.path,
        action: "replace",
        ownership: "managed",
        planned,
        previous,
        preSha256,
        postSha256: planned.sha256,
        backupPath: `.forgeyard/state/backups/${next.operationId}/${planned.path}`,
      });
    }
  }

  for (const previous of previousManifest.files) {
    if (nextByPath.has(previous.path)) continue;
    if (previous.ownership === "seed") {
      conflicts.push(previous.path);
      continue;
    }
    const preSha256 = await currentHash(fileSystem, targetRoot, previous.path);
    if (preSha256 === undefined || preSha256 !== previous.installedSha256) {
      conflicts.push(previous.path);
    } else {
      actions.push({
        path: previous.path,
        action: "delete",
        ownership: "managed",
        previous,
        preSha256,
        backupPath: `.forgeyard/state/backups/${next.operationId}/${previous.path}`,
      });
    }
  }

  if (conflicts.length > 0) throw ownershipError([...new Set(conflicts)].sort((a, b) => a.localeCompare(b, "en")));
  return { operationId: next.operationId, targetRoot, next, previousManifest, actions };
}

function nextManifest(plan: UpdatePlan): InstallManifest {
  const records: InstalledFileRecord[] = [];
  for (const action of plan.actions) {
    if (action.action === "delete") continue;
    if ((action.action === "unchanged" || action.action === "preserve") && action.previous !== undefined) {
      records.push(action.previous);
      continue;
    }
    if (action.planned === undefined) throw transactionError("Update action is missing planned content.", [action.path]);
    records.push({
      path: action.path,
      componentId: action.planned.componentId,
      ownership: action.planned.ownership,
      installedSha256: action.action === "preserve" ? action.preSha256! : action.planned.sha256,
      operationId: plan.operationId,
    });
  }
  return {
    schemaVersion: 1,
    forgeyardVersion: JSON.parse(plan.next.files.find((file) => file.path === "forgeyard.lock")!.content).forgeyardVersion as string,
    profile: plan.next.profile,
    adapter: plan.next.adapter,
    latestOperationId: plan.operationId,
    files: records,
  };
}

export async function applyUpdate(plan: UpdatePlan, options: ApplyOptions = {}): Promise<UpdateResult> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const changes = plan.actions.filter((action) => ["create", "replace", "delete"].includes(action.action));
  if (options.dryRun || changes.length === 0) return actionResult(plan, false);

  const stateRoot = path.join(plan.targetRoot, ".forgeyard", "state");
  const stagingRoot = path.join(stateRoot, "staging", plan.operationId);
  const backupRoot = path.join(stateRoot, "backups", plan.operationId);
  const journalPath = path.join(stateRoot, "operations", `${plan.operationId}.json`);
  const manifestPath = path.join(plan.targetRoot, ".forgeyard", "manifest.json");
  const manifestBackupPath = path.join(backupRoot, "__manifest.json");
  const backedUp: UpdateAction[] = [];
  const applied: UpdateAction[] = [];
  let manifestBackedUp = false;
  let manifestWritten = false;

  const journal: OperationJournal = {
    schemaVersion: 1,
    operationId: plan.operationId,
    kind: "update",
    status: "prepared",
    entries: plan.actions.map((action) => ({
      path: action.path,
      action: action.action,
      ownership: action.ownership,
      ...(action.preSha256 === undefined ? {} : { preSha256: action.preSha256 }),
      ...(action.postSha256 === undefined ? {} : { postSha256: action.postSha256 }),
      ...(action.backupPath === undefined ? {} : { backupPath: action.backupPath }),
    })),
    recoveryPaths: [],
    manifestBackupPath: `.forgeyard/state/backups/${plan.operationId}/__manifest.json`,
  };

  try {
    await fileSystem.mkdir(stagingRoot);
    await fileSystem.mkdir(backupRoot);
    for (const action of changes) {
      if (action.action === "delete") continue;
      const staged = resolveInsideRoot(stagingRoot, action.path);
      await fileSystem.mkdir(path.dirname(staged));
      await fileSystem.writeFile(staged, action.planned!.content);
      if (digest(await fileSystem.readFile(staged)) !== action.postSha256) {
        throw transactionError("Staged update content failed integrity validation.", [action.path]);
      }
    }
    await writeJournal(fileSystem, journalPath, journal);

    for (const action of changes.filter((item) => item.action === "replace" || item.action === "delete")) {
      const source = resolveInsideRoot(plan.targetRoot, action.path);
      const backup = resolveInsideRoot(plan.targetRoot, action.backupPath!);
      await fileSystem.mkdir(path.dirname(backup));
      await fileSystem.rename(source, backup);
      backedUp.push(action);
    }
    await fileSystem.rename(manifestPath, manifestBackupPath);
    manifestBackedUp = true;

    for (const action of changes.filter((item) => item.action === "create" || item.action === "replace")) {
      const staged = resolveInsideRoot(stagingRoot, action.path);
      const destination = resolveInsideRoot(plan.targetRoot, action.path);
      await fileSystem.mkdir(path.dirname(destination));
      await fileSystem.rename(staged, destination);
      applied.push(action);
    }

    const stagedManifest = path.join(stagingRoot, "__manifest.json");
    await fileSystem.writeFile(stagedManifest, serializeInstallManifest(nextManifest(plan)));
    await fileSystem.rename(stagedManifest, manifestPath);
    manifestWritten = true;
    await writeJournal(fileSystem, journalPath, { ...journal, status: "completed" });
    await fileSystem.rm(stagingRoot, { recursive: true, force: true });
    return actionResult(plan, true);
  } catch (error) {
    const failures: string[] = [];
    if (manifestWritten) {
      try {
        await fileSystem.rm(manifestPath, { recursive: false, force: true });
      } catch {
        failures.push(".forgeyard/manifest.json");
      }
    }
    for (const action of [...applied].reverse()) {
      try {
        await fileSystem.rm(resolveInsideRoot(plan.targetRoot, action.path), { recursive: false, force: true });
      } catch {
        failures.push(action.path);
      }
    }
    for (const action of [...backedUp].reverse()) {
      try {
        await fileSystem.rename(
          resolveInsideRoot(plan.targetRoot, action.backupPath!),
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
        ? "Update failed and the prior payload state was restored."
        : "Update failed and recovery is incomplete.",
      failures.length === 0 ? undefined : failures,
      error,
    );
  }
}
