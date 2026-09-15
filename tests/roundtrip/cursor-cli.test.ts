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
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-cursor-roundtrip-"));
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
    "cursor",
    "--answers",
    path.join(repositoryRoot, "fixtures", "answers", `cursor-${profile}.yaml`),
    "--yes",
    "--json",
  ], sandboxRoot);
  return {
    result,
    output: JSON.parse(result.stdout) as InitCommandResult,
    manifest: await loadInstallManifest(target),
  };
}

describe("built Cursor CLI adapter", () => {
  test("installs the minimal native rule workflow", async () => {
    const { result, output, manifest } = await install("minimal");

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.adapter).toBe("cursor");
    expect(manifest.files.filter((file) => /^\.cursor\/rules\/.*\.mdc$/.test(file.path))).toHaveLength(2);
    expect(manifest.files.some((file) => file.path === "AGENTS.md")).toBe(true);
  }, 30_000);

  test("installs the curated idea-to-demo rule library", async () => {
    const { result, output, manifest } = await install("hackathon");

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.files.filter((file) => /^\.cursor\/rules\/.*\.mdc$/.test(file.path))).toHaveLength(171);
    expect(manifest.files.some((file) => file.path === "presentation/index.html")).toBe(true);
  }, 60_000);

  test("installs all 490 catalog rules and their complete local sources", async () => {
    const { result, output, manifest } = await install("full");

    expect(result).toEqual(expect.objectContaining({ exitCode: 0, stderr: "" }));
    expect(output.doctor).toEqual(expect.objectContaining({ failed: 0 }));
    expect(manifest.files.filter((file) => /^\.cursor\/rules\/.*\.mdc$/.test(file.path))).toHaveLength(493);
    expect(manifest.files.filter((file) => /^\.cursor\/forgeyard\/agents\/.*\.md$/.test(file.path))).toHaveLength(202);
    expect(manifest.files.filter((file) => /^\.cursor\/forgeyard\/skills\/.*\/instructions\.md$/.test(file.path))).toHaveLength(183);
    expect(manifest.files.filter((file) => /^\.cursor\/forgeyard\/commands\/.*\.md$/.test(file.path))).toHaveLength(105);
    expect(manifest.files.some((file) => file.path === ".forgeyard/catalog/ecosystem.json")).toBe(true);
    expect(manifest.files.some((file) => file.path === ".forgeyard/licenses/wshobson-agents.LICENSE")).toBe(true);
  }, 60_000);
});
