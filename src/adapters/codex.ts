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
import { auditPresentationSources } from "../doctor/presentation-audit.js";
import { renderCodexCatalog } from "./codex-catalog.js";
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
] as const;

const PRESENTATION_SLOT_ORDER = [
  "presentation.skill",
  "presentation.index",
  "presentation.styles",
  "presentation.script",
  "presentation.readme",
] as const;

const SLOT_ORDER = [...CORE_SLOT_ORDER, ...PRESENTATION_SLOT_ORDER] as const;

type CodexSlot = (typeof SLOT_ORDER)[number];

const FOUNDATION_TARGET_BY_SLOT: Readonly<Record<(typeof SLOT_ORDER)[number], string | undefined>> = {
  "project.instructions": "AGENTS.md",
  "workflow.primary": ".agents/skills/forgeyard-workflow/SKILL.md",
  "review.readonly": ".codex/agents/reviewer.toml",
  "task.initial": ".forgeyard/tasks/T001.yaml",
  "presentation.skill": ".agents/skills/forgeyard-showcase/SKILL.md",
  "presentation.index": undefined,
  "presentation.styles": undefined,
  "presentation.script": undefined,
  "presentation.readme": undefined,
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

function presentationPath(root: string, fileName: string): string {
  const normalized = normalizePortablePath(root);
  return normalizePortablePath(normalized === "." ? fileName : `${normalized}/${fileName}`);
}

function targetForSlot(slot: CodexSlot, config: ForgeyardConfig): string {
  const foundation = FOUNDATION_TARGET_BY_SLOT[slot];
  if (foundation !== undefined) return foundation;
  switch (slot) {
    case "presentation.index":
      return presentationPath(config.paths.presentation, "index.html");
    case "presentation.styles":
      return presentationPath(config.paths.presentation, "styles.css");
    case "presentation.script":
      return presentationPath(config.paths.presentation, "app.js");
    case "presentation.readme":
      return presentationPath(config.paths.presentation, "README.md");
    default:
      throw adapterError(`Codex has no target for component slot '${slot}'.`);
  }
}

function htmlQualitySummary(config: ForgeyardConfig): string {
  return escapeHtmlText(
    config.quality.commands
      .map((command) => `${command.name}: ${JSON.stringify(command.argv)}`)
      .join("; "),
  );
}

function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function presentationTimeline(config: ForgeyardConfig): string {
  const labels = ["Opening", "Problem", "Audience", "Insight", "Solution", "Demo", "Evidence", "Architecture", "Value", "Ask"];
  const goals = [
    "Frame the purpose.",
    "Make the costly moment concrete.",
    "Identify the first audience.",
    "State the product insight.",
    "Explain the visible promise.",
    "Run the complete live path.",
    "Show revision-bound proof.",
    "Explain only outcome-critical structure.",
    "Translate proof into value.",
    "Ask for one next decision.",
  ];
  const weights = [0.08, 0.1, 0.08, 0.09, 0.12, 0.17, 0.13, 0.09, 0.07, 0.07];
  const totalSeconds = config.presentation.durationMinutes * 60;
  let elapsed = 0;
  return labels.map((label, index) => {
    const start = elapsed;
    elapsed = index === labels.length - 1 ? totalSeconds : elapsed + totalSeconds * weights[index]!;
    return `| ${clockLabel(start)}–${clockLabel(elapsed)} | ${label} | ${goals[index]} |`;
  }).join("\n");
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
    case "presentation.index":
      return {
        "project.name": escapeHtmlText(config.project.name),
        "project.purpose": escapeHtmlText(config.project.purpose),
        "presentation.audience": escapeHtmlText(config.presentation.audience),
        "presentation.durationMinutes": String(config.presentation.durationMinutes),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
        "quality.summary": htmlQualitySummary(config),
      };
    case "presentation.readme":
      return {
        "project.name": escapeMarkdownInline(config.project.name),
        "presentation.audience": escapeMarkdownInline(config.presentation.audience),
        "presentation.durationMinutes": String(config.presentation.durationMinutes),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
        "quality.commands": qualityMarkdown(config),
        "presentation.timeline": presentationTimeline(config),
      };
    case "presentation.skill":
    case "presentation.styles":
    case "presentation.script":
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

function validateTask(content: string, filePath: string): void {
  const parsed = parseYaml(content) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || parsed.id !== "T001" || parsed.required !== true || !Array.isArray(parsed.command)) {
    throw adapterError("Generated initial task has invalid YAML fields.", [filePath]);
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
      dagScheduling: "unsupported",
    },
    validateConfig(config) {
      if (
        !["minimal", "hackathon", "full"].includes(config.profile) ||
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
      const requiredSlots = config.presentation.enabled ? SLOT_ORDER : CORE_SLOT_ORDER;
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

      const files: PlannedFile[] = [];
      for (const slot of requiredSlots) {
        const component = bySlot.get(slot);
        if (component === undefined) throw adapterError(`Required Codex component slot '${slot}' is missing.`);
        const target = targetForSlot(slot, config);
        files.push(await renderComponent(component, target, variablesFor(slot, config)));
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
      const required = [
        "AGENTS.md",
        ".agents/skills/forgeyard-workflow/SKILL.md",
        ".codex/agents/reviewer.toml",
        ".forgeyard/tasks/T001.yaml",
      ];
      const presentationRoot = files
        .find((file) => file.componentId === "presentation.index")
        ?.path.replace(/\/index\.html$/, "");
      if (presentationRoot !== undefined) {
        required.push(
          ".agents/skills/forgeyard-showcase/SKILL.md",
          `${presentationRoot}/index.html`,
          `${presentationRoot}/styles.css`,
          `${presentationRoot}/app.js`,
          `${presentationRoot}/README.md`,
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
      if (presentationRoot !== undefined) {
        validateSkill(byPath.get(".agents/skills/forgeyard-showcase/SKILL.md")!, ".agents/skills/forgeyard-showcase/SKILL.md", "forgeyard-showcase");
      }
      validateReviewer(byPath.get(".codex/agents/reviewer.toml")!, ".codex/agents/reviewer.toml");
      validateTask(byPath.get(".forgeyard/tasks/T001.yaml")!, ".forgeyard/tasks/T001.yaml");
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
      if (presentationRoot !== undefined) {
        const presentationFindings = auditPresentationSources({
          directory: presentationRoot,
          html: byPath.get(`${presentationRoot}/index.html`)!,
          css: byPath.get(`${presentationRoot}/styles.css`)!,
          javascript: byPath.get(`${presentationRoot}/app.js`)!,
        });
        if (presentationFindings.length > 0) {
          throw adapterError(
            "Generated presentation output violates the offline or accessibility contract.",
            [...new Set(presentationFindings.map((finding) => finding.path))].sort(),
          );
        }
      }
      if (byPath.get("AGENTS.md")!.trim().length === 0) throw adapterError("Generated AGENTS.md is empty.", ["AGENTS.md"]);
    },
  };
}
