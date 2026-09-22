import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { applyInstallPlan, nodeFileSystem, type FileSystemPort } from "../../../src/installer/apply.js";
import { loadInstallManifest } from "../../../src/installer/manifest.js";
import { applyRollback, planRollback } from "../../../src/installer/rollback.js";
import { applyUpdate, planUpdate } from "../../../src/installer/update.js";
import {
  basePlan,
  changedPlan,
  cleanLifecycleRoots,
  freshLifecycleRoot,
  payloadSnapshot,
} from "./lifecycle-helpers.js";

afterEach(cleanLifecycleRoots);

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

describe("operation-scoped rollback", () => {
  test("reverses an initial install while preserving human-owned seeds and unrelated files", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    await writeFile(path.join(root, "sentinel.txt"), "unrelated\n", "utf8");

    const result = await applyRollback(await planRollback(root, initial.operationId));
    const manifest = await loadInstallManifest(root);

    expect(result.applied).toBe(true);
    expect(await exists(path.join(root, "forgeyard.yaml"))).toBe(true);
    expect(await readFile(path.join(root, "sentinel.txt"), "utf8")).toBe("unrelated\n");
    // The private ignore rule is a seed too: uninstalling the factory must not silently
    // remove a privacy rule the person may still rely on.
    expect(manifest.files.map((file) => file.path)).toEqual([
      "forgeyard.yaml",
      ".forgeyard/.gitignore",
      "PROJECT.md",
      ".forgeyard/handoffs/CURRENT.md",
      ".forgeyard/reports/RUN_REPORT.md",
    ]);
    for (const file of initial.files.filter((file) => file.ownership === "managed")) {
      expect(await exists(path.join(root, ...file.path.split("/"))), file.path).toBe(false);
    }
  });

  test("restores files replaced and deleted by an update and removes additions", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const before = await payloadSnapshot(initial);
    const next = changedPlan(initial);
    await applyUpdate(await planUpdate(root, next));

    await applyRollback(await planRollback(root, next.operationId));

    expect(await payloadSnapshot(initial)).toEqual(before);
    expect(await exists(path.join(root, "notes", "generated.md"))).toBe(false);
  });

  test("rejects unknown and already rolled-back operation IDs", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);

    await expect(planRollback(root, "20260915T139999999Z-unknown")).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT" }),
    );
    await applyRollback(await planRollback(root, initial.operationId));
    await expect(planRollback(root, initial.operationId)).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT" }),
    );
  });

  test("detects post-operation drift before rollback", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    await writeFile(path.join(root, "AGENTS.md"), "post-operation edit\n", "utf8");

    await expect(planRollback(root, initial.operationId)).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT", paths: ["AGENTS.md"] }),
    );
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("post-operation edit\n");
  });

  test("rejects an update rollback when a required backup is missing", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const next = changedPlan(initial);
    await applyUpdate(await planUpdate(root, next));
    await rm(path.join(root, ".forgeyard", "state", "backups", next.operationId, "AGENTS.md"));

    await expect(planRollback(root, next.operationId)).rejects.toEqual(
      expect.objectContaining({ code: "FY_TRANSACTION_FAILED" }),
    );
  });

  test("recovers the post-update state after an injected rollback move failure", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const next = changedPlan(initial);
    await applyUpdate(await planUpdate(root, next));
    const postUpdate = await payloadSnapshot(next);
    const rollback = await planRollback(root, next.operationId);
    let failed = false;
    const fileSystem: FileSystemPort = {
      ...nodeFileSystem,
      async rename(source, destination) {
        if (!failed && source.includes(`${path.sep}staging${path.sep}`) && !destination.includes(`${path.sep}state${path.sep}`)) {
          failed = true;
          throw new Error("injected rollback move");
        }
        await nodeFileSystem.rename(source, destination);
      },
    };

    await expect(applyRollback(rollback, { fileSystem })).rejects.toEqual(
      expect.objectContaining({ code: "FY_TRANSACTION_FAILED" }),
    );
    expect(await payloadSnapshot(next)).toEqual(postUpdate);
  });
});
