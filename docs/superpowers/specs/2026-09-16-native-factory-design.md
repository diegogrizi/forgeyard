# Native-first Forgeyard design

## Decision

Implement the approved v0.2 direction in the existing factory, on `main` as
requested. Keep the pinned, licensed catalog and transactional installer. Do
not build a demonstration application, an AI chat, or a provider launcher.
The user's native coding agent interprets the problem; Forgeyard validates
structured proposals and governs its own operations.

## Boundaries

- English repository content; Node `>=24.19.0 <25`, TypeScript ESM, npm.
- No LLM SDK, API calls, credentials, billing configuration, telemetry, or
  coding-agent subprocesses. Local MCP uses stdio, not a listening service.
- No executing vendored hooks/scripts during inspection or installation.
- Existing files, global configuration and unregistered/app-owned worktrees
  remain untouched unless a narrowly owned project projection is installed.
- Default maximum active work items remains four; AI-session concurrency is
  owned by the native client, not promised by Forgeyard.
- Gates are finite approved commands, never arbitrary argv in a tool call.
- The native client owns its sessions, subagents, authentication and Stop.
- A cooperative lease is not OS isolation against another same-user process.
- Live client support is unverified until an actual client/version/OS test.

## Architecture

1. **Problem preparation:** bounded local inspection, hash-backed evidence,
   explicit structured intent/risk/needs, deterministic constraint resolver.
   Keyword inference remains a labeled compatibility fallback, not a claim of
   semantic understanding. Unsupported mandatory needs fail explicitly.
2. **Frozen capsule:** compile policy, gate definitions, method, selected
   components and native projections into a canonical hashed identity. Product
   requirements, task graphs and decisions are separate evolving artifacts.
   Reuse the existing installer journal and seed/managed ownership rules.
3. **Project service:** SQLite outside the working tree stores atomic revisioned
   state, events, idempotency results, cooperative writer ownership and gate
   operations. Root is fixed at service construction from real Git identity;
   callers cannot supply an arbitrary root per tool call.
4. **Native tools:** one strict dispatcher shared by local MCP and JSON CLI.
   Context, inspect, compose, prepare/apply, attach, plan, next, record, review,
   verify, operation, pause and finalize expose bounded structured results.
   No approve/model-spawn/account tool exists. Consent is collected through
   an interactive human-only CLI channel; model-declared consent is not proof.
5. **Verified delivery:** gate receipts bind plan/task/capsule/input revisions;
   all required configured gates and acceptance criteria must be covered.
   Self-review is recorded as self-review. Independent review cannot be
   asserted merely by supplying a different worker name. Finalization derives
   its verdict and report from current stored evidence, not agent prose.
6. **Continuity:** new feature plans can reuse the same capsule. Context and
   reports are generated from structured project artifacts and current state,
   without transcripts, provider session IDs or credentials in Git.

## Compatibility and migration

Retain current init/prepare/task/workspace CLI commands. Legacy task receipts
are not silently promoted to native-run certificates. Existing installs need
an explicit update/bootstrap to obtain a capsule and native bridge. Existing
instructions use ownership-scoped routing; namespace collisions and drift
fail conservatively. Native project configuration does not auto-trust a repo
or override higher-priority/global settings.

The first usable path is tested offline with a real Git repository, real finite
gate commands and an MCP SDK client, plus fresh-context skill exercises. These
tests do not establish live Codex/Claude desktop behavior. APM acquisition and
signed remote catalog distribution remain separate explicit maintenance work;
the bundled pinned catalog stays usable without either.

## Acceptance

- Structured equivalent requests have equivalent composition regardless of
  human language; missing or stale evidence is rejected.
- Dependencies, conflicts, exclusive coordinator and context/permission
  constraints are enforced before materialization.
- Same inputs produce the same capsule identity; a new feature does not
  change it; policy/gate/projection drift blocks certification.
- MCP and CLI share schemas, revision checks and idempotency. Extra fields,
  free argv, free roots, fake grants and unknown tools are rejected.
- Two sessions cannot both own a writer lease for the same working tree.
  Expired/uncertain execution is reconciled, not blindly restarted.
- Zero discovered tests, failing commands, stale inputs, uncovered criteria
  and missing required independent review cannot produce a delivered verdict.
- Pause controls only Forgeyard gate operations; no provider process is killed.
- Existing installer, worktree cleanup, provenance and package gates pass.
