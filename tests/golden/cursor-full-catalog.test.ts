import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderCursorCatalog } from "../../src/adapters/cursor-catalog.js";
import { loadRegistry } from "../../src/registry/load.js";

describe("Cursor full ecosystem golden", () => {
  test("renders every pinned capability as a requested rule with a local source", async () => {
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

    const files = await renderCursorCatalog(component, "all");
    const rules = files.filter((file) => /^\.cursor\/rules\/catalog--.*\.mdc$/.test(file.path));
    const agents = files.filter((file) => /^\.cursor\/forgeyard\/agents\/.*\.md$/.test(file.path));
    const skills = files.filter((file) => /^\.cursor\/forgeyard\/skills\/.*\/instructions\.md$/.test(file.path));
    const commands = files.filter((file) => /^\.cursor\/forgeyard\/commands\/.*\.md$/.test(file.path));
    const paths = new Set(files.map((file) => file.path));

    expect(rules).toHaveLength(490);
    expect(agents).toHaveLength(202);
    expect(skills).toHaveLength(183);
    expect(commands).toHaveLength(105);
    expect(paths.size).toBe(files.length);
    for (const rule of rules) {
      const parsed = parseYaml(rule.content.split("---\n")[1] ?? "") as Record<string, unknown>;
      expect(parsed).toMatchObject({ description: expect.any(String), globs: [], alwaysApply: false });
      const reference = /@(\.cursor\/forgeyard\/[^\s]+)/.exec(rule.content)?.[1];
      expect(reference).toBeDefined();
      expect(paths.has(reference!)).toBe(true);
      expect(Buffer.byteLength(rule.content, "utf8")).toBeLessThan(2_048);
    }
  }, 30_000);
});
