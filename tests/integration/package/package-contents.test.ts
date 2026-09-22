import path from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import { buildCli, runProcess } from "../../helpers/cli.js";

interface PackFile {
  path: string;
  size: number;
}

interface PackResult {
  id: string;
  name: string;
  version: string;
  files: PackFile[];
}

const repositoryRoot = path.resolve(".");
let packed: PackResult;
const publicGuides = new Set(["docs/DIREZIONE.md", "docs/MANIFESTO.md", "docs/STATO.md",
  "docs/percorsi-legacy.md", "docs/guide/primo-avvio.md", "docs/guide/uso.md",
  "docs/guide/problemi.md", "docs/guide/garanzie.md",
  "docs/guide/architettura.md", "docs/provenance/catalog-sources.md"]);

function allowed(filePath: string): boolean {
  if (publicGuides.has(filePath)) return true;
  if ([
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "SBOM.spdx.json",
  ].includes(filePath)) return true;
  return ["dist/", "schemas/", "profiles/", "packs/", "sources/"].some((prefix) => filePath.startsWith(prefix));
}

beforeAll(async () => {
  await buildCli(repositoryRoot);
  const result = await runProcess("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], repositoryRoot);
  if (result.exitCode !== 0) throw new Error(`npm pack failed.\n${result.stdout}\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as PackResult[];
  packed = parsed[0]!;
}, 60_000);

describe("public npm package contents", () => {
  test("contains every required runtime and provenance surface", () => {
    const paths = packed.files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining([
      "package.json",
      "README.md",
      "docs/DIREZIONE.md",
      "docs/MANIFESTO.md",
      "docs/STATO.md",
      "docs/percorsi-legacy.md",
      "docs/guide/primo-avvio.md",
      "docs/guide/uso.md",
      "docs/guide/problemi.md",
      "docs/guide/garanzie.md",
      "docs/guide/architettura.md",
      "docs/provenance/catalog-sources.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "LICENSE",
      "NOTICE",
      "THIRD_PARTY_NOTICES.md",
      "SBOM.spdx.json",
      "dist/cli/main.js",
      "dist/application/preparation.d.ts",
      "dist/adapters/create.d.ts",
      "dist/adapters/claude-code.d.ts",
      "dist/adapters/claude-code-catalog.d.ts",
      "schemas/forgeyard-config.schema.json",
      "schemas/capability-rules.schema.json",
      "profiles/hackathon.yaml",
      "profiles/minimal.yaml",
      "profiles/tailored.yaml",
      "packs/foundation/pack.yaml",
      "packs/foundation/templates/COMPOSITION.md.tpl",
      "packs/ecosystem/vendor/UPSTREAM.json",
      "packs/ecosystem/vendor/LICENSE",
      "packs/presentation/pack.yaml",
      "sources/catalog.yaml",
      "sources/capabilities.yaml",
      "dist/native/service.d.ts",
      "dist/native/protocol.d.ts",
      "dist/capsule/capsule.d.ts",
      "dist/workspace/entry.d.ts",
      "dist/workspace/personal.d.ts",
    ]));
    expect(paths.filter((filePath) => filePath.startsWith("packs/ecosystem/vendor/"))).toHaveLength(1_009);
  });

  test("contains only allow-listed publish paths", () => {
    const unexpected = packed.files.map((file) => file.path).filter((filePath) => !allowed(filePath));

    expect(unexpected).toEqual([]);
  });

  test("excludes source-only, forensic, generated-state, and media inputs", () => {
    const paths = packed.files.map((file) => file.path);
    const forbidden = paths.filter((filePath) =>
      (/^(?:src|tests|fixtures|docs|scripts|coverage|\.forgeyard)\//.test(filePath) && !publicGuides.has(filePath))
      || /^(?:evidence|state|screenshots?)(?:\/|$)/i.test(filePath)
      || /\.(?:log|png|jpe?g|webp|gif|mp4|mov)$/i.test(filePath));

    expect(forbidden).toEqual([]);
  });
});
