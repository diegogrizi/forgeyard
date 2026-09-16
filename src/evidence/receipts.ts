import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";
import { execa } from "execa";
import { parse } from "yaml";

import type { NonEmptyArgv, QualityCommand, VerificationReceipt, VerificationTask } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";

const TASK_ID_PATTERN = /^[A-Z][A-Z0-9_-]{1,31}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface LoadedTask {
  task: VerificationTask;
  source: string;
  sha256: string;
  path: string;
}

export interface GitPort {
  head(root: string): Promise<string>;
  status(root: string): Promise<string>;
}

export interface ReceiptInput {
  receiptId: string;
  taskId: string;
  taskSource: string;
  argv: NonEmptyArgv;
  gitCommit: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  commands?: readonly QualityCommand[];
  gates?: VerificationReceipt["gates"];
}

let taskValidator: ValidateFunction | undefined;
let receiptValidator: ValidateFunction | undefined;

function configError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CONFIG_INVALID",
    message,
    remediation: "Correct the Forgeyard verification task and retry.",
    exitCode: 2,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function receiptError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_EVIDENCE_INVALID",
    message,
    remediation: "Regenerate the verification evidence from a clean Git revision.",
    exitCode: 8,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function schemaValidator(name: "task.schema.json" | "receipt.schema.json"): ValidateFunction {
  const schemaUrl = new URL(`../../schemas/${name}`, import.meta.url);
  const schemaPath = decodeURIComponent(schemaUrl.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false });
  formatsModule.default.default(ajv);
  return ajv.compile(schema);
}

function validateTask(): ValidateFunction {
  taskValidator ??= schemaValidator("task.schema.json");
  return taskValidator;
}

function validateReceipt(): ValidateFunction {
  receiptValidator ??= schemaValidator("receipt.schema.json");
  return receiptValidator;
}

function formatValidation(errors: readonly ErrorObject[] | null | undefined): string {
  if (errors === undefined || errors === null || errors.length === 0) return "unknown schema error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ");
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw configError("Verification task ID is invalid.");
  }
}

function assertReceiptId(receiptId: string): void {
  if (!RECEIPT_ID_PATTERN.test(receiptId)) {
    throw receiptError("Verification receipt ID is invalid.");
  }
}

function isNonEmptyArgv(value: readonly string[]): value is NonEmptyArgv {
  return value.length > 0 && value[0]!.length > 0;
}

export const nodeGitPort: GitPort = {
  async head(root) {
    const result = await execa("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      shell: false,
      reject: false,
      stdin: "ignore",
    });
    const commit = result.stdout.trim().toLowerCase();
    if (result.exitCode !== 0 || !COMMIT_PATTERN.test(commit)) {
      throw new Error("Git HEAD is unavailable.");
    }
    return commit;
  },
  async status(root) {
    const result = await execa("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      shell: false,
      reject: false,
      stdin: "ignore",
    });
    if (result.exitCode !== 0) throw new Error("Git status is unavailable.");
    return result.stdout;
  },
};

export async function loadTask(root: string, taskId: string): Promise<LoadedTask> {
  assertTaskId(taskId);
  const taskPath = resolveInsideRoot(path.resolve(root), `.forgeyard/tasks/${taskId}.yaml`);
  let source: string;
  try {
    source = await readFile(taskPath, "utf8");
  } catch (error) {
    throw configError("Unable to read the requested verification task.", [taskPath], error);
  }

  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    throw configError("The verification task is not valid YAML.", [taskPath], error);
  }
  const validate = validateTask();
  if (!validate(value)) {
    throw configError(
      `Verification task failed schema validation: ${formatValidation(validate.errors)}`,
      [taskPath],
    );
  }

  const task = value as VerificationTask;
  if (task.id !== taskId || !isNonEmptyArgv(task.command) ||
    task.commands?.some((command) => !isNonEmptyArgv(command.argv)) === true) {
    throw configError("Verification task ID or executable is invalid.", [taskPath]);
  }
  return { task, source, sha256: sha256Text(source), path: taskPath };
}

export function buildReceipt(input: ReceiptInput): VerificationReceipt {
  const receipt: VerificationReceipt = {
    schemaVersion: 1,
    receiptId: input.receiptId,
    taskId: input.taskId,
    taskSha256: sha256Text(input.taskSource),
    argvSha256: sha256Text(canonicalJson(input.argv)),
    gitCommit: input.gitCommit.toLowerCase(),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    stdoutSha256: sha256Text(input.stdout),
    stderrSha256: sha256Text(input.stderr),
    status: input.exitCode === 0 ? "passed" : "failed",
    ...(input.commands === undefined ? {} : { commandsSha256: sha256Text(canonicalJson(input.commands)) }),
    ...(input.gates === undefined ? {} : { gates: input.gates }),
  };
  serializeReceipt(receipt);
  return receipt;
}

export function serializeReceipt(receipt: VerificationReceipt): string {
  assertReceiptId(receipt.receiptId);
  const validate = validateReceipt();
  if (!validate(receipt)) {
    throw receiptError(`Verification receipt failed schema validation: ${formatValidation(validate.errors)}`);
  }
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function parseReceipt(source: string, sourcePath: string): VerificationReceipt {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw receiptError("Verification receipt is not valid JSON.", [sourcePath], error);
  }
  const validate = validateReceipt();
  if (!validate(value)) {
    throw receiptError(
      `Verification receipt failed schema validation: ${formatValidation(validate.errors)}`,
      [sourcePath],
    );
  }
  return value as VerificationReceipt;
}

export async function writeReceipt(root: string, receipt: VerificationReceipt): Promise<string> {
  assertReceiptId(receipt.receiptId);
  const relativePath = `.forgeyard/evidence/${receipt.receiptId}.json`;
  const receiptPath = resolveInsideRoot(path.resolve(root), relativePath);
  const directory = path.dirname(receiptPath);
  const temporaryPath = `${receiptPath}.tmp`;
  const source = serializeReceipt(receipt);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, receiptPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw receiptError("Unable to persist verification evidence.", [relativePath], error);
  }
  return receiptPath;
}

export async function getReceiptStatus(
  root: string,
  receipt: VerificationReceipt,
  git: GitPort = nodeGitPort,
): Promise<"current" | "stale"> {
  try {
    serializeReceipt(receipt);
    const task = await loadTask(root, receipt.taskId);
    const [head, status] = await Promise.all([git.head(root), git.status(root)]);
    if (status.trim().length > 0) return "stale";
    if (head.toLowerCase() !== receipt.gitCommit) return "stale";
    if (task.sha256 !== receipt.taskSha256) return "stale";
    if (sha256Text(canonicalJson(task.task.command)) !== receipt.argvSha256) return "stale";
    if (task.task.commands !== undefined) {
      if (sha256Text(canonicalJson(task.task.commands)) !== receipt.commandsSha256) return "stale";
      if (receipt.gates?.length !== task.task.commands.length) return "stale";
      if (receipt.gates.some((gate, index) => gate.exitCode !== 0 ||
        gate.name !== task.task.commands![index]!.name ||
        gate.argvSha256 !== sha256Text(canonicalJson(task.task.commands![index]!.argv)))) return "stale";
    } else if (receipt.commandsSha256 !== undefined) return "stale";
    return "current";
  } catch {
    return "stale";
  }
}
