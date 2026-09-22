import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createHarnessAdapter } from "../../../src/adapters/create.js";
import { loadConfig, validateConfig } from "../../../src/config/config.js";
import type { ForgeyardConfig, HarnessId } from "../../../src/core/contracts.js";
import { runDoctor } from "../../../src/doctor/run-doctor.js";
import { applyInstallPlan } from "../../../src/installer/apply.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

const temporaryRoots: string[] = [];

/**
 * A configuration a harness-only project really matches: the frozen gate is the command a fresh
 * inspection itself offers, and the writable root is the one that inspection falls back to.
 */
const SELF_CONSISTENT: Partial<ForgeyardConfig> = {
  quality: { commands: [{ name: "diff-check", argv: ["git", "diff", "--check"] }] },
  paths: { mutableRoots: ["src"], protectedPaths: [".git", ".env"], presentation: "presentation" },
};

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-doctor-"));
  temporaryRoots.push(root);
  return root;
}

async function installed(
  answers: "hackathon" | "minimal",
  profile: "hackathon" | "minimal",
  adapterId: HarnessId,
  overrides: Partial<ForgeyardConfig>,
): Promise<string> {
  const root = await temporaryRoot();
  const baseConfig = await loadConfig(path.resolve(`fixtures/answers/${answers}.yaml`));
  const config = validateConfig({ ...baseConfig, harnesses: [adapterId], ...overrides });
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, profile, adapterId);
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

async function installedRoot(adapterId: HarnessId = "codex"): Promise<string> {
  return installed("hackathon", "hackathon", adapterId, {});
}

/** The smallest harness a capsule can freeze; it keeps a drift comparison quick to read. */
async function minimalRoot(overrides: Partial<ForgeyardConfig> = SELF_CONSISTENT): Promise<string> {
  return installed("minimal", "minimal", "codex", overrides);
}

/**
 * An installed root that matches its own capsule: the frozen gate is the command the project
 * offers, and the protected paths exist. The bounded inspection never walks `.git` or `.env`, so
 * only a dedicated presence probe can tell a project that kept them from one that lost them.
 */
async function alignedRoot(): Promise<string> {
  const root = await minimalRoot();
  await mkdir(path.join(root, ".git"));
  await writeFile(path.join(root, ".env"), "", "utf8");
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
  }, 60_000);

  test("allows human edits to the seed configuration", async () => {
    const root = await installedRoot();
    const configPath = path.join(root, "forgeyard.yaml");
    await writeFile(configPath, `# human note\n${await readFile(configPath, "utf8")}`, "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "managed-files")?.status).toBe("passed");
  }, 60_000);

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
  }, 60_000);

  test("reports managed drift as a required failure", async () => {
    const root = await installedRoot();
    await writeFile(path.join(root, "AGENTS.md"), "changed\n", "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "managed-files")).toEqual(
      expect.objectContaining({ status: "failed", required: true, paths: ["AGENTS.md"] }),
    );
  }, 60_000);

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
  }, 60_000);

  test("cannot compare harness drift in a project without an installed harness", async () => {
    const root = await temporaryRoot();

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "harness-drift")).toEqual({
      id: "harness-drift",
      status: "unavailable",
      required: false,
      message: expect.stringContaining("No readable frozen capsule is available"),
    });
  });

  test("finds no drift between a frozen harness and the project it was frozen from", async () => {
    const root = await alignedRoot();

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "harness-drift")).toEqual({
      id: "harness-drift",
      status: "passed",
      required: false,
      message: expect.stringContaining("still shows what the frozen harness asserts"),
    });
  });

  test("reports a frozen quality gate the project no longer offers without sinking the verdict", async () => {
    const root = await alignedRoot();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "grown", scripts: { test: "node --test" } }, null, 2)}\n`,
      "utf8",
    );

    const report = await runDoctor({ root, commandLookup: async () => false });

    const drift = report.checks.find((check) => check.id === "harness-drift");
    expect(drift).toEqual(expect.objectContaining({ status: "failed", required: false }));
    expect(drift?.message).toContain("1 blocking, 0 important, 1 informational");
    expect(drift?.message).toContain("gate-command-missing 'G001'");
    expect(drift?.message).toContain("language-appeared 'javascript'");
    expect(report.ok).toBe(true);
    expect(report.checks.filter((check) => check.required).every((check) => check.status === "passed")).toBe(true);
  });

  test("reports the protected path the project lost and not the one the inspection skips", async () => {
    const root = await minimalRoot();
    await mkdir(path.join(root, ".git"));

    const report = await runDoctor({ root, commandLookup: async () => false });

    const drift = report.checks.find((check) => check.id === "harness-drift");
    expect(report.ok).toBe(true);
    expect(drift).toEqual(expect.objectContaining({ status: "skipped", required: false, paths: [".env"] }));
    expect(drift?.message).toContain("protected-path-missing '.env'");
    // A capsule protects a path whether or not the project has one, so its absence claims no
    // verdict: an otherwise correct installation must not be counted as a failed check.
    expect(report.checks.every((check) => check.status !== "failed")).toBe(true);
  });

  test("refuses to declare alignment from a partial project inspection", async () => {
    const root = await alignedRoot();
    await mkdir(path.join(root, "d1", "d2", "d3", "d4", "d5", "d6", "d7"), { recursive: true });

    const report = await runDoctor({ root, commandLookup: async () => false });

    const drift = report.checks.find((check) => check.id === "harness-drift");
    expect(report.ok).toBe(true);
    expect(drift).toEqual(expect.objectContaining({ status: "skipped", required: false }));
    expect(drift?.message).toContain("depth-limit");
    expect(drift?.message).toContain("cannot be declared");
  });

  test("leaves a changed harness file to the capsule check", async () => {
    const root = await alignedRoot();
    await writeFile(path.join(root, "AGENTS.md"), "changed\n", "utf8");

    const report = await runDoctor({ root, commandLookup: async () => false });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "capsule")?.status).toBe("failed");
    expect(report.checks.find((check) => check.id === "harness-drift")).toEqual(
      expect.objectContaining({ status: "unavailable", required: false }),
    );
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
  }, 60_000);
});
