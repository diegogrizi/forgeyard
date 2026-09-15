import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { loadConfig } from "../../../src/config/config.js";
import { applyInstallPlan, nodeFileSystem, type FileSystemPort } from "../../../src/installer/apply.js";
import { loadInstallManifest } from "../../../src/installer/manifest.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-install-"));
  temporaryRoots.push(root);
  return root;
}

async function makePlan(root: string, operationId = "20260915T120000000Z-a1b2c3") {
  const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "hackathon", "codex");
  const renderedFiles = await createCodexAdapter().render(resolved.components, config);
  return buildInstallPlan({
    targetRoot: root,
    config,
    resolved,
    renderedFiles,
    operationId,
    forgeyardVersion: "0.1.0",
  });
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("transactional installation", () => {
  test("installs payload and records exact ownership hashes", async () => {
    const root = await freshRoot();
    const plan = await makePlan(root);

    const result = await applyInstallPlan(plan);
    const manifest = await loadInstallManifest(root);

    expect(result).toEqual(
      expect.objectContaining({ operationId: plan.operationId, applied: true, created: plan.files.map((file) => file.path) }),
    );
    expect(manifest.files).toHaveLength(plan.files.length);
    for (const file of plan.files) {
      expect(await readFile(path.join(root, ...file.path.split("/")), "utf8")).toBe(file.content);
      expect(manifest.files).toContainEqual(
        expect.objectContaining({
          path: file.path,
          componentId: file.componentId,
          ownership: file.ownership,
          installedSha256: file.sha256,
          operationId: plan.operationId,
        }),
      );
    }
  });

  test("performs a complete dry run without creating state", async () => {
    const root = await freshRoot();
    const plan = await makePlan(root);

    const result = await applyInstallPlan(plan, { dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.created).toEqual(plan.files.map((file) => file.path));
    expect(await readdir(root)).toEqual([]);
  });

  test("a second identical plan is an idempotent no-op", async () => {
    const root = await freshRoot();
    await applyInstallPlan(await makePlan(root));
    const before = await readFile(path.join(root, ".forgeyard", "manifest.json"), "utf8");
    const next = await makePlan(root, "20260915T120100000Z-d4e5f6");

    const result = await applyInstallPlan(next);

    expect(result.applied).toBe(false);
    expect(result.unchanged).toEqual(next.files.map((file) => file.path));
    expect(await readFile(path.join(root, ".forgeyard", "manifest.json"), "utf8")).toBe(before);
  });

  test("rejects an unknown destination before writing any planned file", async () => {
    const root = await freshRoot();
    await writeFile(path.join(root, "AGENTS.md"), "user-owned\n", "utf8");
    const plan = await makePlan(root);

    await expect(applyInstallPlan(plan)).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT", exitCode: 4, paths: ["AGENTS.md"] }),
    );
    expect(await readdir(root)).toEqual(["AGENTS.md"]);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("user-owned\n");
  });

  test("rejects drift in a managed file before writing", async () => {
    const root = await freshRoot();
    await applyInstallPlan(await makePlan(root));
    await writeFile(path.join(root, "AGENTS.md"), "locally changed\n", "utf8");

    await expect(applyInstallPlan(await makePlan(root, "20260915T120200000Z-f6a7b8"))).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT", paths: ["AGENTS.md"] }),
    );
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("locally changed\n");
  });

  test("preserves an existing human-owned configuration seed", async () => {
    const root = await freshRoot();
    const custom = "# human-owned\n" + (await readFile(path.resolve("fixtures/answers/hackathon.yaml"), "utf8"));
    await writeFile(path.join(root, "forgeyard.yaml"), custom, "utf8");

    const result = await applyInstallPlan(await makePlan(root));
    const manifest = await loadInstallManifest(root);

    expect(result.preserved).toEqual(["forgeyard.yaml"]);
    expect(await readFile(path.join(root, "forgeyard.yaml"), "utf8")).toBe(custom);
    expect(manifest.files.find((file) => file.path === "forgeyard.yaml")?.ownership).toBe("seed");
  });

  test.each([1, 4, 7])("recovers every payload byte when staged move %s fails", async (failAt) => {
    const root = await freshRoot();
    const plan = await makePlan(root);
    let stagedMoves = 0;
    const fileSystem: FileSystemPort = {
      ...nodeFileSystem,
      async rename(source, destination) {
        const isPayloadMove = source.includes(`${path.sep}staging${path.sep}`) && !destination.includes(`${path.sep}state${path.sep}`);
        if (isPayloadMove && ++stagedMoves === failAt) throw new Error(`injected move ${failAt}`);
        await nodeFileSystem.rename(source, destination);
      },
    };

    await expect(applyInstallPlan(plan, { fileSystem })).rejects.toEqual(
      expect.objectContaining({ code: "FY_TRANSACTION_FAILED", exitCode: 5 }),
    );
    for (const file of plan.files) {
      expect(await exists(path.join(root, ...file.path.split("/"))), file.path).toBe(false);
    }
  });

  test("rejects corrupted staging bytes before moving payload", async () => {
    const root = await freshRoot();
    const plan = await makePlan(root);
    const fileSystem: FileSystemPort = {
      ...nodeFileSystem,
      async writeFile(filePath, content) {
        if (filePath.includes(`${path.sep}staging${path.sep}`) && filePath.endsWith("AGENTS.md")) {
          await nodeFileSystem.writeFile(filePath, "corrupt\n");
          return;
        }
        await nodeFileSystem.writeFile(filePath, content);
      },
    };

    await expect(applyInstallPlan(plan, { fileSystem })).rejects.toEqual(
      expect.objectContaining({ code: "FY_TRANSACTION_FAILED" }),
    );
    expect(await exists(path.join(root, "AGENTS.md"))).toBe(false);
  });
});
