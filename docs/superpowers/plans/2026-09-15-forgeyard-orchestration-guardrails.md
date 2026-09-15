# Forgeyard orchestration and guardrails implementation plan

**Goal:** Turn the installed role catalog into an executable, resumable development system with a validated task DAG, bounded claims, persistent checkpoints, deterministic write scopes, revision-bound completion, local run accounting, and safe Git worktree isolation.

**Architecture:** Keep task definitions immutable and human-readable under `.forgeyard/tasks/`. Store runtime state separately under `.forgeyard/state/`, serialize every transition through an atomic lock, and append secret-free events to a JSONL ledger. The scheduler is host-neutral: workers claim ready tasks through the CLI, while adapters expose native project instructions. Claude Code additionally receives a project-scoped `PreToolUse` hook for deterministic file-tool checks; Codex and Cursor receive the same guard as an explicit CLI contract without overstating native hook support.

**Safety boundary:** Forgeyard coordinates tasks and workspaces; it does not silently start paid model processes, push branches, deploy, or merge unresolved changes. Shell commands stay argv-based. Parallel write work requires non-overlapping scopes or isolated worktrees. Generated hooks fail closed when task identity is ambiguous.

## Task 1: Define and validate the workflow graph

- [x] Extend task schema and contracts with objective, acceptance criteria, dependencies, write scopes, role, capabilities, limits, evidence policy, and integration metadata while retaining verification compatibility.
- [x] Load all task files deterministically and reject missing dependencies, cycles, duplicate IDs, invalid paths, protected-scope overlap, and definition drift.
- [x] Compute a canonical graph hash and dependency-ready task set.
- [x] Cover valid, cyclic, missing-dependency, path-escape, case-collision, and legacy verification fixtures with unit tests.
- [x] Commit as `feat: validate executable Forgeyard task graphs`.

## Task 2: Persist resumable scheduling state

- [x] Add an atomic state store and cross-process lock below `.forgeyard/state/`.
- [x] Implement status, next, claim, checkpoint, resume, complete, fail, and cancel transitions.
- [x] Enforce dependency readiness, maximum concurrency, worker ownership, retry and repeated-failure stops, definition hashes, and active write-scope conflicts.
- [x] Require current successful verification evidence before completing a task whose evidence policy is required.
- [x] Prove interruption/resume and concurrent-claim behavior with integration tests.
- [x] Commit as `feat: add resumable bounded task scheduling`.

## Task 3: Expose task and ledger commands

- [x] Add machine-readable and human-readable `forgeyard task` subcommands.
- [x] Append transition timing and optional provider/model/token/cost observations to a secret-free local JSONL ledger.
- [x] Add stable error codes and remediation for graph, state, scope, budget, and completion failures.
- [x] Add built-CLI round trips that claim, checkpoint, resume, verify, complete, and reload state in a fresh process.
- [x] Commit as `feat: expose Forgeyard task orchestration commands`.

## Task 4: Install deterministic write guards

- [x] Implement a reusable path-decision engine for task mutable scopes and project protected paths.
- [x] Add `forgeyard guard` for explicit checks in every adapter.
- [x] Generate a dependency-free Claude Code `PreToolUse` hook for `Write`, `Edit`, and `NotebookEdit`, bound to the claimed task through state or `FORGEYARD_TASK_ID`.
- [x] Deny ambiguous identity, missing paths, project escape, protected paths, and out-of-scope writes before the file tool runs.
- [x] Report shell mutation coverage and unsupported host hooks honestly.
- [x] Commit as `feat: enforce project write scopes before file tools`.

## Task 5: Add isolated Git workspaces and serialized integration

- [x] Add a Git-port worktree service with deterministic task branch and directory names.
- [x] Create worktrees only for claimed tasks, bind the base revision, and keep workspace metadata in scheduler state.
- [x] Validate the task branch independently and allow integration only in dependency order from a clean target branch.
- [x] Stop on conflicts or incompatible target revisions; never push or discard user changes.
- [x] Cover create, reuse, dirty target, stale base, failed validation, and successful integration with mocked and real local Git tests.
- [x] Commit as `feat: isolate parallel tasks in Git worktrees`.

## Task 6: Install memory, decision, report, and demo workflow assets

- [x] Add project-local knowledge, decision, handoff, usage, and run-report templates without credentials or private transcripts.
- [x] Upgrade the initial task and workflow instructions into a visible-slice DAG workflow shared by all three adapters.
- [x] Add a five-hour simulation fixture that resumes after interruption, invalidates stale evidence after a code change, and produces the offline presentation bundle.
- [x] Document exact guarantees, limitations, and operator commands.
- [x] Commit as `feat: complete the resumable delivery workflow`.

## Task 7: Close the factory acceptance gate

- [ ] Run clean install, typecheck, all deterministic tests, all built-CLI round trips, catalog attestation, provenance, release audit, package audit, dependency audit, deny-term scan, and `git diff --check`.
- [ ] Record separately the authored implementation lines and immutable vendored catalog lines.
- [ ] Update architecture, changelog, capability matrix, and expansion status only for behavior proven by the gate.
- [ ] Commit as `docs: close the Forgeyard orchestration milestone`.

## Completion boundary

This plan closes the local, project-scoped factory contract. Real authenticated model-client runs remain optional host evidence; Forgeyard must report them as unverified unless they are actually exercised.
