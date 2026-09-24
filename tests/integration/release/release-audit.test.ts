import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 9,8 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

import { runProcess } from "../../helpers/cli.js";

const repositoryRoot = path.resolve(".");
const tsxCli = path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const auditScript = path.join(repositoryRoot, "scripts", "release-audit.ts");
const roots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-release-audit-"));
  roots.push(root);
  return root;
}

async function put(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function audit(root: string, args: readonly string[] = [], env?: NodeJS.ProcessEnv) {
  return runProcess(
    process.execPath,
    [tsxCli, auditScript, "--root", root, ...args],
    repositoryRoot,
    env === undefined ? {} : { env },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("non-leaking release audit", () => {
  test("finds an environment-supplied term without printing or persisting its value", async () => {
    const root = await freshRoot();
    const privateValue = "ephemeral-private-marker-8472";
    await put(root, "nested/generated.md", `A ${privateValue} appears here.\n`);
    await put(root, `${privateValue}/named-after-value.md`, `A ${privateValue} appears here too.\n`);
    await put(root, "node_modules/ignored.md", privateValue);
    await put(root, "dist/ignored.js", privateValue);
    await put(root, ".git/ignored.txt", privateValue);

    const result = await audit(
      root,
      ["--deny-term-env", "FORGEYARD_TEST_DENY_TERM"],
      { FORGEYARD_TEST_DENY_TERM: privateValue },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(1);
    expect(output).toContain("release.private-deny-term");
    expect(output).toContain("nested/generated.md");
    expect(output).not.toContain(privateValue);
    expect(output).not.toContain("node_modules/ignored.md");
    expect(output).not.toContain("dist/ignored.js");
    expect(output).not.toContain(".git/ignored.txt");
  });

  test("accepts an intentional source template token without flagging it", async () => {
    const root = await freshRoot();
    await put(root, "packs/example/template.md.tpl", "Hello {{project.name}}.\n");

    const result = await audit(root);

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(result.stdout).toContain("Release audit passed");
  });

  test("scans vendored text for private terms but exempts upstream prompt syntax", async () => {
    const root = await freshRoot();
    const privateValue = "private-vendor-marker-9471";
    await put(root, "packs/ecosystem/vendor/plugins/example/SKILL.md", "TODO: preserve {{upstream.placeholder}}.\n");

    const clean = await audit(root);
    const denied = await audit(
      root,
      ["--deny-term-env", "FORGEYARD_TEST_DENY_TERM"],
      { FORGEYARD_TEST_DENY_TERM: privateValue },
    );
    await put(root, "packs/ecosystem/vendor/plugins/example/reference.md", `${privateValue}\n`);
    const detected = await audit(
      root,
      ["--deny-term-env", "FORGEYARD_TEST_DENY_TERM"],
      { FORGEYARD_TEST_DENY_TERM: privateValue },
    );

    expect(clean).toEqual(expect.objectContaining({ exitCode: 0 }));
    expect(denied).toEqual(expect.objectContaining({ exitCode: 0 }));
    expect(detected.exitCode).toBe(1);
    expect(`${detected.stdout}\n${detected.stderr}`).toContain("release.private-deny-term");
  });

  test("reports verified catalog metrics for the release workspace", async () => {
    const result = await audit(repositoryRoot);

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(result.stdout).toContain("1,007 files");
    expect(result.stdout).toContain("211,594 physical lines");
    expect(result.stdout).toContain("202 agents");
    expect(result.stdout).toContain("183 skills");
    expect(result.stdout).toContain("105 commands");
  });
  test("keeps public documentation aligned with the attested catalog counts", async () => {
    const [readme, architectureGuide, sourceGuide] = await Promise.all([
      readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      readFile(path.join(repositoryRoot, "docs", "guide", "architettura.md"), "utf8"),
      readFile(path.join(repositoryRoot, "docs", "provenance", "catalog-sources.md"), "utf8"),
    ]);
    const publicDocs = `${readme}\n${architectureGuide}\n${sourceGuide}`;

    for (const requiredClaim of [
      "1.007 file sorgente",
      "211.594 righe fisiche",
      "202 agenti",
      "183 skill",
      "105 comandi",
    ]) expect(publicDocs).toContain(requiredClaim);
    // The entry document must not resurrect a harness the product dropped. Naming Cursor
    // to explain its removal is the opposite of resurrecting it, so the guard checks the
    // claim rather than the word: it may not be presented as supported.
    expect(readme).not.toMatch(/Cursor[^.\n]*support/i);
    expect(readme).not.toMatch(/\bhackathon\b/i);
  });

  test("documents the executable harness mappings and the honesty boundary", async () => {
    const [readme, architectureGuide, stateDocument] = await Promise.all([
      readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      readFile(path.join(repositoryRoot, "docs", "guide", "architettura.md"), "utf8"),
      readFile(path.join(repositoryRoot, "docs", "STATO.md"), "utf8"),
    ]);
    const publicDocs = `${readme}\n${architectureGuide}\n${stateDocument}`;

    for (const requiredClaim of [
      "Codex",
      "Claude Code",
      "202 agenti, 183 skill e 105 comandi",
      "disableSkillShellExecution",
      "Nessuna prova live con account Claude Code o Codex",
    ]) expect(publicDocs).toContain(requiredClaim);
    // A structural check is never reported as a successful real-client run.
    expect(publicDocs).not.toMatch(/\bprova live (?:superata|riuscita)\b/i);
  });

  test("reports generic rules for unfinished, unresolved, logged, remote, and identity-bearing content", async () => {
    const root = await freshRoot();
    await put(root, "README.md", "TODO: finish public wording.\n");
    await put(root, "notes/unresolved.md", "Value: {{missing.value}}\n");
    await put(root, ".forgeyard/evidence/run.json", "{}\n");
    await put(root, "debug.log", "captured output\n");

    const result = await audit(root);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(1);
    for (const rule of [
      "release.unfinished-prose",
      "release.unresolved-template",
      "release.committed-output",
    ]) expect(output).toContain(rule);
  });

  test("rejects a missing environment value without echoing the variable name", async () => {
    const root = await freshRoot();
    const variableName = "FORGEYARD_TEST_MISSING_TERM";

    const result = await audit(root, ["--deny-term-env", variableName], { [variableName]: "" });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(2);
    expect(output).toContain("release.deny-term-unavailable");
    expect(output).not.toContain(variableName);
  });
});
