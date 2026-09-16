import { expect, test } from "vitest";
import { discoveredTests, gateEnvironment, nativeGateRunner, testSummaryFailure } from "../../../src/native/gates.js";

test("PID observation failure terminates/awaits only the spawned gate and remains an error", async () => {
  let pid = 0; const failure = new Error("fixture persistence failure");
  await expect(nativeGateRunner({ cwd: process.cwd(), signal: new AbortController().signal,
    gate: { id: "G001", name: "fixture", argv: [process.execPath, "-e", "setTimeout(()=>{},500)"], parser: "exit-code",
      timeoutMs: 1000, maxOutputBytes: 4096 }, onSpawn: (observed) => { pid = observed; throw failure; } })).rejects.toBe(failure);
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
});
test.each([
  ["# tests 2\n# pass 2\n# fail 0", 2, null],
  ["ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0", 1, null],
  ["Tests run: 3, Failures: 0, Errors: 0, Skipped: 0", 3, null],
  ["Tests run: 3, Failures: 1, Errors: 0, Skipped: 0", 3, "failed-tests"],
  ["# tests 1\n# pass 0\n# fail 0\n# skipped 1", 1, "zero-executed-tests"],
  ["Tests 1 skipped (1)", 1, "zero-executed-tests"],
  ["Tests 1 todo (1)", 1, "zero-executed-tests"],
  ["Tests: 1 todo, 1 total", 1, "zero-executed-tests"],
  ["Tests 1 skipped | 1 todo (2)", 2, "zero-executed-tests"],
  ["Tests: 1 skipped, 1 todo, 2 total", 2, "zero-executed-tests"],
  ["No test files found", 0, "zero-tests"],
  ["All good, trust me", null, "test-summary-unrecognized"],
] as const)("parses summary without confusing discovery with execution: %s", (output, count, failure) => {
  expect(discoveredTests(output)).toBe(count);
  expect(testSummaryFailure(output)).toBe(failure);
});
test("gate environment excludes credentials and arbitrary provider settings", () => {
  const env = gateEnvironment({ PATH: "bin", SECRET: "private", ANTHROPIC_API_KEY: "private", OPENAI_API_KEY: "private", NODE_OPTIONS: "unsafe" });
  expect(env).toEqual({ CI: "1", NO_COLOR: "1", npm_config_offline: "true", PATH: "bin" });
});
