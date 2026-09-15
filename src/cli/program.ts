import { Command, CommanderError } from "commander";

import {
  createForgeyardService,
  type ForgeyardCommandResult,
  type ForgeyardService,
} from "../application/forgeyard.js";
import { createInquirerPromptDriver } from "../config/wizard.js";
import { formatFailure } from "../core/errors.js";

export interface CliDependencies {
  version: string;
  service: ForgeyardService;
  interactive: boolean;
}

export interface CliIo {
  writeOut(value: string): void;
  writeErr(value: string): void;
  debug: boolean;
}

const productionPrompts = createInquirerPromptDriver();

export const defaultDependencies: CliDependencies = {
  version: "0.1.0",
  service: createForgeyardService({ prompts: productionPrompts, forgeyardVersion: "0.1.0" }),
  interactive: process.stdin.isTTY === true,
};

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function stringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function booleanOption(options: Record<string, unknown>, name: string): boolean {
  return options[name] === true;
}

function listOption(options: Record<string, unknown>, name: string): readonly string[] {
  const value = options[name];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function lineList(label: string, values: readonly string[]): string {
  return `${label}: ${values.length === 0 ? "(none)" : values.join(", ")}`;
}

export function formatSuccess(result: ForgeyardCommandResult, json: boolean): string {
  if (json) return `${JSON.stringify(result)}\n`;

  switch (result.command) {
    case "init":
    case "update":
      return `${[
        `Forgeyard ${result.command}: ${result.status}`,
        `Operation: ${result.operationId}`,
        lineList("Created", result.changes.created),
        lineList("Updated", result.changes.updated),
        lineList("Removed", result.changes.removed),
        lineList("Unchanged", result.changes.unchanged),
        lineList("Preserved", result.changes.preserved),
        result.doctor === null
          ? "Doctor: not run"
          : `Doctor: passed (${result.doctor.passed} passed, ${result.doctor.skipped} skipped, ${result.doctor.unavailable} unavailable)`,
      ].join("\n")}\n`;
    case "doctor":
      return `${[
        "Forgeyard doctor: passed",
        `Checks: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped, ${result.summary.unavailable} unavailable`,
      ].join("\n")}\n`;
    case "verify":
      return `${[
        `Forgeyard verify: ${result.status}`,
        `Task: ${result.taskId}`,
        `Receipt: ${result.receiptPath}`,
        `Evidence: ${result.current ? "current" : "stale"}`,
      ].join("\n")}\n`;
    case "rollback":
      return `${[
        `Forgeyard rollback: ${result.status}`,
        `Operation: ${result.operationId}`,
        `Source operation: ${result.sourceOperationId}`,
        lineList("Removed", result.changes.removed),
        lineList("Restored", result.changes.restored),
      ].join("\n")}\n`;
    case "task":
      return `${[
        `Forgeyard task ${result.action}: passed`,
        ...(result.task === undefined ? [] : [`Task: ${result.task.id} (${result.task.status})`]),
        `Active: ${result.snapshot.activeCount}/${result.snapshot.maxConcurrency}`,
        lineList("Ready", result.snapshot.readyTaskIds),
        `Stop: ${result.snapshot.stopped?.reason ?? "none"}`,
      ].join("\n")}\n`;
    case "ledger":
      return `Forgeyard ledger: recorded\nEvent: ${result.eventId}\n`;
    case "guard":
      return `Forgeyard guard: allowed\nTask: ${result.taskId}\n${lineList("Paths", result.paths)}\n`;
  }
}

export function createProgram(dependencies: CliDependencies = defaultDependencies): Command {
  const program = new Command();
  const writeResult = (result: ForgeyardCommandResult, json: boolean): void => {
    program.configureOutput().writeOut?.(formatSuccess(result, json));
  };

  program
    .name("forgeyard")
    .description("Install and verify a project-scoped agentic development workflow.")
    .version(dependencies.version)
    .option("--debug", "include local diagnostic details");

  program
    .command("init")
    .argument("[target]", "project directory", ".")
    .option("--profile <profile>", "Forgeyard profile")
    .option("--adapter <adapter>", "target harness adapter")
    .option("--answers <file>", "non-interactive answer file")
    .option("--yes", "apply without an interactive confirmation")
    .option("--dry-run", "validate and show the plan without writing")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      const answersPath = stringOption(options, "answers");
      const profile = stringOption(options, "profile");
      const adapter = stringOption(options, "adapter");
      const json = booleanOption(options, "json");
      const result = await dependencies.service.init({
        targetRoot: target,
        ...(profile === undefined ? {} : { profile }),
        ...(adapter === undefined ? {} : { adapter }),
        ...(answersPath === undefined ? {} : { answersPath }),
        yes: booleanOption(options, "yes"),
        dryRun: booleanOption(options, "dryRun"),
        nonInteractive: !dependencies.interactive || json || answersPath !== undefined,
      });
      writeResult(result, json);
    });

  program
    .command("doctor")
    .argument("[target]", "project directory", ".")
    .option("--deny-term <value>", "reject a private term without persisting it", collect, [])
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.doctor({
        root: target,
        denyTerms: listOption(options, "denyTerm"),
      });
      writeResult(result, json);
    });

  program
    .command("verify")
    .argument("<task-id>", "installed task identifier")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.verify({
        root: stringOption(options, "root") ?? ".",
        taskId,
      });
      writeResult(result, json);
    });

  program
    .command("update")
    .argument("[target]", "project directory", ".")
    .option("--yes", "apply without an interactive confirmation")
    .option("--dry-run", "validate and show the plan without writing")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.update({
        root: target,
        yes: booleanOption(options, "yes"),
        dryRun: booleanOption(options, "dryRun"),
        nonInteractive: !dependencies.interactive || json,
      });
      writeResult(result, json);
    });

  program
    .command("rollback")
    .argument("<operation-id>", "operation to reverse")
    .option("--root <target>", "project directory", ".")
    .option("--yes", "apply without an interactive confirmation")
    .option("--json", "emit machine-readable output")
    .action(async (sourceOperationId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.rollback({
        root: stringOption(options, "root") ?? ".",
        sourceOperationId,
        yes: booleanOption(options, "yes"),
        nonInteractive: !dependencies.interactive || json,
      });
      writeResult(result, json);
    });

  const task = program.command("task").description("Inspect and transition the resumable task graph.");

  for (const action of ["status", "next"] as const) {
    task.command(action)
      .option("--root <target>", "project directory", ".")
      .option("--json", "emit machine-readable output")
      .action(async (options: Record<string, unknown>) => {
        const json = booleanOption(options, "json");
        const result = await dependencies.service.task({
          action,
          root: stringOption(options, "root") ?? ".",
        });
        writeResult(result, json);
      });
  }

  task.command("claim")
    .argument("<task-id>", "task identifier")
    .requiredOption("--worker <id>", "stable worker identifier")
    .option("--session <id>", "optional harness session identifier")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const sessionId = stringOption(options, "session");
      const result = await dependencies.service.task({
        action: "claim",
        root: stringOption(options, "root") ?? ".",
        taskId,
        workerId: stringOption(options, "worker")!,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      writeResult(result, json);
    });

  task.command("checkpoint")
    .argument("<task-id>", "task identifier")
    .requiredOption("--worker <id>", "stable worker identifier")
    .requiredOption("--note <text>", "short resumable checkpoint")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.task({
        action: "checkpoint",
        root: stringOption(options, "root") ?? ".",
        taskId,
        workerId: stringOption(options, "worker")!,
        note: stringOption(options, "note")!,
      });
      writeResult(result, json);
    });

  for (const action of ["resume", "cancel"] as const) {
    task.command(action)
      .argument("<task-id>", "task identifier")
      .requiredOption("--worker <id>", "stable worker identifier")
      .option("--root <target>", "project directory", ".")
      .option("--json", "emit machine-readable output")
      .action(async (taskId: string, options: Record<string, unknown>) => {
        const json = booleanOption(options, "json");
        const result = await dependencies.service.task({
          action,
          root: stringOption(options, "root") ?? ".",
          taskId,
          workerId: stringOption(options, "worker")!,
        });
        writeResult(result, json);
      });
  }

  task.command("complete")
    .argument("<task-id>", "task identifier")
    .requiredOption("--worker <id>", "stable worker identifier")
    .option("--receipt <id>", "current successful receipt identifier")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const receiptId = stringOption(options, "receipt");
      const result = await dependencies.service.task({
        action: "complete",
        root: stringOption(options, "root") ?? ".",
        taskId,
        workerId: stringOption(options, "worker")!,
        ...(receiptId === undefined ? {} : { receiptId }),
      });
      writeResult(result, json);
    });

  task.command("fail")
    .argument("<task-id>", "task identifier")
    .requiredOption("--worker <id>", "stable worker identifier")
    .requiredOption("--fingerprint <value>", "stable failure category or digest")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.task({
        action: "fail",
        root: stringOption(options, "root") ?? ".",
        taskId,
        workerId: stringOption(options, "worker")!,
        fingerprint: stringOption(options, "fingerprint")!,
      });
      writeResult(result, json);
    });

  const ledger = program.command("ledger").description("Record explicit local run accounting.");
  ledger.command("record")
    .requiredOption("--task <id>", "task identifier")
    .requiredOption("--provider <id>", "provider identifier")
    .requiredOption("--model <id>", "model identifier")
    .requiredOption("--input-tokens <count>", "observed input tokens")
    .requiredOption("--output-tokens <count>", "observed output tokens")
    .requiredOption("--cost-usd <value>", "observed cost in USD")
    .requiredOption("--duration-ms <count>", "observed duration in milliseconds")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.recordUsage({
        root: stringOption(options, "root") ?? ".",
        taskId: stringOption(options, "task")!,
        provider: stringOption(options, "provider")!,
        model: stringOption(options, "model")!,
        inputTokens: Number(stringOption(options, "inputTokens")),
        outputTokens: Number(stringOption(options, "outputTokens")),
        costUsd: Number(stringOption(options, "costUsd")),
        durationMs: Number(stringOption(options, "durationMs")),
      });
      writeResult(result, json);
    });

  program.command("guard")
    .argument("<task-id>", "active task identifier")
    .argument("<paths...>", "candidate project paths")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, paths: string[], options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const result = await dependencies.service.guard({
        root: stringOption(options, "root") ?? ".",
        taskId,
        paths,
      });
      writeResult(result, json);
    });

  return program;
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies = defaultDependencies,
  io: CliIo = {
    writeOut: (value) => process.stdout.write(value),
    writeErr: (value) => process.stderr.write(value),
    debug: false,
  },
): Promise<number> {
  const program = createProgram(dependencies);
  program.configureOutput({ writeOut: io.writeOut, writeErr: io.writeErr });
  program.exitOverride();

  try {
    await program.parseAsync([...arguments_], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;

    const json = arguments_.includes("--json");
    const debug = io.debug || arguments_.includes("--debug");
    const failure = formatFailure(error, json, debug);
    if (json) io.writeOut(failure.text);
    else io.writeErr(failure.text);
    return failure.exitCode;
  }
}
