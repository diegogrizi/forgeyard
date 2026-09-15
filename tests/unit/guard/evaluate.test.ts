import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { evaluateWritePath } from "../../../src/guard/evaluate.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("write-scope decision engine", () => {
  test.each([
    ["src/feature/index.ts", true, "src/feature/index.ts", "allowed"],
    ["src/other/index.ts", false, "src/other/index.ts", "outside-write-scope"],
    [".env", false, ".env", "protected-path"],
    ["../outside.txt", false, undefined, "outside-project"],
  ])("evaluates %s deterministically", async (candidate, allowed, relativePath, reason) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-guard-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "feature"), { recursive: true });

    await expect(evaluateWritePath({
      root,
      cwd: root,
      candidate,
      writeScopes: ["src/feature"],
      protectedPaths: [".git", ".env"],
    })).resolves.toEqual({ allowed, ...(relativePath === undefined ? {} : { relativePath }), reason });
  });

  test("accepts an absolute path only when it resolves through a real project ancestor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-guard-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "feature"), { recursive: true });

    expect(await evaluateWritePath({
      root,
      cwd: root,
      candidate: path.join(root, "src", "feature", "new.ts"),
      writeScopes: ["src/feature"],
      protectedPaths: [".git"],
    })).toEqual({ allowed: true, relativePath: "src/feature/new.ts", reason: "allowed" });
  });

  test("denies a lexically in-scope path whose existing ancestor links outside the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-guard-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "forgeyard-guard-outside-"));
    roots.push(root, outside);
    await mkdir(path.join(root, "src", "feature"), { recursive: true });
    await symlink(outside, path.join(root, "src", "feature", "linked"), "junction");

    expect(await evaluateWritePath({
      root,
      cwd: root,
      candidate: "src/feature/linked/new.ts",
      writeScopes: ["src/feature"],
      protectedPaths: [".git"],
    })).toEqual({
      allowed: false,
      relativePath: "src/feature/linked/new.ts",
      reason: "symlink-escape",
    });
  });
});
