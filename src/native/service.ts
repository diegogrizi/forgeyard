import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

import { compileCapsule, readCapsule, readRegularProjectFile, type Capsule } from "../capsule/capsule.js";
import { loadConfig } from "../config/config.js";
import { resolveInsideRoot as insideRoot } from "../core/paths.js";
import { createForgeyardService, renderFactoryPlan } from "../application/forgeyard.js";
import { preparationConfig } from "../application/preparation.js";
import { canonicalJson, sha256Bytes, sha256Text } from "../core/hash.js";
import { checkCitations } from "../evidence/citations.js";
import { resolveInsideRoot } from "../core/paths.js";
import { inspectProject } from "../intake/inspect.js";
import { validateProjectNeeds } from "../intake/semantic.js";
import { BUNDLED_CAPABILITIES, resolveCapabilities } from "../intake/capabilities.js";
import { projectRequirements } from "../intake/requirements.js";
import type { ComposeProjectOptions } from "../intake/contracts.js";
import type { EvidenceReference, GateOperation, HumanConfirmation, NativeEnvelope, NativeGateRunner,
  NativeResponse, NativeRun, NativeState, ProductPlan, ReviewRecord } from "./contracts.js";
import { projectContext } from "./context.js";
import { localDialogConfirmation } from "./confirmation.js";
import { discoveredTests, nativeGateRunner, testSummaryFailure } from "./gates.js";
import { validateNativeEnvelope } from "./protocol.js";
import { assertTaskMembers, assertWriter, budgetGaps, contains, deliveryAccounting, deliveryEvidence, evidenceGaps, findRun, grantFor, requiredGates, validateProductPlan } from "./runs.js";
import { memberRoot, scopesInMember } from "./members.js";
import { validateHumanBaseline, type HumanBaseline } from "../measure/accounting.js";
import { NativeStore, nativeError } from "./store.js";
import { changedSince, workspaceIdentity, workspaceSnapshot, type WorkspaceIdentity } from "./workspace.js";
import { atomicText, regularBytes, assertDirectoryChain } from "./files.js";
import { defaultNativeStateDirectory } from "./bindings.js";
import { processMayBeAlive } from "./recovery.js";
import { loadInstallManifest, parseOperationJournal } from "../installer/manifest.js";
import { runDoctor } from "../doctor/run-doctor.js";

export interface ProjectServiceInput {
  root: string; stateDirectory?: string; confirmation?: HumanConfirmation;
  gateRunner?: NativeGateRunner; now?: () => Date;
  client?: "codex" | "claude-code";
}

export class ProjectService {
  private readonly processOwner = `forgeyard-${randomUUID()}`;
  private readonly jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly now: () => Date;
  private readonly confirmation: HumanConfirmation;
  private readonly runner: NativeGateRunner;
  private closing: Promise<void> | undefined;
  private readonly client: "codex" | "claude-code" | undefined;

  constructor(private readonly identity: WorkspaceIdentity, private readonly store: NativeStore,
    private readonly stateDirectory: string, input: ProjectServiceInput) {
    this.now = input.now ?? (() => new Date());
    this.confirmation = input.confirmation ?? localDialogConfirmation;
    this.runner = input.gateRunner ?? nativeGateRunner;
    this.client = input.client;
  }

  private response(envelope: NativeEnvelope, result: Record<string, unknown>): NativeResponse {
    return { protocolVersion: "0.2", requestId: envelope.requestId, ok: true,
      revision: this.store.read().revision, result };
  }

  /** Liveness lives in one place: evidence/citations owns it, this method owns only the
   *  native policy on what may be cited at all. A second copy of a rule diverges. */
  private async references(references: readonly EvidenceReference[]): Promise<void> {
    for (const reference of references) {
      if (/(^|\/)(\.env(?:\..*)?|auth\.json|credentials[^/]*|.*\.(?:pem|key))$/i.test(reference.path))
        throw nativeError("FY_EVIDENCE_INVALID", "Private files are not valid product evidence references.");
    }
    let checks;
    try { checks = await checkCitations(this.identity.root, references, 262144); }
    catch { throw nativeError("FY_EVIDENCE_INVALID", "An evidence reference is not a usable project path."); }
    if (checks.some((check) => check.status !== "live"))
      throw nativeError("FY_EVIDENCE_INVALID", "An evidence reference is missing or stale.");
  }

  /** A missing or unreadable declaration is no declaration: the comparison stays absent. */
  private async declaredBaseline(): Promise<HumanBaseline | null> {
    try {
      const config = await loadConfig(insideRoot(this.identity.root, "forgeyard.yaml"));
      const baseline = config.measurement?.humanBaseline;
      if (baseline === undefined) return null;
      validateHumanBaseline(baseline);
      return baseline;
    } catch { return null; }
  }

  private async invalidEvidence(run: NativeRun, inputSha256: string): Promise<string[]> {
    const gaps: string[] = [];
    for (const record of run.criteria) {
      try { await this.references(record.evidence); }
      catch { gaps.push(`criterion-evidence:${record.taskId}/${record.criterionId}`); }
    }
    for (const [index, review] of run.reviews.entries()) {
      if (review.inputSha256 !== inputSha256) continue;
      try { await this.references([review.artifact]); }
      catch { gaps.push(`review:evidence-stale:${index}`); }
    }
    return gaps;
  }

  private currentCompletion(state: NativeState, run: NativeRun, capsule: Capsule,
    inputSha256: string, invalid: readonly string[]): readonly string[] {
    return run.plan.tasks.filter((task) => evidenceGaps(state,
      { ...run, plan: { ...run.plan, tasks: [task] } }, capsule, inputSha256, invalid)
      .filter((gap) => !gap.startsWith("review:")).length === 0).map((task) => task.id);
  }

  private async flushArtifacts(): Promise<void> {
    for (const artifact of this.store.read().artifacts) {
      const destination = resolveInsideRoot(this.identity.root, artifact.path);
      let current: string | undefined;
      try { current = await readRegularProjectFile(this.identity.root, artifact.path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (current !== undefined) {
        if (sha256Text(current) !== artifact.sha256) throw nativeError("FY_ARTIFACT_DRIFT", "A generated product artifact was edited; it is preserved rather than overwritten.");
        continue;
      }
      await atomicText(destination, artifact.content, null);
    }
  }

  private async capsule(): Promise<Capsule> {
    if (this.store.read().installation) throw nativeError("FY_RECONCILIATION_REQUIRED", "Resolve the recorded installer reservation through the local reconcile-install route before product work.");
    const capsule = await readCapsule(this.identity.root);
    const stored = this.store.read().capsuleId;
    if (stored !== null && stored !== capsule.id) throw nativeError("FY_CAPSULE_MIGRATION_REQUIRED", "This working tree's capsule changed. Reconcile the explicit upgrade before starting another run.");
    return capsule;
  }

  private async optionalCapsule(): Promise<Capsule | null> {
    const exists = await lstat(resolveInsideRoot(this.identity.root, ".forgeyard/capsule.json")).then(() => true)
      .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    if (!exists && this.store.read().capsuleId === null) return null;
    return this.capsule();
  }

  async execute(value: unknown): Promise<NativeResponse> {
    const envelope = validateNativeEnvelope(value);
    if ((await workspaceIdentity(this.identity.root)).id !== this.identity.id)
      throw nativeError("FY_ROOT_IDENTITY_CHANGED", "Git identity changed after bootstrap. Reopen/restart this project-bound service before starting a product run; no state is silently migrated.");
    const replay = this.store.replay(envelope);
    if (replay) { await this.flushArtifacts(); return replay; }
    const payload = envelope.payload as Record<string, unknown>;
    if (["fy_inspect", "fy_compose", "fy_prepare", "fy_apply"].includes(envelope.tool)) {
      const inspection = await inspectProject({ root: this.identity.root,
        ...(typeof payload.brief === "string" ? { brief: payload.brief } : {}),
        ...(Array.isArray(payload.specificationPaths) ? { specificationPaths: payload.specificationPaths as string[] } : {}) });
      if (envelope.tool === "fy_inspect") return this.response(envelope, { inspection });
      const profile = validateProjectNeeds(inspection, payload.proposal);
      const client = (payload.adapter ?? this.client ?? "codex") as "codex" | "claude-code";
      if (this.client && client !== this.client) throw nativeError("FY_CLIENT_MISMATCH", "The proposal conflicts with this native client's project binding.");
      const composition = resolveCapabilities(projectRequirements(inspection, profile), BUNDLED_CAPABILITIES, { client,
        allowedLicenses: ["Apache-2.0", "MIT"],
        allowedPermissions: ["read-project", "write-project", "run-tests"], maxContextTokens: 32768 });
      if (envelope.tool === "fy_compose") return this.response(envelope, { profile, composition });
      // Preparation is wired to the transactional factory below, not a separate
      // prompt-only or arbitrary installer. No grant is accepted in this payload.
      return this.prepare(envelope, payload, inspection.request, profile, composition, client);
    }
    if (envelope.tool === "fy_context") {
      await this.flushArtifacts();
      const capsule = this.store.read().installation ? null : await this.optionalCapsule();
      const current = this.store.read();
      if (capsule) {
        // One snapshot per run, over that run's own members: two runs on disjoint members
        // must not invalidate each other's evidence. The runs are independent reads, and
        // serially each one costs four Git spawns on the ordinary path.
        await Promise.all(current.runs.map(async (run) => {
          const snapshot = await workspaceSnapshot(this.identity.root, Object.keys(run.baselineHeads));
          const invalid = await this.invalidEvidence(run, snapshot.sha256);
          run.completedTaskIds = this.currentCompletion(current, run, capsule, snapshot.sha256, invalid);
          if (run.status === "delivered" && evidenceGaps(current, run, capsule, snapshot.sha256, invalid).length > 0)
            run.status = "blocked";
        }));
      }
      return this.response(envelope, { ...projectContext(current, capsule), configuredClient: this.client ?? null });
    }
    const capsule = await this.capsule();
    // `fy_plan` is the only tool carrying a plan, and the cast happens once for both the
    // member walk here and the transaction below.
    const plan = envelope.tool === "fy_plan" ? payload.plan as unknown as ProductPlan : null;
    // The snapshot is taken per member, so the member list has to exist before it. Both
    // sources are I/O and the transaction below is synchronous, so both are read here: an
    // existing run already carries its members, and a new plan's are observed from its
    // scopes. The plan is tested first, so a payload carrying both a plan and a run ID
    // cannot reach the transaction unvalidated: today the schema forbids that combination,
    // but a branch whose safety rests on another file is a rule with no test behind it.
    let members: readonly string[] = ["."];
    if (plan !== null) {
      // Validated before the walk: the scopes are model-supplied strings, and this is what
      // confines them to this project before anything reads the filesystem with them.
      validateProductPlan(plan, capsule);
      const touched = [...new Set(Object.values(await assertTaskMembers(this.identity.root, plan)))];
      // A plan that writes nowhere touches no member, and a snapshot over no members is
      // refused. The root is the binding such a plan still has: it is approved against this
      // working tree's revision like any other.
      members = touched.length > 0 ? touched : ["."];
    } else if (typeof payload.runId === "string") {
      members = Object.keys(findRun(this.store.read(), payload.runId).baselineHeads);
    }
    const snapshot = await workspaceSnapshot(this.identity.root, members);
    // The map is built from sorted members, so the names come out sorted already.
    const missing = [...snapshot.members].filter(([, member]) => member.head === null).map(([name]) => name);
    if (missing.length > 0) throw nativeError("FY_GIT_REQUIRED",
      `Native runs bind evidence to a revision, and these member repositories have no commit yet: ${missing.join(", ")}.`);
    if (envelope.tool === "fy_approval_request") {
      const run = findRun(this.store.read(), String(payload.runId));
      return this.response(envelope, { runId: run.plan.id, planSha256: run.planSha256, capsuleId: capsule.id,
        policySha256: sha256Text(canonicalJson(capsule.payload.policy)), requiresHumanConfirmation: true,
        route: "The native agent may invoke forgeyard consent --root . --run <run-id> --session <writer-id> to display the dedicated local dialog. No --yes or approve tool exists." });
    }
    if (envelope.tool === "fy_attach" && payload.mode === "read")
      return this.response(envelope, { mode: "read", context: projectContext(this.store.read(), capsule) });
    if (envelope.tool === "fy_operation" && payload.action === "status") {
      const operation = this.store.read().operations.find((entry) => entry.id === payload.operationId);
      if (!operation) throw nativeError("FY_OPERATION_UNKNOWN", "No Forgeyard operation has this ID.");
      const { processOwner: _owner, ...result } = operation;
      return this.response(envelope, { operation: result, locallyCancelable: this.jobs.has(operation.id),
        reconciliationRequired: ["prepared", "running"].includes(operation.status) && !this.jobs.has(operation.id) });
    }
    if (envelope.tool === "fy_record") {
      const record = payload.record as Record<string, unknown>;
      if (record.kind === "criterion") await this.references(record.evidence as EvidenceReference[]);
    }
    if (envelope.tool === "fy_review") await this.references([payload.artifact as unknown as EvidenceReference]);
    const invalid = payload.runId ? await this.invalidEvidence(findRun(this.store.read(), String(payload.runId)), snapshot.sha256) : [];
    // Read before the transaction: the mutate callback is synchronous, and a declaration is I/O.
    const declared = envelope.tool === "fy_finalize" ? await this.declaredBaseline() : null;
    const changedPaths = payload.runId ? await changedSince(this.identity.root,
      findRun(this.store.read(), String(payload.runId)).baselineHeads) : [];
    const transaction = this.store.change(envelope, Number(payload.expectedRevision), (state) => {
      if (envelope.tool === "fy_attach") {
        if (state.writer && state.writer.sessionId !== payload.sessionId)
          throw nativeError("FY_WRITER_BUSY", "Another session owns this working tree. Expiry does not authorize automatic takeover.");
        if (state.writer && new Date(state.writer.expiresAt).getTime() < this.now().getTime())
          throw nativeError("FY_RECONCILIATION_REQUIRED", "The previous writer needs an explicit local reconciliation.");
        state.capsuleId = capsule.id;
        state.writer = { sessionId: String(payload.sessionId), baselineSha256: snapshot.sha256,
          expiresAt: new Date(this.now().getTime() + 15 * 60000).toISOString() };
        return { mode: "write", capsuleId: capsule.id, concurrency: { workingTreeWriters: 1,
          maxWorkItems: capsule.payload.policy.maxConcurrency, aiSessions: "native-client-owned" } };
      }
      assertWriter(state, String(payload.sessionId), this.now());
      // A plan is present exactly for `fy_plan`, and it was validated above, where its scopes
      // had to be confined before the member walk.
      if (plan !== null) {
        if (!snapshot.clean) throw nativeError("FY_GIT_REQUIRED", "Create a product plan from a committed baseline; existing user changes are not silently copied or committed.");
        if (state.runs.some((run) => run.plan.id === plan.id)) throw nativeError("FY_PLAN_INVALID", "Run IDs are immutable. Use a new run ID for a new feature or explicitly reconcile the current plan.");
        const content = `${canonicalJson({ schemaVersion: 1, capsuleId: capsule.id, plan })}\n`;
        state.artifacts.push({ path: `.forgeyard/project/${plan.id}.json`, content, sha256: sha256Text(content) });
        const run: NativeRun = { plan, planSha256: sha256Text(canonicalJson(plan)), capsuleId: capsule.id,
          status: "awaiting-approval", createdAt: this.now().toISOString(),
          deadlineAt: new Date(this.now().getTime() + capsule.payload.policy.timeboxMinutes * 60000).toISOString(),
          repairs: 0, approvalBaseline: snapshot.sha256, artifactSha256: sha256Text(content),
          baselineHeads: Object.fromEntries([...snapshot.members].map(([name, member]) => [name, member.head!])),
          checkpoints: [], criteria: [], reviews: [], completedTaskIds: [], decisions: [], recordedCostUsd: null, usage: [] };
        state.runs.push(run);
        return { runId: plan.id, action: "awaiting-approval", planSha256: run.planSha256,
          artifact: `.forgeyard/project/${plan.id}.json`, capsuleId: capsule.id };
      }
      if (envelope.tool === "fy_operation") {
        const job = this.jobs.get(String(payload.operationId));
        if (!job) throw nativeError("FY_OPERATION_NOT_OWNED", "This process cannot cancel an operation it does not own. No PID or provider session will be killed.");
        return { operationId: payload.operationId, action: "cancel-requested", codingAgentStopped: false };
      }
      const run = findRun(state, String(payload.runId));
      if (run.capsuleId !== capsule.id) throw nativeError("FY_CAPSULE_DRIFT", "The run belongs to a different capsule.");
      const grant = grantFor(state, run, capsule, String(payload.sessionId));
      if (envelope.tool === "fy_pause") {
        run.status = "paused";
        run.decisions = [...run.decisions, { description: String(payload.note), at: this.now().toISOString() }];
        return { runId: run.plan.id, status: "paused", codingAgentStopped: false,
          writerRetained: true, cancellation: "only-locally-owned-gate-processes" };
      }
      if (!grant) {
        if (envelope.tool === "fy_next") return { runId: run.plan.id, action: "awaiting-approval" };
        throw nativeError("FY_APPROVAL_REQUIRED", "No valid local human grant exists for this exact plan, capsule and policy.");
      }
      if (run.status === "paused" || run.status === "reconciling") throw nativeError("FY_RECONCILIATION_REQUIRED", "This run is paused/uncertain. Reconcile through the local human channel before resuming.");
      const gaps = budgetGaps(run, capsule, this.now());
      if (gaps.length > 0) { run.status = "blocked"; return { action: "blocked", gaps }; }
      const scopes = run.plan.tasks.flatMap((task) => task.writeScopes);
      const artifactPaths = state.artifacts.map((artifact) => artifact.path);
      if (changedPaths.some((changed) => !scopes.some((scope) => contains(scope, changed)) && !artifactPaths.includes(changed)))
        throw nativeError("FY_SCOPE_DENIED", "Changes since the approved baseline include paths outside the plan's scopes.");
      if (envelope.tool === "fy_next") {
        if (run.status === "awaiting-approval" && snapshot.sha256 !== grant.baselineSha256)
          throw nativeError("FY_APPROVAL_STALE", "Inputs changed after consent and before implementation began.");
        run.status = "implementing";
        run.completedTaskIds = this.currentCompletion(state, run, capsule, snapshot.sha256, invalid);
        const task = run.plan.tasks.find((task) => !run.completedTaskIds.includes(task.id) &&
          task.dependsOn.every((dependency) => run.completedTaskIds.includes(dependency)));
        if (!task) { run.status = "reviewing"; return { action: "review-and-finalize", runId: run.plan.id }; }
        run.activeTaskId = task.id;
        return { action: "work", runId: run.plan.id, task, requiredGateIds: requiredGates(task, capsule),
          gaps: evidenceGaps(state, { ...run, plan: { ...run.plan, tasks: [task] } }, capsule, snapshot.sha256, invalid)
            .filter((gap) => !gap.startsWith("review:")),
          scope: task.writeScopes, nativeExecution: "Use this conversation's configured tools; Forgeyard does not start an AI client.",
          remainingMinutes: Math.max(0, (new Date(run.deadlineAt).getTime() - this.now().getTime()) / 60000),
          costStatus: run.recordedCostUsd === null ? "unmeasured" : "explicitly-reported", hardProviderSpendLimit: false };
      }
      if (envelope.tool === "fy_record") {
        const record = payload.record as Record<string, unknown>;
        const task = run.plan.tasks.find((task) => task.id === record.taskId);
        if (["checkpoint", "criterion"].includes(String(record.kind)) && !task) throw nativeError("FY_PLAN_INVALID", "This record refers to an unknown task.");
        if (record.kind === "checkpoint") run.checkpoints = [...run.checkpoints, {
          taskId: String(record.taskId), note: String(record.note), at: this.now().toISOString() }];
        if (record.kind === "decision") run.decisions = [...run.decisions, { description: String(record.description), at: this.now().toISOString() }];
        if (record.kind === "usage") {
          run.recordedCostUsd = (run.recordedCostUsd ?? 0) + Number(record.amountUsd);
          // The service stamps the instant: a model-supplied timestamp is not an observation.
          run.usage = [...(run.usage ?? []), {
            at: this.now().toISOString(),
            provider: typeof record.provider === "string" ? record.provider : "unreported",
            model: typeof record.model === "string" ? record.model : "unreported",
            inputTokens: typeof record.inputTokens === "number" ? record.inputTokens : 0,
            outputTokens: typeof record.outputTokens === "number" ? record.outputTokens : 0,
            costUsd: Number(record.amountUsd),
            durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
          }];
        }
        if (record.kind === "criterion") {
          if (!task!.criteria.some((criterion) => criterion.id === record.criterionId)) throw nativeError("FY_PLAN_INVALID", "Unknown acceptance criterion.");
          run.criteria = [...run.criteria.filter((entry) => entry.taskId !== record.taskId || entry.criterionId !== record.criterionId),
            { taskId: String(record.taskId), criterionId: String(record.criterionId), outcome: record.outcome as "met",
              evidence: record.evidence as EvidenceReference[] }];
        }
        return { runId: run.plan.id, recorded: record.kind, certified: false };
      }
      if (envelope.tool === "fy_review") {
        const review: ReviewRecord = { origin: payload.origin as "same-session" | "native-subagent",
          independent: false, provenance: "unverified", inputSha256: snapshot.sha256,
          artifact: payload.artifact as unknown as EvidenceReference, findings: payload.findings as ReviewRecord["findings"] };
        run.reviews = [...run.reviews, review];
        return { recorded: true, independent: false, reason: "A model-declared origin or worker name is not verified session isolation." };
      }
      if (envelope.tool === "fy_verify") {
        if (!snapshot.clean) throw nativeError("FY_GIT_REQUIRED", "Commit the intended plan/product revision before running a certification gate.");
        const task = run.plan.tasks.find((task) => task.id === payload.taskId);
        const gate = capsule.payload.gates.find((gate) => gate.id === payload.gateId);
        if (!task || !gate || !requiredGates(task, capsule).includes(gate.id)) throw nativeError("FY_GATE_DENIED", "The gate ID is not approved for this task.");
        run.completedTaskIds = this.currentCompletion(state, run, capsule, snapshot.sha256, invalid);
        if (!task.dependsOn.every((dependency) => run.completedTaskIds.includes(dependency))) throw nativeError("FY_DEPENDENCY_BLOCKED", "This task's dependencies are not yet verified on current inputs.");
        if (state.operations.some((operation) => ["prepared", "running", "uncertain"].includes(operation.status)))
          throw nativeError("FY_OPERATION_BUSY", "A gate is already active or uncertain; do not duplicate its effects.");
        const operation: GateOperation = { id: `gate-${randomUUID()}`, runId: run.plan.id, taskId: task.id, gateId: gate.id,
          gateSha256: sha256Text(canonicalJson(gate)), planSha256: run.planSha256, capsuleId: capsule.id,
          inputSha256: snapshot.sha256, status: "prepared", startedAt: this.now().toISOString(), processOwner: this.processOwner, ownerPid: process.pid };
        state.operations.push(operation); run.status = "verifying";
        return { operationId: operation.id, status: "prepared" };
      }
      if (envelope.tool === "fy_finalize") {
        const finalGaps = [...evidenceGaps(state, run, capsule, snapshot.sha256, invalid), ...budgetGaps(run, capsule, this.now()),
          ...(!snapshot.clean ? ["git:dirty-inputs"] : [])];
        // Restate the run on the epistemic ladder: the certificate must declare what it rests
        // on, and the model's prose must never be able to carry it.
        const evidence = deliveryEvidence(state, run, capsule, snapshot.sha256, invalid);
        // The baseline is a human declaration, read before this transaction and recorded in
        // the certificate with its digest: a later edit cannot change a verdict already issued.
        const accounting = deliveryAccounting(run, declared);
        if (!evidence.certification.certifiable) finalGaps.push("evidence:unsupported-verdict");
        const verdict = finalGaps.length > 0 ? "blocked" : "delivered";
        const reportPath = `.forgeyard/reports/${run.plan.id}/${snapshot.sha256}.json`;
        run.status = verdict;
        if (verdict === "delivered") {
          run.completedTaskIds = run.plan.tasks.map((task) => task.id);
          const content = `${canonicalJson({ schemaVersion: 1, runId: run.plan.id, capsuleId: capsule.id,
            planSha256: run.planSha256, inputSha256: snapshot.sha256,
            gitCommits: Object.fromEntries([...snapshot.members].map(([member, snapshot]) => [member, snapshot.head])),
            verdict, criteria: run.criteria, gates: state.operations.filter((operation) => operation.runId === run.plan.id &&
              operation.inputSha256 === snapshot.sha256).map(({ processOwner: _owner, ...operation }) => operation),
            reviews: run.reviews, limits: { recordedCostUsd: run.recordedCostUsd, hardProviderSpendLimit: false },
            accounting: { agentic: accounting.agentic, human: accounting.human,
              comparison: accounting.comparison, method: accounting.method, caveats: accounting.caveats },
            evidence: { levels: evidence.summary, supporting: evidence.supportingIds.length,
              weakestLevel: evidence.certification.weakestLevel,
              weakestGrounding: evidence.certification.weakestGrounding, claims: evidence.claims },
            interpretation: "Criteria are evidence-linked declarations; gates are observed. Every supporting claim carries a declared evidence level, and prose cannot support this verdict. This certificate does not prove universal software correctness." })}\n`;
          if (!state.artifacts.some((artifact) => artifact.path === reportPath))
            state.artifacts.push({ path: reportPath, content, sha256: sha256Text(content) });
        }
        return { verdict, gaps: finalGaps, capsuleId: capsule.id, runId: run.plan.id,
          evidence: { levels: evidence.summary, weakestLevel: evidence.certification.weakestLevel,
            weakestGrounding: evidence.certification.weakestGrounding,
            blocking: evidence.certification.blocking.map((entry) => entry.id) },
          report: verdict === "delivered" ? reportPath : null };
      }
      throw nativeError("FY_PROTOCOL_INVALID", "This tool is not implemented for the current project state.");
    });
    await this.flushArtifacts();
    if (!transaction.replay && envelope.tool === "fy_verify" && transaction.response.result.status === "prepared" &&
      typeof transaction.response.result.operationId === "string") this.launch(transaction.response.result.operationId, capsule);
    if (!transaction.replay && envelope.tool === "fy_operation") this.jobs.get(String(payload.operationId))!.controller.abort();
    if (!transaction.replay && envelope.tool === "fy_pause") for (const [id, job] of this.jobs) {
      if (this.store.read().operations.find((operation) => operation.id === id)?.runId === payload.runId) job.controller.abort();
    }
    return transaction.response;
  }

  private async prepare(envelope: NativeEnvelope, payload: Record<string, unknown>, request: string,
    profile: unknown, composition: unknown, client: "codex" | "claude-code"): Promise<NativeResponse> {
    if (this.store.read().installation) throw nativeError("FY_RECONCILIATION_REQUIRED", "An installer reservation is unresolved. Use the local reconcile-install route before any further installation or product run.");
    const installed = await this.optionalCapsule();
    if (installed) return this.response(envelope, { status: "already-frozen", capsuleId: installed.id,
      applied: false, next: "Use fy_plan for a new feature. Updating the factory/catalog does not update this harness." });
    const noPrompt = async (): Promise<never> => { throw nativeError("FY_PRODUCT_INPUT_REQUIRED", "Provide the software outcome; native preparation never asks you to choose skill authors/frameworks."); };
    const factory = createForgeyardService({
      prompts: { input: noPrompt, number: noPrompt, select: noPrompt, confirm: noPrompt },
      operationId: () => `native-apply-${sha256Text(canonicalJson(envelope)).slice(0, 24)}`,
    });
    const input = { targetRoot: this.identity.root, brief: request,
      specificationPaths: (payload.specificationPaths ?? []) as string[], needsProposal: payload.proposal,
      ...((payload.constraints ?? {}) as ComposeProjectOptions),
      adapter: client, yes: true, dryRun: true, nonInteractive: true };
    const preview = await factory.prepare(input);
    const config = preparationConfig(preview.inspection, preview.decision);
    const rendered = await renderFactoryPlan(this.identity.root, config, preview.operationId);
    const proposed = JSON.parse(rendered.files.find((file) => file.path === ".forgeyard/capsule.json")!.content) as Capsule;
    if (envelope.tool === "fy_prepare") return this.response(envelope, { status: "preview", applied: false,
      profile, composition, changes: preview.changes, decision: preview.decision, capsuleId: proposed.id,
      policy: proposed.payload.policy, gates: proposed.payload.gates,
      warnings: [...preview.inspection.warnings, ...(!proposed.payload.gates.some((gate) => gate.parser === "test-summary") ?
        ["No test-summary gate was detected/proposed. Product-writing runs cannot be certified until a real test gate is frozen at setup."] : [])],
      scan: preview.inspection.scan });
    const installationSha256 = sha256Text(canonicalJson(rendered.files.map((file) => ({ path: file.path, sha256: file.sha256, ownership: file.ownership }))));
    const reservation = this.store.change({ ...envelope, requestId: `reserve-${sha256Text(canonicalJson(envelope)).slice(0, 48)}`, tool: "install-reservation" },
      Number(payload.expectedRevision), (state) => {
        if (state.installation || state.writer) throw nativeError("FY_PREPARATION_BUSY", "This project already has an installer reservation or writer. Reconcile it instead of starting another installation.");
        state.installation = { requestId: envelope.requestId, fingerprint: sha256Text(canonicalJson(envelope)),
          capsule: proposed, createdPaths: preview.changes.created, envelope,
          operationId: preview.operationId, capsuleId: proposed.id, status: "reserved", owner: this.processOwner, ownerPid: process.pid };
        return { status: "reserved", operationId: preview.operationId };
      });
    if (reservation.replay) throw nativeError("FY_PREPARATION_BUSY", "This exact installation request is already in progress or awaits reconciliation. Do not open another confirmation or repeat installer effects.");
    try {
    const plan: ProductPlan = { id: "prepare-harness", request, risk: "medium",
      requirements: [{ id: "harness", description: "Materialize the approved project harness" }],
      tasks: [{ id: "prepare", title: "Prepare this project", objective: "Install the previewed harness only",
        requirementIds: ["harness"], dependsOn: [], writeScopes: config.paths.mutableRoots,
        role: "factory", criteria: [{ id: "prepared", description: "Ownership, provenance and doctor checks pass", gateIds: proposed.payload.gates.map((gate) => gate.id) }] }] };
    const before = await workspaceSnapshot(this.identity.root);
    const decision = await this.confirmation({ title: "Forgeyard: install this harness", plan, capsule: proposed,
      description: `Target: ${this.identity.root}\nExact installation: ${installationSha256}\nCreate ${preview.changes.created.length} previewed files. Preserve existing files.\n` +
        preview.changes.created.join("\n") + "\nThis does not implement an application or launch an AI client." });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "Harness installation was rejected in the local confirmation.");
    this.store.internal("install-approved", `install-approved-${preview.operationId}`, (state) => {
      if (state.installation?.owner !== this.processOwner) throw nativeError("FY_PREPARATION_BUSY", "This process no longer owns the installation reservation.");
      state.installation.status = "approved"; state.installation.confirmationChannel = decision.channel;
      return { operationId: preview.operationId, status: "approved", capsuleId: proposed.id };
    });
    const afterInspection = (await factory.inspect(input)).inspection;
    if ((await workspaceSnapshot(this.identity.root)).sha256 !== before.sha256 ||
      afterInspection.analysisSha256 !== preview.inspection.analysisSha256)
      throw nativeError("FY_APPROVAL_STALE", "Project inputs changed while approving installation.");
    const currentRender = await renderFactoryPlan(this.identity.root, config, preview.operationId);
    if (sha256Text(canonicalJson(currentRender.files.map((file) => ({ path: file.path, sha256: file.sha256, ownership: file.ownership })))) !== installationSha256)
      throw nativeError("FY_APPROVAL_STALE", "The factory/catalog changed while approving installation.");
    const result = await factory.prepare({ ...input, dryRun: false });
    const capsule = await readCapsule(this.identity.root);
    if (capsule.id !== proposed.id) throw nativeError("FY_APPROVAL_STALE", "The installed capsule differs from the exact approved installation. Inspect the installer operation before proceeding.");
    const transaction = this.store.change(envelope, this.store.read().revision, (state) => {
      if (state.installation?.owner !== this.processOwner || state.installation.capsuleId !== capsule.id)
        throw nativeError("FY_PREPARATION_BUSY", "The installation reservation no longer matches the approved capsule.");
      state.capsuleId = capsule.id;
      state.installation = null;
      return { status: result.status, applied: result.applied, capsuleId: capsule.id,
        changes: result.changes, doctor: result.doctor, confirmationChannel: decision.channel };
    });
    return transaction.response;
    } catch (error) {
      this.store.internal("install-uncertain", `install-uncertain-${randomUUID()}`, (state) => {
        if (state.installation?.owner === this.processOwner) {
          if (state.installation.status === "reserved") state.installation = null;
          else state.installation.status = "uncertain";
        }
        return { operationId: preview.operationId, reconciliationRequired: state.installation !== null };
      });
      throw error;
    }
  }

  async consent(runId: string, sessionId: string): Promise<NativeResponse> {
    await this.flushArtifacts();
    const capsule = await this.capsule();
    const before = this.store.read();
    const run = findRun(before, runId);
    const artifact = await readRegularProjectFile(this.identity.root, `.forgeyard/project/${runId}.json`);
    if (sha256Text(artifact) !== run.artifactSha256) throw nativeError("FY_PLAN_DRIFT", "The product artifact differs from the stored proposed plan.");
    const members = Object.keys(run.baselineHeads);
    const snapshot = await workspaceSnapshot(this.identity.root, members);
    const decision = await this.confirmation({ title: "Forgeyard: approve this plan", description:
      `Approve this exact plan/policy/baseline for local implementation and finite gates?\nBaseline fingerprint: ${snapshot.sha256}`, plan: run.plan, capsule });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "The local human confirmation was rejected.");
    const after = await workspaceSnapshot(this.identity.root, members);
    const currentCapsule = await this.capsule();
    if (after.sha256 !== snapshot.sha256 || currentCapsule.id !== capsule.id) throw nativeError("FY_APPROVAL_STALE", "The project changed while the confirmation was open.");
    return this.store.change({ protocolVersion: "0.2", requestId: `consent-${randomUUID()}`, tool: "human-consent", payload: { runId } },
      before.revision, (state) => {
        if (state.writer?.sessionId !== sessionId) throw nativeError("FY_WRITER_BUSY", "Consent belongs to the current writer only.");
        state.grants.push({ runId, sessionId, planSha256: run.planSha256, capsuleId: capsule.id,
          policySha256: sha256Text(canonicalJson(capsule.payload.policy)), baselineSha256: snapshot.sha256,
          at: this.now().toISOString(), channel: decision.channel });
        state.writer.expiresAt = new Date(this.now().getTime() + 15 * 60000).toISOString();
        return { runId, approved: true, confirmationChannel: decision.channel };
      }).response;
  }

  /** Local click channel only. Never resumes or replays an installer effect. */
  async reconcileInstallation(): Promise<NativeResponse> {
    const before = this.store.read(); const intent = before.installation;
    if (!intent) return this.response({ protocolVersion: "0.2", requestId: `install-reconcile-${randomUUID()}`, tool: "human-install-reconcile", payload: {} }, { reconciled: true, changed: false });
    if (processMayBeAlive(intent.ownerPid)) throw nativeError("FY_PREPARATION_BUSY", "The recorded installer process may still be alive. Stop it normally; Forgeyard will not kill or replace it.");
    const journalPath = `.forgeyard/state/operations/${intent.operationId}.json`;
    const journalText = await readRegularProjectFile(this.identity.root, journalPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null; throw error;
    });
    const journal = journalText === null ? null : parseOperationJournal(journalText, journalPath);
    if (journal && (journal.operationId !== intent.operationId || journal.kind !== "install" ||
      !["completed", "recovered"].includes(journal.status)))
      throw nativeError("FY_RECONCILIATION_REQUIRED", "The installer journal is incomplete. Inspect/recover its exact paths before resolving the reservation; no automatic replay or deletion is allowed.");
    let installed: Capsule | null = null;
    if (journal?.status === "completed") {
      installed = await readCapsule(this.identity.root);
      if (installed.id !== intent.capsuleId || (await loadInstallManifest(this.identity.root)).latestOperationId !== intent.operationId ||
        (await runDoctor({ root: this.identity.root, denyTerms: [] })).checks.some((check) => check.required && check.status === "failed"))
        throw nativeError("FY_CAPSULE_DRIFT", "The completed installation does not match the reserved capsule/manifest/doctor checks.");
    } else {
      if (!intent.createdPaths) throw nativeError("FY_RECONCILIATION_REQUIRED", "This older reservation lacks an exact creation inventory. Inspect it manually rather than guessing.");
      for (const file of intent.createdPaths) {
        const present = await lstat(resolveInsideRoot(this.identity.root, file)).then(() => true)
          .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
        if (present) throw nativeError("FY_RECONCILIATION_REQUIRED", "An installer creation remains present. Resolve the exact journal first; this route does not remove files.");
      }
    }
    const capsule = installed ?? intent.capsule;
    if (!capsule || capsule.id !== intent.capsuleId) throw nativeError("FY_RECONCILIATION_REQUIRED", "No exact reserved capsule is available for human reconciliation.");
    const plan: ProductPlan = { id: "reconcile-installation", request: "Resolve the exact recorded installation without replaying effects", risk: "medium",
      requirements: [{ id: "R1", description: "Resolve only the ceased recorded installer" }], tasks: [{ id: "T1", role: "factory",
        title: "Reconcile installation", objective: "Adopt verified completed installation or release verified non-applied reservation",
        requirementIds: ["R1"], dependsOn: [], writeScopes: [], criteria: [{ id: "C1", description: "Journal and exact capsule agree", gateIds: capsule.payload.gates.map((gate) => gate.id) }] }] };
    const decision = await this.confirmation({ title: "Forgeyard: resolve interrupted installation", plan, capsule,
      description: `Root: ${this.identity.root}\nOperation: ${intent.operationId}\nJournal: ${journal?.status ?? "not created"}\n` +
        `Capsule: ${capsule.id}\nConfirm the old installer has ceased. ${installed ? "Adopt this verified completed harness." : "Release this verified non-applied reservation."} No installer is replayed and no file is deleted.` });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "Installation reconciliation was rejected.");
    if (installed && (await readCapsule(this.identity.root)).id !== installed.id)
      throw nativeError("FY_CAPSULE_DRIFT", "The installation changed during reconciliation.");
    return this.store.change({ protocolVersion: "0.2", requestId: `install-reconciled-${randomUUID()}`, tool: "human-install-reconcile", payload: {} },
      before.revision, (state) => { state.installation = null; state.capsuleId = installed?.id ?? null;
        return { reconciled: true, installed: !!installed, capsuleId: installed?.id ?? null, confirmationChannel: decision.channel,
          retry: "Read the current revision; use a new request ID. No prior installer call was replayed." }; }).response;
  }

  async reconcileWriter(sessionId: string): Promise<NativeResponse> {
    const capsule = await this.capsule(); const before = this.store.read();
    if (before.runs.length > 0) throw nativeError("FY_RECONCILIATION_REQUIRED", "A product run exists. Reconcile that exact run rather than transferring an idle writer.");
    const snapshot = await workspaceSnapshot(this.identity.root);
    const plan: ProductPlan = { id: "reconcile-writer", request: "Recover an idle cooperative writer; no product run is approved", risk: "medium",
      requirements: [{ id: "R1", description: "Only the previous writer lease is transferred" }], tasks: [{ id: "T1", role: "factory",
        title: "Recover idle writer", objective: "Transfer cooperative ownership without approving product writes", requirementIds: ["R1"], dependsOn: [],
        writeScopes: [], criteria: [{ id: "C1", description: "Human confirms old native writer stopped", gateIds: capsule.payload.gates.map((gate) => gate.id) }] }] };
    const decision = await this.confirmation({ title: "Forgeyard: recover idle writer", plan, capsule,
      description: `Confirm the previous native conversation has stopped writing. Old writer: ${before.writer?.sessionId ?? "none"}. New writer: ${sessionId}. No feature or gate is approved by this transfer.` });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "Writer reconciliation was rejected.");
    if ((await workspaceSnapshot(this.identity.root)).sha256 !== snapshot.sha256 || (await this.capsule()).id !== capsule.id)
      throw nativeError("FY_APPROVAL_STALE", "Project inputs changed during reconciliation.");
    return this.store.change({ protocolVersion: "0.2", requestId: `idle-writer-${randomUUID()}`, tool: "human-writer-reconcile", payload: { sessionId } },
      before.revision, (state) => { state.capsuleId = capsule.id; state.writer = { sessionId, baselineSha256: snapshot.sha256,
        expiresAt: new Date(this.now().getTime() + 15 * 60000).toISOString() }; return { reconciled: true, mode: "write" }; }).response;
  }

  /** Not exposed as an MCP approval tool: the dialog is the human channel. */
  async humanReview(runId: string, sessionId: string, artifact: EvidenceReference): Promise<NativeResponse> {
    await this.flushArtifacts();
    const capsule = await this.capsule();
    const before = this.store.read();
    const run = findRun(before, runId);
    assertWriter(before, sessionId, this.now());
    if (!grantFor(before, run, capsule, sessionId)) throw nativeError("FY_APPROVAL_REQUIRED", "Approve the exact plan before reviewing it.");
    await this.references([artifact]);
    const baselines = Object.entries(run.baselineHeads).sort(([left], [right]) => left.localeCompare(right, "en"));
    const members = baselines.map(([member]) => member);
    const snapshot = await workspaceSnapshot(this.identity.root, members);
    if (!snapshot.clean) throw nativeError("FY_GIT_REQUIRED", "Human review must refer to a clean committed revision.");
    const reviewText = await readRegularProjectFile(this.identity.root, artifact.path, 131072);
    // One diff per member, each in its own working tree: a revision range is only meaningful
    // inside the repository that recorded it, and the label says which one the hunks came from.
    const diffs = (await Promise.all(baselines.map(async ([member, baseline]) => {
      const scopes = scopesInMember(member, run.plan.tasks.flatMap((task) => task.writeScopes));
      // A member no task writes to contributes no section: `git diff` with no pathspec would
      // show the whole tree, and a human must not be asked to approve what no task claimed.
      if (scopes.length === 0) return null;
      const result = await execa("git", ["diff", "--no-ext-diff", "--no-textconv", "--unified=3",
        baseline, "HEAD", "--", ...scopes], { cwd: memberRoot(this.identity.root, member), shell: false,
        stdin: "ignore", timeout: 10000, maxBuffer: 131072, env: { GIT_OPTIONAL_LOCKS: "0" } });
      return `# member: ${member}\n${result.stdout}`;
    }))).filter((section) => section !== null);
    const findings = run.reviews.filter((review) => review.inputSha256 === snapshot.sha256).flatMap((review) => review.findings);
    const decision = await this.confirmation({ title: "Forgeyard: human review of this revision", plan: run.plan, capsule,
      description: `Approve only after personally reviewing this exact revision and artifact. You confirm that all listed important/blocking findings are resolved.\n` +
        `Git: ${baselines.map(([member, head]) => `${member}@${head}`).join(" ")}\n` +
        `Input: ${snapshot.sha256}\nArtifact: ${artifact.path} ${artifact.sha256}\n` +
        `Prior findings: ${JSON.stringify(findings)}\n\nREVIEW ARTIFACT\n${reviewText}\n\nPRODUCT DIFF\n${diffs.join("\n")}` });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "The human review was rejected.");
    await this.references([artifact]);
    if ((await workspaceSnapshot(this.identity.root, members)).sha256 !== snapshot.sha256 || (await this.capsule()).id !== capsule.id)
      throw nativeError("FY_APPROVAL_STALE", "The reviewed revision changed while the dialog was open.");
    return this.store.change({ protocolVersion: "0.2", requestId: `human-review-${randomUUID()}`, tool: "human-review", payload: { runId, artifact } },
      before.revision, (state) => {
        assertWriter(state, sessionId, this.now());
        findRun(state, runId).reviews = [...findRun(state, runId).reviews, {
          origin: "human", independent: true, provenance: decision.channel, inputSha256: snapshot.sha256,
          artifact, findings: [], resolves: findings.map((finding) => sha256Text(canonicalJson(finding))) }];
        return { runId, independent: true, confirmationChannel: decision.channel, inputSha256: snapshot.sha256 };
      }).response;
  }

  async reconcile(runId: string, sessionId: string): Promise<NativeResponse> {
    await this.flushArtifacts();
    const capsule = await this.capsule();
    const before = this.store.read();
    const run = findRun(before, runId);
    const uncertain = before.operations.filter((operation) => ["prepared", "running", "uncertain"].includes(operation.status));
    if (uncertain.length > 0 || this.jobs.size > 0)
      throw nativeError("FY_RECONCILIATION_REQUIRED", "A Forgeyard gate is still active or uncertain. Do not release its writer or repeat its effects. Inspect the recorded operation first.");
    const members = Object.keys(run.baselineHeads);
    const snapshot = await workspaceSnapshot(this.identity.root, members);
    const changed = await changedSince(this.identity.root, run.baselineHeads);
    if (changed.some((file) => !run.plan.tasks.some((task) => task.writeScopes.some((scope) => contains(scope, file))) &&
      !before.artifacts.some((artifact) => artifact.path === file))) throw nativeError("FY_SCOPE_DENIED", "Reconciliation found unapproved path changes.");
    const decision = await this.confirmation({ title: "Forgeyard: explicitly resume this project", plan: run.plan, capsule,
      description: `Confirm that the previous native writer has stopped writing and resume this exact plan with session ${sessionId}.\n` +
        `Previous writer: ${before.writer?.sessionId ?? "none"}\nRevision: ${snapshot.sha256}\n` +
        "Forgeyard cannot stop or observe AI conversations. This transfers only the cooperative lease; budgets and prior evidence remain unchanged." });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "Local reconciliation was rejected.");
    if ((await workspaceSnapshot(this.identity.root, members)).sha256 !== snapshot.sha256 || (await this.capsule()).id !== capsule.id)
      throw nativeError("FY_APPROVAL_STALE", "The project changed during reconciliation.");
    return this.store.change({ protocolVersion: "0.2", requestId: `reconcile-${randomUUID()}`, tool: "human-reconcile", payload: { runId, sessionId } },
      before.revision, (state) => {
        state.writer = { sessionId, expiresAt: new Date(this.now().getTime() + 15 * 60000).toISOString(), baselineSha256: snapshot.sha256 };
        state.grants.push({ runId, sessionId, planSha256: run.planSha256, capsuleId: capsule.id,
          policySha256: sha256Text(canonicalJson(capsule.payload.policy)), baselineSha256: snapshot.sha256,
          at: this.now().toISOString(), channel: decision.channel });
        findRun(state, runId).status = "implementing";
        return { runId, status: "implementing", approved: true, capsuleId: capsule.id, confirmationChannel: decision.channel };
      }).response;
  }

  /** Resolve a ceased HF gate as unverified, never as passing evidence. Native
   * processes are neither selected nor killed by this human-only route. */
  async reconcileOperation(operationId: string): Promise<NativeResponse> {
    const capsule = await this.capsule(); const before = this.store.read();
    const operation = before.operations.find((entry) => entry.id === operationId);
    if (!operation || !["prepared", "running", "uncertain"].includes(operation.status))
      throw nativeError("FY_OPERATION_UNKNOWN", "This is not an unresolved Forgeyard gate operation.");
    if (this.jobs.has(operationId) || processMayBeAlive(operation.ownerPid) ||
      (operation.gatePid !== undefined && processMayBeAlive(operation.gatePid)))
      throw nativeError("FY_OPERATION_BUSY", "A recorded Forgeyard service/gate may still be alive. Stop it normally and inspect it; no process will be killed or writer automatically released.");
    const run = findRun(before, operation.runId); const members = Object.keys(run.baselineHeads);
    const snapshot = await workspaceSnapshot(this.identity.root, members);
    const decision = await this.confirmation({ title: "Forgeyard: reconcile ceased gate", plan: run.plan, capsule,
      description: `Operation: ${operation.id}\nRecorded HF service PID: ${operation.ownerPid}\nRecorded gate PID: ${operation.gatePid ?? "not observed"}\n` +
        `Old input: ${operation.inputSha256}\nCurrent input: ${snapshot.sha256}\n` +
        "Known recorded processes are absent, but child-process termination is not proven by Forgeyard. Personally confirm the old gate and all its children have stopped, inspect any effects, and mark this attempt UNVERIFIED. This does not approve automatic retries, release a native conversation or certify a pass." });
    if (!decision.accepted) throw nativeError("FY_APPROVAL_DENIED", "Operation reconciliation was rejected.");
    if ((await workspaceSnapshot(this.identity.root, members)).sha256 !== snapshot.sha256 || (await this.capsule()).id !== capsule.id ||
      processMayBeAlive(operation.ownerPid) || (operation.gatePid !== undefined && processMayBeAlive(operation.gatePid)))
      throw nativeError("FY_RECONCILIATION_REQUIRED", "Inputs/process state changed during operation reconciliation.");
    return this.store.change({ protocolVersion: "0.2", requestId: `operation-reconcile-${randomUUID()}`, tool: "human-operation-reconcile", payload: { operationId } },
      before.revision, (state) => { const current = state.operations.find((entry) => entry.id === operationId)!;
        current.status = "canceled"; current.failure = "reconciled-unverified"; current.finishedAt = this.now().toISOString();
        findRun(state, current.runId).status = "reconciling";
        return { operationId, status: "canceled", certified: false, writerRetained: true, confirmationChannel: decision.channel }; }).response;
  }

  private launch(operationId: string, capsule: Capsule): void {
    const controller = new AbortController();
    const promise = this.performGate(operationId, capsule, controller.signal).catch((error) => {
      this.store.internal("gate-uncertain", `uncertain-${operationId}`, (state) => {
        const operation = state.operations.find((entry) => entry.id === operationId)!;
        operation.status = "uncertain"; operation.failure = "runner-or-persistence-error";
        findRun(state, operation.runId).status = "reconciling";
        return { operationId, status: "uncertain" };
      });
    }).finally(() => this.jobs.delete(operationId));
    this.jobs.set(operationId, { controller, promise });
  }

  private async performGate(operationId: string, capsule: Capsule, signal: AbortSignal): Promise<void> {
    const operation = this.store.read().operations.find((entry) => entry.id === operationId)!;
    const gate = capsule.payload.gates.find((entry) => entry.id === operation.gateId)!;
    // The same members the run's `inputSha256` was taken over: a digest computed on another
    // set would never equal it, and the comparisons below would refuse every gate.
    const members = Object.keys(findRun(this.store.read(), operation.runId).baselineHeads);
    const before = await workspaceSnapshot(this.identity.root, members);
    const currentCapsule = await this.capsule();
    if (signal.aborted || !before.clean || before.sha256 !== operation.inputSha256 || currentCapsule.id !== operation.capsuleId ||
      sha256Text(canonicalJson(gate)) !== operation.gateSha256) {
      this.store.internal("gate-not-started", `not-started-${operationId}`, (state) => {
        const current = state.operations.find((entry) => entry.id === operationId)!;
        current.status = signal.aborted ? "canceled" : "failed"; current.failure = signal.aborted ? "canceled" : "stale-before-spawn";
        current.finishedAt = this.now().toISOString();
        return { operationId, status: current.status, processStarted: false };
      }); return;
    }
    this.store.internal("gate-started", `started-${operationId}`, (state) => {
      state.operations.find((entry) => entry.id === operationId)!.status = "running";
      return { operationId, status: "running" };
    });
    const result = await this.runner({ gate, cwd: this.identity.root, signal, onSpawn: (pid) => {
      this.store.internal("gate-process-observed", `pid-${operationId}`, (state) => {
        state.operations.find((entry) => entry.id === operationId)!.gatePid = pid;
        return { operationId, processObserved: true };
      });
    } });
    if (!Number.isSafeInteger(result.exitCode) || typeof result.stdout !== "string" || typeof result.stderr !== "string")
      throw nativeError("FY_GATE_RESULT_INVALID", "The trusted gate runner returned an invalid result.");
    const tests = gate.parser === "test-summary" ? discoveredTests(result.stdout + result.stderr) : null;
    const after = await workspaceSnapshot(this.identity.root, members);
    let failure: string | undefined;
    if (signal.aborted || result.exitCode !== 0 || result.canceled || result.timedOut) failure = signal.aborted || result.canceled ? "canceled" : result.timedOut ? "timeout" : "nonzero-exit";
    else if (gate.parser === "test-summary") failure = testSummaryFailure(result.stdout + result.stderr) ?? undefined;
    if (!failure && (after.sha256 !== operation.inputSha256 || !after.clean)) failure = "stale-inputs";
    try { await this.capsule(); } catch { failure = "capsule-drift"; }
    if (Buffer.byteLength(result.stdout) > gate.maxOutputBytes || Buffer.byteLength(result.stderr) > gate.maxOutputBytes) {
      failure = "output-limit"; result.stdout = result.stdout.slice(0, Math.floor(gate.maxOutputBytes / 4));
      result.stderr = result.stderr.slice(0, Math.floor(gate.maxOutputBytes / 4));
    }
    const logDirectory = path.join(this.stateDirectory, "gate-logs"); await assertDirectoryChain(logDirectory, true);
    await atomicText(path.join(logDirectory, `${operationId}.json`), JSON.stringify({ stdout: result.stdout, stderr: result.stderr }), null);
    this.store.internal("gate-finished", `finished-${operationId}`, (state) => {
      const current = state.operations.find((entry) => entry.id === operationId)!;
      current.status = failure === "canceled" ? "canceled" : failure ? "failed" : "passed";
      current.exitCode = result.exitCode; current.testsDiscovered = tests;
      current.stdoutSha256 = sha256Text(result.stdout); current.stderrSha256 = sha256Text(result.stderr);
      current.finishedAt = this.now().toISOString();
      if (failure) current.failure = failure;
      const run = findRun(state, current.runId);
      if (failure && failure !== "canceled") {
        run.repairs += 1;
        if (run.status !== "paused" && run.status !== "reconciling") run.status = "repairing";
      }
      else if (run.status !== "paused" && run.status !== "reconciling") run.status = "implementing";
      return { operationId, status: current.status, failure: failure ?? null };
    });
  }

  async waitForOperations(): Promise<void> { await Promise.all([...this.jobs.values()].map((job) => job.promise)); }
  async shutdown(): Promise<void> {
    for (const job of this.jobs.values()) job.controller.abort();
    await this.close();
  }
  async close(): Promise<void> {
    this.closing ??= this.waitForOperations().then(() => this.store.close());
    await this.closing;
  }
}

export async function createProjectService(input: ProjectServiceInput): Promise<ProjectService> {
  const identity = await workspaceIdentity(input.root);
  const stateDirectory = path.resolve(input.stateDirectory ?? defaultNativeStateDirectory());
  if (contains(identity.root.replaceAll("\\", "/"), stateDirectory.replaceAll("\\", "/")))
    throw nativeError("FY_STATE_UNSAFE", "Execution state must stay outside the working tree.");
  if (identity.commonDirectory && contains(identity.commonDirectory.replaceAll("\\", "/"), stateDirectory.replaceAll("\\", "/")))
    throw nativeError("FY_STATE_UNSAFE", "Execution state must also stay outside the common Git directory.");
  await assertDirectoryChain(stateDirectory, true);
  const store = await NativeStore.open(stateDirectory, identity.id);
  return new ProjectService(identity, store, stateDirectory, input);
}
