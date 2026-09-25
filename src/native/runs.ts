import type { Capsule } from "../capsule/capsule.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { normalizePortablePath } from "../core/paths.js";
import { certifyVerdict, summarizeEvidence, validateClaims, type Claim, type VerdictCertification } from "../evidence/epistemic.js";
import { compare, summarizeAgentic, type AccountingReport, type HumanBaseline } from "../measure/accounting.js";
import type { NativeRun, NativeState, ProductPlan, ProductTask } from "./contracts.js";
import { memberForScope, namedMember } from "./members.js";
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
  /** `.` keeps today's shape: a single-repository report must not learn a second grammar. */
  const qualify = (taskId: string, suffix: string): string => {
    const member = namedMember(run.membersByTask[taskId]);
    return member === null ? suffix : `${member}/${suffix}`;
  };
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
        latest.status !== "passed") gaps.push(`gate:${qualify(task.id, `${task.id}/${gate}`)}`);
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

export interface DeliveryEvidence {
  claims: readonly Claim[];
  /** Claims the verdict rests on: satisfied criteria and current reviews. */
  supportingIds: readonly string[];
  certification: VerdictCertification;
  summary: Readonly<Record<string, number>>;
}

/** A digest is quotable as observed evidence only if its path is portable and its hash well formed. */
function quotableReference(reference: { path: string; sha256: string; locator?: string }): boolean {
  if (!/^[a-f0-9]{64}$/.test(reference.sha256) || reference.path.length === 0 || reference.path.length > 1024) return false;
  try { return normalizePortablePath(reference.path) === reference.path; } catch { return false; }
}

/**
 * Restate the run's evidence on the epistemic ladder so the certificate can declare what it
 * rests on. Gates that ran are `executed`; a criterion satisfied by gates is a `derived`
 * inference over them; a criterion backed only by digests, and every review, is `observed`.
 * Recorded decisions are the model's prose: they are carried as `asserted` and can never
 * support a verdict.
 */
export function deliveryEvidence(state: NativeState, run: NativeRun, capsule: Capsule,
  inputSha256: string, invalidEvidence: readonly string[] = []): DeliveryEvidence {
  const claims: Claim[] = [];
  const supportingIds: string[] = [];
  const gateClaimByKey = new Map<string, string>();

  const passed = state.operations.filter((operation) => operation.runId === run.plan.id &&
    operation.capsuleId === capsule.id && operation.planSha256 === run.planSha256 &&
    operation.inputSha256 === inputSha256 && operation.status === "passed");
  for (const [index, operation] of passed.entries()) {
    const definition = capsule.payload.gates.find((gate) => gate.id === operation.gateId);
    if (!definition) continue;
    const id = `gate-${String(index + 1)}`;
    gateClaimByKey.set(`${operation.taskId}/${operation.gateId}`, id);
    claims.push({ id, statement: `Frozen gate ${operation.gateId} passed for task ${operation.taskId}.`,
      evidence: { level: "executed", gateId: operation.gateId, argvSha256: sha256Text(canonicalJson(definition.argv)),
        exitCode: operation.exitCode ?? 0, inputSha256: operation.inputSha256,
        at: operation.finishedAt ?? operation.startedAt } });
  }

  for (const [index, record] of run.criteria.entries()) {
    if (record.outcome !== "met") continue;
    if (invalidEvidence.includes(`criterion-evidence:${record.taskId}/${record.criterionId}`)) continue;
    const criterion = run.plan.tasks.find((task) => task.id === record.taskId)
      ?.criteria.find((entry) => entry.id === record.criterionId);
    if (!criterion) continue;
    const id = `crit-${String(index + 1)}`;
    const from = criterion.gateIds.map((gateId) => gateClaimByKey.get(`${record.taskId}/${gateId}`))
      .filter((value): value is string => value !== undefined);
    if (from.length === criterion.gateIds.length && from.length > 0) {
      claims.push({ id, statement: `Criterion ${record.criterionId} of task ${record.taskId} is satisfied.`,
        evidence: { level: "derived", from, rule: "Every gate the criterion names passed at this revision." } });
      supportingIds.push(id);
      continue;
    }
    const reference = record.evidence.find(quotableReference);
    if (!reference) continue;
    claims.push({ id, statement: `Criterion ${record.criterionId} of task ${record.taskId} is declared satisfied by a read source.`,
      evidence: { level: "observed", path: reference.path, sha256: reference.sha256,
        ...(reference.locator === undefined ? {} : { locator: reference.locator }),
        at: run.createdAt } });
    supportingIds.push(id);
  }

  for (const [index, review] of run.reviews.entries()) {
    if (review.inputSha256 !== inputSha256 || invalidEvidence.includes(`review:evidence-stale:${String(index)}`)) continue;
    if (!quotableReference(review.artifact)) continue;
    const id = `review-${String(index + 1)}`;
    claims.push({ id, statement: `A ${review.independent ? "independent" : "same-session"} review artifact exists at this revision.`,
      evidence: { level: "observed", path: review.artifact.path, sha256: review.artifact.sha256,
        ...(review.artifact.locator === undefined ? {} : { locator: review.artifact.locator }),
        at: run.createdAt } });
    supportingIds.push(id);
  }

  for (const [index, decision] of run.decisions.entries()) {
    claims.push({ id: `decision-${String(index + 1)}`, statement: decision.description,
      evidence: { level: "asserted", origin: "model-prose" } });
  }

  validateClaims(claims);
  return { claims, supportingIds, certification: certifyVerdict(claims, supportingIds),
    summary: summarizeEvidence(claims) };
}

/**
 * Restate the run's reported consumption as declared accounting. Nothing is inferred: a run
 * with no reported observation yields `unmeasured` for every quantity, never zero, and no
 * human baseline is invented — a comparison the user never declared stays absent.
 */
export function deliveryAccounting(run: NativeRun, baseline: HumanBaseline | null = null): AccountingReport {
  return compare(summarizeAgentic(run.usage ?? []), baseline);
}

/**
 * Which member each task belongs to. A run may have tasks in different members — that is the
 * cross-repository case — but a task may not mix them: its gate runs once, with one `cwd`, and
 * its receipt has to name the revision it ran against. A task with no write scope has no member.
 */
export async function assertTaskMembers(
  root: string,
  plan: ProductPlan,
): Promise<Readonly<Record<string, string>>> {
  const byTask: Record<string, string> = {};
  for (const task of plan.tasks) {
    const members = new Set<string>();
    for (const scope of task.writeScopes) members.add(await memberForScope(root, scope));
    if (members.size > 1) {
      throw nativeError("FY_PLAN_INVALID",
        `Task '${task.id}' writes into more than one member repository (${[...members].sort().join(", ")}). Split it: a gate runs once, in one working tree.`);
    }
    const [member] = [...members];
    if (member !== undefined) byTask[task.id] = member;
  }
  return byTask;
}
