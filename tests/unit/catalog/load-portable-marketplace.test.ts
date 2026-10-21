import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { ComponentTreeFile } from "../../../src/core/contracts.js";
import { sha256Text } from "../../../src/core/hash.js";
import { loadPortableMarketplace } from "../../../src/catalog/load-portable-marketplace.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";
import { materializeExternalCatalog } from "../../../src/catalog/acquire.js";

const temporaryRoots: string[] = [];

async function sourceFile(root: string, relativePath: string, content: string): Promise<ComponentTreeFile> {
  const sourcePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, content, "utf8");
  return { relativePath, sourcePath, sha256: sha256Text(content) };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable plugin marketplace loader", () => {
  test("discovers every component downloaded from the controlled external catalog fixture", async () => {
    const registry = await loadRegistry(path.resolve("."));
    const resolved = resolveProfile(registry, "hackathon", "codex", { selection: "all", plugins: [] });
    const reference = resolved.components.find((component) => component.kind === "catalog")!;
    const catalog = await materializeExternalCatalog(reference);
    const pluginCount = reference.externalCatalog!.plugins.length;

    const marketplace = await loadPortableMarketplace(catalog.treeFiles!, { defaultLicense: "MIT" });

    expect(marketplace.plugins).toHaveLength(pluginCount);
    expect(marketplace.counts).toEqual({
      plugins: pluginCount,
      agents: pluginCount,
      skills: pluginCount,
      commands: pluginCount,
      supportingFiles: pluginCount,
      manifestFiles: pluginCount,
      otherFiles: 0,
    });
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(
      [...marketplace.plugins.map((plugin) => plugin.name)].sort((left, right) => left.localeCompare(right, "en")),
    );
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(reference.externalCatalog!.plugins);
    expect([...new Set(marketplace.plugins.map((plugin) => plugin.license))]).toEqual(["MIT"]);
    expect(marketplace.plugins.every((plugin) => plugin.skills[0]?.supportingFiles[0]?.relativeToSkill === "references/checklist.md")).toBe(true);
  });

  test("rejects duplicate declared agent names within one plugin", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-portable-catalog-"));
    temporaryRoots.push(root);
    const files = await Promise.all([
      sourceFile(
        root,
        "plugins/example/.claude-plugin/plugin.json",
        '{"name":"example","version":"1.0.0","description":"Example","license":"MIT"}\n',
      ),
      sourceFile(root, "plugins/example/agents/one.md", "---\nname: duplicate\n---\n# One\n"),
      sourceFile(root, "plugins/example/agents/two.md", "---\nname: duplicate\n---\n# Two\n"),
    ]);

    await expect(loadPortableMarketplace(files, { defaultLicense: "MIT" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_CATALOG_INVALID", components: ["example:duplicate"] }),
    );
  });
});
