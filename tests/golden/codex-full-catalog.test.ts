import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { renderCodexCatalog } from "../../src/adapters/codex-catalog.js";
import { loadRegistry } from "../../src/registry/load.js";

describe("Codex full ecosystem golden", () => {
  test("renders the entire pinned marketplace without collisions or malformed native files", async () => {
    const registry = await loadRegistry(path.resolve("."));
    const pack = registry.packs.get("ecosystem")!;
    const declaration = pack.manifest.components.find((component) => component.id === "ecosystem.portable-catalog")!;
    const entry = pack.entries.get(declaration.id)!;
    const component = {
      ...declaration,
      packId: pack.manifest.id,
      packVersion: pack.manifest.version,
      sourcePath: entry.sourcePath,
      sha256: entry.sha256,
      treeFiles: entry.files!,
    };

    const files = await renderCodexCatalog(component, "all");
    const paths = files.map((file) => file.path);
    const agents = files.filter((file) => /^\.codex\/agents\/.*\.toml$/.test(file.path));
    const skills = files.filter((file) => /\/SKILL\.md$/.test(file.path));

    expect(agents).toHaveLength(202);
    expect(skills).toHaveLength(288);
    expect(new Set(paths).size).toBe(paths.length);
    expect(agents.every((file) => {
      const parsed = parseToml(file.content);
      return typeof parsed.name === "string" && typeof parsed.developer_instructions === "string";
    })).toBe(true);
    expect(skills.every((file) => {
      const metadata = parseYaml(file.content.split("---\n")[1] ?? "");
      return typeof metadata?.name === "string" && typeof metadata?.description === "string";
    })).toBe(true);
    expect(skills.every((file) => Buffer.byteLength(file.content, "utf8") <= 8_192)).toBe(true);
    expect(files.some((file) => file.content.toLocaleLowerCase("en-US").includes(("acce" + "nture").toLocaleLowerCase("en-US")))).toBe(false);
  }, 30_000);
});
