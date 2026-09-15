import { readFile } from "node:fs/promises";

import { stringify as stringifyYaml } from "yaml";

import type { PortableDocument, PortablePlugin } from "../catalog/contracts.js";
import { loadPortableMarketplace } from "../catalog/load-portable-marketplace.js";
import type { ComponentTreeFile, PlannedFile, ResolvedComponent } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Bytes, sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";

type CatalogRuleKind = "agent" | "skill" | "command";

function catalogError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CATALOG_INVALID",
    message,
    remediation: "Correct the selected portable catalog or its Cursor transformation.",
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

function namespacedId(pluginName: string, documentName: string): string {
  return portableIdentifier(`${pluginName}--${documentName}`);
}

async function readTreeText(file: ComponentTreeFile): Promise<string> {
  const bytes = await readFile(file.sourcePath);
  if (sha256Bytes(bytes) !== file.sha256) {
    throw catalogError("Portable catalog content changed after registry resolution.", [file.relativePath]);
  }
  try {
    return normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw catalogError("Portable catalog files must be valid UTF-8 text.", [file.relativePath]);
  }
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

function instructionContent(
  plugin: PortablePlugin,
  kind: CatalogRuleKind,
  document: PortableDocument,
  id: string,
): string {
  const limitations = kind === "agent"
    ? "Source model, tool, and isolation fields are descriptive here; Cursor project rules do not enforce them."
    : kind === "skill"
      ? "Source tool restrictions and hook fields are not enforced by this Cursor rule."
      : "Source command metadata is adapted to an agent-requested Cursor rule.";
  return `${[
    `# ${id}`,
    "",
    `Catalog source: ${plugin.name} ${kind} \`${document.name}\`.`,
    "",
    `> ${limitations}`,
    "",
    normalizeText(document.body).trim(),
    "",
  ].join("\n")}`;
}

function ruleContent(
  kind: CatalogRuleKind,
  id: string,
  description: string,
  referencePath: string,
): string {
  const metadata = stringifyYaml({
    description: compactDescription(description, `Use the ${id} ${kind} capability.`),
    globs: [],
    alwaysApply: false,
  }, { lineWidth: 0 }).trimEnd();
  return `---\n${metadata}\n---\n\n# ${id}\n\nUse this ${kind} capability only when it matches the current task. Follow @${referencePath} as the complete local instructions.\n`;
}

function assertUniqueOutputPaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw catalogError("Cursor catalog transformation produced a duplicate output path.", [file.path]);
    seen.add(key);
  }
}

function countPolicies(plugins: readonly PortablePlugin[]) {
  const agents = plugins.flatMap((plugin) => plugin.agents);
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
    agentModelPolicies: agents.filter((agent) => agent.model !== undefined).length,
    agentToolPolicies: agents.filter((agent) => Object.hasOwn(agent.frontmatter, "tools")).length,
    agentIsolationPolicies: agents.filter((agent) => Object.hasOwn(agent.frontmatter, "isolation")).length,
  };
}

export async function renderCursorCatalog(
  component: ResolvedComponent,
  selection: readonly string[] | "all",
): Promise<readonly PlannedFile[]> {
  if (
    component.kind !== "catalog" ||
    component.entryType !== "tree" ||
    component.format !== "portable-plugin-marketplace-v1" ||
    component.treeFiles === undefined
  ) throw catalogError("Cursor catalog renderer received an incompatible component.");

  const marketplace = await loadPortableMarketplace(component.treeFiles, { defaultLicense: "MIT" });
  const plugins = selectPlugins(marketplace.plugins, selection);
  const files: PlannedFile[] = [];

  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      const id = namespacedId(plugin.name, skill.name);
      const root = `.cursor/forgeyard/skills/${id}`;
      const referencePath = `${root}/instructions.md`;
      files.push(plannedFile(
        component,
        referencePath,
        instructionContent(plugin, "skill", skill, id),
        `${component.id}.skill-source.${id}`,
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
      files.push(plannedFile(
        component,
        `.cursor/rules/catalog--skill--${id}.mdc`,
        ruleContent("skill", id, skill.description, referencePath),
        `${component.id}.skill-rule.${id}`,
      ));
    }

    for (const command of plugin.commands) {
      const id = namespacedId(plugin.name, command.name);
      const referencePath = `.cursor/forgeyard/commands/${id}.md`;
      files.push(plannedFile(
        component,
        referencePath,
        instructionContent(plugin, "command", command, id),
        `${component.id}.command-source.${id}`,
      ));
      files.push(plannedFile(
        component,
        `.cursor/rules/catalog--command--${id}.mdc`,
        ruleContent("command", id, command.description, referencePath),
        `${component.id}.command-rule.${id}`,
      ));
    }

    for (const agent of plugin.agents) {
      const id = namespacedId(plugin.name, agent.name);
      const referencePath = `.cursor/forgeyard/agents/${id}.md`;
      files.push(plannedFile(
        component,
        referencePath,
        instructionContent(plugin, "agent", agent, id),
        `${component.id}.agent-source.${id}`,
      ));
      files.push(plannedFile(
        component,
        `.cursor/rules/catalog--agent--${id}.mdc`,
        ruleContent("agent", id, agent.description, referencePath),
        `${component.id}.agent-rule.${id}`,
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
    rules: plugins.reduce((sum, plugin) => sum + plugin.agents.length + plugin.skills.length + plugin.commands.length, 0),
  };
  files.push(plannedFile(
    component,
    ".forgeyard/catalog/ecosystem.json",
    `${JSON.stringify({
      schemaVersion: 1,
      adapter: "cursor",
      source,
      selectedPlugins: plugins.map((plugin) => plugin.name),
      counts,
      unsupported: countPolicies(plugins),
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
