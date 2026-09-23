import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 9,4 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

import { nodeFileSystem, type FileSystemPort } from "../../../src/installer/apply.js";
import { applyInstallPlan } from "../../../src/installer/apply.js";
import { applyUpdate, planUpdate } from "../../../src/installer/update.js";
import {
  basePlan,
  changedPlan,
  cleanLifecycleRoots,
  freshLifecycleRoot,
  payloadSnapshot,
} from "./lifecycle-helpers.js";

afterEach(cleanLifecycleRoots);

describe("hash-aware update", () => {
  test("treats an unchanged next plan as a no-op", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const next = await basePlan(root, "20260915T130100000Z-same01");

    const update = await planUpdate(root, next);
    const result = await applyUpdate(update);

    expect(update.actions.every((action) => ["unchanged", "preserve"].includes(action.action))).toBe(true);
    expect(result.applied).toBe(false);
  });

  test("adds, replaces, and removes unchanged managed files in one transaction", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const next = changedPlan(initial);

    const update = await planUpdate(root, next);
    const result = await applyUpdate(update);

    expect(update.actions.map(({ path: filePath, action }) => [filePath, action])).toEqual(
      expect.arrayContaining([
        ["AGENTS.md", "replace"],
        ["notes/generated.md", "create"],
        [".codex/agents/reviewer.toml", "delete"],
      ]),
    );
    expect(result).toEqual(
      expect.objectContaining({
        applied: true,
        created: ["notes/generated.md"],
        updated: ["AGENTS.md"],
        removed: [".codex/agents/reviewer.toml"],
      }),
    );
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("Update marker.");
    await expect(readFile(path.join(root, ".codex", "agents", "reviewer.toml"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  test("rejects local drift before changing any file", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    await writeFile(path.join(root, "AGENTS.md"), "local edit\n", "utf8");
    const before = await payloadSnapshot(initial);

    await expect(planUpdate(root, changedPlan(initial))).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT", paths: ["AGENTS.md"] }),
    );
    expect(await payloadSnapshot(initial)).toEqual(before);
  });

  test("rejects an unknown new destination", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    await import("node:fs/promises").then((fs) => fs.mkdir(path.join(root, "notes"), { recursive: true }));
    await writeFile(path.join(root, "notes", "generated.md"), "user-owned\n", "utf8");

    await expect(planUpdate(root, changedPlan(initial))).rejects.toEqual(
      expect.objectContaining({ code: "FY_OWNERSHIP_CONFLICT", paths: ["notes/generated.md"] }),
    );
  });

  test("preserves edits to the human-owned seed", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const configPath = path.join(root, "forgeyard.yaml");
    const edited = `# human note\n${await readFile(configPath, "utf8")}`;
    await writeFile(configPath, edited, "utf8");

    const result = await applyUpdate(await planUpdate(root, changedPlan(initial)));

    expect(result.preserved).toContain("forgeyard.yaml");
    expect(await readFile(configPath, "utf8")).toBe(edited);
  });

  test("restores the complete pre-update payload after an injected move failure", async () => {
    const root = await freshLifecycleRoot();
    const initial = await basePlan(root);
    await applyInstallPlan(initial);
    const before = await payloadSnapshot(initial);
    const update = await planUpdate(root, changedPlan(initial));
    let failed = false;
    const fileSystem: FileSystemPort = {
      ...nodeFileSystem,
      async rename(source, destination) {
        if (!failed && source.includes(`${path.sep}staging${path.sep}`) && !destination.includes(`${path.sep}state${path.sep}`)) {
          failed = true;
          throw new Error("injected update move");
        }
        await nodeFileSystem.rename(source, destination);
      },
    };

    await expect(applyUpdate(update, { fileSystem })).rejects.toEqual(
      expect.objectContaining({ code: "FY_TRANSACTION_FAILED" }),
    );
    expect(await payloadSnapshot(initial)).toEqual(before);
  });
});
