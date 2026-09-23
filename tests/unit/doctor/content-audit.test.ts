import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { scanGeneratedContent } from "../../../src/doctor/content-audit.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-content-audit-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generated content audit", () => {
  test("finds normalized deny terms without returning their text", async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "first.md"), "An ExAmPlE\n   Sponsor identity.\n", "utf8");
    await writeFile(path.join(root, "nested", "second.md"), "Cafe\u0301 identity.\n", "utf8");

    const findings = await scanGeneratedContent({
      root,
      paths: ["nested"],
      denyTerms: ["example sponsor", "Café"],
    });

    expect(findings).toEqual([
      { ruleId: "content.deny-term", path: "nested/first.md" },
      { ruleId: "content.deny-term", path: "nested/second.md" },
    ]);
    expect(JSON.stringify(findings).toLocaleLowerCase("en-US")).not.toContain("example sponsor");
  });

  test("reports unresolved templates and remote assets in generated web files in stable order", async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, "generated"));
    await writeFile(path.join(root, "z.md"), "Pending {{project.name}}\n", "utf8");
    await writeFile(
      path.join(root, "generated", "index.html"),
      '<link href="https://cdn.example.invalid/style.css">\n',
      "utf8",
    );

    await expect(scanGeneratedContent({ root, paths: ["z.md", "generated"] })).resolves.toEqual([
      { ruleId: "content.remote-asset", path: "generated/index.html" },
      { ruleId: "content.unresolved-template", path: "z.md" },
    ]);
  });

  test("excludes binary files and operational dependency directories", async () => {
    const root = await freshRoot();
    const excluded = [
      [".git", "tracked.md"],
      ["node_modules", "package", "README.md"],
      [".forgeyard", "state", "backups", "op", "AGENTS.md"],
    ];
    for (const segments of excluded) {
      const filePath = path.join(root, ...segments);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "Example Sponsor\n", "utf8");
    }
    await writeFile(path.join(root, "image.png"), Buffer.from("Example Sponsor", "utf8"));

    await expect(
      scanGeneratedContent({ root, paths: ["."], denyTerms: ["Example Sponsor"] }),
    ).resolves.toEqual([]);
  });
});
