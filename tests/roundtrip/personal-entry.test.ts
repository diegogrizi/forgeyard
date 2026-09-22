import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, test } from "vitest";
import { buildCli, runBuiltCli } from "../helpers/cli.js";
import { createPersonalWorkspace, inspectPersonalWorkspace } from "../../src/workspace/personal.js";

const repository = path.resolve(".");
beforeAll(async () => { await buildCli(repository); }, 60000);
async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-ingresso-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("il solo comando forgeyard mostra il nuovo ingresso e non scrive senza un terminale interattivo", async () => temporary(async (root) => {
  const result = await runBuiltCli(repository, [], root);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Forgeyard — preparazione personale/);
  assert.match(result.stdout, /anteprima/i);
  assert.deepEqual(await readdir(root), []);
}));

test("l'anteprima dichiara i tre passi dell'ingresso unico, senza prometterne nessuno", async () => temporary(async (root) => {
  const result = await runBuiltCli(repository, [], root);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Passi mancanti: area personale, imbracatura, collegamento nativo\./);
  // Il piano dipende dalla sola domanda che il programma non può dedurre.
  assert.match(result.stdout, /terminale interattivo/);
  assert.doesNotMatch(result.stdout, /Collegamento nativo configurato/);
  assert.doesNotMatch(result.stdout, /Imbracatura installata/);
  assert.deepEqual(await readdir(root), []);
}));

test("un'area registrata senza imbracatura fa riprendere all'ingresso i soli passi mancanti", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  const result = await runBuiltCli(repository, [], root);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Area personale: presente\./);
  assert.match(result.stdout, /Passi mancanti: imbracatura, collegamento nativo\./);
  assert.match(result.stdout, /anteprima/i);
  assert.doesNotMatch(result.stdout, /Imbracatura installata|Collegamento nativo configurato/);
  assert.deepEqual((await readdir(path.join(root, ".forgeyard"))).sort(), [".gitignore", "workspace.json"]);
}));

test("il nuovo ingresso non sovrascrive una cartella della forgia non riconosciuta", async () => temporary(async (root) => {
  await mkdir(path.join(root, ".forgeyard"));
  await writeFile(path.join(root, ".forgeyard/preesistente.txt"), "contenuto da preservare");
  const result = await runBuiltCli(repository, [], root);
  assert.equal(result.exitCode, 4);
  assert.match(result.stderr, /area|cartella/i);
  assert.equal(await readFile(path.join(root, ".forgeyard/preesistente.txt"), "utf8"), "contenuto da preservare");
  assert.deepEqual(await readdir(path.join(root, ".forgeyard")), ["preesistente.txt"]);
}));
