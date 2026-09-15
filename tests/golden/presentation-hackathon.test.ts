import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { loadConfig } from "../../src/config/config.js";
import { auditPresentationBundle } from "../../src/doctor/presentation-audit.js";
import { loadRegistry } from "../../src/registry/load.js";
import { resolveProfile } from "../../src/registry/resolve.js";

const expectedPresentationAssetPaths = [
  ".agents/skills/forgeyard-showcase/SKILL.md",
  "presentation/index.html",
  "presentation/styles.css",
  "presentation/app.js",
  "presentation/README.md",
] as const;

const expectedPresentationPaths = [
  ...expectedPresentationAssetPaths,
  ".forgeyard/tasks/T004.yaml",
] as const;

describe("presentation pack golden output", () => {
  test("renders six deterministic original components with reviewed presentation bytes", async () => {
    const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
    const registry = await loadRegistry(path.resolve("."));
    const resolved = resolveProfile(registry, "hackathon", "codex");
    const adapter = createCodexAdapter();

    const first = await adapter.render(resolved.components, config);
    const second = await adapter.render(resolved.components, config);
    const actual = new Map(first.map((file) => [file.path, file.content]));

    expect(first).toEqual(second);
    expect(first.filter((file) => file.componentId.startsWith("presentation.")).map((file) => file.path))
      .toEqual(expectedPresentationPaths);
    for (const relativePath of expectedPresentationAssetPaths) {
      const expected = await readFile(path.join("fixtures", "golden", "codex-hackathon", relativePath), "utf8");
      expect(actual.get(relativePath), relativePath).toBe(expected.replaceAll("\r\n", "\n"));
    }
  });

  test("the rendered golden bundle passes the presentation audit", async () => {
    await expect(auditPresentationBundle({
      root: path.resolve("fixtures/golden/codex-hackathon"),
      directory: "presentation",
    })).resolves.toEqual([]);
  });
});
