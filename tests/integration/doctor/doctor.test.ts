import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createHarnessAdapter } from "../../../src/adapters/create.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import type { HarnessId } from "../../../src/core/contracts.js";
import { runDoctor } from "../../../src/doctor/run-doctor.js";
import { applyInstallPlan } from "../../../src/installer/apply.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

const temporaryRoots: string[] = [];

async function installedRoot(adapterId: HarnessId = "codex"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-doctor-"));
  temporaryRoots.push(root);
  const baseConfig = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
  const config = validateConfig({ ...baseConfig, harnesses: [adapterId] });
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "hackathon", adapterId);
  const renderedFiles = await createHarnessAdapter(adapterId).render(resolved.components, config);
  const plan = buildInstallPlan({
    targetRoot: root,
    config,
    resolved,
    renderedFiles,
    operationId: "20260915T140000000Z-doctor",
    forgeyardVersion: "0.1.0",
  });
  await applyInstallPlan(plan);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Forgeyard doctor", () => {
  test("passes required structural checks without an installed Codex executable", async () => {
    const root = await installedRoot();

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "config", status: "passed", required: true }),
        expect.objectContaining({ id: "managed-files", status: "passed", required: true }),
        expect.objectContaining({ id: "codex-output", status: "passed", required: true }),
        expect.objectContaining({ id: "codex-executable", status: "unavailable", required: false }),
        expect.objectContaining({ id: "codex-roundtrip", status: "skipped", required: false }),
      ]),
    );
    expect(report.checks.filter((check) => check.required).every((check) => check.status === "passed")).toBe(true);
  });

  test("allows human edits to the seed configuration", async () => {
    const root = await installedRoot();
    const configPath = path.join(root, "forgeyard.yaml");
    await writeFile(configPath, `# human note\n${await readFile(configPath, "utf8")}`, "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "managed-files")?.status).toBe("passed");
  });

  test("validates a Claude Code install and probes the correct executable name", async () => {
    const root = await installedRoot("claude-code");
    const lookedUp: string[] = [];

    const report = await runDoctor({
      root,
      commandLookup: async (name) => {
        lookedUp.push(name);
        return false;
      },
    });

    expect(report.ok).toBe(true);
    expect(lookedUp).toEqual(["claude"]);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claude-code-output", status: "passed", required: true }),
      expect.objectContaining({ id: "claude-code-executable", status: "unavailable", required: false }),
      expect.objectContaining({ id: "claude-code-roundtrip", status: "skipped", required: false }),
    ]));
  }, 30_000);

  test("validates a Cursor install and probes the CLI executable name", async () => {
    const root = await installedRoot("cursor");
    const lookedUp: string[] = [];

    const report = await runDoctor({
      root,
      commandLookup: async (name) => {
        lookedUp.push(name);
        return false;
      },
    });

    expect(report.ok).toBe(true);
    expect(lookedUp).toEqual(["cursor-agent"]);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cursor-output", status: "passed", required: true }),
      expect.objectContaining({ id: "cursor-executable", status: "unavailable", required: false }),
      expect.objectContaining({ id: "cursor-roundtrip", status: "skipped", required: false }),
    ]));
  }, 30_000);

  test("reports managed drift as a required failure", async () => {
    const root = await installedRoot();
    await writeFile(path.join(root, "AGENTS.md"), "changed\n", "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "managed-files")).toEqual(
      expect.objectContaining({ status: "failed", required: true, paths: ["AGENTS.md"] }),
    );
  });

  test("does not echo caller-supplied deny terms in plain report data", async () => {
    const root = await installedRoot();
    await writeFile(path.join(root, "AGENTS.md"), "Example Sponsor\n", "utf8");

    const report = await runDoctor({
      root,
      denyTerms: ["Example Sponsor"],
      commandLookup: async () => false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "content-audit")).toEqual(
      expect.objectContaining({ status: "failed", paths: ["AGENTS.md"] }),
    );
    expect(JSON.stringify(report).toLocaleLowerCase("en-US")).not.toContain("example sponsor");
  });

  test("fails safely on a traversal path in a malformed manifest", async () => {
    const root = await installedRoot();
    const manifestPath = path.join(root, ".forgeyard", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files[0].path = "../outside.txt";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "manifest")?.status).toBe("failed");
    expect(report.checks.filter((check) => check.required).every((check) => check.status !== "skipped")).toBe(true);
  });
});
