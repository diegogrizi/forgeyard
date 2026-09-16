# Native-first Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> for inline execution, with bounded independent implementation/review where
> applicable skills require it. Steps use checkbox syntax for tracking.

**Goal:** Prepare and reuse a project-specific harness through the user's native
coding agent, with enforceable evidence-backed delivery instead of prompt-only
coordination.

**Architecture:** Extend the existing installer with a frozen capsule; add a
root-bound SQLite project service and a single strict dispatcher behind MCP and
JSON CLI. Structured project needs feed a deterministic capability resolver;
native agents remain responsible for interpretation and coding.

**Tech Stack:** Node `>=24.19.0 <25`, TypeScript ESM, npm, existing Ajv/YAML,
Node SQLite, pinned official MCP TypeScript SDK.

**Spec:** `docs/superpowers/specs/2026-09-16-native-factory-design.md`

## Global Constraints

- English repository content; Node `>=24.19.0 <25`, TypeScript ESM, npm.
- No LLM SDK, API calls, credentials, billing configuration, telemetry, or
  coding-agent subprocesses. Local MCP uses stdio, not a listening service.
- No executing vendored hooks/scripts during inspection or installation.
- Default maximum active work items remains four; AI-session concurrency is
  owned by the native client, not promised by Forgeyard.
- Gates are finite approved commands, never arbitrary argv in a tool call.
- A cooperative lease is not OS isolation against another same-user process.
- Live client support is unverified until an actual client/version/OS test.

## Task 1: Evidence-backed preparation and constrained needs

**Files:** `src/intake/{contracts,inspect,semantic,capabilities}.ts`,
`tests/unit/intake/{semantic,capabilities,inspect}.test.ts`.

**Interfaces:** `validateProjectNeeds(inspection, proposal)` produces a normalized
need profile; `resolveCapabilities(requirements, candidates, constraints)`
produces stable selections and reasoned exclusions. Existing `inspectProject`
remains compatible and gains bounded scan/evidence metadata.

- [ ] Write/run RED cases for stale/nonexistent evidence, equivalent structured
  maintenance intent, Spring/wrapper inspection, conflicts, dependencies,
  unlicensed/revoked records, one coordinator and resolution limits.

```ts
expect(resolveCapabilities(["method.coordinate", "domain.react"], records,
  { client: "codex", maxStates: 10000 })).toMatchObject({ selected: ["method", "react"] });
```

- [ ] Implement validators and bounded deterministic search. Preserve exclusion
  of secrets/dependencies/build/symlinks and do not execute discovered scripts.
- [ ] Run targeted intake suites with one Vitest worker; inspect changed code.

## Task 2: Frozen capsule and complete legacy verification

**Files:** `src/capsule/*.ts`, `src/installer/plan.ts`,
`src/evidence/*.ts`, relevant core/schema task contracts and adapter rendering;
`tests/unit/capsule/*.test.ts`, `tests/integration/evidence/*.test.ts`.

**Interfaces:** `compileCapsule(config, renderedFiles, provenance)` creates
canonical payload/ID; `readCapsule(root)` verifies the frozen harness. Commands
remain legacy-compatible, but a task may reference multiple required gates.

- [ ] Write/run RED cases: same input stable ID, changed gate changes ID,
  evolving product artifact does not change ID, drift rejection, second
  configured command fails even when the first succeeds.

```ts
expect(compileCapsule(config, files).id).toBe(compileCapsule(config, files).id);
await expect(runVerification(input, portsWithSecondGateFailure)).rejects.toThrow();
```

- [ ] Implement canonical inventory and integrity checks without lock self-hash.
  Wire capsule files into the existing transactional install plan.
- [ ] Run capsule/evidence/adapters/install regression suites.

## Task 3: Atomic root-bound project runs, evidence and operations

**Files:** `src/native/{contracts,store,workspace,runs,gates,context}.ts`,
`tests/integration/native/*.test.ts`.

**Interfaces:** `createProjectService({root,stateDirectory})` returns operations
for a single authorized real working tree. Every mutation takes request ID and
expected revision. Persist state/events/idempotency in one SQLite transaction.

- [ ] Write/run RED cases for competing writers, stale revision, duplicate
  effects, fake consent, cyclic plans, out-of-scope edits, unknown cost, pause
  and uncertain crash recovery.
- [ ] Implement finite gate handles with approved gate IDs, reduced environment,
  bounded output/timeout and no native-agent process control.
- [ ] Write/run RED cases for zero-test rejection, post-run drift, uncovered
  criteria, missing/false independent review, and a real verified delivery.

```ts
expect(await service.finalize(request)).toMatchObject({ verdict: "blocked" });
```

- [ ] Implement evidence-derived finalization and bounded context/report
  generation. New plans reuse the same capsule; no transcript storage.
- [ ] Run real Git/process integration tests, reopen DB and reconcile uncertain
  operations; verify no effect replay or blind lease takeover.

## Task 4: Shared MCP/JSON tools, native projections and acceptance

**Files:** `src/native/{dispatch,mcp,bindings}.ts`, CLI registration,
`packs/foundation/skills/forgeyard-workflow/SKILL.md.tpl`, guides/README,
`tests/roundtrip/native-*.test.ts`, compatibility matrix and dossier gap map.

**Interfaces:** JSON envelope `{protocolVersion,requestId,tool,payload}` dispatches
to the same service from `forgeyard tool` and `forgeyard mcp`. Root/approval/argv
cannot be injected in payload. MCP initialization instructions are concise.

- [ ] Write/run RED transport cases for unknown tools, extra fields, free argv,
  shared revision/idempotency behavior and stdout protocol purity.
- [ ] Pressure-test the existing workflow before editing; update one canonical
  workflow and repeat independent exercises with the changed instructions.
- [ ] Install ownership-scoped native entry points/config examples; preserve
  original instructions and foreign MCP namespaces. Refuse collisions/drift.
- [ ] Test native onboarding/context/new-feature/finalization through a real
  SDK MCP client without invoking a provider.
- [ ] Update English user guides, explicit support matrix and v0.2 traceability;
  regenerate provenance/notices/SBOM if dependencies change.
- [ ] Run `npm run verify`, `npm run audit:release`, `git diff --check`, inspect
  `npm pack --dry-run --json`, and review the complete change on `main`.

## Verified local checkpoint, 2026-09-16

- Fresh npm run verify exited 0: 70 files, 417 passing tests, build,
  catalog, provenance, release audit and package dry-run.
- Separate package inspection: 1,207 entries, 2,356,090 packed bytes; four
  public guides, no source/tests/forensic docs/private SQLite/auth inputs.
- Catalog remains byte-verified: 1,007 files, 211,594 physical lines.
- Git diff --check passed. One registered checkout on main; local uncommitted
  changes only. No push, publication, deployment or paid/live client invocation.
- Real Git/process regression coverage includes linked plans, exact installation
  consent/reservation/retries, finite gates, zero/inactive tests, stale evidence,
  review provenance, pause/resume, installation/idle-writer/disconnect recovery,
  native Claude guard and its internal-junction bypass correction.
- Independent bounded reviews and RED/GREEN regressions preceded corrections.
  Official SDK transport and built JSON CLI pass; real delivery through the
  shared service is not a live native-application delivery test.
- Orphan-operation human recovery and production click UI still need dedicated
  real-process/human acceptance. Remaining dossier scope is explicit in
  docs/guides/native-factory.md, not implicitly marked complete by the test count.

## Checkpoint policy

Continue the approved local work without extra user confirmations. Report
progress in plain Italian. Do not publish, call paid coding clients or claim
the four real client surfaces passed without performing those separate tests.
