import path from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";

import { createClaudeCodeAdapter } from "../../../src/adapters/claude-code.js";
import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { createCursorAdapter } from "../../../src/adapters/cursor.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import type { HarnessAdapter, HarnessId } from "../../../src/core/contracts.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

const adapters: ReadonlyArray<readonly [HarnessId, () => HarnessAdapter]> = [
  ["codex", createCodexAdapter],
  ["claude-code", createClaudeCodeAdapter],
  ["cursor", createCursorAdapter],
];

async function render(harness: HarnessId, factory: () => HarnessAdapter, profile: "minimal" | "hackathon") {
  const base = await loadConfig(path.resolve(`fixtures/answers/${profile}.yaml`));
  const config = validateConfig({ ...base, profile, harnesses: [harness] });
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, profile, harness, config.catalog);
  const adapter = factory();
  const files = await adapter.render(resolved.components, config);
  await adapter.validateOutput(files);
  return { config, files };
}

describe.each(adapters)("%s delivery workflow", (harness, factory) => {
  test("installs a complete visible-slice DAG and local continuity assets", async () => {
    const { files } = await render(harness, factory, "hackathon");
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect([...byPath.keys()]).toEqual(expect.arrayContaining([
      "PROJECT.md",
      ".forgeyard/tasks/T001.yaml",
      ".forgeyard/tasks/T002.yaml",
      ".forgeyard/tasks/T003.yaml",
      ".forgeyard/tasks/T004.yaml",
      ".forgeyard/knowledge/README.md",
      ".forgeyard/decisions/0000-template.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
      ".forgeyard/usage/README.md",
    ]));

    const tasks = ["T001", "T002", "T003", "T004"].map((id) =>
      parseYaml(byPath.get(`.forgeyard/tasks/${id}.yaml`)!) as Record<string, unknown>
    );
    expect(tasks.map((task) => task.dependsOn)).toEqual([[], ["T001"], ["T002"], ["T003"]]);
    expect(tasks[2]!.writeScopes).toEqual([]);
    expect(tasks[3]!.writeScopes).toEqual(["presentation"]);
    expect(tasks.every((task) => task.evidence && task.integration)).toBe(true);

    expect(byPath.get("PROJECT.md")).toContain("Signal Garden");
    expect(byPath.get("PROJECT.md")).toContain("one trustworthy user journey");
    expect(byPath.get(".forgeyard/handoffs/CURRENT.md")).toContain("Current revision");
    expect(byPath.get(".forgeyard/reports/RUN_REPORT.md")).toContain("Revision-bound evidence");
    expect(byPath.get(".forgeyard/usage/README.md")).toContain("forgeyard ledger record");
  });

  test("keeps the minimal profile to the reusable kernel", async () => {
    const { files } = await render(harness, factory, "minimal");

    expect(files.some((file) => file.path === "PROJECT.md")).toBe(false);
    expect(files.some((file) => file.path === ".forgeyard/tasks/T002.yaml")).toBe(false);
    expect(files.some((file) => file.path === ".forgeyard/reports/RUN_REPORT.md")).toBe(false);
  });
});
