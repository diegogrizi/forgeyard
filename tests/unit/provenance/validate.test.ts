import { describe, expect, test } from "vitest";

import {
  ProvenanceValidationError,
  validateProvenance,
  type ProvenanceValidationInput,
} from "../../../src/provenance/validate.js";

function validInput(): ProvenanceValidationInput {
  return {
    packageManifest: {
      name: "forgeyard",
      version: "0.1.0",
      license: "Apache-2.0",
      dependencies: { alpha: "1.2.3" },
      devDependencies: { beta: "2.3.4" },
    },
    packageLock: {
      name: "forgeyard",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "forgeyard", version: "0.1.0", license: "Apache-2.0" },
        "node_modules/alpha": { name: "alpha", version: "1.2.3", license: "MIT" },
        "node_modules/beta": { name: "beta", version: "2.3.4", license: "ISC" },
      },
    },
    catalog: {
      schemaVersion: 1,
      sources: [
        {
          id: "npm.alpha",
          name: "alpha",
          url: "https://github.com/example/alpha",
          revision: "1.2.3",
          license: "MIT",
          provenance: "dependency",
          retrievedAt: "2026-09-15",
          notes: "Runtime test dependency.",
        },
        {
          id: "npm.beta",
          name: "beta",
          url: "https://github.com/example/beta",
          revision: "2.3.4",
          license: "ISC",
          provenance: "dependency",
          retrievedAt: "2026-09-15",
          notes: "Development test dependency.",
        },
      ],
    },
    packs: [
      {
        schemaVersion: 1,
        id: "original-pack",
        version: "1.0.0",
        license: "Apache-2.0",
        provenance: { mode: "original" },
        components: [],
      },
    ],
    installedPackages: [
      {
        name: "alpha",
        version: "1.2.3",
        license: "MIT",
        repository: "git+https://github.com/example/alpha.git",
      },
      {
        name: "beta",
        version: "2.3.4",
        license: "ISC",
        repository: "example/beta",
      },
    ],
  };
}

function clone(): ProvenanceValidationInput {
  return structuredClone(validInput());
}

function expectInvalid(input: ProvenanceValidationInput, issue: string): void {
  expect(() => validateProvenance(input)).toThrowError(
    expect.objectContaining<Partial<ProvenanceValidationError>>({
      name: "ProvenanceValidationError",
      issues: expect.arrayContaining([expect.stringContaining(issue)]),
    }),
  );
}

describe("release provenance validation", () => {
  test("accepts one exact catalog record for every pinned direct dependency", () => {
    const result = validateProvenance(validInput());

    expect(result.directDependencies.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
    expect(result.referencedSourceIds).toEqual(["npm.alpha", "npm.beta"]);
  });

  test("rejects missing, duplicate, and unreferenced catalog identities", () => {
    const missing = clone();
    missing.catalog.sources.pop();
    expectInvalid(missing, "beta");

    const duplicate = clone();
    duplicate.catalog.sources.push({ ...duplicate.catalog.sources[0]! });
    expectInvalid(duplicate, "duplicate source ID");

    const unreferenced = clone();
    unreferenced.catalog.sources.push({
      id: "reference.unused",
      name: "unused",
      url: "https://example.invalid/unused",
      revision: "abc123",
      license: "MIT",
      provenance: "reference-only",
      retrievedAt: "2026-09-15",
      notes: "Unused on purpose for the rejection test.",
    });
    expectInvalid(unreferenced, "not referenced");
  });

  test("rejects two IDs for the same source identity", () => {
    const input = clone();
    input.catalog.sources.push({
      ...input.catalog.sources[0]!,
      id: "reference.alpha-copy",
      provenance: "adapted",
    });
    input.packs[0]!.provenance = { mode: "adapted", sourceId: "reference.alpha-copy" };

    expectInvalid(input, "duplicate source identity");
  });

  test.each(["^1.2.3", "~1.2.3", ">=1.2.3", "latest", "workspace:*"])(
    "rejects unpinned direct version %s",
    (version) => {
      const input = clone();
      input.packageManifest.dependencies!.alpha = version;
      expectInvalid(input, "not pinned");
    },
  );

  test.each(["", "UNKNOWN", "NOASSERTION", "UNLICENSED"])("rejects unknown license metadata %s", (license) => {
    const input = clone();
    input.catalog.sources[0]!.license = license;
    expectInvalid(input, "license");
  });

  test("requires dependency versions, licenses, and canonical HTTPS sources to match installed metadata", () => {
    const version = clone();
    version.catalog.sources[0]!.revision = "9.9.9";
    expectInvalid(version, "version");

    const license = clone();
    license.catalog.sources[0]!.license = "ISC";
    expectInvalid(license, "license");

    const source = clone();
    source.catalog.sources[0]!.url = "https://github.com/example/not-alpha";
    expectInvalid(source, "source URL");

    const insecure = clone();
    insecure.catalog.sources[0]!.url = "http://github.com/example/alpha";
    expectInvalid(insecure, "HTTPS");
  });

  test("rejects root and direct dependency drift in package-lock.json", () => {
    const root = clone();
    root.packageLock!.version = "0.2.0";
    expectInvalid(root, "package-lock.json");

    const dependency = clone();
    dependency.packageLock!.packages["node_modules/alpha"]!.version = "1.2.2";
    expectInvalid(dependency, "package-lock.json");
  });

  test("requires complete retrieval metadata", () => {
    const date = clone();
    date.catalog.sources[0]!.retrievedAt = "not-a-date";
    expectInvalid(date, "retrieval date");

    const notes = clone();
    notes.catalog.sources[0]!.notes = "   ";
    expectInvalid(notes, "notes");
  });

  test("requires every non-original pack to reference one existing catalog source", () => {
    const missingId = clone();
    missingId.packs[0]!.provenance = { mode: "adapted" };
    expectInvalid(missingId, "sourceId");

    const unknown = clone();
    unknown.packs[0]!.provenance = { mode: "adapted", sourceId: "reference.unknown" };
    expectInvalid(unknown, "unknown source");

    const referenced = clone();
    referenced.catalog.sources.push({
      id: "reference.pack",
      name: "Reference pack",
      url: "https://example.invalid/reference-pack",
      revision: "abc123",
      license: "Apache-2.0",
      provenance: "adapted",
      retrievedAt: "2026-09-15",
      notes: "Source for an adapted fixture pack.",
    });
    referenced.packs[0]!.provenance = { mode: "adapted", sourceId: "reference.pack" };
    expect(validateProvenance(referenced).referencedSourceIds).toContain("reference.pack");
  });
});
