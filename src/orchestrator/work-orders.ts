import type { UsageSummary } from "../observability/ledger.js";
import type { SchedulerSnapshot, TaskGraph, WorkflowTask } from "./contracts.js";

export type WorkOrderCostStatus = "not-configured" | "unmeasured" | "measured";

export interface WorkOrder {
  taskId: string;
  title: string;
  objective: string;
  acceptanceCriteria: readonly string[];
  role: string;
  capabilities: readonly string[];
  writeScopes: readonly string[];
  verificationArgv: readonly string[];
  remainingMinutes: number;
  costStatus: WorkOrderCostStatus;
  recordedCostUsd: number | null;
  remainingCostUsd: number | null;
  workerId: string;
  hostPrompt: string;
}

export interface BuildWorkOrdersInput {
  graph: TaskGraph;
  snapshot: SchedulerSnapshot;
  mode: "guided" | "native";
  usage: UsageSummary;
}

interface CostView {
  status: WorkOrderCostStatus;
  recorded: number | null;
  remaining: number | null;
  exhausted: boolean;
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function costView(task: WorkflowTask, usage: UsageSummary): CostView {
  const observation = usage.byTask[task.id];
  if (task.limits.maxCostUsd === undefined) {
    return { status: "not-configured", recorded: observation?.costUsd ?? null, remaining: null, exhausted: false };
  }
  if (observation === undefined) {
    return { status: "unmeasured", recorded: null, remaining: null, exhausted: false };
  }
  const remaining = money(Math.max(0, task.limits.maxCostUsd - observation.costUsd));
  return {
    status: "measured",
    recorded: observation.costUsd,
    remaining,
    exhausted: observation.costUsd >= task.limits.maxCostUsd,
  };
}

function displayList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function buildHostPrompt(task: WorkflowTask, workerId: string, cost: CostView): string {
  const costLine = cost.status === "not-configured"
    ? "No task cost ceiling is configured. Record usage only when the host exposes an explicit observation."
    : cost.status === "unmeasured"
      ? `A $${task.limits.maxCostUsd!.toFixed(6)} task ceiling exists, but no usage has been measured; do not report this as zero cost.`
      : `$${cost.recorded!.toFixed(6)} is recorded; $${cost.remaining!.toFixed(6)} remains under the task ceiling.`;
  const criteria = task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  return [
    "Execute this bounded Forgeyard work order from the project root.",
    "",
    `Task: ${task.id} — ${task.title}`,
    `Objective: ${task.objective}`,
    `Role: ${task.role}`,
    `Capabilities to use: ${displayList(task.capabilities)}`,
    `Allowed write scopes: ${displayList(task.writeScopes)}`,
    `Time budget: ${task.limits.minutes} minutes`,
    `Cost evidence: ${costLine}`,
    "Acceptance criteria:",
    criteria,
    "",
    "Lifecycle:",
    `1. Before editing, claim exactly this task: forgeyard task claim ${task.id} --worker ${workerId} --root . --json`,
    `2. Work only inside the allowed write scopes. Check uncertain paths with: forgeyard guard ${task.id} <path...> --root . --json`,
    `3. Record resumable progress with: forgeyard task checkpoint ${task.id} --worker ${workerId} --note <bounded-note> --root . --json`,
    `4. Verify with: forgeyard verify ${task.id} --root . --json`,
    `   Exact verification argv: ${JSON.stringify(task.command)}`,
    `5. Complete only with the current receipt: forgeyard task complete ${task.id} --worker ${workerId} --receipt <receipt-id> --root . --json`,
    "Do not widen scope, invent evidence, or push, publish, deploy, message, purchase, or perform another external effect without explicit authorization.",
  ].join("\n");
}

function orderFor(task: WorkflowTask, usage: UsageSummary): WorkOrder | null {
  const cost = costView(task, usage);
  if (cost.exhausted) return null;
  const workerId = `forgeyard-${task.id.toLowerCase()}`;
  return {
    taskId: task.id,
    title: task.title,
    objective: task.objective,
    acceptanceCriteria: task.acceptanceCriteria,
    role: task.role,
    capabilities: task.capabilities,
    writeScopes: task.writeScopes,
    verificationArgv: task.command,
    remainingMinutes: task.limits.minutes,
    costStatus: cost.status,
    recordedCostUsd: cost.recorded,
    remainingCostUsd: cost.remaining,
    workerId,
    hostPrompt: buildHostPrompt(task, workerId, cost),
  };
}

export function buildWorkOrders(input: BuildWorkOrdersInput): readonly WorkOrder[] {
  if (input.snapshot.stopped !== null) return [];
  const capacity = Math.max(0, input.snapshot.maxConcurrency - input.snapshot.activeCount);
  const limit = input.mode === "guided" ? Math.min(1, capacity) : capacity;
  if (limit === 0) return [];
  const ready = new Set(input.snapshot.readyTaskIds);
  return input.graph.tasks
    .filter(({ task }) => ready.has(task.id))
    .map(({ task }) => orderFor(task, input.usage))
    .filter((order): order is WorkOrder => order !== null)
    .slice(0, limit);
}
