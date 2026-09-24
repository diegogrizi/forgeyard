import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { createPersonalWorkspace, inspectPersonalWorkspace } from "../../../src/workspace/personal.js";

const execute = promisify(execFile);
async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-personale-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { timeout: 120_000 })).stdout.trim();
}

// L'ingresso che consuma questo modulo è verificato in entry.test.ts: qui resta la registrazione.
test("l'anteprima non crea alcun file", async () => temporary(async (root) => {
  const preview = await inspectPersonalWorkspace(root);
  expect(preview.current).toBeNull();
  expect(await readdir(root)).toEqual([]);
}));

test("la registrazione non dichiara gli agenti connessi", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  expect(await readdir(root)).toEqual([".forgeyard"]);
  const current = (await inspectPersonalWorkspace(root)).current;
  expect(current?.payload.connection).toBe("not-connected");
}));

test("una seconda registrazione conserva byte e data", async () => temporary(async (root) => {
  const first = await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  const file = path.join(root, ".forgeyard/workspace.json");
  const before = await readFile(file, "utf8"); const mtime = (await stat(file)).mtimeMs;
  const preview = await inspectPersonalWorkspace(root);
  expect((await createPersonalWorkspace(preview)).sha256).toBe(first.sha256);
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await stat(file)).mtimeMs).toBe(mtime);
}));

test("una root Git non indicizza la forgia nemmeno con git add --all", async () => temporary(async (root) => {
  await git(root, "init", "-b", "main");
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(path.join(root, "codice.txt"), "codice");
  const before = await git(root, "status", "--porcelain=v1", "--untracked-files=all");
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  expect(await git(root, "status", "--porcelain=v1", "--untracked-files=all")).toBe(before);
  expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe("node_modules/\n");
  await git(root, "add", "--all");
  expect(await git(root, "ls-files", "--", ".forgeyard")).toBe("");
  expect(await git(root, "ls-files")).toContain("codice.txt");
}));

test("l'esclusione privata funziona anche se Git viene inizializzato dopo", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  await git(root, "init", "-b", "main"); await git(root, "add", "--all");
  expect(await git(root, "ls-files")).toBe("");
}));

test("il contenitore conserva separati i repository figli senza scriverci dentro", async () => temporary(async (root) => {
  for (const name of ["api", "web"]) { await mkdir(path.join(root, name)); await git(path.join(root, name), "init", "-b", "main"); }
  await writeFile(path.join(root, "web/package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  const before = await git(path.join(root, "web"), "status", "--porcelain=v1");
  const result = await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  expect(result.payload.repositories.map((item) => item.path)).toEqual(["api", "web"]);
  expect(await readdir(path.join(root, "api"))).toEqual([".git"]);
  expect(await git(path.join(root, "web"), "status", "--porcelain=v1")).toBe(before);
  expect((await readdir(root)).includes(".git")).toBe(false);
}));

test("la root può essere una sottocartella di un repository senza modificarne il gitignore", async () => temporary(async (root) => {
  await git(root, "init", "-b", "main"); const child = path.join(root, "lavoro"); await mkdir(child);
  await createPersonalWorkspace(await inspectPersonalWorkspace(child));
  await git(root, "add", "--all"); expect(await git(root, "ls-files")).toBe("");
}));

test("file della forgia già indicizzati vengono rifiutati anche se cancellati dal disco", async () => temporary(async (root) => {
  await git(root, "init", "-b", "main"); await mkdir(path.join(root, ".forgeyard"));
  await writeFile(path.join(root, ".forgeyard/vecchio.txt"), "tracciato"); await git(root, "add", "--all");
  await rm(path.join(root, ".forgeyard"), { recursive: true });
  await expect(inspectPersonalWorkspace(root)).rejects.toMatchObject({ code: "FY_PERSONAL_TRACKED" });
  expect(await git(root, "ls-files")).toContain(".forgeyard/vecchio.txt");
}));

test("una vecchia installazione non è sovrascritta o adottata implicitamente", async () => temporary(async (root) => {
  await mkdir(path.join(root, ".forgeyard")); await writeFile(path.join(root, ".forgeyard/capsule.json"), "legacy");
  await expect(inspectPersonalWorkspace(root)).rejects.toMatchObject({ code: "FY_PERSONAL_CONFLICT" });
  expect(await readFile(path.join(root, ".forgeyard/capsule.json"), "utf8")).toBe("legacy");
}));

test("la modifica di configurazione o ignore viene rilevata senza essere riparata alla cieca", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  const file = path.join(root, ".forgeyard/workspace.json"); const original = await readFile(file, "utf8");
  await writeFile(file, original.replace("not-connected", "connected"));
  await expect(inspectPersonalWorkspace(root)).rejects.toMatchObject({ code: "FY_PERSONAL_DRIFT" });
  await writeFile(file, original); await writeFile(path.join(root, ".forgeyard/.gitignore"), "# modificato\n");
  await expect(inspectPersonalWorkspace(root)).rejects.toMatchObject({ code: "FY_PERSONAL_DRIFT" });
}));

test("una scansione parziale non autorizza la registrazione", async () => temporary(async (root) => {
  await writeFile(path.join(root, "package.json"), "not-json");
  const preview = await inspectPersonalWorkspace(root);
  await expect(createPersonalWorkspace(preview)).rejects.toMatchObject({ code: "FY_PERSONAL_INCOMPLETE" });
  expect(await readdir(root)).toEqual(["package.json"]);
}));

test("un cambiamento della topologia invalida l'anteprima prima di scrivere", async () => temporary(async (root) => {
  const preview = await inspectPersonalWorkspace(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  await expect(createPersonalWorkspace(preview)).rejects.toMatchObject({ code: "FY_PERSONAL_STALE" });
  expect(await readdir(root)).toEqual(["package.json"]);
}));

test("un collegamento al posto della directory privata non viene seguito", async () => temporary(async (root) => {
  const selected = path.join(root, "lavoro"); const outside = path.join(root, "altro"); await mkdir(selected); await mkdir(outside);
  await symlink(outside, path.join(selected, ".forgeyard"), process.platform === "win32" ? "junction" : "dir");
  await expect(inspectPersonalWorkspace(selected)).rejects.toMatchObject({ code: "FY_PERSONAL_CONFLICT" });
  expect(await readdir(outside)).toEqual([]);
}));

test("due registrazioni concorrenti non si sovrascrivono", async () => temporary(async (root) => {
  const preview = await inspectPersonalWorkspace(root);
  const results = await Promise.allSettled([createPersonalWorkspace(preview), createPersonalWorkspace(preview)]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect((await inspectPersonalWorkspace(root)).current?.payload.connection).toBe("not-connected");
}));
