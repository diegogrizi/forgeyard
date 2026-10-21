import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireExternalCatalog, validateExternalCatalogReference } from "../../../src/catalog/acquire.js";

const roots: string[] = [];
const source = { schemaVersion: 1, repository: "https://github.com/example/skills", revision: "HEAD",
  license: "MIT", plugins: ["python", "frontend"] };
const first = "a".repeat(40);
const second = "b".repeat(40);

async function cache() { const root = await mkdtemp(path.join(os.tmpdir(), "fy-catalog-")); roots.push(root); return root; }
function remote(revision = first, files: Record<string, string> = {}) {
  const content: Record<string, string> = { LICENSE: "MIT License\nCopyright fixture\n",
    "plugins/python/.claude-plugin/plugin.json": '{"name":"python","license":"MIT"}',
    "plugins/python/skills/testing/SKILL.md": "---\nname: testing\ndescription: Python tests.\n---\nRun tests.\n",
    "plugins/frontend/.claude-plugin/plugin.json": '{"name":"frontend"}', ...files };
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); requested.push(url);
    if (url.endsWith("/commits/HEAD")) return Response.json({ sha: revision });
    if (url.includes("/git/trees/")) return Response.json({ truncated: false,
      tree: Object.entries(content).map(([name, text]) => ({ path: name, type: "blob", mode: "100644", size: Buffer.byteLength(text) })) });
    const prefix = `https://raw.githubusercontent.com/example/skills/${revision}/`;
    return url.startsWith(prefix) && content[url.slice(prefix.length)] !== undefined
      ? new Response(content[url.slice(prefix.length)]) : new Response("missing", { status: 404 });
  };
  return { fetcher, requested };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("external catalog acquisition", () => {
  test("downloads only selected plugins and preserves their exact revision and license", async () => {
    const transport = remote();
    const result = await acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot: await cache(), fetcher: transport.fetcher });
    expect(result.files.map(file => file.relativePath)).toEqual(["LICENSE",
      "plugins/python/.claude-plugin/plugin.json", "plugins/python/skills/testing/SKILL.md", "UPSTREAM.json"]);
    expect(JSON.parse(await readFile(result.files.find(file => file.relativePath === "UPSTREAM.json")!.sourcePath, "utf8")))
      .toMatchObject({ source: "https://github.com/example/skills", revision: first, selectedPlugins: ["python"] });
    expect(transport.requested.some(url => url.includes("raw.githubusercontent.com") && url.includes("/frontend/"))).toBe(false);
  });
  test("new preparations resolve current HEAD, while an installed revision reuses its cache offline", async () => {
    const cacheRoot = await cache();
    const original = await acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, fetcher: remote().fetcher });
    const updated = await acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, fetcher: remote(second).fetcher });
    expect(updated.revision).toBe(second);
    expect(updated.revision).not.toBe(original.revision);
    const offline: typeof fetch = async () => { throw new Error("offline"); };
    expect((await acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, revision: first, fetcher: offline })).revision).toBe(first);
  });
  test("refuses a corrupted cached file instead of certifying altered source bytes", async () => {
    const cacheRoot = await cache();
    const result = await acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, fetcher: remote().fetcher });
    await writeFile(result.files.find(file => file.relativePath.endsWith("SKILL.md"))!.sourcePath, "changed");
    await expect(acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, revision: first, fetcher: remote().fetcher }))
      .rejects.toMatchObject({ code: "FY_CATALOG_INTEGRITY" });
  });
  test("refuses absent plugins, unsafe references and a missing license before publishing a cache", async () => {
    expect(() => validateExternalCatalogReference({ ...source, repository: "https://example.com/repo" })).toThrow();
    expect(() => validateExternalCatalogReference({ ...source, plugins: ["../escape"] })).toThrow();
    const cacheRoot = await cache();
    await expect(acquireExternalCatalog(validateExternalCatalogReference(source), ["unknown"], { cacheRoot, fetcher: remote().fetcher }))
      .rejects.toMatchObject({ code: "FY_CATALOG_INVALID" });
    const fetcher: typeof fetch = async input => String(input).includes("raw.githubusercontent.com") && String(input).endsWith("/LICENSE")
      ? new Response("missing", { status: 404 }) : remote().fetcher(input);
    await expect(acquireExternalCatalog(validateExternalCatalogReference(source), ["python"], { cacheRoot, fetcher }))
      .rejects.toMatchObject({ code: "FY_CATALOG_DOWNLOAD_FAILED" });
  });
});
