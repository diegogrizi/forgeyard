import { createHash } from "node:crypto";
import { open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";

export interface CliProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireBuildLock(repositoryRoot: string) {
  const digest = createHash("sha256").update(path.resolve(repositoryRoot)).digest("hex").slice(0, 20);
  const lockPath = path.join(os.tmpdir(), `forgeyard-test-build-${digest}.lock`);
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return { handle, lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > 120_000) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw inspectionError;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the shared Forgeyard test build lock.");
      await delay(100);
    }
  }
}

export async function buildCli(repositoryRoot: string): Promise<void> {
  const lock = await acquireBuildLock(repositoryRoot);
  try {
    const result = await execa("npm", ["run", "build"], {
      cwd: repositoryRoot,
      shell: false,
      reject: false,
      stdin: "ignore",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Forgeyard CLI build failed.\n${result.stdout}\n${result.stderr}`);
    }
  } finally {
    await lock.handle.close().catch(() => undefined);
    await rm(lock.lockPath, { force: true }).catch(() => undefined);
  }
}

export async function runBuiltCli(
  repositoryRoot: string,
  args: readonly string[],
  cwd: string,
): Promise<CliProcessResult> {
  const result = await execa(process.execPath, [path.join(repositoryRoot, "dist", "cli", "main.js"), ...args], {
    cwd,
    shell: false,
    reject: false,
    stdin: "ignore",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<CliProcessResult> {
  const result = await execa(executable, [...args], {
    cwd,
    shell: false,
    reject: false,
    stdin: "ignore",
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
  });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}
