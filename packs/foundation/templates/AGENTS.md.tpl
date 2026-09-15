# {{project.name}} project instructions

Purpose: {{project.purpose}}

This is a {{project.mode}} project initialized with a {{workflow.timeboxMinutes}}-minute delivery horizon.

## Read first

- Treat `forgeyard.yaml` as the human-owned project intent.
- Read `.forgeyard/COMPOSITION.md` to understand the factory's selected capabilities, exclusions, evidence, and operating limits.
- Run `forgeyard task status --root . --json`, then `forgeyard task next --root . --json`; execute the returned bounded `hostPrompt` rather than asking the user to sequence internal steps.
- Read the selected file in `.forgeyard/tasks/` before changing code.
- Load `.agents/skills/forgeyard-workflow/SKILL.md` when planning or executing work.
- Read `PROJECT.md` for the visible journey and `.forgeyard/handoffs/CURRENT.md` when resuming another session.
- Keep detailed workflow guidance in skills; keep this file navigational.
- Do not ask the user to choose catalog skills or internal workflow components during normal use; translate the product request into the prepared workflow.

## Scope

- Mutable roots: {{paths.mutable}}
- Protected paths: {{paths.protected}}
- Presentation output: {{presentation.path}}
- Never write outside the selected project root or modify protected paths.
- External effects such as push, publish, deploy, messaging, or spending require explicit project policy.

## Delivery workflow

Prioritize the smallest visible user outcome before generalized infrastructure. Claim only dependency-ready tasks and keep no more than {{workflow.maxConcurrency}} independent work items active. Use isolated Git worktrees for concurrent writes. Installed agents and skills are a catalog of capabilities; they are not running workers and should be loaded only when relevant.

The generated workflow skill is the ordinary controller. It clarifies only material product ambiguity, maps the request to returned work orders, and uses host-native workers only when available. `task next` neither claims work nor launches model clients. Use `forgeyard task claim`, `checkpoint`, `resume`, `verify`, and `complete` as the inspectable lifecycle. Use `forgeyard guard` before uncertain writes. For isolated work, use `forgeyard workspace create`, `validate`, and `integrate`; successful integration removes the registered worktree and merged worker branch. If that cleanup is interrupted, retry `forgeyard workspace cleanup`; integration remains serialized and never pushes.

Required quality commands:

{{quality.commands}}

Do not call a task complete because files changed. Distinguish `implemented`, `verified`, `reviewed`, and `demo-ready`. Verification must match the current task bytes, exact command arguments, and Git revision. Update the current handoff and run report with evidence IDs, remaining risks, and the next bounded action.
