import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadCapabilityRules } from "../../../src/intake/capability-rules.js";
import { composeProject } from "../../../src/intake/compose.js";
import type { ProjectInspection } from "../../../src/intake/contracts.js";

function inspection(overrides: Partial<ProjectInspection> = {}): ProjectInspection {
  return {
    schemaVersion: 1,
    root: "C:/project",
    name: "project",
    request: "Add a verified feature.",
    mode: "existing",
    kind: "unknown",
    languages: [],
    frameworks: [],
    packageManagers: [],
    qualityCommands: [{ name: "diff-check", argv: ["git", "diff", "--check"] }],
    mutableRoots: ["src"],
    instructionSurfaces: [],
    sources: [],
    evidence: [],
    questions: [],
    warnings: [],
    confidence: "medium",
    analysisSha256: "a".repeat(64),
    ...overrides,
  };
}

function ids(items: readonly { id: string }[]): string[] {
  return items.map((item) => item.id);
}

describe("project composition", () => {
  test("loads rules whose plugins all exist in the pinned catalog", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));

    expect(rules.schemaVersion).toBe(1);
    expect(ids(rules.baseline)).toEqual([
      "comprehensive-review",
      "debugging-toolkit",
      "developer-essentials",
      "documentation-generation",
      "git-pr-workflows",
      "tdd-workflows",
    ]);
    expect(ids(rules.exclusions)).toEqual([
      "agent-orchestration",
      "agent-teams",
      "conductor",
      "full-stack-orchestration",
    ]);
  });

  test("selects frontend capabilities without backend or competing orchestrators", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const result = composeProject(inspection({
      kind: "frontend",
      languages: ["typescript"],
      frameworks: ["next.js", "react"],
    }), {}, rules);

    expect(ids(result.selected)).toEqual([
      "accessibility-compliance",
      "application-performance",
      "comprehensive-review",
      "debugging-toolkit",
      "developer-essentials",
      "documentation-generation",
      "frontend-mobile-development",
      "git-pr-workflows",
      "tdd-workflows",
      "ui-design",
    ]);
    expect(ids(result.selected)).not.toContain("backend-development");
    expect(ids(result.selected)).not.toContain("database-design");
    expect(ids(result.selected)).not.toContain("agent-orchestration");
    expect(result.catalog.plugins).toEqual(ids(result.selected));
  });

  test("selects backend capabilities without UI capabilities", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const result = composeProject(inspection({
      kind: "backend",
      languages: ["python"],
      frameworks: ["fastapi"],
    }), {}, rules);

    expect(ids(result.selected)).toEqual([
      "application-performance",
      "backend-development",
      "comprehensive-review",
      "database-design",
      "debugging-toolkit",
      "developer-essentials",
      "documentation-generation",
      "git-pr-workflows",
      "security-scanning",
      "tdd-workflows",
    ]);
    expect(ids(result.selected)).not.toContain("ui-design");
    expect(ids(result.selected)).not.toContain("frontend-mobile-development");
  });

  test("combines full-stack and LLM needs without duplicate plugins", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const result = composeProject(inspection({
      kind: "full-stack",
      frameworks: ["express", "openai", "react"],
      request: "Add an AI-assisted support journey.",
    }), {}, rules);

    expect(ids(result.selected)).toEqual(expect.arrayContaining([
      "backend-development",
      "frontend-mobile-development",
      "llm-application-dev",
      "security-scanning",
      "ui-design",
    ]));
    expect(new Set(ids(result.selected)).size).toBe(result.selected.length);
  });

  test("records every alternative orchestrator as excluded", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const result = composeProject(inspection(), {}, rules);

    expect(result.excluded).toEqual([
      { id: "agent-orchestration", reason: "Forgeyard is the single primary delivery workflow." },
      { id: "agent-teams", reason: "Forgeyard is the single primary delivery workflow." },
      { id: "conductor", reason: "Forgeyard is the single primary delivery workflow." },
      { id: "full-stack-orchestration", reason: "Forgeyard is the single primary delivery workflow." },
    ]);
  });

  test("includes presentation only when requested or explicitly overridden", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const ordinary = composeProject(inspection({ request: "Add a checkout endpoint." }), {}, rules);
    const requested = composeProject(inspection({ request: "Prepare a live demo for reviewers." }), {}, rules);
    const suppressed = composeProject(inspection({ request: "Prepare a live demo for reviewers." }), { presentation: false }, rules);

    expect(ordinary.presentation.enabled).toBe(false);
    expect(ordinary.packs).not.toContain("presentation");
    expect(requested.presentation.enabled).toBe(true);
    expect(requested.packs).toContain("presentation");
    expect(suppressed.presentation.enabled).toBe(false);
    expect(suppressed.packs).not.toContain("presentation");
  });

  test("recommends proportional concurrency and honors a valid override", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const focused = composeProject(inspection({ request: "Fix the login bug." }), { timeboxMinutes: 120 }, rules);
    const frontend = composeProject(inspection({ kind: "frontend" }), {}, rules);
    const fullStack = composeProject(inspection({ kind: "full-stack" }), {}, rules);
    const presentation = composeProject(inspection({ kind: "full-stack", request: "Build and demo the product." }), {}, rules);
    const overridden = composeProject(inspection({ kind: "frontend" }), { maxConcurrency: 12 }, rules);

    expect(focused.orchestration.maxConcurrency).toBe(1);
    expect(focused.packs).toEqual(["ecosystem", "foundation"]);
    expect(frontend.orchestration.maxConcurrency).toBe(2);
    expect(fullStack.orchestration.maxConcurrency).toBe(3);
    expect(presentation.orchestration.maxConcurrency).toBe(4);
    expect(overridden.orchestration.maxConcurrency).toBe(12);
  });

  test.each([0, 17, 2.5])("rejects invalid concurrency %s", async (maxConcurrency) => {
    const rules = await loadCapabilityRules(path.resolve("."));
    expect(() => composeProject(inspection(), { maxConcurrency }, rules)).toThrowError(
      expect.objectContaining({ code: "FY_CONFIG_INVALID" }),
    );
  });

  test("selects the adapter from override, project evidence, availability, or disclosed fallback", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    expect(composeProject(inspection(), { adapter: "cursor" }, rules).adapter).toBe("cursor");
    expect(composeProject(inspection({ instructionSurfaces: ["CLAUDE.md"] }), {}, rules).adapter).toBe("claude-code");
    expect(composeProject(inspection(), { harnessAvailability: { codex: false, "claude-code": true } }, rules).adapter).toBe("claude-code");
    const fallback = composeProject(inspection(), { harnessAvailability: { codex: false, "claude-code": false, cursor: false } }, rules);
    expect(fallback.adapter).toBe("codex");
    expect(fallback.adapterReason).toContain("format fallback");
  });

  test("translates autonomy and budget into a stable operating policy", async () => {
    const rules = await loadCapabilityRules(path.resolve("."));
    const first = composeProject(inspection({ kind: "backend" }), {
      autonomy: "autonomous",
      maxCostUsd: 25,
    }, rules);
    const second = composeProject(inspection({ kind: "backend" }), {
      autonomy: "autonomous",
      maxCostUsd: 25,
    }, rules);

    expect(first.orchestration.mode).toBe("native");
    expect(first.autonomy).toEqual({
      level: "autonomous",
      maxCostUsd: 25,
      stopOnAmbiguity: true,
      externalEffects: "ask",
    });
    expect(first).toEqual(second);
  });
});
