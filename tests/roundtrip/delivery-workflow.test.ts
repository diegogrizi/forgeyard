import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type {
  DoctorCommandResult,
  InitCommandResult,
  TaskCommandResult,
  VerifyCommandResult,
} from "../../src/application/forgeyard.js";
import { getReceiptStatus } from "../../src/evidence/receipts.js";
import { buildCli, runBuiltCli, runProcess } from "../helpers/cli.js";

const repositoryRoot = path.resolve(".");
const answersPath = path.join(repositoryRoot, "fixtures", "answers", "hackathon.yaml");
let sandboxRoot: string;

function json<T>(source: string): T {
  return JSON.parse(source) as T;
}

async function git(root: string, args: readonly string[]): Promise<void> {
  const result = await runProcess("git", args, root);
  expect(result.exitCode, result.stderr).toBe(0);
}

beforeAll(async () => {
  await buildCli(repositoryRoot);
  sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-delivery-simulation-"));
}, 60_000);

afterAll(async () => {
  if (sandboxRoot !== undefined) await rm(sandboxRoot, { recursive: true, force: true });
});

describe("five-hour resumable delivery fixture", () => {
  test("moves one visible slice through implementation, review, and an offline demo", async () => {
    const root = path.join(sandboxRoot, "project");
    const initialized = await runBuiltCli(repositoryRoot, [
      "init", root, "--profile", "hackathon", "--adapter", "codex", "--answers", answersPath, "--yes", "--json",
    ], sandboxRoot);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    expect(json<InitCommandResult>(initialized.stdout).doctor).toEqual(expect.objectContaining({ failed: 0 }));

    const taskMinutes = await Promise.all(["T001", "T002", "T003", "T004"].map(async (id) => {
      const source = await readFile(path.join(root, ".forgeyard", "tasks", `${id}.yaml`), "utf8");
      const task = parseYaml(source) as { limits: { minutes: number } };
      return task.limits.minutes;
    }));
    expect(taskMinutes).toEqual([90, 135, 30, 45]);
    expect(taskMinutes.reduce((total, minutes) => total + minutes, 0)).toBe(300);

    await git(root, ["init"]);
    await git(root, ["add", "--all"]);
    await git(root, [
      "-c", "user.name=Forgeyard Simulation", "-c", "user.email=forgeyard-simulation@example.invalid",
      "commit", "-m", "initialize simulated delivery",
    ]);

    const initialStatus = json<TaskCommandResult>((await runBuiltCli(
      repositoryRoot, ["task", "status", "--root", root, "--json"], sandboxRoot,
    )).stdout);
    expect(initialStatus.snapshot.readyTaskIds).toEqual(["T001"]);

    for (const args of [
      ["task", "claim", "T001", "--worker", "slice-worker", "--session", "session-before-restart"],
      ["task", "checkpoint", "T001", "--worker", "slice-worker", "--note", "Journey boundary captured"],
      ["task", "resume", "T001", "--worker", "slice-worker"],
    ]) {
      const result = await runBuiltCli(repositoryRoot, [...args, "--root", root, "--json"], sandboxRoot);
      expect(result.exitCode, result.stderr).toBe(0);
    }

    const firstVerification = json<VerifyCommandResult>((await runBuiltCli(
      repositoryRoot, ["verify", "T001", "--root", root, "--json"], sandboxRoot,
    )).stdout);
    const firstCompletion = await runBuiltCli(repositoryRoot, [
      "task", "complete", "T001", "--worker", "slice-worker", "--receipt", firstVerification.receipt.receiptId,
      "--root", root, "--json",
    ], sandboxRoot);
    expect(firstCompletion.exitCode, firstCompletion.stderr).toBe(0);

    const claimImplementation = await runBuiltCli(repositoryRoot, [
      "task", "claim", "T002", "--worker", "implementation-worker", "--root", root, "--json",
    ], sandboxRoot);
    expect(claimImplementation.exitCode, claimImplementation.stderr).toBe(0);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "visible-journey.txt"), "entry -> action -> observable result\n", "utf8");
    await git(root, ["add", "src/visible-journey.txt"]);
    await git(root, [
      "-c", "user.name=Forgeyard Simulation", "-c", "user.email=forgeyard-simulation@example.invalid",
      "commit", "-m", "implement visible journey",
    ]);

    expect(await getReceiptStatus(root, firstVerification.receipt)).toBe("stale");

    async function verifyAndComplete(taskId: string, workerId: string): Promise<void> {
      const verificationProcess = await runBuiltCli(
        repositoryRoot, ["verify", taskId, "--root", root, "--json"], sandboxRoot,
      );
      expect(verificationProcess.exitCode, verificationProcess.stderr).toBe(0);
      const verification = json<VerifyCommandResult>(verificationProcess.stdout);
      const completion = await runBuiltCli(repositoryRoot, [
        "task", "complete", taskId, "--worker", workerId, "--receipt", verification.receipt.receiptId,
        "--root", root, "--json",
      ], sandboxRoot);
      expect(completion.exitCode, completion.stderr).toBe(0);
    }

    await verifyAndComplete("T002", "implementation-worker");
    for (const [taskId, workerId] of [["T003", "review-worker"], ["T004", "demo-worker"]] as const) {
      const claim = await runBuiltCli(repositoryRoot, [
        "task", "claim", taskId, "--worker", workerId, "--root", root, "--json",
      ], sandboxRoot);
      expect(claim.exitCode, claim.stderr).toBe(0);
      await verifyAndComplete(taskId, workerId);
    }

    const finalStatus = json<TaskCommandResult>((await runBuiltCli(
      repositoryRoot, ["task", "status", "--root", root, "--json"], sandboxRoot,
    )).stdout);
    expect(finalStatus.snapshot.readyTaskIds).toEqual([]);
    expect(finalStatus.snapshot.tasks.map((task) => task.status)).toEqual([
      "completed", "completed", "completed", "completed",
    ]);

    const doctorProcess = await runBuiltCli(repositoryRoot, ["doctor", root, "--json"], sandboxRoot);
    expect(doctorProcess.exitCode, doctorProcess.stderr).toBe(0);
    expect(json<DoctorCommandResult>(doctorProcess.stdout).checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "presentation-output", status: "passed" }),
    ]));
    expect(await readFile(path.join(root, "presentation", "index.html"), "utf8")).toContain("Signal Garden");

    const ledger = (await readFile(path.join(root, ".forgeyard", "ledger", "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { kind: string; taskId: string });
    expect(ledger.filter((event) => event.kind === "task-transition")).toHaveLength(10);
    expect(new Set(ledger.map((event) => event.taskId))).toEqual(new Set(["T001", "T002", "T003", "T004"]));
  }, 60_000);
});
