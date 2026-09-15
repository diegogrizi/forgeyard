import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  readVendorAttestation,
  verifyVendorTree,
} from "../../../src/provenance/vendor-catalog.js";

const vendorRoot = path.resolve("packs", "ecosystem", "vendor");

describe("vendored portable catalog", () => {
  test("matches its pinned MIT source attestation byte for byte", async () => {
    const attestation = await readVendorAttestation(path.join(vendorRoot, "UPSTREAM.json"));

    expect(attestation).toMatchObject({
      schemaVersion: 1,
      source: "https://github.com/wshobson/agents",
      revision: "4236bb91f8395b0435f1d8b8baf9e8e4c69a8620",
      license: "MIT",
      contentRoot: "plugins",
      fileCount: 1007,
      physicalLines: 211_594,
    });
    expect(attestation.physicalLines).toBeGreaterThanOrEqual(80_000);
    await expect(verifyVendorTree(vendorRoot, attestation)).resolves.toEqual({
      ok: true,
      fileCount: attestation.fileCount,
      physicalLines: attestation.physicalLines,
      bytes: attestation.bytes,
      treeSha256: attestation.treeSha256,
      licenseSha256: attestation.licenseSha256,
    });
  });
});
