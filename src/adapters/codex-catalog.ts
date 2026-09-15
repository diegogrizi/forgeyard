import { readFile } from "node:fs/promises";

import { stringify as stringifyYaml } from "yaml";

import { loadPortableMarketplace } from "../catalog/load-portable-marketplace.js";
import type {
  PortableAgent,
  PortableCommand,
  PortablePlugin,
  PortableSkill,
} from "../catalog/contracts.js";
import type {
  ComponentTreeFile,
  PlannedFile,
  ResolvedComponent,
} from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";
import { quoteTomlMultiline } from "./strict-template.js";

const SKILL_FILE_LIMIT_BYTES = 8_192;
const CLAUDE_ONLY_SKILL_FIELDS = new Set([
  "allowed-tools",
  "context",
  "model",
  "hooks",
  "agent",
  "user-invocable",
  "disable-model-invocation",
]);
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
const TOOL_PROSE = new Map([
  ["Read", "open the file"],
  ["Write", "write the file"],
  ["Edit", "edit the file"],
  ["MultiEdit", "edit the files"],
  ["Bash", "run the command"],
  ["Grep", "search the repository"],
  ["Glob", "find matching files"],
  ["WebFetch", "fetch the page"],
  ["WebSearch", "search the web"],
  ["Task", "delegate the task"],
  ["TodoWrite", "update the task list"],
  ["NotebookEdit", "edit the notebook"],
  ["AskUserQuestion", "ask the user"],
]);

interface SplitSkill {
  primary: string;
  overflow?: { relativePath: string; content: string };
}

function catalogError(message: string, paths?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CATALOG_INVALID",
    message,
    remediation: "Correct the selected portable catalog or its Codex transformation.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
  });
}

function normalizeText(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function utf8Bytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteBodyForCodex(body: string): string {
  let rendered = normalizeText(body);
  for (const [tool, replacement] of TOOL_PROSE) {
    rendered = rendered.replace(
      new RegExp(`\\bthe\\s+\`?${escapeRegExp(tool)}\`?\\s+tool\\b`, "gi"),
      replacement,
    );
  }
  return rendered;
}

function compactDescription(value: string, fallback: string): string {
  const normalized = normalizeText(value).replaceAll(/\s+/g, " ").trim() || fallback;
  if (utf8Bytes(normalized) <= 1_024) return normalized;
  let end = normalized.length;
  while (end > 0 && utf8Bytes(`${normalized.slice(0, end)}…`) > 1_024) end -= 1;
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

function filteredSkillMetadata(skill: PortableSkill, skillId: string): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    name: skillId,
    description: compactDescription(skill.description, `${skill.name} from the ${skillId.split("--")[0]} plugin.`),
  };
  for (const key of Object.keys(skill.frontmatter).sort((left, right) => left.localeCompare(right, "en"))) {
    if (key === "name" || key === "description" || CLAUDE_ONLY_SKILL_FIELDS.has(key)) continue;
    metadata[key] = skill.frontmatter[key];
  }
  return metadata;
}

function commandMetadata(command: PortableCommand, commandId: string): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    name: commandId,
    description: compactDescription(command.description, `Run the ${command.name} workflow.`),
  };
  if (command.argumentHint !== undefined) metadata.metadata = { "argument-hint": command.argumentHint };
  return metadata;
}

function splitOutsideFences(body: string): readonly string[] {
  const sections: string[] = [];
  let current = "";
  let fenceMarker: string | undefined;
  for (const line of body.match(/.*(?:\n|$)/g) ?? []) {
    if (line.length === 0) continue;
    const stripped = line.trimStart();
    const marker = /^(`{3,})/.exec(stripped)?.[1];
    if (marker !== undefined) {
      if (fenceMarker === undefined) fenceMarker = marker;
      else if (marker === fenceMarker) fenceMarker = undefined;
    }
    if (fenceMarker === undefined && line.startsWith("## ") && current.length > 0) {
      sections.push(current);
      current = line;
    } else {
      current += line;
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

function utf8SafeCut(content: string, capBytes: number): readonly [string, string] {
  if (capBytes <= 0) return ["", content];
  const encoded = Buffer.from(content, "utf8");
  if (encoded.length <= capBytes) return [content, ""];
  let end = capBytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1;
  const newline = encoded.lastIndexOf(0x0a, end - 1);
  if (newline > Math.floor(end / 2) && end - newline <= 256) end = newline + 1;
  return [encoded.subarray(0, end).toString("utf8"), encoded.subarray(end).toString("utf8")];
}

function splitBody(body: string, headCapBytes: number): readonly [string, string] {
  const sections = splitOutsideFences(body);
  let head = sections[0] ?? "";
  const overflow: string[] = [];
  let overflowStarted = false;
  for (const section of sections.slice(1)) {
    const candidate = `${head.trimEnd()}\n\n${section}`;
    if (!overflowStarted && utf8Bytes(candidate) <= headCapBytes) head = candidate;
    else {
      overflowStarted = true;
      overflow.push(section);
    }
  }
  if (utf8Bytes(head) > headCapBytes) {
    const [kept, tail] = utf8SafeCut(head, headCapBytes);
    head = kept;
    overflow.unshift(tail);
  }
  if (overflow.length === 0) {
    const [kept, tail] = utf8SafeCut(body, headCapBytes);
    head = kept;
    overflow.push(tail);
  }
  return [head, overflow.join("").replace(/^\n+/, "")];
}

function overflowRelativePath(existing: readonly string[]): string {
  const occupied = new Set(existing.map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US")));
  for (let index = 1; index <= 1_000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = `references/_forgeyard-overflow${suffix}.md`;
    if (!occupied.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
  throw catalogError("Unable to allocate a collision-free skill overflow path.");
}

function renderBoundedSkill(
  metadata: Readonly<Record<string, unknown>>,
  body: string,
  existingSupportingFiles: readonly string[],
): SplitSkill {
  const header = `${frontmatterBlock(metadata)}\n\n`;
  const normalizedBody = `${rewriteBodyForCodex(body).trimEnd()}\n`;
  if (utf8Bytes(header + normalizedBody) <= SKILL_FILE_LIMIT_BYTES) {
    return { primary: header + normalizedBody };
  }

  const relativePath = overflowRelativePath(existingSupportingFiles);
  const pointer =
    `\n\n> Additional instructions were moved to \`${relativePath}\` to keep this skill ` +
    "within Codex's 8 KB loading budget. Open that file when the instructions above are insufficient.\n";
  const headCap = SKILL_FILE_LIMIT_BYTES - utf8Bytes(header) - utf8Bytes(pointer);
  if (headCap <= 0) throw catalogError("Skill metadata leaves no room for an instruction body.");
  const [head, overflow] = splitBody(normalizedBody, headCap);
  const primary = `${header}${head.trimEnd()}${pointer}`;
  if (utf8Bytes(primary) > SKILL_FILE_LIMIT_BYTES) {
    throw catalogError("Codex skill splitting exceeded the 8 KB output limit.");
  }
  return {
    primary,
    overflow: { relativePath, content: `${overflow.trimEnd()}\n` },
  };
}

function tomlBasic(value: string): string {
  return `"${normalizeText(value).replaceAll(/\s+/g, " ").trim().replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderAgent(plugin: PortablePlugin, agent: PortableAgent): { id: string; content: string } {
  const id = namespacedId(plugin.name, agent.name);
  const hasToolsField = Object.hasOwn(agent.frontmatter, "tools");
  const sandboxMode = hasToolsField && agent.tools.every((tool) => READ_ONLY_TOOLS.has(tool))
    ? "read-only"
    : "workspace-write";
  const instructions = rewriteBodyForCodex(agent.body).trim() || agent.description || `${id} subagent.`;
  return {
    id,
    content: [
      `name = ${tomlBasic(id)}`,
      `description = ${tomlBasic(compactDescription(agent.description, `${agent.name} from ${plugin.name}.`))}`,
      `sandbox_mode = ${tomlBasic(sandboxMode)}`,
      `developer_instructions = ${quoteTomlMultiline(instructions)}`,
      "",
    ].join("\n"),
  };
}

async function readTreeText(file: ComponentTreeFile): Promise<string> {
  const bytes = await readFile(file.sourcePath);
  try {
    return normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw catalogError("Portable catalog supporting files must be valid UTF-8 text.", [file.relativePath]);
  }
}

function plannedFile(
  component: ResolvedComponent,
  path: string,
  content: string,
  componentId: string,
): PlannedFile {
  const normalizedPath = normalizePortablePath(path);
  const normalizedContent = normalizeText(content);
  return {
    path: normalizedPath,
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
  const commandSuffix = namespacedId(plugin.name, command.name, "--command");
  if (!skillIds.has(commandSuffix)) return commandSuffix;
  const shortSuffix = namespacedId(plugin.name, command.name, "--cmd");
  if (!skillIds.has(shortSuffix)) return shortSuffix;
  return namespacedId(plugin.name, command.name, `--cmd-${sha256Text(command.source.relativePath).slice(0, 8)}`);
}

function assertUniqueOutputPaths(files: readonly PlannedFile[]): void {
  assertNoCaseCollisions(files.map((file) => file.path));
  const seen = new Set<string>();
  for (const file of files) {
    const key = file.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw catalogError("Codex catalog transformation produced a duplicate output path.", [file.path]);
    seen.add(key);
  }
}

export async function renderCodexCatalog(
  component: ResolvedComponent,
  selection: readonly string[] | "all",
): Promise<readonly PlannedFile[]> {
  if (
    component.kind !== "catalog" ||
    component.entryType !== "tree" ||
    component.format !== "portable-plugin-marketplace-v1" ||
    component.treeFiles === undefined
  ) {
    throw catalogError("Codex catalog renderer received an incompatible component.");
  }

  const marketplace = await loadPortableMarketplace(component.treeFiles, { defaultLicense: "MIT" });
  const plugins = selectPlugins(marketplace.plugins, selection);
  const files: PlannedFile[] = [];

  for (const plugin of plugins) {
    const skillIds = new Set(plugin.skills.map((skill) => namespacedId(plugin.name, skill.name)));
    for (const skill of plugin.skills) {
      const id = namespacedId(plugin.name, skill.name);
      const root = `.agents/skills/${id}`;
      const rendered = renderBoundedSkill(
        filteredSkillMetadata(skill, id),
        skill.body,
        skill.supportingFiles.map((file) => file.relativeToSkill),
      );
      files.push(plannedFile(component, `${root}/SKILL.md`, rendered.primary, `ecosystem.skill.${id}`));
      for (const supporting of skill.supportingFiles) {
        const relativePath = normalizePortablePath(supporting.relativeToSkill);
        files.push(plannedFile(
          component,
          `${root}/${relativePath}`,
          await readTreeText(supporting),
          `ecosystem.skill-support.${id}`,
        ));
      }
      if (rendered.overflow !== undefined) {
        files.push(plannedFile(
          component,
          `${root}/${rendered.overflow.relativePath}`,
          rendered.overflow.content,
          `ecosystem.skill-overflow.${id}`,
        ));
      }
    }

    for (const command of plugin.commands) {
      const id = commandId(plugin, command, skillIds);
      const root = `.agents/skills/${id}`;
      const rendered = renderBoundedSkill(commandMetadata(command, id), command.body, []);
      files.push(plannedFile(component, `${root}/SKILL.md`, rendered.primary, `ecosystem.command.${id}`));
      if (rendered.overflow !== undefined) {
        files.push(plannedFile(
          component,
          `${root}/${rendered.overflow.relativePath}`,
          rendered.overflow.content,
          `ecosystem.command-overflow.${id}`,
        ));
      }
    }

    for (const agent of plugin.agents) {
      const rendered = renderAgent(plugin, agent);
      files.push(plannedFile(
        component,
        `.codex/agents/${rendered.id}.toml`,
        rendered.content,
        `ecosystem.agent.${rendered.id}`,
      ));
    }
  }

  const upstreamFile = component.treeFiles.find((file) => file.relativePath === "UPSTREAM.json");
  const licenseFile = component.treeFiles.find((file) => file.relativePath === "LICENSE");
  if (licenseFile === undefined) throw catalogError("Portable catalog is missing its upstream LICENSE file.");
  let upstream: unknown = {};
  if (upstreamFile !== undefined) {
    try {
      upstream = JSON.parse(await readTreeText(upstreamFile));
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
  const hooks = plugins.reduce(
    (sum, plugin) => sum + plugin.otherFiles.filter((file) => /(?:^|\/)hooks(?:\/|$)/.test(file.relativePath)).length,
    0,
  );
  files.push(plannedFile(
    component,
    ".forgeyard/catalog/ecosystem.json",
    `${JSON.stringify({
      schemaVersion: 1,
      source: upstream,
      selectedPlugins: plugins.map((plugin) => plugin.name),
      counts,
      unsupported: { hooks },
    }, null, 2)}\n`,
    "ecosystem.catalog-index",
  ));
  files.push(plannedFile(
    component,
    ".forgeyard/licenses/wshobson-agents.LICENSE",
    await readTreeText(licenseFile),
    "ecosystem.license.wshobson-agents",
  ));

  assertUniqueOutputPaths(files);
  return files;
}
