import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderClaudeCodeCatalog } from "../../../src/adapters/claude-code-catalog.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-claude-catalog-"));
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
      "---\nname: reviewer\ndescription: Read-only review.\nmodel: inherit\ntools: [Read, Grep]\nhooks:\n  Stop: forbidden\n---\n# Reviewer\n\nInspect changes.\n",
    ),
    treeFile(
      root,
      "plugins/example/skills/review/SKILL.md",
      "---\nname: review\ndescription: Use when reviewing changes.\nallowed-tools: [Read]\nhooks:\n  Stop: forbidden\n---\n# Review\n\nRead references/checklist.md.\n",
    ),
    treeFile(root, "plugins/example/skills/review/references/checklist.md", "# Checklist\n"),
    treeFile(
      root,
      "plugins/example/commands/review.md",
      "---\ndescription: Run a complete review.\nargument-hint: <path>\nallowed-tools: [Read]\n---\n# Review command\n\nReview $ARGUMENTS.\n",
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

describe("Claude Code portable catalog renderer", () => {
  test("renders native namespaced agents, skills, commands, references, license, and index", async () => {
    const files = await renderClaudeCodeCatalog(await componentFixture(), ["example"]);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(files.map((file) => file.path)).toEqual([
      ".claude/skills/example--review/SKILL.md",
      ".claude/skills/example--review/references/checklist.md",
      ".claude/commands/example--review--command.md",
      ".claude/agents/example--reviewer.md",
      ".forgeyard/catalog/ecosystem.json",
      ".forgeyard/licenses/wshobson-agents.LICENSE",
    ]);
    expect(metadata(byPath.get(".claude/skills/example--review/SKILL.md")!)).toMatchObject({
      name: "example--review",
      description: "Use when reviewing changes.",
      "allowed-tools": ["Read"],
    });
    expect(metadata(byPath.get(".claude/skills/example--review/SKILL.md")!)).not.toHaveProperty("hooks");
    expect(metadata(byPath.get(".claude/commands/example--review--command.md")!)).toMatchObject({
      description: "Run a complete review.",
      "argument-hint": "<path>",
      "allowed-tools": ["Read"],
    });
    expect(byPath.get(".claude/commands/example--review--command.md")).toContain("$ARGUMENTS");
    expect(metadata(byPath.get(".claude/agents/example--reviewer.md")!)).toMatchObject({
      name: "example--reviewer",
      description: "Read-only review.",
      model: "inherit",
      tools: ["Read", "Grep"],
    });
    expect(metadata(byPath.get(".claude/agents/example--reviewer.md")!)).not.toHaveProperty("hooks");
    expect(byPath.get(".claude/agents/example--reviewer.md")).toContain("Inspect changes.");
    expect(JSON.parse(byPath.get(".forgeyard/catalog/ecosystem.json")!)).toMatchObject({
      adapter: "claude-code",
      selectedPlugins: ["example"],
      counts: { agents: 1, skills: 1, commands: 1 },
      disabled: { importedHookFiles: 1, frontmatterHooks: 2 },
    });
    expect(files.every((file) => file.componentId.startsWith("ecosystem."))).toBe(true);
  });

  test("rejects unknown plugin selections without partial output", async () => {
    await expect(renderClaudeCodeCatalog(await componentFixture(), ["missing"])).rejects.toMatchObject({
      code: "FY_CATALOG_INVALID",
    });
  });
});
