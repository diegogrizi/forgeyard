import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 13,6 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
import { parse as parseYaml } from "yaml";

import { createForgeyardService } from "../../../src/application/forgeyard.js";
import type { PromptDriver } from "../../../src/config/wizard.js";
import type { DoctorReport, ForgeyardConfig } from "../../../src/core/contracts.js";

const roots: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-prepare-"));
  roots.push(root);
  return root;
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

async function snapshot(root: string, current = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, absolute));
    else result[path.relative(root, absolute).replaceAll("\\", "/")] = await readFile(absolute, "utf8");
  }
  return result;
}

function strictPrompts(purpose?: string): PromptDriver & { input: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> } {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected ecosystem/configuration prompt");
  };
  return {
    input: vi.fn(async (id: string) => {
      if (id === "project.purpose" && purpose !== undefined) return purpose;
      return unexpected();
    }),
    select: unexpected,
    number: unexpected,
    confirm: vi.fn(async () => true),
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

describe("problem-first project preparation", () => {
  test("inspect reads project evidence and proposes a tailored suite without changing a byte", async () => {
    const root = await project();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "checkout-ui",
      scripts: { test: "vitest run" },
      dependencies: { next: "16.0.0", react: "19.0.0" },
      devDependencies: { typescript: "6.0.0" },
    }, null, 2));
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");
    await writeFile(path.join(root, "requirements.md"), "# Checkout\n\nAdd accessible checkout recovery.\n");
    const before = await snapshot(root);
    const prompts = strictPrompts();
    const service = createForgeyardService({ prompts, registryRoot: path.resolve(".") });

    const result = await service.inspect({
      targetRoot: root,
      specificationPaths: ["requirements.md"],
    });

    expect(result.command).toBe("inspect");
    expect(result.inspection).toMatchObject({ kind: "frontend", frameworks: ["next.js", "react"] });
    expect(result.decision).toMatchObject({ profile: "tailored", adapter: "codex" });
    expect(result.decision.catalog.plugins).toEqual(expect.arrayContaining(["accessibility-compliance", "ui-design"]));
    expect(result.decision.catalog.plugins).not.toContain("agent-orchestration");
    expect(await snapshot(root)).toEqual(before);
    expect(prompts.input).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  test("dry-run returns inspection and decision without creating factory files", async () => {
    const root = await project();
    await writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"balance-api\"\ndependencies = [\"fastapi\", \"pytest\"]\n");
    await writeFile(path.join(root, "README.md"), "# API\n\nAdd a balance endpoint.\n");
    const service = createForgeyardService({
      prompts: strictPrompts(),
      registryRoot: path.resolve("."),
      operationId: () => "20260915T180000000Z-prepare",
    });

    const result = await service.prepare({
      targetRoot: root,
      yes: false,
      dryRun: true,
      nonInteractive: true,
    });

    expect(result).toMatchObject({ command: "prepare", applied: false, status: "preview", doctor: null });
    expect(result.inspection.kind).toBe("backend");
    expect(result.decision.catalog.plugins).toContain("backend-development");
    expect(result.changes.created).toContain("forgeyard.yaml");
    expect(await exists(path.join(root, "forgeyard.yaml"))).toBe(false);
  });

  test("interactive preparation asks only for a missing product purpose", async () => {
    const root = await project();
    const prompts = strictPrompts("Build a safe inventory application.");
    const service = createForgeyardService({ prompts, registryRoot: path.resolve(".") });

    const result = await service.prepare({
      targetRoot: root,
      yes: false,
      dryRun: true,
      nonInteractive: false,
    });

    expect(result.inspection.request).toBe("Build a safe inventory application.");
    expect(prompts.input).toHaveBeenCalledOnce();
    expect(prompts.input).toHaveBeenCalledWith("project.purpose", expect.any(String));
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  test("non-interactive preparation rejects an unresolved purpose precisely", async () => {
    const root = await project();
    const service = createForgeyardService({ prompts: strictPrompts(), registryRoot: path.resolve(".") });

    await expect(service.prepare({
      targetRoot: root,
      yes: true,
      dryRun: false,
      nonInteractive: true,
    })).rejects.toEqual(expect.objectContaining({ code: "FY_INTAKE_INCOMPLETE", exitCode: 2 }));
    expect(await exists(path.join(root, "forgeyard.yaml"))).toBe(false);
  });

  test("applied preparation pins the decision and update does not re-inspect repository drift", async () => {
    const root = await project();
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "checkout-ui",
      scripts: { test: "node -e \"process.exit(0)\"" },
      dependencies: { next: "16.0.0", react: "19.0.0" },
    }));
    const ids = ["20260915T181000000Z-prepare", "20260915T181100000Z-update"];
    const service = createForgeyardService({
      prompts: strictPrompts(),
      registryRoot: path.resolve("."),
      operationId: () => ids.shift()!,
    });
    await service.prepare({
      targetRoot: root,
      brief: "Add accessible checkout recovery.",
      yes: true,
      dryRun: false,
      nonInteractive: true,
    });
    const storedBefore = parseYaml(await readFile(path.join(root, "forgeyard.yaml"), "utf8")) as ForgeyardConfig;
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "checkout-ui",
      dependencies: { express: "6.0.0" },
    }));

    const update = await service.update({ root, yes: true, dryRun: false, nonInteractive: true });
    const storedAfter = parseYaml(await readFile(path.join(root, "forgeyard.yaml"), "utf8")) as ForgeyardConfig;

    expect(update.status).toBe("no-op");
    expect(storedAfter.composition).toEqual(storedBefore.composition);
    expect(storedAfter.intake?.frameworks).toEqual(["next.js", "react"]);
  });

  test("a failed post-write doctor recovers a preparation transaction", async () => {
    const root = await project();
    const service = createForgeyardService({
      prompts: strictPrompts(),
      registryRoot: path.resolve("."),
      operationId: () => "20260915T182000000Z-prepare",
      doctorRunner: async ({ root: target }) => failedDoctor(path.resolve(target)),
    });

    await expect(service.prepare({
      targetRoot: root,
      brief: "Build a local inventory application.",
      yes: true,
      dryRun: false,
      nonInteractive: true,
    })).rejects.toEqual(expect.objectContaining({ code: "FY_DOCTOR_FAILED", exitCode: 6 }));

    expect(await exists(path.join(root, ".forgeyard", "COMPOSITION.md"))).toBe(false);
    expect(await exists(path.join(root, "forgeyard.yaml"))).toBe(true);
  });
});
