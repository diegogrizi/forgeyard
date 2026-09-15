import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";

import { ForgeyardError } from "../core/errors.js";
import { resolveInsideRoot } from "../core/paths.js";
import type { RunState, TaskGraph } from "./contracts.js";

const LOCK_STALE_MS = 120_000;
let runStateValidator: ValidateFunction | undefined;

export interface StateClock {
  now(): Date;
}

export interface StateMutation<T> {
  value: T;
  changed: boolean;
}

export interface RunStateStore {
  transact<T>(
    graph: TaskGraph,
    clock: StateClock,
    operation: (state: RunState) => Promise<StateMutation<T>> | StateMutation<T>,
  ): Promise<T>;
}

function stateError(code: string, message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code,
    message,
    remediation: code === "FY_STATE_BUSY"
      ? "Wait for the current Forgeyard state transition to finish, then retry."
      : "Inspect or archive the local run state before starting a new task graph.",
    exitCode: 9,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function validator(): ValidateFunction {
  if (runStateValidator !== undefined) return runStateValidator;
  const schemaUrl = new URL("../../schemas/run-state.schema.json", import.meta.url);
  const schemaPath = decodeURIComponent(schemaUrl.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false });
  formatsModule.default.default(ajv);
  runStateValidator = ajv.compile(schema);
  return runStateValidator;
}

function validationText(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ") || "unknown schema error";
}

export function serializeRunState(state: RunState): string {
  const validate = validator();
  if (!validate(state)) {
    throw stateError("FY_STATE_INVALID", `Run state failed schema validation: ${validationText(validate.errors)}`);
  }
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function parseRunState(source: string, sourcePath: string): RunState {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw stateError("FY_STATE_INVALID", "Run state is not valid JSON.", [sourcePath], error);
  }
  const validate = validator();
  if (!validate(value)) {
    throw stateError(
      "FY_STATE_INVALID",
      `Run state failed schema validation: ${validationText(validate.errors)}`,
      [sourcePath],
    );
  }
  return value as RunState;
}

function initialState(graph: TaskGraph, now: string): RunState {
  return {
    schemaVersion: 1,
    graphSha256: graph.graphSha256,
    createdAt: now,
    updatedAt: now,
    stopped: null,
    tasks: Object.fromEntries(graph.tasks.map((entry) => [entry.task.id, {
      definitionSha256: entry.definitionSha256,
      status: "pending" as const,
      attempts: 0,
      consecutiveFailures: 0,
    }])),
  };
}

function assertMatchesGraph(state: RunState, graph: TaskGraph, statePath: string): void {
  if (state.graphSha256 !== graph.graphSha256) {
    throw stateError(
      "FY_STATE_STALE",
      "The persisted run state belongs to a different task graph.",
      [statePath],
    );
  }
  const stateIds = Object.keys(state.tasks).sort();
  const graphIds = graph.tasks.map((entry) => entry.task.id).sort();
  if (JSON.stringify(stateIds) !== JSON.stringify(graphIds)) {
    throw stateError("FY_STATE_STALE", "The persisted run state task set has drifted.", [statePath]);
  }
  for (const entry of graph.tasks) {
    if (state.tasks[entry.task.id]?.definitionSha256 !== entry.definitionSha256) {
      throw stateError("FY_STATE_STALE", `Task ${entry.task.id} changed after the run began.`, [entry.path]);
    }
  }
}

async function acquireLock(lockPath: string, clock: StateClock): Promise<Awaited<ReturnType<typeof open>>> {
  const attempt = async () => {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: clock.now().toISOString() })}\n`, "utf8");
    return handle;
  };
  try {
    return await attempt();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw stateError("FY_STATE_INVALID", "Unable to create the run-state lock.", [lockPath], error);
    try {
      const details = await stat(lockPath);
      if (clock.now().getTime() - details.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        return await attempt();
      }
    } catch (recoveryError) {
      throw stateError("FY_STATE_BUSY", "The run-state lock could not be inspected safely.", [lockPath], recoveryError);
    }
    throw stateError("FY_STATE_BUSY", "Another process is updating the Forgeyard run state.", [lockPath]);
  }
}

export function createFileRunStateStore(rootInput: string): RunStateStore {
  const root = path.resolve(rootInput);
  const statePath = resolveInsideRoot(root, ".forgeyard/state/run.json");
  const lockPath = resolveInsideRoot(root, ".forgeyard/state/run.lock");
  return {
    async transact(graph, clock, operation) {
      await mkdir(path.dirname(statePath), { recursive: true });
      const lock = await acquireLock(lockPath, clock);
      try {
        let state: RunState;
        let created = false;
        try {
          state = parseRunState(await readFile(statePath, "utf8"), statePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          state = initialState(graph, clock.now().toISOString());
          created = true;
        }
        assertMatchesGraph(state, graph, statePath);
        const mutation = await operation(state);
        if (created || mutation.changed) {
          state.updatedAt = clock.now().toISOString();
          const temporaryPath = `${statePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
          try {
            await writeFile(temporaryPath, serializeRunState(state), { encoding: "utf8", flag: "wx", mode: 0o600 });
            await rename(temporaryPath, statePath);
          } catch (error) {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
            throw stateError("FY_STATE_INVALID", "Unable to persist run state atomically.", [statePath], error);
          }
        }
        return mutation.value;
      } finally {
        await lock.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      }
    },
  };
}
