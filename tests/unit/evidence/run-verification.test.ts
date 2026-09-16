import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { GitPort } from "../../../src/evidence/receipts.js";
import {
  runVerification,
  type CommandRunInput,
  type CommandRunner,
  type VerificationPorts,
} from "../../../src/evidence/run-verification.js";

const temporaryRoots: string[] = [];

async function projectRoot(command = '["node","-e","process.exit(0)"]'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-verify-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  await writeFile(
    path.join(root, ".forgeyard", "tasks", "T001.yaml"),
    `schemaVersion: 1\nid: T001\ntitle: Verify slice\ncommand: ${command}\nrequired: true\n`,
    "utf8",
  );
  return root;
}

function cleanGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    head: async () => "a".repeat(40),
    status: async () => "",
    ...overrides,
  };
}

function ports(
  runner: CommandRunner,
  git: GitPort = cleanGit(),
  times = ["2026-09-15T12:00:00.000Z", "2026-09-15T12:00:00.025Z"],
): VerificationPorts {
  let index = 0;
  return {
    git,
    runner,
    clock: { now: () => new Date(times[index++]!) },
    ids: { next: () => "receipt-001" },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verification command boundary", () => {
  test("requires every configured task gate, not just the first command", async () => {
    const root = await projectRoot();
    await writeFile(path.join(root, ".forgeyard/tasks/T001.yaml"),
      'schemaVersion: 1\nid: T001\ntitle: Verify slice\ncommand: ["node","unit"]\ncommands:\n  - name: unit\n    argv: ["node","unit"]\n  - name: lint\n    argv: ["node","lint"]\nrequired: true\n');
    const observed: string[] = [];
    const runner: CommandRunner = async (input) => {
      observed.push(input.args[0]!);
      return { exitCode: input.args[0] === "lint" ? 2 : 0, stdout: "", stderr: "" };
    };
    await expect(runVerification({ root, taskId: "T001" }, ports(runner)))
      .rejects.toMatchObject({ code: "FY_COMMAND_FAILED" });
    expect(observed).toEqual(["unit", "lint"]);
  });

  test("rejects a successful command that changes the verified inputs", async () => {
    const root = await projectRoot();
    let ran = false;
    const runner: CommandRunner = async () => {
      ran = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    await expect(runVerification({ root, taskId: "T001" },
      ports(runner, cleanGit({ status: async () => ran ? " M src/code.ts" : "" }))))
      .rejects.toMatchObject({ code: "FY_EVIDENCE_INVALID" });
  });
  test("requires a real clean Git HEAD before executing", async () => {
    const root = await projectRoot();
    const runner: CommandRunner = async () => ({ exitCode: 0, stdout: "", stderr: "" });

    await expect(
      runVerification(
        { root, taskId: "T001" },
        ports(runner, cleanGit({ head: async () => { throw new Error("not a repository"); } })),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_GIT_REQUIRED", exitCode: 7 }));
    await expect(
      runVerification({ root, taskId: "T001" }, ports(runner, cleanGit({ status: async () => " M secret.txt\n" }))),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_GIT_REQUIRED" }));
  });

  test("passes the exact argv literally with shell disabled and persists only hashes", async () => {
    const root = await projectRoot('["node","-e","console.log(\\"a & b; $HOME\\")"]');
    let observed: CommandRunInput | undefined;
    const runner: CommandRunner = async (input) => {
      observed = input;
      return { exitCode: 0, stdout: "private success output", stderr: "private warning" };
    };

    const result = await runVerification({ root, taskId: "T001" }, ports(runner));
    const receiptSource = await readFile(result.receiptPath, "utf8");

    expect(observed).toEqual({
      executable: "node",
      args: ["-e", 'console.log("a & b; $HOME")'],
      cwd: root,
      shell: false,
      timeoutMs: 900_000,
      maxBufferBytes: 1_048_576,
    });
    expect(result).toEqual(expect.objectContaining({ status: "passed", stdoutBytes: 22, stderrBytes: 15 }));
    expect(receiptSource).not.toContain("private success output");
    expect(receiptSource).not.toContain("private warning");
  });

  test("persists a failed receipt before returning FY_COMMAND_FAILED", async () => {
    const root = await projectRoot();
    const runner: CommandRunner = async () => ({ exitCode: 3, stdout: "failure detail", stderr: "secret detail" });

    await expect(runVerification({ root, taskId: "T001" }, ports(runner))).rejects.toEqual(
      expect.objectContaining({ code: "FY_COMMAND_FAILED", exitCode: 8 }),
    );
    const evidence = await readdir(path.join(root, ".forgeyard", "evidence"));
    expect(evidence).toHaveLength(1);
    const receipt = await readFile(path.join(root, ".forgeyard", "evidence", evidence[0]!), "utf8");
    expect(receipt).toContain('"status": "failed"');
    expect(receipt).not.toContain("failure detail");
    expect(receipt).not.toContain("secret detail");
  });

  test.each([
    ["missing executable", { exitCode: undefined, stdout: "", stderr: "", notFound: true }, 127],
    ["timeout", { exitCode: undefined, stdout: "", stderr: "", timedOut: true }, 124],
    ["cancellation", { exitCode: undefined, stdout: "", stderr: "", canceled: true }, 130],
  ] as const)("maps %s to stable receipt exit %s", async (_name, commandResult, expectedExit) => {
    const root = await projectRoot();
    const runner: CommandRunner = async () => commandResult;

    await expect(runVerification({ root, taskId: "T001" }, ports(runner))).rejects.toEqual(
      expect.objectContaining({ code: "FY_COMMAND_FAILED" }),
    );
    const [fileName] = await readdir(path.join(root, ".forgeyard", "evidence"));
    const receipt = JSON.parse(await readFile(path.join(root, ".forgeyard", "evidence", fileName!), "utf8"));
    expect(receipt.exitCode).toBe(expectedExit);
  });
});
