import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";

import { ForgeyardError } from "../core/errors.js";
import { resolveInsideRoot } from "../core/paths.js";
import type { TaskRuntimeStatus } from "../orchestrator/contracts.js";

export type TaskTransitionAction = "claim" | "checkpoint" | "resume" | "complete" | "fail" | "cancel";

export interface TaskTransitionInput {
  action: TaskTransitionAction;
  taskId: string;
  workerId: string;
  graphSha256: string;
  runtimeStatus: TaskRuntimeStatus;
}

export interface UsageObservationInput {
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface LedgerPorts {
  clock: { now(): Date };
  ids: { next(): string };
}

export interface LedgerWriteResult {
  eventId: string;
  path: string;
}

export interface TaskUsageSummary {
  observations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface UsageSummary {
  observed: boolean;
  totalCostUsd: number;
  byTask: Record<string, TaskUsageSummary>;
}

interface PersistedUsageEvent {
  kind: "usage";
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

let eventValidator: ValidateFunction | undefined;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const COST_PRECISION = 1_000_000;

const defaultPorts: LedgerPorts = {
  clock: { now: () => new Date() },
  ids: {
    next: () => `event-${new Date().toISOString().replaceAll(/[^0-9]/g, "")}-${randomBytes(6).toString("hex")}`,
  },
};

function ledgerError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_LEDGER_INVALID",
    message,
    remediation: "Record only explicit non-negative usage totals and short public provider/model identifiers.",
    exitCode: 9,
    ...(paths === undefined ? {} : { paths }),
  });
}

function validator(): ValidateFunction {
  if (eventValidator !== undefined) return eventValidator;
  const schemaUrl = new URL("../../schemas/ledger-event.schema.json", import.meta.url);
  const schemaPath = decodeURIComponent(schemaUrl.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false });
  formatsModule.default.default(ajv);
  eventValidator = ajv.compile(schema);
  return eventValidator;
}

function validationText(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en")).join("; ") || "unknown schema error";
}

function emptyUsageSummary(): UsageSummary {
  return { observed: false, totalCostUsd: 0, byTask: {} };
}

function costUnits(value: number): number {
  return Math.round(value * COST_PRECISION);
}

function isUsageEvent(value: unknown): value is PersistedUsageEvent {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "usage";
}

export async function readUsageSummary(rootInput: string): Promise<UsageSummary> {
  const root = path.resolve(rootInput);
  const ledgerPath = resolveInsideRoot(root, ".forgeyard/ledger/events.jsonl");
  let details;
  try {
    details = await lstat(ledgerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyUsageSummary();
    throw ledgerError("Unable to inspect the local usage ledger.", [ledgerPath]);
  }
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_LEDGER_BYTES) {
    throw ledgerError("The local usage ledger is not a bounded regular file.", [ledgerPath]);
  }

  let source: string;
  try {
    const bytes = await readFile(ledgerPath);
    if (bytes.byteLength > MAX_LEDGER_BYTES) {
      throw ledgerError("The local usage ledger exceeds the supported size limit.", [ledgerPath]);
    }
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ForgeyardError) throw error;
    throw ledgerError("Unable to read the local usage ledger as UTF-8.", [ledgerPath]);
  }
  if (source.includes("\0")) throw ledgerError("The local usage ledger contains forbidden NUL bytes.", [ledgerPath]);

  const validate = validator();
  const byTaskUnits = new Map<string, TaskUsageSummary>();
  let totalCostUnits = 0;
  let observed = false;
  for (const line of source.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw ledgerError("The local usage ledger contains invalid JSON.", [ledgerPath]);
    }
    if (!validate(event)) {
      throw ledgerError(`Ledger event failed schema validation: ${validationText(validate.errors)}`, [ledgerPath]);
    }
    if (!isUsageEvent(event)) continue;
    observed = true;
    const previous = byTaskUnits.get(event.taskId) ?? {
      observations: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 0,
    };
    const eventCostUnits = costUnits(event.costUsd);
    previous.observations += 1;
    previous.inputTokens += event.inputTokens;
    previous.outputTokens += event.outputTokens;
    previous.costUsd += eventCostUnits;
    previous.durationMs += event.durationMs;
    totalCostUnits += eventCostUnits;
    byTaskUnits.set(event.taskId, previous);
  }

  const byTask = Object.fromEntries([...byTaskUnits.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([taskId, summary]) => [taskId, {
      ...summary,
      costUsd: summary.costUsd / COST_PRECISION,
    }]));
  return { observed, totalCostUsd: totalCostUnits / COST_PRECISION, byTask };
}

async function appendEvent(rootInput: string, event: object): Promise<LedgerWriteResult> {
  const validate = validator();
  if (!validate(event)) throw ledgerError(`Ledger event failed schema validation: ${validationText(validate.errors)}`);
  const root = path.resolve(rootInput);
  const ledgerPath = resolveInsideRoot(root, ".forgeyard/ledger/events.jsonl");
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  try {
    await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    throw ledgerError("Unable to append the local ledger event.", [ledgerPath]);
  }
  return { eventId: (event as { eventId: string }).eventId, path: ledgerPath };
}

export async function appendTaskTransition(
  root: string,
  input: TaskTransitionInput,
  ports: LedgerPorts = defaultPorts,
): Promise<LedgerWriteResult> {
  const event = {
    schemaVersion: 1,
    eventId: ports.ids.next(),
    recordedAt: ports.clock.now().toISOString(),
    kind: "task-transition",
    ...input,
  };
  return appendEvent(root, event);
}

export async function appendUsageObservation(
  root: string,
  input: UsageObservationInput,
  ports: LedgerPorts = defaultPorts,
): Promise<LedgerWriteResult> {
  const event = {
    schemaVersion: 1,
    eventId: ports.ids.next(),
    recordedAt: ports.clock.now().toISOString(),
    kind: "usage",
    ...input,
  };
  return appendEvent(root, event);
}
