import { parse as parseToml } from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  ForgeyardConfig,
  HarnessAdapter,
  PlannedFile,
  ResolvedComponent,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";
import { renderClaudeCodeCatalog } from "./claude-code-catalog.js";
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
type ClaudeSlot = (typeof SLOT_ORDER)[number];

function adapterError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the Claude Code adapter mapping or rendered component structure.",
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

function deliverySlots(bySlot: ReadonlyMap<string, ResolvedComponent>): readonly ClaudeSlot[] {
  const selected = DELIVERY_SLOT_ORDER.filter((slot) => bySlot.has(slot));
  if (selected.length !== 0 && selected.length !== DELIVERY_SLOT_ORDER.length) {
    throw adapterError("Claude Code delivery components must be installed as one complete workflow.");
  }
  return selected;
}


function targetForSlot(slot: ClaudeSlot, config: ForgeyardConfig): string {
  switch (slot) {
    case "project.instructions":
      return instructionTarget(config, "CLAUDE.md");
    case "workflow.primary":
      return ".claude/skills/forgeyard-workflow/SKILL.md";
    case "review.readonly":
      return ".claude/agents/forgeyard-reviewer.md";
    case "task.initial":
      return ".forgeyard/tasks/T001.yaml";
    case "guard.file-tools":
      return ".forgeyard/bin/write-guard.mjs";
    case "composition.report":
      return ".forgeyard/COMPOSITION.md";
    case "project.brief":
      return "PROJECT.md";
    case "task.implementation":
      return ".forgeyard/tasks/T002.yaml";
    case "task.review":
      return ".forgeyard/tasks/T003.yaml";
    case "memory.knowledge":
      return ".forgeyard/knowledge/README.md";
    case "memory.decision-template":
      return ".forgeyard/decisions/0000-template.md";
    case "memory.handoff":
      return ".forgeyard/handoffs/CURRENT.md";
    case "report.run":
      return ".forgeyard/reports/RUN_REPORT.md";
    case "observability.usage":
      return ".forgeyard/usage/README.md";
  }
}


function variablesFor(slot: ClaudeSlot, config: ForgeyardConfig, slots: ReadonlySet<string>): Readonly<Record<string, string>> {
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
  }
}

function withContent(file: PlannedFile, content: string, componentId = file.componentId): PlannedFile {
  return { ...file, content, sha256: sha256Text(content), componentId };
}

function frontmatter(content: string, filePath: string): Record<string, unknown> {
  if (!content.startsWith("---\n")) throw adapterError("Generated Markdown is missing YAML frontmatter.", [filePath]);
  const closing = content.indexOf("\n---\n", 4);
  if (closing < 0) throw adapterError("Generated Markdown frontmatter is not closed.", [filePath]);
  const parsed = parseYaml(content.slice(4, closing));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw adapterError("Generated Markdown frontmatter is not a mapping.", [filePath]);
  }
  return parsed as Record<string, unknown>;
}

function reviewerMarkdown(renderedToml: string): string {
  const parsed = parseToml(renderedToml);
  if (typeof parsed.developer_instructions !== "string") {
    throw adapterError("Canonical reviewer template did not produce reviewer instructions.");
  }
  return `---\n${stringifyYaml({
    name: "forgeyard-reviewer",
    description: "Read-only reviewer for a named task and frozen revision.",
    model: "inherit",
    tools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Write", "Edit", "Bash", "NotebookEdit"],
  }, { lineWidth: 0 }).trimEnd()}\n---\n\n${parsed.developer_instructions.trim()}\n`;
}

function assertUniquePaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw adapterError("Claude Code output contains duplicate target paths.", [file.path]);
    seen.add(key);
  }
}

function validateTask(content: string, filePath: string, expectedId: string): void {
  const parsed = parseYaml(content) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || parsed.id !== expectedId || parsed.required !== true || !Array.isArray(parsed.command)) {
    throw adapterError("Generated task has invalid YAML fields.", [filePath]);
  }
}

export function createClaudeCodeAdapter(): HarnessAdapter {
  return {
    id: "claude-code",
    capabilities: {
      projectInstructions: "native",
      projectSkills: "native",
      reviewerAgents: "native",
      importedHooks: "unsupported",
      projectWriteGuard: "native",
      skillShellExpansion: "unsupported",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "emulated",
    },
    validateConfig(config) {
      if (
        !["minimal", "hackathon", "tailored"].includes(config.profile) ||
        config.harnesses.length !== 1 ||
        config.harnesses[0] !== "claude-code"
      ) throw adapterError("Claude Code adapter received an unsupported configuration.");
    },
    async render(components: readonly ResolvedComponent[], config: ForgeyardConfig): Promise<readonly PlannedFile[]> {
      this.validateConfig(config);
      const catalogComponents = components.filter((component) => component.kind === "catalog");
      if (catalogComponents.length > 1) throw adapterError("Claude Code supports one portable catalog per profile.");
      const bySlot = new Map(components.filter((component) => component.kind !== "catalog").map((component) => [component.slot, component]));
      const requiredSlots: readonly ClaudeSlot[] = [
        ...CORE_SLOT_ORDER,
        ...deliverySlots(bySlot),
      ];
      for (const component of components) {
        if (component.kind === "catalog") {
          if (
            component.slot !== "catalog.portable.primary" ||
            component.entryType !== "tree" ||
            component.format !== "portable-plugin-marketplace-v1"
          ) throw adapterError(`Claude Code cannot transform catalog component '${component.id}'.`);
        } else if (!SLOT_ORDER.includes(component.slot as ClaudeSlot)) {
          throw adapterError(`Claude Code has no target for component slot '${component.slot}'.`);
        }
      }

      const renderedSlots = new Set<string>(requiredSlots);
      const files: PlannedFile[] = [];
      for (const slot of requiredSlots) {
        const component = bySlot.get(slot);
        if (component === undefined) throw adapterError(`Required Claude Code component slot '${slot}' is missing.`);
        let rendered = await renderComponent(component, targetForSlot(slot, config), variablesFor(slot, config, renderedSlots));
        if (slot === "project.instructions") {
          rendered = withContent(
            rendered,
            rendered.content.replaceAll(".agents/skills/forgeyard-workflow/SKILL.md", ".claude/skills/forgeyard-workflow/SKILL.md"),
          );
          files.push(rendered);
          const settings = `${JSON.stringify({
            disableSkillShellExecution: true,
            hooks: {
              PreToolUse: [{
                matcher: "Edit|Write|NotebookEdit",
                hooks: [{
                  type: "command",
                  command: 'node "$CLAUDE_PROJECT_DIR/.forgeyard/bin/write-guard.mjs"',
                }],
              }],
            },
          }, null, 2)}\n`;
          files.push(withContent(
            { ...rendered, path: ".claude/settings.json" },
            settings,
            `${component.id}.claude-settings`,
          ));
          continue;
        }
        if (slot === "review.readonly") {
          rendered = withContent(rendered, reviewerMarkdown(rendered.content), `${component.id}.claude-agent`);
        }
        files.push(rendered);
      }
      for (const catalog of catalogComponents) {
        files.push(...await renderClaudeCodeCatalog(catalog, catalog.catalogSelection ?? "all"));
      }
      assertUniquePaths(files);
      return files;
    },
    async validateOutput(files: readonly PlannedFile[]): Promise<void> {
      assertUniquePaths(files);
      const byPath = new Map(files.map((file) => [file.path, file.content]));
      const projectInstructions = files.find((file) => file.componentId === "foundation.project-instructions");
      if (projectInstructions === undefined) throw adapterError("Required Claude Code project instructions are missing.");
      const required = [
        projectInstructions.path,
        ".claude/settings.json",
        ".claude/skills/forgeyard-workflow/SKILL.md",
        ".claude/agents/forgeyard-reviewer.md",
        ".forgeyard/tasks/T001.yaml",
        ".forgeyard/bin/write-guard.mjs",
        ".forgeyard/COMPOSITION.md",
      ];
      if (byPath.has("PROJECT.md")) required.push(
        "PROJECT.md",
        ".forgeyard/tasks/T002.yaml",
        ".forgeyard/tasks/T003.yaml",
        ".forgeyard/knowledge/README.md",
        ".forgeyard/decisions/0000-template.md",
        ".forgeyard/handoffs/CURRENT.md",
        ".forgeyard/reports/RUN_REPORT.md",
        ".forgeyard/usage/README.md",
      );
      for (const filePath of required) {
        if (!byPath.has(filePath)) throw adapterError(`Required Claude Code output '${filePath}' is missing.`, [filePath]);
      }
      const settings = JSON.parse(byPath.get(".claude/settings.json")!) as Record<string, unknown>;
      const hook = ((settings.hooks as { PreToolUse?: unknown[] } | undefined)?.PreToolUse?.[0] ?? {}) as Record<string, unknown>;
      const hookCommands = (hook.hooks ?? []) as Array<Record<string, unknown>>;
      if (
        settings.disableSkillShellExecution !== true ||
        Object.keys(settings).sort().join(",") !== "disableSkillShellExecution,hooks" ||
        hook.matcher !== "Edit|Write|NotebookEdit" ||
        hookCommands.length !== 1 ||
        hookCommands[0]?.type !== "command" ||
        hookCommands[0]?.command !== 'node "$CLAUDE_PROJECT_DIR/.forgeyard/bin/write-guard.mjs"'
      ) {
        throw adapterError("Claude Code project settings do not disable dynamic skill shell expansion.", [".claude/settings.json"]);
      }
      const authored = files.filter((file) => !file.componentId.startsWith("ecosystem."));
      if (/\{\{[^}]*\}\}/.test(authored.map((file) => file.content).join("\n"))) {
        throw adapterError("Generated Claude Code output contains an unresolved template expression.");
      }
      for (const file of files.filter((candidate) =>
        candidate.path.endsWith("/SKILL.md") || /^\.claude\/(?:agents|commands)\/.*\.md$/.test(candidate.path)
      )) {
        const parsed = frontmatter(file.content, file.path);
        if (file.path.includes("/.claude/")) throw adapterError("Claude Code output path is malformed.", [file.path]);
        if (file.path.includes("/agents/") || file.path.startsWith(".claude/agents/")) {
          if (typeof parsed.name !== "string" || typeof parsed.description !== "string" || Object.hasOwn(parsed, "hooks")) {
            throw adapterError("Generated Claude Code agent metadata is invalid.", [file.path]);
          }
        } else if (typeof parsed.description !== "string" || Object.hasOwn(parsed, "hooks")) {
          throw adapterError("Generated Claude Code skill or command metadata is invalid.", [file.path]);
        }
      }
      for (const id of ["T001", "T002", "T003"]) {
        const filePath = `.forgeyard/tasks/${id}.yaml`;
        if (byPath.has(filePath)) validateTask(byPath.get(filePath)!, filePath, id);
      }
      if (projectInstructions.content.trim().length === 0) {
        throw adapterError("Generated Claude Code project instructions are empty.", [projectInstructions.path]);
      }
    },
  };
}
