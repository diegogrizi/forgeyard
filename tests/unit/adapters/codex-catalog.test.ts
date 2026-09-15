import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { renderCodexCatalog } from "../../../src/adapters/codex-catalog.js";
import type { ComponentTreeFile, ResolvedComponent } from "../../../src/core/contracts.js";
import { sha256Text } from "../../../src/core/hash.js";

const temporaryRoots: string[] = [];

async function treeFile(root: string, relativePath: string, content: string): Promise<ComponentTreeFile> {
  const sourcePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, content, "utf8");
  return { relativePath, sourcePath, sha256: sha256Text(content) };
}

async function componentFixture(options: { oversized?: boolean } = {}): Promise<ResolvedComponent> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-codex-catalog-"));
  temporaryRoots.push(root);
  const longBody = options.oversized
    ? `# Large\n\n## Kept\n\n${"a".repeat(6_900)}\n\n\`\`\`md\n## Not a split point\n${"b".repeat(1_100)}\n\`\`\`\n\n## Overflow\n\n${"c".repeat(1_500)}\n`
    : "# Review\n\nUse the Read tool before the Bash tool.\n";
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
      "---\nname: reviewer\ndescription: Read-only review.\nmodel: inherit\ntools: [Read, Grep]\n---\n# Reviewer\n\nInspect changes.\n",
    ),
    treeFile(
      root,
      "plugins/example/skills/review/SKILL.md",
      `---\nname: review\ndescription: Use when reviewing changes.\nallowed-tools: [Read]\n---\n${longBody}`,
    ),
    treeFile(root, "plugins/example/skills/review/references/checklist.md", "# Checklist\n"),
    treeFile(
      root,
      "plugins/example/commands/review.md",
      "---\ndescription: Run a complete review.\nargument-hint: <path>\n---\n# Review command\n",
    ),
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex portable catalog renderer", () => {
  test("renders namespaced skills, references, agents, commands, license, and index", async () => {
    const files = await renderCodexCatalog(await componentFixture(), ["example"]);
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(files.map((file) => file.path)).toEqual([
      ".agents/skills/example--review/SKILL.md",
      ".agents/skills/example--review/references/checklist.md",
      ".agents/skills/example--review--command/SKILL.md",
      ".codex/agents/example--reviewer.toml",
      ".forgeyard/catalog/ecosystem.json",
      ".forgeyard/licenses/wshobson-agents.LICENSE",
    ]);
    expect(parseYaml(byPath.get(".agents/skills/example--review/SKILL.md")!.split("---\n")[1]!)).toMatchObject({
      name: "example--review",
      description: "Use when reviewing changes.",
    });
    expect(byPath.get(".agents/skills/example--review/SKILL.md")).not.toContain("allowed-tools:");
    expect(byPath.get(".agents/skills/example--review/SKILL.md")).toContain("open the file");
    expect(parseToml(byPath.get(".codex/agents/example--reviewer.toml")!)).toMatchObject({
      name: "example--reviewer",
      sandbox_mode: "read-only",
      developer_instructions: expect.stringContaining("Inspect changes."),
    });
    expect(JSON.parse(byPath.get(".forgeyard/catalog/ecosystem.json")!)).toMatchObject({
      selectedPlugins: ["example"],
      counts: { agents: 1, skills: 1, commands: 1 },
      unsupported: { hooks: 0 },
    });
    expect(files.every((file) => file.componentId.startsWith("ecosystem."))).toBe(true);
  });

  test("splits oversized skills outside fenced blocks and preserves valid UTF-8", async () => {
    const files = await renderCodexCatalog(await componentFixture({ oversized: true }), ["example"]);
    const primary = files.find((file) => file.path === ".agents/skills/example--review/SKILL.md")!;
    const overflow = files.find((file) => file.path.endsWith("references/_forgeyard-overflow.md"));

    expect(Buffer.byteLength(primary.content, "utf8")).toBeLessThanOrEqual(8_192);
    expect(primary.content).toContain("references/_forgeyard-overflow.md");
    expect(overflow?.content).toContain("## Not a split point");
    expect(overflow?.content).toContain("## Overflow");
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(primary.content))).not.toThrow();
  });
});
