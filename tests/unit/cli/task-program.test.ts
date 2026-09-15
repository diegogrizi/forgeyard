import { describe, expect, test, vi } from "vitest";

import type { ForgeyardService } from "../../../src/application/forgeyard.js";
import { createProgram, runCli, type CliDependencies } from "../../../src/cli/program.js";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeOut: (value: string) => { stdout += value; },
      writeErr: (value: string) => { stderr += value; },
      debug: false,
    },
    read: () => ({ stdout, stderr }),
  };
}

function dependencies() {
  const taskResult = {
    schemaVersion: 1,
    ok: true,
    command: "task",
    action: "status",
    root: "C:/fixture",
    snapshot: {
      graphSha256: "a".repeat(64),
      activeCount: 0,
      maxConcurrency: 4,
      readyTaskIds: ["T001"],
      stopped: null,
      tasks: [],
    },
    workOrders: [],
  } as const;
  const ledgerResult = {
    schemaVersion: 1,
    ok: true,
    command: "ledger",
    action: "record",
    root: "C:/fixture",
    eventId: "usage-001",
  } as const;
  const service = {
    task: vi.fn(async (input: { action: string }) => ({ ...taskResult, action: input.action })),
    recordUsage: vi.fn(async () => ledgerResult),
    guard: vi.fn(async () => ({
      schemaVersion: 1,
      ok: true,
      command: "guard",
      root: "C:/fixture",
      taskId: "T001",
      allowed: true,
      paths: ["src/feature.ts"],
    })),
    workspace: vi.fn(async (input: { action: string }) => ({
      schemaVersion: 1,
      ok: true,
      command: "workspace",
      action: input.action,
      root: "C:/fixture",
      workspace: {
        taskId: "T001",
        status: input.action === "integrate" || input.action === "cleanup" ? "integrated" : "created",
        workspaceRoot: "C:/fixture/.forgeyard/state/worktrees/t001-worker-one",
        branch: "forgeyard/t001-worker-one",
        targetBranch: "main",
        baseCommit: "a".repeat(40),
        ...(input.action === "cleanup" ? { cleanedAt: "2026-09-15T20:00:00.000Z" } : {}),
      },
    })),
  } as unknown as ForgeyardService;
  return { version: "0.1.0", service, interactive: false } satisfies CliDependencies;
}

describe("task and ledger CLI", () => {
  test("advertises orchestration and local accounting commands", () => {
    const help = createProgram(dependencies()).helpInformation();
    expect(help).toContain("task");
    expect(help).toContain("ledger");
    expect(help).toContain("workspace");
  });

  test.each([
    [["task", "status", "--root", "fixture", "--json"], { action: "status", root: "fixture" }],
    [["task", "next", "--root", "fixture", "--json"], { action: "next", root: "fixture" }],
    [["task", "claim", "T001", "--worker", "worker-one", "--session", "session-one", "--root", "fixture", "--json"], {
      action: "claim", taskId: "T001", workerId: "worker-one", sessionId: "session-one", root: "fixture",
    }],
    [["task", "checkpoint", "T001", "--worker", "worker-one", "--note", "RED captured", "--root", "fixture", "--json"], {
      action: "checkpoint", taskId: "T001", workerId: "worker-one", note: "RED captured", root: "fixture",
    }],
    [["task", "resume", "T001", "--worker", "worker-one", "--root", "fixture", "--json"], {
      action: "resume", taskId: "T001", workerId: "worker-one", root: "fixture",
    }],
    [["task", "complete", "T001", "--worker", "worker-one", "--receipt", "receipt-one", "--root", "fixture", "--json"], {
      action: "complete", taskId: "T001", workerId: "worker-one", receiptId: "receipt-one", root: "fixture",
    }],
    [["task", "fail", "T001", "--worker", "worker-one", "--fingerprint", "test-failure", "--root", "fixture", "--json"], {
      action: "fail", taskId: "T001", workerId: "worker-one", fingerprint: "test-failure", root: "fixture",
    }],
    [["task", "cancel", "T001", "--worker", "worker-one", "--root", "fixture", "--json"], {
      action: "cancel", taskId: "T001", workerId: "worker-one", root: "fixture",
    }],
  ])("maps %j to one typed scheduler request", async (arguments_, expected) => {
    const deps = dependencies();
    const capture = captureIo();
    expect(await runCli(arguments_, deps, capture.io)).toBe(0);
    expect(deps.service.task).toHaveBeenCalledWith(expected);
    expect(capture.read().stderr).toBe("");
    expect(JSON.parse(capture.read().stdout)).toEqual(expect.objectContaining({ command: "task", action: expected.action }));
  });

  test("records only explicit usage and cost observations", async () => {
    const deps = dependencies();
    const capture = captureIo();
    expect(await runCli([
      "ledger", "record", "--root", "fixture", "--task", "T001", "--provider", "provider-one",
      "--model", "model-one", "--input-tokens", "120", "--output-tokens", "45", "--cost-usd", "0.031",
      "--duration-ms", "2400", "--json",
    ], deps, capture.io)).toBe(0);
    expect(deps.service.recordUsage).toHaveBeenCalledWith({
      root: "fixture",
      taskId: "T001",
      provider: "provider-one",
      model: "model-one",
      inputTokens: 120,
      outputTokens: 45,
      costUsd: 0.031,
      durationMs: 2400,
    });
    expect(capture.read().stderr).toBe("");
  });

  test("summarizes returned work orders in plain next output", async () => {
    const deps = dependencies();
    deps.service.task = vi.fn(async () => ({
      schemaVersion: 1,
      ok: true,
      command: "task",
      action: "next",
      root: "C:/fixture",
      snapshot: {
        graphSha256: "a".repeat(64), activeCount: 0, maxConcurrency: 4,
        readyTaskIds: ["T001"], stopped: null, tasks: [],
      },
      workOrders: [{ taskId: "T001", title: "Visible outcome" }],
    } as never));
    const capture = captureIo();

    expect(await runCli(["task", "next", "--root", "fixture"], deps, capture.io)).toBe(0);
    expect(capture.read().stdout).toContain("Work orders: T001 — Visible outcome");
  });

  test("maps explicit guard paths to the service", async () => {
    const deps = dependencies();
    const capture = captureIo();
    expect(await runCli([
      "guard", "T001", "src/feature.ts", "src/other.ts", "--root", "fixture", "--json",
    ], deps, capture.io)).toBe(0);
    expect(deps.service.guard).toHaveBeenCalledWith({
      root: "fixture",
      taskId: "T001",
      paths: ["src/feature.ts", "src/other.ts"],
    });
  });

  test.each(["status", "create", "validate", "integrate", "cleanup"])("maps workspace %s", async (action) => {
    const deps = dependencies();
    const capture = captureIo();
    expect(await runCli([
      "workspace", action, "T001", "--worker", "worker-one", "--root", "fixture", "--json",
    ], deps, capture.io)).toBe(0);
    expect(deps.service.workspace).toHaveBeenCalledWith({
      action,
      taskId: "T001",
      workerId: "worker-one",
      root: "fixture",
    });
  });

  test("reports completed worktree cleanup in plain output", async () => {
    const deps = dependencies();
    const capture = captureIo();
    expect(await runCli([
      "workspace", "cleanup", "T001", "--worker", "worker-one", "--root", "fixture",
    ], deps, capture.io)).toBe(0);
    expect(capture.read().stdout).toContain("Cleanup: completed at 2026-09-15T20:00:00.000Z");
    expect(capture.read().stderr).toBe("");
  });
});
