import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
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

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeGitPort {
  run(cwd: string, args: readonly string[]): Promise<GitResult>;
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
}

export interface WorktreeService {
  status(input: WorkspaceInput): Promise<WorkspaceResult>;
  create(input: WorkspaceInput): Promise<WorkspaceResult>;
  validate(input: WorkspaceInput): Promise<WorkspaceResult>;
  integrate(input: WorkspaceInput): Promise<WorkspaceResult>;
}

const systemClock: StateClock = { now: () => new Date() };
export const nodeWorktreeGitPort: WorktreeGitPort = {
  async run(cwd, args) {
    const result = await execa("git", [...args], { cwd, shell: false, reject: false, stdin: "ignore" });
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

async function withIntegrationLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = resolveInsideRoot(root, ".forgeyard/state/integration.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw worktreeError("FY_INTEGRATION_BUSY", "Another process owns the serialized integration lock.", [lockPath]);
    }
    throw worktreeError("FY_INTEGRATION_FAILED", "The serialized integration lock could not be created.", [lockPath]);
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
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
      return withIntegrationLock(root, async () => {
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
      return workspaceResult(root, input.taskId, updated);
      });
    },
  };
}
