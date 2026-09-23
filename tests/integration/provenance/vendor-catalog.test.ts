import { cp, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 15,4 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

import {
  readVendorAttestation,
  verifyVendorTree,
} from "../../../src/provenance/vendor-catalog.js";

const vendorRoot = path.resolve("packs", "ecosystem", "vendor");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

  test("rejects a changed vendor byte and a missing upstream license notice", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "forgeyard-vendor-drift-"));
    temporaryRoots.push(temporaryRoot);
    await cp(vendorRoot, temporaryRoot, { recursive: true });
    const attestation = await readVendorAttestation(path.join(temporaryRoot, "UPSTREAM.json"));
    const changedFile = path.join(temporaryRoot, "plugins", "accessibility-compliance", ".claude-plugin", "plugin.json");

    await writeFile(changedFile, "{}\n", "utf8");
    await expect(verifyVendorTree(temporaryRoot, attestation)).rejects.toEqual(
      expect.objectContaining({ name: "ProvenanceValidationError" }),
    );

    await cp(vendorRoot, temporaryRoot, { recursive: true, force: true });
    await unlink(path.join(temporaryRoot, "LICENSE"));
    await expect(verifyVendorTree(temporaryRoot, attestation)).rejects.toBeDefined();
  });
});
