import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

import { execa } from "execa";

import { ForgeyardError } from "../core/errors.js";
import { resolveInsideRoot } from "../core/paths.js";
import { getReceiptStatus, parseReceipt } from "../evidence/receipts.js";
import { nodeCommandRunner, runVerification } from "../evidence/run-verification.js";
import type { RunState, TaskGraph, TaskRuntimeState, WorkflowTask } from "../orchestrator/contracts.js";
import { createTaskScheduler } from "../orchestrator/scheduler.js";
import {
  createFileRunStateStore,
  readPersistedRunState,
  serializeRunState,
  type RunStateStore,
  type StateClock,
} from "../orchestrator/state.js";

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOCK_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const INTEGRATION_LOCK_REF = "refs/forgeyard/locks/integration";
const activeIntegrationLockTokens = new Set<string>();

interface IntegrationLockRecord {
  schemaVersion: 1;
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeGitPort {
  run(cwd: string, args: readonly string[], input?: string): Promise<GitResult>;
}

export interface WorktreeServiceOptions {
  root: string;
  graph: TaskGraph;
  maxConcurrency: number;
  git?: WorktreeGitPort;
  clock?: StateClock;
  store?: RunStateStore;
}

export interface WorkspaceInput {
  taskId: string;
  workerId: string;
}

export interface WorkspaceResult {
  taskId: string;
  status: "created" | "validated" | "integrated";
  workspaceRoot: string;
  branch: string;
  targetBranch: string;
  baseCommit: string;
  validatedCommit?: string;
  integratedCommit?: string;
  receiptId?: string;
  cleanedAt?: string;
}

export interface WorktreeService {
  status(input: WorkspaceInput): Promise<WorkspaceResult>;
  create(input: WorkspaceInput): Promise<WorkspaceResult>;
  validate(input: WorkspaceInput): Promise<WorkspaceResult>;
  integrate(input: WorkspaceInput): Promise<WorkspaceResult>;
  cleanup(input: WorkspaceInput): Promise<WorkspaceResult>;
}

const systemClock: StateClock = { now: () => new Date() };
export const nodeWorktreeGitPort: WorktreeGitPort = {
  async run(cwd, args, input) {
    const result = await execa("git", [...args], {
      cwd,
      shell: false,
      reject: false,
      ...(input === undefined ? { stdin: "ignore" as const } : { input }),
    });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  },
};

function worktreeError(code: string, message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code,
    message,
    remediation: "Inspect the task workspace and Git state; Forgeyard will not push or discard unresolved user changes.",
    exitCode: 10,
    ...(paths === undefined ? {} : { paths }),
  });
}

function taskById(graph: TaskGraph, taskId: string): WorkflowTask {
  const task = graph.tasks.find((entry) => entry.task.id === taskId)?.task;
  if (task === undefined) throw worktreeError("FY_TASK_INVALID", `Task ${taskId} is not in the graph.`);
  return task;
}

function assertOwnedActive(state: RunState, input: WorkspaceInput): TaskRuntimeState {
  if (!WORKER_PATTERN.test(input.workerId)) throw worktreeError("FY_TASK_INVALID", "Worker ID is invalid.");
  const runtime = state.tasks[input.taskId];
  if (runtime?.status !== "active" || runtime.workerId !== input.workerId) {
    throw worktreeError("FY_TASK_OWNERSHIP", `Task ${input.taskId} is not active for worker ${input.workerId}.`);
  }
  return runtime;
}

function slug(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function workspaceResult(root: string, taskId: string, workspace: NonNullable<TaskRuntimeState["workspace"]>): WorkspaceResult {
  return {
    taskId,
    status: workspace.status,
    workspaceRoot: resolveInsideRoot(root, workspace.relativePath),
    branch: workspace.branch,
    targetBranch: workspace.targetBranch,
    baseCommit: workspace.baseCommit,
    ...(workspace.validatedCommit === undefined ? {} : { validatedCommit: workspace.validatedCommit }),
    ...(workspace.integratedCommit === undefined ? {} : { integratedCommit: workspace.integratedCommit }),
    ...(workspace.cleanedAt === undefined ? {} : { cleanedAt: workspace.cleanedAt }),
    ...(workspace.integratedReceiptId !== undefined
      ? { receiptId: workspace.integratedReceiptId }
      : workspace.validatedReceiptId === undefined ? {} : { receiptId: workspace.validatedReceiptId }),
  };
}

async function requiredGit(git: WorktreeGitPort, cwd: string, args: readonly string[], code: string, message: string): Promise<string> {
  const result = await git.run(cwd, args);
  if (result.exitCode !== 0) throw worktreeError(code, message);
  return result.stdout.trim();
}

async function ensureClean(git: WorktreeGitPort, root: string): Promise<void> {
  const status = await requiredGit(git, root, ["status", "--porcelain=v1", "--untracked-files=all"], "FY_GIT_REQUIRED", "Git status is unavailable.");
  if (status.length > 0) throw worktreeError("FY_GIT_DIRTY", "The integration checkout contains uncommitted or untracked changes.");
}

async function currentHead(git: WorktreeGitPort, root: string): Promise<string> {
  const head = (await requiredGit(git, root, ["rev-parse", "--verify", "HEAD"], "FY_GIT_REQUIRED", "Git HEAD is unavailable.")).toLowerCase();
  if (!COMMIT_PATTERN.test(head)) throw worktreeError("FY_GIT_REQUIRED", "Git returned an invalid HEAD revision.");
  return head;
}

async function currentBranch(git: WorktreeGitPort, root: string): Promise<string> {
  const branch = await requiredGit(git, root, ["branch", "--show-current"], "FY_GIT_REQUIRED", "The current Git branch is unavailable.");
  if (branch.length === 0) throw worktreeError("FY_GIT_REQUIRED", "Worktree operations require a named integration branch.");
  return branch;
}

async function loadWorkspaceReceipt(workspaceRoot: string, taskId: string, receiptId: string) {
  const receiptPath = resolveInsideRoot(workspaceRoot, `.forgeyard/evidence/${receiptId}.json`);
  const receipt = parseReceipt(await readFile(receiptPath, "utf8"), receiptPath);
  if (receipt.taskId !== taskId || receipt.status !== "passed" || await getReceiptStatus(workspaceRoot, receipt) !== "current") {
    throw worktreeError("FY_EVIDENCE_STALE", `Workspace evidence for task ${taskId} is stale.`);
  }
  return receipt;
}

function parseIntegrationLock(source: string): IntegrationLockRecord | undefined {
  try {
    const value = JSON.parse(source) as Partial<IntegrationLockRecord>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.token !== "string" ||
      !LOCK_TOKEN_PATTERN.test(value.token) ||
      !Number.isSafeInteger(value.pid) ||
      value.pid! < 1 ||
      typeof value.hostname !== "string" ||
      value.hostname.length === 0 ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) return undefined;
    return value as IntegrationLockRecord;
  } catch {
    return undefined;
  }
}

async function currentIntegrationLockOid(git: WorktreeGitPort, root: string): Promise<string | undefined> {
  const exists = await git.run(root, ["show-ref", "--verify", "--quiet", INTEGRATION_LOCK_REF]);
  if (exists.exitCode === 1) return undefined;
  if (exists.exitCode !== 0) {
    throw worktreeError("FY_INTEGRATION_FAILED", "Git could not inspect the serialized integration lock.");
  }
  const result = await git.run(root, ["show-ref", "--verify", "--hash", INTEGRATION_LOCK_REF]);
  if (result.exitCode !== 0) {
    throw worktreeError("FY_INTEGRATION_FAILED", "The serialized integration lock changed while it was inspected.");
  }
  const oid = result.stdout.trim().toLowerCase();
  if (!COMMIT_PATTERN.test(oid)) {
    throw worktreeError("FY_INTEGRATION_FAILED", "Git returned an invalid serialized integration lock revision.");
  }
  return oid;
}

async function readIntegrationLock(
  git: WorktreeGitPort,
  root: string,
  oid: string,
): Promise<IntegrationLockRecord | undefined> {
  const result = await git.run(root, ["cat-file", "blob", oid]);
  if (result.exitCode !== 0) return undefined;
  return parseIntegrationLock(result.stdout);
}

function localProcessIsAlive(pid: number, token: string): boolean {
  if (pid === process.pid) return activeIntegrationLockTokens.has(token);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function createIntegrationLockBlob(
  git: WorktreeGitPort,
  root: string,
  record: IntegrationLockRecord,
): Promise<string> {
  const stagingRoot = resolveInsideRoot(root, ".forgeyard/state/staging");
  const recordPath = resolveInsideRoot(root, `.forgeyard/state/staging/integration-lock-${record.token}.json`);
  await mkdir(stagingRoot, { recursive: true });
  try {
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const result = await git.run(root, ["hash-object", "-w", recordPath]);
    const oid = result.stdout.trim().toLowerCase();
    if (result.exitCode !== 0 || !COMMIT_PATTERN.test(oid)) {
      throw worktreeError("FY_INTEGRATION_FAILED", "Git could not record the serialized integration lock owner.");
    }
    return oid;
  } finally {
    await rm(recordPath, { force: true }).catch(() => undefined);
  }
}

async function acquireIntegrationLock(
  git: WorktreeGitPort,
  root: string,
  record: IntegrationLockRecord,
): Promise<string> {
  const ownOid = await createIntegrationLockBlob(git, root, record);
  const missingOid = "0".repeat(ownOid.length);
  activeIntegrationLockTokens.add(record.token);

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existingOid = await currentIntegrationLockOid(git, root);
      if (existingOid === undefined) {
        const created = await git.run(root, ["update-ref", INTEGRATION_LOCK_REF, ownOid, missingOid]);
        if (created.exitCode === 0) return ownOid;
        continue;
      }

      const owner = await readIntegrationLock(git, root, existingOid);
      if (
        owner === undefined ||
        owner.hostname.toLocaleLowerCase("en-US") !== hostname().toLocaleLowerCase("en-US") ||
        localProcessIsAlive(owner.pid, owner.token)
      ) {
        throw worktreeError("FY_INTEGRATION_BUSY", "Another process owns the serialized integration lock.");
      }

      const replaced = await git.run(root, ["update-ref", INTEGRATION_LOCK_REF, ownOid, existingOid]);
      if (replaced.exitCode === 0) return ownOid;
    }

    throw worktreeError("FY_INTEGRATION_BUSY", "Another process acquired the serialized integration lock.");
  } catch (error) {
    activeIntegrationLockTokens.delete(record.token);
    throw error;
  }
}

async function releaseIntegrationLock(
  git: WorktreeGitPort,
  root: string,
  ownerOid: string,
): Promise<void> {
  const released = await git.run(root, ["update-ref", "-d", INTEGRATION_LOCK_REF, ownerOid]);
  if (released.exitCode !== 0) {
    throw worktreeError(
      "FY_INTEGRATION_LOCK_LOST",
      "The serialized integration lock changed before its owner could release it.",
    );
  }
}

async function withIntegrationLock<T>(root: string, git: WorktreeGitPort, operation: () => Promise<T>): Promise<T> {
  const token = randomBytes(16).toString("hex");
  const record: IntegrationLockRecord = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
  };
  const ownerOid = await acquireIntegrationLock(git, root, record);
  try {
    return await operation();
  } finally {
    try {
      await releaseIntegrationLock(git, root, ownerOid);
    } finally {
      activeIntegrationLockTokens.delete(token);
    }
  }
}

export function createWorktreeService(options: WorktreeServiceOptions): WorktreeService {
  const root = path.resolve(options.root);
  const graph = options.graph;
  const git = options.git ?? nodeWorktreeGitPort;
  const clock = options.clock ?? systemClock;
  const store = options.store ?? createFileRunStateStore(root);
  const scheduler = createTaskScheduler({
    root,
    graph,
    maxConcurrency: options.maxConcurrency,
    clock,
    store,
  });

  async function stateWorkspace(input: WorkspaceInput) {
    const state = await readPersistedRunState(root, graph);
    const runtime = assertOwnedActive(state, input);
    if (runtime.workspace === undefined) throw worktreeError("FY_WORKTREE_MISSING", `Task ${input.taskId} has no isolated workspace.`);
    return runtime.workspace;
  }

  async function integratedWorkspace(input: WorkspaceInput) {
    taskById(graph, input.taskId);
    if (!WORKER_PATTERN.test(input.workerId)) throw worktreeError("FY_TASK_INVALID", "Worker ID is invalid.");
    const state = await readPersistedRunState(root, graph);
    const runtime = state.tasks[input.taskId];
    const workspace = runtime?.workspace;
    const expectedBranch = `forgeyard/${slug(input.taskId)}-${slug(input.workerId)}`;
    if (runtime?.status !== "completed" || workspace?.status !== "integrated") {
      throw worktreeError("FY_WORKTREE_NOT_INTEGRATED", `Task ${input.taskId} has no completed integration to clean up.`);
    }
    if (workspace.branch !== expectedBranch) {
      throw worktreeError("FY_TASK_OWNERSHIP", `Task ${input.taskId} was not assigned to worker ${input.workerId}.`);
    }
    return workspace;
  }

  async function exists(candidate: string): Promise<boolean> {
    try {
      await stat(candidate);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async function registeredWorktreePaths(): Promise<readonly string[]> {
    const output = await requiredGit(
      git,
      root,
      ["worktree", "list", "--porcelain", "-z"],
      "FY_WORKTREE_CLEANUP_FAILED",
      "Git could not list registered worktrees during cleanup.",
    );
    return output
      .split("\0")
      .filter((entry) => entry.startsWith("worktree "))
      .map((entry) => path.resolve(entry.slice("worktree ".length)));
  }

  function sameFilesystemPath(left: string, right: string): boolean {
    const normalizedLeft = path.normalize(left);
    const normalizedRight = path.normalize(right);
    return process.platform === "win32"
      ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
      : normalizedLeft === normalizedRight;
  }

  async function localRefHead(ref: string, label: string): Promise<string | undefined> {
    const exists = await git.run(root, ["show-ref", "--verify", "--quiet", ref]);
    if (exists.exitCode === 1) return undefined;
    if (exists.exitCode !== 0) {
      throw worktreeError("FY_WORKTREE_CLEANUP_FAILED", `Git could not inspect ${label}.`);
    }
    const result = await git.run(root, ["show-ref", "--verify", "--hash", ref]);
    if (result.exitCode !== 0) {
      throw worktreeError("FY_WORKTREE_CLEANUP_FAILED", `${label} changed while Git inspected it.`);
    }
    const head = result.stdout.trim().toLowerCase();
    if (!COMMIT_PATTERN.test(head)) {
      throw worktreeError("FY_WORKTREE_CLEANUP_FAILED", `Git returned an invalid revision for ${label}.`);
    }
    return head;
  }

  async function localBranchHead(branch: string): Promise<string | undefined> {
    return localRefHead(`refs/heads/${branch}`, `worker branch ${branch}`);
  }

  async function requireCleanupAncestry(ancestor: string, descendant: string, staleMessage: string): Promise<void> {
    const result = await git.run(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    if (result.exitCode === 0) return;
    if (result.exitCode === 1) throw worktreeError("FY_WORKTREE_STALE", staleMessage);
    throw worktreeError("FY_WORKTREE_CLEANUP_FAILED", "Git could not verify cleanup ancestry.");
  }

  async function cleanupIntegrated(input: WorkspaceInput, workspace: NonNullable<TaskRuntimeState["workspace"]>) {
    if (workspace.cleanedAt !== undefined) return workspace;
    if (
      workspace.validatedCommit === undefined ||
      workspace.integratedCommit === undefined ||
      !COMMIT_PATTERN.test(workspace.validatedCommit) ||
      !COMMIT_PATTERN.test(workspace.integratedCommit)
    ) {
      throw worktreeError("FY_WORKTREE_STALE", `Task ${input.taskId} has incomplete integration revision metadata.`);
    }
    const workspaceRoot = resolveInsideRoot(root, workspace.relativePath);
    const branchHead = await localBranchHead(workspace.branch);
    if (branchHead !== undefined && branchHead !== workspace.validatedCommit) {
      throw worktreeError(
        "FY_WORKTREE_STALE",
        `Worker branch ${workspace.branch} no longer points to the revision validated for task ${input.taskId}.`,
      );
    }
    await requireCleanupAncestry(
      workspace.validatedCommit,
      workspace.integratedCommit,
      `The recorded integration commit no longer contains the validated revision for task ${input.taskId}.`,
    );
    const targetRef = `refs/heads/${workspace.targetBranch}`;
    const targetHead = await localRefHead(targetRef, `target branch ${workspace.targetBranch}`);
    if (targetHead === undefined) {
      throw worktreeError("FY_WORKTREE_STALE", `Target branch ${workspace.targetBranch} no longer exists.`);
    }
    await requireCleanupAncestry(
      workspace.integratedCommit,
      targetHead,
      `Target branch ${workspace.targetBranch} no longer contains the recorded integration for task ${input.taskId}.`,
    );
    const registered = (await registeredWorktreePaths()).some((candidate) => sameFilesystemPath(candidate, workspaceRoot));
    const directoryExists = await exists(workspaceRoot);

    if (registered) {
      const removed = await git.run(root, ["worktree", "remove", workspaceRoot]);
      if (removed.exitCode !== 0) {
        throw worktreeError(
          "FY_WORKTREE_CLEANUP_FAILED",
          directoryExists
            ? `Task ${input.taskId} was integrated, but Git could not remove its isolated worktree.`
            : `Task ${input.taskId} was integrated, but Git could not remove its stale worktree registration.`,
          [workspace.relativePath],
        );
      }
      if ((await registeredWorktreePaths()).some((candidate) => sameFilesystemPath(candidate, workspaceRoot))) {
        throw worktreeError(
          "FY_WORKTREE_CLEANUP_FAILED",
          `Task ${input.taskId} was integrated, but its worktree registration still exists after removal.`,
          [workspace.relativePath],
        );
      }
    } else if (directoryExists) {
      throw worktreeError(
        "FY_WORKTREE_CLEANUP_FAILED",
        `Task ${input.taskId} was integrated, but its workspace path is no longer registered with Git and will not be deleted automatically.`,
        [workspace.relativePath],
      );
    }

    if (branchHead !== undefined) {
      const confirmedBranchHead = await localBranchHead(workspace.branch);
      if (confirmedBranchHead === undefined) {
        // Another actor already removed the exact branch after the worktree disappeared.
      } else if (confirmedBranchHead !== workspace.validatedCommit) {
        throw worktreeError(
          "FY_WORKTREE_STALE",
          `Worker branch ${workspace.branch} changed after its worktree was removed and will not be deleted automatically.`,
        );
      } else {
        const branchRef = `refs/heads/${workspace.branch}`;
        const transaction = [
          "start",
          `verify ${targetRef} ${targetHead}`,
          `delete ${branchRef} ${workspace.validatedCommit}`,
          "prepare",
          "commit",
          "",
        ].join("\n");
        const deleted = await git.run(root, ["update-ref", "--stdin"], transaction);
        if (deleted.exitCode !== 0) {
          const currentTargetHead = await localRefHead(targetRef, `target branch ${workspace.targetBranch}`);
          if (currentTargetHead !== targetHead) {
            throw worktreeError(
              "FY_WORKTREE_STALE",
              `Target branch ${workspace.targetBranch} changed during worker branch deletion; the worker branch was preserved.`,
            );
          }
          const currentBranchHead = await localBranchHead(workspace.branch);
          if (currentBranchHead === undefined) {
            // Another actor already removed the exact branch.
          } else if (currentBranchHead !== workspace.validatedCommit) {
            throw worktreeError(
              "FY_WORKTREE_STALE",
              `Worker branch ${workspace.branch} changed during deletion and was preserved.`,
            );
          } else {
            throw worktreeError(
              "FY_WORKTREE_CLEANUP_FAILED",
              `Task ${input.taskId} was integrated and its worktree was removed, but Git could not safely delete branch ${workspace.branch}.`,
            );
          }
        }
      }
    }

    return store.transact(graph, clock, async (state) => {
      const completed = state.tasks[input.taskId];
      if (
        completed?.status !== "completed" ||
        completed.workspace?.status !== "integrated" ||
        completed.workspace.branch !== workspace.branch ||
        completed.workspace.integratedCommit !== workspace.integratedCommit
      ) {
        throw worktreeError("FY_WORKTREE_STALE", "Completed task state changed during worktree cleanup.");
      }
      const changed = completed.workspace.cleanedAt === undefined;
      if (changed) completed.workspace.cleanedAt = clock.now().toISOString();
      return { value: completed.workspace, changed };
    });
  }

  return {
    async status(input) {
      return workspaceResult(root, input.taskId, await stateWorkspace(input));
    },

    async create(input) {
      taskById(graph, input.taskId);
      const initial = await readPersistedRunState(root, graph);
      const runtime = assertOwnedActive(initial, input);
      if (runtime.workspace !== undefined) return workspaceResult(root, input.taskId, runtime.workspace);
      await ensureClean(git, root);
      const baseCommit = await currentHead(git, root);
      const targetBranch = await currentBranch(git, root);
      const task = taskById(graph, input.taskId);
      if (task.integration.target !== "current" && task.integration.target !== targetBranch) {
        throw worktreeError("FY_INTEGRATION_TARGET", `Task ${task.id} targets ${task.integration.target}, not current branch ${targetBranch}.`);
      }
      const name = `${slug(input.taskId)}-${slug(input.workerId)}`;
      const relativePath = `.forgeyard/state/worktrees/${name}`;
      const workspaceRoot = resolveInsideRoot(root, relativePath);
      const branch = `forgeyard/${name}`;
      const created = await git.run(root, ["worktree", "add", "-b", branch, workspaceRoot, baseCommit]);
      if (created.exitCode !== 0) {
        throw worktreeError("FY_WORKTREE_FAILED", `Git could not create isolated branch ${branch}.`, [relativePath]);
      }
      try {
        const workspace = await store.transact(graph, clock, async (state) => {
          const owned = assertOwnedActive(state, input);
          owned.workspace = { relativePath, branch, targetBranch, baseCommit, status: "created" };
          return { value: owned.workspace, changed: true };
        });
        const central = await readPersistedRunState(root, graph);
        await mkdir(path.join(workspaceRoot, ".forgeyard", "state"), { recursive: true });
        await writeFile(path.join(workspaceRoot, ".forgeyard", "state", "run.json"), serializeRunState(central), { encoding: "utf8", mode: 0o600 });
        return workspaceResult(root, input.taskId, workspace);
      } catch (error) {
        await git.run(root, ["worktree", "remove", "--force", workspaceRoot]).catch(() => undefined);
        await git.run(root, ["branch", "-D", branch]).catch(() => undefined);
        throw error;
      }
    },

    async validate(input) {
      const workspace = await stateWorkspace(input);
      const workspaceRoot = resolveInsideRoot(root, workspace.relativePath);
      await ensureClean(git, workspaceRoot);
      const branch = await currentBranch(git, workspaceRoot);
      if (branch !== workspace.branch) throw worktreeError("FY_WORKTREE_STALE", "The isolated checkout is on an unexpected branch.");
      const head = await currentHead(git, workspaceRoot);
      if (head === workspace.baseCommit) {
        throw worktreeError("FY_WORKTREE_UNCHANGED", `Task ${input.taskId} has no committed workspace change.`);
      }
      const ancestor = await git.run(workspaceRoot, ["merge-base", "--is-ancestor", workspace.baseCommit, head]);
      if (ancestor.exitCode !== 0) throw worktreeError("FY_WORKTREE_STALE", "The task branch no longer descends from its frozen base.");
      const verification = await runVerification({ root: workspaceRoot, taskId: input.taskId });
      const updated = await store.transact(graph, clock, async (state) => {
        const owned = assertOwnedActive(state, input);
        if (owned.workspace?.branch !== workspace.branch) throw worktreeError("FY_WORKTREE_STALE", "Workspace state changed during validation.");
        owned.workspace.status = "validated";
        owned.workspace.validatedCommit = head;
        owned.workspace.validatedReceiptId = verification.receipt.receiptId;
        return { value: owned.workspace, changed: true };
      });
      return workspaceResult(root, input.taskId, updated);
    },

    async integrate(input) {
      return withIntegrationLock(root, git, async () => {
      const workspace = await stateWorkspace(input);
      if (
        workspace.status !== "validated" ||
        workspace.validatedCommit === undefined ||
        workspace.validatedReceiptId === undefined
      ) throw worktreeError("FY_EVIDENCE_STALE", `Task ${input.taskId} must be validated before integration.`);
      const workspaceRoot = resolveInsideRoot(root, workspace.relativePath);
      await ensureClean(git, root);
      await ensureClean(git, workspaceRoot);
      if (await currentBranch(git, root) !== workspace.targetBranch) {
        throw worktreeError("FY_INTEGRATION_TARGET", `Integration must run on branch ${workspace.targetBranch}.`);
      }
      const workspaceHead = await currentHead(git, workspaceRoot);
      if (workspaceHead !== workspace.validatedCommit) throw worktreeError("FY_EVIDENCE_STALE", "The task branch changed after validation.");
      await loadWorkspaceReceipt(workspaceRoot, input.taskId, workspace.validatedReceiptId);
      const baseIsAncestor = await git.run(root, ["merge-base", "--is-ancestor", workspace.baseCommit, "HEAD"]);
      if (baseIsAncestor.exitCode !== 0) throw worktreeError("FY_INTEGRATION_TARGET", "The integration branch no longer descends from the task base.");

      const merge = await git.run(root, ["merge", "--no-commit", "--no-ff", workspace.branch]);
      if (merge.exitCode !== 0) {
        await git.run(root, ["merge", "--abort"]).catch(() => undefined);
        throw worktreeError("FY_INTEGRATION_CONFLICT", `Task ${input.taskId} conflicts with the integration branch.`);
      }
      const task = taskById(graph, input.taskId);
      const [executable, ...args] = task.command;
      const preCommit = await nodeCommandRunner({
        executable,
        args,
        cwd: root,
        shell: false,
        timeoutMs: 900_000,
        maxBufferBytes: 1_048_576,
      });
      if (preCommit.exitCode !== 0) {
        await git.run(root, ["merge", "--abort"]).catch(() => undefined);
        throw worktreeError("FY_INTEGRATION_CHECK_FAILED", `Task ${input.taskId} failed in the combined pre-commit tree.`);
      }
      const commit = await git.run(root, ["commit", "--no-edit"]);
      if (commit.exitCode !== 0) {
        await git.run(root, ["merge", "--abort"]).catch(() => undefined);
        throw worktreeError("FY_INTEGRATION_FAILED", "Git could not finalize the validated integration commit.");
      }
      const integratedCommit = await currentHead(git, root);
      const finalVerification = await runVerification({ root, taskId: input.taskId });
      await scheduler.complete({
        taskId: input.taskId,
        workerId: input.workerId,
        receiptId: finalVerification.receipt.receiptId,
      });
      const updated = await store.transact(graph, clock, async (state) => {
        const completed = state.tasks[input.taskId];
        if (completed?.status !== "completed" || completed.workspace?.branch !== workspace.branch) {
          throw worktreeError("FY_WORKTREE_STALE", "Completed task state no longer matches the integrated workspace.");
        }
        completed.workspace.status = "integrated";
        completed.workspace.integratedCommit = integratedCommit;
        completed.workspace.integratedReceiptId = finalVerification.receipt.receiptId;
        return { value: completed.workspace, changed: true };
      });
      const cleaned = await cleanupIntegrated(input, updated);
      return workspaceResult(root, input.taskId, cleaned);
      });
    },

    async cleanup(input) {
      return withIntegrationLock(root, git, async () => {
        const cleaned = await cleanupIntegrated(input, await integratedWorkspace(input));
        return workspaceResult(root, input.taskId, cleaned);
      });
    },
  };
}
