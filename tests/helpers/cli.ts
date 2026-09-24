import { createHash } from "node:crypto";
import { open, readdir, rm, stat } from "node:fs/promises";
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

/**
 * Newest modification time across the inputs a build depends on. Cheap: about seventy files.
 */
async function newestInputMtime(repositoryRoot: string): Promise<number> {
  let newest = 0;
  const visit = async (target: string): Promise<void> => {
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const candidate = path.join(target, entry.name);
      if (entry.isDirectory()) return visit(candidate);
      const info = await stat(candidate).catch(() => undefined);
      if (info && info.mtimeMs > newest) newest = info.mtimeMs;
    }));
  };
  await visit(path.join(repositoryRoot, "src"));
  for (const file of ["package.json", "tsup.config.ts", "tsconfig.json"]) {
    const info = await stat(path.join(repositoryRoot, file)).catch(() => undefined);
    if (info && info.mtimeMs > newest) newest = info.mtimeMs;
  }
  return newest;
}

async function builtOutputIsCurrent(repositoryRoot: string): Promise<boolean> {
  const built = await stat(path.join(repositoryRoot, "dist", "cli", "main.js")).catch(() => undefined);
  return built !== undefined && built.mtimeMs >= await newestInputMtime(repositoryRoot);
}

/**
 * Build once for the whole run, not once per test file. Seven files call this, and `tsup`
 * cleans its output folder first: with parallel files, one rebuild wiped `dist/` while another
 * file was executing the binary inside it. The lock alone did not help — it serialised the
 * builds, not the use of what they produced. Skipping a build that is already current removes
 * the clobbering entirely, and the second check under the lock covers the race to be first.
 */
export async function buildCli(repositoryRoot: string): Promise<void> {
  if (await builtOutputIsCurrent(repositoryRoot)) return;
  const lock = await acquireBuildLock(repositoryRoot);
  try {
    if (await builtOutputIsCurrent(repositoryRoot)) return;
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
