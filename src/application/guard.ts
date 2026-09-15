import path from "node:path";

import { loadConfig } from "../config/config.js";
import { ForgeyardError } from "../core/errors.js";
import { evaluateWritePath, type WriteGuardDecision } from "../guard/evaluate.js";
import { loadTaskGraph } from "../orchestrator/graph.js";
import { readPersistedRunState } from "../orchestrator/state.js";

export interface GuardCommandInput {
  root: string;
  taskId: string;
  paths: readonly string[];
}

export interface GuardCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "guard";
  root: string;
  taskId: string;
  allowed: true;
  paths: readonly string[];
}

function denied(taskId: string, candidate: string, decision: WriteGuardDecision): ForgeyardError {
  return new ForgeyardError({
    code: "FY_SCOPE_DENIED",
    message: `Task ${taskId} cannot write the requested path (${decision.reason}).`,
    remediation: "Use a path inside the claimed task write scopes and outside every protected project path.",
    exitCode: 9,
    paths: [candidate],
  });
}

export async function runGuardCommand(input: GuardCommandInput): Promise<GuardCommandResult> {
  const root = path.resolve(input.root);
  if (input.paths.length === 0) {
    throw new ForgeyardError({
      code: "FY_SCOPE_DENIED",
      message: "At least one candidate write path is required.",
      remediation: "Pass one or more project paths to the guard command.",
      exitCode: 9,
    });
  }
  const config = await loadConfig(path.join(root, "forgeyard.yaml"));
  const graph = await loadTaskGraph({
    root,
    mutableRoots: config.paths.mutableRoots,
    protectedPaths: config.paths.protectedPaths,
  });
  const state = await readPersistedRunState(root, graph);
  const runtime = state.tasks[input.taskId];
  const task = graph.tasks.find((entry) => entry.task.id === input.taskId)?.task;
  if (runtime?.status !== "active" || task === undefined || runtime.guard === undefined) {
    throw new ForgeyardError({
      code: "FY_TASK_OWNERSHIP",
      message: `Task ${input.taskId} is not actively claimed with a guard snapshot.`,
      remediation: "Claim the task before requesting permission to write files.",
      exitCode: 9,
    });
  }

  const normalized: string[] = [];
  for (const candidate of input.paths) {
    const decision = await evaluateWritePath({
      root,
      cwd: root,
      candidate,
      writeScopes: runtime.guard.writeScopes,
      protectedPaths: runtime.guard.protectedPaths,
    });
    if (!decision.allowed || decision.relativePath === undefined) throw denied(input.taskId, candidate, decision);
    normalized.push(decision.relativePath);
  }
  return { schemaVersion: 1, ok: true, command: "guard", root, taskId: input.taskId, allowed: true, paths: normalized };
}
