import path from "node:path";

import { verifyExternalCatalogReference } from "../src/provenance/external-catalog.js";

const args = process.argv.slice(2);
let root = ".";
let validArguments = true;
for (let index = 0; index < args.length; index += 1) {
  const current = args[index];
  if (current === "--check") continue;
  if (current === "--root" && args[index + 1] !== undefined) {
    root = args[index + 1]!;
    index += 1;
  } else validArguments = false;
}

if (!validArguments) {
  process.stderr.write("Usage: tsx scripts/vendor-catalog.ts [--check] [--root PATH]\n");
  process.exitCode = 2;
} else {
  try {
    const summary = await verifyExternalCatalogReference(path.resolve(root));
    process.stdout.write(`External catalog reference verified: ${summary.curatedPlugins} curated plugins; ${summary.reference.repository}@${summary.reference.revision}.\n`);
  } catch {
    process.stderr.write("catalog.reference-invalid\n");
    process.exitCode = 1;
  }
}
