import path from "node:path";

import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { createClaudeCodeAdapter } from "../../../src/adapters/claude-code.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

async function fixture(profile: "minimal" | "hackathon" | "full" = "hackathon") {
  const base = await loadConfig(path.resolve(`fixtures/answers/${profile}.yaml`));
  const config = validateConfig({ ...base, harnesses: ["claude-code"] });
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, profile, "claude-code", config.catalog);
  const adapter = createClaudeCodeAdapter();
  const files = await adapter.render(resolved.components, config);
  await adapter.validateOutput(files);
  return { adapter, config, files, resolved };
}

function metadata(content: string): Record<string, unknown> {
  return parseYaml(content.split("---\n")[1]!) as Record<string, unknown>;
}

describe("Claude Code adapter", () => {
  test("maps foundation and presentation to project-native paths with safe settings", async () => {
    const { files } = await fixture();
    const paths = files.map((file) => file.path);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(paths.slice(0, 10)).toEqual([
      "CLAUDE.md",
      ".claude/settings.json",
      ".claude/skills/forgeyard-workflow/SKILL.md",
      ".claude/agents/forgeyard-reviewer.md",
      ".forgeyard/tasks/T001.yaml",
      ".claude/skills/forgeyard-showcase/SKILL.md",
      "presentation/index.html",
      "presentation/styles.css",
      "presentation/app.js",
      "presentation/README.md",
    ]);
    expect(JSON.parse(byPath.get(".claude/settings.json")!)).toEqual({
      disableSkillShellExecution: true,
    });
    expect(byPath.get("CLAUDE.md")).toContain(".claude/skills/forgeyard-workflow/SKILL.md");
    expect(byPath.get("CLAUDE.md")).not.toContain(".agents/skills/");
  });

  test("renders valid native skill, reviewer, and task documents", async () => {
    const { files } = await fixture();
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const reviewer = metadata(byPath.get(".claude/agents/forgeyard-reviewer.md")!);
    const task = parseYaml(byPath.get(".forgeyard/tasks/T001.yaml")!);

    expect(metadata(byPath.get(".claude/skills/forgeyard-workflow/SKILL.md")!)).toMatchObject({
      name: "forgeyard-workflow",
      description: expect.any(String),
    });
    expect(reviewer).toMatchObject({
      name: "forgeyard-reviewer",
      description: expect.any(String),
      model: "inherit",
      tools: ["Read", "Glob", "Grep"],
      disallowedTools: ["Write", "Edit", "Bash", "NotebookEdit"],
    });
    expect(byPath.get(".claude/agents/forgeyard-reviewer.md")).toContain("Remain read-only");
    expect(task).toMatchObject({ schemaVersion: 1, id: "T001", required: true });
  });

  test("reports native Claude Code discovery without claiming a scheduler", () => {
    expect(createClaudeCodeAdapter().capabilities).toEqual({
      projectInstructions: "native",
      projectSkills: "native",
      reviewerAgents: "native",
      importedHooks: "unsupported",
      skillShellExpansion: "unsupported",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    });
  });

  test("integrates the complete catalog with Forgeyard-native output", async () => {
    const { files } = await fixture("full");

    expect(files.filter((file) => /^\.claude\/agents\/.*\.md$/.test(file.path))).toHaveLength(203);
    expect(files.filter((file) => /^\.claude\/skills\/.*\/SKILL\.md$/.test(file.path))).toHaveLength(185);
    expect(files.filter((file) => /^\.claude\/commands\/.*\.md$/.test(file.path))).toHaveLength(105);
    expect(files.some((file) => file.path === ".forgeyard/catalog/ecosystem.json")).toBe(true);
  }, 30_000);

  test("keeps the minimal profile small and catalog-free", async () => {
    const { files } = await fixture("minimal");

    expect(files.filter((file) => file.path.startsWith(".claude/agents/"))).toHaveLength(1);
    expect(files.filter((file) => file.path.endsWith("/SKILL.md"))).toHaveLength(1);
    expect(files.some((file) => file.componentId.startsWith("ecosystem."))).toBe(false);
    expect(files.some((file) => file.path.startsWith("presentation/"))).toBe(false);
  });
});
