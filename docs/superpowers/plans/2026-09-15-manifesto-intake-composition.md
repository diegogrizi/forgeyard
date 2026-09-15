# Manifesto Intake and Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a problem-first `inspect` and `prepare` path that reads a project, infers an evidence-backed configuration, selects a minimal coherent capability set, and installs a stable tailored suite without asking the user to choose profiles or plugins.

**Architecture:** A bounded inspector produces immutable project facts. A data-driven composer maps those facts and user constraints to a deterministic preparation decision. Existing adapters and the transactional installer consume a normalized `ForgeyardConfig`; the selected packs, plugins, evidence, reasons, and uncertainty remain stored with the project so updates never silently re-inspect.

**Tech Stack:** Node.js 24, TypeScript, Ajv JSON Schema, YAML, Commander, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-manifesto-aligned-factory-design.md`

## Global Constraints

- Repository content is English.
- Preparation performs no network call, model invocation, telemetry, or vendored-code execution.
- Every file read is project-confined, regular, non-symbolic, UTF-8 text, and size bounded.
- Existing schema-version-1 manual configurations remain valid.
- Automatic compositions use `forgeyard-workflow` as the only orchestration authority.
- Configuration, catalog, and rendered output remain deterministic and portable across Windows path semantics.
- No shell command strings; quality commands are executable/argument arrays.
- Existing transactional install, doctor, rollback, evidence, and worktree invariants remain unchanged.

---

### Task 1: Extend the stable configuration contract

**Files:**
- Modify: `src/core/contracts.ts`
- Modify: `src/config/config.ts`
- Modify: `schemas/forgeyard-config.schema.json`
- Modify: `schemas/profile.schema.json`
- Create: `profiles/tailored.yaml`
- Modify: `tests/unit/config/config.test.ts`
- Modify: `tests/unit/registry/load.test.ts`

**Interfaces:**
- Produces: `ProjectKind`, `IntakeEvidence`, `IntakeConfig`, `CompositionChoice`, `CompositionConfig`, `AutonomyConfig`.
- Produces: optional `intake`, `composition`, and `autonomy` sections on `ForgeyardConfig`, normalized by `validateConfig`.
- Produces: profile ID `tailored`.

- [x] **Step 1: Write failing backward-compatibility and tailored-config tests**

Add assertions equivalent to:

```ts
test("normalizes conservative factory metadata for a legacy config", () => {
  const result = validateConfig(legacyConfig());
  expect(result.intake).toEqual(expect.objectContaining({ strategy: "manual", kind: "unknown" }));
  expect(result.composition).toEqual(expect.objectContaining({ strategy: "manual" }));
  expect(result.autonomy).toEqual({
    level: "supervised",
    stopOnAmbiguity: true,
    externalEffects: "ask",
  });
});

test("accepts an automatic tailored configuration", () => {
  expect(validateConfig(tailoredConfig())).toEqual(expect.objectContaining({
    profile: "tailored",
    composition: expect.objectContaining({
      strategy: "automatic",
      packs: ["foundation", "delivery", "ecosystem"],
    }),
  }));
});
```

- [x] **Step 2: Run the narrow tests and confirm the new contract is rejected**

Run: `npx vitest run tests/unit/config/config.test.ts tests/unit/registry/load.test.ts`

Expected: FAIL because `tailored` and the new sections are unsupported.

- [x] **Step 3: Add exact TypeScript and schema contracts**

Use these shapes:

```ts
export type ProjectKind = "frontend" | "backend" | "full-stack" | "mobile" | "data" | "infrastructure" | "library" | "cli" | "unknown";

export interface IntakeEvidence {
  path: string;
  signal: string;
}

export interface IntakeConfig {
  strategy: "automatic" | "manual";
  request: string;
  sources: readonly string[];
  kind: ProjectKind;
  languages: readonly string[];
  frameworks: readonly string[];
  evidence: readonly IntakeEvidence[];
  confidence: "high" | "medium" | "low";
  questions: readonly string[];
}

export interface CompositionChoice { id: string; reason: string }

export interface CompositionConfig {
  strategy: "automatic" | "manual";
  packs: readonly string[];
  selected: readonly CompositionChoice[];
  excluded: readonly CompositionChoice[];
  analysisSha256: string;
}

export interface AutonomyConfig {
  level: "supervised" | "balanced" | "autonomous";
  maxCostUsd?: number;
  stopOnAmbiguity: true;
  externalEffects: "ask";
}
```

Default legacy values must be manual, conservative, and stable. Automatic tailored configurations require non-empty `composition.packs`, a 64-character lowercase SHA-256, and `catalog.selection: curated`.

- [x] **Step 4: Add and load the tailored profile**

`profiles/tailored.yaml` supplies conservative defaults and the normal pack set. Its stored composition may override the exact pack set later:

```yaml
schemaVersion: 1
id: tailored
version: 1.0.0
packs: [foundation, delivery, ecosystem]
catalog:
  selection: curated
  plugins: []
defaults:
  timeboxMinutes: 300
  orchestration: { mode: guided, maxConcurrency: 2 }
  presentation: { enabled: false, audience: Project stakeholders, durationMinutes: 7, offline: true }
```

- [x] **Step 5: Run the narrow tests until green**

Run: `npx vitest run tests/unit/config/config.test.ts tests/unit/registry/load.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add src/core/contracts.ts src/config/config.ts schemas/forgeyard-config.schema.json schemas/profile.schema.json profiles/tailored.yaml tests/unit/config/config.test.ts tests/unit/registry/load.test.ts
git commit -m "feat: add tailored factory configuration"
```

### Task 2: Inspect project evidence without executing project code

**Files:**
- Create: `src/intake/contracts.ts`
- Create: `src/intake/inspect.ts`
- Create: `tests/unit/intake/inspect.test.ts`

**Interfaces:**
- Produces: `inspectProject(input: InspectProjectInput): Promise<ProjectInspection>`.
- Consumes: explicit brief and project-relative specification paths.
- Produces: normalized name, request, mode, kind, languages, frameworks, package managers, quality commands, mutable roots, instruction surfaces, evidence, questions, confidence, and `analysisSha256`.

- [x] **Step 1: Write failing tests using real temporary repositories**

Cover these exact behaviors:

```ts
test("recognizes an existing Next.js project and its native checks", async () => {
  await fixture.file("package.json", JSON.stringify({
    name: "shop-ui",
    scripts: { test: "vitest run", build: "next build", lint: "next lint" },
    dependencies: { next: "16.0.0", react: "19.0.0" },
  }));
  await fixture.dir("app");
  const result = await inspectProject({ root: fixture.root, brief: "Add accessible checkout recovery." });
  expect(result).toEqual(expect.objectContaining({
    mode: "existing",
    kind: "frontend",
    languages: ["typescript"],
    frameworks: ["next.js", "react"],
    qualityCommands: expect.arrayContaining([{ name: "test", argv: ["npm", "test"] }]),
  }));
});

test("recognizes a Python API without inventing pytest", async () => {
  await fixture.file("pyproject.toml", "[project]\nname='ledger-api'\ndependencies=['fastapi']\n");
  const result = await inspectProject({ root: fixture.root, brief: "Add a balance endpoint." });
  expect(result.kind).toBe("backend");
  expect(result.frameworks).toContain("fastapi");
  expect(result.qualityCommands).toEqual([{ name: "diff-check", argv: ["git", "diff", "--check"] }]);
});
```

Also test a blank project, npm/pnpm/yarn lock detection, full-stack dependency signals, README purpose fallback, explicit spec precedence, existing `AGENTS.md`/`CLAUDE.md` detection, symlink rejection, escaping spec rejection, binary rejection, per-file 256 KiB limit, and deterministic fingerprints independent of absolute root.

- [x] **Step 2: Run and observe the missing-module failure**

Run: `npx vitest run tests/unit/intake/inspect.test.ts`

Expected: FAIL because `src/intake/inspect.ts` does not exist.

- [x] **Step 3: Implement bounded manifest readers and evidence normalization**

Read only root metadata and explicitly supplied specs. Ignore `.git`, `.env*`, dependency/build directories, and arbitrary source bodies. Parse `package.json` structurally; inspect other manifests as bounded text. Every detected framework/language/command must add a portable evidence path and signal.

Hash a canonical JSON object that excludes the absolute root and sorts all set-like arrays.

- [x] **Step 4: Run the inspector tests until green**

Run: `npx vitest run tests/unit/intake/inspect.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```sh
git add src/intake/contracts.ts src/intake/inspect.ts tests/unit/intake/inspect.test.ts
git commit -m "feat: inspect project evidence safely"
```

### Task 3: Select a minimal capability set from validated rules

**Files:**
- Create: `sources/capabilities.yaml`
- Create: `schemas/capability-rules.schema.json`
- Create: `src/intake/capability-rules.ts`
- Create: `src/intake/compose.ts`
- Create: `tests/unit/intake/compose.test.ts`

**Interfaces:**
- Produces: `loadCapabilityRules(registryRoot: string): Promise<CapabilityRules>`.
- Produces: `composeProject(inspection, options, rules): PreparationDecision`.
- Consumes: `ProjectInspection`, optional adapter/timebox/concurrency/budget/autonomy/presentation overrides, and harness availability evidence.

- [x] **Step 1: Write failing composition tests**

Assert that:

- frontend selects UI, accessibility, performance, testing, debugging, review, Git, and documentation capabilities but not backend/database capabilities;
- backend selects backend, database, security, performance, testing, debugging, review, Git, and documentation capabilities but not UI capabilities;
- full-stack combines both without duplicates;
- `agent-orchestration`, `agent-teams`, `conductor`, and `full-stack-orchestration` are always excluded with one-primary-workflow reasons;
- presentation is selected only by an override or explicit request evidence;
- focused maintenance recommends concurrency 1, a single domain 2, full-stack 3, and presentation delivery at most 4;
- explicit concurrency 1–16 wins;
- explicit adapter wins, otherwise existing instruction evidence wins, then available host order, then a disclosed Codex-format fallback;
- identical inspection/options/rules produce identical decisions.

- [x] **Step 2: Run the tests and confirm failure**

Run: `npx vitest run tests/unit/intake/compose.test.ts`

Expected: FAIL because the rules and composer do not exist.

- [x] **Step 3: Add the validated capability rule document**

The baseline must include only:

```yaml
baseline:
  - developer-essentials
  - debugging-toolkit
  - tdd-workflows
  - comprehensive-review
  - git-pr-workflows
  - documentation-generation
```

Frontend, backend, LLM, infrastructure, data, mobile, and presentation additions must be separate rules with reasons. The four overlapping orchestrator plugins must be explicit exclusions. Validate every referenced plugin against the portable catalog during load.

- [x] **Step 4: Implement deterministic composition**

Use sorted sets and stable reasons. Store chosen catalog plugins in both `catalog.plugins` and `composition.selected`. Compute packs from workflow shape and presentation, not from catalog size. Never select `full` automatically.

- [x] **Step 5: Run the narrow tests until green**

Run: `npx vitest run tests/unit/intake/compose.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add sources/capabilities.yaml schemas/capability-rules.schema.json src/intake/capability-rules.ts src/intake/compose.ts tests/unit/intake/compose.test.ts
git commit -m "feat: compose minimal project capabilities"
```

### Task 4: Resolve the exact stored pack selection

**Files:**
- Modify: `src/registry/resolve.ts`
- Modify: `src/application/forgeyard.ts`
- Modify: `tests/unit/registry/resolve.test.ts`

**Interfaces:**
- Changes: `resolveProfile(registry, profileId, adapterId, catalogOverride?, packOverride?)`.
- Consumes: `config.composition?.packs` from `renderPlan`.
- Preserves: static profile behavior when no override exists.

- [ ] **Step 1: Write failing resolver tests**

```ts
test("resolves only the stored tailored packs", async () => {
  const registry = await loadRegistry(path.resolve("."));
  const result = resolveProfile(registry, "tailored", "codex", {
    selection: "curated",
    plugins: ["developer-essentials"],
  }, ["foundation", "ecosystem"]);
  expect(result.packIds).toEqual(["ecosystem", "foundation"]);
  expect(result.components.some((item) => item.packId === "delivery")).toBe(false);
});
```

Also reject duplicate, missing, empty, and dependency-incomplete pack overrides.

- [ ] **Step 2: Run and observe that the override is ignored/unsupported**

Run: `npx vitest run tests/unit/registry/resolve.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement stable validated pack overrides**

Sort pack IDs, reject duplicates/missing packs, then let the existing component dependency checks reject incomplete graphs. Pass the stored override from application rendering.

- [ ] **Step 4: Run the resolver tests until green**

Run: `npx vitest run tests/unit/registry/resolve.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/registry/resolve.ts src/application/forgeyard.ts tests/unit/registry/resolve.test.ts
git commit -m "feat: resolve stored tailored packs"
```

### Task 5: Render the decision and real project context

**Files:**
- Create: `packs/foundation/templates/COMPOSITION.md.tpl`
- Modify: `packs/foundation/pack.yaml`
- Modify: `packs/delivery/templates/PROJECT.md.tpl`
- Modify: `packs/foundation/templates/AGENTS.md.tpl`
- Modify: `src/adapters/codex.ts`
- Modify: `src/adapters/claude-code.ts`
- Modify: `src/adapters/cursor.ts`
- Modify: `tests/unit/adapters/delivery-output.test.ts`
- Modify: `tests/golden/codex-hackathon.test.ts`

**Interfaces:**
- Produces: managed `.forgeyard/COMPOSITION.md` in every prepared/manual suite.
- Consumes: normalized intake/composition/autonomy data.
- Preserves: existing adapter-native paths and catalog transforms.
- Preserves: unknown existing root host instructions by targeting `.forgeyard/HOST.md` during automatic preparation.

- [ ] **Step 1: Write failing adapter assertions**

For a tailored frontend configuration, assert that the rendered files contain:

```ts
expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("Primary workflow: Forgeyard");
expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("next.js");
expect(byPath.get(".forgeyard/COMPOSITION.md")).toContain("Excluded: agent-orchestration");
expect(byPath.get("PROJECT.md")).toContain(config.intake!.request);
expect(byPath.get("AGENTS.md")).toContain("Do not ask the user to choose catalog skills");
```

Add a second case where intake evidence names an existing `AGENTS.md`: the rendered plan must contain `.forgeyard/HOST.md`, must not contain `AGENTS.md`, and installation must preserve the original root file byte-for-byte. Cover the equivalent `CLAUDE.md` behavior in the Claude adapter.

- [ ] **Step 2: Run and confirm the report is absent**

Run: `npx vitest run tests/unit/adapters/delivery-output.test.ts tests/golden/codex-hackathon.test.ts`

Expected: FAIL because `.forgeyard/COMPOSITION.md` is not rendered.

- [ ] **Step 3: Add shared stable rendering helpers**

Render sorted Markdown lists for facts, evidence, choices, exclusions, questions, and limits. Escape all user-derived inline Markdown and HTML where appropriate. Manual legacy configurations must render explicit “manual/not inferred” wording rather than fake evidence.

- [ ] **Step 4: Add the report component to all adapters**

Map `composition.report` to `.forgeyard/COMPOSITION.md`, include it in core slot ordering, and supply identical semantic content across adapters.

- [ ] **Step 5: Run adapter tests until green**

Run: `npx vitest run tests/unit/adapters tests/golden/codex-hackathon.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packs/foundation src/adapters tests/unit/adapters tests/golden/codex-hackathon.test.ts
git commit -m "feat: explain prepared factory decisions"
```

### Task 6: Expose read-only inspection and transactional preparation

**Files:**
- Create: `src/application/preparation.ts`
- Modify: `src/application/forgeyard.ts`
- Modify: `src/cli/program.ts`
- Create: `tests/integration/application/preparation.test.ts`
- Modify: `tests/unit/cli/program.test.ts`
- Modify: `tests/helpers/cli.ts`

**Interfaces:**
- Produces: `ForgeyardService.inspect(input): Promise<InspectCommandResult>`.
- Produces: `ForgeyardService.prepare(input): Promise<PrepareCommandResult>`.
- Produces CLI commands defined in the design spec.
- Reuses: `buildInstallPlan`, dry-run preview, confirmation, post-write doctor, and rollback.

- [ ] **Step 1: Write failing application tests**

Use real temporary projects to prove:

- `inspect` leaves the tree byte-for-byte unchanged;
- `prepare` reads `package.json` and a spec before selecting frontend capabilities;
- no prompt for profile, adapter, plugin, paths, command, or orchestration occurs;
- only a missing purpose triggers `project.purpose` in interactive mode;
- non-interactive missing purpose fails with `FY_INTAKE_INCOMPLETE`;
- dry-run returns the decision and creates nothing;
- apply uses normal transactional recovery on doctor failure;
- the resulting `forgeyard.yaml` stores the decision and a subsequent update does not re-inspect repository drift.

- [ ] **Step 2: Run and observe missing service methods**

Run: `npx vitest run tests/integration/application/preparation.test.ts tests/unit/cli/program.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement preparation orchestration**

Build this exact flow:

```ts
const inspection = await inspectProject(input);
const rules = await loadCapabilityRules(registryRoot);
const decision = await composeProject(inspection, input, rules);
const config = preparationConfig(inspection, decision);
const plan = await renderPlan(root, config, operationId("prepare"));
```

Return inspection and decision in both preview and applied results. Use the same confirmation and rollback boundary as `init`.

- [ ] **Step 4: Wire CLI options without raw string execution**

Commander must collect repeated `--spec` values as strings, parse bounded numeric values, and pass typed options to the service. Human output summarizes observed kind/frameworks, selected adapter/plugins, exclusions, questions, file changes, and doctor state.

- [ ] **Step 5: Run application and CLI tests until green**

Run: `npx vitest run tests/integration/application/preparation.test.ts tests/unit/cli/program.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/application/preparation.ts src/application/forgeyard.ts src/cli/program.ts tests/integration/application/preparation.test.ts tests/unit/cli/program.test.ts tests/helpers/cli.ts
git commit -m "feat: prepare a factory from the project problem"
```

### Task 7: Prove the first problem-first vertical slice

**Files:**
- Create: `tests/roundtrip/problem-first-preparation.test.ts`
- Modify: `README.md`
- Modify: `docs/guides/catalog-and-context.md`
- Modify: `docs/guides/delivery-workflow.md`
- Modify: `docs/superpowers/specs/2026-09-15-forgeyard-full-factory-expansion-design.md`
- Modify: `tests/integration/package/package-contents.test.ts`

**Interfaces:**
- Documents: `prepare` as ordinary interface and `init` as advanced/manual.
- Proves: frontend and backend fixtures receive different stored capability sets from the same factory.

- [ ] **Step 1: Write the failing round-trip test**

Create one Next.js fixture and one FastAPI fixture. Prepare both with only a brief and `--yes`. Assert:

- no profile/plugin answers were supplied;
- both configs use `profile: tailored`;
- selected plugin sets differ;
- neither contains an overlapping orchestrator plugin;
- both contain evidence paths and a composition report;
- an existing host-instruction fixture keeps its original instruction bytes and receives `.forgeyard/HOST.md`;
- doctor passes;
- a second dry-run/update is deterministic.

- [ ] **Step 2: Run and observe the incomplete round trip**

Run: `npm run build && npx vitest run tests/roundtrip/problem-first-preparation.test.ts`

Expected: FAIL until the packaged CLI and registry include the new surface.

- [ ] **Step 3: Rewrite the README entry point and correct completion claims**

Lead with:

```sh
npx forgeyard prepare ./my-project --brief "Add accessible checkout recovery"
```

Explain what was observed, chosen, excluded, and pinned. Move profile/adapter examples under “Advanced manual installation.” State that model-client launch remains host-provided and structurally tested unless separately exercised.

- [ ] **Step 4: Update package-content assertions and run the round trip**

Run: `npm run build && npx vitest run tests/roundtrip/problem-first-preparation.test.ts tests/integration/package/package-contents.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the complete release gate**

Run: `npm run verify`

Expected: typecheck, all tests, build, catalog attestation, provenance check, release audit, and package inspection PASS.

- [ ] **Step 6: Inspect repository state and commit**

Run:

```sh
git diff --check
git status --short
npm pack --dry-run --json
```

Then commit only the milestone files:

```sh
git add README.md docs src tests schemas profiles packs sources
git commit -m "feat: deliver problem-first factory preparation"
```

## Plan self-review

- Every Milestone A acceptance criterion maps to a task above.
- Existing manual initialization remains covered and unchanged in intent.
- The inspector, rules, composer, resolver, renderer, application, and CLI have isolated interfaces and tests.
- No step launches a provider, runs project code during inspection, or modifies vendored bytes.
- No placeholder implementation step or unspecified error-handling instruction remains.
