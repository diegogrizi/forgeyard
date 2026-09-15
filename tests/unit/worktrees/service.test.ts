import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { loadTaskGraph } from "../../../src/orchestrator/graph.js";
import { createTaskScheduler } from "../../../src/orchestrator/scheduler.js";
import { createWorktreeService, type WorktreeGitPort } from "../../../src/worktrees/service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("worktree Git port", () => {
  test("passes argument arrays and preserves state when Git rejects worktree creation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-worktree-port-"));
    roots.push(root);
    await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
    await writeFile(path.join(root, ".forgeyard", "tasks", "T001.yaml"), [
      "schemaVersion: 1",
      "id: T001",
      "title: Test task",
      "writeScopes: [src]",
      'command: ["node", "-e", "process.exit(0)"]',
      "required: true",
      "",
    ].join("\n"), "utf8");
    const graph = await loadTaskGraph({ root, mutableRoots: ["src"], protectedPaths: [".git"] });
    await createTaskScheduler({ root, graph, maxConcurrency: 4 }).claim({ taskId: "T001", workerId: "worker-one" });
    const run = vi.fn<WorktreeGitPort["run"]>(async (_cwd, args) => {
      if (args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { exitCode: 0, stdout: "a".repeat(40), stderr: "" };
      if (args[0] === "branch" && args[1] === "--show-current") return { exitCode: 0, stdout: "main", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "simulated worktree failure" };
    });
    const git: WorktreeGitPort = { run };

    await expect(createWorktreeService({ root, graph, maxConcurrency: 4, git }).create({
      taskId: "T001",
      workerId: "worker-one",
    })).rejects.toEqual(expect.objectContaining({ code: "FY_WORKTREE_FAILED" }));
    expect(run.mock.calls.at(-1)?.[1].slice(0, 3)).toEqual(["worktree", "add", "-b"]);
    expect((await createTaskScheduler({ root, graph, maxConcurrency: 4 }).status()).tasks[0]!.workspace).toBeUndefined();
  });
});
