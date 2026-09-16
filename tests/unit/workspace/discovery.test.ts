import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { discoverWorkspace } from "../../../src/workspace/discovery.js";

const execute = promisify(execFile);
async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-workspace-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { timeout: 10000 })).stdout.trim();
}
async function repository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await git(root, "init", "-b", "main");
}
async function file(root: string, name: string, text = ""): Promise<void> {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), text);
}
async function initialCommit(root: string): Promise<void> {
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
}

test("riconosce una cartella vuota senza inizializzare Git o installare file", async () => temporary(async (root) => {
  const result = await discoverWorkspace(root);
  assert.equal(result.kind, "empty");
  assert.equal(result.root, root);
  assert.deepEqual(result.repositories, []);
  assert.deepEqual(result.projects, []);
  assert.equal(result.scan.status, "complete");
  assert.deepEqual(await readdir(root), []);
}));

test("riconosce una root Git anche prima del primo commit", async () => temporary(async (root) => {
  await repository(root);
  const before = await git(root, "status", "--porcelain=v1", "--untracked-files=all");
  const result = await discoverWorkspace(root);
  assert.equal(result.kind, "repository");
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0]?.path, ".");
  assert.equal(result.repositories[0]?.kind, "repository");
  assert.equal(await git(root, "status", "--porcelain=v1", "--untracked-files=all"), before);
  await assert.rejects(git(root, "rev-parse", "--verify", "HEAD"));
}));

test("separa repository fratelli e attribuisce i progetti al membro corretto", async () => temporary(async (root) => {
  for (const name of ["servizi/ordini", "web"]) await repository(path.join(root, name));
  await file(root, "servizi/ordini/pom.xml", "<project><groupId>org.springframework.boot</groupId></project>");
  await file(root, "web/package.json", JSON.stringify({ dependencies: { "@angular/core": "20", typescript: "5" } }));
  await file(root, "web/angular.json", "{}");
  const before = await Promise.all(["servizi/ordini", "web"].map((p) => git(path.join(root, p), "status", "--porcelain=v1")));
  const result = await discoverWorkspace(root);
  assert.equal(result.kind, "multi-repository");
  assert.deepEqual(result.repositories.map((r) => r.path), ["servizi/ordini", "web"]);
  assert.equal(result.projects.find((p) => p.path === "web")?.repository, "web");
  assert.ok(result.projects.find((p) => p.path === "web")?.frameworks.includes("angular"));
  assert.ok(result.projects.find((p) => p.path === "servizi/ordini")?.frameworks.includes("spring"));
  assert.equal(result.containingRepository, null);
  assert.deepEqual(await Promise.all(["servizi/ordini", "web"].map((p) => git(path.join(root, p), "status", "--porcelain=v1"))), before);
  assert.equal((await readdir(root)).includes(".git"), false);
  assert.equal((await readdir(root)).includes(".forgeyard"), false);
}));

test("un solo repository figlio non viene confuso con la root del workspace", async () => temporary(async (root) => {
  await repository(path.join(root, "servizio"));
  const result = await discoverWorkspace(root);
  assert.equal(result.kind, "directory");
  assert.deepEqual(result.repositories.map((r) => r.path), ["servizio"]);
  assert.equal(result.root, root);
}));

test("un monorepo puo avere piu progetti senza inventare repository Git", async () => temporary(async (root) => {
  await repository(root);
  await file(root, "package.json", JSON.stringify({ workspaces: ["packages/*"] }));
  await file(root, "packages/ui/package.json", JSON.stringify({ dependencies: { react: "19" }, devDependencies: { typescript: "5" } }));
  await file(root, "native/CMakeLists.txt", "project(example LANGUAGES CXX)");
  const result = await discoverWorkspace(root);
  assert.equal(result.repositories.length, 1);
  assert.deepEqual(result.projects.map((p) => p.path), [".", "native", "packages/ui"]);
  assert.ok(result.projects.every((p) => p.repository === "."));
  assert.ok(result.projects.find((p) => p.path === "packages/ui")?.frameworks.includes("react"));
  assert.ok(result.projects.find((p) => p.path === "native")?.languages.includes("cpp"));
}));

test("un repository annidato prevale sul repository esterno per i propri progetti", async () => temporary(async (root) => {
  await repository(root);
  await repository(path.join(root, "indipendente"));
  await file(root, "indipendente/package.json", "{}");
  const result = await discoverWorkspace(root);
  assert.equal(result.kind, "multi-repository");
  assert.equal(result.projects[0]?.repository, "indipendente");
}));

test("selezionare una sottocartella segnala il Git esterno ma non sposta la root", async () => temporary(async (root) => {
  await repository(root);
  const child = path.join(root, "pacchetto");
  await mkdir(child);
  await file(child, "package.json", "{}");
  const result = await discoverWorkspace(child);
  assert.equal(result.root, child);
  assert.equal(result.containingRepository, root);
  assert.deepEqual(result.repositories, []);
  assert.equal(result.projects[0]?.repository, null);
}));

test("riconosce un linked worktree con .git come file senza richiedere Git alla root padre", async () => temporary(async (root) => {
  const main = path.join(root, "origine");
  const linked = path.join(root, "lavoro");
  await repository(main);
  await initialCommit(main);
  await git(main, "worktree", "add", "-b", "lavoro", linked);
  const result = await discoverWorkspace(linked);
  assert.equal(result.repositories[0]?.kind, "worktree");
  assert.equal(result.repositories[0]?.path, ".");
  assert.notEqual(result.repositories[0]?.gitDirectory, result.repositories[0]?.commonDirectory);
}));

test("riconosce un submodule e non lo scambia per un worktree", async () => temporary(async (root) => {
  const main = path.join(root, "principale");
  const source = path.join(root, "sorgente");
  await repository(main); await repository(source); await initialCommit(source);
  await git(main, "-c", "protocol.file.allow=always", "submodule", "add", source, "moduli/figlio");
  const result = await discoverWorkspace(main);
  assert.equal(result.repositories.find((r) => r.path === "moduli/figlio")?.kind, "submodule");
}));

test("non legge dipendenze, directory private o output generati", async () => temporary(async (root) => {
  for (const directory of ["node_modules", ".forgeyard", ".ssh", "target", "dist"]) {
    await file(root, `${directory}/package.json`, JSON.stringify({ dependencies: { react: "secret-marker" } }));
  }
  await file(root, ".env", "SECRET=never-return-this");
  const result = await discoverWorkspace(root);
  assert.deepEqual(result.projects, []);
  assert.equal(JSON.stringify(result).includes("never-return-this"), false);
  assert.ok(result.scan.excludedDirectories >= 5);
}));

test("la lettura dei manifest non esegue gli script e non restituisce i loro valori", async () => temporary(async (root) => {
  const source = JSON.stringify({ scripts: { preinstall: "do-not-execute-this" }, dependencies: { react: "19" }, privateValue: "not-in-output" });
  await file(root, "package.json", source);
  const result = await discoverWorkspace(root);
  assert.deepEqual(await readdir(root), ["package.json"]);
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), source);
  assert.ok(result.projects[0]?.frameworks.includes("react"));
  assert.equal(JSON.stringify(result).includes("not-in-output"), false);
  assert.equal(JSON.stringify(result).includes("do-not-execute-this"), false);
}));

test("i link simbolici non fanno uscire dalla root selezionata", async () => temporary(async (root) => {
  const selected = path.join(root, "workspace"); const outside = path.join(root, "esterno");
  await mkdir(selected); await file(outside, "package.json", "{}");
  await symlink(outside, path.join(selected, "collegamento"), process.platform === "win32" ? "junction" : "dir");
  const result = await discoverWorkspace(selected);
  assert.deepEqual(result.projects, []);
  assert.ok(result.warnings.some((w) => w.code === "symlink-skipped"));
  await assert.rejects(discoverWorkspace(path.join(selected, "collegamento")), { code: "FY_WORKSPACE_ROOT" });
}));

const fileSymlinkTest = process.platform === "win32" ? test.skip : test;
fileSymlinkTest("un manifest simbolico non viene letto", async () => temporary(async (root) => {
  const selected = path.join(root, "workspace"); await mkdir(selected);
  await file(root, "esterno.json", JSON.stringify({ dependencies: { react: "19" } }));
  await symlink(path.join(root, "esterno.json"), path.join(selected, "package.json"));
  const result = await discoverWorkspace(selected);
  assert.equal(result.projects.some((p) => p.frameworks.includes("react")), false);
  assert.ok(result.warnings.some((w) => w.code === "symlink-skipped"));
}));

test("metadati Git malformati non producono un repository valido", async () => temporary(async (root) => {
  await file(root, ".git", "not a gitdir");
  const result = await discoverWorkspace(root);
  assert.deepEqual(result.repositories, []);
  assert.equal(result.scan.status, "limited");
  assert.ok(result.warnings.some((w) => w.code === "invalid-git"));
}));

test("un manifest malformato viene segnalato senza divulgare il contenuto", async () => temporary(async (root) => {
  await file(root, "package.json", "{ secret-not-json");
  const result = await discoverWorkspace(root);
  assert.ok(result.warnings.some((w) => w.code === "invalid-manifest"));
  assert.equal(JSON.stringify(result).includes("secret-not-json"), false);
}));

test("il limite di profondita dichiara esplicitamente la copertura parziale", async () => temporary(async (root) => {
  await file(root, "figlio/package.json", "{}");
  const result = await discoverWorkspace(root, { maxDepth: 0 });
  assert.equal(result.scan.status, "limited");
  assert.ok(result.warnings.some((w) => w.code === "depth-limit"));
  assert.deepEqual(result.projects, []);
}));

test("il limite di ingressi non viene presentato come scansione completa", async () => temporary(async (root) => {
  for (let i = 0; i < 8; i++) await file(root, `file-${i}.txt`);
  const result = await discoverWorkspace(root, { maxEntries: 3 });
  assert.equal(result.scan.status, "limited");
  assert.ok(result.scan.visitedEntries <= 3);
  assert.ok(result.warnings.some((w) => w.code === "entry-limit"));
}));

test("rifiuta root inesistenti e limiti non validi", async () => temporary(async (root) => {
  await assert.rejects(discoverWorkspace(path.join(root, "assente")), { code: "FY_WORKSPACE_ROOT" });
  await assert.rejects(discoverWorkspace(root, { maxEntries: 0 }), { code: "FY_WORKSPACE_LIMIT" });
  await assert.rejects(discoverWorkspace(root, { maxDepth: -1 }), { code: "FY_WORKSPACE_LIMIT" });
}));

test("le variabili Git ereditate non cambiano il repository selezionato", async () => temporary(async (root) => {
  const a = path.join(root, "a"); const b = path.join(root, "b");
  await repository(a); await repository(b);
  const oldDirectory = process.env.GIT_DIR; const oldWorkTree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = path.join(a, ".git"); process.env.GIT_WORK_TREE = a;
    const result = await discoverWorkspace(b);
    assert.equal(result.repositories[0]?.gitDirectory, path.join(b, ".git"));
  } finally {
    if (oldDirectory === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldDirectory;
    if (oldWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = oldWorkTree;
  }
}));

test("un confine Git non risolto non attribuisce i progetti al repository esterno", async () => temporary(async (root) => {
  await repository(root);
  await repository(path.join(root, "figlio"));
  await file(root, "figlio/package.json", "{}");
  const result = await discoverWorkspace(root, { maxRepositories: 1 });
  assert.equal(result.scan.status, "limited");
  assert.ok(result.warnings.some((w) => w.code === "repository-limit"));
  assert.equal(result.projects.find((p) => p.path === "figlio")?.repository, null);
}));

test("la ricognizione dei manifest resta disponibile anche senza Git nel PATH", async () => temporary(async (root) => {
  await file(root, "package.json", JSON.stringify({ dependencies: { react: "19" } }));
  const previous = process.env.PATH;
  try {
    process.env.PATH = path.join(root, "nessun-binario");
    const result = await discoverWorkspace(root);
    assert.equal(result.scan.status, "limited");
    assert.ok(result.warnings.some((w) => w.code === "FY_GIT_UNAVAILABLE"));
    assert.ok(result.projects[0]?.frameworks.includes("react"));
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
  }
}));

test("cartelle con spazi e caratteri italiani mantengono la propria identita", async () => temporary(async (root) => {
  const child = path.join(root, "attivita è personale");
  await repository(child);
  const result = await discoverWorkspace(child);
  assert.equal(result.root, child);
  assert.equal(result.repositories[0]?.gitDirectory, path.join(child, ".git"));
  assert.equal(result.scan.status, "complete");
}));
