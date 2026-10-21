import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";
import { parse, stringify } from "yaml";

import { summarizeVendorTree, verifyVendorTree } from "../../../src/provenance/vendor-catalog.js";
import { runProcess } from "../../helpers/cli.js";

// La prova piu' lenta misurata e' il processo del checker: meno di 2 s su questa macchina.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const repositoryRoot = path.resolve(".");
const temporaryRoots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function referenceFixture(): Promise<string> {
  const root = await temporaryRoot("forgeyard-catalog-reference-");
  for (const directory of ["schemas", "profiles", "sources", "packs/foundation", "packs/delivery"]) {
    await cp(path.join(repositoryRoot, directory), path.join(root, directory), { recursive: true });
  }
  await mkdir(path.join(root, "packs", "ecosystem"), { recursive: true });
  for (const filename of ["pack.yaml", "source.json"]) {
    await cp(path.join(repositoryRoot, "packs", "ecosystem", filename), path.join(root, "packs", "ecosystem", filename));
  }
  const sourcePath = path.join(root, "sources", "catalog.yaml");
  const catalog = parse(await readFile(sourcePath, "utf8"));
  Object.assign(catalog.sources[0], { provenance: "reference-only", revision: "HEAD" });
  await writeFile(sourcePath, stringify(catalog), "utf8");
  return root;
}

async function check(root: string) {
  const networkGuard = path.join(root, "deny-network.mjs");
  await writeFile(networkGuard, "globalThis.fetch = async () => { throw new Error('Catalog verification attempted network access.'); };\n", "utf8");
  return runProcess(process.execPath, [
    "--import", pathToFileURL(networkGuard).href, "--import", "tsx",
    path.join(repositoryRoot, "scripts", "vendor-catalog.ts"), "--check", "--root", root,
  ], repositoryRoot);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("offline external catalog verification", () => {
  test("validates a source reference and every authored selection without downloading payload", async () => {
    const result = await check(await referenceFixture());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("External catalog reference verified");
    expect(result.stdout).toContain("21 curated plugins");
    expect(result.stdout).not.toContain("physical lines");
  });

  test.each(["rule", "profile", "capability"])("rejects a missing %s selection", async (kind) => {
    const root = await referenceFixture();
    if (kind === "rule") {
      const rulesPath = path.join(root, "sources", "capabilities.yaml");
      const rules = parse(await readFile(rulesPath, "utf8"));
      rules.rules[0].include.push({ id: "missing-rule-plugin", reason: "Must remain a declared source selection." });
      await writeFile(rulesPath, stringify(rules), "utf8");
    } else if (kind === "profile") {
      const profilePath = path.join(root, "profiles", "hackathon.yaml");
      const profile = parse(await readFile(profilePath, "utf8"));
      profile.catalog.plugins.push("missing-profile-plugin");
      await writeFile(profilePath, stringify(profile), "utf8");
    } else {
      const sourcePath = path.join(root, "packs", "ecosystem", "source.json");
      const source = JSON.parse(await readFile(sourcePath, "utf8"));
      source.plugins = source.plugins.filter((id: string) => id !== "unit-testing");
      await writeFile(sourcePath, JSON.stringify(source), "utf8");
    }

    const result = await check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("catalog.reference-invalid");
  });

  test("rejects source metadata that disagrees with the reference", async () => {
    const root = await referenceFixture();
    const sourcePath = path.join(root, "sources", "catalog.yaml");
    const catalog = parse(await readFile(sourcePath, "utf8"));
    catalog.sources[0].revision = "a".repeat(40);
    await writeFile(sourcePath, stringify(catalog), "utf8");

    const result = await check(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("catalog.reference-invalid");
  });
});

describe("generic byte attestation fixtures", () => {
  test("rejects changed content and a missing license without a bundled catalog snapshot", async () => {
    const root = await temporaryRoot("forgeyard-small-attestation-");
    await mkdir(path.join(root, "plugins", "example"), { recursive: true });
    const contentPath = path.join(root, "plugins", "example", "SKILL.md");
    await writeFile(contentPath, "# Example\nOriginal external bytes.\n", "utf8");
    await writeFile(path.join(root, "LICENSE"), "MIT fixture notice\n", "utf8");
    const summary = await summarizeVendorTree(root);
    const attestation = {
      schemaVersion: 1 as const, source: "https://github.com/example/catalog", revision: "a".repeat(40),
      license: "MIT", contentRoot: "plugins", ...summary,
    };
    await expect(verifyVendorTree(root, attestation)).resolves.toMatchObject({ fileCount: 1, physicalLines: 2 });
    await writeFile(contentPath, "# Example\nChanged external bytes.\n", "utf8");
    await expect(verifyVendorTree(root, attestation)).rejects.toEqual(expect.objectContaining({ name: "ProvenanceValidationError" }));
    await unlink(path.join(root, "LICENSE"));
    await expect(verifyVendorTree(root, attestation)).rejects.toBeDefined();
  });
});
