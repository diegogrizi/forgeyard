import path from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";

import { createClaudeCodeAdapter } from "../../../src/adapters/claude-code.js";
import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { createCursorAdapter } from "../../../src/adapters/cursor.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import type { ForgeyardConfig, HarnessAdapter, HarnessId } from "../../../src/core/contracts.js";
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

function tailoredConfig(harness: HarnessId, existingInstruction?: string): ForgeyardConfig {
  return validateConfig({
    schemaVersion: 1,
    project: { name: "Checkout UI", purpose: "Add accessible checkout recovery.", mode: "existing" },
    harnesses: [harness],
    profile: "tailored",
    catalog: {
      selection: "curated",
      plugins: ["accessibility-compliance", "developer-essentials", "tdd-workflows", "ui-design"],
    },
    timeboxMinutes: 240,
    quality: { commands: [{ name: "test", argv: ["npm", "test"] }] },
    paths: {
      mutableRoots: ["app"],
      protectedPaths: [".git", ".env"],
      presentation: "presentation",
    },
    orchestration: { mode: "native", maxConcurrency: 2 },
    presentation: { enabled: false, audience: "Project stakeholders", durationMinutes: 7, offline: true },
    intake: {
      strategy: "automatic",
      request: "Add accessible checkout recovery.",
      sources: ["requirements.md"],
      kind: "frontend",
      languages: ["typescript"],
      frameworks: ["next.js", "react"],
      evidence: [
        { path: "package.json", signal: "dependency:next" },
        ...(existingInstruction === undefined ? [] : [{ path: existingInstruction, signal: `host-instructions:${harness}` }]),
      ],
      confidence: "high",
      questions: [],
    },
    composition: {
      strategy: "automatic",
      packs: ["foundation", "delivery", "ecosystem"],
      selected: [
        { id: "accessibility-compliance", reason: "The project has a user interface." },
        { id: "developer-essentials", reason: "Core delivery practices are required." },
        { id: "tdd-workflows", reason: "Behavior changes require tests." },
        { id: "ui-design", reason: "The project has a user interface." },
      ],
      excluded: [{ id: "agent-orchestration", reason: "Forgeyard is the single primary delivery workflow." }],
      analysisSha256: "a".repeat(64),
    },
    autonomy: { level: "balanced", maxCostUsd: 20, stopOnAmbiguity: true, externalEffects: "ask" },
  });
}

async function renderTailored(harness: HarnessId, factory: () => HarnessAdapter, existingInstruction?: string) {
  const config = tailoredConfig(harness, existingInstruction);
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, config.profile, harness, config.catalog, config.composition!.packs);
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

  test("renders the stored decision and omits unselected presentation work", async () => {
    const { files } = await renderTailored(harness, factory);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("Primary workflow: Forgeyard");
    expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("next.js");
    expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("Excluded: `agent-orchestration`");
    expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("Maximum recorded cost: USD 20");
    expect(byPath.get("PROJECT.md")).toContain("Add accessible checkout recovery.");
    expect(byPath.get("PROJECT.md")).toContain("requirements.md");
    const tasks = ["T001", "T002", "T003"].map((id) =>
      parseYaml(byPath.get(`.forgeyard/tasks/${id}.yaml`)!) as {
        title: string;
        objective: string;
        acceptanceCriteria: string[];
        role: string;
        capabilities: string[];
        limits: { maxCostUsd?: number };
      }
    );
    for (const task of tasks) {
      expect(`${task.title}\n${task.objective}\n${task.acceptanceCriteria.join("\n")}`)
        .toContain("Add accessible checkout recovery.");
      expect(task.capabilities).toEqual(expect.arrayContaining(["developer-essentials", "tdd-workflows"]));
    }
    expect(tasks.map((task) => task.role)).toEqual([
      "frontend-implementer",
      "frontend-implementer",
      "read-only-reviewer",
    ]);
    expect(tasks.every((task) => task.limits.maxCostUsd !== undefined)).toBe(true);
    expect(tasks.reduce((sum, task) => sum + task.limits.maxCostUsd!, 0)).toBeCloseTo(20, 6);
    const instruction = files.find((file) => file.componentId === "foundation.project-instructions");
    expect(instruction?.content).toContain("Do not ask the user to choose catalog skills");
    expect(byPath.has(".forgeyard/tasks/T004.yaml")).toBe(false);
    expect(byPath.has("presentation/index.html")).toBe(false);
  });
});

test("Codex preserves an existing AGENTS.md instruction surface", async () => {
  const { files } = await renderTailored("codex", createCodexAdapter, "AGENTS.md");

  expect(files.some((file) => file.path === "AGENTS.md")).toBe(false);
  expect(files.find((file) => file.componentId === "foundation.project-instructions")?.path)
    .toBe(".forgeyard/HOST.md");
});

test("Claude Code preserves an existing CLAUDE.md instruction surface", async () => {
  const { files } = await renderTailored("claude-code", createClaudeCodeAdapter, "CLAUDE.md");

  expect(files.some((file) => file.path === "CLAUDE.md")).toBe(false);
  expect(files.find((file) => file.componentId === "foundation.project-instructions")?.path)
    .toBe(".forgeyard/HOST.md");
});
