import { describe, expect, test } from "vitest";

import {
  compare,
  formatReport,
  summarizeAgentic,
  validateHumanBaseline,
  type AgenticTotals,
  type HumanBaseline,
  type UsageObservation,
} from "../../../src/measure/accounting.js";

const INVALID = expect.objectContaining({ code: "FY_MEASURE_INVALID", exitCode: 2 });
const SOURCE = "Sprint planning estimate recorded on 2026-09-20.";

function observation(patch: Partial<UsageObservation> = {}): UsageObservation {
  return {
    at: "2026-09-22T10:00:00.000Z",
    provider: "anthropic",
    model: "claude-opus-5",
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 0.5,
    durationMs: 20_000,
    ...patch,
  };
}

function malformedObservation(patch: Record<string, unknown>): UsageObservation {
  return { ...observation(), ...patch } as unknown as UsageObservation;
}

/** Three observations: 6000/1200 tokens, 60000 ms of work, 2.00 USD, 60000 ms of wall clock. */
function reportedRun(): readonly UsageObservation[] {
  return [
    observation({ at: "2026-09-22T10:00:00.000Z", inputTokens: 1000, outputTokens: 200, costUsd: 0.5, durationMs: 20_000 }),
    observation({ at: "2026-09-22T10:00:30.000Z", inputTokens: 2000, outputTokens: 400, costUsd: 1, durationMs: 30_000 }),
    observation({ at: "2026-09-22T10:01:00.000Z", inputTokens: 3000, outputTokens: 600, costUsd: 0.5, durationMs: 10_000 }),
  ];
}

function baseline(patch: Partial<HumanBaseline> = {}): HumanBaseline {
  return {
    method: "declared-estimate",
    hours: 4,
    hourlyRateUsd: 100,
    confidence: "high",
    source: SOURCE,
    rangeHours: { low: 3, high: 6 },
    ...patch,
  };
}

/** A baseline declared as one number, with no range and low confidence. */
function pointBaseline(): HumanBaseline {
  return { method: "reference-class", hours: 4, hourlyRateUsd: 100, confidence: "low", source: SOURCE };
}

function malformedBaseline(patch: Record<string, unknown>): HumanBaseline {
  return { ...baseline(), ...patch } as unknown as HumanBaseline;
}

describe("summarizeAgentic", () => {
  test("declares zero observations as unmeasured cost and span, never as zero", () => {
    const totals = summarizeAgentic([]);

    expect(totals.observations).toBe(0);
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.durationMs).toBe(0);
    expect(totals.costUsd).toEqual({ measured: false, reason: "No usage observations were reported." });
    expect(totals.spanMs).toEqual({ measured: false, reason: "No usage observations were reported." });
  });

  test("sums tokens, duration, and cost when every observation reported a cost", () => {
    const totals = summarizeAgentic(reportedRun());

    expect(totals.observations).toBe(3);
    expect(totals.inputTokens).toBe(6000);
    expect(totals.outputTokens).toBe(1200);
    expect(totals.durationMs).toBe(60_000);
    expect(totals.costUsd).toEqual({ measured: true, value: 2 });
    expect(totals.spanMs).toEqual({ measured: true, value: 60_000 });
  });

  test("adds reported costs without floating point drift", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:00:00.000Z", costUsd: 0.1 }),
      observation({ at: "2026-09-22T10:00:01.000Z", costUsd: 0.2 }),
    ]);

    expect(totals.costUsd).toEqual({ measured: true, value: 0.3 });
  });

  test("refuses a partial cost total when at least one observation reported no cost", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:00:00.000Z", costUsd: 0.5 }),
      observation({ at: "2026-09-22T10:00:01.000Z", costUsd: null }),
      observation({ at: "2026-09-22T10:00:02.000Z", costUsd: 1 }),
    ]);

    expect(totals.costUsd).toEqual({ measured: false, reason: "1 of 3 usage observations reported no cost." });
    expect(totals.inputTokens).toBe(3000);
  });

  test("leaves the wall-clock span unmeasured with a single observation", () => {
    const totals = summarizeAgentic([observation()]);

    expect(totals.durationMs).toBe(20_000);
    expect(totals.spanMs).toEqual({
      measured: false,
      reason: "A wall-clock span needs at least two usage observations.",
    });
  });

  test("derives the span from the earliest and latest instant, not from array order", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:01:00.000Z" }),
      observation({ at: "2026-09-22T10:00:00.000Z" }),
      observation({ at: "2026-09-22T10:00:30.000Z" }),
    ]);

    expect(totals.spanMs).toEqual({ measured: true, value: 60_000 });
  });

  test("measures a zero span when two observations share one instant", () => {
    const totals = summarizeAgentic([observation(), observation()]);

    expect(totals.spanMs).toEqual({ measured: true, value: 0 });
  });

  test("rejects observations that cannot be trusted as measures", () => {
    const cases: Record<string, Record<string, unknown>> = {
      "negative input tokens": { inputTokens: -1 },
      "fractional output tokens": { outputTokens: 1.5 },
      "unsafe integer tokens": { inputTokens: Number.MAX_SAFE_INTEGER + 2 },
      "non-finite duration": { durationMs: Number.POSITIVE_INFINITY },
      "not-a-number duration": { durationMs: Number.NaN },
      "negative duration": { durationMs: -1 },
      "negative cost": { costUsd: -0.5 },
      "non-finite cost": { costUsd: Number.POSITIVE_INFINITY },
      "a string cost": { costUsd: "0.50" },
      "an instant without milliseconds": { at: "2026-09-22T10:00:00Z" },
      "an instant without the UTC marker": { at: "2026-09-22T10:00:00.000" },
      "an instant with an offset": { at: "2026-09-22T10:00:00.000+02:00" },
      "an impossible calendar instant": { at: "2026-02-31T10:00:00.000Z" },
      "an empty provider": { provider: "" },
      "a blank model": { model: "   " },
      "an oversized provider": { provider: "p".repeat(129) },
      "an oversized model": { model: "m".repeat(129) },
      "a control character in the provider": { provider: "anth\nropic" },
    };

    for (const [label, patch] of Object.entries(cases)) {
      expect(() => summarizeAgentic([malformedObservation(patch)]), label).toThrow(INVALID);
    }
    expect(() => summarizeAgentic([null] as unknown as readonly UsageObservation[])).toThrow(INVALID);
    expect(() => summarizeAgentic(null as unknown as readonly UsageObservation[])).toThrow(INVALID);
  });

  test("accepts a 128 character provider and model at the boundary", () => {
    const totals = summarizeAgentic([observation({ provider: "p".repeat(128), model: "m".repeat(128) })]);

    expect(totals.observations).toBe(1);
  });
});

describe("validateHumanBaseline", () => {
  test("accepts a fully declared baseline, with a range, without one, and at a zero rate", () => {
    expect(() => validateHumanBaseline(baseline())).not.toThrow();
    expect(() => validateHumanBaseline(pointBaseline())).not.toThrow();
    expect(() => validateHumanBaseline(baseline({ hourlyRateUsd: 0 }))).not.toThrow();
    expect(() => validateHumanBaseline(baseline({ source: "s".repeat(500) }))).not.toThrow();
  });

  test("rejects a baseline a person could not inspect", () => {
    const cases: Record<string, Record<string, unknown>> = {
      "zero hours": { hours: 0 },
      "negative hours": { hours: -1 },
      "non-finite hours": { hours: Number.NaN },
      "a negative hourly rate": { hourlyRateUsd: -1 },
      "a non-finite hourly rate": { hourlyRateUsd: Number.POSITIVE_INFINITY },
      "an empty source": { source: "" },
      "a blank source": { source: "   " },
      "an oversized source": { source: "s".repeat(501) },
      "a control character in the source": { source: "line\nbreak" },
      "an unknown method": { method: "guessed" },
      "an unknown confidence": { confidence: "certain" },
      "an inverted hour range": { hours: 4, rangeHours: { low: 6, high: 3 } },
      "hours below the range": { hours: 1, rangeHours: { low: 3, high: 6 } },
      "hours above the range": { hours: 9, rangeHours: { low: 3, high: 6 } },
      "a non-finite range bound": { rangeHours: { low: 3, high: Number.NaN } },
      "a non-positive range bound": { hours: 4, rangeHours: { low: 0, high: 6 } },
      "a non-object range": { rangeHours: "3 to 6" },
    };

    for (const [label, patch] of Object.entries(cases)) {
      expect(() => validateHumanBaseline(malformedBaseline(patch)), label).toThrow(INVALID);
    }
    expect(() => validateHumanBaseline(null as unknown as HumanBaseline)).toThrow(INVALID);
  });
});

describe("compare", () => {
  test("invents nothing when no human baseline was declared", () => {
    const report = compare(summarizeAgentic(reportedRun()), null);
    const absent = { measured: false, reason: "No human baseline was declared." };

    expect(report.human).toEqual(absent);
    expect(report.comparison.costRatio).toEqual(absent);
    expect(report.comparison.timeRatio).toEqual(absent);
    expect(report.comparison.costRatioRange).toEqual(absent);
    expect(report.caveats).toContain(
      "No human baseline was declared, so the agentic work is not compared with anything.",
    );
    expect(report.method).toBe(
      "Reported 3 agentic observations with no declared human baseline, so every comparison ratio is unmeasured.",
    );
  });

  test("computes ratios and ratio bounds against a declared baseline", () => {
    const report = compare(summarizeAgentic(reportedRun()), baseline());

    expect(report.human).toEqual({
      measured: true,
      value: { costUsd: 400, hours: 4, method: "declared-estimate", confidence: "high", source: SOURCE },
    });
    expect(report.comparison.costRatio).toEqual({ measured: true, value: 200 });
    expect(report.comparison.timeRatio).toEqual({ measured: true, value: 240 });
    expect(report.comparison.costRatioRange).toEqual({ measured: true, value: { low: 150, high: 300 } });
    expect(report.caveats).toEqual([]);
    expect(report.method).toBe(
      "Compared the summed cost and duration of 3 reported agentic observations against a human baseline " +
        "declared by a person: 4.00 hours at 100.000000 USD per hour " +
        "(method declared-estimate, confidence high).",
    );
  });

  test("keeps the cost ratio unmeasured when only some observations reported a cost", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:00:00.000Z", costUsd: 0.5, durationMs: 20_000 }),
      observation({ at: "2026-09-22T10:00:30.000Z", costUsd: null, durationMs: 30_000 }),
      observation({ at: "2026-09-22T10:01:00.000Z", costUsd: 1, durationMs: 10_000 }),
    ]);

    const report = compare(totals, baseline());
    const partial = {
      measured: false,
      reason: "The agentic cost is unmeasured: 1 of 3 usage observations reported no cost.",
    };

    expect(report.comparison.costRatio).toEqual(partial);
    expect(report.comparison.costRatioRange).toEqual(partial);
    expect(report.comparison.timeRatio).toEqual({ measured: true, value: 240 });
    expect(report.caveats).toContain("The agentic cost is only partially reported, so no total cost is claimed.");
  });

  test("refuses to divide by a zero agentic cost", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:00:00.000Z", costUsd: 0 }),
      observation({ at: "2026-09-22T10:00:30.000Z", costUsd: 0 }),
      observation({ at: "2026-09-22T10:01:00.000Z", costUsd: 0 }),
    ]);

    const report = compare(totals, baseline());
    const dividedByZero = {
      measured: false,
      reason: "The reported agentic cost is zero, so a cost ratio would divide by zero.",
    };

    expect(totals.costUsd).toEqual({ measured: true, value: 0 });
    expect(report.comparison.costRatio).toEqual(dividedByZero);
    expect(report.comparison.costRatioRange).toEqual(dividedByZero);
    expect(report.comparison.timeRatio).toEqual({ measured: true, value: 240 });
  });

  test("refuses to divide by a zero agentic duration", () => {
    const totals = summarizeAgentic([
      observation({ at: "2026-09-22T10:00:00.000Z", durationMs: 0 }),
      observation({ at: "2026-09-22T10:00:30.000Z", durationMs: 0 }),
      observation({ at: "2026-09-22T10:01:00.000Z", durationMs: 0 }),
    ]);

    const report = compare(totals, baseline());

    expect(report.comparison.timeRatio).toEqual({
      measured: false,
      reason: "The reported agentic duration is zero, so a time ratio would divide by zero.",
    });
    expect(report.comparison.costRatio.measured).toBe(true);
  });

  test("warns about a low confidence single point baseline read from a thin sample", () => {
    const report = compare(summarizeAgentic([observation()]), pointBaseline());

    expect(report.caveats).toEqual([
      "Fewer than three usage observations were reported (1), so the agentic totals are a thin sample.",
      "The human baseline is declared at low confidence, so the ratios are indicative only.",
      "The human baseline declares a single hour figure with no range, so the ratios look more precise than they are.",
    ]);
    expect(report.comparison.costRatioRange).toEqual({
      measured: false,
      reason: "The declared human baseline has no hour range, so ratio bounds cannot be derived.",
    });
    expect(report.method).toContain("method reference-class, confidence low");
  });

  test("reports overlapping observations when the summed duration exceeds the wall clock", () => {
    const report = compare(
      summarizeAgentic([
        observation({ at: "2026-09-22T10:00:00.000Z", durationMs: 30_000 }),
        observation({ at: "2026-09-22T10:00:10.000Z", durationMs: 30_000 }),
        observation({ at: "2026-09-22T10:00:20.000Z", durationMs: 30_000 }),
      ]),
      baseline(),
    );

    expect(report.caveats).toEqual([
      "The summed agentic duration exceeds the wall-clock span, so some observations overlapped.",
    ]);
  });

  test("reports idle time when the wall clock exceeds the summed duration", () => {
    const report = compare(
      summarizeAgentic([
        observation({ at: "2026-09-22T10:00:00.000Z", durationMs: 1000 }),
        observation({ at: "2026-09-22T10:30:00.000Z", durationMs: 1000 }),
        observation({ at: "2026-09-22T11:00:00.000Z", durationMs: 1000 }),
      ]),
      baseline(),
    );

    expect(report.caveats).toEqual([
      "The wall-clock span exceeds the summed agentic duration, " +
        "so the time ratio leaves out the idle time between observations.",
    ]);
  });

  test("rejects a malformed baseline instead of comparing against it", () => {
    const totals = summarizeAgentic(reportedRun());

    expect(() => compare(totals, malformedBaseline({ hours: 0 }))).toThrow(INVALID);
  });

  test("rejects malformed agentic totals instead of trusting them", () => {
    expect(() => compare({ observations: -1 } as unknown as AgenticTotals, null)).toThrow(INVALID);
    expect(() => compare(null as unknown as AgenticTotals, null)).toThrow(INVALID);
    expect(() => compare(
      { ...summarizeAgentic(reportedRun()), costUsd: { measured: true } } as unknown as AgenticTotals,
      null,
    )).toThrow(INVALID);
  });

  test("keeps the caveats list frozen so a caller cannot edit the record", () => {
    const report = compare(summarizeAgentic([]), null);

    expect(Object.isFrozen(report.caveats)).toBe(true);
  });
});

describe("formatReport", () => {
  test("renders every unmeasured quantity as unmeasured, never as zero", () => {
    const text = formatReport(compare(summarizeAgentic([]), null));

    expect(text).toBe([
      "Accounting report",
      "Method: Reported 0 agentic observations with no declared human baseline, so every comparison ratio is unmeasured.",
      "",
      "Agentic work",
      "  observations:      0",
      "  input tokens:      0",
      "  output tokens:     0",
      "  duration:          0 ms",
      "  cost:              unmeasured (No usage observations were reported.)",
      "  wall-clock span:   unmeasured (No usage observations were reported.)",
      "",
      "Human baseline",
      "  status:            unmeasured (No human baseline was declared.)",
      "",
      "Comparison",
      "  cost ratio:        unmeasured (No human baseline was declared.)",
      "  time ratio:        unmeasured (No human baseline was declared.)",
      "  cost ratio range:  unmeasured (No human baseline was declared.)",
      "",
      "Caveats",
      "  [1] No usage observations were reported, so the agentic totals describe nothing.",
      "  [2] Fewer than three usage observations were reported (0), so the agentic totals are a thin sample.",
      "  [3] No human baseline was declared, so the agentic work is not compared with anything.",
      "",
    ].join("\n"));
  });

  test("renders a fully measured comparison with a fixed decimal separator", () => {
    const text = formatReport(compare(summarizeAgentic(reportedRun()), baseline()));

    expect(text).toBe([
      "Accounting report",
      "Method: Compared the summed cost and duration of 3 reported agentic observations against a human " +
        "baseline declared by a person: 4.00 hours at 100.000000 USD per hour " +
        "(method declared-estimate, confidence high).",
      "",
      "Agentic work",
      "  observations:      3",
      "  input tokens:      6000",
      "  output tokens:     1200",
      "  duration:          60000 ms",
      "  cost:              2.000000 USD",
      "  wall-clock span:   60000 ms",
      "",
      "Human baseline",
      "  hours:             4.00",
      "  cost:              400.000000 USD",
      "  method:            declared-estimate",
      "  confidence:        high",
      `  source:            ${SOURCE}`,
      "",
      "Comparison",
      "  cost ratio:        200.00x",
      "  time ratio:        240.00x",
      "  cost ratio range:  150.00x .. 300.00x",
      "",
      "Caveats",
      "  No caveats were recorded.",
      "",
    ].join("\n"));
  });

  test("never groups digits and never borrows a locale decimal separator", () => {
    const text = formatReport(compare(
      summarizeAgentic([
        observation({ at: "2026-09-22T10:00:00.000Z", inputTokens: 1_234_567, costUsd: 1234.5 }),
        observation({ at: "2026-09-22T10:00:30.000Z", inputTokens: 1_000_000, costUsd: 0.005 }),
        observation({ at: "2026-09-22T10:01:00.000Z", inputTokens: 1, costUsd: 0.5 }),
      ]),
      baseline({ hours: 12.5, hourlyRateUsd: 99.99, rangeHours: { low: 10, high: 20 } }),
    ));

    // Comma, no-break space, and narrow no-break space are the usual locale digit groupers.
    const grouping = new RegExp(`\\d[,${String.fromCharCode(0x00a0, 0x202f)}]\\d`, "u");

    expect(text).toContain("  input tokens:      2234568");
    expect(text).toContain("  cost:              1235.005000 USD");
    expect(text).toContain("  cost:              1249.875000 USD");
    expect(text).not.toMatch(grouping);
  });

  test("is deterministic across repeated calls", () => {
    const report = compare(summarizeAgentic(reportedRun()), pointBaseline());

    expect(formatReport(report)).toBe(formatReport(report));
  });

  test("distinguishes a measured zero span from an unmeasured span", () => {
    const measuredZero = formatReport(compare(summarizeAgentic([observation(), observation()]), null));
    const noSpan = formatReport(compare(summarizeAgentic([observation()]), null));

    expect(measuredZero).toContain("  wall-clock span:   0 ms");
    expect(noSpan).toContain(
      "  wall-clock span:   unmeasured (A wall-clock span needs at least two usage observations.)",
    );
  });
});
