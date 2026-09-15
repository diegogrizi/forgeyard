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
