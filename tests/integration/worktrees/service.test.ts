import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, test } from "vitest";

import { loadTaskGraph } from "../../../src/orchestrator/graph.js";
import { createTaskScheduler } from "../../../src/orchestrator/scheduler.js";
import { createWorktreeService } from "../../../src/worktrees/service.js";

const roots: string[] = [];

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await execa("git", [...args], { cwd, shell: false, reject: false });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
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

    const integrationLock = path.join(root, ".forgeyard", "state", "integration.lock");
    await writeFile(integrationLock, "another integrator\n", "utf8");
    await expect(service.integrate({ taskId: "T001", workerId: "worker-one" })).rejects.toEqual(
      expect.objectContaining({ code: "FY_INTEGRATION_BUSY" }),
    );
    await rm(integrationLock);

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
      workspace: expect.objectContaining({ status: "integrated" }),
    }));
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
