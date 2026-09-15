import type { NonEmptyArgv } from "../core/contracts.js";

export interface TaskLimits {
  minutes: number;
  maxRetries: number;
  maxCostUsd?: number;
}

export interface WorkflowTask {
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: readonly string[];
  dependsOn: readonly string[];
  writeScopes: readonly string[];
  role: string;
  capabilities: readonly string[];
  limits: TaskLimits;
  evidence: { required: boolean };
  integration: { owner: string; target: string };
  command: NonEmptyArgv;
  required: true;
}

export interface LoadedWorkflowTask {
  task: WorkflowTask;
  source: string;
  definitionSha256: string;
  path: string;
}

export interface TaskGraph {
  tasks: readonly LoadedWorkflowTask[];
  graphSha256: string;
  mutableRoots: readonly string[];
  protectedPaths: readonly string[];
}

export interface LoadTaskGraphInput {
  root: string;
  mutableRoots: readonly string[];
  protectedPaths: readonly string[];
}

export type TaskRuntimeStatus = "pending" | "active" | "completed" | "blocked" | "canceled";

export interface TaskCheckpoint {
  at: string;
  note: string;
}

export interface TaskRuntimeState {
  definitionSha256: string;
  status: TaskRuntimeStatus;
  attempts: number;
  consecutiveFailures: number;
  workerId?: string;
  sessionId?: string;
  claimedAt?: string;
  deadlineAt?: string;
  checkpoint?: TaskCheckpoint;
  receiptId?: string;
  completedAt?: string;
  lastFailureSha256?: string;
  guard?: {
    writeScopes: readonly string[];
    protectedPaths: readonly string[];
  };
  workspace?: {
    relativePath: string;
    branch: string;
    targetBranch: string;
    baseCommit: string;
    status: "created" | "validated" | "integrated";
    validatedCommit?: string;
    validatedReceiptId?: string;
    integratedCommit?: string;
    integratedReceiptId?: string;
  };
}

export interface RunStop {
  reason: "retry-budget-exhausted" | "repeated-failure" | "time-budget-exhausted" | "canceled";
  taskId: string;
  at: string;
}

export interface RunState {
  schemaVersion: 1;
  graphSha256: string;
  createdAt: string;
  updatedAt: string;
  stopped: RunStop | null;
  tasks: Record<string, TaskRuntimeState>;
}

export interface SchedulerTaskSnapshot extends TaskRuntimeState {
  id: string;
  ready: boolean;
}

export interface SchedulerSnapshot {
  graphSha256: string;
  activeCount: number;
  maxConcurrency: number;
  readyTaskIds: readonly string[];
  stopped: RunStop | null;
  tasks: readonly SchedulerTaskSnapshot[];
}
