import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { runWorkspaceCli } from "../../../src/workspace/cli.js";

async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-cli-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function invoke(args: string[]) {
  let stdout = ""; let stderr = "";
  const exitCode = await runWorkspaceCli(args, {
    writeOut: (text) => { stdout += text; }, writeErr: (text) => { stderr += text; },
  });
  return { exitCode, stdout, stderr };
}

test("analizza espone un aiuto italiano senza richiedere un progetto", async () => {
  const result = await invoke(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /forgeyard analizza/);
  assert.match(result.stdout, /sola lettura/);
  assert.equal(result.stderr, "");
});

test("analizza emette la topologia JSON senza creare file", async () => temporary(async (root) => {
  const result = await invoke([root, "--json"]);
  assert.equal(result.exitCode, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.workspace.root, root);
  assert.equal(json.workspace.kind, "empty");
  assert.equal(result.stderr, "");
  assert.deepEqual(await readdir(root), []);
}));

test("analizza descrive in italiano i progetti osservati senza chiamarli una suite installata", async () => temporary(async (root) => {
  await mkdir(path.join(root, "web"));
  await writeFile(path.join(root, "web/package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  const result = await invoke([root]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Progetti rilevati: 1/);
  assert.match(result.stdout, /react/);
  assert.match(result.stdout, /Nessun file modificato/);
  assert.match(result.stdout, /non installa/);
}));

test("analizza rifiuta opzioni sconosciute e piu cartelle", async () => {
  assert.equal((await invoke(["--installa"])).exitCode, 2);
  assert.equal((await invoke(["uno", "due"])).exitCode, 2);
  assert.match((await invoke(["--installa"])).stderr, /Argomenti non validi/);
});

test("un errore JSON ha codice stabile e non mescola testo umano su stdout", async () => temporary(async (root) => {
  const result = await invoke([path.join(root, "assente"), "--json"]);
  assert.equal(result.exitCode, 4);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: {
    code: "FY_WORKSPACE_ROOT", message: "Seleziona una cartella esistente, non un file o un collegamento simbolico.",
  } });
}));

test("un limite di copertura rimane visibile nel testo italiano", async () => temporary(async (root) => {
  await writeFile(path.join(root, "package.json"), "not-json");
  const result = await invoke([root]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Scansione: parziale/);
  assert.match(result.stdout, /manifest non valido/);
}));

test("il separatore esplicito delle opzioni viene accettato", async () => temporary(async (root) => {
  const result = await invoke(["--json", "--", root]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).workspace.root, root);
}));
