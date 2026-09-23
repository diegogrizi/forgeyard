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
import { renderCodexCatalog } from "./codex-catalog.js";
import {
  compositionVariables,
  continuityVariables,
  instructionTarget,
  projectContextVariables,
  taskContractVariables,
} from "./factory-context.js";
import { renderComponent } from "./render.js";
import {
  escapeHtmlText,
  escapeMarkdownInline,
  quoteTomlMultiline,
  quoteYamlString,
} from "./strict-template.js";

const CORE_SLOT_ORDER = [
  "project.instructions",
  "workflow.primary",
  "review.readonly",
  "task.initial",
  "guard.file-tools",
  "composition.report",
] as const;

const DELIVERY_SLOT_ORDER = [
  "project.brief",
  "task.implementation",
  "task.review",
  "memory.knowledge",
  "memory.decision-template",
  "memory.handoff",
  "report.run",
  "observability.usage",
] as const;

const SLOT_ORDER = [...CORE_SLOT_ORDER, ...DELIVERY_SLOT_ORDER] as const;

type CodexSlot = (typeof SLOT_ORDER)[number];

const FOUNDATION_TARGET_BY_SLOT: Readonly<Record<(typeof SLOT_ORDER)[number], string | undefined>> = {
  "project.instructions": "AGENTS.md",
  "workflow.primary": ".agents/skills/forgeyard-workflow/SKILL.md",
  "review.readonly": ".codex/agents/reviewer.toml",
  "task.initial": ".forgeyard/tasks/T001.yaml",
  "guard.file-tools": ".forgeyard/bin/write-guard.mjs",
  "composition.report": ".forgeyard/COMPOSITION.md",
  "project.brief": "PROJECT.md",
  "task.implementation": ".forgeyard/tasks/T002.yaml",
  "task.review": ".forgeyard/tasks/T003.yaml",
  "memory.knowledge": ".forgeyard/knowledge/README.md",
  "memory.decision-template": ".forgeyard/decisions/0000-template.md",
  "memory.handoff": ".forgeyard/handoffs/CURRENT.md",
  "report.run": ".forgeyard/reports/RUN_REPORT.md",
  "observability.usage": ".forgeyard/usage/README.md",
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

function allocatedMinutes(config: ForgeyardConfig, fraction: number): string {
  return String(Math.max(1, Math.floor(config.timeboxMinutes * fraction)));
}

function deliverySlots(bySlot: ReadonlyMap<string, ResolvedComponent>): readonly CodexSlot[] {
  const selected = DELIVERY_SLOT_ORDER.filter((slot) => bySlot.has(slot));
  if (selected.length !== 0 && selected.length !== DELIVERY_SLOT_ORDER.length) {
    throw adapterError("Codex delivery components must be installed as one complete workflow.");
  }
  return selected;
}

function targetForSlot(slot: CodexSlot, config: ForgeyardConfig): string {
  if (slot === "project.instructions") return instructionTarget(config, "AGENTS.md");
  const foundation = FOUNDATION_TARGET_BY_SLOT[slot];
  if (foundation !== undefined) return foundation;
  throw adapterError(`Codex has no target for component slot '${slot}'.`);
}

function htmlQualitySummary(config: ForgeyardConfig): string {
  return escapeHtmlText(
    config.quality.commands
      .map((command) => `${command.name}: ${JSON.stringify(command.argv)}`)
      .join("; "),
  );
}

function variablesFor(slot: string, config: ForgeyardConfig, slots: ReadonlySet<string>): Readonly<Record<string, string>> {
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
        ...continuityVariables(slots),
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
        ...taskContractVariables(config, "task.initial"),
        "task.command": yamlSequence(config.quality.commands[0]!.argv),
        "task.writeScopes": yamlSequence(config.paths.mutableRoots),
        "task.initialMinutes": config.profile === "minimal" ? String(config.timeboxMinutes) : allocatedMinutes(config, 0.3),
      };
    case "project.brief":
      return {
        "project.name": escapeMarkdownInline(config.project.name),
        "project.purpose": escapeMarkdownInline(config.project.purpose),
        "project.mode": escapeMarkdownInline(config.project.mode),
        ...projectContextVariables(config),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
        "paths.mutable": config.paths.mutableRoots.map(escapeMarkdownInline).join(", "),
        "paths.protected": config.paths.protectedPaths.map(escapeMarkdownInline).join(", "),
        "workflow.maxConcurrency": String(config.orchestration.maxConcurrency),
        "quality.commands": qualityMarkdown(config),
      };
    case "composition.report":
      return compositionVariables(config);
    case "task.implementation":
      return {
        ...taskContractVariables(config, "task.implementation"),
        "task.command": yamlSequence(config.quality.commands[0]!.argv),
        "task.writeScopes": yamlSequence(config.paths.mutableRoots),
        "task.implementationMinutes": allocatedMinutes(config, 0.45),
      };
    case "task.review":
      return {
        ...taskContractVariables(config, "task.review"),
        "task.command": yamlSequence(config.quality.commands[0]!.argv),
        "task.reviewMinutes": allocatedMinutes(config, 0.1),
      };
    case "memory.handoff":
      return { "project.name": escapeMarkdownInline(config.project.name) };
    case "report.run":
      return {
        "project.name": escapeMarkdownInline(config.project.name),
        "quality.commands": qualityMarkdown(config),
      };
    case "guard.file-tools":
    case "memory.knowledge":
    case "memory.decision-template":
    case "observability.usage":
      return {};
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

function validateSkill(content: string, filePath: string, expectedName: string): void {
  const metadata = frontmatter(content);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    (metadata as Record<string, unknown>).name !== expectedName ||
    typeof (metadata as Record<string, unknown>).description !== "string"
  ) {
    throw adapterError("Generated project skill has invalid metadata.", [filePath]);
  }
}

function validateReviewer(content: string, filePath: string): void {
  const parsed = parseToml(content);
  if (parsed.name !== "reviewer" || parsed.sandbox_mode !== "read-only" || typeof parsed.developer_instructions !== "string") {
    throw adapterError("Generated reviewer agent has invalid TOML fields.", [filePath]);
  }
}

function validateTask(content: string, filePath: string, expectedId: string): void {
  const parsed = parseYaml(content) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || parsed.id !== expectedId || parsed.required !== true || !Array.isArray(parsed.command)) {
    throw adapterError("Generated task has invalid YAML fields.", [filePath]);
  }
}

function assertUniquePaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw adapterError("Codex output contains duplicate target paths.", [file.path]);
    seen.add(key);
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
      dagScheduling: "emulated",
      projectWriteGuard: "advisory",
    },
    validateConfig(config) {
      if (
        !["minimal", "hackathon", "tailored"].includes(config.profile) ||
        config.harnesses.length !== 1 ||
        config.harnesses[0] !== "codex"
      ) {
        throw adapterError("Codex adapter received an unsupported configuration.");
      }
    },
    async render(components: readonly ResolvedComponent[], config: ForgeyardConfig): Promise<readonly PlannedFile[]> {
      this.validateConfig(config);
      const catalogComponents = components.filter((component) => component.kind === "catalog");
      if (catalogComponents.length > 1) {
        throw adapterError("Codex currently supports one portable catalog component per profile.");
      }
      const foundationComponents = components.filter((component) => component.kind !== "catalog");
      const bySlot = new Map(foundationComponents.map((component) => [component.slot, component]));
      const requiredSlots: readonly CodexSlot[] = [
        ...CORE_SLOT_ORDER,
        ...deliverySlots(bySlot),
      ];
      for (const component of components) {
        if (component.kind === "catalog") {
          if (
            component.slot !== "catalog.portable.primary" ||
            component.entryType !== "tree" ||
            component.format !== "portable-plugin-marketplace-v1"
          ) {
            throw adapterError(`Codex cannot transform catalog component '${component.id}'.`);
          }
          continue;
        }
        if (!SLOT_ORDER.includes(component.slot as CodexSlot)) {
          throw adapterError(`Codex has no target for component slot '${component.slot}'.`);
        }
      }

      const renderedSlots = new Set<string>(requiredSlots);
      const files: PlannedFile[] = [];
      for (const slot of requiredSlots) {
        const component = bySlot.get(slot);
        if (component === undefined) throw adapterError(`Required Codex component slot '${slot}' is missing.`);
        const target = targetForSlot(slot, config);
        files.push(await renderComponent(component, target, variablesFor(slot, config, renderedSlots)));
      }
      for (const catalog of catalogComponents) {
        files.push(...await renderCodexCatalog(catalog, catalog.catalogSelection ?? "all"));
      }
      assertUniquePaths(files);
      return files;
    },
    async validateOutput(files: readonly PlannedFile[]): Promise<void> {
      assertUniquePaths(files);
      const byPath = new Map(files.map((file) => [file.path, file.content]));
      const projectInstructions = files.find((file) => file.componentId === "foundation.project-instructions");
      if (projectInstructions === undefined) throw adapterError("Required Codex project instructions are missing.");
      const required = [
        projectInstructions.path,
        ".agents/skills/forgeyard-workflow/SKILL.md",
        ".codex/agents/reviewer.toml",
        ".forgeyard/tasks/T001.yaml",
        ".forgeyard/bin/write-guard.mjs",
        ".forgeyard/COMPOSITION.md",
      ];
      if (byPath.has("PROJECT.md")) {
        required.push(
          "PROJECT.md",
          ".forgeyard/tasks/T002.yaml",
          ".forgeyard/tasks/T003.yaml",
          ".forgeyard/knowledge/README.md",
          ".forgeyard/decisions/0000-template.md",
          ".forgeyard/handoffs/CURRENT.md",
          ".forgeyard/reports/RUN_REPORT.md",
          ".forgeyard/usage/README.md",
        );
      }
      for (const filePath of required) {
        if (!byPath.has(filePath)) throw adapterError(`Required Codex output '${filePath}' is missing.`, [filePath]);
      }
      const authoredOutput = files.filter((file) => !file.componentId.startsWith("ecosystem."));
      if (/\{\{[^}]*\}\}/.test(authoredOutput.map((file) => file.content).join("\n"))) {
        throw adapterError("Generated Codex output contains an unresolved template expression.");
      }
      validateSkill(byPath.get(".agents/skills/forgeyard-workflow/SKILL.md")!, ".agents/skills/forgeyard-workflow/SKILL.md", "forgeyard-workflow");
      validateReviewer(byPath.get(".codex/agents/reviewer.toml")!, ".codex/agents/reviewer.toml");
      for (const id of ["T001", "T002", "T003"]) {
        const filePath = `.forgeyard/tasks/${id}.yaml`;
        if (byPath.has(filePath)) validateTask(byPath.get(filePath)!, filePath, id);
      }
      for (const file of files.filter(
        (candidate) =>
          candidate.componentId.startsWith("ecosystem.") &&
          candidate.componentId.includes(".agent.") &&
          candidate.path.endsWith(".toml"),
      )) {
        const parsed = parseToml(file.content);
        if (
          typeof parsed.name !== "string" ||
          typeof parsed.description !== "string" ||
          !["read-only", "workspace-write"].includes(String(parsed.sandbox_mode)) ||
          typeof parsed.developer_instructions !== "string"
        ) {
          throw adapterError("Generated catalog agent has invalid TOML fields.", [file.path]);
        }
      }
      for (const file of files.filter(
        (candidate) => candidate.componentId.startsWith("ecosystem.") && candidate.path.endsWith("/SKILL.md"),
      )) {
        const metadata = frontmatter(file.content);
        if (
          typeof metadata !== "object" ||
          metadata === null ||
          typeof (metadata as Record<string, unknown>).name !== "string" ||
          typeof (metadata as Record<string, unknown>).description !== "string" ||
          Buffer.byteLength(file.content, "utf8") > 8_192
        ) {
          throw adapterError("Generated catalog skill is invalid or exceeds the 8 KB limit.", [file.path]);
        }
      }
      if (projectInstructions.content.trim().length === 0) {
        throw adapterError("Generated Codex project instructions are empty.", [projectInstructions.path]);
      }
    },
  };
}
