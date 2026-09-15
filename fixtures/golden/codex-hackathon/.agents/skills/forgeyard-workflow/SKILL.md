---
name: forgeyard-workflow
description: Use when planning, implementing, verifying, reviewing, or rehearsing delivery work in this Forgeyard project.
---

# Forgeyard workflow for Signal Garden

Project purpose: Help a small team demonstrate one trustworthy user journey.

Read `forgeyard.yaml`, `PROJECT.md` when installed, the selected task under `.forgeyard/tasks/`, the current handoff, and Git status before acting. The configured horizon is 300 minutes and no more than 4 independent claims may be active. Installed catalog entries are discoverable capabilities, not pre-running workers.

Follow this sequence:

1. **Orient:** run `forgeyard task status --root .`; identify the current revision, mutable roots, protected paths, evidence, and open risks.
2. **Select:** run `forgeyard task next --root .` and choose only a dependency-ready task.
3. **Claim:** run `forgeyard task claim <task-id> --worker <worker-id> --session <session-id> --root .`.
4. **Isolate when useful:** for concurrent writes, create the deterministic worktree with `forgeyard workspace create <task-id> --worker <worker-id> --root .` and do the task there.
5. **Implement:** remain inside declared scopes. Check uncertain paths with `forgeyard guard <task-id> <path...> --root .`. Preserve unrelated work and avoid external effects without explicit policy.
6. **Checkpoint:** record a reproducible next step with `forgeyard task checkpoint <task-id> --worker <worker-id> --note <text> --root .`. A later process uses `forgeyard task resume` with the same worker ID.
7. **Verify:** run `forgeyard verify <task-id> --root . --json`. A receipt is current only for the same task bytes, command arguments, clean Git revision, and commit.
8. **Close:** for shared-checkout work, use `forgeyard task complete` with the current receipt. For isolated work, run `forgeyard workspace validate` and then the serialized `forgeyard workspace integrate` from the main checkout; a successful integration completes the task, removes the registered worktree and its Git administration entry, deletes only the merged worker branch, and never pushes. If post-merge cleanup is interrupted, retry only the idempotent cleanup with `forgeyard workspace cleanup <task-id> --worker <worker-id> --root .`; do not rerun validation or integration. Forgeyard refuses to delete an existing workspace directory that Git no longer registers, so inspect and preserve that path instead.
9. **Review and rehearse:** follow the installed DAG through independent read-only review and the offline demonstration task.
10. **Handoff:** update `.forgeyard/handoffs/CURRENT.md` and `.forgeyard/reports/RUN_REPORT.md` with revision-bound facts, then report the strongest evidence-backed state and unmet gates.

Configured quality commands:

- test: ["node","-e","process.exit(0)"]

Use status precisely:

- `implemented`: files changed;
- `verified`: required commands passed for the named revision;
- `reviewed`: an independent review inspected that frozen revision;
- `demo-ready`: the observable journey and fallback were exercised.

Never promote an older receipt to a newer revision, treat installed role files as running workers, load the whole catalog into one prompt, or invent proof that was not captured.
