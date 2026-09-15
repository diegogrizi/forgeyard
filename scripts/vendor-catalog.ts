import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readVendorAttestation,
  summarizeVendorTree,
  verifyVendorTree,
  type VendorAttestation,
} from "../src/provenance/vendor-catalog.js";

const vendorRoot = path.resolve("packs", "ecosystem", "vendor");
const attestationPath = path.join(vendorRoot, "UPSTREAM.json");
const mode = process.argv[2] ?? "--check";

if (mode === "--write") {
  const summary = await summarizeVendorTree(vendorRoot, "plugins");
  const attestation: VendorAttestation = {
    schemaVersion: 1,
    source: "https://github.com/wshobson/agents",
    revision: "4236bb91f8395b0435f1d8b8baf9e8e4c69a8620",
    license: "MIT",
    contentRoot: "plugins",
    fileCount: summary.fileCount,
    physicalLines: summary.physicalLines,
    bytes: summary.bytes,
    treeSha256: summary.treeSha256,
    licenseSha256: summary.licenseSha256,
  };
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Catalog attestation written: ${attestation.fileCount} files, ${attestation.physicalLines} physical lines.\n`,
  );
} else if (mode === "--check") {
  const attestation = await readVendorAttestation(attestationPath);
  await verifyVendorTree(vendorRoot, attestation);
  process.stdout.write(
    `Catalog verified: ${attestation.fileCount} files, ${attestation.physicalLines} physical lines.\n`,
  );
} else {
  process.stderr.write("Usage: tsx scripts/vendor-catalog.ts [--check|--write]\n");
  process.exitCode = 2;
}
