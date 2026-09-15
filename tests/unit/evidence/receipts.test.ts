import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { canonicalJson, sha256Text } from "../../../src/core/hash.js";
import type { VerificationReceipt } from "../../../src/core/contracts.js";
import {
  buildReceipt,
  getReceiptStatus,
  loadTask,
  parseReceipt,
  serializeReceipt,
  type GitPort,
} from "../../../src/evidence/receipts.js";

const temporaryRoots: string[] = [];
const taskSource = [
  "schemaVersion: 1",
  "id: T001",
  'title: "Verify the visible slice"',
  "command:",
  '  - "node"',
  '  - "-e"',
  '  - "process.exit(0)"',
  "required: true",
  "",
].join("\n");

async function taskRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-receipt-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".forgeyard", "tasks", "T001.yaml"), taskSource, "utf8");
  return root;
}

function receipt(overrides: Partial<VerificationReceipt> = {}): VerificationReceipt {
  return {
    schemaVersion: 1,
    receiptId: "receipt-001",
    taskId: "T001",
    taskSha256: sha256Text(taskSource),
    argvSha256: sha256Text(canonicalJson(["node", "-e", "process.exit(0)"])),
    gitCommit: "a".repeat(40),
    startedAt: "2026-09-15T12:00:00.000Z",
    finishedAt: "2026-09-15T12:00:00.025Z",
    durationMs: 25,
    exitCode: 0,
    stdoutSha256: sha256Text("private stdout"),
    stderrSha256: sha256Text(""),
    status: "passed",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verification receipts", () => {
  test("builds a schema-valid receipt containing hashes but no output bodies", () => {
    const built = buildReceipt({
      receiptId: "receipt-001",
      taskId: "T001",
      taskSource,
      argv: ["node", "-e", "process.exit(0)"],
      gitCommit: "a".repeat(40),
      startedAt: "2026-09-15T12:00:00.000Z",
      finishedAt: "2026-09-15T12:00:00.025Z",
      durationMs: 25,
      exitCode: 0,
      stdout: "private stdout",
      stderr: "private stderr",
    });
    const serialized = serializeReceipt(built);

    expect(parseReceipt(serialized, "receipt.json")).toEqual(built);
    expect(built.taskSha256).toBe(sha256Text(taskSource));
    expect(built.argvSha256).toBe(sha256Text(canonicalJson(["node", "-e", "process.exit(0)"])));
    expect(serialized).not.toContain("private stdout");
    expect(serialized).not.toContain("private stderr");
  });

  test("loads only a safe task ID and hashes its exact bytes", async () => {
    const root = await taskRoot();

    const loaded = await loadTask(root, "T001");

    expect(loaded.source).toBe(taskSource);
    expect(loaded.sha256).toBe(sha256Text(taskSource));
    await expect(loadTask(root, "../outside")).rejects.toEqual(
      expect.objectContaining({ code: "FY_CONFIG_INVALID" }),
    );
  });

  test("marks receipts stale when HEAD, task bytes, or argv no longer match", async () => {
    const root = await taskRoot();
    let head = "a".repeat(40);
    const git: GitPort = {
      head: async () => head,
      status: async () => "",
    };

    await expect(getReceiptStatus(root, receipt(), git)).resolves.toBe("current");
    head = "b".repeat(40);
    await expect(getReceiptStatus(root, receipt(), git)).resolves.toBe("stale");
    head = "a".repeat(40);
    await writeFile(
      path.join(root, ".forgeyard", "tasks", "T001.yaml"),
      taskSource.replace("process.exit(0)", "process.exit(1)"),
      "utf8",
    );
    await expect(getReceiptStatus(root, receipt(), git)).resolves.toBe("stale");

    const changed = await loadTask(root, "T001");
    await expect(
      getReceiptStatus(root, receipt({ taskSha256: changed.sha256 }), git),
    ).resolves.toBe("stale");
  });
});
