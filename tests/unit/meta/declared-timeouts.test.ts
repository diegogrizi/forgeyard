import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

/** Suites here install real harnesses, run real Git and execute the built CLI. */
const HEAVY_DIRECTORIES = ["tests/integration", "tests/roundtrip"] as const;

async function testFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await testFiles(next));
    else if (entry.name.endsWith(".test.ts")) found.push(next.replaceAll("\\", "/"));
  }
  return found.sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * The rule used to live in AGENTS.md as prose, and four suites forgot it: their real work sat
 * under a 30-second cap calibrated for unit tests, so they went red under any load and the
 * defect surfaced only when the machine was busy. A cap nobody declared is a cap nobody
 * measured, which is the thing this repository keeps relearning.
 */
describe("heavy suites declare their own timeout", () => {
  test("every integration and roundtrip file states the cap it runs under", async () => {
    const missing: string[] = [];
    for (const directory of HEAVY_DIRECTORIES) {
      for (const file of await testFiles(directory)) {
        const source = await readFile(file, "utf8");
        if (!/vi\.setConfig\(\{\s*testTimeout:\s*[\d_]+/.test(source)) missing.push(file);
      }
    }

    // Naming them is the point: a count says a rule was broken without saying where.
    expect(missing).toEqual([]);
  });

  test("a declared cap is stated with the measurement that justifies it", async () => {
    const unexplained: string[] = [];
    for (const directory of HEAVY_DIRECTORIES) {
      for (const file of await testFiles(directory)) {
        const source = await readFile(file, "utf8");
        const declaration = source.indexOf("vi.setConfig(");
        if (declaration < 0) continue;
        // The comment above the cap must carry a duration, so a reader can tell a
        // proportionate cap from a number somebody liked.
        const preamble = source.slice(Math.max(0, declaration - 600), declaration);
        if (!/\d+[.,]?\d*\s*(?:s|ms)\b/.test(preamble)) unexplained.push(file);
      }
    }

    expect(unexplained).toEqual([]);
  });
});
