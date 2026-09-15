import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { TaskCommandResult } from "../../src/application/forgeyard.js";
import { buildCli, runBuiltCli } from "../helpers/cli.js";

const repositoryRoot = path.resolve(".");
let sandboxRoot: string;

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

beforeAll(async () => {
  await buildCli(repositoryRoot);
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-controller-"));
}, 60_000);

afterAll(async () => {
  if (sandboxRoot !== undefined) await rm(sandboxRoot, { recursive: true, force: true });
});

describe("prepared host controller", () => {
  test("routes a product request to bounded work orders without choosing skills or launching clients", async () => {
    const target = path.join(sandboxRoot, "checkout-ui");
    await mkdir(path.join(target, "src"), { recursive: true });
    await writeFile(path.join(target, "package.json"), JSON.stringify({
      name: "checkout-ui",
      scripts: { test: "node -e \"process.exit(0)\"" },
      dependencies: { next: "16.0.0", react: "19.0.0" },
    }, null, 2));
    const request = "Add an accessible checkout recovery journey without changing the public API.";
    const preparation = await runBuiltCli(repositoryRoot, [
      "prepare", target, "--brief", request, "--budget-usd", "12", "--max-concurrency", "3",
      "--yes", "--json",
    ], sandboxRoot);
    expect(preparation.exitCode, preparation.stderr).toBe(0);

    const nextProcess = await runBuiltCli(repositoryRoot, ["task", "next", "--root", target, "--json"], sandboxRoot);
    expect(nextProcess.exitCode, nextProcess.stderr).toBe(0);
    const next = JSON.parse(nextProcess.stdout) as TaskCommandResult;
    expect(next.action).toBe("next");
    expect(next.workOrders).toHaveLength(1);
    expect(next.workOrders?.[0]).toEqual(expect.objectContaining({
      taskId: "T001",
      objective: expect.stringContaining(request),
      role: "frontend-implementer",
      capabilities: expect.arrayContaining(["ui-design"]),
      costStatus: "unmeasured",
      recordedCostUsd: null,
      remainingCostUsd: null,
    }));
    expect(next.workOrders?.[0]?.hostPrompt).toContain("Before editing, claim exactly this task");
    expect(next.snapshot.tasks.find((task) => task.id === "T001")?.status).toBe("pending");
    expect(await exists(path.join(target, ".forgeyard", "ledger", "events.jsonl"))).toBe(false);

    const controller = await readFile(
      path.join(target, ".agents", "skills", "forgeyard-workflow", "SKILL.md"),
      "utf8",
    );
    expect(controller).toContain("Start from the user's product-language request");
    expect(controller).toContain("forgeyard task next --root . --json");
    expect(controller).toContain("returned `hostPrompt`");
    expect(controller).toContain("Do not ask the user to select skills");
    expect(controller).toContain("unresolved product ambiguity");
    expect(controller).toContain("host-native worker or subagent facility");
    expect(controller).toContain("does not launch model clients");
    expect(controller).toContain("workspace integrate");
    expect(controller).toContain("workspace cleanup");
    expect(controller).toContain("external effect");
  }, 120_000);
});
