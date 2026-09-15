import path from "node:path";

import { loadConfig } from "../config/config.js";
import type { SchedulerSnapshot, TaskRuntimeState } from "../orchestrator/contracts.js";
import { loadTaskGraph } from "../orchestrator/graph.js";
import { createTaskScheduler } from "../orchestrator/scheduler.js";
import {
  appendTaskTransition,
  appendUsageObservation,
  type TaskTransitionAction,
  type UsageObservationInput,
} from "../observability/ledger.js";

export type TaskCommandInput =
  | { action: "status" | "next"; root: string }
  | { action: "claim"; root: string; taskId: string; workerId: string; sessionId?: string }
  | { action: "checkpoint"; root: string; taskId: string; workerId: string; note: string }
  | { action: "resume" | "cancel"; root: string; taskId: string; workerId: string }
  | { action: "complete"; root: string; taskId: string; workerId: string; receiptId?: string }
  | { action: "fail"; root: string; taskId: string; workerId: string; fingerprint: string };

export interface TaskCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "task";
  action: TaskCommandInput["action"];
  root: string;
  task?: TaskRuntimeState & { id: string };
  snapshot: SchedulerSnapshot;
}

export interface UsageCommandInput extends UsageObservationInput {
  root: string;
}

export interface UsageCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "ledger";
  action: "record";
  root: string;
  eventId: string;
}

export async function runTaskCommand(input: TaskCommandInput): Promise<TaskCommandResult> {
  const root = path.resolve(input.root);
  const config = await loadConfig(path.join(root, "forgeyard.yaml"));
  const graph = await loadTaskGraph({
    root,
    mutableRoots: config.paths.mutableRoots,
    protectedPaths: config.paths.protectedPaths,
  });
  const scheduler = createTaskScheduler({ root, graph, maxConcurrency: config.orchestration.maxConcurrency });

  if (input.action === "status" || input.action === "next") {
    return {
      schemaVersion: 1,
      ok: true,
      command: "task",
      action: input.action,
      root,
      snapshot: await scheduler.status(),
    };
  }

  let runtime: TaskRuntimeState;
  switch (input.action) {
    case "claim":
      runtime = await scheduler.claim({
        taskId: input.taskId,
        workerId: input.workerId,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      });
      break;
    case "checkpoint":
      runtime = await scheduler.checkpoint({ taskId: input.taskId, workerId: input.workerId, note: input.note });
      break;
    case "resume":
      runtime = await scheduler.resume({ taskId: input.taskId, workerId: input.workerId });
      break;
    case "complete":
      runtime = await scheduler.complete({
        taskId: input.taskId,
        workerId: input.workerId,
        ...(input.receiptId === undefined ? {} : { receiptId: input.receiptId }),
      });
      break;
    case "fail":
      runtime = await scheduler.fail({
        taskId: input.taskId,
        workerId: input.workerId,
        fingerprint: input.fingerprint,
      });
      break;
    case "cancel":
      runtime = await scheduler.cancel({ taskId: input.taskId, workerId: input.workerId });
      break;
  }
  await appendTaskTransition(root, {
    action: input.action as TaskTransitionAction,
    taskId: input.taskId,
    workerId: input.workerId,
    graphSha256: graph.graphSha256,
    runtimeStatus: runtime.status,
  });
  return {
    schemaVersion: 1,
    ok: true,
    command: "task",
    action: input.action,
    root,
    task: { id: input.taskId, ...runtime },
    snapshot: await scheduler.status(),
  };
}

export async function recordUsageCommand(input: UsageCommandInput): Promise<UsageCommandResult> {
  const root = path.resolve(input.root);
  const result = await appendUsageObservation(root, {
    taskId: input.taskId,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd,
    durationMs: input.durationMs,
  });
  return {
    schemaVersion: 1,
    ok: true,
    command: "ledger",
    action: "record",
    root,
    eventId: result.eventId,
  };
}
