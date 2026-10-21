import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createForgeyardService, renderFactoryPlan } from "../../../src/application/forgeyard.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import { applyInstallPlan } from "../../../src/installer/apply.js";

// Esegue installazione e aggiornamento reali su una piccola fonte controllata; tetto 60 s.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("installed projects retain their source revision until an explicit update previews and applies the new one", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fy-external-project-")); roots.push(directory);
  const root = path.join(directory, "project"); await mkdir(root);
  let revision = "1".repeat(40);
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    const requestedRevision = /\/([0-9a-f]{40})\//.exec(url)?.[1] ?? revision;
    const content: Record<string, string> = { LICENSE: "MIT License\nCopyright test fixture\n",
      "plugins/unit-testing/.claude-plugin/plugin.json": '{"name":"unit-testing","license":"MIT"}',
      "plugins/unit-testing/skills/tests/SKILL.md": `---\nname: tests\ndescription: Write tests.\n---\nFixture revision ${requestedRevision}\n` };
    if (url.endsWith("/commits/HEAD")) return Response.json({ sha: revision });
    if (url.includes("/git/trees/")) return Response.json({ truncated: false,
      tree: Object.entries(content).map(([name, text]) => ({ path: name, type: "blob", mode: "100644", size: Buffer.byteLength(text) })) });
    const key = url.split(`/${requestedRevision}/`)[1];
    return new Response(key ? content[key] : "missing", { status: key && content[key] !== undefined ? 200 : 404 });
  };
  const catalogOptions = { cacheRoot: path.join(directory, "cache"), fetcher };
  const config = validateConfig({ ...await loadConfig(path.resolve("fixtures/answers/hackathon.yaml")),
    profile: "hackathon", catalog: { selection: "curated", plugins: ["unit-testing"] } });
  const plan = await renderFactoryPlan(root, config, "20261021-first-install", "0.1.0", path.resolve("."), catalogOptions);
  await applyInstallPlan(plan);
  const indexPath = path.join(root, ".forgeyard/catalog/ecosystem.json");
  const installedRevision = async () => JSON.parse(await readFile(indexPath, "utf8")).source.revision;
  expect(await installedRevision()).toBe("1".repeat(40));
  revision = "2".repeat(40);
  const repeat = await renderFactoryPlan(root, config, "20261021-repeat-install", "0.1.0", path.resolve("."), catalogOptions);
  expect(repeat.files.find(file => file.path === ".forgeyard/catalog/ecosystem.json")!.content)
    .toBe(await readFile(indexPath, "utf8"));
  const unused = async (): Promise<never> => { throw new Error("unexpected prompt"); };
  let operation = 0;
  const service = createForgeyardService({ prompts: { input: unused, number: unused, select: unused, confirm: async () => false },
    registryRoot: path.resolve("."), catalogOptions, operationId: () => `20261021-explicit-update-${++operation}` });
  const preview = await service.update({ root, yes: false, dryRun: true, nonInteractive: true });
  expect(preview.status).toBe("preview");
  expect(preview.changes.updated).toContain(".forgeyard/catalog/ecosystem.json");
  expect(await installedRevision()).toBe("1".repeat(40));
  const updated = await service.update({ root, yes: true, dryRun: false, nonInteractive: true });
  expect(updated.status).toBe("applied");
  expect(await installedRevision()).toBe("2".repeat(40));
});
