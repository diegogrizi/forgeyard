import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 5,9 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
import { buildCli, runBuiltCli } from "../helpers/cli.js";

const repository = path.resolve(".");
const execute = promisify(execFile);
beforeAll(async () => { await buildCli(repository); }, 60000);

async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-roundtrip-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("il binario installabile analizza la cartella corrente con due repository senza scrivere", async () => temporary(async (root) => {
  for (const child of ["api", "web"]) {
    await mkdir(path.join(root, child));
    await execute("git", ["-C", path.join(root, child), "init", "-b", "main"]);
  }
  await writeFile(path.join(root, "api/pom.xml"), "<project>org.springframework.boot</project>");
  await writeFile(path.join(root, "web/package.json"), JSON.stringify({ dependencies: { "@angular/core": "20" } }));
  const before = await readdir(root);
  const result = await runBuiltCli(repository, ["analizza", "--json"], root);
  assert.equal(result.exitCode, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.workspace.kind, "multi-repository");
  assert.deepEqual(json.workspace.repositories.map((item: {path: string}) => item.path), ["api", "web"]);
  assert.equal(json.workspace.root, root);
  assert.deepEqual(await readdir(root), before);
  assert.deepEqual(await readdir(path.join(root, "api")), [".git", "pom.xml"]);
  assert.deepEqual(await readdir(path.join(root, "web")), [".git", "package.json"]);
}));

test("l'aiuto italiano e gli errori del nuovo comando passano dal binario reale", async () => temporary(async (root) => {
  const help = await runBuiltCli(repository, ["analizza", "--help"], root);
  assert.equal(help.exitCode, 0, help.stderr);
  assert.match(help.stdout, /sola lettura/);
  const invalid = await runBuiltCli(repository, ["analizza", "--installa", "--json"], root);
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, "FY_WORKSPACE_ARGUMENTS");
  assert.deepEqual(await readdir(root), []);
}));
