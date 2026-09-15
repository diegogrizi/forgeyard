# Signal Garden project instructions

Purpose: Help a small team demonstrate one trustworthy user journey.

This is a new project initialized with a 300-minute delivery horizon.

## Read first

- Treat `forgeyard.yaml` as the human-owned project intent.
- Read `.forgeyard/COMPOSITION.md` to understand the factory's selected capabilities, exclusions, evidence, and operating limits.
- Run `forgeyard task status --root .` before selecting work.
- Read the selected file in `.forgeyard/tasks/` before changing code.
- Load `.agents/skills/forgeyard-workflow/SKILL.md` when planning or executing work.
- Read `PROJECT.md` for the visible journey and `.forgeyard/handoffs/CURRENT.md` when resuming another session.
- Keep detailed workflow guidance in skills; keep this file navigational.
- Do not ask the user to choose catalog skills or internal workflow components during normal use; translate the product request into the prepared workflow.

## Scope

- Mutable roots: src, presentation
- Protected paths: .git, .env
- Presentation output: presentation
- Never write outside the selected project root or modify protected paths.
- External effects such as push, publish, deploy, messaging, or spending require explicit project policy.

## Delivery workflow

Prioritize the smallest visible user outcome before generalized infrastructure. Claim only dependency-ready tasks and keep no more than 4 independent work items active. Use isolated Git worktrees for concurrent writes. Installed agents and skills are a catalog of capabilities; they are not running workers and should be loaded only when relevant.

Use `forgeyard task claim`, `checkpoint`, `resume`, `verify`, and `complete` to make progress resumable. Use `forgeyard guard` before uncertain writes. For isolated work, use `forgeyard workspace create`, `validate`, and `integrate`; successful integration removes the registered worktree and merged worker branch. If that cleanup is interrupted, retry `forgeyard workspace cleanup`; integration remains serialized and never pushes.

Required quality commands:

- test: ["node","-e","process.exit(0)"]

Do not call a task complete because files changed. Distinguish `implemented`, `verified`, `reviewed`, and `demo-ready`. Verification must match the current task bytes, exact command arguments, and Git revision. Update the current handoff and run report with evidence IDs, remaining risks, and the next bounded action.
