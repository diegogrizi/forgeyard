import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

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

  test("accepts an intentional source template token and a clean offline presentation", async () => {
    const root = await freshRoot();
    await put(root, "packs/example/template.md.tpl", "Hello {{project.name}}.\n");
    await put(root, "packs/presentation/templates/presentation/index.html.tpl", "<!doctype html><title>Local</title>\n");
    await put(root, "packs/presentation/templates/presentation/styles.css", "body { color: black; }\n");
    await put(root, "packs/presentation/templates/presentation/app.js", "document.body.dataset.ready = 'true';\n");

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
  }, 30_000);

  test("reports generic rules for unfinished, unresolved, logged, remote, and identity-bearing content", async () => {
    const root = await freshRoot();
    await put(root, "README.md", "TODO: finish public wording.\n");
    await put(root, "notes/unresolved.md", "Value: {{missing.value}}\n");
    await put(root, ".forgeyard/evidence/run.json", "{}\n");
    await put(root, "debug.log", "captured output\n");
    await put(
      root,
      "packs/presentation/templates/presentation/index.html.tpl",
      '<meta name="author" content="A team"><script src="https://example.invalid/app.js"></script>\n',
    );

    const result = await audit(root);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(1);
    for (const rule of [
      "release.unfinished-prose",
      "release.unresolved-template",
      "release.committed-output",
      "release.presentation-remote",
      "release.presentation-identity",
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
