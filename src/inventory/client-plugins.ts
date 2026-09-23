import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * What a client says it has already installed. Forgeyard reads this file and never writes it:
 * it belongs to the client, and its shape is the client's to change. Every failure to read it
 * degrades to `observed: false` rather than throwing, because a preparation must not fail over
 * a foreign file, and an inventory nobody could read is not an inventory of nothing.
 */
export type PluginScope = "user" | "local" | "project";

export interface InstalledPlugin {
  id: string;
  marketplace: string;
  scope: PluginScope;
  /** The project this installation is bound to; null when it is available user-wide. */
  projectPath: string | null;
  version: string;
  gitCommitSha: string;
}

export interface ClientInventory {
  plugins: readonly InstalledPlugin[];
  /** False when the registry could not be read: absence of observation, not observation of absence. */
  observed: boolean;
  /** What could not be read, named by registry key only: a project path is personal. */
  limitations: readonly string[];
}

const SCOPES: ReadonlySet<string> = new Set<PluginScope>(["user", "local", "project"]);

const UNOBSERVED = (reason: string): ClientInventory => ({ plugins: [], observed: false, limitations: [reason] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Split `<plugin>@<marketplace>`. A key without exactly one separator is not an identity. */
function splitKey(key: string): { id: string; marketplace: string } | undefined {
  const parts = key.split("@");
  if (parts.length !== 2) return undefined;
  const [id, marketplace] = parts;
  return id && marketplace ? { id, marketplace } : undefined;
}

function readEntry(
  identity: { id: string; marketplace: string },
  source: unknown,
): InstalledPlugin | undefined {
  if (!isRecord(source)) return undefined;
  const scope = text(source.scope);
  const version = text(source.version);
  const gitCommitSha = text(source.gitCommitSha);
  if (scope === undefined || !SCOPES.has(scope) || version === undefined || gitCommitSha === undefined) {
    return undefined;
  }
  const projectPath = text(source.projectPath);
  return {
    ...identity,
    scope: scope as PluginScope,
    projectPath: projectPath === undefined ? null : path.resolve(projectPath),
    version,
    gitCommitSha,
  };
}

/**
 * Parse the client's registry. Pure: no I/O, no clock. A single unreadable entry is skipped and
 * declared rather than discarding the entries beside it, because a partial inventory that says
 * what it missed is worth more than none.
 */
export function parseInstalledPlugins(source: unknown): ClientInventory {
  if (!isRecord(source)) return UNOBSERVED("the plugin registry is not a JSON object");
  const registry = source.plugins;
  if (!isRecord(registry)) return UNOBSERVED("the plugin registry has no readable 'plugins' map");
  const keys = Object.keys(registry);
  if (keys.length === 0) return UNOBSERVED("the plugin registry lists no plugin");

  const plugins: InstalledPlugin[] = [];
  const limitations: string[] = [];
  for (const key of keys) {
    const identity = splitKey(key);
    if (identity === undefined) {
      limitations.push(`${key}: not a '<plugin>@<marketplace>' key`);
      continue;
    }
    const entries = registry[key];
    if (!Array.isArray(entries) || entries.length === 0) {
      limitations.push(`${key}: no readable installation entry`);
      continue;
    }
    const read = entries.map((entry) => readEntry(identity, entry)).filter((entry) => entry !== undefined);
    if (read.length !== entries.length) limitations.push(`${key}: unreadable installation entry`);
    plugins.push(...read);
  }

  // Ordered so two reads of one machine produce one inventory, and a report of it is quotable.
  plugins.sort((left, right) =>
    left.id.localeCompare(right.id, "en") ||
    left.marketplace.localeCompare(right.marketplace, "en") ||
    left.scope.localeCompare(right.scope, "en") ||
    (left.projectPath ?? "").localeCompare(right.projectPath ?? "", "en"));
  return { plugins, observed: true, limitations: limitations.sort((a, b) => a.localeCompare(b, "en")) };
}

/** Windows compares paths without case; nothing else about them is normalised here. */
function samePath(left: string, right: string): boolean {
  const key = (value: string) => process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
  return key(path.resolve(left)) === key(path.resolve(right));
}

/**
 * Which installations actually apply to this project. A `user` installation applies everywhere;
 * a `local` or `project` one applies only to the project it names. Treating a plugin bound to
 * another project as available here would be an inference presented as an observation — and the
 * registry states the binding plainly, so there is no need to guess.
 */
export function partitionForProject(inventory: ClientInventory, projectRoot: string): {
  available: readonly InstalledPlugin[];
  boundElsewhere: readonly InstalledPlugin[];
} {
  const available: InstalledPlugin[] = [];
  const boundElsewhere: InstalledPlugin[] = [];
  for (const plugin of inventory.plugins) {
    const applies = plugin.scope === "user"
      ? plugin.projectPath === null || samePath(plugin.projectPath, projectRoot)
      : plugin.projectPath !== null && samePath(plugin.projectPath, projectRoot);
    (applies ? available : boundElsewhere).push(plugin);
  }
  return { available, boundElsewhere };
}

/** Where Claude Code keeps the registry. Injectable so a test never reads the real machine. */
export function claudePluginRegistryPath(home = os.homedir()): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

/**
 * Read-only, bounded, and silent on failure by design: the caller receives an inventory that
 * declares what it could not see instead of an exception that stops a preparation.
 */
export async function readClientInventory(home = os.homedir()): Promise<ClientInventory> {
  let source: string;
  try {
    source = await readFile(claudePluginRegistryPath(home), "utf8");
  } catch {
    return UNOBSERVED("the client's plugin registry could not be read on this machine");
  }
  if (source.length > 4_194_304) return UNOBSERVED("the client's plugin registry exceeds the bounded read limit");
  try {
    return parseInstalledPlugins(JSON.parse(source));
  } catch {
    return UNOBSERVED("the client's plugin registry is not valid JSON");
  }
}
