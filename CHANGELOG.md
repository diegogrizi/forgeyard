# Changelog

All notable changes to Forgeyard are documented here. This project follows semantic versioning once releases are published.

## 0.1.0 - 2026-09-15

### Added

- A Node.js CLI with `init`, `doctor`, `verify`, `update`, and `rollback` commands and stable plain or JSON output.
- `minimal`, curated `hackathon`, and complete `full` profiles with deterministic local selection and a default concurrency cap of four.
- A pinned MIT portable catalog containing 1,007 source files, 211,594 physical lines, 202 agents, 183 native skills, 105 commands, and supporting references.
- A Codex catalog adapter that renders namespaced agents and skills, converts commands to skill entrypoints, splits oversized instructions safely, and leaves unsupported hooks disabled.
- A Claude Code adapter with native project agents, skills, commands, `CLAUDE.md`, and safe project settings that disable implicit skill shell expansion.
- A Cursor adapter with compact agent-requested MDC rules backed by complete local instruction files and explicit reporting for unenforced agent policies.
- Transactional install, hash-aware update, operation-scoped rollback, seed preservation, ownership conflict detection, and automatic reversal after failed post-write checks.
- Clean-Git verification receipts bound to the exact task bytes, argv array, and Git revision without persisted stdout or stderr bodies.
- An original ten-slide offline presentation pack with keyboard, pointer, responsive, reduced-motion, and print behavior.
- Structural, content, presentation, provenance, adversarial filesystem, real-Git, golden, and built-CLI round-trip tests.
- Deterministic third-party notices and an SPDX 2.3 software bill of materials generated from the complete npm lock graph and verified vendor attestations.
- Catalog byte, license, package-content, path-safety, collision, profile, full-render, and documentation-drift gates.

### Limits

- Task execution and evidence handling are local CLI services; Forgeyard does not itself provide an LLM runtime or native multi-worker scheduler.
- Host-client invocation is reported as unavailable or skipped unless separately and explicitly verified.
