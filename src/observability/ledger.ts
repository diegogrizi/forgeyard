import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

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

let eventValidator: ValidateFunction | undefined;

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
