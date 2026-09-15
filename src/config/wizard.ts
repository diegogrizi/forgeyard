import path from "node:path";

import {
  confirm as promptConfirm,
  input as promptInput,
  number as promptNumber,
  select as promptSelect,
} from "@inquirer/prompts";

import {
  HARNESS_IDS,
  type ForgeyardConfig,
  type HarnessId,
  type InitRequest,
  type NonEmptyArgv,
  type ProfileId,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { loadConfig, validateConfig } from "./config.js";

export interface PromptDriver {
  input(id: string, message: string, defaultValue?: string): Promise<string>;
  select(id: string, message: string, choices: readonly string[], defaultValue?: string): Promise<string>;
  number(id: string, message: string, defaultValue?: number): Promise<number>;
  confirm(id: string, message: string, defaultValue?: boolean): Promise<boolean>;
}

export interface WizardInput {
  targetRoot: string;
  nonInteractive: boolean;
  answersPath?: string;
  profile?: string;
  adapter?: string;
}

export function createInquirerPromptDriver(): PromptDriver {
  return {
    input: async (_id, message, defaultValue) => promptInput({
      message,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    }),
    select: async (_id, message, choices, defaultValue) => promptSelect({
      message,
      choices: choices.map((value) => ({ name: value, value })),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    }),
    number: async (_id, message, defaultValue) => {
      const value = await promptNumber({
        message,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        required: true,
      });
      if (value === undefined) throw invalid("A numeric wizard answer is required.");
      return value;
    },
    confirm: async (_id, message, defaultValue) => promptConfirm({
      message,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    }),
  };
}

function invalid(message: string, cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CONFIG_INVALID",
    message,
    remediation: "Provide a complete answer file or run the interactive wizard.",
    exitCode: 2,
    ...(cause === undefined ? {} : { cause }),
  });
}

function unsupported(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message,
    remediation: "Use profile 'minimal', 'hackathon', or 'full' with adapter 'codex', 'claude-code', or 'cursor'.",
    exitCode: 2,
  });
}

function parseStringArray(value: string, field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === "string")) {
      throw new TypeError("expected a non-empty string array");
    }
    return parsed;
  } catch (error) {
    throw invalid(`${field} must be a JSON array of strings.`, error);
  }
}

function assertSupportedSelection(profile: string | undefined, adapter: string | undefined): void {
  if (profile !== undefined && !["minimal", "hackathon", "full"].includes(profile)) {
    throw unsupported(`Profile '${profile}' is not supported by Forgeyard.`);
  }
  if (adapter !== undefined && !HARNESS_IDS.includes(adapter as HarnessId)) {
    throw unsupported(`Adapter '${adapter}' is not supported by Forgeyard.`);
  }
}

export async function collectInitRequest(
  input: WizardInput,
  prompts: PromptDriver,
): Promise<InitRequest> {
  assertSupportedSelection(input.profile, input.adapter);
  const targetRoot = path.resolve(input.targetRoot);

  if (input.answersPath !== undefined) {
    const config = await loadConfig(path.resolve(input.answersPath));
    if (input.profile !== undefined && config.profile !== input.profile) {
      throw unsupported("The CLI profile does not match the answer file.");
    }
    if (input.adapter !== undefined && !config.harnesses.includes(input.adapter as HarnessId)) {
      throw unsupported("The CLI adapter does not match the answer file.");
    }
    return { targetRoot, config };
  }

  if (input.nonInteractive) {
    throw invalid("Non-interactive initialization requires --answers.");
  }

  const profile = input.profile ?? (await prompts.select(
    "profile",
    "Profile",
    ["minimal", "hackathon", "full"],
    "hackathon",
  ));
  const adapter = input.adapter ?? (await prompts.select("adapter", "Adapter", HARNESS_IDS, "codex"));
  assertSupportedSelection(profile, adapter);
  const profileId = profile as ProfileId;

  const commandArgv = parseStringArray(
    await prompts.input("qualityCommandArgv", "Quality command as a JSON argv array", '["npm","test"]'),
    "Quality command",
  ) as unknown as NonEmptyArgv;

  const config: ForgeyardConfig = {
    schemaVersion: 1,
    project: {
      name: await prompts.input("project.name", "Project name"),
      purpose: await prompts.input("project.purpose", "Short project purpose"),
      mode: (await prompts.select("project.mode", "Adoption mode", ["new", "existing"], "new")) as
        | "new"
        | "existing",
    },
    harnesses: [adapter as HarnessId],
    profile: profileId,
    catalog: profileId === "minimal"
      ? { selection: "none", plugins: [] }
      : profileId === "full"
        ? { selection: "all", plugins: [] }
        : { selection: "curated", plugins: [] },
    timeboxMinutes: await prompts.number("timeboxMinutes", "Timebox in minutes", 300),
    quality: {
      commands: [
        {
          name: await prompts.input("qualityCommandName", "Quality command name", "test"),
          argv: commandArgv,
        },
      ],
    },
    paths: {
      mutableRoots: parseStringArray(
        await prompts.input("mutableRoots", "Mutable roots as a JSON string array", '["src","presentation"]'),
        "Mutable roots",
      ),
      protectedPaths: parseStringArray(
        await prompts.input("protectedPaths", "Protected paths as a JSON string array", '[".git",".env"]'),
        "Protected paths",
      ),
      presentation: await prompts.input("presentationPath", "Presentation output path", "presentation"),
    },
    orchestration: {
      mode: (await prompts.select(
        "orchestrationMode",
        "Orchestration mode",
        ["guided", "native"],
        "guided",
      )) as "guided" | "native",
      maxConcurrency: await prompts.number("maxConcurrency", "Maximum active work items", 4),
    },
    presentation: {
      enabled: profileId !== "minimal",
      audience: await prompts.input("presentationAudience", "Presentation audience"),
      durationMinutes: await prompts.number(
        "presentationDurationMinutes",
        "Presentation duration in minutes",
        7,
      ),
      offline: (await prompts.confirm(
        "presentationOffline",
        "Keep the presentation fully offline",
        true,
      )) as true,
    },
  };

  return { targetRoot, config: validateConfig(config) };
}
