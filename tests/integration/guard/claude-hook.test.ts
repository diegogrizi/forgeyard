import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];
const hookSource = path.resolve("packs/foundation/templates/write-guard.mjs");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(activeTasks = 1): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-hook-"));
  roots.push(root);
  await mkdir(path.join(root, ".forgeyard", "state"), { recursive: true });
  await mkdir(path.join(root, "src", "feature"), { recursive: true });
  const tasks = Object.fromEntries(Array.from({ length: activeTasks }, (_, index) => {
    const id = `T00${index + 1}`;
    return [id, {
      definitionSha256: "a".repeat(64),
      status: "active",
      attempts: 1,
      consecutiveFailures: 0,
      workerId: `worker-${index + 1}`,
      sessionId: `session-${index + 1}`,
      claimedAt: "2026-09-15T12:00:00.000Z",
      deadlineAt: "2026-09-15T13:00:00.000Z",
      guard: {
        writeScopes: index === 0 ? ["src/feature"] : ["src/other"],
        protectedPaths: [".git", ".env"],
      },
    }];
  }));
  await writeFile(path.join(root, ".forgeyard", "state", "run.json"), `${JSON.stringify({
    schemaVersion: 1,
    graphSha256: "b".repeat(64),
    createdAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    stopped: null,
    tasks,
  }, null, 2)}\n`, "utf8");
  return root;
}

async function invoke(root: string, toolName: string, toolInput: Record<string, unknown>, sessionId = "session-1") {
  const result = await execa(process.execPath, [hookSource], {
    cwd: root,
    input: JSON.stringify({
      session_id: sessionId,
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
    }),
    reject: false,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

describe("Claude Code pre-tool write guard", () => {
  test("allows an in-scope file tool without bypassing normal permission checks", async () => {
    const root = await project();
    expect(await invoke(root, "Write", { file_path: path.join(root, "src", "feature", "new.ts") })).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  test.each([
    ["Write", { file_path: "src/other/new.ts" }, "outside the claimed task write scopes"],
    ["Edit", { file_path: ".env" }, "protected project path"],
    ["NotebookEdit", { notebook_path: "../outside.ipynb" }, "outside the selected project"],
    ["Write", {}, "does not contain a supported file path"],
  ])("denies %s before execution", async (toolName, toolInput, reason) => {
    const root = await project();
    const result = await invoke(root, toolName, toolInput);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output.hookSpecificOutput).toEqual(expect.objectContaining({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining(reason),
    }));
  });

  test("fails closed when multiple active tasks cannot be bound to the session", async () => {
    const root = await project(2);
    const result = await invoke(root, "Write", { file_path: "src/feature/new.ts" }, "unknown-session");
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain("task identity is ambiguous");
  });
});
