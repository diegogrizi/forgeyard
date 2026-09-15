import { readdir } from "node:fs/promises";
import path from "node:path";

import type { VerificationTask } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { loadTask } from "../evidence/receipts.js";
import type {
  LoadedWorkflowTask,
  LoadTaskGraphInput,
  TaskGraph,
  WorkflowTask,
} from "./contracts.js";

function graphError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_GRAPH_INVALID",
    message,
    remediation: "Correct the task definitions and dependency graph before scheduling work.",
    exitCode: 9,
    ...(paths === undefined ? {} : { paths }),
  });
}

function scopeError(message: string, scopes: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_SCOPE_DENIED",
    message,
    remediation: "Keep each task write scope inside a configured mutable root and outside protected paths.",
    exitCode: 9,
    paths: scopes,
  });
}

function key(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsPath(parent: string, candidate: string): boolean {
  const normalizedParent = key(parent);
  const normalizedCandidate = key(candidate);
  return normalizedParent === "." || normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function normalizedDistinctPaths(values: readonly string[]): readonly string[] {
  const normalized = values.map(normalizePortablePath);
  assertNoCaseCollisions(normalized);
  const seen = new Set<string>();
  return normalized.filter((value) => {
    const normalizedKey = key(value);
    if (seen.has(normalizedKey)) return false;
    seen.add(normalizedKey);
    return true;
  });
}

function normalizeTask(
  task: VerificationTask,
  mutableRoots: readonly string[],
  protectedPaths: readonly string[],
): WorkflowTask {
  const writeScopes = normalizedDistinctPaths(task.writeScopes ?? mutableRoots);
  for (const scope of writeScopes) {
    if (!mutableRoots.some((root) => containsPath(root, scope))) {
      throw scopeError(`Task ${task.id} declares a write scope outside every mutable root.`, [scope]);
    }
    if (protectedPaths.some((protectedPath) => containsPath(protectedPath, scope))) {
      throw scopeError(`Task ${task.id} declares a write scope inside a protected path.`, [scope]);
    }
  }

  return {
    schemaVersion: 1,
    id: task.id,
    title: task.title,
    objective: task.objective ?? task.title,
    acceptanceCriteria: task.acceptanceCriteria ?? ["The verification command exits successfully."],
    dependsOn: task.dependsOn ?? [],
    writeScopes,
    role: task.role ?? "implementer",
    capabilities: task.capabilities ?? [],
    limits: task.limits ?? { minutes: 60, maxRetries: 2 },
    evidence: task.evidence ?? { required: task.required },
    integration: task.integration ?? { owner: "integrator", target: "current" },
    command: task.command,
    required: true,
  };
}

function assertDependencies(tasks: readonly LoadedWorkflowTask[]): void {
  const ids = new Set(tasks.map((entry) => entry.task.id));
  for (const entry of tasks) {
    if (entry.task.dependsOn.includes(entry.task.id)) {
      throw graphError(`Task ${entry.task.id} depends on itself.`, [entry.path]);
    }
    for (const dependency of entry.task.dependsOn) {
      if (!ids.has(dependency)) {
        throw graphError(`Task ${entry.task.id} depends on missing task ${dependency}.`, [entry.path]);
      }
    }
  }

  const indegree = new Map(tasks.map((entry) => [entry.task.id, entry.task.dependsOn.length]));
  const dependants = new Map<string, string[]>();
  for (const entry of tasks) {
    for (const dependency of entry.task.dependsOn) {
      const values = dependants.get(dependency) ?? [];
      values.push(entry.task.id);
      dependants.set(dependency, values);
    }
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const dependant of (dependants.get(id) ?? []).sort()) {
      const next = indegree.get(dependant)! - 1;
      indegree.set(dependant, next);
      if (next === 0) queue.push(dependant);
    }
    queue.sort();
  }
  if (visited !== tasks.length) throw graphError("The task graph contains a dependency cycle.");
}

export async function loadTaskGraph(input: LoadTaskGraphInput): Promise<TaskGraph> {
  const root = path.resolve(input.root);
  const mutableRoots = normalizedDistinctPaths(input.mutableRoots);
  const protectedPaths = normalizedDistinctPaths(input.protectedPaths);
  const taskDirectory = resolveInsideRoot(root, ".forgeyard/tasks");
  let fileNames: string[];
  try {
    const entries = await readdir(taskDirectory, { withFileTypes: true });
    fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    throw graphError("Unable to read the installed task directory.", [taskDirectory]);
  }
  if (fileNames.length === 0) throw graphError("The installed task graph is empty.", [taskDirectory]);

  const tasks: LoadedWorkflowTask[] = [];
  for (const fileName of fileNames) {
    const id = fileName.slice(0, -".yaml".length);
    const loaded = await loadTask(root, id);
    tasks.push({
      task: normalizeTask(loaded.task, mutableRoots, protectedPaths),
      source: loaded.source,
      definitionSha256: loaded.sha256,
      path: loaded.path,
    });
  }
  assertDependencies(tasks);
  const graphSha256 = sha256Text(canonicalJson({
    tasks: tasks.map((entry) => ({ id: entry.task.id, definitionSha256: entry.definitionSha256 })),
    mutableRoots,
    protectedPaths,
  }));
  return { tasks, graphSha256, mutableRoots, protectedPaths };
}

export function readyTaskIds(graph: TaskGraph, completedTaskIds: ReadonlySet<string>): readonly string[] {
  return graph.tasks
    .filter((entry) => !completedTaskIds.has(entry.task.id))
    .filter((entry) => entry.task.dependsOn.every((dependency) => completedTaskIds.has(dependency)))
    .map((entry) => entry.task.id);
}
