import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, test } from "vitest";
import { buildCli, runBuiltCli } from "../helpers/cli.js";

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

test("il nuovo ingresso non sovrascrive una cartella della forgia non riconosciuta", async () => temporary(async (root) => {
  await mkdir(path.join(root, ".forgeyard"));
  await writeFile(path.join(root, ".forgeyard/preesistente.txt"), "contenuto da preservare");
  const result = await runBuiltCli(repository, [], root);
  assert.equal(result.exitCode, 4);
  assert.match(result.stderr, /area|cartella/i);
  assert.equal(await readFile(path.join(root, ".forgeyard/preesistente.txt"), "utf8"), "contenuto da preservare");
  assert.deepEqual(await readdir(path.join(root, ".forgeyard")), ["preesistente.txt"]);
}));
