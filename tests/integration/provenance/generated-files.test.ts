import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { renderThirdPartyNotices } from "../../../src/provenance/generate-notices.js";
import { renderSpdxSbom } from "../../../src/provenance/generate-sbom.js";
import { loadProvenanceWorkspace, validateProvenance } from "../../../src/provenance/validate.js";
import { sha256Text } from "../../../src/core/hash.js";

const repositoryRoot = path.resolve(".");

describe("generated public provenance artifacts", () => {
  test("ships the unmodified Apache-2.0 text and a project-only notice", async () => {
    const license = await readFile(path.join(repositoryRoot, "LICENSE"), "utf8");
    const notice = await readFile(path.join(repositoryRoot, "NOTICE"), "utf8");

    expect(sha256Text(license)).toBe("c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4");
    expect(notice).toBe("Forgeyard\nCopyright 2026 Forgeyard\n");
  });

  test("the checked-in catalog covers every direct package exactly once", async () => {
    const workspace = await loadProvenanceWorkspace(repositoryRoot);
    const validated = validateProvenance(workspace);
    const directCount = Object.keys(workspace.packageManifest.dependencies ?? {}).length
      + Object.keys(workspace.packageManifest.devDependencies ?? {}).length;

    expect(validated.directDependencies).toHaveLength(directCount);
    expect(validated.referencedSourceIds).toHaveLength(workspace.catalog.sources.length);
  });

  test("third-party notices are byte-stable and alphabetically ordered", async () => {
    const workspace = await loadProvenanceWorkspace(repositoryRoot);
    const rendered = renderThirdPartyNotices(workspace);
    const checkedIn = await readFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    const headings = [...rendered.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);

    expect(rendered).toBe(checkedIn);
    expect(headings).toEqual([...headings].sort((left, right) => left.localeCompare(right, "en")));
  });

  test("SPDX contains the root and complete lock graph with stable relationships", async () => {
    const workspace = await loadProvenanceWorkspace(repositoryRoot);
    const rendered = renderSpdxSbom(workspace);
    const checkedIn = await readFile(path.join(repositoryRoot, "SBOM.spdx.json"), "utf8");
    const spdx = JSON.parse(rendered) as {
      spdxVersion: string;
      dataLicense: string;
      packages: Array<Record<string, unknown>>;
      relationships: Array<Record<string, unknown>>;
    };
    const lockEntries = Object.entries(workspace.packageLock.packages);

    expect(rendered).toBe(checkedIn);
    expect(spdx.spdxVersion).toBe("SPDX-2.3");
    expect(spdx.dataLicense).toBe("CC0-1.0");
    expect(spdx.packages).toHaveLength(lockEntries.length);
    for (const [lockPath, locked] of lockEntries) {
      const expectedName = lockPath === "" ? workspace.packageManifest.name : locked.name;
      const found = spdx.packages.find((entry) => entry.name === expectedName && entry.versionInfo === locked.version);
      expect(found, `${lockPath} ${expectedName}@${locked.version}`).toBeDefined();
      if (locked.resolved !== undefined) expect(found?.downloadLocation).toBe(locked.resolved);
      if (locked.integrity !== undefined) expect(found?.checksums).toBeDefined();
    }
    expect(spdx.relationships).toContainEqual(
      expect.objectContaining({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES" }),
    );
    expect(spdx.relationships).toEqual([...spdx.relationships].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), "en")));
  });

  test("a transitive installed package can enrich metadata but never override its lock version", async () => {
    const workspace = await loadProvenanceWorkspace(repositoryRoot);
    const transitivePath = Object.keys(workspace.packageLock.packages).find((entry) => entry !== "")!;
    const locked = workspace.packageLock.packages[transitivePath]!;
    const installedByPath = new Map(workspace.installedByPath);
    installedByPath.set(transitivePath, {
      name: locked.name ?? "injected-name",
      version: "999.999.999",
      ...(locked.license === undefined ? {} : { license: locked.license }),
      repository: "https://example.invalid/injected",
    });

    const spdx = JSON.parse(renderSpdxSbom({ ...workspace, installedByPath })) as {
      packages: Array<{ name: string; versionInfo: string }>;
    };
    const packageName = locked.name ?? installedByPath.get(transitivePath)!.name;

    expect(spdx.packages).toContainEqual(expect.objectContaining({ name: packageName, versionInfo: locked.version }));
    expect(spdx.packages).not.toContainEqual(expect.objectContaining({ name: packageName, versionInfo: "999.999.999" }));
  });
});
