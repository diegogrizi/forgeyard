/**
 * Declared accounting of agentic cost and time against an explicit human baseline (G5).
 *
 * The module is a pure primitive: no I/O, no clock, no randomness. It receives measures
 * that were already read elsewhere and reports only what those measures support. The one
 * rule that gives the numbers their value: a measure that was not reported comes back as
 * `unmeasured` with a reason, never as zero and never as a plausible guess.
 */

import { ForgeyardError } from "../core/errors.js";

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_SOURCE_LENGTH = 500;
const MICRO_USD = 1_000_000;
const MS_PER_HOUR = 3_600_000;
const THIN_SAMPLE = 3;
const USD_DECIMALS = 6;
const HOURS_DECIMALS = 2;
const RATIO_DECIMALS = 2;
const LABEL_WIDTH = 18;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BASELINE_METHODS: readonly string[] = ["declared-estimate", "reference-class"];
const BASELINE_CONFIDENCES: readonly string[] = ["high", "medium", "low"];

/** One explicitly reported observation. Nothing is inferred from silence. */
export interface UsageObservation {
  at: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
}

/** The human comparison must be declared by a person; it is never inferred. */
export interface HumanBaseline {
  method: "declared-estimate" | "reference-class";
  hours: number;
  hourlyRateUsd: number;
  confidence: "high" | "medium" | "low";
  source: string;
  /** Optional low/high hour bounds; when present, low <= hours <= high. */
  rangeHours?: { low: number; high: number };
}

export type Measured<T> = { measured: true; value: T } | { measured: false; reason: string };

export interface AgenticTotals {
  observations: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Measured only when EVERY observation reported a cost. A partial sum is a lie. */
  costUsd: Measured<number>;
  /** Wall-clock span from first to last observation; needs >= 2 observations. */
  spanMs: Measured<number>;
}

export interface Comparison {
  /** humanCostUsd / agenticCostUsd. */
  costRatio: Measured<number>;
  /** humanHours*3600000 / agenticDurationMs. */
  timeRatio: Measured<number>;
  /** Ratio bounds derived from baseline.rangeHours, when declared. */
  costRatioRange: Measured<{ low: number; high: number }>;
}

export interface HumanTotals {
  costUsd: number;
  hours: number;
  method: HumanBaseline["method"];
  confidence: HumanBaseline["confidence"];
  source: string;
}

export interface AccountingReport {
  agentic: AgenticTotals;
  human: Measured<HumanTotals>;
  comparison: Comparison;
  /** English, one line, states exactly what was compared and how. */
  method: string;
  /** English caveats the reader must see, e.g. partial cost reporting, low confidence. */
  caveats: readonly string[];
}

export function measured<T>(value: T): Measured<T> {
  return { measured: true, value };
}

export function unmeasured(reason: string): Measured<never> {
  return { measured: false, reason };
}

function measureError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_MEASURE_INVALID",
    message,
    remediation: "Report explicit non-negative measures and declare the human baseline by hand.",
    exitCode: 2,
  });
}

/** Rejects C0 controls and DEL so every reported string stays a single printable line. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw measureError(`${label} must be a non-negative safe integer.`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw measureError(`${label} must be a non-empty identifier.`);
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw measureError(`${label} must not exceed ${MAX_IDENTIFIER_LENGTH} characters.`);
  }
  if (hasControlCharacter(value)) {
    throw measureError(`${label} must not contain control characters.`);
  }
}

/** Parses a strict ISO-8601 UTC instant with milliseconds and returns its epoch offset. */
function assertInstant(value: string, label: string): number {
  if (typeof value !== "string" || !INSTANT_PATTERN.test(value)) {
    throw measureError(`${label} must be an ISO-8601 UTC instant with milliseconds, such as 2026-09-22T10:00:00.000Z.`);
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== value) {
    throw measureError(`${label} must be a real calendar instant.`);
  }
  return epochMs;
}

/**
 * Converts a USD amount to whole micro-USD. Accumulating integers keeps a sum of many
 * reported costs from drifting, and bounds how large an amount the module will accept.
 */
function toMicroUsd(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw measureError(`${label} must be a finite non-negative amount in USD.`);
  }
  const micro = Math.round(value * MICRO_USD);
  if (!Number.isSafeInteger(micro)) {
    throw measureError(`${label} exceeds the supported precision range.`);
  }
  return micro;
}

function assertMeasuredNumber(value: Measured<number>, label: string): void {
  if (typeof value !== "object" || value === null) {
    throw measureError(`${label} must be a measured or unmeasured record.`);
  }
  if (value.measured === true) {
    if (!Number.isFinite(value.value) || value.value < 0) {
      throw measureError(`${label} must be a finite non-negative number when it is measured.`);
    }
    return;
  }
  if (value.measured === false) {
    if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
      throw measureError(`${label} must carry a reason when it is unmeasured.`);
    }
    return;
  }
  throw measureError(`${label} must declare whether it is measured.`);
}

function assertTotals(totals: AgenticTotals): void {
  if (typeof totals !== "object" || totals === null) {
    throw measureError("The agentic totals must be an object.");
  }
  assertCount(totals.observations, "The agentic observation count");
  assertCount(totals.inputTokens, "The agentic input token total");
  assertCount(totals.outputTokens, "The agentic output token total");
  assertCount(totals.durationMs, "The agentic duration total");
  assertMeasuredNumber(totals.costUsd, "The agentic cost total");
  assertMeasuredNumber(totals.spanMs, "The agentic wall-clock span");
}

export function summarizeAgentic(observations: readonly UsageObservation[]): AgenticTotals {
  if (!Array.isArray(observations)) {
    throw measureError("Usage observations must be reported as an array.");
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let durationMs = 0;
  let costMicroUsd = 0;
  let unreportedCosts = 0;
  let earliest: number | undefined;
  let latest: number | undefined;

  for (const [index, observation] of observations.entries()) {
    if (typeof observation !== "object" || observation === null) {
      throw measureError(`Usage observation ${index} must be an object.`);
    }
    assertIdentifier(observation.provider, `Usage observation ${index} provider`);
    assertIdentifier(observation.model, `Usage observation ${index} model`);
    assertCount(observation.inputTokens, `Usage observation ${index} input tokens`);
    assertCount(observation.outputTokens, `Usage observation ${index} output tokens`);
    assertCount(observation.durationMs, `Usage observation ${index} duration`);
    const epochMs = assertInstant(observation.at, `Usage observation ${index} instant`);

    if (observation.costUsd === null) {
      unreportedCosts += 1;
    } else {
      costMicroUsd += toMicroUsd(observation.costUsd, `Usage observation ${index} cost`);
    }

    inputTokens += observation.inputTokens;
    outputTokens += observation.outputTokens;
    durationMs += observation.durationMs;
    earliest = earliest === undefined || epochMs < earliest ? epochMs : earliest;
    latest = latest === undefined || epochMs > latest ? epochMs : latest;
  }

  assertCount(inputTokens, "The summed input tokens");
  assertCount(outputTokens, "The summed output tokens");
  assertCount(durationMs, "The summed duration");
  if (!Number.isSafeInteger(costMicroUsd)) {
    throw measureError("The summed agentic cost exceeds the supported precision range.");
  }

  const count = observations.length;
  let costUsd: Measured<number>;
  if (count === 0) {
    costUsd = unmeasured("No usage observations were reported.");
  } else if (unreportedCosts > 0) {
    costUsd = unmeasured(`${unreportedCosts} of ${count} usage observations reported no cost.`);
  } else {
    costUsd = measured(costMicroUsd / MICRO_USD);
  }

  let spanMs: Measured<number>;
  if (count === 0) {
    spanMs = unmeasured("No usage observations were reported.");
  } else if (count < 2 || earliest === undefined || latest === undefined) {
    spanMs = unmeasured("A wall-clock span needs at least two usage observations.");
  } else {
    spanMs = measured(latest - earliest);
  }

  return { observations: count, inputTokens, outputTokens, durationMs, costUsd, spanMs };
}

export function validateHumanBaseline(baseline: HumanBaseline): void {
  if (typeof baseline !== "object" || baseline === null) {
    throw measureError("The human baseline must be an object declared by a person.");
  }
  if (!BASELINE_METHODS.includes(baseline.method)) {
    throw measureError('The human baseline method must be "declared-estimate" or "reference-class".');
  }
  if (!BASELINE_CONFIDENCES.includes(baseline.confidence)) {
    throw measureError('The human baseline confidence must be "high", "medium", or "low".');
  }
  if (!Number.isFinite(baseline.hours) || baseline.hours <= 0) {
    throw measureError("The human baseline hours must be a finite number greater than zero.");
  }
  if (!Number.isFinite(baseline.hourlyRateUsd) || baseline.hourlyRateUsd < 0) {
    throw measureError("The human baseline hourly rate must be a finite non-negative amount in USD.");
  }
  if (typeof baseline.source !== "string" || baseline.source.trim().length === 0 ||
    baseline.source.length > MAX_SOURCE_LENGTH) {
    throw measureError(`The human baseline source must be inspectable prose of 1 to ${MAX_SOURCE_LENGTH} characters.`);
  }
  if (hasControlCharacter(baseline.source)) {
    throw measureError("The human baseline source must not contain control characters.");
  }

  const range = baseline.rangeHours;
  if (range !== undefined) {
    if (typeof range !== "object" || range === null) {
      throw measureError("The human baseline hour range must declare a low and a high bound.");
    }
    if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) {
      throw measureError("The human baseline hour range bounds must be finite numbers.");
    }
    if (range.low <= 0) {
      throw measureError("The human baseline hour range low bound must be greater than zero.");
    }
    if (range.low > range.high) {
      throw measureError("The human baseline hour range low bound must not exceed its high bound.");
    }
    if (baseline.hours < range.low || baseline.hours > range.high) {
      throw measureError("The human baseline hours must fall inside the declared hour range.");
    }
    toMicroUsd(range.high * baseline.hourlyRateUsd, "The human baseline high cost bound");
  }
  toMicroUsd(baseline.hours * baseline.hourlyRateUsd, "The human baseline cost");
}

function humanCostUsd(hours: number, hourlyRateUsd: number, label: string): number {
  return toMicroUsd(hours * hourlyRateUsd, label) / MICRO_USD;
}

/** Caveats that depend only on the reported agentic side, in a fixed order. */
function agenticCaveats(totals: AgenticTotals): string[] {
  const caveats: string[] = [];
  if (totals.observations === 0) {
    caveats.push("No usage observations were reported, so the agentic totals describe nothing.");
  }
  if (totals.observations < THIN_SAMPLE) {
    caveats.push(
      `Fewer than three usage observations were reported (${totals.observations}), ` +
        "so the agentic totals are a thin sample.",
    );
  }
  if (totals.observations > 0 && !totals.costUsd.measured) {
    caveats.push("The agentic cost is only partially reported, so no total cost is claimed.");
  }
  if (totals.spanMs.measured && totals.durationMs > totals.spanMs.value) {
    caveats.push("The summed agentic duration exceeds the wall-clock span, so some observations overlapped.");
  }
  if (totals.spanMs.measured && totals.spanMs.value > totals.durationMs) {
    caveats.push(
      "The wall-clock span exceeds the summed agentic duration, " +
        "so the time ratio leaves out the idle time between observations.",
    );
  }
  return caveats;
}

export function compare(totals: AgenticTotals, baseline: HumanBaseline | null): AccountingReport {
  assertTotals(totals);
  const agentic = Object.freeze({ ...totals });
  const caveats = agenticCaveats(totals);

  if (baseline === null) {
    const reason = "No human baseline was declared.";
    caveats.push("No human baseline was declared, so the agentic work is not compared with anything.");
    return {
      agentic,
      human: unmeasured(reason),
      comparison: {
        costRatio: unmeasured(reason),
        timeRatio: unmeasured(reason),
        costRatioRange: unmeasured(reason),
      },
      method: `Reported ${totals.observations} agentic observations with no declared human baseline, ` +
        "so every comparison ratio is unmeasured.",
      caveats: Object.freeze(caveats),
    };
  }

  validateHumanBaseline(baseline);
  if (baseline.confidence === "low") {
    caveats.push("The human baseline is declared at low confidence, so the ratios are indicative only.");
  }
  if (baseline.rangeHours === undefined) {
    caveats.push(
      "The human baseline declares a single hour figure with no range, " +
        "so the ratios look more precise than they are.",
    );
  }

  const humanCost = humanCostUsd(baseline.hours, baseline.hourlyRateUsd, "The human baseline cost");
  let costRatio: Measured<number>;
  let costRatioRange: Measured<{ low: number; high: number }>;
  if (!totals.costUsd.measured) {
    const reason = `The agentic cost is unmeasured: ${totals.costUsd.reason}`;
    costRatio = unmeasured(reason);
    costRatioRange = unmeasured(reason);
  } else if (totals.costUsd.value <= 0) {
    const reason = "The reported agentic cost is zero, so a cost ratio would divide by zero.";
    costRatio = unmeasured(reason);
    costRatioRange = unmeasured(reason);
  } else {
    const agenticCost = totals.costUsd.value;
    const range = baseline.rangeHours;
    costRatio = measured(humanCost / agenticCost);
    costRatioRange = range === undefined
      ? unmeasured("The declared human baseline has no hour range, so ratio bounds cannot be derived.")
      : measured({
        low: humanCostUsd(range.low, baseline.hourlyRateUsd, "The human baseline low cost bound") / agenticCost,
        high: humanCostUsd(range.high, baseline.hourlyRateUsd, "The human baseline high cost bound") / agenticCost,
      });
  }

  const timeRatio: Measured<number> = totals.durationMs > 0
    ? measured((baseline.hours * MS_PER_HOUR) / totals.durationMs)
    : unmeasured("The reported agentic duration is zero, so a time ratio would divide by zero.");

  return {
    agentic,
    human: measured({
      costUsd: humanCost,
      hours: baseline.hours,
      method: baseline.method,
      confidence: baseline.confidence,
      source: baseline.source,
    }),
    comparison: { costRatio, timeRatio, costRatioRange },
    method: `Compared the summed cost and duration of ${totals.observations} reported agentic observations ` +
      `against a human baseline declared by a person: ${baseline.hours.toFixed(HOURS_DECIMALS)} hours at ` +
      `${formatUsd(baseline.hourlyRateUsd)} USD per hour ` +
      `(method ${baseline.method}, confidence ${baseline.confidence}).`,
    caveats: Object.freeze(caveats),
  };
}

function formatUsd(value: number): string {
  return value.toFixed(USD_DECIMALS);
}

function formatRatio(value: number): string {
  return `${value.toFixed(RATIO_DECIMALS)}x`;
}

function field(label: string, value: string): string {
  return `  ${`${label}:`.padEnd(LABEL_WIDTH)} ${value}`;
}

/** Renders a measure, or the literal word `unmeasured` with its reason. Never a zero. */
function renderMeasure<T>(measure: Measured<T>, render: (value: T) => string): string {
  return measure.measured ? render(measure.value) : `unmeasured (${measure.reason})`;
}

export function formatReport(report: AccountingReport): string {
  const lines: string[] = [
    "Accounting report",
    `Method: ${report.method}`,
    "",
    "Agentic work",
    field("observations", `${report.agentic.observations}`),
    field("input tokens", `${report.agentic.inputTokens}`),
    field("output tokens", `${report.agentic.outputTokens}`),
    field("duration", `${report.agentic.durationMs} ms`),
    field("cost", renderMeasure(report.agentic.costUsd, (value) => `${formatUsd(value)} USD`)),
    field("wall-clock span", renderMeasure(report.agentic.spanMs, (value) => `${value} ms`)),
    "",
    "Human baseline",
  ];

  if (report.human.measured) {
    const human = report.human.value;
    lines.push(field("hours", human.hours.toFixed(HOURS_DECIMALS)));
    lines.push(field("cost", `${formatUsd(human.costUsd)} USD`));
    lines.push(field("method", human.method));
    lines.push(field("confidence", human.confidence));
    lines.push(field("source", human.source));
  } else {
    lines.push(field("status", `unmeasured (${report.human.reason})`));
  }

  lines.push("", "Comparison");
  lines.push(field("cost ratio", renderMeasure(report.comparison.costRatio, formatRatio)));
  lines.push(field("time ratio", renderMeasure(report.comparison.timeRatio, formatRatio)));
  lines.push(field("cost ratio range", renderMeasure(
    report.comparison.costRatioRange,
    (bounds) => `${formatRatio(bounds.low)} .. ${formatRatio(bounds.high)}`,
  )));

  lines.push("", "Caveats");
  if (report.caveats.length === 0) {
    lines.push("  No caveats were recorded.");
  } else {
    for (const [index, caveat] of report.caveats.entries()) {
      lines.push(`  [${index + 1}] ${caveat}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
