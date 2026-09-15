import { readFile } from "node:fs/promises";

import { stringify as stringifyYaml } from "yaml";

import type {
  PortableAgent,
  PortableCommand,
  PortablePlugin,
  PortableSkill,
} from "../catalog/contracts.js";
import { loadPortableMarketplace } from "../catalog/load-portable-marketplace.js";
import type { ComponentTreeFile, PlannedFile, ResolvedComponent } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Bytes, sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";

const CLAUDE_SKILL_FIELDS = new Set([
  "argument-hint",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "model",
  "context",
  "agent",
]);
const CLAUDE_COMMAND_FIELDS = new Set([
  "description",
  "argument-hint",
  "allowed-tools",
  "model",
  "disable-model-invocation",
]);
const CLAUDE_AGENT_FIELDS = new Set([
  "model",
  "effort",
  "maxTurns",
  "disallowedTools",
  "skills",
  "memory",
  "background",
  "isolation",
]);

function catalogError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CATALOG_INVALID",
    message,
    remediation: "Correct the selected portable catalog or its Claude Code transformation.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
  });
}

function normalizeText(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function compactDescription(value: string, fallback: string): string {
  const normalized = normalizeText(value).replaceAll(/\s+/g, " ").trim() || fallback;
  if (Buffer.byteLength(normalized, "utf8") <= 1_024) return normalized;
  let end = normalized.length;
  while (end > 0 && Buffer.byteLength(`${normalized.slice(0, end)}…`, "utf8") > 1_024) end -= 1;
  return `${normalized.slice(0, end).trimEnd()}…`;
}

function portableIdentifier(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (normalized.length === 0) throw catalogError(`Portable component name '${value}' has no safe identifier.`);
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 51).replaceAll(/-+$/g, "")}-${sha256Text(normalized).slice(0, 12)}`;
}

function namespacedId(pluginName: string, documentName: string, suffix = ""): string {
  return portableIdentifier(`${pluginName}--${documentName}${suffix}`);
}

function frontmatterBlock(metadata: Readonly<Record<string, unknown>>): string {
  return `---\n${stringifyYaml(metadata, { lineWidth: 0 }).trimEnd()}\n---`;
}

function documentContent(metadata: Readonly<Record<string, unknown>>, body: string): string {
  return `${frontmatterBlock(metadata)}\n${normalizeText(body).replace(/^\n*/, "\n").trimEnd()}\n`;
}

function selectedFields(
  source: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => allowed.has(key))
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => [key, source[key]]),
  );
}

function skillMetadata(plugin: PortablePlugin, skill: PortableSkill): Record<string, unknown> {
  const id = namespacedId(plugin.name, skill.name);
  const metadata = selectedFields(skill.frontmatter, CLAUDE_SKILL_FIELDS);
  metadata.name = id;
  metadata.description = compactDescription(skill.description, `${skill.name} from ${plugin.name}.`);
  if (typeof metadata.agent === "string") metadata.agent = namespacedId(plugin.name, metadata.agent);
  return metadata;
}

function commandMetadata(plugin: PortablePlugin, command: PortableCommand): Record<string, unknown> {
  const metadata = selectedFields(command.frontmatter, CLAUDE_COMMAND_FIELDS);
  metadata.description = compactDescription(command.description, `Run the ${command.name} workflow from ${plugin.name}.`);
  if (command.argumentHint !== undefined) metadata["argument-hint"] = command.argumentHint;
  return metadata;
}

function stringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function agentMetadata(plugin: PortablePlugin, agent: PortableAgent): Record<string, unknown> {
  const metadata = selectedFields(agent.frontmatter, CLAUDE_AGENT_FIELDS);
  metadata.name = namespacedId(plugin.name, agent.name);
  metadata.description = compactDescription(agent.description, `${agent.name} from ${plugin.name}.`);
  if (agent.model !== undefined) metadata.model = agent.model;
  if (Object.hasOwn(agent.frontmatter, "tools")) metadata.tools = [...agent.tools];
  if (Object.hasOwn(metadata, "skills")) {
    const localSkills = new Set(plugin.skills.map((skill) => skill.name));
    metadata.skills = stringList(metadata.skills).map((name) => localSkills.has(name) ? namespacedId(plugin.name, name) : name);
  }
  return metadata;
}

async function readTreeText(file: ComponentTreeFile): Promise<string> {
  const bytes = await readFile(file.sourcePath);
  if (sha256Bytes(bytes) !== file.sha256) {
    throw catalogError("Portable catalog content changed after registry resolution.", [file.relativePath]);
  }
  let content: string;
  try {
    content = normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw catalogError("Portable catalog files must be valid UTF-8 text.", [file.relativePath]);
  }
  return content;
}

function plannedFile(
  component: ResolvedComponent,
  targetPath: string,
  content: string,
  componentId: string,
): PlannedFile {
  const normalizedContent = normalizeText(content);
  return {
    path: normalizePortablePath(targetPath),
    content: normalizedContent,
    sha256: sha256Text(normalizedContent),
    componentId,
    ownership: component.ownership,
  };
}

function selectPlugins(
  plugins: readonly PortablePlugin[],
  selection: readonly string[] | "all",
): readonly PortablePlugin[] {
  if (selection === "all") return plugins;
  const duplicates = selection.filter((name, index) => selection.indexOf(name) !== index);
  if (duplicates.length > 0) throw catalogError(`Catalog selection repeats plugin '${duplicates[0]}'.`);
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const missing = selection.filter((name) => !byName.has(name));
  if (missing.length > 0) throw catalogError(`Catalog selection contains unknown plugin '${missing[0]}'.`);
  return selection
    .map((name) => byName.get(name)!)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function commandId(plugin: PortablePlugin, command: PortableCommand, skillIds: ReadonlySet<string>): string {
  const base = namespacedId(plugin.name, command.name);
  if (!skillIds.has(base)) return base;
  const candidate = namespacedId(plugin.name, command.name, "--command");
  if (!skillIds.has(candidate)) return candidate;
  return namespacedId(plugin.name, command.name, `--cmd-${sha256Text(command.source.relativePath).slice(0, 8)}`);
}

function assertUniqueOutputPaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw catalogError("Claude Code catalog transformation produced a duplicate output path.", [file.path]);
    }
    seen.add(key);
  }
}

function hookCounts(plugins: readonly PortablePlugin[]): { importedHookFiles: number; frontmatterHooks: number } {
  return {
    importedHookFiles: plugins.reduce(
      (sum, plugin) => sum + plugin.otherFiles.filter((file) => /(?:^|\/)hooks(?:\/|$)/.test(file.relativePath)).length,
      0,
    ),
    frontmatterHooks: plugins.reduce(
      (sum, plugin) => sum + [...plugin.agents, ...plugin.skills, ...plugin.commands]
        .filter((document) => Object.hasOwn(document.frontmatter, "hooks")).length,
      0,
    ),
  };
}

export async function renderClaudeCodeCatalog(
  component: ResolvedComponent,
  selection: readonly string[] | "all",
): Promise<readonly PlannedFile[]> {
  if (
    component.kind !== "catalog" ||
    component.entryType !== "tree" ||
    component.format !== "portable-plugin-marketplace-v1" ||
    component.treeFiles === undefined
  ) throw catalogError("Claude Code catalog renderer received an incompatible component.");

  const marketplace = await loadPortableMarketplace(component.treeFiles, { defaultLicense: "MIT" });
  const plugins = selectPlugins(marketplace.plugins, selection);
  const files: PlannedFile[] = [];

  for (const plugin of plugins) {
    const skillIds = new Set(plugin.skills.map((skill) => namespacedId(plugin.name, skill.name)));
    for (const skill of plugin.skills) {
      const id = namespacedId(plugin.name, skill.name);
      const root = `.claude/skills/${id}`;
      files.push(plannedFile(
        component,
        `${root}/SKILL.md`,
        documentContent(skillMetadata(plugin, skill), skill.body),
        `${component.id}.skill.${id}`,
      ));
      for (const supporting of skill.supportingFiles) {
        const relativePath = normalizePortablePath(supporting.relativeToSkill);
        files.push(plannedFile(
          component,
          `${root}/${relativePath}`,
          await readTreeText(supporting),
          `${component.id}.skill-support.${id}.${sha256Text(supporting.relativeToSkill).slice(0, 12)}`,
        ));
      }
    }

    for (const command of plugin.commands) {
      const id = commandId(plugin, command, skillIds);
      files.push(plannedFile(
        component,
        `.claude/commands/${id}.md`,
        documentContent(commandMetadata(plugin, command), command.body),
        `${component.id}.command.${id}`,
      ));
    }

    for (const agent of plugin.agents) {
      const id = namespacedId(plugin.name, agent.name);
      files.push(plannedFile(
        component,
        `.claude/agents/${id}.md`,
        documentContent(agentMetadata(plugin, agent), agent.body),
        `${component.id}.agent.${id}`,
      ));
    }
  }

  const upstreamFile = component.treeFiles.find((file) => file.relativePath === "UPSTREAM.json");
  const licenseFile = component.treeFiles.find((file) => file.relativePath === "LICENSE");
  if (licenseFile === undefined) throw catalogError("Portable catalog is missing its upstream LICENSE file.");
  let source: unknown = {};
  if (upstreamFile !== undefined) {
    try {
      source = JSON.parse(await readTreeText(upstreamFile));
    } catch (error) {
      if (error instanceof ForgeyardError) throw error;
      throw catalogError("Portable catalog UPSTREAM.json is invalid.", [upstreamFile.relativePath]);
    }
  }
  const counts = {
    plugins: plugins.length,
    agents: plugins.reduce((sum, plugin) => sum + plugin.agents.length, 0),
    skills: plugins.reduce((sum, plugin) => sum + plugin.skills.length, 0),
    commands: plugins.reduce((sum, plugin) => sum + plugin.commands.length, 0),
    supportingFiles: plugins.reduce(
      (sum, plugin) => sum + plugin.skills.reduce((inner, skill) => inner + skill.supportingFiles.length, 0),
      0,
    ),
  };
  files.push(plannedFile(
    component,
    ".forgeyard/catalog/ecosystem.json",
    `${JSON.stringify({
      schemaVersion: 1,
      adapter: "claude-code",
      source,
      selectedPlugins: plugins.map((plugin) => plugin.name),
      counts,
      disabled: hookCounts(plugins),
      safety: { skillShellExpansionRequiresExplicitOptIn: true },
    }, null, 2)}\n`,
    `${component.id}.catalog-index`,
  ));
  files.push(plannedFile(
    component,
    ".forgeyard/licenses/wshobson-agents.LICENSE",
    await readTreeText(licenseFile),
    `${component.id}.license.wshobson-agents`,
  ));

  assertUniqueOutputPaths(files);
  return files;
}
