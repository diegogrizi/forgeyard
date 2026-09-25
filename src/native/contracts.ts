import type { Capsule, GateDefinition } from "../capsule/capsule.js";
import type { UsageObservation } from "../measure/accounting.js";

export interface EvidenceReference { path: string; sha256: string; locator?: string }
export interface ProductCriterion { id: string; description: string; gateIds: readonly string[] }
export interface ProductTask {
  id: string; title: string; objective: string; role: string;
  requirementIds: readonly string[]; dependsOn: readonly string[];
  writeScopes: readonly string[]; criteria: readonly ProductCriterion[];
}
export interface ProductPlan {
  id: string; request: string; risk: "low" | "medium" | "high";
  requirements: readonly { id: string; description: string }[];
  tasks: readonly ProductTask[];
}
export interface CriterionRecord {
  taskId: string; criterionId: string; outcome: "met" | "not-met" | "unverified";
  evidence: readonly EvidenceReference[];
}
export interface ReviewRecord {
  origin: "same-session" | "native-subagent" | "human";
  independent: boolean; inputSha256: string; artifact: EvidenceReference;
  findings: readonly { severity: "blocking" | "important" | "minor"; description: string }[];
  provenance: "unverified" | "local-dialog" | "test-fixture";
  resolves?: readonly string[];
}
export type RunStatus = "awaiting-approval" | "implementing" | "verifying" | "reviewing" |
  "repairing" | "paused" | "reconciling" | "blocked" | "delivered";
export interface NativeRun {
  activeTaskId?: string;
  plan: ProductPlan; planSha256: string; capsuleId: string; status: RunStatus;
  createdAt: string; deadlineAt: string; repairs: number;
  approvalBaseline: string; artifactSha256: string;
  /** One commit per touched member: with several members there is no single "the" HEAD. */
  baselineHeads: Readonly<Record<string, string>>;
  /** Task id to member repository, as observed from the task's write scopes at plan time.
      A task that writes nowhere has no entry: its gate runs at the workspace root. */
  membersByTask: Readonly<Record<string, string>>;
  checkpoints: readonly { taskId: string; note: string; at: string }[];
  criteria: readonly CriterionRecord[]; reviews: readonly ReviewRecord[];
  completedTaskIds: readonly string[];
  recordedCostUsd: number | null;
  /** Explicitly reported observations, one per report. Absent on runs opened before this field. */
  usage?: readonly UsageObservation[];
  decisions: readonly { description: string; at: string }[];
}
export interface ConsentGrant {
  runId: string; planSha256: string; capsuleId: string; policySha256: string;
  baselineSha256: string; sessionId: string; at: string;
  channel: "local-dialog" | "test-fixture";
}
export interface GateOperation {
  id: string; runId: string; taskId: string; gateId: string;
  gateSha256: string; planSha256: string; capsuleId: string; inputSha256: string;
  status: "prepared" | "running" | "passed" | "failed" | "canceled" | "uncertain";
  startedAt: string; finishedAt?: string; exitCode?: number;
  testsDiscovered?: number | null; failure?: string;
  stdoutSha256?: string; stderrSha256?: string;
  processOwner?: string;
  ownerPid?: number; gatePid?: number;
}
export interface NativeState {
  schemaVersion: 3; revision: number; capsuleId: string | null;
  writer: { sessionId: string; expiresAt: string; baselineSha256: string } | null;
  runs: NativeRun[]; grants: ConsentGrant[]; operations: GateOperation[];
  artifacts: { path: string; content: string; sha256: string }[];
  installation?: { requestId: string; fingerprint: string; operationId: string; capsuleId: string;
    capsule?: Capsule; createdPaths?: readonly string[]; envelope?: NativeEnvelope;
    status: "reserved" | "approved" | "uncertain"; owner: string; ownerPid: number;
    confirmationChannel?: "local-dialog" | "test-fixture" } | null;
}
export interface NativeEnvelope {
  protocolVersion: "0.2"; requestId: string; tool: string; payload: unknown;
}
export interface NativeResponse {
  protocolVersion: "0.2"; requestId: string; ok: true; revision: number;
  result: Record<string, unknown>;
}
export interface HumanDecision { accepted: boolean; channel: "local-dialog" | "test-fixture" }
export type HumanConfirmation = (input: {
  title: string; description: string; plan: ProductPlan; capsule: Capsule;
}) => Promise<HumanDecision>;
export interface GateRunnerResult {
  exitCode: number; stdout: string; stderr: string; canceled?: boolean; timedOut?: boolean;
}
export type NativeGateRunner = (input: {
  gate: GateDefinition; cwd: string; signal: AbortSignal; onSpawn?: (pid: number) => void;
}) => Promise<GateRunnerResult>;
