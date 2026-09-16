import { describe, expect, test } from "vitest";
import { renderSpdxSbom } from "../../../src/provenance/generate-sbom.js";
import type { InstalledPackageMetadata, ProvenanceWorkspace } from "../../../src/provenance/validate.js";

function workspace(platform: "linux" | "windows" | "none"): ProvenanceWorkspace {
  const name = platform === "linux" ? "optional-linux" : "optional-windows";
  const installedByPath = new Map<string, InstalledPackageMetadata>();
  if (platform !== "none") installedByPath.set(`node_modules/${name}`, {
    name, version: "2.0.0", license: "MIT", homepage: "https://example.invalid/native",
  });
  return {
    packageManifest: { name: "forgeyard", version: "0.1.0", license: "Apache-2.0" },
    packageLock: {
      name: "forgeyard", version: "0.1.0", lockfileVersion: 3,
      packages: {
        "": { name: "forgeyard", version: "0.1.0", license: "Apache-2.0",
          optionalDependencies: { "optional-linux": "2.0.0", "optional-windows": "2.0.0" } },
        "node_modules/optional-linux": { name: "optional-linux", version: "2.0.0", optional: true, license: "MIT",
          resolved: "https://example.invalid/optional-linux.tgz", integrity: "sha256-YWJj" },
        "node_modules/optional-windows": { name: "optional-windows", version: "2.0.0", optional: true, license: "MIT",
          resolved: "https://example.invalid/optional-windows.tgz", integrity: "sha256-ZGVm" },
      },
    },
    catalog: { schemaVersion: 1, sources: [] }, packs: [], installedPackages: [], installedByPath,
  };
}

describe("SBOM riproducibile dal lock, non dalla macchina", () => {
  test("restituisce gli stessi byte con installazioni opzionali Linux, Windows o assenti", () => {
    const linux = renderSpdxSbom(workspace("linux"));
    expect(linux).toBe(renderSpdxSbom(workspace("windows")));
    expect(linux).toBe(renderSpdxSbom(workspace("none")));
  });

  test("una licenza assente dal lock resta non attestata anche se presente localmente", () => {
    const withLocal = workspace("linux");
    const withoutLocal = workspace("none");
    delete withLocal.packageLock.packages["node_modules/optional-linux"]!.license;
    delete withoutLocal.packageLock.packages["node_modules/optional-linux"]!.license;
    expect(renderSpdxSbom(withLocal)).toBe(renderSpdxSbom(withoutLocal));
    const result = JSON.parse(renderSpdxSbom(withLocal));
    expect(result.packages).toContainEqual(expect.objectContaining({ name: "optional-linux", licenseDeclared: "NOASSERTION" }));
  });

  test("conserva l'intero grafo, le versioni e le impronte anche dei pacchetti non installati", () => {
    const result = JSON.parse(renderSpdxSbom(workspace("none")));
    expect(result.packages).toHaveLength(3);
    expect(result.relationships.filter((entry: {relationshipType: string}) => entry.relationshipType === "DEPENDS_ON")).toHaveLength(2);
    expect(result.packages).toContainEqual(expect.objectContaining({ name: "optional-linux", versionInfo: "2.0.0",
      licenseDeclared: "MIT", downloadLocation: "https://example.invalid/optional-linux.tgz",
      checksums: [{ algorithm: "SHA256", checksumValue: "616263" }] }));
  });

  test("i metadati locali non alterano identita e licenza fissate nel lock", () => {
    const input = workspace("none");
    const expected = renderSpdxSbom(input);
    (input.installedByPath as Map<string, InstalledPackageMetadata>).set("node_modules/optional-linux", {
      name: "nome-diverso", version: "99.0.0", license: "GPL-3.0-only", homepage: "https://example.invalid/changed",
    });
    expect(renderSpdxSbom(input)).toBe(expected);
  });
});
