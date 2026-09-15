import { describe, expect, test } from "vitest";

import type { UsageSummary } from "../../../src/observability/ledger.js";
import type {
  LoadedWorkflowTask,
  SchedulerSnapshot,
  TaskGraph,
  WorkflowTask,
} from "../../../src/orchestrator/contracts.js";
import { buildWorkOrders } from "../../../src/orchestrator/work-orders.js";

function task(id: string, maxCostUsd?: number): LoadedWorkflowTask {
  const definition: WorkflowTask = {
    schemaVersion: 1,
    id,
    title: `${id} visible outcome`,
    objective: `Deliver the ${id} customer journey`,
    acceptanceCriteria: ["The observable behavior works"],
    dependsOn: [],
    writeScopes: [`src/${id.toLowerCase()}`],
    role: "frontend-implementer",
    capabilities: ["implementation", "browser-verification"],
    limits: { minutes: 45, maxRetries: 2, ...(maxCostUsd === undefined ? {} : { maxCostUsd }) },
    evidence: { required: true },
    integration: { owner: "integrator", target: "current" },
    command: ["npm", "run", "test", "--", id],
    required: true,
  };
  return {
    task: definition,
    source: `${id}.yaml`,
    path: `.forgeyard/tasks/${id}.yaml`,
    definitionSha256: id.repeat(64).slice(0, 64).toLowerCase(),
  };
}

function graph(...tasks: LoadedWorkflowTask[]): TaskGraph {
  return {
    tasks,
    graphSha256: "a".repeat(64),
    mutableRoots: ["src"],
    protectedPaths: [".git", ".env"],
  };
}

function snapshot(readyTaskIds: readonly string[], activeCount = 0, maxConcurrency = 4): SchedulerSnapshot {
  return {
    graphSha256: "a".repeat(64),
    activeCount,
    maxConcurrency,
    readyTaskIds,
    stopped: null,
    tasks: [],
  };
}

const noUsage: UsageSummary = { observed: false, totalCostUsd: 0, byTask: {} };

describe("bounded host work orders", () => {
  test("returns one deterministic work order in guided mode without claiming the task", () => {
    const orders = buildWorkOrders({
      graph: graph(task("T001", 1), task("T002", 1)),
      snapshot: snapshot(["T001", "T002"]),
      mode: "guided",
      usage: noUsage,
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual(expect.objectContaining({
      taskId: "T001",
      title: "T001 visible outcome",
      objective: "Deliver the T001 customer journey",
      role: "frontend-implementer",
      capabilities: ["implementation", "browser-verification"],
      writeScopes: ["src/t001"],
      remainingMinutes: 45,
      costStatus: "unmeasured",
      recordedCostUsd: null,
      remainingCostUsd: null,
      workerId: "forgeyard-t001",
    }));
    expect(orders[0]!.hostPrompt).toContain("forgeyard task claim T001 --worker forgeyard-t001 --root . --json");
    expect(orders[0]!.hostPrompt).toContain("Deliver the T001 customer journey");
    expect(orders[0]!.hostPrompt).toContain('["npm","run","test","--","T001"]');
  });

  test("returns no more than native remaining capacity in graph order", () => {
    const orders = buildWorkOrders({
      graph: graph(task("T001"), task("T002"), task("T003")),
      snapshot: snapshot(["T001", "T002", "T003"], 1, 3),
      mode: "native",
      usage: noUsage,
    });

    expect(orders.map((order) => order.taskId)).toEqual(["T001", "T002"]);
    expect(orders.every((order) => order.costStatus === "not-configured")).toBe(true);
  });

  test("reports only explicit task cost and withholds exhausted work", () => {
    const usage: UsageSummary = {
      observed: true,
      totalCostUsd: 1.4,
      byTask: {
        T001: { observations: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.4, durationMs: 50 },
        T002: { observations: 1, inputTokens: 10, outputTokens: 5, costUsd: 1, durationMs: 50 },
      },
    };
    const orders = buildWorkOrders({
      graph: graph(task("T001", 1), task("T002", 1), task("T003")),
      snapshot: snapshot(["T001", "T002", "T003"]),
      mode: "native",
      usage,
    });

    expect(orders.map((order) => order.taskId)).toEqual(["T001", "T003"]);
    expect(orders[0]).toEqual(expect.objectContaining({
      costStatus: "measured",
      recordedCostUsd: 0.4,
      remainingCostUsd: 0.6,
    }));
    expect(orders[1]).toEqual(expect.objectContaining({
      costStatus: "not-configured",
      recordedCostUsd: null,
      remainingCostUsd: null,
    }));
  });
});
