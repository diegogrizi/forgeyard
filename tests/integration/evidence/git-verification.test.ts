import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";
import { execa } from "execa";

import { getReceiptStatus } from "../../../src/evidence/receipts.js";
import { runVerification } from "../../../src/evidence/run-verification.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("a real Git commit change makes prior verification evidence stale", async ({ skip }) => {
  const available = await execa("git", ["--version"], { reject: false, shell: false });
  if (available.exitCode !== 0) skip("Git is unavailable on this host");

  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-real-git-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  await writeFile(path.join(root, ".forgeyard", ".gitignore"), "evidence/\n", "utf8");
  await writeFile(
    path.join(root, ".forgeyard", "tasks", "T001.yaml"),
    'schemaVersion: 1\nid: T001\ntitle: Verify slice\ncommand: ["node", "-e", "process.exit(0)"]\nrequired: true\n',
    "utf8",
  );
  await execa("git", ["init"], { cwd: root, shell: false });
  await execa("git", ["add", "."], { cwd: root, shell: false });
  await execa(
    "git",
    ["-c", "user.name=Forgeyard Test", "-c", "user.email=test@invalid.example", "commit", "-m", "initial"],
    { cwd: root, shell: false },
  );

  const result = await runVerification({ root, taskId: "T001" });

  await expect(getReceiptStatus(root, result.receipt)).resolves.toBe("current");
  await writeFile(path.join(root, "sentinel.txt"), "new revision\n", "utf8");
  await execa("git", ["add", "sentinel.txt"], { cwd: root, shell: false });
  await execa(
    "git",
    ["-c", "user.name=Forgeyard Test", "-c", "user.email=test@invalid.example", "commit", "-m", "next"],
    { cwd: root, shell: false },
  );
  await expect(getReceiptStatus(root, result.receipt)).resolves.toBe("stale");
});
