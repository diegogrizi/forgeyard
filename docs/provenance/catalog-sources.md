# Catalog sources and integrity

Forgeyard's broad portable catalog comes from one distributable, pinned source:

- Project: [`wshobson/agents`](https://github.com/wshobson/agents)
- Revision: `4236bb91f8395b0435f1d8b8baf9e8e4c69a8620`
- License: MIT
- Vendored scope: upstream `plugins/` tree only
- Inventory: **1,007 source files**, **211,594 physical lines**, 6,737,904 canonical LF bytes
- Components: **202 catalog agents**, **183 native skills**, **105 commands**
- Tree SHA-256: `cf4df3cf9f4412a2ce2024c83c58df09dbf16de2327cf7df841a8081bf044c97`

The upstream license is preserved at `packs/ecosystem/vendor/LICENSE`. Machine-readable source metadata lives in `sources/catalog.yaml`, while `packs/ecosystem/vendor/UPSTREAM.json` binds the repository, commit, license, counts, byte length, license hash, and tree hash.

## Verification boundary

`npm run catalog:check` recursively reads the vendored tree, rejects symbolic links and unsafe paths, normalizes text line endings for the canonical hash, and compares every attested value. A changed byte, removed file, extra file, or missing license fails the release.

`npm run provenance:check` then binds that attestation to the pack manifest and source catalog. Generated `THIRD_PARTY_NOTICES.md` and `SBOM.spdx.json` list the vendor snapshot separately from npm dependencies. The public package test confirms that the license, attestation, catalog content, and profiles are present.

## npm transport exception

npm intentionally omits nested `.gitignore` files from package tarballs. One upstream file at `plugins/ship-mate/.gitignore` is therefore carried byte-for-byte as `npm-carriers/ship-mate.gitignore`, and the mapping is declared in `UPSTREAM.json`. The original remains in the Git vendor tree and its bytes remain part of the 1,007-file attestation; the carrier preserves those bytes in the npm artifact without pretending npm retained the original path.

## Authored versus vendored behavior

The vendor tree is immutable MIT material. Forgeyard's Apache-2.0 adapter code reads and transforms it without executing upstream scripts or hooks. Generated Codex output uses namespaced paths, validates TOML and skill metadata, rejects collisions, and records file-level ownership for update and rollback.

The `full` profile produces **203 agent files** and **290 skill entrypoints** in Codex, while the curated `hackathon` profile produces **52 agent files** and **119 skill entrypoints**. Those are installation counts, not claims about simultaneous execution; the **maximum concurrency remains 4**.
