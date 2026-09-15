# Forgeyard M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to execute this plan task by task. If the user explicitly chooses delegated execution, the coordinator must additionally use `superpowers:subagent-driven-development`. Every implementation task follows `superpowers:test-driven-development`, and completion claims require `superpowers:verification-before-completion`.

**Goal:** Deliver a trustworthy, installable Forgeyard vertical slice in which `npx forgeyard init --profile hackathon --adapter codex` creates a project-scoped Codex workflow, validates it, runs one evidence-bound verification task, generates a brand-neutral offline presentation skeleton, and supports safe update and rollback.

**Architecture:** M1 is one publishable TypeScript npm package with internal module boundaries for configuration, registry resolution, adapters, installation, diagnostics, evidence, and provenance. Canonical packs remain separate from the Codex renderer. All writes flow through an in-memory install plan and a validated transaction; generated files are tracked by content hash and ownership. The single-package layout is an intentional M1 delivery choice: M2 may extract modules into workspaces without changing the public contracts defined here.

**Tech Stack:** Node.js `>=24.19.0 <25`, npm 11, TypeScript 7.0.2, ESM, Commander 15.0.0, `@inquirer/prompts` 8.7.2, YAML 2.9.1, smol-toml 1.8.0, Ajv 8.20.0 with `ajv-formats` 3.0.1, Diff 9.0.0, Picocolors 1.1.1, Execa 10.0.1, Vitest 5.0.1, tsup 8.5.1, tsx 4.23.13, and `@types/node` 26.5.1.

**Spec:** [`docs/superpowers/specs/2026-09-15-forgeyard-architecture-design.md`](../specs/2026-09-15-forgeyard-architecture-design.md)

**Global Constraints:**

- All product code, generated content, documentation, examples, test fixtures, and metadata are in English.
- Distributed content is brand-neutral: it contains no inherited organizer, sponsor, employer, team, participant, or event identity.
- The private deny-list term supplied during release verification is ephemeral. It must never be committed, placed in fixtures, or written to generated reports.
- M1 supports only the `hackathon` profile and `codex` adapter. Other values fail with stable `FY_*` error codes rather than being silently accepted.
- Forgeyard never stores credentials, shells command strings, mutates global configuration, pushes, publishes, deploys, or enables telemetry.
- `forgeyard.yaml` is human-owned seed configuration. Generated lock, manifest, state, task, adapter, and presentation files are Forgeyard-owned unless a contract below says otherwise.
- Unknown files and user-modified managed files are conflicts. Dry runs write nothing. Failed transactions restore the exact pre-operation state.
- Filesystem targets are resolved below the selected project root. Traversal, symlink/junction escapes, and case-insensitive path collisions fail closed.
- Verification receipts bind the task bytes, exact argument vector, clean Git commit, exit status, timings, and output hashes. They never retain command output or environment values.
- All reusable Forgeyard code and original content use Apache-2.0. Third-party packages and references retain their own license records and notices.
- Tests must be hermetic except the explicitly named real-Git round-trip. No test requires a model account, network access, browser service, or installed Codex client.
- No unfinished placeholder prose, deferred implementation promise, fake success, or unchecked example may remain at a task boundary.
- Do not broaden M1 into a DAG scheduler, worktree manager, multi-harness catalog, or plugin marketplace. Those remain later milestones.

## M1 user-visible contract

The completed vertical slice supports these commands:

```text
forgeyard init [target] --profile hackathon --adapter codex [--answers file] [--yes] [--dry-run] [--json]
forgeyard doctor [target] [--deny-term value]... [--json]
forgeyard verify <task-id> [--root target] [--json]
forgeyard update [target] [--yes] [--dry-run] [--json]
forgeyard rollback <operation-id> [--root target] [--yes] [--json]
```

The canonical smoke path is:

```powershell
npx forgeyard init . --profile hackathon --adapter codex --answers .\answers.yaml --yes
npx forgeyard doctor .
git add .
git commit -m "chore: initialize Forgeyard"
npx forgeyard verify T001
```

The installed Codex project contains:

```text
AGENTS.md
.agents/skills/forgeyard-workflow/SKILL.md
.agents/skills/forgeyard-showcase/SKILL.md
.codex/agents/reviewer.toml
forgeyard.yaml
forgeyard.lock
.forgeyard/manifest.json
.forgeyard/state/operations/<operation-id>.json
.forgeyard/tasks/T001.yaml
.forgeyard/evidence/<receipt-id>.json        # local and ignored by default
presentation/index.html
presentation/styles.css
presentation/app.js
presentation/README.md
```

## Exact source tree and responsibilities

```text
forgeyard/
├── AGENTS.md                                  # contribution instructions for Forgeyard itself
├── CHANGELOG.md                               # M1 release notes
├── CONTRIBUTING.md                            # local development and provenance rules
├── LICENSE                                    # Apache License 2.0 text
├── NOTICE                                     # Forgeyard copyright and notice policy
├── SBOM.spdx.json                             # deterministic SPDX 2.3 dependency graph
├── README.md                                  # public product guide and quick start
├── SECURITY.md                                # threat model and disclosure route
├── THIRD_PARTY_NOTICES.md                     # generated/checked direct-dependency notices
├── package.json                               # ESM package, bin, scripts, engines, published files
├── package-lock.json                          # exact dependency graph
├── tsconfig.json                              # strict compiler contract
├── tsconfig.build.json                        # TypeScript 7 declaration-only build
├── tsup.config.ts                             # CLI/library build with executable banner
├── vitest.config.ts                           # deterministic test roots and coverage exclusions
├── .gitattributes                             # normalized text output
├── .gitignore                                 # build, coverage, and local evidence exclusions
├── scripts/
│   ├── generate-provenance.ts                 # writes only tracked notice/SBOM outputs
│   └── release-audit.ts                       # non-leaking private release scan
├── src/
│   ├── application/
│   │   └── forgeyard.ts                       # end-to-end use-case orchestration
│   ├── cli/
│   │   ├── main.ts                            # executable entry and exit-code boundary
│   │   └── program.ts                         # command definitions and dependency injection
│   ├── core/
│   │   ├── contracts.ts                       # shared public data contracts
│   │   ├── errors.ts                          # stable typed errors and JSON/plain formatting
│   │   ├── hash.ts                            # canonical JSON and SHA-256 helpers
│   │   └── paths.ts                           # root confinement and portable path rules
│   ├── config/
│   │   ├── config.ts                          # YAML loading, defaults, Ajv validation, serialization
│   │   └── wizard.ts                          # injectable interactive/non-interactive answer flow
│   ├── registry/
│   │   ├── load.ts                            # schema-validated pack/profile/source loading
│   │   └── resolve.ts                         # dependency closure and deterministic component order
│   ├── adapters/
│   │   ├── adapter.ts                         # adapter interface and capability states
│   │   ├── codex.ts                           # Codex path/frontmatter/render contract
│   │   ├── render.ts                          # canonical component to planned-file conversion
│   │   └── strict-template.ts                 # closed-variable deterministic renderer
│   ├── installer/
│   │   ├── manifest.ts                        # lock, ownership manifest, and operation journal codecs
│   │   ├── plan.ts                            # preflight, staging, validation, and diff calculation
│   │   ├── apply.ts                           # atomic-per-file transaction and recovery
│   │   ├── update.ts                          # hash-aware regeneration and conflict detection
│   │   └── rollback.ts                        # operation-scoped reverse transaction
│   ├── doctor/
│   │   ├── content-audit.ts                   # generic deny-term and generated-content checks
│   │   ├── presentation-audit.ts              # offline/accessibility bundle contract
│   │   └── run-doctor.ts                      # structural, ownership, adapter, and content diagnostics
│   ├── evidence/
│   │   ├── receipts.ts                        # receipt validation, persistence, and staleness
│   │   └── run-verification.ts                # shell-free command execution against clean Git HEAD
│   └── provenance/
│       ├── generate-notices.ts                # deterministic notice rendering
│       ├── generate-sbom.ts                   # deterministic SPDX 2.3 rendering
│       └── validate.ts                        # source/license completeness gate
├── schemas/
│   ├── forgeyard-config.schema.json
│   ├── pack.schema.json
│   ├── profile.schema.json
│   ├── source-catalog.schema.json
│   ├── install-manifest.schema.json
│   ├── task.schema.json
│   └── receipt.schema.json
├── profiles/
│   └── hackathon.yaml                         # coherent M1 pack selection and defaults
├── packs/
│   ├── foundation/
│   │   ├── pack.yaml
│   │   ├── templates/AGENTS.md.tpl
│   │   ├── templates/task.yaml.tpl
│   │   ├── skills/forgeyard-workflow/SKILL.md.tpl
│   │   └── agents/reviewer.toml.tpl
│   └── presentation/
│       ├── pack.yaml
│       ├── skills/forgeyard-showcase/SKILL.md
│       └── templates/presentation/
│           ├── index.html.tpl
│           ├── styles.css
│           ├── app.js
│           └── README.md.tpl
├── sources/
│   └── catalog.yaml                           # direct dependencies and any referenced upstream sources
├── fixtures/
│   ├── answers/hackathon.yaml
│   └── golden/codex-hackathon/                # exact expected adapter output
└── tests/
    ├── unit/                                  # pure contracts, resolver, renderer, audit, receipts
    ├── integration/                           # temporary-filesystem install/update/rollback behavior
    ├── adversarial/                           # traversal, collision, ownership, and deny-term attacks
    ├── golden/                                # canonical output comparison
    └── roundtrip/                             # built CLI against a temporary real Git repository
```

M2 extraction rule: modules may move from `src/<area>` to `packages/<area>`, but command syntax, YAML/JSON schemas, stable error codes, adapter interface, install manifest, and receipt formats remain backward compatible or receive an explicit schema migration.

## Frozen M1 contracts

Implement these TypeScript shapes in `src/core/contracts.ts`; schemas must express the same constraints and tests must detect drift between the two representations.

```ts
export type NonEmptyArgv = readonly [executable: string, ...args: string[]];

export interface QualityCommand {
  name: string;
  argv: NonEmptyArgv;
}

export interface ForgeyardConfig {
  schemaVersion: 1;
  project: {
    name: string;
    purpose: string;
    mode: "new" | "existing";
  };
  harnesses: readonly ["codex"];
  profile: "hackathon";
  timeboxMinutes: number;
  quality: {
    commands: readonly QualityCommand[];
  };
  paths: {
    mutableRoots: readonly string[];
    protectedPaths: readonly string[];
    presentation: string;
  };
  orchestration: {
    mode: "native" | "guided";
    maxConcurrency: number;
  };
  presentation: {
    enabled: true;
    audience: string;
    durationMinutes: number;
    offline: true;
  };
}

export interface InitRequest {
  targetRoot: string;
  config: ForgeyardConfig;
}
```

`targetRoot` is runtime input and is never serialized into `forgeyard.yaml`. Stored paths are slash-normalized, project-relative, contain no `..` segment, and do not start with a drive, UNC prefix, or slash. `mutableRoots` and `protectedPaths` must not overlap after Windows-style case folding. `timeboxMinutes` is `30..1440`; `maxConcurrency` is `1..16` with default `4`; presentation duration is `1..60`.

```ts
export type ComponentKind =
  | "instruction" | "skill" | "agent" | "command" | "workflow"
  | "hook" | "connector" | "tool-policy" | "template"
  | "validator" | "reference";

export type ProvenanceMode =
  | "original" | "dependency" | "vendored-unmodified" | "adapted"
  | "generated-from-spec" | "clean-room-reimplementation" | "reference-only";

export interface ComponentDeclaration {
  id: string;
  kind: ComponentKind;
  entry: string;
  slot: string;
  template: boolean;
  ownership: "managed" | "seed";
  requires: readonly string[];
  conflicts: readonly string[];
}

export interface PackManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  license: string;
  provenance: { mode: ProvenanceMode; sourceId?: string };
  components: readonly ComponentDeclaration[];
}

export interface ProfileManifest {
  schemaVersion: 1;
  id: "hackathon";
  version: string;
  packs: readonly string[];
  defaults: Pick<ForgeyardConfig, "timeboxMinutes" | "orchestration" | "presentation">;
}

export interface ResolvedComponent extends ComponentDeclaration {
  packId: string;
  packVersion: string;
  sourcePath: string;
  sha256: string;
}
```

The resolver rejects duplicate IDs or slots, missing dependencies, dependency cycles, conflicts, invalid licenses, and invalid entry paths. Slots are harness-neutral logical destinations such as `project.instructions` and `workflow.primary`; only an adapter maps them to filesystem targets. Adapter validation rejects missing slot mappings and two rendered files targeting the same case-folded path. Resolver output order is deterministic: dependency topological order, then `packId`, then component `id`.

```ts
export type CapabilityState = "native" | "adapted" | "emulated" | "advisory" | "unsupported";

export interface PlannedFile {
  path: string;
  content: string;
  sha256: string;
  componentId: string;
  ownership: "managed" | "seed";
}

export interface InstallPlan {
  schemaVersion: 1;
  operationId: string;
  targetRoot: string;
  profile: "hackathon";
  adapter: "codex";
  files: readonly PlannedFile[];
}

export interface HarnessAdapter {
  id: "codex";
  capabilities: Readonly<Record<string, CapabilityState>>;
  validateConfig(config: ForgeyardConfig): void;
  render(components: readonly ResolvedComponent[], config: ForgeyardConfig): Promise<readonly PlannedFile[]>;
  validateOutput(files: readonly PlannedFile[]): Promise<void>;
}
```

The installer computes the bytes and hashes before touching the target. `operationId` is a sortable UTC timestamp plus random suffix, generated through an injectable clock/ID dependency so tests remain deterministic.

```ts
export interface CheckResult {
  id: string;
  status: "passed" | "failed" | "skipped" | "unavailable";
  required: boolean;
  message: string;
  remediation?: string;
  paths?: readonly string[];
}

export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  root: string;
  checks: readonly CheckResult[];
}

export interface VerificationTask {
  schemaVersion: 1;
  id: string;
  title: string;
  command: NonEmptyArgv;
  required: true;
}

export interface VerificationReceipt {
  schemaVersion: 1;
  receiptId: string;
  taskId: string;
  taskSha256: string;
  argvSha256: string;
  gitCommit: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
  status: "passed" | "failed";
}
```

`DoctorReport.ok` is true only when every required check is `passed`. A required check may never be converted to `skipped`. Receipt staleness is computed, not stored as mutable truth: a receipt is stale if current `HEAD`, task bytes, or canonical argv differ from the receipt.

## Error and exit contract

All expected failures are `ForgeyardError` instances containing `code`, plain-language `message`, optional `paths`/`components`, `remediation`, and `exitCode`. Plain output writes the message and remediation to stderr; `--json` emits one JSON object to stdout and no decorative text.

| Error code | Meaning | Exit |
|---|---|---:|
| `FY_CONFIG_INVALID` | YAML or schema-invalid user intent | 2 |
| `FY_UNSUPPORTED_SELECTION` | M1 profile or adapter is unsupported | 2 |
| `FY_REGISTRY_INVALID` | Pack/profile/source contract failure | 3 |
| `FY_COMPONENT_CONFLICT` | Resolver dependency or target conflict | 3 |
| `FY_PATH_UNSAFE` | Target escapes root or uses an unsafe filesystem object | 4 |
| `FY_OWNERSHIP_CONFLICT` | Unknown or user-modified destination would be replaced | 4 |
| `FY_TRANSACTION_FAILED` | Apply/update/rollback failed and recovery ran | 5 |
| `FY_DOCTOR_FAILED` | One or more required checks failed | 6 |
| `FY_GIT_REQUIRED` | Verification lacks a clean Git commit | 7 |
| `FY_COMMAND_FAILED` | Verification command exited unsuccessfully | 8 |
| `FY_RECEIPT_STALE` | Evidence no longer matches task or revision | 9 |
| `FY_PROVENANCE_INVALID` | License/source metadata is incomplete | 10 |
| `FY_INTERNAL` | Unexpected defect at the executable boundary | 1 |

## Task 1: Bootstrap the publishable TypeScript CLI

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `src/cli/main.ts`
- Create: `src/cli/program.ts`
- Create: `src/core/contracts.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/hash.ts`
- Create: `src/core/paths.ts`
- Test: `tests/unit/cli/program.test.ts`
- Test: `tests/unit/core/hash.test.ts`
- Test: `tests/unit/core/paths.test.ts`

**Step 1: Add the minimal build and test harness**

Create an ESM `package.json` at version `0.1.0` with package name `forgeyard`, `bin.forgeyard = dist/cli/main.js`, Node engine `>=24.19.0 <25`, an explicit publish `files` allow-list, and scripts `build`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:roundtrip`, `verify`, and `pack:check`. Pin the dependency versions named in this plan exactly; do not use floating ranges for M1.

Configure TypeScript with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, NodeNext modules, JSON module support, declarations, and no emit for type-check. Because tsup 8.5.1's declaration plugin is not compatible with TypeScript 7.0.2, configure tsup to emit ESM plus source maps and run a separate `tsconfig.build.json` declaration-only pass with TypeScript itself. Add a Unix executable banner. Normalize repository text to LF while leaving generated output platform-independent.

Run:

```powershell
npm install
npm run typecheck
```

Expected: dependency lock is created; type-check fails only because source files have not been added yet.

**Step 2: Write failing executable-boundary tests**

In `tests/unit/cli/program.test.ts`, require:

- `createProgram()` exposes `init`, `doctor`, `verify`, `update`, and `rollback` in help;
- `--version` returns `0.1.0` without reading the current directory;
- a thrown `ForgeyardError` preserves its stable code and exit code in JSON;
- an unknown thrown error becomes `FY_INTERNAL` without a stack trace unless a debug flag is active.

In the core tests, require recursively sorted canonical JSON hashing, identical hashes for key-order variants, root-confined relative path resolution, and rejection of absolute, traversal, NUL, and case-colliding paths.

Run:

```powershell
npm test -- tests/unit/cli/program.test.ts tests/unit/core/hash.test.ts tests/unit/core/paths.test.ts
```

Expected: FAIL because the imported modules do not exist.

**Step 3: Implement only the tested foundation**

Add the frozen contract types, `sha256Text()`, `canonicalJson()`, `resolveInsideRoot()`, `normalizePortablePath()`, `assertNoCaseCollisions()`, `ForgeyardError`, and `formatFailure()`. Implement command shells with injected handlers that currently return a stable `FY_INTERNAL` only if invoked; do not add workflow behavior assigned to later tasks.

`main.ts` must call `program.parseAsync()`, translate one error, set `process.exitCode`, and never call `process.exit()` from library code.

**Step 4: Prove the foundation**

Run:

```powershell
npm test -- tests/unit/cli/program.test.ts tests/unit/core/hash.test.ts tests/unit/core/paths.test.ts
npm run typecheck
npm run build
node .\dist\cli\main.js --help
node .\dist\cli\main.js --version
```

Expected: all tests pass; help lists exactly five M1 commands; version is `0.1.0`.

**Step 5: Commit the task**

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.build.json tsup.config.ts vitest.config.ts .gitignore .gitattributes src tests/unit docs/superpowers/plans/2026-09-15-forgeyard-m1-implementation.md
git commit -m "feat: bootstrap Forgeyard CLI"
```

## Task 2: Validate portable configuration and collect answers

**Files:**

- Create: `schemas/forgeyard-config.schema.json`
- Create: `src/config/config.ts`
- Create: `src/config/wizard.ts`
- Create: `fixtures/answers/hackathon.yaml`
- Test: `tests/unit/config/config.test.ts`
- Test: `tests/unit/config/wizard.test.ts`
- Modify: `src/cli/program.ts`

**Step 1: Write the failing configuration contract tests**

Cover valid YAML round-trip, unknown-key rejection, required fields, numeric limits, one-or-more argv entries, unsupported profile/adapter errors, non-portable paths, mutable/protected overlap, deterministic serialization, and proof that serialized YAML contains no absolute `targetRoot`.

For `wizard.ts`, define and test an injectable `PromptDriver` with `input`, `select`, `number`, and `confirm`. Test three flows: fully interactive, complete answer file with zero prompts, and non-interactive mode with a missing required answer returning `FY_CONFIG_INVALID`.

Run:

```powershell
npm test -- tests/unit/config/config.test.ts tests/unit/config/wizard.test.ts
```

Expected: FAIL because the schema and modules do not exist.

**Step 2: Implement schema-backed loading and defaults**

Expose:

```ts
loadConfig(path: string): Promise<ForgeyardConfig>
validateConfig(value: unknown): ForgeyardConfig
serializeConfig(config: ForgeyardConfig): string
collectInitRequest(input: WizardInput, prompts: PromptDriver): Promise<InitRequest>
```

Use one Ajv instance with all errors enabled, formats registered, and no coercion or mutation. Convert Ajv paths into a concise stable validation list. Apply defaults in TypeScript before validation: 300-minute timebox, guided orchestration, max concurrency 4, 7-minute presentation, and offline true. Do not make Ajv mutate caller objects.

The checked-in fixture represents a generic web prototype, uses `npm test` as an argv array, sets mutable roots to `src` and `presentation`, protects `.git` and `.env`, and contains no person, organization, event, or inherited visual identity.

**Step 3: Connect parsing without performing installation**

Update the `init` command to parse target/profile/adapter/answers/yes/dry-run/json options and call an injected `collectRequest` dependency. Until Task 10 wires installation, the default handler returns a clear internal-development result only under tests; the production command must not claim that installation happened.

**Step 4: Verify the configuration boundary**

Run:

```powershell
npm test -- tests/unit/config/config.test.ts tests/unit/config/wizard.test.ts tests/unit/cli/program.test.ts
npm run typecheck
```

Expected: all tests pass and invalid configuration errors use exit code 2.

**Step 5: Commit the task**

```powershell
git add schemas/forgeyard-config.schema.json src/config fixtures/answers/hackathon.yaml src/cli/program.ts tests/unit/config tests/unit/cli/program.test.ts
git commit -m "feat: add Forgeyard configuration wizard"
```

## Task 3: Load canonical packs and resolve the hackathon profile

**Files:**

- Create: `schemas/pack.schema.json`
- Create: `schemas/profile.schema.json`
- Create: `schemas/source-catalog.schema.json`
- Create: `profiles/hackathon.yaml`
- Create: `packs/foundation/pack.yaml`
- Create: `sources/catalog.yaml`
- Create: `src/registry/load.ts`
- Create: `src/registry/resolve.ts`
- Test: `tests/unit/registry/load.test.ts`
- Test: `tests/unit/registry/resolve.test.ts`
- Test: `tests/adversarial/registry-paths.test.ts`

**Step 1: Write failing manifest-loader tests**

Require strict schemas with `additionalProperties: false`, semantic versions, SPDX-shaped license IDs, portable entry/target paths, a valid provenance mode, unique pack/component/source IDs, and source metadata for every non-original component. The source catalog record contract is:

```ts
interface SourceRecord {
  id: string;
  name: string;
  url: string;
  revision: string;
  license: string;
  provenance: ProvenanceMode;
  retrievedAt: string;
  notes: string;
}
```

Adversarial fixtures created inside tests must reject `../`, absolute paths, encoded separators, duplicate case-folded slots, entries outside their pack root, and symlinked entries. Tests remove their own temporary directories.

Run:

```powershell
npm test -- tests/unit/registry/load.test.ts tests/adversarial/registry-paths.test.ts
```

Expected: FAIL because loaders and schemas do not exist.

**Step 2: Write failing deterministic-resolver tests**

Use in-memory manifests to cover dependency closure, stable topological ordering, duplicate IDs/slots, missing requirements, cycles, explicit conflicts, unsupported M1 selections, and resolution equality when input directory enumeration order changes.

Run:

```powershell
npm test -- tests/unit/registry/resolve.test.ts
```

Expected: FAIL because `resolveProfile()` does not exist.

**Step 3: Implement validated loading and resolution**

Expose:

```ts
loadRegistry(root: string): Promise<RegistrySnapshot>
resolveProfile(registry: RegistrySnapshot, profileId: string, adapterId: string): ResolvedProfile
```

Load only declared M1 registry roots, validate before dereferencing entries, resolve entry real paths, hash source bytes, and return immutable plain data. Never execute pack content. The M1 `hackathon` profile selects `foundation` first and reserves `presentation` as its second required pack once Task 9 adds it.

The foundation manifest declares these original Apache-2.0 components:

| Component ID | Kind | Entry | Logical slot | Codex adapter target | Ownership |
|---|---|---|---|---|---|
| `foundation.project-instructions` | `instruction` | `templates/AGENTS.md.tpl` | `project.instructions` | `AGENTS.md` | managed |
| `foundation.workflow-skill` | `skill` | `skills/forgeyard-workflow/SKILL.md.tpl` | `workflow.primary` | `.agents/skills/forgeyard-workflow/SKILL.md` | managed |
| `foundation.reviewer-agent` | `agent` | `agents/reviewer.toml.tpl` | `review.readonly` | `.codex/agents/reviewer.toml` | managed |
| `foundation.initial-task` | `template` | `templates/task.yaml.tpl` | `task.initial` | `.forgeyard/tasks/T001.yaml` | managed |

Populate the source catalog with Forgeyard’s direct npm dependencies and their exact package/repository URLs, revisions, and licenses. It is metadata only; no upstream prompt or template body enters M1.

**Step 4: Verify the registry boundary**

Run:

```powershell
npm test -- tests/unit/registry tests/adversarial/registry-paths.test.ts
npm run typecheck
```

Expected: all tests pass and two equivalent registry trees produce byte-identical resolved JSON.

**Step 5: Commit the task**

```powershell
git add schemas/pack.schema.json schemas/profile.schema.json schemas/source-catalog.schema.json profiles packs/foundation/pack.yaml sources/catalog.yaml src/registry tests/unit/registry tests/adversarial/registry-paths.test.ts
git commit -m "feat: resolve canonical Forgeyard packs"
```

## Task 4: Render original foundation content through the Codex adapter

**Files:**

- Create: `src/adapters/adapter.ts`
- Create: `src/adapters/strict-template.ts`
- Create: `src/adapters/render.ts`
- Create: `src/adapters/codex.ts`
- Create: `packs/foundation/templates/AGENTS.md.tpl`
- Create: `packs/foundation/templates/task.yaml.tpl`
- Create: `packs/foundation/skills/forgeyard-workflow/SKILL.md.tpl`
- Create: `packs/foundation/agents/reviewer.toml.tpl`
- Create: `fixtures/golden/codex-hackathon/AGENTS.md`
- Create: `fixtures/golden/codex-hackathon/.agents/skills/forgeyard-workflow/SKILL.md`
- Create: `fixtures/golden/codex-hackathon/.codex/agents/reviewer.toml`
- Create: `fixtures/golden/codex-hackathon/.forgeyard/tasks/T001.yaml`
- Test: `tests/unit/adapters/strict-template.test.ts`
- Test: `tests/unit/adapters/codex.test.ts`
- Test: `tests/golden/codex-hackathon.test.ts`

**Step 1: Write failing closed-template tests**

Define tokens as dotted names inside double braces. Require deterministic substitution, rejection of missing variables, rejection of unused supplied variables, rejection of an unrendered token after rendering, preservation of LF endings, and context-specific escaping helpers for Markdown, YAML double-quoted scalars, TOML multiline strings, and HTML text. Do not allow function calls, includes, arbitrary property access, or template execution.

Run:

```powershell
npm test -- tests/unit/adapters/strict-template.test.ts
```

Expected: FAIL because the renderer does not exist.

**Step 2: Write failing Codex adapter and golden tests**

For the generic fixture configuration, assert exactly four component outputs, exact normalized target paths, stable SHA-256 values, valid skill frontmatter, reviewer TOML parsed by smol-toml, parseable task YAML, and byte-for-byte equality with the golden tree. Assert the adapter capability matrix labels custom instructions, project skills, and reviewer agents `native`; task execution and evidence are `emulated`; DAG scheduling is `unsupported` in M1.

Run:

```powershell
npm test -- tests/unit/adapters/codex.test.ts tests/golden/codex-hackathon.test.ts
```

Expected: FAIL because the adapter and templates do not exist.

**Step 3: Author concise original foundation templates**

`AGENTS.md.tpl` contains project purpose, mutable/protected path policy, exact quality commands, an evidence-before-status rule, visible-slice-first guidance, and links to the on-demand workflow skill. Keep it navigational and under 4,000 characters; do not paste the full skill into it.

The workflow skill uses valid `name` and `description` frontmatter and defines this finite sequence:

```text
orient -> define visible slice -> plan one task -> implement -> verify -> review -> demo rehearsal -> stop
```

It requires reading `forgeyard.yaml` and the selected task, distinguishes implemented/verified/reviewed/demo-ready, caps active work at configured concurrency, and forbids external side effects without explicit project policy.

The reviewer agent is read-only by instruction, reviews the named frozen revision and acceptance criteria, reports findings before summary, and may not edit or claim independent review of its own new changes. The initial task is a valid but intentionally uncompleted task that asks the user to replace its title and acceptance detail before execution; it contains no fake product implementation claim.

**Step 4: Implement the adapter and freeze golden output**

Implement the `HarnessAdapter` contract, validate every rendered target and body, and compute hashes only after normalization. Generate golden files by running a small checked-in TypeScript test helper through the production renderer, inspect the diff, and then commit the static expected bytes; never make the test update goldens automatically.

**Step 5: Verify rendering**

Run:

```powershell
npm test -- tests/unit/adapters tests/golden/codex-hackathon.test.ts
npm run typecheck
rg -n "\{\{[^}]+\}\}" fixtures/golden/codex-hackathon
```

Expected: tests pass and the final ripgrep returns no matches.

**Step 6: Commit the task**

```powershell
git add src/adapters packs/foundation fixtures/golden tests/unit/adapters tests/golden
git commit -m "feat: render Codex foundation pack"
```

## Task 5: Plan and apply a recoverable project-scoped installation

**Files:**

- Create: `schemas/install-manifest.schema.json`
- Create: `src/installer/manifest.ts`
- Create: `src/installer/plan.ts`
- Create: `src/installer/apply.ts`
- Test: `tests/unit/installer/manifest.test.ts`
- Test: `tests/integration/installer/install.test.ts`
- Test: `tests/adversarial/installer-paths.test.ts`

**Step 1: Write failing install-plan tests**

Require `buildInstallPlan()` to add the human-owned `forgeyard.yaml` seed, resolver-owned `forgeyard.lock`, `.forgeyard/.gitignore`, and the adapter’s managed payload. `.forgeyard/manifest.json` and operation state are administrative transaction outputs and are not self-listed, avoiding recursive hashes.

Assert stable plan order, deterministic lock bytes for identical inputs, create/unchanged/conflict diff states, zero writes during dry run, and no dependency on the process current directory.

Run:

```powershell
npm test -- tests/unit/installer/manifest.test.ts tests/integration/installer/install.test.ts
```

Expected: FAIL because the installer modules do not exist.

**Step 2: Write failing ownership and recovery tests**

In a fresh temporary root, cover:

- successful install and valid manifest hashes;
- a second identical plan producing no payload change;
- an unknown existing `AGENTS.md` causing `FY_OWNERSHIP_CONFLICT` before any write;
- a changed managed file causing the same conflict;
- an existing user-owned `forgeyard.yaml` being loaded/preserved, never overwritten;
- injected failure on the first, middle, and last destination move restoring every preimage;
- staging validation failure leaving no target changes;
- all staging/backups remaining under `.forgeyard/state`;
- traversal, symlink/junction ancestor, root alias, and case collision rejection.

Inject a `FileSystemPort` into transaction code to simulate failures deterministically; production uses Node `fs/promises`.

**Step 3: Implement the manifest and preflight**

The install manifest stores schema version, Forgeyard version, active profile/adapter, latest successful operation, and records for seed/managed payload files. Each record contains relative path, component ID, ownership, installed SHA-256, and operation ID. Seed hashes describe only the initially written bytes and are never enforced after creation.

Before staging, inspect every path component with `lstat`, reject symbolic links and junctions, resolve the nearest existing ancestor, verify root confinement with case-insensitive Windows handling, and collect all conflicts. Return all safe-to-report conflicts in one error rather than failing after the first.

**Step 4: Implement the transaction**

Execute:

```text
preflight -> stage under .forgeyard/state/staging/<id> -> validate staged bytes
-> persist prepared journal -> move old managed bytes to backup -> move staged bytes into place
-> write manifest and completed journal -> remove staging -> return doctor-ready result
```

The prepared journal records intended path, pre-state (`absent`, `seed`, or `managed`), pre-hash, post-hash, and backup path. On any failure, reverse completed moves in reverse order, restore the prior manifest, mark the journal `recovered` if possible, and throw `FY_TRANSACTION_FAILED`. If recovery itself fails, include exact remaining paths in the error and retain backups.

Do not follow links, do not use shell commands, and do not recursively delete any path that was not created and recorded by the current operation.

**Step 5: Verify installation behavior**

Run:

```powershell
npm test -- tests/unit/installer tests/integration/installer/install.test.ts tests/adversarial/installer-paths.test.ts
npm run typecheck
```

Expected: all tests pass; every injected failure leaves payload bytes equal to the pre-test snapshot.

**Step 6: Commit the task**

```powershell
git add schemas/install-manifest.schema.json src/installer tests/unit/installer tests/integration/installer tests/adversarial/installer-paths.test.ts
git commit -m "feat: add transactional Forgeyard installer"
```

## Task 6: Add hash-aware update and operation-scoped rollback

**Files:**

- Create: `src/installer/update.ts`
- Create: `src/installer/rollback.ts`
- Test: `tests/integration/installer/update.test.ts`
- Test: `tests/integration/installer/rollback.test.ts`
- Modify: `src/installer/manifest.ts`
- Modify: `src/installer/apply.ts`

**Step 1: Write failing update tests**

Cover unchanged no-op, addition of a new managed file, replacement of an unchanged managed file, removal of an unchanged retired component, conflict on locally modified managed bytes, conflict on an unknown new destination, preservation of edited `forgeyard.yaml`, and complete recovery from injected update failure.

`planUpdate()` must compare three states: previous manifest, current filesystem, and newly resolved plan. A managed replacement/deletion is eligible only when current bytes still match the previous installed hash.

Run:

```powershell
npm test -- tests/integration/installer/update.test.ts
```

Expected: FAIL because update behavior does not exist.

**Step 2: Write failing rollback tests**

Cover rollback of an initial install, rollback of a replacement/addition/deletion update, unknown operation ID, already-rolled-back operation, user drift after the operation, missing backup, and injected rollback failure. Require rollback preflight to detect every drift before changing anything.

Initial-install rollback removes only unchanged managed files created by that operation, restores replaced/deleted managed files from verified backups, preserves `forgeyard.yaml`, preserves unrelated project files, and records its own completed journal.

Run:

```powershell
npm test -- tests/integration/installer/rollback.test.ts
```

Expected: FAIL because rollback behavior does not exist.

**Step 3: Implement update and rollback through the same transaction primitives**

Expose:

```ts
planUpdate(root: string, next: InstallPlan): Promise<UpdatePlan>
applyUpdate(plan: UpdatePlan, options: ApplyOptions): Promise<OperationResult>
planRollback(root: string, operationId: string): Promise<RollbackPlan>
applyRollback(plan: RollbackPlan, options: ApplyOptions): Promise<OperationResult>
```

Share preflight, backup, adjacent temporary write, journal, and recovery code with install. Verify backup hashes before restoring. Retain successful operation journals and backups until an explicit future pruning feature; M1 never guesses that history is disposable.

**Step 4: Verify lifecycle invariants**

Run:

```powershell
npm test -- tests/integration/installer
npm run typecheck
```

Expected: all lifecycle tests pass, including byte-for-byte restoration and config preservation.

**Step 5: Commit the task**

```powershell
git add src/installer tests/integration/installer
git commit -m "feat: support safe Forgeyard update and rollback"
```

## Task 7: Diagnose installed state and audit generated content

**Files:**

- Create: `src/doctor/content-audit.ts`
- Create: `src/doctor/run-doctor.ts`
- Test: `tests/unit/doctor/content-audit.test.ts`
- Test: `tests/integration/doctor/doctor.test.ts`
- Test: `tests/adversarial/content-audit.test.ts`

**Step 1: Write failing content-audit tests**

Expose a scanner that accepts roots plus caller-supplied deny terms. Test case-insensitive and Unicode-normalized matching, a term split by ordinary whitespace, binary-file exclusion, `.git`/`node_modules`/operation-backup exclusion, unresolved template tokens, unexpected remote asset URLs in generated presentation files, and deterministic path ordering.

Fixtures use only generic values such as `Example Sponsor`. Failure reports include the affected relative paths and rule ID but never echo the deny term or matching line. The scanner must not write a report unless its caller explicitly requests one.

Run:

```powershell
npm test -- tests/unit/doctor/content-audit.test.ts tests/adversarial/content-audit.test.ts
```

Expected: FAIL because content auditing does not exist.

**Step 2: Write failing doctor aggregation tests**

Require checks for:

- readable and schema-valid `forgeyard.yaml`, lock, and manifest;
- manifest/lock profile and adapter agreement;
- every managed payload file present with the installed hash;
- seed configuration present but allowed to differ from its creation hash;
- no unexpected file claimed by the manifest;
- structurally valid Codex instructions, skill frontmatter, reviewer TOML, and task YAML;
- adapter capability report with honest M1 states;
- generated-content audit;
- optional Codex executable discovery reported as `passed` or `unavailable`, never required for structural validation.

Test all four check statuses and require `ok = false` whenever a required check is not `passed`.

Run:

```powershell
npm test -- tests/integration/doctor/doctor.test.ts
```

Expected: FAIL because doctor aggregation does not exist.

**Step 3: Implement safe diagnostics**

Expose:

```ts
scanGeneratedContent(input: ContentAuditInput): Promise<readonly ContentFinding[]>
runDoctor(input: DoctorInput): Promise<DoctorReport>
```

Scan only known text extensions and manifest-owned payload plus explicitly requested source roots. Normalize text with NFKC for comparisons without rewriting it. Treat deny terms as secret-like inputs: keep them in memory, never serialize them, and phrase results generically.

Doctor reads state without repairing it. A malformed manifest does not trigger path traversal through its entries: validate syntax and portable paths before resolving any file. Sort checks and paths for stable JSON.

**Step 4: Verify diagnostic truthfulness**

Run:

```powershell
npm test -- tests/unit/doctor tests/integration/doctor tests/adversarial/content-audit.test.ts
npm run typecheck
```

Expected: all tests pass; a required failed check produces exit-contract-ready `ok: false`.

**Step 5: Commit the task**

```powershell
git add src/doctor tests/unit/doctor tests/integration/doctor tests/adversarial/content-audit.test.ts
git commit -m "feat: add Forgeyard doctor and content audit"
```

## Task 8: Run shell-free verification and issue revision-bound receipts

**Files:**

- Create: `schemas/task.schema.json`
- Create: `schemas/receipt.schema.json`
- Create: `src/evidence/receipts.ts`
- Create: `src/evidence/run-verification.ts`
- Test: `tests/unit/evidence/receipts.test.ts`
- Test: `tests/unit/evidence/run-verification.test.ts`
- Test: `tests/integration/evidence/git-verification.test.ts`
- Modify: `packs/foundation/templates/task.yaml.tpl`
- Modify: `fixtures/golden/codex-hackathon/.forgeyard/tasks/T001.yaml`

**Step 1: Write failing receipt and staleness tests**

Require schema-valid deterministic receipts, task SHA over the exact task file bytes, argv SHA over canonical JSON array bytes, UTC timestamps, non-negative duration, output hashes without output bodies, and staleness when Git HEAD, task bytes, or argv changes. A receipt remains current when only ignored evidence files are added.

Run:

```powershell
npm test -- tests/unit/evidence/receipts.test.ts
```

Expected: FAIL because receipt support does not exist.

**Step 2: Write failing command-boundary tests**

Inject `GitPort`, `CommandRunner`, `Clock`, and `IdGenerator`. Cover no Git repository, unborn HEAD, dirty tracked file, dirty untracked file, passing command, non-zero exit, missing executable, timeout/cancellation mapping, arguments containing spaces/metacharacters remaining literal, and proof that `shell: false` is always used.

For a failed command, persist a valid failed receipt before throwing `FY_COMMAND_FAILED`. Use exit 127 for executable-not-found, 124 for the fixed M1 15-minute timeout, and 130 for cancellation when no process exit code exists. Do not print or persist stdout/stderr; expose only hashes and byte counts to the caller.

Run:

```powershell
npm test -- tests/unit/evidence/run-verification.test.ts
```

Expected: FAIL because verification execution does not exist.

**Step 3: Implement task loading, Git preflight, execution, and receipts**

Expose:

```ts
loadTask(root: string, taskId: string): Promise<LoadedTask>
runVerification(input: VerificationInput, ports?: VerificationPorts): Promise<VerificationResult>
getReceiptStatus(root: string, receipt: VerificationReceipt): Promise<"current" | "stale">
```

Accept task IDs matching `^[A-Z][A-Z0-9_-]{1,31}$` and resolve only `.forgeyard/tasks/<id>.yaml`. Before command execution, use argument-vector Git calls to require a real `HEAD` and empty `git status --porcelain=v1 --untracked-files=all`. Run the task executable and arguments directly with Execa, explicit cwd, `shell: false`, normal inherited process environment without reading or serializing its values, no stdin, a fixed M1 timeout of 15 minutes, and a 1 MiB maximum per output stream. Hash output in memory, discard its content, and atomically write the receipt below `.forgeyard/evidence`.

The generated `.forgeyard/.gitignore` ignores `evidence/` and transient `state/staging/`, while committed tasks, lock, manifest, and completed operation metadata remain visible to Git.

**Step 4: Add one real local-Git integration test**

Create a temporary repository, configure identity only for the single commit via `git -c user.name=... -c user.email=... commit`, commit the generated task, execute a Node success command, change HEAD, and prove the previous receipt becomes stale. Skip only when Git itself is absent, reporting that skip distinctly; CI and the M1 release gate require this test to run.

**Step 5: Verify evidence semantics**

Run:

```powershell
npm test -- tests/unit/evidence tests/integration/evidence/git-verification.test.ts
npm run typecheck
```

Expected: all tests pass and the real-Git integration is reported as passed on the development host.

**Step 6: Commit the task**

```powershell
git add schemas/task.schema.json schemas/receipt.schema.json src/evidence packs/foundation/templates/task.yaml.tpl fixtures/golden/codex-hackathon/.forgeyard/tasks/T001.yaml tests/unit/evidence tests/integration/evidence
git commit -m "feat: bind verification evidence to Git revisions"
```

## Task 9: Generate the original offline presentation pack

**Files:**

- Create: `packs/presentation/pack.yaml`
- Create: `packs/presentation/skills/forgeyard-showcase/SKILL.md`
- Create: `packs/presentation/templates/presentation/index.html.tpl`
- Create: `packs/presentation/templates/presentation/styles.css`
- Create: `packs/presentation/templates/presentation/app.js`
- Create: `packs/presentation/templates/presentation/README.md.tpl`
- Create: `src/doctor/presentation-audit.ts`
- Create: `tests/unit/doctor/presentation-audit.test.ts`
- Create: `tests/golden/presentation-hackathon.test.ts`
- Create: `tests/adversarial/presentation-content.test.ts`
- Modify: `profiles/hackathon.yaml`
- Modify: `fixtures/golden/codex-hackathon/`
- Modify: `src/adapters/codex.ts`
- Modify: `src/doctor/run-doctor.ts`

**Step 1: Write failing presentation-contract tests**

Require a complete bundle with no external HTTP(S), protocol-relative, remote font, iframe, tracking, organization logo, inherited identity metadata, unrendered token, or inline network request. Require UTF-8, viewport metadata, semantic landmarks, one H1, unique section IDs, usable previous/next controls, ARIA live progress, keyboard bindings, pointer controls, print rules, reduced-motion handling, visible focus styles, and mobile/short-landscape media queries.

Test a deliberately contaminated generic fixture using `Example Sponsor`; do not add any private deny term to source or snapshots.

Run:

```powershell
npm test -- tests/unit/doctor/presentation-audit.test.ts tests/adversarial/presentation-content.test.ts
```

Expected: FAIL because the presentation bundle and audit do not exist.

**Step 2: Author the presentation workflow skill**

The original `forgeyard-showcase` skill instructs an agent to:

1. read project purpose, audience, timebox, task status, and current receipts;
2. replace generic skeleton copy with evidence-backed project-specific content;
3. use only original or license-recorded local assets;
4. preserve offline operation and accessibility;
5. create a live-demo path plus screenshot/recording fallback;
6. verify desktop and mobile layouts, keyboard and pointer navigation, console, and local network behavior;
7. produce a timed speaker script and likely-question checklist in `presentation/README.md`;
8. label claims that lack evidence instead of inventing results.

It is a presentation workflow, not a record of any prior event, organizer, team, participant, or visual identity.

**Step 3: Build a deliberate self-contained visual system**

Create a polished plain HTML/CSS/JavaScript deck with local system fonts, deep neutral background, high-contrast warm accent, restrained geometric decoration, responsive type via `clamp()`, and no dependency on a framework or service. Include these slide IDs in order:

```text
opening, problem, audience, insight, solution, demo, evidence, architecture, value, ask
```

Use project name, purpose, audience, duration, timebox, and quality-command summary from strict escaped variables. The skeleton must visibly mark project-specific proof slots as “Add verified evidence” rather than displaying invented metrics. Add keyboard support for arrows, Page Up/Down, Home/End, visible buttons for pointer users, URL hash restoration, a progress indicator, and print-to-PDF layout. JavaScript must work from `file://` without modules or fetch.

**Step 4: Register and render the pack**

Add `presentation` to the hackathon profile after `foundation`. Declare the showcase skill plus four presentation files as original Apache-2.0 components. The Codex adapter targets the skill at `.agents/skills/forgeyard-showcase/SKILL.md` and renders presentation content below the configured portable presentation directory.

Extend golden output with the exact five new files and assert byte stability across two renders.

**Step 5: Verify behavior and appearance**

Run deterministic checks:

```powershell
npm test -- tests/unit/doctor/presentation-audit.test.ts tests/golden/presentation-hackathon.test.ts tests/adversarial/presentation-content.test.ts
npm run typecheck
```

Then serve the rendered golden fixture from a temporary local server and inspect it with the available browser tooling at 1440x900 and 390x844. Exercise every navigation key and both pointer buttons, confirm no console errors or external requests, and save screenshots only as local verification evidence, not as source assets. If browser tooling is genuinely unavailable, record the host check as `unavailable`; it cannot be described as passed.

**Step 6: Commit the task**

```powershell
git add packs/presentation profiles/hackathon.yaml src/adapters/codex.ts src/doctor fixtures/golden/codex-hackathon tests/unit/doctor tests/golden tests/adversarial/presentation-content.test.ts
git commit -m "feat: add offline Forgeyard presentation pack"
```

## Task 10: Wire the five CLI commands and prove the complete round trip

**Files:**

- Create: `src/application/forgeyard.ts`
- Create: `tests/helpers/cli.ts`
- Create: `tests/roundtrip/cli.test.ts`
- Modify: `src/cli/program.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/config/wizard.ts`
- Modify: `src/installer/plan.ts`
- Modify: `src/doctor/run-doctor.ts`
- Modify: `src/evidence/run-verification.ts`

**Step 1: Write failing command-service tests**

Define `ForgeyardService` methods `init`, `doctor`, `verify`, `update`, and `rollback`. Inject it into `createProgram()` and assert every CLI option maps to the correct typed input, every service result has stable plain and JSON output, and every expected service error maps to the frozen exit table.

Require confirmation only when a write is planned and `--yes` is absent. A declined confirmation returns success with `applied: false`. JSON mode and non-interactive input never prompt. Dry run performs resolve, render, validation, preflight, and diff but does not create the target or `.forgeyard` directory.

Run:

```powershell
npm test -- tests/unit/cli/program.test.ts
```

Expected: FAIL because production service wiring is incomplete.

**Step 2: Implement one application orchestration boundary**

`src/application/forgeyard.ts` locates the packaged registry relative to `import.meta.url`, never the caller’s current directory. Implement command flows:

```text
init: answers/wizard -> config -> registry -> resolve -> adapter render
      -> install plan/diff -> confirm -> apply -> doctor -> result

doctor: load installed state -> run structural/ownership/content checks -> result

verify: load installed task -> require clean Git HEAD -> execute argv -> receipt -> result

update: load human config/current manifest -> resolve packaged registry -> render
        -> update plan/diff -> confirm -> apply -> doctor -> result

rollback: load operation -> rollback preflight/diff -> confirm -> reverse transaction -> result
```

If post-write doctor fails, automatically reverse the just-completed operation, retain both journals, and return `FY_DOCTOR_FAILED` with a statement that recovery completed. If recovery fails, return `FY_TRANSACTION_FAILED` with only the affected paths. An init/update success response includes operation ID, created/updated/removed path lists, and doctor summary; it does not include file bodies.

`--deny-term` is repeatable and passed only in memory to doctor. Neither plain nor JSON output may include supplied deny values.

**Step 3: Write the failing built-CLI round-trip**

`tests/roundtrip/cli.test.ts` builds once, then uses an argument-array process helper against `dist/cli/main.js` and a newly created temporary directory. The test must:

1. run `init --dry-run --json` and prove the target remains empty;
2. run applied init from `fixtures/answers/hackathon.yaml` and verify the exact expected tree;
3. run doctor in plain and JSON modes;
4. initialize Git and create one commit using command-local identity flags only;
5. run `verify T001 --json` with a harmless Node argv configured by the fixture;
6. verify the receipt is current and contains no captured command output;
7. run update dry-run and applied update as deterministic no-ops;
8. run a doctor failure with a generic deny term and prove the term is absent from output;
9. roll back the initial install and prove managed files are removed while `forgeyard.yaml` and an unrelated sentinel file remain.

Run:

```powershell
npm run build
npm test -- tests/roundtrip/cli.test.ts
```

Expected: FAIL until all service methods are connected.

**Step 4: Complete wiring and output formatting**

Implement the smallest production glue needed for the round trip. Keep domain functions independent of Commander and process globals. Plain output uses concise action/result lines; JSON output uses versioned result objects. Do not add banners, analytics, update checks, or network calls.

**Step 5: Verify the complete M1 behavior**

Run:

```powershell
npm test -- tests/unit/cli/program.test.ts tests/roundtrip/cli.test.ts
npm run typecheck
npm run build
node .\dist\cli\main.js --help
```

Expected: round trip passes, all five commands appear in help, and no test modifies global Git configuration.

**Step 6: Commit the task**

```powershell
git add src/application src/cli src/config/wizard.ts src/installer/plan.ts src/doctor/run-doctor.ts src/evidence/run-verification.ts tests/helpers tests/roundtrip tests/unit/cli/program.test.ts
git commit -m "feat: complete Forgeyard M1 command workflow"
```

## Task 11: Add provenance, public documentation, and release gates

**Files:**

- Create: `src/provenance/generate-notices.ts`
- Create: `src/provenance/generate-sbom.ts`
- Create: `src/provenance/validate.ts`
- Create: `scripts/generate-provenance.ts`
- Create: `scripts/release-audit.ts`
- Create: `tests/unit/provenance/validate.test.ts`
- Create: `tests/integration/provenance/generated-files.test.ts`
- Create: `tests/integration/package/package-contents.test.ts`
- Create: `AGENTS.md`
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `SBOM.spdx.json`
- Modify: `package.json`
- Modify: `sources/catalog.yaml`

**Step 1: Write failing provenance tests**

Require every direct dependency and development dependency in `package.json` to have exactly one catalog record with matching version, HTTPS source URL, license, provenance mode, retrieval date, and notes. Reject missing/unknown license metadata, unpinned direct versions, duplicate source identity, a non-original component without a source record, and a source record not referenced by either a package or component.

Require notice generation to be alphabetically deterministic and SPDX generation to represent the root package plus the complete locked npm graph, package versions, integrity/resolved references where present, declared licenses, and dependency relationships. Read installed package metadata only to enrich locked records; never let it override lock versions.

Run:

```powershell
npm test -- tests/unit/provenance/validate.test.ts tests/integration/provenance/generated-files.test.ts
```

Expected: FAIL because provenance generators and public files do not exist.

**Step 2: Implement deterministic provenance generation**

Expose pure renderers returning strings and a thin script that writes only `THIRD_PARTY_NOTICES.md` and `SBOM.spdx.json`. `npm run provenance:generate` updates them; `npm run provenance:check` renders in memory and fails on any tracked-byte difference. Use SPDX 2.3 JSON, stable package SPDX IDs, sorted relationships, and `NOASSERTION` only for fields SPDX permits to be genuinely unavailable—not as a substitute for missing license validation.

Forgeyard-authored pack bodies remain `original`; no prompt, skill, agent, template, or visual asset is copied from a reference-only source. Apache-2.0 headers are not required in every small data file, but root license and notices cover original distributed content.

**Step 3: Write failing package-content tests**

Run `npm pack --dry-run --json` through an argument-array helper and assert the tarball allow-list contains only built runtime files, schemas, profiles, packs, sources, README, license, notice, third-party notices, SBOM, and package metadata. Explicitly exclude source, tests, fixtures, plans, local evidence, operation state, coverage, screenshots, and forensic inputs.

Run:

```powershell
npm test -- tests/integration/package/package-contents.test.ts
```

Expected: FAIL until the publish manifest is complete.

**Step 4: Write honest public documentation**

`README.md` starts with the working M1 command and explains:

- Forgeyard installs a project-scoped workflow; it is not an LLM runtime;
- the hackathon profile prioritizes a visible slice, verification, and presentation;
- installed catalog size is not prompt size because skills load on demand;
- role definitions are not simultaneously running workers, and M1 defaults to bounded concurrency 4;
- M1 supports Codex only and emulates task/evidence execution locally;
- exact init, dry-run, doctor, verify, update, rollback, and uninstall-by-rollback examples;
- file ownership, local customization, conflict behavior, privacy, and offline presentation behavior;
- license/provenance policy and a link to the architecture spec in the source repository.

`SECURITY.md` documents traversal/link/collision threats, command execution boundaries, prompt permissions versus OS isolation, secret handling, supported disclosure contact mechanism, and explicitly unsupported automatic external effects. `CONTRIBUTING.md` requires tests, provenance records, original or license-compatible content, golden review, and no identity-bearing event assets. `AGENTS.md` mirrors those repository-local rules concisely. `CHANGELOG.md` describes only behavior proved in M1.

Use the unmodified Apache License 2.0 text in `LICENSE`. `NOTICE` names only Forgeyard and the applicable year; dependency notices belong in generated third-party notices.

**Step 5: Implement a non-leaking release audit**

`scripts/release-audit.ts` scans repository text while excluding `.git`, `node_modules`, coverage, build output, and recorded binary screenshots. It accepts deny terms only by environment-variable name, reads values into memory, and never prints or serializes them. It reports a generic rule ID and relative paths. It also detects unfinished placeholder prose, unresolved template tokens outside intentional source templates, accidentally committed evidence/output logs, remote presentation assets, and identity-bearing metadata fields in distributed presentation content.

Add `audit:release`, `provenance:generate`, and `provenance:check` scripts. The ordinary `verify` script runs type-check, all deterministic and real-Git tests, build, provenance check, and package-content check. The private deny-term audit is a separate release gate because its value is intentionally absent from the repository.

**Step 6: Generate and inspect public artifacts**

Run:

```powershell
npm run provenance:generate
npm run provenance:check
npm test -- tests/unit/provenance tests/integration/provenance tests/integration/package
npm run pack:check
```

Expected: generated provenance is stable, catalog/package versions agree, and the package-content test passes.

Inspect `npm pack --dry-run --json` manually and confirm no source-only audit material is publishable.

**Step 7: Run the private brand-neutrality gate ephemerally**

Set `FORGEYARD_PRIVATE_DENY_TERM` only in the current process environment, then run:

```powershell
if ([string]::IsNullOrWhiteSpace($env:FORGEYARD_PRIVATE_DENY_TERM)) { throw "Private deny term is not set" }
npm run audit:release -- --deny-term-env FORGEYARD_PRIVATE_DENY_TERM
```

Expected: exit 0, no matches, and neither console output nor generated files contain the supplied value. Clear the process variable after the command. Never add the value to a script, test, shell profile, config file, commit message, or documentation.

**Step 8: Run the complete release gate**

From a clean dependency install:

```powershell
npm ci
npm run verify
git diff --check
git status --short
```

Expected: all required checks pass, provenance files remain unchanged, package dry-run contains only allow-listed files, `git diff --check` is silent, and status shows only the intentional Task 11 files before commit.

**Step 9: Commit the task**

```powershell
git add AGENTS.md README.md CONTRIBUTING.md SECURITY.md CHANGELOG.md LICENSE NOTICE THIRD_PARTY_NOTICES.md SBOM.spdx.json package.json package-lock.json sources src/provenance scripts tests/unit/provenance tests/integration/provenance tests/integration/package
git commit -m "docs: prepare Forgeyard M1 public release"
```

## Final acceptance matrix

| Requirement | Proof |
|---|---|
| `init --profile hackathon --adapter codex` | Built-CLI round-trip creates exact golden tree |
| Plan before mutation | Dry-run returns the same resolved diff and writes zero bytes |
| Project-scoped install | Path/adversarial tests and manifest targets stay below selected root |
| Codex-native artifacts | Golden AGENTS, two on-demand skills, and reviewer agent pass structural checks |
| Context restraint | AGENTS stays navigational; detailed workflows live in on-demand skills |
| Bounded concurrency | Config defaults to 4; M1 does not launch worker processes |
| Transactional ownership | Unknown/drifted files conflict; injected failures restore preimages |
| Update and rollback | Integration lifecycle tests cover add/change/remove and seed preservation |
| Truthful doctor | Required failures cannot be skipped; absent optional host is unavailable |
| Evidence integrity | Real-Git test binds task/argv/HEAD and detects staleness |
| Presentation quality | Original offline responsive bundle passes deterministic and host visual checks |
| Brand neutrality | Generic adversarial tests plus ephemeral private release scan pass |
| Provenance | Catalog validation, deterministic notices, and full locked-graph SPDX pass |
| Public package hygiene | Pack dry-run matches the explicit allow-list |
| No false portability | README/capability matrix state that M1 supports Codex only |

## Execution discipline

For every task:

1. confirm the worktree contains no unexpected user changes;
2. write the named failing test and observe the expected failure;
3. implement only the behavior required by that test set;
4. run the task-specific checks, then type-check;
5. review the diff for path safety, secrets, provenance, generated identity, and scope creep;
6. commit with the exact task commit message;
7. report the commit and verification result before starting the next task.

Do not hide test skips, rewrite unrelated files, amend user commits, or combine tasks into one opaque commit. If an existing file overlaps unexpectedly, stop that task and report the exact conflict. Delegated agents may be used only after the user explicitly chooses delegated execution; otherwise execute inline in this task.
