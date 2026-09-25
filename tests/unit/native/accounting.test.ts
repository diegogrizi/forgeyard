import { describe, expect, test } from "vitest";

import { deliveryAccounting } from "../../../src/native/runs.js";
import type { NativeRun } from "../../../src/native/contracts.js";
import type { HumanBaseline, UsageObservation } from "../../../src/measure/accounting.js";

function run(usage?: readonly UsageObservation[]): NativeRun {
  return {
    plan: { id: "r1", request: "Add the filter", risk: "low", requirements: [], tasks: [] },
    planSha256: "a".repeat(64), capsuleId: "b".repeat(64), status: "reviewing",
    createdAt: "2026-09-22T10:00:00.000Z", deadlineAt: "2026-09-22T15:00:00.000Z", repairs: 0,
    approvalBaseline: "c".repeat(64), artifactSha256: "d".repeat(64), baselineHeads: { ".": "e".repeat(40) },
    membersByTask: {},
    checkpoints: [], criteria: [], reviews: [], completedTaskIds: [], decisions: [],
    recordedCostUsd: null, ...(usage === undefined ? {} : { usage }),
  };
}

function observation(overrides: Partial<UsageObservation> = {}): UsageObservation {
  return {
    at: "2026-09-22T10:05:00.000Z", provider: "anthropic", model: "claude-opus-5",
    inputTokens: 1200, outputTokens: 340, costUsd: 0.25, durationMs: 4000, ...overrides,
  };
}

describe("declared accounting on a delivery", () => {
  test("a run that reported nothing measures nothing, and never zero", () => {
    const report = deliveryAccounting(run());

    expect(report.agentic.observations).toBe(0);
    expect(report.agentic.costUsd.measured).toBe(false);
    expect(report.agentic.spanMs.measured).toBe(false);
    expect(report.comparison.costRatio.measured).toBe(false);
    expect(report.comparison.timeRatio.measured).toBe(false);
  });

  test("a run opened before the field existed is treated as having reported nothing", () => {
    // The field is optional on purpose: an older stored run must not crash the certificate.
    expect(deliveryAccounting(run()).agentic.observations).toBe(0);
  });

  test("reported observations are summed and the span is measured across them", () => {
    const report = deliveryAccounting(run([
      observation(),
      observation({ at: "2026-09-22T10:20:00.000Z", inputTokens: 800, outputTokens: 100, costUsd: 0.1, durationMs: 2000 }),
    ]));

    expect(report.agentic.observations).toBe(2);
    expect(report.agentic.inputTokens).toBe(2000);
    expect(report.agentic.outputTokens).toBe(440);
    expect(report.agentic.durationMs).toBe(6000);
    expect(report.agentic.costUsd).toEqual({ measured: true, value: 0.35 });
    expect(report.agentic.spanMs).toEqual({ measured: true, value: 900_000 });
  });

  test("one unreported cost makes the total unmeasured rather than a partial sum", () => {
    const report = deliveryAccounting(run([observation(), observation({ costUsd: null })]));

    expect(report.agentic.costUsd.measured).toBe(false);
    expect(report.agentic.inputTokens).toBe(2400);
  });

  test("no human baseline is invented, so the comparison stays absent", () => {
    const report = deliveryAccounting(run([observation()]));

    expect(report.human.measured).toBe(false);
    expect(report.comparison.costRatio.measured).toBe(false);
    expect(report.method).toMatch(/\S/);
  });

  test("a declared baseline produces a ratio, and the method says what was compared", () => {
    const baseline: HumanBaseline = {
      method: "declared-estimate", hours: 8, hourlyRateUsd: 75, confidence: "medium",
      source: "Stima del responsabile tecnico, 2026-09-22", rangeHours: { low: 6, high: 12 },
    };
    const report = deliveryAccounting(run([observation({ costUsd: 0.5 }), observation({ costUsd: 0.5 })]), baseline);

    expect(report.human).toEqual({ measured: true, value: expect.objectContaining({ costUsd: 600, hours: 8 }) });
    expect(report.comparison.costRatio).toEqual({ measured: true, value: 600 });
    expect(report.comparison.costRatioRange.measured).toBe(true);
    expect(report.method).toContain("declared-estimate");
  });
});
