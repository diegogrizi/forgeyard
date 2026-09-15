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
import { auditPresentationSources } from "../doctor/presentation-audit.js";
import { renderCursorCatalog } from "./cursor-catalog.js";
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
type CursorSlot = (typeof SLOT_ORDER)[number];

function adapterError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the Cursor adapter mapping or rendered component structure.",
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

function targetForSlot(slot: CursorSlot, config: ForgeyardConfig): string {
  switch (slot) {
    case "project.instructions":
      return "AGENTS.md";
    case "workflow.primary":
      return ".cursor/rules/forgeyard-workflow.mdc";
    case "review.readonly":
      return ".cursor/rules/forgeyard-reviewer.mdc";
    case "task.initial":
      return ".forgeyard/tasks/T001.yaml";
    case "presentation.skill":
      return ".cursor/rules/forgeyard-showcase.mdc";
    case "presentation.index":
      return presentationPath(config.paths.presentation, "index.html");
    case "presentation.styles":
      return presentationPath(config.paths.presentation, "styles.css");
    case "presentation.script":
      return presentationPath(config.paths.presentation, "app.js");
    case "presentation.readme":
      return presentationPath(config.paths.presentation, "README.md");
  }
}

function htmlQualitySummary(config: ForgeyardConfig): string {
  return escapeHtmlText(
    config.quality.commands.map((command) => `${command.name}: ${JSON.stringify(command.argv)}`).join("; "),
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

function variablesFor(slot: CursorSlot, config: ForgeyardConfig): Readonly<Record<string, string>> {
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
        "task.writeScopes": yamlSequence(config.paths.mutableRoots),
        "workflow.timeboxMinutes": String(config.timeboxMinutes),
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
  }
}

function parseFrontmatterDocument(content: string, filePath: string): { metadata: Record<string, unknown>; body: string } {
  if (!content.startsWith("---\n")) throw adapterError("Generated workflow is missing YAML frontmatter.", [filePath]);
  const closing = content.indexOf("\n---\n", 4);
  if (closing < 0) throw adapterError("Generated workflow frontmatter is not closed.", [filePath]);
  const parsed = parseYaml(content.slice(4, closing));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw adapterError("Generated workflow frontmatter is not a mapping.", [filePath]);
  }
  return { metadata: parsed as Record<string, unknown>, body: content.slice(closing + 5) };
}

function mdc(description: string, body: string): string {
  const metadata = stringifyYaml({ description, globs: [], alwaysApply: false }, { lineWidth: 0 }).trimEnd();
  return `---\n${metadata}\n---\n${body.replace(/^\n*/, "\n").trimEnd()}\n`;
}

function skillRule(content: string, filePath: string): string {
  const parsed = parseFrontmatterDocument(content, filePath);
  if (typeof parsed.metadata.description !== "string") {
    throw adapterError("Canonical skill lacks a description for Cursor discovery.", [filePath]);
  }
  return mdc(parsed.metadata.description, parsed.body);
}

function reviewerRule(content: string): string {
  const parsed = parseToml(content);
  if (typeof parsed.developer_instructions !== "string") {
    throw adapterError("Canonical reviewer template did not produce reviewer instructions.");
  }
  return mdc(
    "Read-only reviewer for a named task and frozen revision.",
    `# Forgeyard reviewer\n\n> Cursor does not enforce a per-rule tool allowlist. Treat this rule as read-only and do not edit files.\n\n${parsed.developer_instructions.trim()}\n`,
  );
}

function withContent(file: PlannedFile, content: string, componentId = file.componentId): PlannedFile {
  return { ...file, content, sha256: sha256Text(content), componentId };
}

function assertUniquePaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw adapterError("Cursor output contains duplicate target paths.", [file.path]);
    seen.add(key);
  }
}

function validateTask(content: string, filePath: string): void {
  const parsed = parseYaml(content) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || parsed.id !== "T001" || parsed.required !== true || !Array.isArray(parsed.command)) {
    throw adapterError("Generated initial task has invalid YAML fields.", [filePath]);
  }
}

export function createCursorAdapter(): HarnessAdapter {
  return {
    id: "cursor",
    capabilities: {
      projectInstructions: "native",
      projectRules: "native",
      projectSkills: "adapted",
      reviewerAgents: "adapted",
      perAgentModels: "unsupported",
      perAgentToolPolicies: "unsupported",
      importedHooks: "unsupported",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    },
    validateConfig(config) {
      if (
        !["minimal", "hackathon", "full"].includes(config.profile) ||
        config.harnesses.length !== 1 ||
        config.harnesses[0] !== "cursor"
      ) throw adapterError("Cursor adapter received an unsupported configuration.");
    },
    async render(components: readonly ResolvedComponent[], config: ForgeyardConfig): Promise<readonly PlannedFile[]> {
      this.validateConfig(config);
      const catalogComponents = components.filter((component) => component.kind === "catalog");
      if (catalogComponents.length > 1) throw adapterError("Cursor supports one portable catalog per profile.");
      const bySlot = new Map(components.filter((component) => component.kind !== "catalog").map((component) => [component.slot, component]));
      const requiredSlots = config.presentation.enabled ? SLOT_ORDER : CORE_SLOT_ORDER;
      for (const component of components) {
        if (component.kind === "catalog") {
          if (
            component.slot !== "catalog.portable.primary" ||
            component.entryType !== "tree" ||
            component.format !== "portable-plugin-marketplace-v1"
          ) throw adapterError(`Cursor cannot transform catalog component '${component.id}'.`);
        } else if (!SLOT_ORDER.includes(component.slot as CursorSlot)) {
          throw adapterError(`Cursor has no target for component slot '${component.slot}'.`);
        }
      }

      const files: PlannedFile[] = [];
      for (const slot of requiredSlots) {
        const component = bySlot.get(slot);
        if (component === undefined) throw adapterError(`Required Cursor component slot '${slot}' is missing.`);
        let rendered = await renderComponent(component, targetForSlot(slot, config), variablesFor(slot, config));
        if (slot === "project.instructions") {
          rendered = withContent(
            rendered,
            rendered.content.replaceAll(".agents/skills/forgeyard-workflow/SKILL.md", ".cursor/rules/forgeyard-workflow.mdc"),
          );
        } else if (slot === "workflow.primary" || slot === "presentation.skill") {
          rendered = withContent(rendered, skillRule(rendered.content, rendered.path));
        } else if (slot === "review.readonly") {
          rendered = withContent(rendered, reviewerRule(rendered.content), `${component.id}.cursor-rule`);
        }
        files.push(rendered);
      }
      for (const catalog of catalogComponents) {
        files.push(...await renderCursorCatalog(catalog, catalog.catalogSelection ?? "all"));
      }
      assertUniquePaths(files);
      return files;
    },
    async validateOutput(files: readonly PlannedFile[]): Promise<void> {
      assertUniquePaths(files);
      const byPath = new Map(files.map((file) => [file.path, file.content]));
      const required = [
        "AGENTS.md",
        ".cursor/rules/forgeyard-workflow.mdc",
        ".cursor/rules/forgeyard-reviewer.mdc",
        ".forgeyard/tasks/T001.yaml",
      ];
      const presentationRoot = files.find((file) => file.componentId === "presentation.index")?.path.replace(/\/index\.html$/, "");
      if (presentationRoot !== undefined) required.push(
        ".cursor/rules/forgeyard-showcase.mdc",
        `${presentationRoot}/index.html`,
        `${presentationRoot}/styles.css`,
        `${presentationRoot}/app.js`,
        `${presentationRoot}/README.md`,
      );
      for (const filePath of required) {
        if (!byPath.has(filePath)) throw adapterError(`Required Cursor output '${filePath}' is missing.`, [filePath]);
      }
      const authored = files.filter((file) => !file.componentId.startsWith("ecosystem."));
      if (/\{\{[^}]*\}\}/.test(authored.map((file) => file.content).join("\n"))) {
        throw adapterError("Generated Cursor output contains an unresolved template expression.");
      }
      for (const file of files.filter((candidate) => candidate.path.endsWith(".mdc"))) {
        const parsed = parseFrontmatterDocument(file.content, file.path).metadata;
        if (
          typeof parsed.description !== "string" ||
          !Array.isArray(parsed.globs) ||
          parsed.alwaysApply !== false
        ) throw adapterError("Generated Cursor rule metadata is invalid.", [file.path]);
        for (const match of file.content.matchAll(/@(\.cursor\/forgeyard\/[^\s]+)/g)) {
          if (!byPath.has(match[1]!)) throw adapterError("Cursor rule references a missing local instruction file.", [file.path, match[1]!]);
        }
      }
      validateTask(byPath.get(".forgeyard/tasks/T001.yaml")!, ".forgeyard/tasks/T001.yaml");
      if (presentationRoot !== undefined) {
        const findings = auditPresentationSources({
          directory: presentationRoot,
          html: byPath.get(`${presentationRoot}/index.html`)!,
          css: byPath.get(`${presentationRoot}/styles.css`)!,
          javascript: byPath.get(`${presentationRoot}/app.js`)!,
        });
        if (findings.length > 0) {
          throw adapterError("Generated presentation violates its offline or accessibility contract.", [...new Set(findings.map((finding) => finding.path))].sort());
        }
      }
      if (byPath.get("AGENTS.md")!.trim().length === 0) throw adapterError("Generated AGENTS.md is empty.", ["AGENTS.md"]);
    },
  };
}
