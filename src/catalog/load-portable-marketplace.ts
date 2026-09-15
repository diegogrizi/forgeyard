import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ComponentTreeFile } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import type {
  PortableAgent,
  PortableCommand,
  PortableDocument,
  PortableMarketplace,
  PortablePlugin,
  PortableSkill,
} from "./contracts.js";
import { parsePortableDocument } from "./frontmatter.js";

export interface PortableMarketplaceOptions {
  defaultLicense: string;
}

interface PluginManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
}

function catalogError(
  message: string,
  paths?: readonly string[],
  components?: readonly string[],
  cause?: unknown,
): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CATALOG_INVALID",
    message,
    remediation: "Correct or exclude the invalid portable plugin component.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
    ...(components === undefined ? {} : { components }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function stringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function portableName(file: ComponentTreeFile, parsed: Readonly<Record<string, unknown>>): string {
  return stringField(parsed.name, path.posix.basename(file.relativePath, path.posix.extname(file.relativePath)));
}

async function portableDocument(file: ComponentTreeFile): Promise<PortableDocument> {
  let content: string;
  try {
    content = await readFile(file.sourcePath, "utf8");
  } catch (error) {
    throw catalogError("Unable to read a portable catalog document.", [file.relativePath], undefined, error);
  }
  const parsed = parsePortableDocument(content, file.relativePath);
  const name = portableName(file, parsed.frontmatter);
  if (name.length === 0) throw catalogError("Portable component name is empty.", [file.relativePath]);
  return {
    name,
    description: stringField(parsed.frontmatter.description),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    source: file,
  };
}

function requireUnique(
  pluginName: string,
  kind: string,
  documents: readonly PortableDocument[],
): void {
  const seen = new Set<string>();
  for (const document of documents) {
    const key = document.name.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw catalogError(
        `Plugin '${pluginName}' declares duplicate ${kind} name '${document.name}'.`,
        [document.source.relativePath],
        [`${pluginName}:${document.name}`],
      );
    }
    seen.add(key);
  }
}

async function readManifest(file: ComponentTreeFile): Promise<PluginManifest> {
  try {
    const parsed = JSON.parse(await readFile(file.sourcePath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("manifest is not an object");
    }
    return parsed as PluginManifest;
  } catch (error) {
    throw catalogError("Portable plugin manifest is not valid JSON.", [file.relativePath], undefined, error);
  }
}

function directMarkdown(files: readonly ComponentTreeFile[], directory: string): ComponentTreeFile[] {
  const prefix = `${directory}/`;
  return files
    .filter((file) => file.relativePath.startsWith(prefix))
    .filter((file) => !file.relativePath.slice(prefix.length).includes("/"))
    .filter((file) => file.relativePath.toLocaleLowerCase("en-US").endsWith(".md"))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
}

async function loadPlugin(
  pluginDirectory: string,
  files: readonly ComponentTreeFile[],
  defaultLicense: string,
): Promise<PortablePlugin> {
  const prefix = `plugins/${pluginDirectory}/`;
  const pluginFiles = files.filter((file) => file.relativePath.startsWith(prefix));
  const manifestFiles = pluginFiles
    .filter((file) => /^plugins\/[^/]+\/\.(?:claude-plugin|codex-plugin)\/plugin\.json$/.test(file.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  const primaryManifest = manifestFiles.find((file) => file.relativePath.includes("/.claude-plugin/"));
  if (primaryManifest === undefined) {
    throw catalogError(`Plugin '${pluginDirectory}' is missing .claude-plugin/plugin.json.`, [prefix]);
  }
  const manifest = await readManifest(primaryManifest);
  const name = stringField(manifest.name);
  if (name !== pluginDirectory) {
    throw catalogError(
      `Plugin manifest name '${name}' does not match directory '${pluginDirectory}'.`,
      [primaryManifest.relativePath],
    );
  }

  const agentDocuments = await Promise.all(
    directMarkdown(pluginFiles, `${prefix}agents`).map((file) => portableDocument(file)),
  );
  const agents: PortableAgent[] = agentDocuments.map((document) => ({
    ...document,
    model: stringField(document.frontmatter.model) || undefined,
    tools: stringList(document.frontmatter.tools),
  }));

  const commandDocuments = await Promise.all(
    directMarkdown(pluginFiles, `${prefix}commands`).map((file) => portableDocument(file)),
  );
  const commands: PortableCommand[] = commandDocuments.map((document) => ({
    ...document,
    argumentHint: stringField(document.frontmatter["argument-hint"]) || undefined,
  }));

  const skillFiles = pluginFiles
    .filter((file) => /^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(file.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  const skills: PortableSkill[] = await Promise.all(
    skillFiles.map(async (file) => {
      const document = await portableDocument(file);
      const skillRoot = `${path.posix.dirname(file.relativePath)}/`;
      const supportingFiles = pluginFiles
        .filter((candidate) => candidate.relativePath.startsWith(skillRoot) && candidate.relativePath !== file.relativePath)
        .map((candidate) => ({
          ...candidate,
          relativeToSkill: candidate.relativePath.slice(skillRoot.length),
        }))
        .sort((left, right) => left.relativeToSkill.localeCompare(right.relativeToSkill, "en"));
      return { ...document, supportingFiles };
    }),
  );

  requireUnique(name, "agent", agents);
  requireUnique(name, "skill", skills);
  requireUnique(name, "command", commands);

  const categorized = new Set([
    ...manifestFiles.map((file) => file.relativePath),
    ...agents.map((document) => document.source.relativePath),
    ...commands.map((document) => document.source.relativePath),
    ...skills.flatMap((document) => [document.source.relativePath, ...document.supportingFiles.map((file) => file.relativePath)]),
  ]);
  const otherFiles = pluginFiles
    .filter((file) => !categorized.has(file.relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));

  return {
    name,
    version: stringField(manifest.version, "0.0.0"),
    description: stringField(manifest.description),
    license: stringField(manifest.license, defaultLicense),
    directory: prefix.slice(0, -1),
    manifests: manifestFiles,
    agents,
    skills,
    commands,
    otherFiles,
  };
}

export async function loadPortableMarketplace(
  files: readonly ComponentTreeFile[],
  options: PortableMarketplaceOptions,
): Promise<PortableMarketplace> {
  const pluginNames = [...new Set(
    files
      .map((file) => /^plugins\/([^/]+)\//.exec(file.relativePath)?.[1])
      .filter((name): name is string => name !== undefined),
  )].sort((left, right) => left.localeCompare(right, "en"));
  const plugins = await Promise.all(
    pluginNames.map((pluginName) => loadPlugin(pluginName, files, options.defaultLicense)),
  );
  const allPluginFiles = files.filter((file) => file.relativePath.startsWith("plugins/"));
  const counts = {
    plugins: plugins.length,
    agents: plugins.reduce((sum, plugin) => sum + plugin.agents.length, 0),
    skills: plugins.reduce((sum, plugin) => sum + plugin.skills.length, 0),
    commands: plugins.reduce((sum, plugin) => sum + plugin.commands.length, 0),
    supportingFiles: plugins.reduce(
      (sum, plugin) => sum + plugin.skills.reduce((inner, skill) => inner + skill.supportingFiles.length, 0),
      0,
    ),
    manifestFiles: plugins.reduce((sum, plugin) => sum + plugin.manifests.length, 0),
    otherFiles: plugins.reduce((sum, plugin) => sum + plugin.otherFiles.length, 0),
  };
  const categorizedFileCount =
    counts.agents + counts.skills + counts.commands + counts.supportingFiles + counts.manifestFiles + counts.otherFiles;
  if (categorizedFileCount !== allPluginFiles.length) {
    throw catalogError(
      `Portable catalog classification lost files: classified ${categorizedFileCount}, observed ${allPluginFiles.length}.`,
    );
  }
  return { plugins, counts };
}
