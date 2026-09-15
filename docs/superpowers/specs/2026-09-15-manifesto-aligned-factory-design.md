# Manifesto-Aligned Forgeyard Factory

## Status

Approved for implementation by the product owner on 2026-09-15 through the instruction to correct the audited gaps without further confirmation gates.

This design supersedes any earlier claim that the local factory is complete. The existing installer, evidence, scheduler, worktree, provenance, and rollback kernel remains the trusted foundation; this work adds the missing project-intake, decision, composition, and host-control layers.

## Product boundary

Forgeyard prepares and governs a project-scoped agentic development environment. It does not implement a model, own provider credentials, bypass host permissions, or silently create paid model calls. A supported host executes work through its native agent facilities; Forgeyard provides the selected capability definitions, project-specific work orders, safety policy, evidence gates, and persistent state.

The ordinary entry point is the project problem:

```text
repository + brief/specification + material constraints
  -> bounded inspection
  -> evidence-backed project facts
  -> minimal coherent composition
  -> stable project-local suite and decision report
  -> host-executed work orders
  -> revision-bound verification and delivery state
```

`forgeyard init` remains an advanced manual installer. `forgeyard prepare` becomes the recommended interface and does not ask the user to choose profiles, plugins, or orchestration frameworks.

## Design principles

1. Local deterministic evidence is preferred over guesses.
2. Inferences carry a confidence and the paths that support them.
3. Product ambiguity is surfaced; ecosystem choice is handled internally.
4. Forgeyard is the only primary workflow authority in an automatically composed suite.
5. Selected components are minimal, licensed, pinned, and reproducible.
6. Generated suites remain stable until an explicit reconfiguration or update.
7. Host execution is capability-aware and never claims unsupported parity.
8. No preparation step executes vendored code, makes network calls, or launches paid workers.

## Subsystems

### 1. Bounded project inspector

The inspector reads only explicitly supplied specification files and a bounded set of project metadata. It ignores `.git`, dependency trees, build output, generated coverage, credentials, and arbitrary source bodies.

It recognizes:

- project mode from the presence of project files;
- languages and package managers from well-known manifests;
- frontend, backend, full-stack, mobile, data, infrastructure, library, CLI, and unknown project classes;
- common frameworks from manifest dependency names;
- repository-native quality commands from package scripts and ecosystem manifests;
- existing instruction surfaces such as `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules`;
- safe mutable roots from existing conventional directories;
- a project name and purpose from explicit input, specifications, or README evidence.

The scan has deterministic size limits. An unreadable, escaping, symbolic-link, binary, or oversized specification is rejected with a path-only diagnostic.

### 2. Curated capability knowledge

An authored `sources/capabilities.yaml` maps supported project facts to catalog plugins. Each rule includes the capability it serves, eligible project kinds or framework signals, a human-readable reason, and explicit conflicts where relevant.

The automatic baseline contains only cross-cutting delivery capabilities. Domain capabilities are added by observed need. Alternative orchestration plugins are excluded from automatic compositions because `forgeyard-workflow` is the primary authority. The `full` profile remains available only as an explicit advanced/debugging choice.

The rule file is validated and all referenced plugins must exist in the pinned catalog.

### 3. Explainable composer

The composer consumes project facts and constraints and returns a deterministic `PreparationDecision`:

- selected adapter and the evidence or fallback behind it;
- `tailored` profile and exact pack list;
- selected catalog plugins with reasons;
- material exclusions with reasons;
- inferred quality commands and mutable/protected paths;
- presentation inclusion only when requested or supported by explicit brief evidence;
- recommended orchestration mode and concurrency;
- autonomy and budget policy;
- uncertainties that require product clarification before execution.

Ordering is stable. The same facts and options produce byte-identical output.

### 4. Stable prepared configuration

`ForgeyardConfig` gains three normalized sections while retaining schema version 1 compatibility:

- `intake`: request, source paths, project kind, detected languages/frameworks, evidence, confidence, and unresolved questions;
- `composition`: `automatic` or `manual`, exact pack IDs, selected-plugin reasons, exclusions, and an analysis fingerprint;
- `autonomy`: `supervised`, `balanced`, or `autonomous`, optional total USD budget, and fixed stop/authorization policy.

Older configuration files receive conservative manual defaults in memory. `forgeyard update` reproduces the stored selection; it never silently re-runs inspection. A future explicit `forgeyard reconfigure` may create a reviewed new decision.

`forgeyard.lock` continues to pin the factory, profile, packs, components, and hashes. It also records the analysis fingerprint.

### 5. Project-specific generated environment

Every adapter renders the same canonical intent into its native layout. In addition to existing files, prepared projects receive `.forgeyard/COMPOSITION.md`, which records:

- observed facts and evidence paths;
- selected primary workflow, adapter, packs, and capabilities;
- exclusions and uncertainty;
- autonomy, concurrency, time, and cost limits;
- the distinction between installed roles and running workers.

`PROJECT.md` is pre-populated with the actual request, detected context, specification sources, and acceptance framing rather than an empty generic prompt.

Existing host instructions are authoritative user content. When automatic preparation detects an unknown root `AGENTS.md` or `CLAUDE.md` that Forgeyard does not own, it preserves that file and renders Forgeyard's navigation contract to `.forgeyard/HOST.md` instead. The namespaced native workflow skill remains the activation surface. Forgeyard never appends an opaque block to, replaces, or takes ownership of existing instructions. Cursor's namespaced rule paths follow the same non-overwrite rule.

Task wording derives from the request and project class. A focused maintenance suite may contain one implementation task plus review. A delivery suite contains contract, implementation, and independent review. The optional presentation task exists only when presentation is selected. All tasks retain exact argv, scope, retry, time, evidence, and integration contracts.

### 6. Host-control protocol

The generated `forgeyard-workflow` skill is the ordinary natural-language controller. A request such as “implement this feature” causes a compatible host to:

1. inspect current Forgeyard state;
2. stop if unresolved product questions are recorded;
3. request dependency-ready work orders;
4. claim work before dispatch;
5. select installed capabilities from the work order rather than asking the user;
6. use native host subagents when supported, bounded by available slots;
7. record checkpoints and any observable usage;
8. verify and integrate exact revisions;
9. clean integrated worktrees and report evidence-backed state.

The CLI exposes work orders for hosts but does not pretend that a role file is a process. `guided` mode returns one recommended work order. `native` mode returns up to the remaining concurrency capacity. This makes `orchestration.mode` operational without silently launching paid clients.

Each work order contains task ID, title, objective, role, capabilities, paths, remaining time, remaining recorded cost when measurable, and an exact host prompt.

### 7. Governable autonomy and cost

Automatic preparation recommends:

- concurrency 1 for focused maintenance;
- concurrency 2 for a single-domain delivery;
- concurrency 3 for full-stack or multi-domain delivery;
- concurrency 4 only when presentation/review work creates genuinely independent stages.

The supported range remains 1–16 and explicit user constraints win. Subscription tier is never inferred from price or account type.

When a USD budget exists, it is divided across generated tasks and enforced against explicit usage ledger observations before new work is claimed and before completion. When a host cannot expose cost, Forgeyard reports the budget as unmeasured rather than treating it as zero.

Time, retry, repeated-failure, scope-conflict, stale-evidence, ambiguity, and authorization stops remain deterministic.

## CLI contract

### Read-only inspection

```sh
forgeyard inspect [target] [--brief <text>] [--spec <path>...] [--adapter <id>] [--json]
```

Returns facts, evidence, uncertainties, and the proposed composition without writing.

### Normal preparation

```sh
forgeyard prepare [target] [--brief <text>] [--spec <path>...] [--adapter <id>]
  [--timebox <minutes>] [--max-concurrency <count>] [--budget-usd <amount>]
  [--autonomy supervised|balanced|autonomous] [--presentation|--no-presentation]
  [--dry-run] [--yes] [--json]
```

If no explicit purpose can be inferred, interactive mode asks one product question. Non-interactive mode fails with a precise request for `--brief` or `--spec`. It never asks for a profile or plugin list.

### Host work orders

```sh
forgeyard task next --root . --json
```

The result includes ordered work orders governed by orchestration mode and remaining capacity. Existing lifecycle commands remain stable advanced interfaces.

## Pack structure change

The demo task moves from the delivery pack to the presentation pack. This makes presentation genuinely optional while retaining the same four-task graph for existing `hackathon` and `full` profiles.

The new `tailored` profile supplies defaults only; its exact pack and plugin selection comes from the stored automatic composition.

## Error handling and safety

- All paths are portable and project-confined.
- Inspection never follows symbolic links or reads secret-value files.
- Diagnostics expose paths and categories, not file contents.
- Unknown stacks produce conservative generic choices and explicit uncertainty.
- Conflicting existing harness instructions are reported and never overwritten without normal ownership checks.
- Existing root host instructions are preserved; automatic preparation uses `.forgeyard/HOST.md` plus the native workflow skill instead of claiming ownership.
- Automatic compositions never include competing workflow orchestrators.
- Preparation is transactional and receives the same post-write doctor and rollback behavior as initialization.
- No command string is passed through a shell; verification remains argv-based.

## Compatibility

- Existing `minimal`, `hackathon`, and `full` configs remain valid.
- Existing generated projects update reproducibly from their stored manual selection.
- `init` remains available and clearly labeled advanced/manual.
- Existing task and workspace commands retain their syntax.
- Adapter capability limitations remain explicit.

## Test strategy

Tests use real temporary repositories and no network or model calls.

1. Inspector unit tests cover Node frontend, Python backend, mixed full-stack, blank project, hostile paths, bounded reads, and quality command inference.
2. Composer unit tests cover minimal selection, framework-specific selection, orchestration exclusion, presentation opt-in, adapter evidence, deterministic ordering, and concurrency overrides.
3. Configuration and schema tests cover backward-compatible defaults and stable serialization.
4. Resolver tests cover tailored pack overrides and rejected missing/conflicting packs.
5. Adapter golden tests verify composition reports, project-specific briefs/tasks, and optional presentation.
6. Scheduler tests prove guided/native work-order cardinality and recorded-cost stops.
7. Application and CLI tests prove inspect is read-only, prepare is transactional, no ecosystem questions are asked, and update does not silently re-inspect.
8. Round-trip fixtures cover an existing frontend change, a backend service, and a blank project through preparation, interruption, verification, review, and cleanup.
9. The complete release gate continues to validate provenance, package contents, deny terms, catalog bytes, and dependency health.

## Milestone decomposition

### Milestone A: Understand and decide

Deliver inspector, capability rules, composer, `inspect`, `prepare`, tailored configuration, and composition report. This is the first usable vertical slice because it removes the ecosystem-choice burden.

### Milestone B: Tailor and govern

Deliver project-specific task rendering, optional presentation, meaningful orchestration mode, work orders, and budget enforcement.

### Milestone C: Prove ordinary use

Strengthen the generated controller skill and add deterministic end-to-end fixtures showing that a host can act from a product request without the user sequencing lifecycle commands. Real authenticated client execution remains separately labeled evidence and is never inferred from structural tests.

## Acceptance criteria

The implementation is complete when all of the following are true:

1. A user can prepare an existing frontend, backend, or blank project without choosing a profile or plugin.
2. Inspection reads the repository before any question and every inferred fact cites local evidence.
3. Selected and excluded components have human-readable reasons.
4. Automatic suites contain one primary workflow and no competing orchestration plugin.
5. The selected plugin set differs materially between frontend and backend fixtures.
6. Quality commands and mutable roots are inferred when evidence exists and uncertainty is explicit otherwise.
7. `PROJECT.md`, tasks, and work orders contain the actual request rather than a generic placeholder.
8. `guided` and `native` modes produce different bounded work-order sets.
9. Recorded usage can block further claims at the configured task budget.
10. Presentation files and the demo task are absent when presentation is not selected.
11. Existing manual configs and lifecycle operations continue to pass.
12. Update uses the stored stable decision and never silently changes the suite after repository drift.
13. The README leads with problem-first preparation and treats manual profiles as an advanced interface.
14. Documentation no longer calls unimplemented project intake or worker launch complete.
15. `npm run verify`, `npm run audit:release`, `git diff --check`, and package inspection pass from the final tree.
16. Preparing a repository with existing host instructions preserves their bytes and installs Forgeyard through a non-conflicting namespaced surface.
