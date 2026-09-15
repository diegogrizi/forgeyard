import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";

import { loadRegistry } from "../../../src/registry/load.js";
import { sha256Text } from "../../../src/core/hash.js";

const temporaryRoots: string[] = [];

async function registryFixture(options: { unknownPackKey?: boolean; provenanceMode?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-registry-"));
  temporaryRoots.push(root);
  await cp(path.resolve("schemas"), path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "profiles"), { recursive: true });
  await mkdir(path.join(root, "packs", "foundation"), { recursive: true });
  await mkdir(path.join(root, "sources"), { recursive: true });
  await writeFile(path.join(root, "packs", "foundation", "entry.md"), "original entry\n", "utf8");

  await writeFile(
    path.join(root, "profiles", "hackathon.yaml"),
    stringify({
      schemaVersion: 1,
      id: "hackathon",
      version: "1.0.0",
      packs: ["foundation"],
      defaults: {
        timeboxMinutes: 300,
        orchestration: { mode: "guided", maxConcurrency: 4 },
        presentation: {
          enabled: true,
          audience: "Reviewers",
          durationMinutes: 7,
          offline: true,
        },
      },
    }),
    "utf8",
  );

  const pack = {
    schemaVersion: 1,
    id: "foundation",
    version: "1.0.0",
    license: "Apache-2.0",
    provenance: {
      mode: options.provenanceMode ?? "original",
    },
    components: [
      {
        id: "foundation.entry",
        kind: "skill",
        entry: "entry.md",
        slot: "workflow.primary",
        template: false,
        ownership: "managed",
        requires: [],
        conflicts: [],
      },
    ],
    ...(options.unknownPackKey ? { unexpected: true } : {}),
  };
  await writeFile(path.join(root, "packs", "foundation", "pack.yaml"), stringify(pack), "utf8");
  await writeFile(
    path.join(root, "sources", "catalog.yaml"),
    stringify({ schemaVersion: 1, sources: [] }),
    "utf8",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("registry loader", () => {
  test("loads, validates, and hashes a canonical registry", async () => {
    const root = await registryFixture();

    const registry = await loadRegistry(root);
    const loadedPack = registry.packs.get("foundation");

    expect([...registry.profiles.keys()]).toEqual(["hackathon"]);
    expect(loadedPack?.entries.get("foundation.entry")).toEqual({
      sourcePath: path.join(root, "packs", "foundation", "entry.md"),
      sha256: sha256Text("original entry\n"),
    });
  });

  test("rejects unknown manifest fields", async () => {
    const root = await registryFixture({ unknownPackKey: true });

    await expect(loadRegistry(root)).rejects.toEqual(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID", exitCode: 3 }),
    );
  });

  test("requires a source ID for non-original content", async () => {
    const root = await registryFixture({ provenanceMode: "adapted" });

    await expect(loadRegistry(root)).rejects.toEqual(
      expect.objectContaining({ code: "FY_REGISTRY_INVALID" }),
    );
  });

  test("loads hidden files from a tree component in deterministic portable-path order", async () => {
    const root = await registryFixture();
    const packRoot = path.join(root, "packs", "foundation");
    await mkdir(path.join(packRoot, "vendor", ".claude-plugin"), { recursive: true });
    await mkdir(path.join(packRoot, "vendor", "agents"), { recursive: true });
    await mkdir(path.join(packRoot, "vendor", "skills", "review"), { recursive: true });
    const contentByPath = new Map([
      [".claude-plugin/plugin.json", '{"name":"fixture"}\n'],
      ["agents/reviewer.md", "# Reviewer\n"],
      ["skills/review/SKILL.md", "# Review\n"],
    ]);
    await Promise.all(
      [...contentByPath].map(([relativePath, content]) =>
        writeFile(path.join(packRoot, "vendor", ...relativePath.split("/")), content, "utf8"),
      ),
    );
    await writeFile(
      path.join(packRoot, "pack.yaml"),
      stringify({
        schemaVersion: 1,
        id: "foundation",
        version: "1.0.0",
        license: "Apache-2.0",
        provenance: { mode: "original" },
        components: [
          {
            id: "foundation.catalog",
            kind: "catalog",
            entry: "vendor",
            entryType: "tree",
            format: "portable-plugin-marketplace-v1",
            slot: "catalog.portable.primary",
            template: false,
            ownership: "managed",
            requires: [],
            conflicts: [],
          },
        ],
      }),
      "utf8",
    );

    const loaded = (await loadRegistry(root)).packs.get("foundation")?.entries.get("foundation.catalog");
    const expectedFiles = [...contentByPath]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([relativePath, content]) => ({
        relativePath,
        sourcePath: path.join(packRoot, "vendor", ...relativePath.split("/")),
        sha256: sha256Text(content),
      }));

    expect(loaded).toEqual({
      entryType: "tree",
      sourcePath: path.join(packRoot, "vendor"),
      sha256: sha256Text(expectedFiles.map((file) => `${file.relativePath}\0${file.sha256}\n`).join("")),
      files: expectedFiles,
    });
  });
});
