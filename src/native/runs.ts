import type { Capsule } from "../capsule/capsule.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { normalizePortablePath } from "../core/paths.js";
import type { NativeRun, NativeState, ProductPlan, ProductTask } from "./contracts.js";
import { nativeError } from "./store.js";

const RESERVED = [".git", ".forgeyard", ".codex", ".claude", ".agents", ".cursor", "AGENTS.md", "CLAUDE.md", "forgeyard.yaml", "forgeyard.lock", ".mcp.json"];
const key = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US");
export const contains = (parent: string, path: string): boolean => parent === "." || key(parent) === key(path) || key(path).startsWith(`${key(parent)}/`);

export function validateProductPlan(plan: ProductPlan, capsule: Capsule): void {
  const requirements = new Set(plan.requirements.map((requirement) => requirement.id));
  const ids = new Set(plan.tasks.map((task) => task.id));
  const gates = new Set(capsule.payload.gates.map((gate) => gate.id));
  if (requirements.size !== plan.requirements.length || ids.size !== plan.tasks.length)
    throw nativeError("FY_PLAN_INVALID", "Requirements and tasks must have unique IDs.");
  for (const task of plan.tasks) {
    if (new Set(task.criteria.map((criterion) => criterion.id)).size !== task.criteria.length ||
      task.requirementIds.some((id) => !requirements.has(id)) ||
      task.dependsOn.some((id) => id === task.id || !ids.has(id)) ||
      task.criteria.some((criterion) => criterion.gateIds.some((id) => !gates.has(id))))
      throw nativeError("FY_PLAN_INVALID", "The task references missing requirements, gates, duplicate criteria or invalid dependencies.");
    for (const scope of task.writeScopes) {
      const normalized = normalizePortablePath(scope);
      if (normalized !== scope || !capsule.payload.policy.mutableRoots.some((root) => contains(root, scope)) ||
        [...capsule.payload.policy.protectedPaths, ...RESERVED].some((protectedPath) => contains(protectedPath, scope) || contains(scope, protectedPath)))
        throw nativeError("FY_SCOPE_DENIED", "A product task scope includes protected or factory-owned paths.");
    }
  }
  if ([...requirements].some((requirement) => !plan.tasks.some((task) => task.requirementIds.includes(requirement))))
    throw nativeError("FY_PLAN_INVALID", "Every product requirement must be covered by a task.");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw nativeError("FY_PLAN_INVALID", "The product task graph contains a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of plan.tasks.find((task) => task.id === id)!.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
}

export function findRun(state: NativeState, runId: string): NativeRun {
  const run = state.runs.find((entry) => entry.plan.id === runId);
  if (!run) throw nativeError("FY_RUN_UNKNOWN", "This project has no run with that ID.");
  return run;
}

export function assertWriter(state: NativeState, sessionId: string, now: Date): void {
  if (state.writer?.sessionId !== sessionId) throw nativeError("FY_WRITER_BUSY", "This session does not own the cooperative writer lease.");
  if (new Date(state.writer.expiresAt).getTime() < now.getTime())
    throw nativeError("FY_RECONCILIATION_REQUIRED", "The writer lease is expired/uncertain. Obtain explicit local reconciliation rather than starting another writer.");
  state.writer.expiresAt = new Date(now.getTime() + 15 * 60000).toISOString();
}

export function grantFor(state: NativeState, run: NativeRun, capsule: Capsule, sessionId: string) {
  return state.grants.findLast((grant) => grant.runId === run.plan.id && grant.sessionId === sessionId &&
    grant.planSha256 === run.planSha256 && grant.capsuleId === capsule.id &&
    grant.policySha256 === sha256Text(canonicalJson(capsule.payload.policy)));
}

export function budgetGaps(run: NativeRun, capsule: Capsule, now: Date): string[] {
  const gaps: string[] = [];
  if (new Date(run.deadlineAt).getTime() < now.getTime()) gaps.push("timebox-exhausted");
  if (run.repairs > capsule.payload.policy.maxRepairs) gaps.push("repair-budget-exhausted");
  const limit = capsule.payload.policy.maxRecordedCostUsd;
  if (limit !== null && run.recordedCostUsd !== null && run.recordedCostUsd > limit) gaps.push("recorded-cost-budget-exhausted");
  return gaps;
}

export function evidenceGaps(state: NativeState, run: NativeRun, capsule: Capsule, inputSha256: string,
  invalidEvidence: readonly string[] = []): string[] {
  const gaps: string[] = [...invalidEvidence.filter((gap) => gap.startsWith("review:") ||
    run.plan.tasks.some((task) => gap.startsWith(`criterion-evidence:${task.id}/`)))];
  for (const task of run.plan.tasks) {
    if (task.writeScopes.length > 0 && !capsule.payload.gates.some((gate) => gate.parser === "test-summary"))
      gaps.push(`test-gate:missing:${task.id}`);
    for (const criterion of task.criteria) {
      if (!run.criteria.some((entry) => entry.taskId === task.id && entry.criterionId === criterion.id && entry.outcome === "met"))
        gaps.push(`criterion:${task.id}/${criterion.id}`);
    }
    for (const gate of requiredGates(task, capsule)) {
      const definition = capsule.payload.gates.find((definition) => definition.id === gate)!;
      const latest = state.operations.findLast((operation) => operation.runId === run.plan.id && operation.taskId === task.id &&
        operation.gateId === gate && operation.planSha256 === run.planSha256 && operation.capsuleId === capsule.id);
      if (!latest || latest.gateSha256 !== sha256Text(canonicalJson(definition)) || latest.inputSha256 !== inputSha256 ||
        latest.status !== "passed") gaps.push(`gate:${task.id}/${gate}`);
    }
  }
  if (state.operations.some((operation) => operation.runId === run.plan.id && ["prepared", "running", "uncertain"].includes(operation.status)))
    gaps.push("operation:active-or-uncertain");
  const currentReviews = run.reviews.filter((review, index) => review.inputSha256 === inputSha256 &&
    !invalidEvidence.includes(`review:evidence-stale:${index}`));
  const resolved = new Set(currentReviews.filter((review) => review.independent).flatMap((review) => review.resolves ?? []));
  if (currentReviews.some((review) => review.findings.some((finding) => finding.severity !== "minor" &&
    !resolved.has(sha256Text(canonicalJson(finding)))))) gaps.push("review:unresolved-findings");
  if (run.plan.risk !== "low" && !currentReviews.some((review) => review.independent)) gaps.push("review:independent-provenance-required");
  if (run.plan.risk === "low" && currentReviews.length === 0) gaps.push("review:required");
  return gaps;
}

export function requiredGates(task: ProductTask, capsule: Capsule): readonly string[] {
  return [...new Set([...task.criteria.flatMap((criterion) => criterion.gateIds),
    ...(task.writeScopes.length > 0 ? capsule.payload.gates.map((gate) => gate.id) : [])])].sort();
}
