import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 16,8 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

import { createForgeyardService } from "../../../src/application/forgeyard.js";
import type { PromptDriver } from "../../../src/config/wizard.js";
import type { DoctorReport } from "../../../src/core/contracts.js";
import { loadInstallManifest } from "../../../src/installer/manifest.js";

const roots: string[] = [];
const registryRoot = path.resolve(".");
const answersPath = path.resolve("fixtures/answers/hackathon.yaml");

async function freshTarget(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-service-"));
  roots.push(root);
  return path.join(root, "target");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function prompts(confirmResult: boolean): PromptDriver & { confirm: ReturnType<typeof vi.fn> } {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected wizard prompt");
  };
  return {
    input: unexpected,
    select: unexpected,
    number: unexpected,
    confirm: vi.fn(async () => confirmResult),
  };
}

function failedDoctor(root: string): DoctorReport {
  return {
    schemaVersion: 1,
    ok: false,
    root,
    checks: [{ id: "injected", status: "failed", required: true, message: "Injected failure." }],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Forgeyard application transaction boundary", () => {
  test("a declined write returns a successful preview and creates nothing", async () => {
    const targetRoot = await freshTarget();
    const promptDriver = prompts(false);
    const service = createForgeyardService({
      prompts: promptDriver,
      registryRoot,
      operationId: () => "20260915T150000000Z-decline",
    });

    const result = await service.init({
      targetRoot,
      profile: "hackathon",
      adapter: "codex",
      answersPath,
      yes: false,
      dryRun: false,
      nonInteractive: false,
    });

    expect(result).toEqual(expect.objectContaining({ applied: false, status: "declined", doctor: null }));
    expect(promptDriver.confirm).toHaveBeenCalledOnce();
    expect(await exists(targetRoot)).toBe(false);
  });

  test("a deterministic no-op update never asks for confirmation", async () => {
    const targetRoot = await freshTarget();
    const promptDriver = prompts(true);
    const ids = ["20260915T150100000Z-install", "20260915T150200000Z-update"];
    const service = createForgeyardService({
      prompts: promptDriver,
      registryRoot,
      operationId: () => ids.shift()!,
    });
    await service.init({
      targetRoot,
      profile: "hackathon",
      adapter: "codex",
      answersPath,
      yes: true,
      dryRun: false,
      nonInteractive: true,
    });
    promptDriver.confirm.mockClear();

    const result = await service.update({ root: targetRoot, yes: false, dryRun: false, nonInteractive: false });

    expect(result).toEqual(expect.objectContaining({ applied: false, status: "no-op" }));
    expect(promptDriver.confirm).not.toHaveBeenCalled();
  });

  test("a failed post-write doctor automatically reverses the install and retains both journals", async () => {
    const targetRoot = await freshTarget();
    const operationId = "20260915T150300000Z-recover";
    const service = createForgeyardService({
      prompts: prompts(true),
      registryRoot,
      operationId: () => operationId,
      doctorRunner: async ({ root }) => failedDoctor(path.resolve(root)),
    });

    await expect(service.init({
      targetRoot,
      profile: "hackathon",
      adapter: "codex",
      answersPath,
      yes: true,
      dryRun: false,
      nonInteractive: true,
    })).rejects.toEqual(expect.objectContaining({ code: "FY_DOCTOR_FAILED", exitCode: 6 }));

    expect(await exists(path.join(targetRoot, "forgeyard.yaml"))).toBe(true);
    expect(await exists(path.join(targetRoot, "AGENTS.md"))).toBe(false);
    expect((await loadInstallManifest(targetRoot)).files.map((file) => file.path)).toEqual([
      "forgeyard.yaml",
      ".forgeyard/.gitignore",
      "PROJECT.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
    ]);
    expect(await readdir(path.join(targetRoot, ".forgeyard", "state", "operations"))).toEqual(
      [`${operationId}.json`, `rollback-${operationId}.json`].sort((left, right) => left.localeCompare(right, "en")),
    );
  });

  test("a failed automatic recovery is mapped to a path-only transaction failure", async () => {
    const targetRoot = await freshTarget();
    const operationId = "20260915T150400000Z-stuck";
    const service = createForgeyardService({
      prompts: prompts(true),
      registryRoot,
      operationId: () => operationId,
      doctorRunner: async ({ root }) => {
        await writeFile(path.join(root, "AGENTS.md"), "post-write drift\n", "utf8");
        return failedDoctor(path.resolve(root));
      },
    });

    await expect(service.init({
      targetRoot,
      profile: "hackathon",
      adapter: "codex",
      answersPath,
      yes: true,
      dryRun: false,
      nonInteractive: true,
    })).rejects.toEqual(expect.objectContaining({
      code: "FY_TRANSACTION_FAILED",
      exitCode: 5,
      paths: ["AGENTS.md"],
    }));
    expect(await readFile(path.join(targetRoot, "AGENTS.md"), "utf8")).toBe("post-write drift\n");
  });

  test("an exceptional post-write doctor is also recovered", async () => {
    const targetRoot = await freshTarget();
    const operationId = "20260915T150500000Z-exception";
    const service = createForgeyardService({
      prompts: prompts(true),
      registryRoot,
      operationId: () => operationId,
      doctorRunner: async () => {
        throw new Error("injected doctor exception");
      },
    });

    await expect(service.init({
      targetRoot,
      profile: "hackathon",
      adapter: "codex",
      answersPath,
      yes: true,
      dryRun: false,
      nonInteractive: true,
    })).rejects.toEqual(expect.objectContaining({ code: "FY_DOCTOR_FAILED", exitCode: 6 }));
    expect(await exists(path.join(targetRoot, "AGENTS.md"))).toBe(false);
    expect((await loadInstallManifest(targetRoot)).files.map((file) => file.path)).toEqual([
      "forgeyard.yaml",
      ".forgeyard/.gitignore",
      "PROJECT.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
    ]);
  });
});
