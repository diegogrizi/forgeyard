import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderClaudeCodeCatalog } from "../../src/adapters/claude-code-catalog.js";
import { loadRegistry } from "../../src/registry/load.js";

describe("Claude Code full ecosystem golden", () => {
  test("renders every pinned agent, skill, and command into native project paths", async () => {
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

    const files = await renderClaudeCodeCatalog(component, "all");
    const agents = files.filter((file) => /^\.claude\/agents\/.*\.md$/.test(file.path));
    const skills = files.filter((file) => /^\.claude\/skills\/.*\/SKILL\.md$/.test(file.path));
    const commands = files.filter((file) => /^\.claude\/commands\/.*\.md$/.test(file.path));

    expect(agents).toHaveLength(202);
    expect(skills).toHaveLength(183);
    expect(commands).toHaveLength(105);
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
    expect([...agents, ...skills, ...commands].every((file) => {
      const parsed = parseYaml(file.content.split("---\n")[1] ?? "");
      return typeof parsed === "object" && parsed !== null;
    })).toBe(true);
  }, 30_000);
});
