import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";

import { loadRegistry } from "../../src/registry/load.js";

const temporaryRoots: string[] = [];

async function maliciousRegistry(
  entry: string,
  options: { entryType?: "file" | "tree"; kind?: "skill" | "catalog" } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-registry-adversarial-"));
  temporaryRoots.push(root);
  await cp(path.resolve("schemas"), path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "profiles"), { recursive: true });
  await mkdir(path.join(root, "packs", "unsafe"), { recursive: true });
  await mkdir(path.join(root, "sources"), { recursive: true });
  await writeFile(
    path.join(root, "profiles", "hackathon.yaml"),
    stringify({
      schemaVersion: 1,
      id: "hackathon",
      version: "1.0.0",
      packs: ["unsafe"],
      defaults: {
        timeboxMinutes: 300,
        orchestration: { mode: "guided", maxConcurrency: 4 },
        presentation: { enabled: true, audience: "Reviewers", durationMinutes: 7, offline: true },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(root, "packs", "unsafe", "pack.yaml"),
    stringify({
      schemaVersion: 1,
      id: "unsafe",
      version: "1.0.0",
      license: "Apache-2.0",
      provenance: { mode: "original" },
      components: [
        {
          id: "unsafe.entry",
          kind: options.kind ?? "skill",
          entry,
          ...(options.entryType === undefined ? {} : { entryType: options.entryType }),
          ...(options.kind === "catalog" ? { format: "portable-plugin-marketplace-v1" } : {}),
          slot: "workflow.primary",
          template: false,
          ownership: "managed",
          requires: [],
          conflicts: [],
        },
      ],
    }),
    "utf8",
  );
  await writeFile(path.join(root, "sources", "catalog.yaml"), "schemaVersion: 1\nsources: []\n", "utf8");
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("registry entry confinement", () => {
  test.each(["../outside.md", "C:\\outside.md", "/outside.md", "%2e%2e/outside.md", "safe%2fentry.md"])(
    "rejects unsafe entry path %s",
    async (entry) => {
      const root = await maliciousRegistry(entry);
      await expect(loadRegistry(root)).rejects.toEqual(
        expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
      );
    },
  );

  test("rejects a symbolic-link entry even when its text path is inside the pack", async () => {
    const root = await maliciousRegistry("linked.md");
    const outside = path.join(root, "outside.md");
    await writeFile(outside, "outside\n", "utf8");

    try {
      await symlink(outside, path.join(root, "packs", "unsafe", "linked.md"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(loadRegistry(root)).rejects.toEqual(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
    );
  });

  test("rejects a symbolic link nested anywhere inside a tree component", async () => {
    const root = await maliciousRegistry("vendor", { entryType: "tree", kind: "catalog" });
    const vendor = path.join(root, "packs", "unsafe", "vendor");
    const outside = path.join(root, "outside.md");
    await mkdir(path.join(vendor, "skills", "review"), { recursive: true });
    await writeFile(outside, "outside\n", "utf8");

    try {
      await symlink(outside, path.join(vendor, "skills", "review", "SKILL.md"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(loadRegistry(root)).rejects.toEqual(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
    );
  });
});
