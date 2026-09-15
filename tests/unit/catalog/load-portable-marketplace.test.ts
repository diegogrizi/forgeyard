import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { ComponentTreeFile } from "../../../src/core/contracts.js";
import { sha256Text } from "../../../src/core/hash.js";
import { loadPortableMarketplace } from "../../../src/catalog/load-portable-marketplace.js";
import { loadRegistry } from "../../../src/registry/load.js";

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
  test("discovers every component in the pinned ecosystem catalog", async () => {
    const registry = await loadRegistry(path.resolve("."));
    const files = registry.packs.get("ecosystem")?.entries.get("ecosystem.portable-catalog")?.files;
    expect(files).toBeDefined();

    const marketplace = await loadPortableMarketplace(files ?? [], { defaultLicense: "MIT" });

    expect(marketplace.plugins).toHaveLength(92);
    expect(marketplace.counts).toEqual({
      plugins: 92,
      agents: 202,
      skills: 183,
      commands: 105,
      supportingFiles: 242,
      manifestFiles: 184,
      otherFiles: 91,
    });
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(
      [...marketplace.plugins.map((plugin) => plugin.name)].sort((left, right) => left.localeCompare(right, "en")),
    );
    expect([...new Set(marketplace.plugins.map((plugin) => plugin.license))].sort()).toEqual([
      "Apache-2.0",
      "MIT",
    ]);
    expect(marketplace.plugins.filter((plugin) => plugin.license === "Apache-2.0").map((plugin) => plugin.name)).toEqual([
      "conductor",
      "superself",
    ]);
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
