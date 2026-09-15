import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertNoCaseCollisions,
  normalizePortablePath,
  resolveInsideRoot,
} from "../../../src/core/paths.js";
import { ForgeyardError } from "../../../src/core/errors.js";

describe("portable project paths", () => {
  test("normalizes Windows separators without changing path meaning", () => {
    expect(normalizePortablePath("src\\feature\\index.ts")).toBe("src/feature/index.ts");
  });

  test.each([
    "../outside",
    "src/../../outside",
    "/absolute/path",
    "C:\\absolute\\path",
    "\\\\server\\share",
    "bad\0path",
  ])("rejects unsafe path %s", (candidate) => {
    expect(() => normalizePortablePath(candidate)).toThrow(ForgeyardError);
  });

  test("resolves a portable path below the selected root", () => {
    const root = path.resolve("temporary-project");

    expect(resolveInsideRoot(root, "src/index.ts")).toBe(path.join(root, "src", "index.ts"));
  });

  test("rejects case-only destination collisions", () => {
    expect(() => assertNoCaseCollisions(["AGENTS.md", "agents.md"])).toThrowError(
      expect.objectContaining({ code: "FY_PATH_UNSAFE" }),
    );
  });
});
