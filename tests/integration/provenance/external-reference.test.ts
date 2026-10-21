import { describe, expect, test, vi } from "vitest";

import { renderThirdPartyNotices } from "../../../src/provenance/generate-notices.js";
import { renderSpdxSbom } from "../../../src/provenance/generate-sbom.js";
import { validateProvenance, type ProvenanceWorkspace } from "../../../src/provenance/validate.js";

// Fixture in memoria: la prova piu' lenta misurata su questa macchina richiede meno di 10 ms.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function workspace(): ProvenanceWorkspace {
  return {
    packageManifest: { name: "forgeyard", version: "0.1.0", license: "Apache-2.0" },
    packageLock: {
      name: "forgeyard", version: "0.1.0", lockfileVersion: 3,
      packages: { "": { name: "forgeyard", version: "0.1.0", license: "Apache-2.0" } },
    },
    catalog: {
      schemaVersion: 1,
      sources: [{
        id: "github.wshobson-agents", name: "Agentic Plugin Marketplace",
        url: "https://github.com/wshobson/agents", revision: "HEAD", license: "MIT",
        provenance: "reference-only", retrievedAt: "2026-10-21",
        notes: "External source fetched only when preparing selected components.",
      }],
    },
    packs: [{
      schemaVersion: 1, id: "ecosystem", version: "1.0.0", license: "MIT",
      provenance: { mode: "reference-only", sourceId: "github.wshobson-agents" },
      components: [{
        id: "ecosystem.portable-catalog", kind: "catalog", entry: "source.json", entryType: "external",
        format: "portable-plugin-marketplace-v1", slot: "catalog.portable.primary", template: false,
        ownership: "managed", requires: [], conflicts: [],
      }],
    }],
    installedPackages: [], installedByPath: new Map(),
    externalSources: [{
      packId: "ecosystem", sourceId: "github.wshobson-agents",
      referenceRelativePath: "packs/ecosystem/source.json",
      reference: {
        schemaVersion: 1, repository: "https://github.com/wshobson/agents", revision: "HEAD",
        license: "MIT", plugins: ["unit-testing"],
      },
    }],
  };
}

describe("reference-only catalog provenance", () => {
  test("describes the source in an SPDX annotation without declaring distributed catalog bytes", () => {
    const input = workspace();
    const spdx = JSON.parse(renderSpdxSbom(input));

    expect(spdx.packages).toHaveLength(1);
    expect(spdx.relationships.some((entry: { relationshipType: string }) => entry.relationshipType === "CONTAINS")).toBe(false);
    expect(spdx.annotations ?? []).toContainEqual(expect.objectContaining({
      annotationType: "OTHER",
      comment: expect.stringContaining("https://github.com/wshobson/agents"),
    }));
    const notices = renderThirdPartyNotices(input);
    expect(notices).toContain("Agentic Plugin Marketplace HEAD (external catalog reference)");
    expect(notices).toContain("- License: MIT");
    expect(notices).toContain("Catalog payload is not distributed with Forgeyard.");
    expect(notices).not.toContain("Preserved license notice:");
    expect(notices).not.toContain("Verified content:");
  });

  test("binds the source catalog record to its external repository, revision and license", () => {
    for (const change of [
      { repository: "https://github.com/example/other" },
      { revision: "a".repeat(40) },
      { license: "Apache-2.0" },
    ]) {
      const input = workspace();
      Object.assign(input.externalSources![0]!.reference, change);
      expect(() => validateProvenance(input)).toThrowError(expect.objectContaining({
        name: "ProvenanceValidationError",
      }));
    }
  });

  test("rejects an external catalog whose source reference metadata is missing", () => {
    const input = workspace();
    input.externalSources = [];
    expect(() => validateProvenance(input)).toThrowError(expect.objectContaining({
      name: "ProvenanceValidationError",
      issues: expect.arrayContaining([expect.stringContaining("missing an external reference")]),
    }));
  });

  test("changes the SPDX namespace when the curated external selection changes", () => {
    const first = workspace();
    const second = workspace();
    second.externalSources![0]!.reference.plugins = ["documentation-generation", "unit-testing"];

    expect(JSON.parse(renderSpdxSbom(first)).documentNamespace)
      .not.toBe(JSON.parse(renderSpdxSbom(second)).documentNamespace);
  });
});
