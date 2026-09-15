import { Command, CommanderError } from "commander";

import { ForgeyardError, formatFailure } from "../core/errors.js";

export interface CliInvocation {
  positional: readonly string[];
  options: Readonly<Record<string, unknown>>;
}

export type CliHandler = (invocation: CliInvocation) => Promise<unknown>;

export interface CliDependencies {
  version: string;
  handlers: {
    init: CliHandler;
    doctor: CliHandler;
    verify: CliHandler;
    update: CliHandler;
    rollback: CliHandler;
  };
}

export interface CliIo {
  writeOut(value: string): void;
  writeErr(value: string): void;
  debug: boolean;
}

const notImplemented = async (): Promise<never> => {
  throw new ForgeyardError({
    code: "FY_INTERNAL",
    message: "This command is not wired yet.",
    remediation: "Complete the Forgeyard M1 implementation before invoking it.",
    exitCode: 1,
  });
};

export const defaultDependencies: CliDependencies = {
  version: "0.1.0",
  handlers: {
    init: notImplemented,
    doctor: notImplemented,
    verify: notImplemented,
    update: notImplemented,
    rollback: notImplemented,
  },
};

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createProgram(dependencies: CliDependencies = defaultDependencies): Command {
  const program = new Command();
  program
    .name("forgeyard")
    .description("Install and verify a project-scoped agentic development workflow.")
    .version(dependencies.version)
    .option("--debug", "include local diagnostic details");

  program
    .command("init")
    .argument("[target]", "project directory", ".")
    .requiredOption("--profile <profile>", "Forgeyard profile")
    .requiredOption("--adapter <adapter>", "target harness adapter")
    .option("--answers <file>", "non-interactive answer file")
    .option("--yes", "apply without an interactive confirmation")
    .option("--dry-run", "validate and show the plan without writing")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      await dependencies.handlers.init({ positional: [target], options });
    });

  program
    .command("doctor")
    .argument("[target]", "project directory", ".")
    .option("--deny-term <value>", "reject a private term without persisting it", collect, [])
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      await dependencies.handlers.doctor({ positional: [target], options });
    });

  program
    .command("verify")
    .argument("<task-id>", "installed task identifier")
    .option("--root <target>", "project directory", ".")
    .option("--json", "emit machine-readable output")
    .action(async (taskId: string, options: Record<string, unknown>) => {
      await dependencies.handlers.verify({ positional: [taskId], options });
    });

  program
    .command("update")
    .argument("[target]", "project directory", ".")
    .option("--yes", "apply without an interactive confirmation")
    .option("--dry-run", "validate and show the plan without writing")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      await dependencies.handlers.update({ positional: [target], options });
    });

  program
    .command("rollback")
    .argument("<operation-id>", "operation to reverse")
    .option("--root <target>", "project directory", ".")
    .option("--yes", "apply without an interactive confirmation")
    .option("--json", "emit machine-readable output")
    .action(async (operationId: string, options: Record<string, unknown>) => {
      await dependencies.handlers.rollback({ positional: [operationId], options });
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
