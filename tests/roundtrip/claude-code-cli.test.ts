import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { InitCommandResult } from "../../src/application/forgeyard.js";
import { loadInstallManifest } from "../../src/installer/manifest.js";
import { buildCli, runBuiltCli } from "../helpers/cli.js";

const repositoryRoot = path.resolve(".");
let sandboxRoot: string;

beforeAll(async () => {
  await buildCli(repositoryRoot);
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-claude-roundtrip-"));
}, 60_000);

afterAll(async () => {
  if (sandboxRoot !== undefined) await rm(sandboxRoot, { recursive: true, force: true });
});

async function install(profile: "minimal" | "hackathon" | "full") {
  const target = path.join(sandboxRoot, profile);
  const result = await runBuiltCli(repositoryRoot, [
    "init",
    target,
    "--profile",
    profile,
    "--adapter",
    "claude-code",
    "--answers",
    path.join(repositoryRoot, "fixtures", "answers", `claude-code-${profile}.yaml`),
    "--yes",
    "--json",
  ], sandboxRoot);
  return {
    result,
    output: JSON.parse(result.stdout) as InitCommandResult,
    manifest: await loadInstallManifest(target),
  };
}

describe("built Claude Code CLI adapter", () => {
  test("installs the minimal native project workflow", async () => {
    const { result, output, manifest } = await install("minimal");

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.adapter).toBe("claude-code");
    expect(manifest.files.filter((file) => file.path.startsWith(".claude/agents/"))).toHaveLength(1);
    expect(manifest.files.filter((file) => file.path.endsWith("/SKILL.md"))).toHaveLength(1);
    expect(manifest.files.some((file) => file.path === "CLAUDE.md")).toBe(true);
    expect(manifest.files.some((file) => file.path === ".claude/settings.json")).toBe(true);
  }, 30_000);

  test("installs the curated native idea-to-demo library", async () => {
    const { result, output, manifest } = await install("hackathon");
    const skillCount = manifest.files.filter((file) => /^\.claude\/skills\/.*\/SKILL\.md$/.test(file.path)).length;
    const commandCount = manifest.files.filter((file) => /^\.claude\/commands\/.*\.md$/.test(file.path)).length;

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.files.filter((file) => /^\.claude\/agents\/.*\.md$/.test(file.path))).toHaveLength(52);
    expect(skillCount + commandCount).toBe(119);
    expect(manifest.files.some((file) => file.path === "presentation/index.html")).toBe(true);
  }, 60_000);

  test("installs every catalog agent, skill, command, reference, and license", async () => {
    const { result, output, manifest } = await install("full");

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.files.filter((file) => /^\.claude\/agents\/.*\.md$/.test(file.path))).toHaveLength(203);
    expect(manifest.files.filter((file) => /^\.claude\/skills\/.*\/SKILL\.md$/.test(file.path))).toHaveLength(185);
    expect(manifest.files.filter((file) => /^\.claude\/commands\/.*\.md$/.test(file.path))).toHaveLength(105);
    expect(manifest.files.some((file) => file.path === ".forgeyard/catalog/ecosystem.json")).toBe(true);
    expect(manifest.files.some((file) => file.path === ".forgeyard/licenses/wshobson-agents.LICENSE")).toBe(true);
  }, 60_000);
});
