import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { connectNativeClient, disconnectNativeClient } from "../../../src/native/bindings.js";
import { nativeFixture } from "../../helpers/native.js";
// Ogni prova di questo file installa un'imbracatura reale: caricamento del registro,
// rendering, applicazione transazionale e comandi Git veri. Il tetto globale di 30 secondi
// è tarato sui test unitari, e un tetto più stretto del lavoro che delimita segnala un
// difetto che non c'e'.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const fixtures: Awaited<ReturnType<typeof nativeFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true }); });
async function setup() {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const cliPath = path.join(fixture.directory, "cli.mjs"); await writeFile(cliPath, "// fixture CLI path, not an AI client\n");
  return { ...fixture, cliPath };
}
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
