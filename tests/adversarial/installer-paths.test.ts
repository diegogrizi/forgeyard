import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { InstallPlan, PlannedFile } from "../../src/core/contracts.js";
import { sha256Text } from "../../src/core/hash.js";
import { applyInstallPlan } from "../../src/installer/apply.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-install-adversarial-"));
  temporaryRoots.push(root);
  return root;
}

function plannedFile(relativePath: string): PlannedFile {
  const content = "managed\n";
  return {
    path: relativePath,
    content,
    sha256: sha256Text(content),
    componentId: "test.component",
    ownership: "managed",
  };
}

function plan(root: string, files: readonly PlannedFile[]): InstallPlan {
  return {
    schemaVersion: 1,
    operationId: "20260915T120000000Z-a1b2c3",
    targetRoot: root,
    profile: "hackathon",
    adapter: "codex",
    files,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installer path defenses", () => {
  test.each(["../outside.md", "C:\\outside.md", "/outside.md"])("rejects destination %s", async (candidate) => {
    const root = await freshRoot();

    await expect(applyInstallPlan(plan(root, [plannedFile(candidate)]), { dryRun: true })).rejects.toEqual(
      expect.objectContaining({ code: "FY_PATH_UNSAFE", exitCode: 4 }),
    );
  });

  test("rejects destinations that collide under Windows case folding", async () => {
    const root = await freshRoot();

    await expect(
      applyInstallPlan(plan(root, [plannedFile("AGENTS.md"), plannedFile("agents.md")]), { dryRun: true }),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_PATH_UNSAFE" }));
  });

  test("rejects a junction ancestor that redirects outside the project", async () => {
    const root = await freshRoot();
    const outside = await freshRoot();
    await writeFile(path.join(outside, "sentinel.txt"), "outside\n", "utf8");
    await mkdir(path.join(root, ".forgeyard"), { recursive: true });
    await symlink(outside, path.join(root, ".agents"), "junction");

    await expect(
      applyInstallPlan(plan(root, [plannedFile(".agents/skills/example/SKILL.md")]), { dryRun: true }),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_PATH_UNSAFE" }));
    expect(await import("node:fs/promises").then((fs) => fs.readFile(path.join(outside, "sentinel.txt"), "utf8"))).toBe(
      "outside\n",
    );
  });
});
