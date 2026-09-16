import { randomBytes } from "node:crypto";
import path from "node:path";

import { execa } from "execa";

import type { VerificationReceipt } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { assertDirectoryChain } from "../native/files.js";
import {
  buildReceipt,
  loadTask,
  nodeGitPort,
  writeReceipt,
  type GitPort,
} from "./receipts.js";

const TIMEOUT_MS = 900_000;
const MAX_BUFFER_BYTES = 1_048_576;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface CommandRunInput {
  executable: string;
  args: readonly string[];
  cwd: string;
  shell: false;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface CommandRunResult {
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  notFound?: boolean;
  timedOut?: boolean;
  canceled?: boolean;
}

export type CommandRunner = (input: CommandRunInput) => Promise<CommandRunResult>;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface VerificationPorts {
  git: GitPort;
  runner: CommandRunner;
  clock: Clock;
  ids: IdGenerator;
}

export interface VerificationInput {
  root: string;
  taskId: string;
}

export interface VerificationResult {
  status: "passed";
  receipt: VerificationReceipt;
  receiptPath: string;
  stdoutBytes: number;
  stderrBytes: number;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanField(value: unknown): boolean {
  return value === true;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export const nodeCommandRunner: CommandRunner = async (input) => {
  try {
    const result = await execa(input.executable, [...input.args], {
      cwd: input.cwd,
      shell: false,
      reject: false,
      stdin: "ignore",
      timeout: input.timeoutMs,
      maxBuffer: input.maxBufferBytes,
      stripFinalNewline: false,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.timedOut ? { timedOut: true } : {}),
      ...(result.isCanceled ? { canceled: true } : {}),
    };
  } catch (error) {
    const value = record(error);
    const code = stringField(value.code);
    return {
      exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
      stdout: stringField(value.stdout),
      stderr: stringField(value.stderr),
      ...(code === "ENOENT" || booleanField(value.commandNotFound) ? { notFound: true } : {}),
      ...(booleanField(value.timedOut) ? { timedOut: true } : {}),
      ...(booleanField(value.isCanceled) || booleanField(value.canceled) ? { canceled: true } : {}),
    };
  }
};

const systemClock: Clock = { now: () => new Date() };
const systemIds: IdGenerator = {
  next: () => `receipt-${new Date().toISOString().replaceAll(/[^0-9]/g, "")}-${randomBytes(6).toString("hex")}`,
};

function defaultPorts(): VerificationPorts {
  return { git: nodeGitPort, runner: nodeCommandRunner, clock: systemClock, ids: systemIds };
}

function gitRequired(cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_GIT_REQUIRED",
    message: "Verification requires a real clean Git HEAD.",
    remediation: "Commit the intended project state and remove tracked or untracked changes before retrying.",
    exitCode: 7,
    ...(cause === undefined ? {} : { cause }),
  });
}

function commandFailed(receiptPath: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_COMMAND_FAILED",
    message: "The verification command did not complete successfully.",
    remediation: "Inspect the command locally, correct the failure, and rerun verification.",
    exitCode: 8,
    paths: [receiptPath],
  });
}

function stableExitCode(result: CommandRunResult): number {
  if (typeof result.exitCode === "number") return Math.max(0, Math.trunc(result.exitCode));
  if (result.notFound === true) return 127;
  if (result.timedOut === true) return 124;
  if (result.canceled === true) return 130;
  return 1;
}

export async function runVerification(
  input: VerificationInput,
  ports: VerificationPorts = defaultPorts(),
): Promise<VerificationResult> {
  const root = path.resolve(input.root);
  const task = await loadTask(root, input.taskId);

  let gitCommit: string;
  let gitStatus: string;
  try {
    [gitCommit, gitStatus] = await Promise.all([ports.git.head(root), ports.git.status(root)]);
  } catch (error) {
    throw gitRequired(error);
  }
  gitCommit = gitCommit.trim().toLowerCase();
  if (!COMMIT_PATTERN.test(gitCommit) || gitStatus.trim().length > 0) throw gitRequired();

  const started = ports.clock.now();
  const commands = task.task.commands ?? [{ name: "verification", argv: task.task.command }];
  const gates: { name: string; argvSha256: string; exitCode: number }[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  for (const command of commands) {
    const [executable, ...args] = command.argv;
    const cwd = command.cwd === undefined ? root : resolveInsideRoot(root, command.cwd);
    await assertDirectoryChain(cwd);
    const result = await ports.runner({ executable, args, cwd, shell: false,
      timeoutMs: TIMEOUT_MS, maxBufferBytes: MAX_BUFFER_BYTES });
    gates.push({ name: command.name, argvSha256: sha256Text(canonicalJson(command.argv)),
      exitCode: stableExitCode(result) });
    output.push(result.stdout);
    errors.push(result.stderr);
  }
  const commandResult = { stdout: output.join(""), stderr: errors.join("") };
  const finished = ports.clock.now();
  const exitCode = gates.find((gate) => gate.exitCode !== 0)?.exitCode ?? 0;
  const receipt = buildReceipt({
    receiptId: ports.ids.next(),
    taskId: task.task.id,
    taskSource: task.source,
    argv: task.task.command,
    gitCommit,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    exitCode,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
    ...(task.task.commands === undefined ? {} : { commands: task.task.commands, gates }),
  });
  const receiptPath = await writeReceipt(root, receipt);
  if (exitCode !== 0) throw commandFailed(receiptPath);
  const [postHead, postStatus, postTask] = await Promise.all([
    ports.git.head(root), ports.git.status(root), loadTask(root, input.taskId),
  ]);
  if (postHead.trim().toLowerCase() !== gitCommit || postStatus.trim().length > 0 || postTask.sha256 !== task.sha256) {
    throw new ForgeyardError({ code: "FY_EVIDENCE_INVALID", exitCode: 8,
      message: "Verification changed its inputs; the receipt cannot certify the resulting working tree.",
      remediation: "Commit the intended state and rerun every required gate.", paths: [receiptPath] });
  }

  return {
    status: "passed",
    receipt,
    receiptPath,
    stdoutBytes: Buffer.byteLength(commandResult.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(commandResult.stderr, "utf8"),
  };
}
