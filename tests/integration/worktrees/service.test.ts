import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, test } from "vitest";

import { loadTaskGraph } from "../../../src/orchestrator/graph.js";
import { createTaskScheduler } from "../../../src/orchestrator/scheduler.js";
import {
  createWorktreeService,
  nodeWorktreeGitPort,
  type WorktreeGitPort,
} from "../../../src/worktrees/service.js";

const roots: string[] = [];
const integrationLockRef = "refs/forgeyard/locks/integration";

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await execa("git", [...args], { cwd, shell: false, reject: false });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function installIntegrationLock(
  root: string,
  owner: { token: string; pid: number; hostname: string; createdAt: string },
): Promise<string> {
  return installIntegrationLockSource(root, `${JSON.stringify({ schemaVersion: 1, ...owner })}\n`, owner.token);
}

async function installIntegrationLockSource(root: string, source: string, suffix: string): Promise<string> {
  const ownerPath = path.join(root, ".forgeyard", "state", `test-lock-${suffix}.json`);
  await writeFile(ownerPath, source, "utf8");
  const hashed = await execa("git", ["hash-object", "-w", ownerPath], { cwd: root, shell: false, reject: false });
  if (hashed.exitCode !== 0) throw new Error(`git hash-object failed: ${hashed.stderr}`);
  const oid = hashed.stdout.trim();
  await rm(ownerPath);
  await git(root, ["update-ref", integrationLockRef, oid]);
  return oid;
}

async function fixture(): Promise<{
  root: string;
  graph: Awaited<ReturnType<typeof loadTaskGraph>>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-worktree-"));
  roots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, ".forgeyard", ".gitignore"), [
    "evidence/",
    "ledger/",
    "state/run.json",
    "state/run.lock",
    "state/integration.lock",
    "state/run.json.tmp-*",
    "state/worktrees/",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, ".forgeyard", "tasks", "T001.yaml"), [
    "schemaVersion: 1",
    "id: T001",
    "title: Build visible feature",
    "objective: Build a committed visible feature",
    "acceptanceCriteria:",
    "  - The feature file exists",
    "dependsOn: []",
    "writeScopes: [src]",
    "role: implementer",
    "capabilities: [implementation]",
    "limits:",
    "  minutes: 45",
    "  maxRetries: 2",
    "evidence:",
    "  required: true",
    "integration:",
    "  owner: integrator",
    "  target: current",
    "command:",
    "  - node",
    "  - -e",
    "  - if(require('node:fs').existsSync('src/block.txt'))process.exit(1);require('node:fs').accessSync('src/feature.txt')",
    "required: true",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "src", "base.txt"), "base\n", "utf8");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Forgeyard Test"]);
  await git(root, ["config", "user.email", "forgeyard@example.invalid"]);
  await git(root, ["add", "--all"]);
  await git(root, ["commit", "-m", "base"]);
  return {
    root,
    graph: await loadTaskGraph({ root, mutableRoots: ["src"], protectedPaths: [".git", ".env"] }),
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await execa("git", ["worktree", "prune"], { cwd: root, shell: false, reject: false }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe("isolated Git task workspaces", () => {
  test("creates, validates, and serially integrates a claimed task without pushing", async () => {
    const { root, graph } = await fixture();
    const scheduler = createTaskScheduler({ root, graph, maxConcurrency: 4 });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one", sessionId: "session-one" });
    const service = createWorktreeService({ root, graph, maxConcurrency: 4 });

    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    expect(created).toEqual(expect.objectContaining({
      status: "created",
      branch: "forgeyard/t001-worker-one",
      targetBranch: "main",
    }));
    expect((await service.create({ taskId: "T001", workerId: "worker-one" })).workspaceRoot).toBe(created.workspaceRoot);

    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);

    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });
    expect(validated).toEqual(expect.objectContaining({
      status: "validated",
      validatedCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      receiptId: expect.stringMatching(/^receipt-/),
    }));

    await installIntegrationLock(root, {
      token: "b".repeat(32),
      pid: process.ppid,
      hostname: os.hostname(),
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_INTEGRATION_BUSY" }),
    );
    await git(root, ["update-ref", "-d", integrationLockRef]);

    await writeFile(path.join(root, "dirty.txt"), "user change\n", "utf8");
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_GIT_DIRTY" }),
    );
    await rm(path.join(root, "dirty.txt"));

    const integrated = await service.integrate({ taskId: "T001", workerId: "worker-one" });
    expect(integrated).toEqual(expect.objectContaining({
      status: "integrated",
      integratedCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      receiptId: expect.stringMatching(/^receipt-/),
    }));
    expect((await readFile(path.join(root, "src", "feature.txt"), "utf8")).replaceAll("\r\n", "\n")).toBe("visible feature\n");
    expect((await scheduler.status()).tasks[0]).toEqual(expect.objectContaining({
      status: "completed",
      workspace: expect.objectContaining({
        status: "integrated",
        cleanedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    }));
    await expect(stat(created.workspaceRoot)).rejects.toEqual(expect.objectContaining({ code: "ENOENT" }));
    const registeredWorktrees = await execa("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      shell: false,
      reject: false,
    });
    expect(registeredWorktrees.stdout.replaceAll("\\", "/")).not.toContain(created.workspaceRoot.replaceAll("\\", "/"));
    const workerBranch = await execa("git", ["branch", "--list", created.branch], { cwd: root, shell: false, reject: false });
    expect(workerBranch.stdout).toBe("");
    const remotes = await execa("git", ["remote"], { cwd: root, shell: false, reject: false });
    expect(remotes.stdout).toBe("");
  }, 30_000);

  test("refuses validation until the isolated branch has a committed change", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const service = createWorktreeService({ root, graph, maxConcurrency: 4 });
    await service.create({ taskId: "T001", workerId: "worker-one" });

    await expect(service.validate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_UNCHANGED" }),
    );
  });

  test("retries cleanup without repeating an integration that already succeeded", async () => {
    const { root, graph } = await fixture();
    const scheduler = createTaskScheduler({ root, graph, maxConcurrency: 4 });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one", sessionId: "session-one" });
    let rejectFirstRemoval = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    expect((await scheduler.status()).tasks[0]).toEqual(expect.objectContaining({
      status: "completed",
      workspace: expect.objectContaining({ status: "integrated" }),
    }));
    await expect(stat(created.workspaceRoot)).resolves.toBeDefined();

    const cleaned = await service.cleanup({ taskId: "T001", workerId: "worker-one" });
    expect(cleaned).toEqual(expect.objectContaining({
      status: "integrated",
      cleanedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }));
    await expect(stat(created.workspaceRoot)).rejects.toEqual(expect.objectContaining({ code: "ENOENT" }));
    expect((await service.cleanup({ taskId: "T001", workerId: "worker-one" })).cleanedAt).toBe(cleaned.cleanedAt);
  }, 30_000);

  test("removes only the stale registration for the integrated task worktree", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({
      taskId: "T001",
      workerId: "worker-one",
    });
    let rejectFirstRemoval = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    const unrelatedRoot = path.join(root, ".forgeyard", "state", "worktrees", "unrelated-worker");
    await git(root, ["worktree", "add", "-b", "forgeyard/unrelated-worker", unrelatedRoot, "HEAD"]);
    await rm(created.workspaceRoot, { recursive: true, force: true });
    await rm(unrelatedRoot, { recursive: true, force: true });

    await expect(service.cleanup({ taskId: "T001", workerId: "worker-one" })).resolves.toEqual(
      expect.objectContaining({ cleanedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }),
    );
    const registeredWorktrees = await execa("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      shell: false,
      reject: false,
    });
    expect(registeredWorktrees.stdout.replaceAll("\\", "/")).not.toContain(created.workspaceRoot.replaceAll("\\", "/"));
    expect(registeredWorktrees.stdout.replaceAll("\\", "/")).toContain(unrelatedRoot.replaceAll("\\", "/"));
    const workerBranch = await execa("git", ["branch", "--list", created.branch], { cwd: root, shell: false, reject: false });
    expect(workerBranch.stdout).toBe("");
  }, 30_000);

  test("refuses to delete a workspace path that Git no longer registers", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({
      taskId: "T001",
      workerId: "worker-one",
    });
    let rejectFirstRemoval = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    await git(root, ["worktree", "remove", "--force", created.workspaceRoot]);
    await mkdir(created.workspaceRoot, { recursive: true });
    const userFile = path.join(created.workspaceRoot, "user-data.txt");
    await writeFile(userFile, "preserve me\n", "utf8");

    await expect(service.cleanup({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    await expect(readFile(userFile, "utf8")).resolves.toBe("preserve me\n");
    const workerBranch = await execa("git", ["branch", "--list", created.branch], { cwd: root, shell: false, reject: false });
    expect(workerBranch.stdout.trim()).toContain(created.branch);
  }, 30_000);

  test("does not record cleanup when Git cannot determine whether the worker branch exists", async () => {
    const { root, graph } = await fixture();
    const scheduler = createTaskScheduler({ root, graph, maxConcurrency: 4 });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (args[0] === "show-ref" && args.at(-1)?.startsWith("refs/heads/")) {
          return { exitCode: 128, stdout: "", stderr: "simulated repository read failure" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    expect((await scheduler.status()).tasks[0]?.workspace?.cleanedAt).toBeUndefined();
    const workerBranch = await execa("git", ["branch", "--list", created.branch], { cwd: root, shell: false, reject: false });
    expect(workerBranch.stdout.trim()).toContain(created.branch);
  }, 30_000);

  test("refuses to delete a worker branch name that was repointed after integration", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    let rejectFirstRemoval = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    await git(root, ["worktree", "remove", "--force", created.workspaceRoot]);
    await git(root, ["branch", "-f", created.branch, "HEAD"]);
    const repointed = (await execa("git", ["rev-parse", "HEAD"], { cwd: root, shell: false })).stdout.trim();
    expect(repointed).not.toBe(validated.validatedCommit);

    await expect(service.cleanup({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_STALE" }),
    );
    const preservedBranch = await execa("git", ["rev-parse", `refs/heads/${created.branch}`], { cwd: root, shell: false });
    expect(preservedBranch.stdout.trim()).toBe(repointed);
  }, 30_000);

  test("deletes the worker branch only if it still has the validated revision at the atomic deletion", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const workerBranch = "forgeyard/t001-worker-one";
    let branchRevisionReads = 0;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        const result = await nodeWorktreeGitPort.run(cwd, args, input);
        if (
          result.exitCode === 0 &&
          args[0] === "show-ref" &&
          args[2] === "--hash" &&
          args.at(-1) === `refs/heads/${workerBranch}` &&
          ++branchRevisionReads === 2
        ) {
          const repointed = await nodeWorktreeGitPort.run(root, ["branch", "-f", workerBranch, "HEAD"]);
          if (repointed.exitCode !== 0) throw new Error(`test branch repoint failed: ${repointed.stderr}`);
        }
        return result;
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_STALE" }),
    );
    await expect(stat(created.workspaceRoot)).rejects.toEqual(expect.objectContaining({ code: "ENOENT" }));
    const integrationHead = (await execa("git", ["rev-parse", "HEAD"], { cwd: root, shell: false })).stdout.trim();
    expect(integrationHead).not.toBe(validated.validatedCommit);
    const preservedBranch = await execa("git", ["rev-parse", `refs/heads/${created.branch}`], { cwd: root, shell: false });
    expect(preservedBranch.stdout.trim()).toBe(integrationHead);
  }, 30_000);

  test("preserves the worker branch when the target branch moves at deletion time", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const workerRef = "refs/heads/forgeyard/t001-worker-one";
    let baseCommit = "";
    let targetReset = false;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        const deletesWorker = args[0] === "update-ref" && (
          (args[1] === "-d" && args[2] === workerRef) ||
          args[1] === "--stdin"
        );
        if (!targetReset && deletesWorker) {
          targetReset = true;
          const reset = await nodeWorktreeGitPort.run(root, ["reset", "--hard", baseCommit]);
          if (reset.exitCode !== 0) throw new Error(`test target reset failed: ${reset.stderr}`);
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    baseCommit = created.baseCommit;
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_STALE" }),
    );
    expect((await execa("git", ["rev-parse", "HEAD"], { cwd: root, shell: false })).stdout.trim()).toBe(baseCommit);
    const preservedBranch = await execa("git", ["rev-parse", workerRef], { cwd: root, shell: false });
    expect(preservedBranch.stdout.trim()).toBe(validated.validatedCommit);
    expect((await createTaskScheduler({ root, graph, maxConcurrency: 4 }).status()).tasks[0]?.workspace?.cleanedAt).toBeUndefined();
  }, 30_000);

  test("refuses cleanup when the target branch no longer contains the recorded integration", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    let rejectFirstRemoval = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    const validated = await service.validate({ taskId: "T001", workerId: "worker-one" });
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    await git(root, ["worktree", "remove", "--force", created.workspaceRoot]);
    await git(root, ["reset", "--hard", created.baseCommit]);

    await expect(service.cleanup({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_STALE" }),
    );
    const workerBranch = await execa("git", ["rev-parse", `refs/heads/${created.branch}`], { cwd: root, shell: false });
    expect(workerBranch.stdout.trim()).toBe(validated.validatedCommit);
  }, 30_000);

  test("recovers an integration lock owned by a dead local process", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const service = createWorktreeService({ root, graph, maxConcurrency: 4 });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });
    await installIntegrationLock(root, {
      token: "a".repeat(32),
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).resolves.toEqual(
      expect.objectContaining({ status: "integrated", cleanedAt: expect.any(String) }),
    );
    const lockRef = await execa("git", ["show-ref", "--verify", "--quiet", integrationLockRef], {
      cwd: root,
      shell: false,
      reject: false,
    });
    expect(lockRef.exitCode).toBe(1);
  }, 30_000);

  test("does not steal a malformed integration lock", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const service = createWorktreeService({ root, graph, maxConcurrency: 4 });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });
    const malformedOid = await installIntegrationLockSource(root, "{\n", "malformed");

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_INTEGRATION_BUSY" }),
    );
    const preserved = await execa("git", ["show-ref", "--verify", "--hash", integrationLockRef], {
      cwd: root,
      shell: false,
    });
    expect(preserved.stdout.trim()).toBe(malformedOid);
    await git(root, ["update-ref", "-d", integrationLockRef, malformedOid]);
  }, 30_000);

  test("allows only one atomic takeover of a dead integration lock", async () => {
    const { root, graph } = await fixture();
    const scheduler = createTaskScheduler({ root, graph, maxConcurrency: 4 });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    let rejectFirstRemoval = true;
    const initialGitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (rejectFirstRemoval && args[0] === "worktree" && args[1] === "remove") {
          rejectFirstRemoval = false;
          return { exitCode: 1, stdout: "", stderr: "simulated transient lock" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const initialService = createWorktreeService({ root, graph, maxConcurrency: 4, git: initialGitPort });
    const created = await initialService.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await initialService.validate({ taskId: "T001", workerId: "worker-one" });
    await expect(initialService.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    const deadOid = await installIntegrationLock(root, {
      token: "d".repeat(32),
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    let takeoverAttempts = 0;
    let releaseTakeovers!: () => void;
    const takeoversReleased = new Promise<void>((resolve) => { releaseTakeovers = resolve; });
    let bothTakeoversReady!: () => void;
    const bothTakeovers = new Promise<void>((resolve) => { bothTakeoversReady = resolve; });
    let allowWinnerCleanup!: () => void;
    const winnerCleanupAllowed = new Promise<void>((resolve) => { allowWinnerCleanup = resolve; });
    let winnerEnteredCleanup!: () => void;
    const winnerInCleanup = new Promise<void>((resolve) => { winnerEnteredCleanup = resolve; });
    let winnerBlocked = false;
    const concurrentGitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (
          args[0] === "update-ref" &&
          args[1] === integrationLockRef &&
          args.length === 4 &&
          args[3] === deadOid
        ) {
          takeoverAttempts += 1;
          if (takeoverAttempts === 2) bothTakeoversReady();
          await takeoversReleased;
        }
        const result = await nodeWorktreeGitPort.run(cwd, args, input);
        if (
          !winnerBlocked &&
          result.exitCode === 0 &&
          args[0] === "show-ref" &&
          args.at(-1) === `refs/heads/${created.branch}`
        ) {
          winnerBlocked = true;
          winnerEnteredCleanup();
          await winnerCleanupAllowed;
        }
        return result;
      },
    };
    const firstService = createWorktreeService({ root, graph, maxConcurrency: 4, git: concurrentGitPort });
    const secondService = createWorktreeService({ root, graph, maxConcurrency: 4, git: concurrentGitPort });
    const firstCleanup = firstService.cleanup({ taskId: "T001", workerId: "worker-one" });
    const secondCleanup = secondService.cleanup({ taskId: "T001", workerId: "worker-one" });

    await bothTakeovers;
    releaseTakeovers();
    await winnerInCleanup;
    allowWinnerCleanup();
    const results = await Promise.allSettled([firstCleanup, secondCleanup]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toEqual(expect.objectContaining({ code: "FY_INTEGRATION_BUSY" }));
    expect((await scheduler.status()).tasks[0]?.workspace?.cleanedAt).toEqual(expect.any(String));
    const lockRef = await execa("git", ["show-ref", "--verify", "--quiet", integrationLockRef], {
      cwd: root,
      shell: false,
      reject: false,
    });
    expect(lockRef.exitCode).toBe(1);
  }, 30_000);

  test("retries cleanup after worktree removal without repeating the completed merge", async () => {
    const { root, graph } = await fixture();
    const scheduler = createTaskScheduler({ root, graph, maxConcurrency: 4 });
    await scheduler.claim({ taskId: "T001", workerId: "worker-one" });
    let rejectFirstBranchDeletion = true;
    const gitPort: WorktreeGitPort = {
      async run(cwd, args, input) {
        if (
          rejectFirstBranchDeletion &&
          args[0] === "update-ref" &&
          args[1] === "--stdin" &&
          input?.includes("delete refs/heads/forgeyard/")
        ) {
          rejectFirstBranchDeletion = false;
          return { exitCode: 1, stdout: "", stderr: "simulated branch deletion failure" };
        }
        return nodeWorktreeGitPort.run(cwd, args, input);
      },
    };
    const service = createWorktreeService({ root, graph, maxConcurrency: 4, git: gitPort });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "visible feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "build visible feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });

    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_WORKTREE_CLEANUP_FAILED" }),
    );
    const integratedHead = (await execa("git", ["rev-parse", "HEAD"], { cwd: root, shell: false })).stdout.trim();
    await expect(stat(created.workspaceRoot)).rejects.toEqual(expect.objectContaining({ code: "ENOENT" }));
    expect((await scheduler.status()).tasks[0]).toEqual(expect.objectContaining({
      status: "completed",
      workspace: expect.objectContaining({ integratedCommit: integratedHead }),
    }));

    await expect(service.cleanup({ taskId: "T001", workerId: "worker-one" })).resolves.toEqual(
      expect.objectContaining({ cleanedAt: expect.any(String), integratedCommit: integratedHead }),
    );
    expect((await execa("git", ["rev-parse", "HEAD"], { cwd: root, shell: false })).stdout.trim()).toBe(integratedHead);
    expect((await execa("git", ["branch", "--list", created.branch], { cwd: root, shell: false })).stdout).toBe("");
  }, 30_000);

  test("aborts an uncommitted merge when the combined-tree gate fails", async () => {
    const { root, graph } = await fixture();
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const service = createWorktreeService({ root, graph, maxConcurrency: 4 });
    const created = await service.create({ taskId: "T001", workerId: "worker-one" });
    await writeFile(path.join(created.workspaceRoot, "src", "feature.txt"), "feature\n", "utf8");
    await git(created.workspaceRoot, ["add", "src/feature.txt"]);
    await git(created.workspaceRoot, ["commit", "-m", "feature"]);
    await service.validate({ taskId: "T001", workerId: "worker-one" });

    await writeFile(path.join(root, "src", "block.txt"), "independent incompatible change\n", "utf8");
    await git(root, ["add", "src/block.txt"]);
    await git(root, ["commit", "-m", "add integration blocker"]);
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_INTEGRATION_CHECK_FAILED" }),
    );

    await expect(readFile(path.join(root, "src", "feature.txt"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
    const status = await execa("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
      shell: false,
      reject: false,
    });
    expect(status.stdout).toBe("");
  });
});
