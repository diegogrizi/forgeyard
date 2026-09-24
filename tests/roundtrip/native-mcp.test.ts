import { rm } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 24,2 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
import { buildCli } from "../helpers/cli.js";
import { nativeFixture } from "../helpers/native.js";

const repository = path.resolve(".");
const fixtures: Awaited<ReturnType<typeof nativeFixture>>[] = [];
beforeAll(async () => { await buildCli(repository); }, 60000);
afterEach(async () => { for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true }); });
test("real packaged stdio speaks only MCP and shares the strict JSON CLI contract", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const cli = path.join(repository, "dist/cli/main.js");
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: "forgeyard-offline-sdk-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--root", fixture.root],
    env: { ...environment, LOCALAPPDATA: fixture.stateDirectory }, stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    await client.connect(transport).catch((error: unknown) => { throw new Error(`${String(error)}\n${stderr}`); });
    expect(client.getInstructions()?.slice(0, 512)).toContain("fy_context");
    const tools = await client.listTools(); expect(tools.tools.map((tool) => tool.name)).toContain("fy_finalize");
    expect(tools.tools.some((tool) => /approve|sampling/.test(tool.name))).toBe(false);
    const context = await client.callTool({ name: "fy_context", arguments: { requestId: "read-context", payload: {} } });
    expect(context.structuredContent).toMatchObject({ ok: true, protocolVersion: "0.2",
      result: { capsuleId: expect.stringMatching(/^[a-f0-9]{64}$/), nativeClient: { liveCompatibility: "unverified" } } });
    const invalid = await client.callTool({ name: "fy_verify", arguments: { requestId: "bad-gate", payload: { argv: ["node"] } } });
    expect(invalid).toMatchObject({ isError: true });
    expect(JSON.stringify(invalid)).toContain("FY_PROTOCOL_INVALID");
  } finally { await client.close(); }
  const json = await execa(process.execPath, [cli, "tool", "--root", fixture.root, "--json"], {
    cwd: fixture.root, env: { LOCALAPPDATA: fixture.stateDirectory }, input: JSON.stringify({ protocolVersion: "0.2", requestId: "cli-context", tool: "fy_context", payload: {} }),
    // Cronometrato: questa invocazione costa 16,3 s a freddo e ~4,4 a caldo. Il tetto era
    // 10 s, cioe' sotto il lavoro anche in serie: passava solo perche' la CLI era gia' calda.
    shell: false, reject: false, timeout: 120_000 });
  expect(json.exitCode, json.stderr).toBe(0);
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, protocolVersion: "0.2" });
});
