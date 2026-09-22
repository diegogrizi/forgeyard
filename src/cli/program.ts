import { Command, CommanderError } from "commander";

import {
  createForgeyardService,
  type ForgeyardCommandResult,
  type ForgeyardService,
} from "../application/forgeyard.js";
import { createInquirerPromptDriver } from "../config/wizard.js";
import { latestReversibleOperation } from "../installer/rollback.js";
import type { HarnessId } from "../core/contracts.js";
import { ForgeyardError, formatFailure } from "../core/errors.js";

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

function optionalBooleanOption(options: Record<string, unknown>, name: string): boolean | undefined {
  const value = options[name];
  return typeof value === "boolean" ? value : undefined;
}

function numberOption(options: Record<string, unknown>, name: string): number | undefined {
  const value = options[name];
  return typeof value === "number" ? value : undefined;
}

function numericOption(label: string, minimum: number, maximum: number, integer: boolean) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < minimum || parsed > maximum) {
      throw new ForgeyardError({
        code: "FY_CONFIG_INVALID",
        message: `${label} must be ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}.`,
        remediation: "Provide a bounded numeric project constraint.",
        exitCode: 2,
      });
    }
    return parsed;
  };
}

function autonomyOption(value: string): "supervised" | "balanced" | "autonomous" {
  if (value === "supervised" || value === "balanced" || value === "autonomous") return value;
  throw new ForgeyardError({
    code: "FY_CONFIG_INVALID",
    message: "Autonomy must be supervised, balanced, or autonomous.",
    remediation: "Choose one of the documented autonomy levels.",
    exitCode: 2,
  });
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
    case "inspect":
      return `${[
        "Forgeyard inspect: complete (read-only)",
        `Project: ${result.inspection.name} (${result.inspection.kind})`,
        lineList("Frameworks", result.inspection.frameworks),
        `Adapter: ${result.decision.adapter} — ${result.decision.adapterReason}`,
        lineList("Selected capabilities", result.decision.catalog.plugins),
        lineList("Excluded capabilities", result.decision.excluded.map((choice) => choice.id)),
        lineList("Open questions", result.inspection.questions),
      ].join("\n")}\n`;
    case "prepare":
      return `${[
        `Forgeyard prepare: ${result.status}`,
        `Project: ${result.inspection.name} (${result.inspection.kind})`,
        lineList("Frameworks", result.inspection.frameworks),
        `Adapter: ${result.decision.adapter} — ${result.decision.adapterReason}`,
        lineList("Selected capabilities", result.decision.catalog.plugins),
        lineList("Excluded capabilities", result.decision.excluded.map((choice) => choice.id)),
        lineList("Open questions", result.inspection.questions),
        `Operation: ${result.operationId}`,
        lineList("Created", result.changes.created),
        lineList("Preserved", result.changes.preserved),
        result.doctor === null
          ? "Doctor: not run"
          : `Doctor: passed (${result.doctor.passed} passed, ${result.doctor.skipped} skipped, ${result.doctor.unavailable} unavailable)`,
      ].join("\n")}\n`;
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
    .description("Prepara e verifica un ambiente di sviluppo agentico specifico del progetto.")
    .version(dependencies.version)
    .option("--debug", "mostra dettagli diagnostici locali");
  program.addHelpText("after", `
L'ingresso ordinario è 'forgeyard' senza argomenti: riconosce la cartella, chiede una
sola conferma e prepara tutto. I comandi qui sopra sono operazioni avanzate,
non passi del percorso normale.

Comandi del runtime nativo:
  connect/disconnect --root <project> --client codex|claude-code
  mcp --root <project> [--client codex|claude-code] (stdio)
  tool --root <project> --json (strict protocol 0.2 JSON stdin)
  consent/human-review/reconcile --root <project> --run <id> --session <id>
  reconcile-install --root <project>
  reconcile-writer --root <project> --session <id>
  reconcile-operation --root <project> --operation <id>

Le conferme umane native non hanno --yes.
`);

  program
    .command("inspect")
    .description("Ispeziona un problema software e propone una fabbrica su misura, senza scrivere.")
    .argument("[target]", "project directory", ".")
    .option("--brief <text>", "software outcome or requested change")
    .option("--spec <path>", "project-relative specification file", collect, [])
    .option("--adapter <adapter>", "explicit supported host constraint")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      const brief = stringOption(options, "brief");
      const adapter = stringOption(options, "adapter") as HarnessId | undefined;
      const json = booleanOption(options, "json");
      const result = await dependencies.service.inspect({
        targetRoot: target,
        ...(brief === undefined ? {} : { brief }),
        specificationPaths: listOption(options, "spec"),
        ...(adapter === undefined ? {} : { adapter }),
      });
      writeResult(result, json);
    });

  program
    .command("prepare")
    .description("Prepara una fabbrica stabile a partire dal problema software.")
    .argument("[target]", "project directory", ".")
    .option("--brief <text>", "software outcome or requested change")
    .option("--spec <path>", "project-relative specification file", collect, [])
    .option("--adapter <adapter>", "explicit supported host constraint")
    .option("--timebox <minutes>", "delivery timebox", numericOption("Timebox", 30, 1440, true))
    .option("--max-concurrency <count>", "maximum active work items", numericOption("Maximum concurrency", 1, 16, true))
    .option("--budget-usd <amount>", "maximum recorded model cost", numericOption("Budget", 0.01, 1_000_000, false))
    .option("--autonomy <level>", "supervised, balanced, or autonomous", autonomyOption)
    .option("--presentation", "include an offline presentation workflow")
    .option("--no-presentation", "exclude presentation work")
    .option("--yes", "apply without an interactive confirmation")
    .option("--dry-run", "validate and show the plan without writing")
    .option("--json", "emit machine-readable output")
    .action(async (target: string, options: Record<string, unknown>) => {
      const brief = stringOption(options, "brief");
      const adapter = stringOption(options, "adapter") as HarnessId | undefined;
      const timeboxMinutes = numberOption(options, "timebox");
      const maxConcurrency = numberOption(options, "maxConcurrency");
      const maxCostUsd = numberOption(options, "budgetUsd");
      const autonomy = stringOption(options, "autonomy") as "supervised" | "balanced" | "autonomous" | undefined;
      const presentation = optionalBooleanOption(options, "presentation");
      const json = booleanOption(options, "json");
      const result = await dependencies.service.prepare({
        targetRoot: target,
        ...(brief === undefined ? {} : { brief }),
        specificationPaths: listOption(options, "spec"),
        ...(adapter === undefined ? {} : { adapter }),
        ...(timeboxMinutes === undefined ? {} : { timeboxMinutes }),
        ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
        ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
        ...(autonomy === undefined ? {} : { autonomy }),
        ...(presentation === undefined ? {} : { presentation }),
        yes: booleanOption(options, "yes"),
        dryRun: booleanOption(options, "dryRun"),
        nonInteractive: !dependencies.interactive || json,
      });
      writeResult(result, json);
    });

  program
    .command("init")
    .description("Installa un profilo di catalogo fisso. Non è il punto di partenza consigliato.")
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
    .description("Controlla struttura, proprietà dei file e deriva dell'imbracatura installata.")
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
    .description("Esegue il comando di un'attività e scrive una ricevuta legata alla revisione Git.")
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
    .description("Anteprima o applicazione di un aggiornamento dalla configurazione posseduta.")
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
    .description("Annulla un'operazione applicata; senza argomento, l'ultima reversibile.")
    .argument("[operation-id]", "operazione da annullare; senza argomento, l'ultima reversibile")
    .option("--root <target>", "project directory", ".")
    .option("--yes", "apply without an interactive confirmation")
    .option("--json", "emit machine-readable output")
    .action(async (requestedOperationId: string | undefined, options: Record<string, unknown>) => {
      const json = booleanOption(options, "json");
      const root = stringOption(options, "root") ?? ".";
      // Only the latest operation is reversible at all, so asking a person to find its
      // identifier adds a lookup without adding a choice.
      const sourceOperationId = requestedOperationId ?? await latestReversibleOperation(root);
      if (sourceOperationId === null) {
        throw new ForgeyardError({
          code: "FY_OPERATION_UNKNOWN",
          message: "Questa cartella non ha operazioni Forgeyard da annullare.",
          remediation: "Esegui forgeyard in questa cartella per prepararla.",
          exitCode: 2,
        });
      }
      const result = await dependencies.service.rollback({
        root,
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
