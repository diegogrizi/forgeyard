import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { scanGeneratedContent } from "../../src/doctor/content-audit.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-content-adversarial-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("content audit confinement", () => {
  test("reports but never follows a symbolic-link input", async () => {
    const root = await freshRoot();
    const outside = await freshRoot();
    await writeFile(path.join(outside, "outside.md"), "Example Sponsor\n", "utf8");
    await mkdir(path.join(root, "generated"));
    await symlink(outside, path.join(root, "generated", "external"), "junction");

    const findings = await scanGeneratedContent({
      root,
      paths: ["generated"],
      denyTerms: ["Example Sponsor"],
    });

    expect(findings).toEqual([{ ruleId: "content.unsafe-link", path: "generated/external" }]);
  });

  test("rejects a requested scan path outside the root", async () => {
    const root = await freshRoot();

    await expect(scanGeneratedContent({ root, paths: ["../outside"] })).rejects.toEqual(
      expect.objectContaining({ code: "FY_PATH_UNSAFE" }),
    );
  });
});
