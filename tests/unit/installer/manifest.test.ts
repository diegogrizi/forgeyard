import path from "node:path";

import { describe, expect, test, vi } from "vitest";

// Ogni prova di questo file compone l'intero catalogo vendored e rende centinaia di file.
// Cronometrate su questa macchina a riposo costano 7,9 s e 9,3 s: sotto il tetto globale di
// 30 s, ma con un margine di tre volte che si esaurisce su un runner piu' lento. Il tetto e'
// dichiarato qui con la sua misura, invece di restare implicito.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

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
  test("freezes operational policy and every quality gate in a stable capsule", async () => {
    const first = await makePlan("20260916T120000000Z-capsule1");
    const second = await makePlan("20260916T120001000Z-capsule2");
    const frozen = first.plan.files.find((file) => file.path === ".forgeyard/capsule.json");
    expect(frozen).toBeDefined();
    expect(frozen?.ownership).toBe("managed");
    const capsule = JSON.parse(frozen!.content);
    expect(capsule.id).toMatch(/^[a-f0-9]{64}$/);
    expect(capsule.payload.gates.map((gate: { argv: string[] }) => gate.argv))
      .toEqual(first.config.quality.commands.map((command) => command.argv));
    expect(capsule.payload.policy.mutableRoots).toEqual(first.config.paths.mutableRoots);
    expect(frozen?.content).toBe(second.plan.files.find((file) => file.path === ".forgeyard/capsule.json")?.content);
    expect(capsule.payload.files.some((file: { path: string }) => file.path.startsWith(".forgeyard/tasks/")))
      .toBe(false);
  });
  test("builds a deterministic plan with seed, lock, runtime ignore, and adapter payload", async () => {
    const first = await makePlan("20260915T120000000Z-a1b2c3");
    const second = await makePlan("20260915T120001000Z-d4e5f6");

    expect(first.plan.files.map((file) => file.path).slice(0, 17)).toEqual([
      "forgeyard.yaml",
      "forgeyard.lock",
      ".forgeyard/.gitignore",
      "AGENTS.md",
      ".agents/skills/forgeyard-workflow/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".forgeyard/tasks/T001.yaml",
      ".forgeyard/bin/write-guard.mjs",
      ".forgeyard/COMPOSITION.md",
      "PROJECT.md",
      ".forgeyard/tasks/T002.yaml",
      ".forgeyard/tasks/T003.yaml",
      ".forgeyard/knowledge/README.md",
      ".forgeyard/decisions/0000-template.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
      ".forgeyard/usage/README.md",
    ]);
    expect(first.plan.files.some((file) => file.path === ".forgeyard/catalog/ecosystem.json")).toBe(true);
    expect(first.plan.files.filter((file) => file.path.startsWith(".codex/agents/")).length).toBeGreaterThanOrEqual(33);
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
