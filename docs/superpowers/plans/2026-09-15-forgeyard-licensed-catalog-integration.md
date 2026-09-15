# Forgeyard Licensed Catalog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing installer kernel into a broad factory by vendoring and natively rendering a pinned English MIT plugin catalog, with a curated hackathon profile and a complete full profile.

**Architecture:** Preserve Forgeyard's transactional file-level installer. Extend registry entries with a safe recursive tree type, parse the portable plugin model into a typed catalog, and let harness adapters emit native files. Vendor source bytes stay immutable and provenance-checked; generated project files remain individually owned and reversible.

**Tech Stack:** TypeScript 7, Node.js 24, AJV, YAML, smol-toml, Vitest, Git.

**Spec:** `docs/superpowers/specs/2026-09-15-forgeyard-full-factory-expansion-design.md`

**Status:** Complete on 2026-09-15. Tasks 1–7 were implemented in commits `abcd63a` through the documentation commit that closes this plan; the clean release gate passes with the attested catalog in the npm package.

## Global Constraints

- Repository and generated content are English.
- The full distributed catalog contains at least 80,000 licensed, non-generated physical lines.
- The pinned marketplace revision is `4236bb91f8395b0435f1d8b8baf9e8e4c69a8620` and its MIT notice is preserved.
- Default concurrency is four; installed roles are never described as active workers.
- No event, employer, organizer, team, or participant branding enters distributed content.
- No network access occurs during project initialization.
- Every rendered file remains path-confined, hash-bound, transactional, and reversible.
- Behavior changes follow RED, GREEN, focused verification, then commit.

---

### Task 1: Add safe tree components to the registry

**Files:**
- Modify: `src/core/contracts.ts`
- Modify: `schemas/pack.schema.json`
- Modify: `src/registry/load.ts`
- Modify: `src/registry/resolve.ts`
- Test: `tests/unit/registry/load.test.ts`
- Test: `tests/adversarial/registry-paths.test.ts`

**Interfaces:**
- Produces: `LoadedTreeFile { relativePath, sourcePath, sha256 }`
- Produces: `LoadedEntry.entryType`, `LoadedEntry.files`
- Produces: `ResolvedComponent.treeFiles`
- Consumes: existing `normalizePortablePath`, `resolveInsideRoot`, and SHA-256 helpers.

- [ ] **Step 1: Write failing happy-path and adversarial tests**

Add fixtures created in temporary directories that prove a tree entry loads hidden files in sorted order, computes stable hashes, rejects symlinks, rejects case-fold collisions, and rejects any file escaping the pack root.

```ts
expect(component.treeFiles?.map((file) => file.relativePath)).toEqual([
  ".claude-plugin/plugin.json",
  "agents/reviewer.md",
  "skills/review/SKILL.md",
]);
await expect(loadRegistry(rootWithLinkedTree)).rejects.toMatchObject({ code: "FY_REGISTRY_INVALID" });
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npx vitest run tests/unit/registry/load.test.ts tests/adversarial/registry-paths.test.ts`

Expected: FAIL because `entryType: tree`, `kind: catalog`, and tree file metadata are not supported.

- [ ] **Step 3: Extend contracts and schema**

Add `catalog` to `ComponentKind`; add optional `entryType: "file" | "tree"` and `format: "portable-plugin-marketplace-v1"`; add `LoadedTreeFile`; expose immutable `treeFiles` on resolved catalog components. Omitted `entryType` remains `file` for existing packs.

- [ ] **Step 4: Implement deterministic recursive loading**

Walk with `readdir({ withFileTypes: true })`, reject every symbolic link and non-file/non-directory entry, normalize every relative path, sort with the English locale, run `assertNoCaseCollisions`, hash each UTF-8 file, and hash the canonical sequence `<relativePath>\0<sha256>\n` for the component aggregate.

- [ ] **Step 5: Verify GREEN and compatibility**

Run: `npx vitest run tests/unit/registry tests/adversarial/registry-paths.test.ts tests/unit/registry/resolve.test.ts`

Expected: PASS, including all existing file-component tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/contracts.ts schemas/pack.schema.json src/registry/load.ts src/registry/resolve.ts tests/unit/registry/load.test.ts tests/adversarial/registry-paths.test.ts
git commit -m "feat: support safe catalog tree components"
```

### Task 2: Vendor and attest the pinned portable catalog

**Files:**
- Create: `packs/ecosystem/pack.yaml`
- Create: `packs/ecosystem/vendor/LICENSE`
- Create: `packs/ecosystem/vendor/UPSTREAM.json`
- Create: `packs/ecosystem/vendor/plugins/**`
- Create: `scripts/vendor-catalog.ts`
- Create: `tests/integration/provenance/vendor-catalog.test.ts`
- Modify: `sources/catalog.yaml`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run catalog:check`
- Produces: `UPSTREAM.json` with `source`, `revision`, `license`, `files`, `physicalLines`, and `sha256`.
- Consumes: tree component support from Task 1.

- [ ] **Step 1: Write the failing attestation test**

```ts
expect(attestation.revision).toBe("4236bb91f8395b0435f1d8b8baf9e8e4c69a8620");
expect(attestation.license).toBe("MIT");
expect(attestation.physicalLines).toBeGreaterThanOrEqual(80_000);
expect(await verifyVendorTree(vendorRoot, attestation)).toEqual({ ok: true });
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npx vitest run tests/integration/provenance/vendor-catalog.test.ts`

Expected: FAIL because the vendor tree and verifier do not exist.

- [ ] **Step 3: Copy only the pinned upstream `plugins/` tree and root MIT license**

Use the local research clone at the exact pinned revision. Exclude `.git`, generated harness outputs, runtime logs, caches, and external git-subdir payloads. Preserve bytes and relative paths.

- [ ] **Step 4: Implement the deterministic attestation checker**

The checker recursively rejects links, hashes all files in sorted portable-path order, counts physical lines for UTF-8 text, compares the inventory fields, and never modifies the vendor directory in `--check` mode.

- [ ] **Step 5: Register provenance and pack metadata**

Add source ID `github.wshobson-agents` with MIT license and the pinned commit. Define one `catalog` tree component using `portable-plugin-marketplace-v1`.

- [ ] **Step 6: Verify and commit**

Run: `npm run catalog:check && npx vitest run tests/integration/provenance/vendor-catalog.test.ts`

Expected: PASS with at least 80,000 licensed physical lines.

```bash
git add packs/ecosystem sources/catalog.yaml scripts/vendor-catalog.ts tests/integration/provenance/vendor-catalog.test.ts package.json
git commit -m "feat: vendor pinned portable agent catalog"
```

### Task 3: Parse portable plugins into a typed catalog

**Files:**
- Create: `src/catalog/frontmatter.ts`
- Create: `src/catalog/load-portable-marketplace.ts`
- Create: `src/catalog/contracts.ts`
- Test: `tests/unit/catalog/frontmatter.test.ts`
- Test: `tests/unit/catalog/load-portable-marketplace.test.ts`

**Interfaces:**
- Produces: `loadPortableMarketplace(treeFiles): PortableMarketplace`
- Produces: typed `PortablePlugin`, `PortableAgent`, `PortableSkill`, `PortableCommand`, and `PortableAsset`.
- Consumes: `ResolvedComponent.treeFiles` from Task 1.

- [ ] **Step 1: Write parser and catalog discovery tests**

Cover quoted scalars, folded descriptions, inline and block tool lists, missing optional fields, nested references, duplicate component names, malformed frontmatter, and sorted discovery.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/unit/catalog`

Expected: FAIL because the catalog modules are absent.

- [ ] **Step 3: Implement strict parsing with actionable errors**

Use the existing YAML dependency, require UTF-8 Markdown, keep the body byte-for-byte after frontmatter extraction, and report plugin plus relative path for every failure. Names are normalized only for generated IDs; source metadata is preserved.

- [ ] **Step 4: Verify actual vendor counts**

Assert the pinned snapshot discovers no fewer than 90 plugins, 180 agents, 180 skills, and 100 commands. Assert every component points to files inside the attested tree.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/unit/catalog tests/integration/provenance/vendor-catalog.test.ts
git add src/catalog tests/unit/catalog
git commit -m "feat: load portable plugin marketplaces"
```

### Task 4: Render the complete catalog for Codex

**Files:**
- Create: `src/adapters/codex-catalog.ts`
- Modify: `src/adapters/codex.ts`
- Modify: `src/adapters/strict-template.ts`
- Create: `tests/unit/adapters/codex-catalog.test.ts`
- Create: `tests/golden/codex-full-catalog.test.ts`

**Interfaces:**
- Produces: `renderCodexCatalog(component, selection): PlannedFile[]`
- Consumes: typed portable marketplace from Task 3.
- Preserves: `PlannedFile` file-granular ownership for installer rollback.

- [ ] **Step 1: Write failing transform tests**

Prove that skills plus references are copied, agent Markdown becomes valid TOML, commands become user-invocable skills, IDs are plugin-namespaced, read-only tool sets become `sandbox_mode = "read-only"`, and collisions fail before output.

- [ ] **Step 2: Add UTF-8 byte-budget tests**

An oversized skill must be split outside fenced code blocks, remain valid UTF-8, stay below 8 KiB for the primary body, and link its overflow reference.

- [ ] **Step 3: Confirm RED**

Run: `npx vitest run tests/unit/adapters/codex-catalog.test.ts`

Expected: FAIL because catalog rendering is absent.

- [ ] **Step 4: Implement the renderer**

Use `--` namespace separators, strip fields unsupported by Codex, rewrite harness-specific tool prose to portable action verbs, copy references and assets, and skip hooks with an explicit capability finding. Never activate or execute vendored scripts while rendering.

- [ ] **Step 5: Verify the golden full catalog**

Run: `npx vitest run tests/unit/adapters/codex-catalog.test.ts tests/golden/codex-full-catalog.test.ts`

Expected: PASS with at least 180 agents, 180 skills, and 100 command-derived skills, zero path collisions, and valid TOML/YAML.

- [ ] **Step 6: Commit**

```bash
git add src/adapters tests/unit/adapters/codex-catalog.test.ts tests/golden/codex-full-catalog.test.ts
git commit -m "feat: render full portable catalog for Codex"
```

### Task 5: Add curated and full profile selection

**Files:**
- Create: `profiles/minimal.yaml`
- Modify: `profiles/hackathon.yaml`
- Create: `profiles/full.yaml`
- Modify: `schemas/profile.schema.json`
- Modify: `schemas/forgeyard-config.schema.json`
- Modify: `src/core/contracts.ts`
- Modify: `src/config/config.ts`
- Modify: `src/config/wizard.ts`
- Modify: `src/registry/resolve.ts`
- Test: `tests/unit/config/wizard.test.ts`
- Test: `tests/unit/registry/resolve.test.ts`
- Test: `tests/roundtrip/cli.test.ts`

**Interfaces:**
- Produces: profiles `minimal | hackathon | full`.
- Produces: catalog selection `curated | all` and optional explicit plugin IDs.

- [ ] **Step 1: Write failing profile and wizard tests**

Assert deterministic non-interactive defaults, unknown plugin rejection, curated profile minimum role count, full profile all-plugin selection, and default concurrency four.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/unit/config tests/unit/registry/resolve.test.ts`

- [ ] **Step 3: Implement the schema and selection rules**

The curated list is stored in `profiles/hackathon.yaml`; the wizard displays capability groups rather than hundreds of individual files. `full` selects all local catalog plugins. `minimal` preserves the previous M1 output.

- [ ] **Step 4: Prove the installed result**

Run a CLI round trip in a temporary Git repository and assert the install manifest records every generated agent, skill, command-derived skill, reference, and license file.

- [ ] **Step 5: Commit**

```bash
git add profiles schemas src/core/contracts.ts src/config src/registry/resolve.ts tests/unit/config tests/unit/registry/resolve.test.ts tests/roundtrip/cli.test.ts
git commit -m "feat: add curated and full factory profiles"
```

### Task 6: Integrate provenance and release gates for vendored content

**Files:**
- Modify: `src/provenance/validate.ts`
- Modify: `src/provenance/generate-notices.ts`
- Modify: `src/provenance/generate-sbom.ts`
- Modify: `scripts/release-audit.ts`
- Modify: `tests/unit/provenance/validate.test.ts`
- Modify: `tests/integration/provenance/generated-files.test.ts`
- Modify: `tests/integration/package/package-contents.test.ts`
- Modify: `package.json`
- Regenerate: `THIRD_PARTY_NOTICES.md`
- Regenerate: `SBOM.spdx.json`

**Interfaces:**
- Consumes: source record and vendor attestation from Task 2.
- Produces: notices and SPDX entries for the catalog snapshot.

- [ ] **Step 1: Write failing provenance tests**

Require the vendored source to appear in notices and SBOM, fail on a changed vendor byte, fail on a missing MIT notice, and include vendor content in the deny-term scan while exempting it only from Forgeyard-authored placeholder style rules.

- [ ] **Step 2: Confirm RED**

Run: `npx vitest run tests/unit/provenance tests/integration/provenance tests/integration/package`

- [ ] **Step 3: Implement and regenerate**

Keep npm package relationships and vendored content relationships distinct. Add `packs/` content to the package allow-list, retain the upstream license, and report physical line/component counts in release output.

- [ ] **Step 4: Verify and commit**

```bash
npm run provenance:generate
npm run catalog:check
npm run audit:release
npm run pack:check
git add src/provenance scripts/release-audit.ts tests package.json THIRD_PARTY_NOTICES.md SBOM.spdx.json
git commit -m "chore: attest the licensed agent catalog"
```

### Task 7: Document the corrected product honestly

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Create: `docs/guides/catalog-and-context.md`
- Create: `docs/provenance/catalog-sources.md`
- Modify: `docs/superpowers/specs/2026-09-15-forgeyard-architecture-design.md`

**Interfaces:**
- Documents: kernel versus catalog, role count versus active workers, profile selection, license attribution, and unsupported harness features.

- [ ] **Step 1: Update public usage examples**

Show `minimal`, `hackathon`, and `full`; explain that `full` is a lazy on-disk library and still defaults to four workers.

- [ ] **Step 2: Add machine-checked documentation assertions**

Extend release tests to compare documented counts against the generated catalog report and reject the old M1-only language.

- [ ] **Step 3: Run the complete gate**

Run: `npm ci && npm run verify && npm run audit:dependencies && git diff --check`

Expected: all checks pass from a clean dependency install; the package contains the attested catalog; no forbidden identity term is present.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md CHANGELOG.md docs tests
git commit -m "docs: describe the complete Forgeyard catalog"
```

## Plan self-review

- Spec coverage: tree safety, pinned source, catalog parsing, Codex output, profiles, provenance, context limits, and documentation each have a task.
- Placeholder scan: no deferred implementation markers are used; later Claude Code, Cursor, orchestration, memory, analytics, and guardrail layers receive separate implementation plans after this catalog plan is complete.
- Type consistency: Tasks 1 through 4 pass `treeFiles` into `loadPortableMarketplace`, then `PortableMarketplace` into `renderCodexCatalog`; Tasks 5 through 7 consume only those established interfaces.

## Execution choice

The product owner already authorized continued local work without additional confirmations. Execute inline in this session with `superpowers:executing-plans`; do not dispatch subagents, push, publish, or mutate repositories outside Forgeyard and the dedicated research directory.
