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
