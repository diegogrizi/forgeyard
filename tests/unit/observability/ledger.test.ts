import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { appendTaskTransition, appendUsageObservation, readUsageSummary } from "../../../src/observability/ledger.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-09-15T12:00:00.000Z") };
const ids = { next: () => "event-001" };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local run ledger", () => {
  test("appends secret-free transition and explicit usage observations as JSONL", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-ledger-"));
    roots.push(root);
    await appendTaskTransition(root, {
      action: "claim",
      taskId: "T001",
      workerId: "worker-one",
      graphSha256: "a".repeat(64),
      runtimeStatus: "active",
    }, { clock, ids });
    await appendUsageObservation(root, {
      taskId: "T001",
      provider: "provider-one",
      model: "model-one",
      inputTokens: 120,
      outputTokens: 45,
      costUsd: 0.031,
      durationMs: 2400,
    }, { clock, ids });

    const lines = (await readFile(path.join(root, ".forgeyard", "ledger", "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      expect.objectContaining({ kind: "task-transition", action: "claim", taskId: "T001", runtimeStatus: "active" }),
      expect.objectContaining({ kind: "usage", inputTokens: 120, outputTokens: 45, costUsd: 0.031, durationMs: 2400 }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("prompt");
    expect(JSON.stringify(lines)).not.toContain("outputBody");
  });

  test("rejects unsafe labels and invalid numeric observations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-ledger-"));
    roots.push(root);
    await expect(appendUsageObservation(root, {
      taskId: "T001",
      provider: "provider\nprivate",
      model: "model-one",
      inputTokens: -1,
      outputTokens: 0,
      costUsd: Number.NaN,
      durationMs: 0,
    }, { clock, ids })).rejects.toEqual(expect.objectContaining({ code: "FY_LEDGER_INVALID" }));
  });

  test("summarizes only explicit usage observations and distinguishes measured zero from no measurement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-ledger-"));
    roots.push(root);
    expect(await readUsageSummary(root)).toEqual({ observed: false, totalCostUsd: 0, byTask: {} });

    await appendUsageObservation(root, {
      taskId: "T001",
      provider: "provider-one",
      model: "model-one",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0,
      durationMs: 100,
    }, { clock, ids: { next: () => "event-zero" } });
    await appendUsageObservation(root, {
      taskId: "T001",
      provider: "provider-one",
      model: "model-one",
      inputTokens: 20,
      outputTokens: 8,
      costUsd: 0.25,
      durationMs: 200,
    }, { clock, ids: { next: () => "event-cost" } });

    expect(await readUsageSummary(root)).toEqual({
      observed: true,
      totalCostUsd: 0.25,
      byTask: {
        T001: { observations: 2, inputTokens: 30, outputTokens: 13, costUsd: 0.25, durationMs: 300 },
      },
    });
  });

  test("rejects malformed persisted ledger input instead of treating it as zero usage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-ledger-"));
    roots.push(root);
    await mkdir(path.join(root, ".forgeyard", "ledger"), { recursive: true });
    await writeFile(path.join(root, ".forgeyard", "ledger", "events.jsonl"), "{not-json}\n", "utf8");

    await expect(readUsageSummary(root)).rejects.toEqual(expect.objectContaining({ code: "FY_LEDGER_INVALID" }));
  });
});
