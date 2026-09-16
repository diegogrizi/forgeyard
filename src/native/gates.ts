import { execa } from "execa";

import type { NativeGateRunner } from "./contracts.js";
import { resolveInsideRoot } from "../core/paths.js";
import { assertDirectoryChain } from "./files.js";

const ENVIRONMENT_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC",
  "ComSpec", "TEMP", "TMP", "TMPDIR", "JAVA_HOME", "MAVEN_HOME"];

export function gateEnvironment(environment = process.env): Record<string, string> {
  const result: Record<string, string> = { CI: "1", NO_COLOR: "1", npm_config_offline: "true" };
  for (const name of ENVIRONMENT_KEYS) if (environment[name] !== undefined) result[name] = environment[name]!;
  return result;
}

export const nativeGateRunner: NativeGateRunner = async ({ gate, cwd, signal, onSpawn }) => {
  let observerFailed = false;
  try {
    const workingDirectory = gate.cwd === undefined ? cwd : resolveInsideRoot(cwd, gate.cwd);
    await assertDirectoryChain(workingDirectory);
    const execution = execa(gate.argv[0], gate.argv.slice(1), {
      cwd: workingDirectory, shell: false, reject: false, stdin: "ignore", extendEnv: false,
      env: gateEnvironment(), cancelSignal: signal, timeout: gate.timeoutMs,
      maxBuffer: gate.maxOutputBytes, stripFinalNewline: false, forceKillAfterDelay: 1000,
    });
    try { if (execution.pid) onSpawn?.(execution.pid); }
    catch (error) { observerFailed = true; execution.kill("SIGTERM"); await execution.catch(() => {}); throw error; }
    const result = await execution;
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr,
      ...(result.isCanceled ? { canceled: true } : {}), ...(result.timedOut ? { timedOut: true } : {}) };
  } catch (error) {
    if (observerFailed) throw error;
    const result = error as { exitCode?: number; stdout?: string; stderr?: string; isCanceled?: boolean; timedOut?: boolean };
    return { exitCode: result.isCanceled ? 130 : result.timedOut ? 124 : result.exitCode ?? 1,
      stdout: result.stdout ?? "", stderr: result.stderr ?? "",
      ...(result.isCanceled ? { canceled: true } : {}), ...(result.timedOut ? { timedOut: true } : {}) };
  }
};

export function discoveredTests(output: string): number | null {
  const stripped = output.replaceAll(/\u001b\[[0-9;]*m/g, "");
  const patterns = [
    /(?:^|\n)\s*(?:#|ℹ) tests\s+(\d+)\b/g,
    /Tests run:\s*(\d+)\s*,\s*Failures:/g,
    /\bTests\s+[^\n]*\((\d+)\)/g,
    /(?:^|\n)\s*Tests:\s*[^\n]*?(\d+) total\b/g,
    /collected\s+(\d+) items?\b/g,
    /(?:^|\n)\s*Ran\s+(\d+) tests?\b/g,
    /test result: (?:ok|FAILED)\.\s*(\d+) passed/g,
    /(?:^|\n)\s*Passed!?\s*[-:]\s*[^\n]*Total:\s*(\d+)/g,
  ];
  const counts = patterns.flatMap((pattern) => [...stripped.matchAll(pattern)].map((match) => Number(match[1])));
  if (/no tests? (?:found|collected|ran)|collected 0 items|No test files found/i.test(stripped)) return 0;
  const go = stripped.split("\n").flatMap((line) => {
    try { const entry = JSON.parse(line) as { Action?: string; Test?: string };
      return entry.Test && ["pass", "fail", "skip"].includes(entry.Action ?? "") ? [entry] : []; } catch { return []; }
  });
  if (go.length > 0) return go.length;
  if (stripped.includes('"Action":') && stripped.includes('"Package":')) return 0;
  return counts.length > 0 ? Math.max(...counts) : null;
}

export function testSummaryFailure(output: string): string | null {
  const count = discoveredTests(output);
  if (count === null) return "test-summary-unrecognized";
  if (count === 0) return "zero-tests";
  const stripped = output.replaceAll(/\u001b\[[0-9;]*m/g, "");
  const failed = [...stripped.matchAll(/(?:Failures:|Errors:|Failed:)\s*(\d+)|(?:^|\n)\s*(?:#|ℹ) (?:fail|cancelled)\s+(\d+)|(\d+)\s+(?:failed|errors?)\b/g)]
    .some((match) => Number(match[1] ?? match[2] ?? match[3]) > 0);
  if (failed || /"Action"\s*:\s*"fail"/.test(stripped)) return "failed-tests";
  const nodePass = [...stripped.matchAll(/(?:^|\n)\s*(?:#|ℹ) pass\s+(\d+)/g)];
  if (nodePass.length > 0 && nodePass.every((match) => Number(match[1]) === 0)) return "zero-executed-tests";
  const skips = [...stripped.matchAll(/(?:Skipped:|(?:#|ℹ) (?:skipped|todo))\s*(\d+)|(\d+)\s+(?:skipped|todo|pending|ignored)\b/g)].map((match) => Number(match[1] ?? match[2]));
  if (skips.length > 0 && Math.max(...skips) >= count && !/[1-9]\d*\s+passed\b/.test(stripped)) return "zero-executed-tests";
  for (const line of stripped.split("\n").filter((line) => /^\s*Tests\b/.test(line))) {
    const inactive = [...line.matchAll(/(\d+)\s+(?:skipped|todo|pending|ignored)\b/g)]
      .reduce((total, match) => total + Number(match[1]), 0);
    if (inactive >= count && !/[1-9]\d*\s+passed\b/.test(line)) return "zero-executed-tests";
  }
  if (/collected\s+\d+ items?/.test(stripped) && !/\d+\s+(?:passed|failed|errors?)\b/.test(stripped)) return "test-execution-unconfirmed";
  if (/"Action"\s*:/.test(stripped) && !/"Action"\s*:\s*"pass"[^\n]*"Test"|"Test"[^\n]*"Action"\s*:\s*"pass"/.test(stripped)) return "zero-executed-tests";
  return null;
}
