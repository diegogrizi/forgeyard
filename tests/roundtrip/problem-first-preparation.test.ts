import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 40,9 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
import { parse as parseYaml } from "yaml";

import type { PrepareCommandResult, UpdateCommandResult } from "../../src/application/forgeyard.js";
import type { DoctorCommandResult } from "../../src/application/forgeyard.js";
import type { ForgeyardConfig } from "../../src/core/contracts.js";
import { buildCli, runBuiltCli } from "../helpers/cli.js";

const repositoryRoot = path.resolve(".");
let sandboxRoot: string;

beforeAll(async () => {
  await buildCli(repositoryRoot);
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-problem-first-"));
});
afterAll(async () => {
  if (sandboxRoot !== undefined) await rm(sandboxRoot, { recursive: true, force: true });
});

async function prepare(target: string, brief: string): Promise<PrepareCommandResult> {
  const result = await runBuiltCli(repositoryRoot, ["prepare", target, "--brief", brief, "--yes", "--json"], sandboxRoot);
  if (result.exitCode !== 0) throw new Error(`prepare failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as PrepareCommandResult;
}

async function doctor(target: string): Promise<DoctorCommandResult> {
  const result = await runBuiltCli(repositoryRoot, ["doctor", target, "--json"], sandboxRoot);
  if (result.exitCode !== 0) throw new Error(`doctor failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as DoctorCommandResult;
}

describe("problem-first packaged preparation", () => {
  test("the same factory prepares distinct pinned frontend and backend suites", async () => {
    const frontend = path.join(sandboxRoot, "frontend");
    const backend = path.join(sandboxRoot, "backend");
    await mkdir(path.join(frontend, "app"), { recursive: true });
    await mkdir(path.join(backend, "api"), { recursive: true });
    await writeFile(path.join(frontend, "package.json"), JSON.stringify({
      name: "checkout-ui",
      scripts: { test: "node -e \"process.exit(0)\"" },
      dependencies: { next: "16.0.0", react: "19.0.0" },
      devDependencies: { typescript: "6.0.0" },
    }, null, 2));
    await writeFile(path.join(frontend, "tsconfig.json"), "{}\n");
    const originalInstructions = "# Existing project instructions\n\nKeep the product API stable.\n";
    await writeFile(path.join(frontend, "AGENTS.md"), originalInstructions);
    await writeFile(path.join(backend, "pyproject.toml"), [
      "[project]",
      'name = "balance-api"',
      'dependencies = ["fastapi", "pytest"]',
      "",
    ].join("\n"));

    const frontendResult = await prepare(frontend, "Add accessible checkout recovery.");
    const backendResult = await prepare(backend, "Add a validated balance endpoint.");
    const frontendConfig = parseYaml(await readFile(path.join(frontend, "forgeyard.yaml"), "utf8")) as ForgeyardConfig;
    const backendConfig = parseYaml(await readFile(path.join(backend, "forgeyard.yaml"), "utf8")) as ForgeyardConfig;

    expect(frontendResult.status).toBe("applied");
    expect(backendResult.status).toBe("applied");
    expect(frontendConfig.profile).toBe("tailored");
    expect(backendConfig.profile).toBe("tailored");
    expect(frontendConfig.catalog.plugins).toContain("ui-design");
    expect(frontendConfig.catalog.plugins).not.toContain("backend-development");
    expect(backendConfig.catalog.plugins).toContain("backend-development");
    expect(backendConfig.catalog.plugins).not.toContain("ui-design");
    for (const config of [frontendConfig, backendConfig]) {
      expect(config.composition?.strategy).toBe("automatic");
      expect(config.catalog.plugins).not.toEqual(expect.arrayContaining([
        "agent-orchestration", "agent-teams", "conductor", "full-stack-orchestration",
      ]));
      expect(config.intake?.evidence.length).toBeGreaterThan(0);
    }
    expect(frontendConfig.intake?.evidence.map((item) => item.path)).toContain("package.json");
    expect(backendConfig.intake?.evidence.map((item) => item.path)).toContain("pyproject.toml");
    expect(await readFile(path.join(frontend, "AGENTS.md"), "utf8")).toBe(originalInstructions);
    expect(await readFile(path.join(frontend, ".forgeyard", "HOST.md"), "utf8")).toContain("Do not ask the user to choose catalog skills");
    expect(await readFile(path.join(frontend, ".forgeyard", "COMPOSITION.md"), "utf8")).toContain("next.js");
    expect(await readFile(path.join(backend, ".forgeyard", "COMPOSITION.md"), "utf8")).toContain("fastapi");
    expect((await doctor(frontend)).summary.failed).toBe(0);
    expect((await doctor(backend)).summary.failed).toBe(0);

    const updateProcess = await runBuiltCli(repositoryRoot, ["update", frontend, "--dry-run", "--json"], sandboxRoot);
    expect(updateProcess.exitCode).toBe(0);
    const update = JSON.parse(updateProcess.stdout) as UpdateCommandResult;
    expect(update.status).toBe("no-op");
    expect(update.changes.updated).toEqual([]);
    expect(update.changes.removed).toEqual([]);
  });
});
