import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderCursorCatalog } from "../../../src/adapters/cursor-catalog.js";
import type { ComponentTreeFile, ResolvedComponent } from "../../../src/core/contracts.js";
import { sha256Text } from "../../../src/core/hash.js";

const temporaryRoots: string[] = [];

async function treeFile(root: string, relativePath: string, content: string): Promise<ComponentTreeFile> {
  const sourcePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, content, "utf8");
  return { relativePath, sourcePath, sha256: sha256Text(content) };
}

async function componentFixture(): Promise<ResolvedComponent> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-cursor-catalog-"));
  temporaryRoots.push(root);
  const files = await Promise.all([
    treeFile(root, "LICENSE", "MIT License\n"),
    treeFile(root, "UPSTREAM.json", '{"revision":"fixture"}\n'),
    treeFile(
      root,
      "plugins/example/.claude-plugin/plugin.json",
      '{"name":"example","version":"1.0.0","description":"Example","license":"MIT"}\n',
    ),
    treeFile(
      root,
      "plugins/example/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Review changes.\nmodel: opus\ntools: [Read, Grep]\nisolation: worktree\n---\n# Reviewer\n\nInspect changes.\n",
    ),
    treeFile(
      root,
      "plugins/example/skills/review/SKILL.md",
      "---\nname: review\ndescription: Use when reviewing changes.\nallowed-tools: [Read]\n---\n# Review\n\nRead references/checklist.md.\n",
    ),
    treeFile(root, "plugins/example/skills/review/references/checklist.md", "# Checklist\n"),
    treeFile(
      root,
      "plugins/example/commands/review.md",
      "---\ndescription: Run a complete review.\nargument-hint: <path>\n---\n# Review command\n\nReview $ARGUMENTS.\n",
    ),
    treeFile(root, "plugins/example/hooks/hooks.json", '{"hooks":{}}\n'),
  ]);
  return {
    id: "ecosystem.portable-catalog",
    kind: "catalog",
    entry: "vendor",
    entryType: "tree",
    format: "portable-plugin-marketplace-v1",
    slot: "catalog.portable.primary",
    template: false,
    ownership: "managed",
    requires: [],
    conflicts: [],
    packId: "ecosystem",
    packVersion: "1.0.0",
    sourcePath: root,
    sha256: "a".repeat(64),
    treeFiles: files,
  };
}

function metadata(content: string): Record<string, unknown> {
  return parseYaml(content.split("---\n")[1]!) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cursor portable catalog renderer", () => {
  test("renders compact requested rules backed by complete local instruction files", async () => {
    const files = await renderCursorCatalog(await componentFixture(), ["example"]);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(files.map((file) => file.path)).toEqual([
      ".cursor/forgeyard/skills/example--review/instructions.md",
      ".cursor/forgeyard/skills/example--review/references/checklist.md",
      ".cursor/rules/catalog--skill--example--review.mdc",
      ".cursor/forgeyard/commands/example--review.md",
      ".cursor/rules/catalog--command--example--review.mdc",
      ".cursor/forgeyard/agents/example--reviewer.md",
      ".cursor/rules/catalog--agent--example--reviewer.mdc",
      ".forgeyard/catalog/ecosystem.json",
      ".forgeyard/licenses/wshobson-agents.LICENSE",
    ]);
    const skillRule = byPath.get(".cursor/rules/catalog--skill--example--review.mdc")!;
    expect(metadata(skillRule)).toMatchObject({
      description: "Use when reviewing changes.",
      globs: [],
      alwaysApply: false,
    });
    expect(skillRule).toContain("@.cursor/forgeyard/skills/example--review/instructions.md");
    expect(byPath.get(".cursor/forgeyard/skills/example--review/instructions.md")).toContain("references/checklist.md");
    expect(byPath.get(".cursor/forgeyard/agents/example--reviewer.md")).toContain("Inspect changes.");
    expect(byPath.get(".cursor/forgeyard/commands/example--review.md")).toContain("$ARGUMENTS");
    expect(files.filter((file) => file.path.endsWith(".mdc"))).toHaveLength(3);
    expect(files.every((file) => !file.path.includes("/hooks/"))).toBe(true);
    expect(JSON.parse(byPath.get(".forgeyard/catalog/ecosystem.json")!)).toMatchObject({
      adapter: "cursor",
      counts: { agents: 1, skills: 1, commands: 1, rules: 3 },
      unsupported: {
        importedHookFiles: 1,
        agentModelPolicies: 1,
        agentToolPolicies: 1,
        agentIsolationPolicies: 1,
      },
    });
  });

  test("keeps discovery rules compact even when instruction bodies are large", async () => {
    const component = await componentFixture();
    const skill = component.treeFiles!.find((file) => file.relativePath.endsWith("skills/review/SKILL.md"))!;
    await writeFile(skill.sourcePath, `---\nname: review\ndescription: Large review.\n---\n${"x".repeat(30_000)}\n`, "utf8");
    const updated = {
      ...component,
      treeFiles: component.treeFiles!.map((file) => file === skill
        ? { ...file, sha256: sha256Text(`---\nname: review\ndescription: Large review.\n---\n${"x".repeat(30_000)}\n`) }
        : file),
    };

    const files = await renderCursorCatalog(updated, ["example"]);
    const rule = files.find((file) => file.path === ".cursor/rules/catalog--skill--example--review.mdc")!;
    const instructions = files.find((file) => file.path.endsWith("skills/example--review/instructions.md"))!;

    expect(Buffer.byteLength(rule.content, "utf8")).toBeLessThan(2_048);
    expect(Buffer.byteLength(instructions.content, "utf8")).toBeGreaterThan(30_000);
  });
});
