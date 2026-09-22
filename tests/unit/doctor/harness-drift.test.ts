import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { sha256Text } from "../../../src/core/hash.js";
import { harnessFileDigests, presentHarnessPaths } from "../../../src/doctor/run-doctor.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-drift-inputs-"));
  roots.push(root);
  return root;
}

/** Windows denies symbolic links without the right privilege; such a case proves nothing here. */
async function link(target: string, location: string, type: "file" | "junction"): Promise<boolean> {
  try {
    await symlink(target, location, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    return false;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("doctor drift inputs", () => {
  test("confirms the protected paths that exist and invents no presence for the others", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".env"), "", "utf8");

    await expect(
      presentHarnessPaths(root, [".git", ".env", "src", ".git/config", "../outside"]),
    ).resolves.toEqual([".git", ".env"]);
  });

  test("does not confirm a path that traverses a symbolic link", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(path.join(outside, "notes.md"), "outside\n", "utf8");
    if (!(await link(outside, path.join(root, "linked"), "junction"))) return;

    await expect(presentHarnessPaths(root, ["linked", "linked/notes.md"])).resolves.toEqual([]);
  });

  test("reads the current digest of each frozen harness file and calls the unreadable ones null", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".codex"));
    await writeFile(path.join(root, "AGENTS.md"), "harness\n", "utf8");

    await expect(
      harnessFileDigests(root, [
        { path: "AGENTS.md", sha256: sha256Text("approved\n") },
        { path: "gone.md", sha256: sha256Text("gone\n") },
        { path: ".codex", sha256: sha256Text("directory\n") },
      ]),
    ).resolves.toEqual({
      "AGENTS.md": sha256Text("harness\n"),
      "gone.md": null,
      ".codex": null,
    });
  });
});
