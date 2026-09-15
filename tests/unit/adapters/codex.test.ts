import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { loadConfig } from "../../../src/config/config.js";
import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

async function renderedFoundation() {
  const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "hackathon", "codex");
  const adapter = createCodexAdapter();
  const files = await adapter.render(resolved.components, config);
  await adapter.validateOutput(files);
  return { adapter, files };
}

describe("Codex adapter", () => {
  test("maps four canonical foundation slots to native project paths", async () => {
    const { files } = await renderedFoundation();

    expect(files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      ".agents/skills/forgeyard-workflow/SKILL.md",
      ".codex/agents/reviewer.toml",
      ".forgeyard/tasks/T001.yaml",
    ]);
    expect(files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });

  test("renders structurally consumable skill, reviewer, and task files", async () => {
    const { files } = await renderedFoundation();
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const skill = byPath.get(".agents/skills/forgeyard-workflow/SKILL.md")!;
    const frontmatterSource = skill.split("---\n")[1];
    expect(frontmatterSource).toBeDefined();
    const frontmatter = parseYaml(frontmatterSource!);
    const reviewer = parseToml(byPath.get(".codex/agents/reviewer.toml")!);
    const task = parseYaml(byPath.get(".forgeyard/tasks/T001.yaml")!);

    expect(frontmatter).toEqual(
      expect.objectContaining({ name: "forgeyard-workflow", description: expect.any(String) }),
    );
    expect(reviewer).toEqual(
      expect.objectContaining({ name: "reviewer", description: expect.any(String), sandbox_mode: "read-only" }),
    );
    expect(task).toEqual(
      expect.objectContaining({ schemaVersion: 1, id: "T001", required: true, command: ["node", "-e", "process.exit(0)"] }),
    );
    expect(byPath.get("AGENTS.md")!.length).toBeLessThan(4_000);
  });

  test("reports honest M1 capability states", () => {
    const adapter = createCodexAdapter();

    expect(adapter.capabilities).toEqual({
      projectInstructions: "native",
      projectSkills: "native",
      reviewerAgents: "native",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    });
  });
});
