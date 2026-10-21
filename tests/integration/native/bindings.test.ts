import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { connectNativeClient, disconnectNativeClient } from "../../../src/native/bindings.js";
import { git, nativeFixture } from "../../helpers/native.js";
import { projectNativeBinding, runPersonalEntry } from "../../../src/workspace/entry.js";
import type { PromptDriver } from "../../../src/config/wizard.js";
// Ogni prova di questo file installa un'imbracatura reale: caricamento del registro,
// rendering, applicazione transazionale e comandi Git veri. Prova piu' lenta, cronometrata
// su questa macchina a riposo: 11,4 s. Il tetto globale di 30 s e' tarato sui test unitari,
// e un tetto piu' stretto del lavoro che delimita segnala un difetto che non c'e'.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const fixtures: Awaited<ReturnType<typeof nativeFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true }); });
async function setup() {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const cliPath = path.join(fixture.directory, "cli.mjs"); await writeFile(cliPath, "// fixture CLI path, not an AI client\n");
  return { ...fixture, cliPath };
}
test.each([false, true])("personal setup excludes only created harness files, not user files (existing seed: %s)", async (existingSeed) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-personal-binding-"));
  const root = await realpath(await mkdir(path.join(directory, "project"), { recursive: true }).then(() => path.join(directory, "project")));
  const fixture = { directory, root, stateDirectory: path.join(directory, "state") }; fixtures.push(fixture);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/name.mjs"), "export const name = 'Ada';\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "personal-binding", scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "AGENTS.md"), "# Existing project conventions\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "add", "--all"]);
  await git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Product baseline"]);
  await mkdir(path.join(root, ".agents/skills/foreign"), { recursive: true });
  await writeFile(path.join(root, ".agents/skills/foreign/SKILL.md"), "User-owned skill\n");
  if (existingSeed) await writeFile(path.join(root, "PROJECT.md"), "User-owned project brief\n");
  const prompts: PromptDriver = {
    input: async () => "Correct the name normalizer", confirm: async () => true,
    select: async () => { throw new Error("No ecosystem questions"); },
    number: async () => { throw new Error("No ecosystem questions"); },
  };
  let preview = "";
  expect(await runPersonalEntry(root, { interactive: true, prompts, commandLookup: async () => false,
    io: { writeOut: (text) => { preview += text; }, writeErr: (text) => { preview += text; } },
    native: { observe: projectNativeBinding.observe, connect: async ({ client }) => { await connectNativeClient({ ...fixture, client }); } },
  }), preview).toBe(0);
  const status = (await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
  expect(status).not.toContain("?? .agents/skills/forgeyard-workflow/");
  expect(status).not.toContain("?? .codex/agents/");
  expect(status).not.toContain("?? forgeyard.yaml");
  expect(status).not.toContain("?? forgeyard.lock");
  expect(status.includes("?? PROJECT.md")).toBe(existingSeed);
  expect(status).toContain("?? .agents/skills/foreign/SKILL.md");
  expect(status).toContain(" M AGENTS.md");
  expect(preview).toContain("file dell'imbracatura creati e non tracciati");
  expect(preview).toContain("file generati in .agents/skills/");
  await disconnectNativeClient({ ...fixture, client: "codex" });
  const disconnected = (await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
  expect(disconnected).toContain("?? forgeyard.lock");
  expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("# Existing project conventions\n");
});
test("Codex binding preserves foreign TOML bytes, is idempotent and disconnects its own block", async () => {
  const fixture = await setup();
  const config = path.join(fixture.root, ".codex/config.toml");
  const foreign = '# Keep this comment\nmodel = "configured-by-user"\n';
  await writeFile(config, foreign);
  await connectNativeClient({ ...fixture, client: "codex" });
  const connected = await readFile(config, "utf8"); expect(connected.startsWith(foreign)).toBe(true);
  expect(connected).toContain("[mcp_servers.forgeyard]");
  await connectNativeClient({ ...fixture, client: "codex" }); expect(await readFile(config, "utf8")).toBe(connected);
  await disconnectNativeClient({ ...fixture, client: "codex" }); expect(await readFile(config, "utf8")).toBe(foreign);
});
test("personal exclusions refuse shared worktrees instead of hiding a peer's foreign file", async () => {
  const fixture = await setup();
  await git(fixture.root, ["rm", "--cached", "--", "forgeyard.lock"]);
  await git(fixture.root, ["commit", "-m", "Keep the harness lock local"]);
  const peer = path.join(fixture.directory, "peer");
  await git(fixture.root, ["worktree", "add", "--detach", peer, "HEAD"]);
  try {
    await writeFile(path.join(peer, "forgeyard.lock"), "Foreign lock owned by the peer\n");
    const before = (await git(peer, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    const exclude = await readFile(path.join(fixture.root, ".git/info/exclude"), "utf8");
    await expect(connectNativeClient({ ...fixture, client: "codex" }))
      .rejects.toMatchObject({ code: "FY_PRIVACY_SCOPE" });
    expect((await git(peer, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout).toBe(before);
    expect(before).toContain("?? forgeyard.lock");
    expect(await readFile(path.join(fixture.root, ".git/info/exclude"), "utf8")).toBe(exclude);
    await expect(readFile(path.join(fixture.root, ".codex/config.toml"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await unlink(path.join(peer, "forgeyard.lock"));
    await git(fixture.root, ["worktree", "remove", peer]);
  }
  expect((await git(fixture.root, ["worktree", "list", "--porcelain"])).stdout.match(/^worktree /gm)).toHaveLength(1);
});
test("Claude binding preserves foreign MCP namespaces and refuses a foreign Forgeyard namespace", async () => {
  const fixture = await setup(); const config = path.join(fixture.root, ".mcp.json");
  await writeFile(config, JSON.stringify({ mcpServers: { existing: { command: "company-approved-tool" } } }));
  await connectNativeClient({ ...fixture, client: "claude-code" });
  expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({ mcpServers: { existing: { command: "company-approved-tool" }, forgeyard: expect.any(Object) } });
  await disconnectNativeClient({ ...fixture, client: "claude-code" });
  await writeFile(config, JSON.stringify({ mcpServers: { forgeyard: { command: "foreign" } } }));
  await expect(connectNativeClient({ ...fixture, client: "claude-code" })).rejects.toMatchObject({ code: "FY_NAMESPACE_CONFLICT" });
});
test("existing user instructions gain an owned pointer without losing their contents", async () => {
  const fixture = await setup();
  // A pre-existing user instruction surface, unlike this fixture's factory-owned AGENTS.
  const instructions = path.join(fixture.root, "CLAUDE.md"); const foreign = "# My conventions\nNever change public APIs.\n";
  await writeFile(instructions, foreign);
  await connectNativeClient({ ...fixture, client: "claude-code" });
  expect((await readFile(instructions, "utf8")).startsWith(foreign)).toBe(true);
  expect(await readFile(instructions, "utf8")).toContain("fy_context");
  await disconnectNativeClient({ ...fixture, client: "claude-code" }); expect(await readFile(instructions, "utf8")).toBe(foreign);
});
test("modified owned bindings are preserved and a symlink directory is not traversed", async () => {
  const fixture = await setup(); await connectNativeClient({ ...fixture, client: "codex" });
  const config = path.join(fixture.root, ".codex/config.toml");
  await writeFile(config, (await readFile(config, "utf8")).replace("tool_timeout_sec = 330", "tool_timeout_sec = 600"));
  await expect(disconnectNativeClient({ ...fixture, client: "codex" })).rejects.toMatchObject({ code: "FY_BINDING_DRIFT" });
  await mkdir(path.join(fixture.root, "unrelated"));
});
