import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import type {
  ForgeyardConfig,
  HarnessAdapter,
  PlannedFile,
  ResolvedComponent,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";
import { renderComponent } from "./render.js";
import {
  escapeMarkdownInline,
  quoteTomlMultiline,
  quoteYamlString,
} from "./strict-template.js";

const SLOT_ORDER = [
  "project.instructions",
  "workflow.primary",
  "review.readonly",
  "task.initial",
] as const;

const TARGET_BY_SLOT: Readonly<Record<(typeof SLOT_ORDER)[number], string>> = {
  "project.instructions": "AGENTS.md",
  "workflow.primary": ".agents/skills/forgeyard-workflow/SKILL.md",
  "review.readonly": ".codex/agents/reviewer.toml",
  "task.initial": ".forgeyard/tasks/T001.yaml",
};

function adapterError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the Codex adapter mapping or rendered component structure.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
  });
}

function qualityMarkdown(config: ForgeyardConfig): string {
  return config.quality.commands
    .map((command) => `- ${escapeMarkdownInline(command.name)}: ${JSON.stringify(command.argv)}`)
    .join("\n");
}

function yamlSequence(values: readonly string[]): string {
  return values.map((value) => `  - ${quoteYamlString(value)}`).join("\n");
}

function variablesFor(slot: string, config: ForgeyardConfig): Readonly<Record<string, string>> {
  switch (slot) {
    case "project.instructions":
      return {
        "project.name": escapeMarkdownInline(config.project.name),
        "project.purpose": escapeMarkdownInline(config.project.purpose),
        "project.mode": escapeMarkdownInline(config.project.mode),
        "paths.mutable": config.paths.mutableRoots.map(escapeMarkdownInline).join(", "),
        "paths.protected": config.paths.protectedPaths.map(escapeMarkdownInline).join(", "),
        "quality.commands": qualityMarkdown(config),
        "workflow.maxConcurrency": String(config.orchestration.maxConcurrency),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
        "presentation.path": escapeMarkdownInline(config.paths.presentation),
      };
    case "workflow.primary":
      return {
        "project.name": escapeMarkdownInline(config.project.name),
        "project.purpose": escapeMarkdownInline(config.project.purpose),
        "quality.commands": qualityMarkdown(config),
        "workflow.maxConcurrency": String(config.orchestration.maxConcurrency),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
      };
    case "review.readonly":
      return {
        "reviewer.instructions": quoteTomlMultiline(
          `Review ${config.project.name} against the named task and frozen Git revision. ` +
            "Remain read-only. Report concrete findings before the summary. Do not edit files, " +
            "and do not describe review of changes you created as independent review.",
        ),
      };
    case "task.initial":
      return {
        "task.command": yamlSequence(config.quality.commands[0]!.argv),
      };
    default:
      throw adapterError(`Codex has no mapping for logical slot '${slot}'.`);
  }
}

function frontmatter(content: string): unknown {
  if (!content.startsWith("---\n")) throw adapterError("Generated skill is missing YAML frontmatter.");
  const closing = content.indexOf("\n---\n", 4);
  if (closing < 0) throw adapterError("Generated skill frontmatter is not closed.");
  return parseYaml(content.slice(4, closing));
}

function validateSkill(content: string, filePath: string): void {
  const metadata = frontmatter(content);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    (metadata as Record<string, unknown>).name !== "forgeyard-workflow" ||
    typeof (metadata as Record<string, unknown>).description !== "string"
  ) {
    throw adapterError("Generated workflow skill has invalid metadata.", [filePath]);
  }
}

function validateReviewer(content: string, filePath: string): void {
  const parsed = parseToml(content);
  if (parsed.name !== "reviewer" || parsed.sandbox_mode !== "read-only" || typeof parsed.developer_instructions !== "string") {
    throw adapterError("Generated reviewer agent has invalid TOML fields.", [filePath]);
  }
}

function validateTask(content: string, filePath: string): void {
  const parsed = parseYaml(content) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || parsed.id !== "T001" || parsed.required !== true || !Array.isArray(parsed.command)) {
    throw adapterError("Generated initial task has invalid YAML fields.", [filePath]);
  }
}

export function createCodexAdapter(): HarnessAdapter {
  return {
    id: "codex",
    capabilities: {
      projectInstructions: "native",
      projectSkills: "native",
      reviewerAgents: "native",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    },
    validateConfig(config) {
      if (config.profile !== "hackathon" || config.harnesses.length !== 1 || config.harnesses[0] !== "codex") {
        throw adapterError("Codex adapter received unsupported M1 configuration.");
      }
    },
    async render(components: readonly ResolvedComponent[], config: ForgeyardConfig): Promise<readonly PlannedFile[]> {
      this.validateConfig(config);
      const bySlot = new Map(components.map((component) => [component.slot, component]));
      for (const component of components) {
        if (!Object.hasOwn(TARGET_BY_SLOT, component.slot)) {
          throw adapterError(`Codex has no target for component slot '${component.slot}'.`);
        }
      }

      const files: PlannedFile[] = [];
      for (const slot of SLOT_ORDER) {
        const component = bySlot.get(slot);
        if (component === undefined) throw adapterError(`Required Codex component slot '${slot}' is missing.`);
        const target = normalizePortablePath(TARGET_BY_SLOT[slot]);
        files.push(await renderComponent(component, target, variablesFor(slot, config)));
      }
      assertNoCaseCollisions(files.map((file) => file.path));
      return files;
    },
    async validateOutput(files: readonly PlannedFile[]): Promise<void> {
      assertNoCaseCollisions(files.map((file) => file.path));
      const byPath = new Map(files.map((file) => [file.path, file.content]));
      const required = Object.values(TARGET_BY_SLOT);
      for (const filePath of required) {
        if (!byPath.has(filePath)) throw adapterError(`Required Codex output '${filePath}' is missing.`, [filePath]);
      }
      if (/\{\{[^}]*\}\}/.test(files.map((file) => file.content).join("\n"))) {
        throw adapterError("Generated Codex output contains an unresolved template expression.");
      }
      validateSkill(byPath.get(".agents/skills/forgeyard-workflow/SKILL.md")!, ".agents/skills/forgeyard-workflow/SKILL.md");
      validateReviewer(byPath.get(".codex/agents/reviewer.toml")!, ".codex/agents/reviewer.toml");
      validateTask(byPath.get(".forgeyard/tasks/T001.yaml")!, ".forgeyard/tasks/T001.yaml");
      if (byPath.get("AGENTS.md")!.trim().length === 0) throw adapterError("Generated AGENTS.md is empty.", ["AGENTS.md"]);
    },
  };
}
