# Changelog

All notable changes to Forgeyard are documented here. This project follows semantic versioning once releases are published.

## 0.1.0 - 2026-09-15

### Added

- Problem-first `inspect` and `prepare` commands that read bounded repository evidence, infer project type and quality commands, select a minimal coherent capability set, preserve existing host instructions, and pin an explainable tailored suite.
- Project-specific task contracts and `task next` work orders containing the actual request, role, capabilities, scopes, acceptance criteria, verification argv, time/cost state, stable worker identity, and exact host prompt.
- A generated natural-language workflow controller that resolves product ambiguity, uses guided or host-native dispatch, and keeps internal skills and lifecycle commands out of ordinary user interaction.
- Validated usage-ledger summaries and durable per-task cost-budget stops that distinguish absent measurement from measured zero.
- A Node.js CLI with lifecycle, verification, resumable task, usage-ledger, write-guard, and Git-workspace commands with stable plain or JSON output.
- `minimal`, curated `hackathon`, and complete `full` profiles with deterministic local selection and a default concurrency cap of four.
- A pinned MIT portable catalog containing 1,007 source files, 211,594 physical lines, 202 agents, 183 native skills, 105 commands, and supporting references.
- A Codex catalog adapter that renders namespaced agents and skills, converts commands to skill entrypoints, splits oversized instructions safely, and leaves unsupported hooks disabled.
- A Claude Code adapter with native project agents, skills, commands, `CLAUDE.md`, and safe project settings that disable implicit skill shell expansion.
- A Cursor adapter with compact agent-requested MDC rules backed by complete local instruction files and explicit reporting for unenforced agent policies.
- Transactional install, hash-aware update, operation-scoped rollback, seed preservation, ownership conflict detection, and automatic reversal after failed post-write checks.
- Clean-Git verification receipts bound to the exact task bytes, argv array, and Git revision without persisted stdout or stderr bodies.
- A persistent dependency-aware task scheduler with claims, checkpoints, resume, retry and time stops, overlapping-scope prevention, and a default concurrency cap of four.
- Deterministic task write guards, including an original Claude Code `PreToolUse` file-tool hook and an advisory CLI contract for Codex and Cursor.
- Real Git task worktrees with frozen bases, independent validation, owner-token serialized integration, combined-tree verification, conflict-safe aborts, exact revision-bound post-merge cleanup, dead-owner lock recovery, and an idempotent cleanup recovery command.
- A 300-minute visible-slice DAG that allocates 90 minutes to the first journey, 135 to reliability, 30 to independent review, and 45 to the demo freeze.
- Project brief, durable knowledge policy, decision, handoff, explicit usage, and revision-bound run-report assets with seed-aware rollback behavior.
- An original ten-slide offline presentation pack with keyboard, pointer, responsive, reduced-motion, and print behavior.
- Structural, content, presentation, provenance, adversarial filesystem, real-Git, golden, and built-CLI round-trip tests.
- Deterministic third-party notices and an SPDX 2.3 software bill of materials generated from the complete npm lock graph and verified vendor attestations.
- Catalog byte, license, package-content, path-safety, collision, profile, full-render, and documentation-drift gates.
- A clean acceptance run covering 61 test files and 343 tests, followed by build, catalog, provenance, release, and package-content audits. The dry-run npm package contains 1,167 entries (about 2.21 MB compressed and 8.31 MB unpacked).

### Limits

- Task execution and evidence handling are local CLI services; Forgeyard coordinates workers but does not itself launch an LLM runtime or paid model processes.
- Provider usage is enforced only when an explicit observation is recorded; unavailable usage remains visibly unmeasured.
- Host-client invocation is reported as unavailable or skipped unless separately and explicitly verified.
