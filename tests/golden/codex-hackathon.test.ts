import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { loadConfig } from "../../src/config/config.js";
import { loadRegistry } from "../../src/registry/load.js";
import { resolveProfile } from "../../src/registry/resolve.js";

const expectedPaths = [
  "AGENTS.md",
  ".agents/skills/forgeyard-workflow/SKILL.md",
  ".codex/agents/reviewer.toml",
  ".forgeyard/tasks/T001.yaml",
  ".forgeyard/bin/write-guard.mjs",
  ".agents/skills/forgeyard-showcase/SKILL.md",
  "presentation/index.html",
  "presentation/styles.css",
  "presentation/app.js",
  "presentation/README.md",
] as const;

describe("Codex hackathon golden output", () => {
  test("matches independently reviewed expected bytes", async () => {
    const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
    const registry = await loadRegistry(path.resolve("."));
    const resolved = resolveProfile(registry, "hackathon", "codex");
    const files = await createCodexAdapter().render(resolved.components, config);
    const actual = new Map(files.map((file) => [file.path, file.content]));

    expect([...actual.keys()].slice(0, 5)).toEqual(expectedPaths.slice(0, 5));
    expect([...actual.keys()]).toEqual(expect.arrayContaining([...expectedPaths]));
    for (const relativePath of expectedPaths) {
      const expected = await readFile(
        relativePath === ".forgeyard/bin/write-guard.mjs"
          ? path.join("packs", "foundation", "templates", "write-guard.mjs")
          : path.join("fixtures", "golden", "codex-hackathon", relativePath),
        "utf8",
      );
      expect(actual.get(relativePath), relativePath).toBe(expected.replaceAll("\r\n", "\n"));
    }
    expect(files.filter((file) => file.path.startsWith(".codex/agents/")).length).toBe(52);
    expect(files.filter((file) => file.path.endsWith("/SKILL.md")).length).toBe(119);
    expect(actual.has(".forgeyard/catalog/ecosystem.json")).toBe(true);
  });
});
