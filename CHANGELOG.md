# Changelog

All notable changes to Forgeyard are documented here. This project follows semantic versioning once releases are published.

## 0.1.0 - 2026-09-15

### Added

- A Node.js CLI with `init`, `doctor`, `verify`, `update`, and `rollback` commands and stable plain or JSON output.
- A project-scoped `hackathon` profile and Codex adapter that render navigational instructions, two on-demand skills, a read-only reviewer role, and an initial verification task.
- Transactional install, hash-aware update, operation-scoped rollback, seed preservation, ownership conflict detection, and automatic reversal after failed post-write checks.
- Clean-Git verification receipts bound to the exact task bytes, argv array, and Git revision without persisted stdout or stderr bodies.
- An original ten-slide offline presentation pack with keyboard, pointer, responsive, reduced-motion, and print behavior.
- Structural, content, presentation, provenance, adversarial filesystem, real-Git, golden, and built-CLI round-trip tests.
- Deterministic third-party notices and an SPDX 2.3 software bill of materials generated from the complete npm lock graph.

### Limits

- M1 supports Codex only.
- Task execution and evidence handling are local CLI emulations; Forgeyard does not provide an LLM runtime or native multi-worker scheduler.
- Host-client invocation is reported as unavailable or skipped unless separately and explicitly verified.
