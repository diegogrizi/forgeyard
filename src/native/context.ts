import type { Capsule } from "../capsule/capsule.js";
import type { NativeRun, NativeState } from "./contracts.js";

/** How many runs a context answer carries; the rest are only acknowledged by `historyLimited`. */
const REPORTED_RUNS = 10;

/**
 * The runs a context answer reports. Exported because the caller that refreshes their evidence
 * before rendering them has to bound itself to exactly this set: a run nobody reads costs four
 * Git processes per member to refresh, and answers a question nobody asked. Two slices of the
 * same list, written in two files, is the duplication that drifts.
 */
export function reportedRuns(state: NativeState): readonly NativeRun[] {
  return state.runs.slice(-REPORTED_RUNS);
}

export function projectContext(state: NativeState, capsule: Capsule | null): Record<string, unknown> {
  const runs = reportedRuns(state).map((run) => ({
    id: run.plan.id, request: run.plan.request, status: run.status, risk: run.plan.risk,
    requirements: run.plan.requirements,
    tasks: run.plan.tasks.map((task) => ({ id: task.id, title: task.title,
      dependsOn: task.dependsOn, requirementIds: task.requirementIds,
      completed: run.completedTaskIds.includes(task.id) })),
    checkpoint: run.checkpoints.at(-1) ?? null,
    decisions: run.decisions.slice(-10),
    artifact: `.forgeyard/project/${run.plan.id}.json`,
    recordedCostUsd: run.recordedCostUsd,
    costStatus: run.recordedCostUsd === null ? "unmeasured" : "explicitly-reported",
    hardProviderSpendLimit: false,
  }));
  return {
    capsuleId: capsule?.id ?? null, protocolVersion: "0.2",
    policy: capsule?.payload.policy ?? null, gates: capsule?.payload.gates ?? [],
    writerStatus: state.writer ? "reserved" : "available", runs,
    installation: state.installation ? { status: state.installation.status, operationId: state.installation.operationId,
      capsuleId: state.installation.capsuleId, reconciliationRequired: true,
      route: "forgeyard reconcile-install --root ." } : null,
    historyLimited: state.runs.length > REPORTED_RUNS,
    operations: state.operations.slice(-20).map(({ processOwner: _owner, ...operation }) => operation),
    nativeClient: { sessions: "client-owned", subagents: "client-owned", stop: "client-owned",
      authentication: "client-owned", liveCompatibility: "unverified" },
    trust: { criteria: "agent-declared, evidence-linked", gates: "service-observed",
      nativeReviewOrigin: "unverified-unless-attested", isolation: "cooperative-not-OS-sandbox" },
  };
}
