import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import type {
  DoctorCommandResult,
  ForgeyardService,
  InitCommandResult,
  InspectCommandResult,
  PrepareCommandResult,
  RollbackCommandResult,
  UpdateCommandResult,
  VerifyCommandResult,
} from "../../../src/application/forgeyard.js";
import { createProgram, runCli, type CliDependencies } from "../../../src/cli/program.js";
import { ForgeyardError } from "../../../src/core/errors.js";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeOut: (value: string) => {
        stdout += value;
      },
      writeErr: (value: string) => {
        stderr += value;
      },
      debug: false,
    },
    read: () => ({ stdout, stderr }),
  };
}

const doctorResult: DoctorCommandResult = {
  schemaVersion: 1,
  ok: true,
  command: "doctor",
  root: path.resolve("fixture-target"),
  summary: { passed: 8, failed: 0, skipped: 1, unavailable: 1 },
  checks: [],
};

const initResult: InitCommandResult = {
  schemaVersion: 1,
  ok: true,
  command: "init",
  root: path.resolve("fixture-target"),
  operationId: "20260915T140000000Z-init01",
  applied: true,
  status: "applied",
  changes: {
    created: ["AGENTS.md"],
    updated: [],
    removed: [],
    unchanged: [],
    preserved: ["forgeyard.yaml"],
  },
  doctor: doctorResult.summary,
};

const inspection = {
  schemaVersion: 1 as const,
  root: path.resolve("fixture-target"),
  name: "checkout-ui",
  request: "Add accessible checkout recovery.",
  mode: "existing" as const,
  kind: "frontend" as const,
  languages: ["typescript"],
  frameworks: ["next.js", "react"],
  packageManagers: ["npm"],
  qualityCommands: [{ name: "test", argv: ["npm", "test"] as const }],
  mutableRoots: ["app"],
  instructionSurfaces: [],
  sources: ["requirements.md"],
  evidence: [{ path: "package.json", signal: "dependency:next" }],
  questions: [],
  warnings: [],
  confidence: "high" as const,
  analysisSha256: "f".repeat(64),
};

const decision = {
  schemaVersion: 1 as const,
  profile: "tailored" as const,
  adapter: "codex" as const,
  adapterReason: "Portable fallback.",
  catalog: { selection: "curated" as const, plugins: ["ui-design"] },
  packs: ["delivery", "ecosystem", "foundation"],
  selected: [{ id: "ui-design", reason: "The project has a user interface." }],
  excluded: [{ id: "agent-orchestration", reason: "Forgeyard is the primary workflow." }],
  timeboxMinutes: 240,
  orchestration: { mode: "native" as const, maxConcurrency: 2 },
  autonomy: { level: "balanced" as const, maxCostUsd: 20, stopOnAmbiguity: true as const, externalEffects: "ask" as const },
  analysisSha256: "f".repeat(64),
};

const inspectResult: InspectCommandResult = {
  schemaVersion: 1,
  ok: true,
  command: "inspect",
  root: path.resolve("fixture-target"),
  inspection,
  decision,
};

const prepareResult: PrepareCommandResult = {
  ...initResult,
  command: "prepare",
  inspection,
  decision,
};

const updateResult: UpdateCommandResult = {
  ...initResult,
  command: "update",
  applied: false,
  status: "no-op",
  changes: {
    created: [],
    updated: [],
    removed: [],
    unchanged: ["AGENTS.md"],
    preserved: ["forgeyard.yaml"],
  },
};

const rollbackResult: RollbackCommandResult = {
  schemaVersion: 1,
  ok: true,
  command: "rollback",
  root: path.resolve("fixture-target"),
  operationId: "rollback-20260915T140000000Z-init01",
  sourceOperationId: "20260915T140000000Z-init01",
  applied: true,
  status: "applied",
  changes: { removed: ["AGENTS.md"], restored: [] },
};

const verifyResult: VerifyCommandResult = {
  schemaVersion: 1,
  ok: true,
  command: "verify",
  root: path.resolve("fixture-target"),
  taskId: "T001",
  status: "passed",
  receiptPath: ".forgeyard/evidence/receipt-01.json",
  current: true,
  receipt: {
    schemaVersion: 1,
    receiptId: "receipt-01",
    taskId: "T001",
    taskSha256: "a".repeat(64),
    argvSha256: "b".repeat(64),
    gitCommit: "c".repeat(40),
    startedAt: "2026-09-15T14:00:00.000Z",
    finishedAt: "2026-09-15T14:00:00.010Z",
    durationMs: 10,
    exitCode: 0,
    stdoutSha256: "d".repeat(64),
    stderrSha256: "e".repeat(64),
    status: "passed",
  },
  stdoutBytes: 0,
  stderrBytes: 0,
};

function service(): ForgeyardService {
  return {
    inspect: vi.fn(async () => inspectResult),
    prepare: vi.fn(async () => prepareResult),
    init: vi.fn(async () => initResult),
    doctor: vi.fn(async () => doctorResult),
    verify: vi.fn(async () => verifyResult),
    update: vi.fn(async () => updateResult),
    rollback: vi.fn(async () => rollbackResult),
  };
}

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    version: "0.1.0",
    service: service(),
    interactive: true,
    ...overrides,
  };
}

describe("Forgeyard CLI boundary", () => {
  test("lists problem-first preparation before the advanced factory commands", () => {
    const help = createProgram(dependencies()).helpInformation();

    for (const command of ["inspect", "prepare", "init", "doctor", "verify", "update", "rollback"]) {
      expect(help).toContain(command);
    }
  });

  test("maps typed inspect and prepare options without ecosystem-selection arguments", async () => {
    const capture = captureIo();
    const deps = dependencies({ interactive: false });

    expect(await runCli([
      "inspect", "fixture-target", "--brief", "Add recovery", "--spec", "one.md", "--spec", "two.md",
      "--adapter", "codex", "--json",
    ], deps, capture.io)).toBe(0);
    expect(deps.service.inspect).toHaveBeenCalledWith({
      targetRoot: "fixture-target",
      brief: "Add recovery",
      specificationPaths: ["one.md", "two.md"],
      adapter: "codex",
    });

    expect(await runCli([
      "prepare", "fixture-target", "--brief", "Add recovery", "--spec", "one.md", "--adapter", "codex",
      "--timebox", "240", "--max-concurrency", "8", "--budget-usd", "20.5", "--autonomy", "autonomous",
      "--yes", "--dry-run", "--json",
    ], deps, capture.io)).toBe(0);
    expect(deps.service.prepare).toHaveBeenCalledWith({
      targetRoot: "fixture-target",
      brief: "Add recovery",
      specificationPaths: ["one.md"],
      adapter: "codex",
      timeboxMinutes: 240,
      maxConcurrency: 8,
      maxCostUsd: 20.5,
      autonomy: "autonomous",
      yes: true,
      dryRun: true,
      nonInteractive: true,
    });
  });

  test("prints its injected version without touching the current directory", async () => {
    const capture = captureIo();

    const exitCode = await runCli(["--version"], dependencies(), capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read()).toEqual({ stdout: "0.1.0\n", stderr: "" });
  });

  test("maps every init option to a typed service request", async () => {
    const capture = captureIo();
    const deps = dependencies({ interactive: false });

    const exitCode = await runCli(
      [
        "init",
        "fixture-target",
        "--profile",
        "hackathon",
        "--adapter",
        "codex",
        "--answers",
        "answers.yaml",
        "--yes",
        "--dry-run",
        "--json",
      ],
      deps,
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(deps.service.init).toHaveBeenCalledWith({
      targetRoot: "fixture-target",
      profile: "hackathon",
      adapter: "codex",
      answersPath: "answers.yaml",
      yes: true,
      dryRun: true,
      nonInteractive: true,
    });
    expect(JSON.parse(capture.read().stdout)).toEqual(initResult);
    expect(capture.read().stderr).toBe("");
  });

  test("maps doctor, verify, update, and rollback without leaking deny values", async () => {
    const capture = captureIo();
    const deps = dependencies({ interactive: false });

    expect(await runCli(["doctor", "fixture-target", "--deny-term", "private-one", "--deny-term", "private-two", "--json"], deps, capture.io)).toBe(0);
    expect(deps.service.doctor).toHaveBeenCalledWith({
      root: "fixture-target",
      denyTerms: ["private-one", "private-two"],
    });
    expect(capture.read().stdout).not.toContain("private-one");
    expect(capture.read().stdout).not.toContain("private-two");

    expect(await runCli(["verify", "T001", "--root", "fixture-target", "--json"], deps, capture.io)).toBe(0);
    expect(deps.service.verify).toHaveBeenCalledWith({ root: "fixture-target", taskId: "T001" });

    expect(await runCli(["update", "fixture-target", "--yes", "--dry-run", "--json"], deps, capture.io)).toBe(0);
    expect(deps.service.update).toHaveBeenCalledWith({
      root: "fixture-target",
      yes: true,
      dryRun: true,
      nonInteractive: true,
    });

    expect(await runCli(["rollback", "op-123456", "--root", "fixture-target", "--yes", "--json"], deps, capture.io)).toBe(0);
    expect(deps.service.rollback).toHaveBeenCalledWith({
      root: "fixture-target",
      sourceOperationId: "op-123456",
      yes: true,
      nonInteractive: true,
    });
  });

  test("plain success output is concise and never includes file bodies", async () => {
    const capture = captureIo();
    const deps = dependencies();

    const exitCode = await runCli(["init", "fixture-target", "--profile", "hackathon", "--adapter", "codex", "--yes"], deps, capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stdout).toContain("Forgeyard init: applied");
    expect(capture.read().stdout).toContain("Created: AGENTS.md");
    expect(capture.read().stdout).not.toContain("content");
    expect(capture.read().stderr).toBe("");
  });

  test.each([
    ["FY_CONFIG_INVALID", 2],
    ["FY_REGISTRY_INVALID", 3],
    ["FY_OWNERSHIP_CONFLICT", 4],
    ["FY_TRANSACTION_FAILED", 5],
    ["FY_DOCTOR_FAILED", 6],
    ["FY_GIT_REQUIRED", 7],
    ["FY_COMMAND_FAILED", 8],
  ])("preserves frozen error %s and exit code %i in JSON", async (code, expectedExit) => {
    const capture = captureIo();
    const deps = dependencies();
    deps.service.doctor = vi.fn(async () => {
      throw new ForgeyardError({
        code,
        message: "Safe public failure.",
        remediation: "Safe remediation.",
        exitCode: expectedExit,
      });
    });

    const exitCode = await runCli(["doctor", "--json"], deps, capture.io);

    expect(exitCode).toBe(expectedExit);
    expect(JSON.parse(capture.read().stdout)).toEqual({
      ok: false,
      error: { code, message: "Safe public failure.", remediation: "Safe remediation." },
    });
    expect(capture.read().stderr).toBe("");
  });

  test("maps an unknown failure to FY_INTERNAL without leaking a stack", async () => {
    const capture = captureIo();
    const deps = dependencies();
    deps.service.update = vi.fn(async () => {
      throw new Error("private diagnostic detail");
    });

    const exitCode = await runCli(["update"], deps, capture.io);

    expect(exitCode).toBe(1);
    expect(capture.read().stdout).toBe("");
    expect(capture.read().stderr).toContain("FY_INTERNAL");
    expect(capture.read().stderr).not.toContain("private diagnostic detail");
    expect(capture.read().stderr).not.toContain("at ");
  });
});

describe("undoing without an identifier", () => {
  test("a folder the factory never touched says so instead of asking for an identifier", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-undo-"));
    const io = { written: [] as string[], errors: [] as string[] };

    const exitCode = await runCli(["rollback", "--root", root, "--json"], dependencies(), {
      writeOut: (value) => io.written.push(value),
      writeErr: (value) => io.errors.push(value),
      debug: false,
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(io.written.join(""))).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "FY_OPERATION_UNKNOWN",
        message: "Questa cartella non ha operazioni Forgeyard da annullare.",
      }),
    });
  });

  test("an explicit identifier is still honoured", async () => {
    const double = service();

    await runCli(["rollback", "20260915T140000000Z-init01", "--root", ".", "--json"],
      dependencies({ service: double }), { writeOut: () => {}, writeErr: () => {}, debug: false });

    expect(double.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOperationId: "20260915T140000000Z-init01" }),
    );
  });
});
