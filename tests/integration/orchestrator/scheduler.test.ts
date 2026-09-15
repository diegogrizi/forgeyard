import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadTaskGraph } from "../../../src/orchestrator/graph.js";
import { createTaskScheduler, type EvidencePort } from "../../../src/orchestrator/scheduler.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-scheduler-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  return root;
}

function source(
  id: string,
  scope: string,
  dependsOn: readonly string[] = [],
  maxRetries = 2,
): string {
  const dependencies = dependsOn.length === 0
    ? ["dependsOn: []"]
    : ["dependsOn:", ...dependsOn.map((dependency) => `  - ${dependency}`)];
  return [
    "schemaVersion: 1",
    `id: ${id}`,
    `title: ${id} title`,
    `objective: Deliver ${id}`,
    "acceptanceCriteria:",
    "  - The behavior works",
    ...dependencies,
    "writeScopes:",
    `  - ${scope}`,
    "role: implementer",
    "capabilities: [implementation]",
    "limits:",
    "  minutes: 45",
    `  maxRetries: ${maxRetries}`,
    "evidence:",
    "  required: true",
    "integration:",
    "  owner: integrator",
    "  target: current",
    'command: ["node", "-e", "process.exit(0)"]',
    "required: true",
    "",
  ].join("\n");
}

async function put(root: string, id: string, taskSource: string): Promise<void> {
  await writeFile(path.join(root, ".forgeyard", "tasks", `${id}.yaml`), taskSource, "utf8");
}

async function graph(root: string) {
  return loadTaskGraph({ root, mutableRoots: ["src"], protectedPaths: [".git", ".env"] });
}

function evidence(current: ReadonlySet<string> = new Set()): EvidencePort {
  return { isCurrent: async (_taskId, receiptId) => receiptId !== undefined && current.has(receiptId) };
}

const clock = {
  now: () => new Date("2026-09-15T12:00:00.000Z"),
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resumable task scheduler", () => {
  test("claims independent tasks up to the configured concurrency cap", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/one"));
    await put(root, "T002", source("T002", "src/two"));
    await put(root, "T003", source("T003", "src/three"));
    const scheduler = createTaskScheduler({ root, graph: await graph(root), maxConcurrency: 2, clock, evidence: evidence() });

    expect((await scheduler.status()).readyTaskIds).toEqual(["T001", "T002", "T003"]);
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    await scheduler.claim({ taskId: "T002", workerId: "worker-two" });
    expect((await scheduler.status()).activeCount).toBe(2);
    expect((await scheduler.status()).readyTaskIds).toEqual([]);
    await expect(scheduler.claim({ taskId: "T003", workerId: "worker-three" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_CONCURRENCY_LIMIT" }),
    );
  });

  test("prevents overlapping write scopes in a shared checkout", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/shared"));
    await put(root, "T002", source("T002", "src/shared/api"));
    const scheduler = createTaskScheduler({ root, graph: await graph(root), maxConcurrency: 4, clock, evidence: evidence() });

    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    await expect(scheduler.claim({ taskId: "T002", workerId: "worker-two" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_SCOPE_CONFLICT" }),
    );
  });

  test("serializes competing claims so one task never has two owners", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/feature"));
    const loadedGraph = await graph(root);
    const first = createTaskScheduler({ root, graph: loadedGraph, maxConcurrency: 4, evidence: evidence() });
    const second = createTaskScheduler({ root, graph: loadedGraph, maxConcurrency: 4, evidence: evidence() });

    const outcomes = await Promise.allSettled([
      first.claim({ taskId: "T001", workerId: "worker-one" }),
      second.claim({ taskId: "T001", workerId: "worker-two" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const persisted = await first.status();
    expect(persisted.activeCount).toBe(1);
    expect(persisted.tasks[0]!.workerId).toMatch(/^worker-(?:one|two)$/);
  });

  test("persists checkpoints and resumes them through a fresh scheduler instance", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/feature"));
    const loadedGraph = await graph(root);
    const first = createTaskScheduler({ root, graph: loadedGraph, maxConcurrency: 4, clock, evidence: evidence() });
    await first.claim({ taskId: "T001", workerId: "worker-one", sessionId: "session-one" });
    await first.checkpoint({ taskId: "T001", workerId: "worker-one", note: "RED test captured" });

    const restarted = createTaskScheduler({ root, graph: loadedGraph, maxConcurrency: 4, clock, evidence: evidence() });
    const resumed = await restarted.resume({ taskId: "T001", workerId: "worker-one" });

    expect(resumed.status).toBe("active");
    expect(resumed.checkpoint).toEqual({ at: "2026-09-15T12:00:00.000Z", note: "RED test captured" });
    expect(resumed.sessionId).toBe("session-one");
  });

  test("requires current evidence before completion and then unlocks dependants", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/one"));
    await put(root, "T002", source("T002", "src/two", ["T001"]));
    const scheduler = createTaskScheduler({
      root,
      graph: await graph(root),
      maxConcurrency: 4,
      clock,
      evidence: evidence(new Set(["receipt-current"])),
    });

    await expect(scheduler.claim({ taskId: "T002", workerId: "worker-two" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_TASK_NOT_READY" }),
    );
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    await expect(scheduler.complete({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_EVIDENCE_STALE" }),
    );
    await scheduler.complete({ taskId: "T001", workerId: "worker-one", receiptId: "receipt-current" });

    expect((await scheduler.status()).readyTaskIds).toEqual(["T002"]);
  });

  test("stops after the same failure exhausts the retry budget", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/one", [], 2));
    await put(root, "T002", source("T002", "src/two"));
    const scheduler = createTaskScheduler({ root, graph: await graph(root), maxConcurrency: 4, clock, evidence: evidence() });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
      await scheduler.fail({ taskId: "T001", workerId: "worker-one", fingerprint: "same-test-failure" });
    }

    expect((await scheduler.status()).stopped).toEqual(expect.objectContaining({ reason: "retry-budget-exhausted" }));
    await expect(scheduler.claim({ taskId: "T002", workerId: "worker-two" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_RUN_STOPPED" }),
    );
  });

  test("persists a stop when an active task exceeds its time budget", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/one"));
    let current = new Date("2026-09-15T12:00:00.000Z");
    const movingClock = { now: () => current };
    const scheduler = createTaskScheduler({
      root,
      graph: await graph(root),
      maxConcurrency: 4,
      clock: movingClock,
      evidence: evidence(new Set(["receipt-current"])),
    });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    current = new Date("2026-09-15T12:46:00.000Z");

    await expect(scheduler.complete({
      taskId: "T001",
      workerId: "worker-one",
      receiptId: "receipt-current",
    })).rejects.toEqual(expect.objectContaining({ code: "FY_BUDGET_EXHAUSTED" }));
    expect((await scheduler.status()).stopped).toEqual(expect.objectContaining({
      reason: "time-budget-exhausted",
      taskId: "T001",
    }));
  });

  test("rejects state written for a different task graph", async () => {
    const root = await freshRoot();
    await put(root, "T001", source("T001", "src/one"));
    const firstGraph = await graph(root);
    await createTaskScheduler({ root, graph: firstGraph, maxConcurrency: 4, clock, evidence: evidence() }).status();
    await put(root, "T001", source("T001", "src/changed"));
    const changedGraph = await graph(root);

    await expect(createTaskScheduler({
      root,
      graph: changedGraph,
      maxConcurrency: 4,
      clock,
      evidence: evidence(),
    }).status()).rejects.toEqual(expect.objectContaining({ code: "FY_STATE_STALE" }));
  });
});
