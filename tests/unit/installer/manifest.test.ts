import path from "node:path";

import { describe, expect, test } from "vitest";

import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { loadConfig, serializeConfig } from "../../../src/config/config.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { parseInstallManifest } from "../../../src/installer/manifest.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

async function makePlan(operationId: string) {
  const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "hackathon", "codex");
  const renderedFiles = await createCodexAdapter().render(resolved.components, config);
  return {
    config,
    plan: buildInstallPlan({
      targetRoot: path.resolve("fixture-target"),
      config,
      resolved,
      renderedFiles,
      operationId,
      forgeyardVersion: "0.1.0",
    }),
  };
}

describe("install metadata", () => {
  test("builds a deterministic plan with seed, lock, runtime ignore, and adapter payload", async () => {
    const first = await makePlan("20260915T120000000Z-a1b2c3");
    const second = await makePlan("20260915T120001000Z-d4e5f6");

    expect(first.plan.files.map((file) => file.path)).toEqual([
      "forgeyard.yaml",
      "forgeyard.lock",
      ".forgeyard/.gitignore",
      "AGENTS.md",
      ".agents/skills/forgeyard-workflow/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".forgeyard/tasks/T001.yaml",
      ".agents/skills/forgeyard-showcase/SKILL.md",
      "presentation/index.html",
      "presentation/styles.css",
      "presentation/app.js",
      "presentation/README.md",
    ]);
    expect(first.plan.files[0]).toEqual(
      expect.objectContaining({
        componentId: "forgeyard.config",
        ownership: "seed",
        content: serializeConfig(first.config),
      }),
    );
    expect(first.plan.files.find((file) => file.path === "forgeyard.lock")?.content).toBe(
      second.plan.files.find((file) => file.path === "forgeyard.lock")?.content,
    );
  });

  test("rejects malformed or unknown manifest fields", () => {
    const malformed = JSON.stringify({
      schemaVersion: 1,
      forgeyardVersion: "0.1.0",
      profile: "hackathon",
      adapter: "codex",
      latestOperationId: "op",
      files: [],
      unknown: true,
    });

    expect(() => parseInstallManifest(malformed, "manifest.json")).toThrowError(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID", exitCode: 3 }),
    );
  });
});
