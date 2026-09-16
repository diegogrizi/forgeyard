import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { parse as parseToml } from "smol-toml";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { assertDirectoryChain, atomicText, optionalText } from "./files.js";
import { workspaceIdentity } from "./workspace.js";
import { nativeError } from "./store.js";

export type NativeClient = "codex" | "claude-code";
export interface BindingInput { root: string; client: NativeClient; stateDirectory?: string; cliPath?: string }
interface Entry { target: string; original: string | null; installed: string; kind: "block" | "json"; block?: string; namespaceSha256?: string; restored?: string | null }
interface Binding { schemaVersion: 1; root: string; client: NativeClient; phase: "prepared" | "connected" | "disconnecting"; entries: Entry[] }

export function defaultNativeStateDirectory(): string {
  return path.resolve(path.join(process.env.LOCALAPPDATA ?? (process.platform === "win32" ?
    path.join(os.homedir(), "AppData/Local") : path.join(os.homedir(), ".local/state")), "Forgeyard"));
}
const block = (prefix: string, content: string) => `\n${prefix} Forgeyard native binding begin\n${content}\n${prefix} Forgeyard native binding end\n`;

async function inputs(input: BindingInput) {
  const identity = await workspaceIdentity(input.root);
  const directory = path.resolve(input.stateDirectory ?? defaultNativeStateDirectory());
  const within = (parent: string, target: string) => {
    const relative = path.relative(parent, target);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  if (within(identity.root, directory) || (identity.commonDirectory && within(identity.commonDirectory, directory)))
    throw nativeError("FY_STATE_UNSAFE", "Local binding ownership must remain outside the project.");
  await assertDirectoryChain(directory, true);
  let metadata = path.join(directory, identity.id, `${input.client}-bindings.json`);
  let text = await optionalText(metadata);
  // Bootstrap connection can precede Git initialization. Preserve its exact
  // ownership record instead of treating its namespace as a foreign collision.
  if (text === null && identity.commonDirectory) {
    const bootstrapId = sha256Text(canonicalJson({ root: identity.root, commonDirectory: null }));
    const bootstrapMetadata = path.join(directory, bootstrapId, `${input.client}-bindings.json`);
    const bootstrapText = await optionalText(bootstrapMetadata);
    if (bootstrapText !== null) { metadata = bootstrapMetadata; text = bootstrapText; }
  }
  let binding: Binding | null = null;
  if (text) {
    try {
      binding = JSON.parse(text) as Binding;
      const allowed = new Set([path.join(identity.root, input.client === "codex" ? ".codex/config.toml" : ".mcp.json"),
        path.join(identity.root, input.client === "codex" ? "AGENTS.md" : "CLAUDE.md"), path.join(identity.root, ".gitignore"),
        ...(identity.commonDirectory ? [path.join(identity.commonDirectory, "info/exclude")] : [])]);
      if (binding.schemaVersion !== 1 || binding.root !== identity.root || binding.client !== input.client ||
        !["prepared", "connected", "disconnecting"].includes(binding.phase) || !Array.isArray(binding.entries) ||
        binding.entries.length < 1 || binding.entries.length > 4 ||
        new Set(binding.entries.map((entry) => entry.target)).size !== binding.entries.length || binding.entries.some((entry) =>
          !allowed.has(entry.target) || (entry.original !== null && typeof entry.original !== "string") ||
          typeof entry.installed !== "string" || !["block", "json"].includes(entry.kind) ||
          (binding!.phase === "disconnecting" && entry.restored !== null && typeof entry.restored !== "string") ||
          (entry.kind === "block" && (typeof entry.block !== "string" || !entry.block.includes("Forgeyard") ||
            entry.installed !== (entry.original ?? "") + entry.block)) ||
          (entry.kind === "json" && entry.namespaceSha256 !== sha256Text(canonicalJson((JSON.parse(entry.installed) as
            { mcpServers?: Record<string, unknown> }).mcpServers?.forgeyard))))) throw new Error("Invalid binding");
    } catch { throw nativeError("FY_BINDING_INVALID", "Local ownership metadata is malformed or contains an unauthorized target. No file was modified."); }
  }
  return { identity, metadata, text, binding };
}
async function ownedEntries(binding: Binding): Promise<void> {
  for (const entry of binding.entries) {
    const current = await optionalText(entry.target);
    if (current === entry.installed || (binding.phase === "prepared" && current === entry.original) ||
      (binding.phase === "disconnecting" && current === entry.restored)) continue;
    if (entry.kind === "block" && current !== null && entry.block && current.includes(entry.block)) continue;
    if (entry.kind === "json" && current !== null) {
      const parsed = JSON.parse(current) as { mcpServers?: Record<string, unknown> };
      if (sha256Text(canonicalJson(parsed.mcpServers?.forgeyard)) === entry.namespaceSha256) continue;
    }
    throw nativeError("FY_BINDING_DRIFT", "An owned native namespace/block changed. It is preserved; no foreign settings are overwritten.");
  }
}

export async function connectNativeClient(input: BindingInput): Promise<Record<string, unknown>> {
  const { identity, metadata, text, binding } = await inputs(input);
  if (binding) {
    if (binding.phase === "disconnecting") throw nativeError("FY_BINDING_RECOVERY_REQUIRED", "Finish the interrupted owned disconnect before reconnecting.");
    if (binding.root !== identity.root || binding.client !== input.client) throw nativeError("FY_BINDING_DRIFT", "Local ownership belongs to a different connection.");
    await ownedEntries(binding);
    if (binding.phase === "prepared") {
      for (const entry of binding.entries) if (await optionalText(entry.target) === entry.original)
        await atomicText(entry.target, entry.installed, entry.original === null ? null : sha256Text(entry.original));
      binding.phase = "connected"; await atomicText(metadata, `${canonicalJson(binding)}\n`, sha256Text(text!));
    }
    return { connected: true, changed: false, client: input.client, liveClientCompatibility: "unverified" };
  }
  // In a bundle import.meta.url is dist/cli/main.js; source callers pass cliPath.
  const cliPath = path.resolve(input.cliPath ?? fileURLToPath(import.meta.url));
  const serverConfig = { command: process.execPath, args: [cliPath, "mcp", "--root", identity.root, "--client", input.client] };
  const entries: Entry[] = [];
  const configTarget = resolveInsideRoot(identity.root, input.client === "codex" ? ".codex/config.toml" : ".mcp.json");
  const original = await optionalText(configTarget);
  if (input.client === "codex") {
    const parsed = original === null ? {} : parseToml(original);
    const servers = parsed.mcp_servers as Record<string, unknown> | undefined;
    if (servers?.forgeyard !== undefined || original?.includes("Forgeyard native binding begin"))
      throw nativeError("FY_NAMESPACE_CONFLICT", "The Codex Forgeyard namespace is already owned by another configuration.");
    const content = block("#", `[mcp_servers.forgeyard]\ncommand = ${JSON.stringify(serverConfig.command.replaceAll("\\", "/"))}\nargs = ${JSON.stringify(serverConfig.args.map((value) => value.replaceAll("\\", "/")))}\ncwd = ${JSON.stringify(identity.root.replaceAll("\\", "/"))}\nstartup_timeout_sec = 15\ntool_timeout_sec = 330`);
    parseToml((original ?? "") + content);
    entries.push({ target: configTarget, original, installed: (original ?? "") + content, kind: "block", block: content });
  } else {
    const parsed = original === null ? {} : JSON.parse(original) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed.mcpServers !== undefined &&
      (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers))))
      throw nativeError("FY_BINDING_INVALID", "The project MCP configuration is invalid; no foreign data is replaced.");
    const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
    if (servers.forgeyard !== undefined) throw nativeError("FY_NAMESPACE_CONFLICT", "The Claude Forgeyard MCP namespace is already owned by another configuration.");
    entries.push({ target: configTarget, original, installed: `${JSON.stringify({ ...parsed, mcpServers: { ...servers, forgeyard: { type: "stdio", ...serverConfig } } }, null, 2)}\n`,
      kind: "json", namespaceSha256: sha256Text(canonicalJson({ type: "stdio", ...serverConfig })) });
  }
  const instructionsTarget = resolveInsideRoot(identity.root, input.client === "codex" ? "AGENTS.md" : "CLAUDE.md");
  const instructions = await optionalText(instructionsTarget);
  let factoryOwned = false;
  const manifest = await optionalText(resolveInsideRoot(identity.root, ".forgeyard/manifest.json"));
  if (manifest) factoryOwned = (JSON.parse(manifest) as { files: { path: string; ownership: string }[] }).files
    .some((file) => file.path === path.basename(instructionsTarget) && file.ownership === "managed");
  if (!factoryOwned) {
    if (instructions?.includes("Forgeyard native binding begin")) throw nativeError("FY_NAMESPACE_CONFLICT", "An instruction binding block has no matching local ownership.");
    const pointer = block("<!--", "Use Forgeyard for project work. Start with fy_context; inspect/prepare if unconfigured, then fy_plan for each new request.\n" +
      "Read the project-installed forgeyard-workflow skill when present. Preserve existing conventions. Never self-approve or claim delivery without fy_finalize.\n" +
      "If the tools are unavailable, use the installed forgeyard tool JSON fallback; do not invent a successful tool result.");
    // Use valid standalone HTML-comment markers for Markdown.
    const validPointer = pointer.replaceAll("<!-- Forgeyard native binding begin", "<!-- Forgeyard native binding begin -->")
      .replaceAll("<!-- Forgeyard native binding end", "<!-- Forgeyard native binding end -->");
    entries.push({ target: instructionsTarget, original: instructions, installed: (instructions ?? "") + validPointer, kind: "block", block: validPointer });
  }
  // Machine paths/configurations are not part of the portable capsule. Only
  // untracked project configs can be excluded; already tracked files are refused.
  if (identity.commonDirectory !== null) {
    const relativeConfig = path.relative(identity.root, configTarget).replaceAll("\\", "/");
    const tracked = await execa("git", ["ls-files", "--error-unmatch", "--", relativeConfig], { cwd: identity.root, reject: false, shell: false, stdin: "ignore" });
    if (tracked.exitCode === 0) throw nativeError("FY_BINDING_TRACKED", "This native config is already tracked. Forgeyard will not commit machine paths into it or untrack foreign settings. Use the JSON fallback or a deliberately untracked project config.");
    const excludeResult = await execa("git", ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { cwd: identity.root, shell: false, stdin: "ignore" });
    const excludeTarget = path.resolve(excludeResult.stdout.trim());
    if (!excludeTarget.startsWith(identity.commonDirectory + path.sep)) throw nativeError("FY_PATH_UNSAFE", "Git exclude is outside the authorized common Git directory.");
    const exclude = await optionalText(excludeTarget);
    const exclusion = `\n# Forgeyard machine binding ${randomUUID()}\n/${relativeConfig}\n`;
    entries.push({ target: excludeTarget, original: exclude, installed: (exclude ?? "") + exclusion, kind: "block", block: exclusion });
  } else {
    const ignoreTarget = resolveInsideRoot(identity.root, ".gitignore");
    const ignore = await optionalText(ignoreTarget);
    const exclusion = block("#", `/${path.relative(identity.root, configTarget).replaceAll("\\", "/")}`);
    entries.push({ target: ignoreTarget, original: ignore, installed: (ignore ?? "") + exclusion, kind: "block", block: exclusion });
  }
  const proposed: Binding = { schemaVersion: 1, root: identity.root, client: input.client, phase: "prepared", entries };
  await atomicText(metadata, `${canonicalJson(proposed)}\n`, null);
  for (const entry of entries) await atomicText(entry.target, entry.installed, entry.original === null ? null : sha256Text(entry.original));
  proposed.phase = "connected"; const staged = await optionalText(metadata);
  await atomicText(metadata, `${canonicalJson(proposed)}\n`, sha256Text(staged!));
  return { connected: true, changed: true, client: input.client, files: entries.map((entry) => entry.target),
    liveClientCompatibility: "unverified", next: "Trust/enable the project MCP server through your native client's UI if required, then reopen this project. No global settings or trust policy were changed." };
}

export async function disconnectNativeClient(input: BindingInput): Promise<Record<string, unknown>> {
  const { metadata, binding, text } = await inputs(input);
  if (!binding) return { connected: false, changed: false };
  await ownedEntries(binding);
  if (binding.phase !== "disconnecting") {
    for (const entry of binding.entries) {
      const current = await optionalText(entry.target); entry.restored = entry.original;
      if (current !== entry.installed && current !== entry.original && current !== null) {
        if (entry.kind === "block") entry.restored = current.replace(entry.block!, "");
        else { const parsed = JSON.parse(current) as { mcpServers: Record<string, unknown> }; delete parsed.mcpServers.forgeyard; entry.restored = `${JSON.stringify(parsed, null, 2)}\n`; }
      }
    }
    binding.phase = "disconnecting";
    await atomicText(metadata, `${canonicalJson(binding)}\n`, sha256Text(text!));
  }
  for (const entry of [...binding.entries].reverse()) {
    const current = await optionalText(entry.target);
    if (current === entry.restored) continue;
    if (entry.restored === null) await unlink(entry.target);
    else await atomicText(entry.target, entry.restored!, sha256Text(current!));
  }
  await unlink(metadata);
  return { connected: false, changed: true, removed: "only unchanged owned namespaces/blocks; project harness and foreign settings retained" };
}
