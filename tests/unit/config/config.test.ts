import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  loadConfig,
  serializeConfig,
  validateConfig,
} from "../../../src/config/config.js";
import { ForgeyardError } from "../../../src/core/errors.js";
import type { ForgeyardConfig } from "../../../src/core/contracts.js";

function validConfig(): ForgeyardConfig {
  return {
    schemaVersion: 1,
    project: {
      name: "Signal Garden",
      purpose: "Demonstrate one trustworthy user journey.",
      mode: "new",
    },
    harnesses: ["codex"],
    profile: "hackathon",
    timeboxMinutes: 300,
    quality: { commands: [{ name: "test", argv: ["npm", "test"] }] },
    paths: {
      mutableRoots: ["src", "presentation"],
      protectedPaths: [".git", ".env"],
      presentation: "presentation",
    },
    orchestration: { mode: "guided", maxConcurrency: 4 },
    presentation: {
      enabled: true,
      audience: "Product reviewers",
      durationMinutes: 7,
      offline: true,
    },
  };
}

describe("Forgeyard configuration", () => {
  test("loads the checked-in portable answer fixture", async () => {
    const fixture = path.resolve("fixtures/answers/hackathon.yaml");

    await expect(loadConfig(fixture)).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        profile: "hackathon",
        harnesses: ["codex"],
        timeboxMinutes: 300,
      }),
    );
  });

  test("rejects unknown keys instead of silently ignoring intent", () => {
    expect(() => validateConfig({ ...validConfig(), mystery: true })).toThrowError(
      expect.objectContaining({ code: "FY_CONFIG_INVALID", exitCode: 2 }),
    );
  });

  test("applies M1 defaults without mutating caller-owned input", () => {
    const candidate = validConfig() as unknown as Record<string, unknown>;
    delete candidate.timeboxMinutes;
    candidate.orchestration = {};
    candidate.presentation = { audience: "Product reviewers" };

    const result = validateConfig(candidate);

    expect(result.timeboxMinutes).toBe(300);
    expect(result.orchestration).toEqual({ mode: "guided", maxConcurrency: 4 });
    expect(result.presentation).toEqual({
      enabled: true,
      audience: "Product reviewers",
      durationMinutes: 7,
      offline: true,
    });
    expect(candidate).not.toHaveProperty("timeboxMinutes");
    expect(candidate.orchestration).toEqual({});
  });

  test.each([
    ["short timebox", { timeboxMinutes: 29 }],
    ["excessive concurrency", { orchestration: { mode: "guided", maxConcurrency: 17 } }],
    ["empty command argv", { quality: { commands: [{ name: "test", argv: [] }] } }],
  ])("rejects %s", (_name, override) => {
    expect(() => validateConfig({ ...validConfig(), ...override })).toThrow(ForgeyardError);
  });

  test("rejects unsupported M1 profile and adapter with the selection error", () => {
    for (const candidate of [
      { ...validConfig(), profile: "full" },
      { ...validConfig(), harnesses: ["cursor"] },
    ]) {
      expect(() => validateConfig(candidate)).toThrowError(
        expect.objectContaining({ code: "FY_UNSUPPORTED_SELECTION", exitCode: 2 }),
      );
    }
  });

  test("normalizes portable paths and rejects protected overlap", () => {
    const normalized = validateConfig({
      ...validConfig(),
      paths: {
        mutableRoots: ["src\\features", "presentation"],
        protectedPaths: [".git", ".env"],
        presentation: "presentation\\deck",
      },
    });
    expect(normalized.paths).toEqual({
      mutableRoots: ["src/features", "presentation"],
      protectedPaths: [".git", ".env"],
      presentation: "presentation/deck",
    });

    expect(() =>
      validateConfig({
        ...validConfig(),
        paths: {
          mutableRoots: ["src"],
          protectedPaths: ["src/secrets"],
          presentation: "src/presentation",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "FY_CONFIG_INVALID" }));
  });

  test("serializes deterministically without a runtime target root", () => {
    const first = serializeConfig(validConfig());
    const second = serializeConfig(validateConfig(JSON.parse(JSON.stringify(validConfig()))));

    expect(first).toBe(second);
    expect(first).not.toContain("targetRoot");
    expect(first).not.toContain(process.cwd());
    expect(first).toMatch(/^schemaVersion: 1\nproject:/);
  });
});
