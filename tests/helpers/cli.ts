import path from "node:path";

import { execa } from "execa";

export interface CliProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function buildCli(repositoryRoot: string): Promise<void> {
  const result = await execa("npm", ["run", "build"], {
    cwd: repositoryRoot,
    shell: false,
    reject: false,
    stdin: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Forgeyard CLI build failed.\n${result.stdout}\n${result.stderr}`);
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
): Promise<CliProcessResult> {
  const result = await execa(executable, [...args], {
    cwd,
    shell: false,
    reject: false,
    stdin: "ignore",
  });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}
