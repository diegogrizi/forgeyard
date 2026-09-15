import { readFile } from "node:fs/promises";
import path from "node:path";

import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { getReceiptStatus, parseReceipt } from "../evidence/receipts.js";
import type {
  RunState,
  SchedulerSnapshot,
  TaskGraph,
  TaskRuntimeState,
  WorkflowTask,
} from "./contracts.js";
import { createFileRunStateStore, type RunStateStore, type StateClock } from "./state.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface EvidencePort {
  isCurrent(taskId: string, receiptId: string | undefined): Promise<boolean>;
}

export interface TaskSchedulerOptions {
  root: string;
  graph: TaskGraph;
  maxConcurrency: number;
  clock?: StateClock;
  evidence?: EvidencePort;
  store?: RunStateStore;
}

export interface ClaimInput {
  taskId: string;
  workerId: string;
  sessionId?: string;
}

export interface OwnedTaskInput {
  taskId: string;
  workerId: string;
}

export interface CheckpointInput extends OwnedTaskInput {
  note: string;
}

export interface CompleteInput extends OwnedTaskInput {
  receiptId?: string;
}

export interface FailInput extends OwnedTaskInput {
  fingerprint: string;
}

export interface TaskScheduler {
  status(): Promise<SchedulerSnapshot>;
  claim(input: ClaimInput): Promise<TaskRuntimeState>;
  checkpoint(input: CheckpointInput): Promise<TaskRuntimeState>;
  resume(input: OwnedTaskInput): Promise<TaskRuntimeState>;
  complete(input: CompleteInput): Promise<TaskRuntimeState>;
  fail(input: FailInput): Promise<TaskRuntimeState>;
  cancel(input: OwnedTaskInput): Promise<TaskRuntimeState>;
}

const systemClock: StateClock = { now: () => new Date() };

function schedulerError(code: string, message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code,
    message,
    remediation: "Inspect `forgeyard task status`, resolve the named gate, and retry the transition.",
    exitCode: 9,
    ...(paths === undefined ? {} : { paths }),
  });
}

function validateIdentity(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) throw schedulerError("FY_TASK_INVALID", `${label} is invalid.`);
}

function taskById(graph: TaskGraph, taskId: string): WorkflowTask {
  const entry = graph.tasks.find((candidate) => candidate.task.id === taskId);
  if (entry === undefined) throw schedulerError("FY_TASK_INVALID", `Task ${taskId} is not in the graph.`);
  return entry.task;
}

function completedIds(state: RunState): Set<string> {
  return new Set(Object.entries(state.tasks).filter(([, value]) => value.status === "completed").map(([id]) => id));
}

function activeIds(state: RunState): readonly string[] {
  return Object.entries(state.tasks).filter(([, value]) => value.status === "active").map(([id]) => id).sort();
}

function pathContains(parent: string, candidate: string): boolean {
  const normalizedParent = parent.normalize("NFKC").toLocaleLowerCase("en-US");
  const normalizedCandidate = candidate.normalize("NFKC").toLocaleLowerCase("en-US");
  return normalizedParent === "." || normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftScope) => right.some((rightScope) => pathContains(leftScope, rightScope) || pathContains(rightScope, leftScope)));
}

function dependenciesComplete(task: WorkflowTask, state: RunState): boolean {
  const completed = completedIds(state);
  return task.dependsOn.every((dependency) => completed.has(dependency));
}

function conflictsWithActive(task: WorkflowTask, state: RunState, graph: TaskGraph): boolean {
  return activeIds(state).some((id) => scopesOverlap(task.writeScopes, taskById(graph, id).writeScopes));
}

function snapshot(state: RunState, graph: TaskGraph, maxConcurrency: number): SchedulerSnapshot {
  const activeCount = activeIds(state).length;
  const hasCapacity = activeCount < maxConcurrency && state.stopped === null;
  const tasks = graph.tasks.map(({ task }) => {
    const runtime = state.tasks[task.id]!;
    const ready = hasCapacity
      && runtime.status === "pending"
      && dependenciesComplete(task, state)
      && !conflictsWithActive(task, state, graph);
    return { id: task.id, ...runtime, ready };
  });
  return {
    graphSha256: graph.graphSha256,
    activeCount,
    maxConcurrency,
    readyTaskIds: tasks.filter((entry) => entry.ready).map((entry) => entry.id),
    stopped: state.stopped,
    tasks,
  };
}

function assertOwnedActive(state: RunState, input: OwnedTaskInput): TaskRuntimeState {
  validateIdentity(input.workerId, "Worker ID");
  const runtime = state.tasks[input.taskId];
  if (runtime === undefined) throw schedulerError("FY_TASK_INVALID", `Task ${input.taskId} is not in the run state.`);
  if (runtime.status !== "active" || runtime.workerId !== input.workerId) {
    throw schedulerError("FY_TASK_OWNERSHIP", `Task ${input.taskId} is not active for worker ${input.workerId}.`);
  }
  return runtime;
}

function clearClaim(runtime: TaskRuntimeState): void {
  delete runtime.workerId;
  delete runtime.sessionId;
  delete runtime.claimedAt;
  delete runtime.deadlineAt;
  delete runtime.guard;
}

export function createFilesystemEvidencePort(rootInput: string): EvidencePort {
  const root = path.resolve(rootInput);
  return {
    async isCurrent(taskId, receiptId) {
      if (receiptId === undefined || !ID_PATTERN.test(receiptId)) return false;
      try {
        const receiptPath = resolveInsideRoot(root, `.forgeyard/evidence/${receiptId}.json`);
        const receipt = parseReceipt(await readFile(receiptPath, "utf8"), receiptPath);
        return receipt.taskId === taskId && receipt.status === "passed" && await getReceiptStatus(root, receipt) === "current";
      } catch {
        return false;
      }
    },
  };
}

export function createTaskScheduler(options: TaskSchedulerOptions): TaskScheduler {
  const maxConcurrency = Math.trunc(options.maxConcurrency);
  if (maxConcurrency < 1 || maxConcurrency > 16) {
    throw schedulerError("FY_CONCURRENCY_LIMIT", "Maximum concurrency must be between 1 and 16.");
  }
  const clock = options.clock ?? systemClock;
  const store = options.store ?? createFileRunStateStore(options.root);
  const evidence = options.evidence ?? createFilesystemEvidencePort(options.root);
  const graph = options.graph;

  return {
    status: () => store.transact(graph, clock, async (state) => ({
      value: snapshot(state, graph, maxConcurrency),
      changed: false,
    })),

    claim: (input) => store.transact(graph, clock, async (state) => {
      validateIdentity(input.workerId, "Worker ID");
      if (input.sessionId !== undefined) validateIdentity(input.sessionId, "Session ID");
      const task = taskById(graph, input.taskId);
      const runtime = state.tasks[input.taskId]!;
      if (state.stopped !== null) throw schedulerError("FY_RUN_STOPPED", `The run stopped because ${state.stopped.reason}.`);
      if (runtime.status === "active" && runtime.workerId === input.workerId) return { value: runtime, changed: false };
      if (runtime.status !== "pending" || !dependenciesComplete(task, state)) {
        throw schedulerError("FY_TASK_NOT_READY", `Task ${task.id} is not dependency-ready.`);
      }
      if (activeIds(state).length >= maxConcurrency) {
        throw schedulerError("FY_CONCURRENCY_LIMIT", `The run already has ${maxConcurrency} active workers.`);
      }
      if (conflictsWithActive(task, state, graph)) {
        throw schedulerError("FY_SCOPE_CONFLICT", `Task ${task.id} overlaps an active task write scope.`, task.writeScopes);
      }
      const now = clock.now();
      runtime.status = "active";
      runtime.attempts += 1;
      runtime.workerId = input.workerId;
      if (input.sessionId !== undefined) runtime.sessionId = input.sessionId;
      runtime.claimedAt = now.toISOString();
      runtime.deadlineAt = new Date(now.getTime() + task.limits.minutes * 60_000).toISOString();
      runtime.guard = { writeScopes: task.writeScopes, protectedPaths: graph.protectedPaths };
      return { value: runtime, changed: true };
    }),

    checkpoint: (input) => store.transact(graph, clock, async (state) => {
      const runtime = assertOwnedActive(state, input);
      const note = input.note.trim();
      if (note.length === 0 || note.length > 1000) {
        throw schedulerError("FY_TASK_INVALID", "Checkpoint notes must contain 1 to 1,000 characters.");
      }
      runtime.checkpoint = { at: clock.now().toISOString(), note };
      return { value: runtime, changed: true };
    }),

    resume: (input) => store.transact(graph, clock, async (state) => ({
      value: assertOwnedActive(state, input),
      changed: false,
    })),

    complete: async (input) => {
      const outcome = await store.transact<{ runtime: TaskRuntimeState; error: ForgeyardError | null }>(graph, clock, async (state) => {
        const runtime = assertOwnedActive(state, input);
        const task = taskById(graph, input.taskId);
        if (Date.parse(runtime.deadlineAt!) < clock.now().getTime()) {
          runtime.status = "blocked";
          clearClaim(runtime);
          state.stopped = { reason: "time-budget-exhausted", taskId: task.id, at: clock.now().toISOString() };
          return {
            value: {
              runtime,
              error: schedulerError("FY_BUDGET_EXHAUSTED", `Task ${task.id} exceeded its time budget.`),
            },
            changed: true,
          };
        }
        if (task.evidence.required && !await evidence.isCurrent(task.id, input.receiptId)) {
          throw schedulerError("FY_EVIDENCE_STALE", `Task ${task.id} requires a current successful verification receipt.`);
        }
        runtime.status = "completed";
        runtime.completedAt = clock.now().toISOString();
        if (input.receiptId !== undefined) runtime.receiptId = input.receiptId;
        runtime.consecutiveFailures = 0;
        clearClaim(runtime);
        return { value: { runtime, error: null }, changed: true };
      });
      if (outcome.error !== null) throw outcome.error;
      return outcome.runtime;
    },

    fail: (input) => store.transact(graph, clock, async (state) => {
      const runtime = assertOwnedActive(state, input);
      const task = taskById(graph, input.taskId);
      const fingerprint = input.fingerprint.trim();
      if (fingerprint.length === 0 || fingerprint.length > 1000) {
        throw schedulerError("FY_TASK_INVALID", "Failure fingerprints must contain 1 to 1,000 characters.");
      }
      const failureSha256 = sha256Text(fingerprint);
      runtime.consecutiveFailures = runtime.lastFailureSha256 === failureSha256 ? runtime.consecutiveFailures + 1 : 1;
      runtime.lastFailureSha256 = failureSha256;
      clearClaim(runtime);
      const exhausted = runtime.attempts > task.limits.maxRetries;
      const repeated = runtime.consecutiveFailures >= 3;
      if (exhausted || repeated) {
        runtime.status = "blocked";
        state.stopped = {
          reason: exhausted ? "retry-budget-exhausted" : "repeated-failure",
          taskId: task.id,
          at: clock.now().toISOString(),
        };
      } else {
        runtime.status = "pending";
      }
      return { value: runtime, changed: true };
    }),

    cancel: (input) => store.transact(graph, clock, async (state) => {
      const runtime = assertOwnedActive(state, input);
      runtime.status = "canceled";
      clearClaim(runtime);
      state.stopped = { reason: "canceled", taskId: input.taskId, at: clock.now().toISOString() };
      return { value: runtime, changed: true };
    }),
  };
}
