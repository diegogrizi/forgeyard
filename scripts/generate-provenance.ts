import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderThirdPartyNotices } from "../src/provenance/generate-notices.js";
import { renderSpdxSbom } from "../src/provenance/generate-sbom.js";
import { loadProvenanceWorkspace, validateProvenance } from "../src/provenance/validate.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const mode = process.argv.slice(2);

if (mode.length !== 1 || !["--write", "--check"].includes(mode[0]!)) {
  throw new Error("Use exactly one of --write or --check.");
}

const workspace = await loadProvenanceWorkspace(repositoryRoot);
validateProvenance(workspace);
const artifacts = new Map([
  ["THIRD_PARTY_NOTICES.md", renderThirdPartyNotices(workspace)],
  ["SBOM.spdx.json", renderSpdxSbom(workspace)],
]);

if (mode[0] === "--write") {
  await Promise.all([...artifacts].map(([relativePath, content]) =>
    writeFile(path.join(repositoryRoot, relativePath), content, "utf8")));
  process.stdout.write("Generated deterministic provenance artifacts.\n");
} else {
  const changed: string[] = [];
  for (const [relativePath, expected] of artifacts) {
    try {
      if (await readFile(path.join(repositoryRoot, relativePath), "utf8") !== expected) changed.push(relativePath);
    } catch {
      changed.push(relativePath);
    }
  }
  if (changed.length > 0) {
    process.stderr.write(`Provenance artifacts are stale: ${changed.join(", ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Provenance artifacts are current.\n");
  }
}
