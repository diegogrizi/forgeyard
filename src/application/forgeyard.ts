import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createHarnessAdapter } from "../adapters/create.js";
import { loadConfig } from "../config/config.js";
import { collectInitRequest, type PromptDriver } from "../config/wizard.js";
import type { CheckResult, DoctorReport, VerificationReceipt } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { runDoctor, type DoctorInput } from "../doctor/run-doctor.js";
import { getReceiptStatus } from "../evidence/receipts.js";
import { runVerification, type VerificationInput, type VerificationResult } from "../evidence/run-verification.js";
import { applyInstallPlan } from "../installer/apply.js";
import { buildInstallPlan } from "../installer/plan.js";
import { applyRollback, planRollback } from "../installer/rollback.js";
import { applyUpdate, planUpdate } from "../installer/update.js";
import { loadRegistry } from "../registry/load.js";
import { resolveProfile } from "../registry/resolve.js";
import {
  recordUsageCommand,
  runTaskCommand,
  type TaskCommandInput,
  type TaskCommandResult,
  type UsageCommandInput,
  type UsageCommandResult,
} from "./orchestration.js";

export type { TaskCommandInput, TaskCommandResult, UsageCommandInput, UsageCommandResult } from "./orchestration.js";

export type WriteStatus = "applied" | "preview" | "declined" | "no-op";

export interface DoctorSummary {
  passed: number;
  failed: number;
  skipped: number;
  unavailable: number;
}

export interface InitCommandInput {
  targetRoot: string;
  profile?: string;
  adapter?: string;
  answersPath?: string;
  yes: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
}

export interface DoctorCommandInput {
  root: string;
  denyTerms: readonly string[];
}

export interface VerifyCommandInput {
  root: string;
  taskId: string;
}

export interface UpdateCommandInput {
  root: string;
  yes: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
}

export interface RollbackCommandInput {
  root: string;
  sourceOperationId: string;
  yes: boolean;
  nonInteractive: boolean;
}

export interface ChangeSummary {
  created: readonly string[];
  updated: readonly string[];
  removed: readonly string[];
  unchanged: readonly string[];
  preserved: readonly string[];
}

interface WriteCommandResult {
  schemaVersion: 1;
  ok: true;
  root: string;
  operationId: string;
  applied: boolean;
  status: WriteStatus;
  changes: ChangeSummary;
  doctor: DoctorSummary | null;
}

export interface InitCommandResult extends WriteCommandResult {
  command: "init";
}

export interface UpdateCommandResult extends WriteCommandResult {
  command: "update";
}

export interface DoctorCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "doctor";
  root: string;
  summary: DoctorSummary;
  checks: readonly CheckResult[];
}

export interface VerifyCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "verify";
  root: string;
  taskId: string;
  status: "passed";
  receiptPath: string;
  current: boolean;
  receipt: VerificationReceipt;
  stdoutBytes: number;
  stderrBytes: number;
}

export interface RollbackCommandResult {
  schemaVersion: 1;
  ok: true;
  command: "rollback";
  root: string;
  operationId: string;
  sourceOperationId: string;
  applied: boolean;
  status: Exclude<WriteStatus, "no-op">;
  changes: {
    removed: readonly string[];
    restored: readonly string[];
  };
}

export type ForgeyardCommandResult =
  | InitCommandResult
  | DoctorCommandResult
  | VerifyCommandResult
  | UpdateCommandResult
  | RollbackCommandResult
  | TaskCommandResult
  | UsageCommandResult;

export interface ForgeyardService {
  init(input: InitCommandInput): Promise<InitCommandResult>;
  doctor(input: DoctorCommandInput): Promise<DoctorCommandResult>;
  verify(input: VerifyCommandInput): Promise<VerifyCommandResult>;
  update(input: UpdateCommandInput): Promise<UpdateCommandResult>;
  rollback(input: RollbackCommandInput): Promise<RollbackCommandResult>;
  task(input: TaskCommandInput): Promise<TaskCommandResult>;
  recordUsage(input: UsageCommandInput): Promise<UsageCommandResult>;
}

export interface ForgeyardApplicationOptions {
  prompts: PromptDriver;
  forgeyardVersion?: string;
  registryRoot?: string;
  operationId?: (kind: "init" | "update") => string;
  doctorRunner?: (input: DoctorInput) => Promise<DoctorReport>;
  verificationRunner?: (input: VerificationInput) => Promise<VerificationResult>;
}

export function packagedRegistryRoot(metaUrl = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL("../../", metaUrl)));
}

function defaultOperationId(kind: "init" | "update"): string {
  const timestamp = new Date().toISOString().replaceAll(/[^0-9]/g, "");
  return `${timestamp}-${kind}-${randomBytes(6).toString("hex")}`;
}

export function summarizeDoctor(report: DoctorReport): DoctorSummary {
  const count = (status: CheckResult["status"]): number => report.checks.filter((check) => check.status === status).length;
  return {
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    unavailable: count("unavailable"),
  };
}

function failedPaths(report: DoctorReport): readonly string[] | undefined {
  const paths = [...new Set(
    report.checks
      .filter((check) => check.required && check.status !== "passed")
      .flatMap((check) => check.paths ?? []),
  )].sort((left, right) => left.localeCompare(right, "en"));
  return paths.length === 0 ? undefined : paths;
}

function doctorFailure(report: DoctorReport | undefined, recovered: boolean, cause?: unknown): ForgeyardError {
  const paths = report === undefined ? undefined : failedPaths(report);
  return new ForgeyardError({
    code: "FY_DOCTOR_FAILED",
    message: recovered
      ? "Post-write doctor failed; automatic recovery completed and operation journals were retained."
      : "Forgeyard doctor found one or more failed required checks.",
    remediation: recovered
      ? "Inspect the doctor findings and retained journals before retrying the operation."
      : "Correct the reported installed state and run doctor again.",
    exitCode: 6,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function transactionRecoveryFailure(error: unknown): ForgeyardError {
  const paths = error instanceof ForgeyardError ? error.paths : undefined;
  return new ForgeyardError({
    code: "FY_TRANSACTION_FAILED",
    message: "Post-write validation failed and automatic recovery is incomplete.",
    remediation: "Inspect the retained operation journals and the listed paths before making another change.",
    exitCode: 5,
    ...(paths === undefined ? {} : { paths }),
    cause: error,
  });
}

function portableRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll("\\", "/");
}

async function chooseWriteStatus(
  changeCount: number,
  input: { yes: boolean; dryRun?: boolean; nonInteractive: boolean },
  prompts: PromptDriver,
  message: string,
): Promise<WriteStatus> {
  if (changeCount === 0) return "no-op";
  if (input.dryRun === true || (input.nonInteractive && !input.yes)) return "preview";
  if (input.yes) return "applied";
  return await prompts.confirm("apply", message, false) ? "applied" : "declined";
}

export function createForgeyardService(options: ForgeyardApplicationOptions): ForgeyardService {
  const registryRoot = path.resolve(options.registryRoot ?? packagedRegistryRoot());
  const forgeyardVersion = options.forgeyardVersion ?? "0.1.0";
  const operationId = options.operationId ?? defaultOperationId;
  const doctorRunner = options.doctorRunner ?? runDoctor;
  const verificationRunner = options.verificationRunner ?? runVerification;

  async function checkedDoctor(root: string, denyTerms: readonly string[] = []): Promise<DoctorReport> {
    const report = await doctorRunner({ root, denyTerms });
    if (!report.ok) throw doctorFailure(report, false);
    return report;
  }

  async function postWriteDoctor(root: string, completedOperationId: string): Promise<DoctorSummary> {
    let report: DoctorReport | undefined;
    let doctorError: unknown;
    try {
      report = await doctorRunner({ root });
    } catch (error) {
      doctorError = error;
    }
    if (report?.ok) return summarizeDoctor(report);
    try {
      await applyRollback(await planRollback(root, completedOperationId));
    } catch (error) {
      throw transactionRecoveryFailure(error);
    }
    throw doctorFailure(report, true, doctorError);
  }

  async function renderPlan(root: string, config: Awaited<ReturnType<typeof loadConfig>>, nextOperationId: string) {
    const registry = await loadRegistry(registryRoot);
    const adapterId = config.harnesses[0];
    const resolved = resolveProfile(registry, config.profile, adapterId, config.catalog);
    const adapter = createHarnessAdapter(adapterId);
    const renderedFiles = await adapter.render(resolved.components, config);
    await adapter.validateOutput(renderedFiles);
    return buildInstallPlan({
      targetRoot: root,
      config,
      resolved,
      renderedFiles,
      operationId: nextOperationId,
      forgeyardVersion,
    });
  }

  return {
    async init(input) {
      const request = await collectInitRequest(
        {
          targetRoot: input.targetRoot,
          nonInteractive: input.nonInteractive,
          ...(input.answersPath === undefined ? {} : { answersPath: input.answersPath }),
          ...(input.profile === undefined ? {} : { profile: input.profile }),
          ...(input.adapter === undefined ? {} : { adapter: input.adapter }),
        },
        options.prompts,
      );
      const nextOperationId = operationId("init");
      const plan = await renderPlan(request.targetRoot, request.config, nextOperationId);
      const preview = await applyInstallPlan(plan, { dryRun: true });
      const status = await chooseWriteStatus(
        preview.created.length,
        input,
        options.prompts,
        `Install ${preview.created.length} Forgeyard files in ${request.targetRoot}?`,
      );

      if (status !== "applied") {
        const doctor = status === "no-op" ? summarizeDoctor(await checkedDoctor(request.targetRoot)) : null;
        return {
          schemaVersion: 1,
          ok: true,
          command: "init",
          root: request.targetRoot,
          operationId: nextOperationId,
          applied: false,
          status,
          changes: {
            created: preview.created,
            updated: [],
            removed: [],
            unchanged: preview.unchanged,
            preserved: preview.preserved,
          },
          doctor,
        };
      }

      const result = await applyInstallPlan(plan);
      const doctor = result.applied
        ? await postWriteDoctor(request.targetRoot, result.operationId)
        : summarizeDoctor(await checkedDoctor(request.targetRoot));
      return {
        schemaVersion: 1,
        ok: true,
        command: "init",
        root: request.targetRoot,
        operationId: result.operationId,
        applied: result.applied,
        status: result.applied ? "applied" : "no-op",
        changes: {
          created: result.created,
          updated: [],
          removed: [],
          unchanged: result.unchanged,
          preserved: result.preserved,
        },
        doctor,
      };
    },

    async doctor(input) {
      const report = await checkedDoctor(path.resolve(input.root), input.denyTerms);
      return {
        schemaVersion: 1,
        ok: true,
        command: "doctor",
        root: report.root,
        summary: summarizeDoctor(report),
        checks: report.checks,
      };
    },

    async verify(input) {
      const root = path.resolve(input.root);
      const result = await verificationRunner({ root, taskId: input.taskId });
      const current = await getReceiptStatus(root, result.receipt);
      return {
        schemaVersion: 1,
        ok: true,
        command: "verify",
        root,
        taskId: input.taskId,
        status: result.status,
        receiptPath: portableRelative(root, result.receiptPath),
        current: current === "current",
        receipt: result.receipt,
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
      };
    },

    async update(input) {
      const root = path.resolve(input.root);
      const config = await loadConfig(path.join(root, "forgeyard.yaml"));
      const nextOperationId = operationId("update");
      const next = await renderPlan(root, config, nextOperationId);
      const plan = await planUpdate(root, next);
      const preview = await applyUpdate(plan, { dryRun: true });
      const changeCount = preview.created.length + preview.updated.length + preview.removed.length;
      const status = await chooseWriteStatus(
        changeCount,
        input,
        options.prompts,
        `Apply ${changeCount} Forgeyard file changes in ${root}?`,
      );

      if (status !== "applied") {
        const doctor = status === "no-op" ? summarizeDoctor(await checkedDoctor(root)) : null;
        return {
          schemaVersion: 1,
          ok: true,
          command: "update",
          root,
          operationId: nextOperationId,
          applied: false,
          status,
          changes: {
            created: preview.created,
            updated: preview.updated,
            removed: preview.removed,
            unchanged: preview.unchanged,
            preserved: preview.preserved,
          },
          doctor,
        };
      }

      const result = await applyUpdate(plan);
      const doctor = result.applied
        ? await postWriteDoctor(root, result.operationId)
        : summarizeDoctor(await checkedDoctor(root));
      return {
        schemaVersion: 1,
        ok: true,
        command: "update",
        root,
        operationId: result.operationId,
        applied: result.applied,
        status: result.applied ? "applied" : "no-op",
        changes: {
          created: result.created,
          updated: result.updated,
          removed: result.removed,
          unchanged: result.unchanged,
          preserved: result.preserved,
        },
        doctor,
      };
    },

    async rollback(input) {
      const root = path.resolve(input.root);
      const plan = await planRollback(root, input.sourceOperationId);
      const preview = await applyRollback(plan, { dryRun: true });
      const status = input.nonInteractive && !input.yes
        ? "preview"
        : input.yes
          ? "applied"
          : await options.prompts.confirm(
              "apply",
              `Reverse Forgeyard operation ${input.sourceOperationId} in ${root}?`,
              false,
            )
            ? "applied"
            : "declined";
      const result = status === "applied" ? await applyRollback(plan) : preview;
      return {
        schemaVersion: 1,
        ok: true,
        command: "rollback",
        root,
        operationId: result.operationId,
        sourceOperationId: result.sourceOperationId,
        applied: result.applied,
        status,
        changes: { removed: result.removed, restored: result.restored },
      };
    },

    task: runTaskCommand,

    recordUsage: recordUsageCommand,
  };
}
