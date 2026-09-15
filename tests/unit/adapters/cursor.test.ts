import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { createCursorAdapter } from "../../../src/adapters/cursor.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

async function fixture(profile: "minimal" | "hackathon" | "full" = "hackathon") {
  const base = await loadConfig(path.resolve(`fixtures/answers/${profile}.yaml`));
  const config = validateConfig({ ...base, harnesses: ["cursor"] });
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, profile, "cursor", config.catalog);
  const adapter = createCursorAdapter();
  const files = await adapter.render(resolved.components, config);
  await adapter.validateOutput(files);
  return { adapter, files };
}

function metadata(content: string): Record<string, unknown> {
  return parseYaml(content.split("---\n")[1]!) as Record<string, unknown>;
}

describe("Cursor adapter", () => {
  test("maps foundation and presentation to AGENTS.md and requested project rules", async () => {
    const { files } = await fixture();
    const paths = files.map((file) => file.path);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(paths.slice(0, 9)).toEqual([
      "AGENTS.md",
      ".cursor/rules/forgeyard-workflow.mdc",
      ".cursor/rules/forgeyard-reviewer.mdc",
      ".forgeyard/tasks/T001.yaml",
      ".cursor/rules/forgeyard-showcase.mdc",
      "presentation/index.html",
      "presentation/styles.css",
      "presentation/app.js",
      "presentation/README.md",
    ]);
    expect(byPath.get("AGENTS.md")).toContain(".cursor/rules/forgeyard-workflow.mdc");
    expect(byPath.get("AGENTS.md")).not.toContain(".agents/skills/");
    expect(metadata(byPath.get(".cursor/rules/forgeyard-workflow.mdc")!)).toMatchObject({
      description: expect.any(String),
      globs: [],
      alwaysApply: false,
    });
  });

  test("renders the reviewer as an honest adapted rule and keeps the task machine-readable", async () => {
    const { files } = await fixture();
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const reviewer = byPath.get(".cursor/rules/forgeyard-reviewer.mdc")!;

    expect(metadata(reviewer)).toMatchObject({
      description: "Read-only reviewer for a named task and frozen revision.",
      globs: [],
      alwaysApply: false,
    });
    expect(reviewer).toContain("Remain read-only");
    expect(reviewer).toContain("Cursor does not enforce a per-rule tool allowlist");
    expect(parseYaml(byPath.get(".forgeyard/tasks/T001.yaml")!)).toMatchObject({
      schemaVersion: 1,
      id: "T001",
      required: true,
    });
  });

  test("reports native rules and explicit policy limitations", () => {
    expect(createCursorAdapter().capabilities).toEqual({
      projectInstructions: "native",
      projectRules: "native",
      projectSkills: "adapted",
      reviewerAgents: "adapted",
      perAgentModels: "unsupported",
      perAgentToolPolicies: "unsupported",
      importedHooks: "unsupported",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    });
  });

  test("integrates all 490 catalog capabilities and three native workflow rules", async () => {
    const { files } = await fixture("full");

    expect(files.filter((file) => /^\.cursor\/rules\/.*\.mdc$/.test(file.path))).toHaveLength(493);
    expect(files.filter((file) => /^\.cursor\/forgeyard\/agents\/.*\.md$/.test(file.path))).toHaveLength(202);
    expect(files.filter((file) => /^\.cursor\/forgeyard\/skills\/.*\/instructions\.md$/.test(file.path))).toHaveLength(183);
    expect(files.filter((file) => /^\.cursor\/forgeyard\/commands\/.*\.md$/.test(file.path))).toHaveLength(105);
  }, 30_000);

  test("keeps the minimal profile to two native rules", async () => {
    const { files } = await fixture("minimal");

    expect(files.filter((file) => /^\.cursor\/rules\/.*\.mdc$/.test(file.path))).toHaveLength(2);
    expect(files.some((file) => file.componentId.startsWith("ecosystem."))).toBe(false);
    expect(files.some((file) => file.path.startsWith("presentation/"))).toBe(false);
  });
});
