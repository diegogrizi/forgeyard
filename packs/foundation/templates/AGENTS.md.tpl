# {{project.name}} project instructions

Purpose: {{project.purpose}}

This is a {{project.mode}} project initialized with a {{workflow.timeboxMinutes}}-minute delivery horizon.

## Read first

- Treat `forgeyard.yaml` as the human-owned project intent.
- Read `.forgeyard/COMPOSITION.md` to understand the factory's selected capabilities, exclusions, evidence, and operating limits.
- Start with native `fy_context`; read current requirements, plans, decisions and evidence gaps.
- A new request needs a requirement-linked `fy_plan`, even after an earlier delivery. Reuse the stable capsule.
- Load `.agents/skills/forgeyard-workflow/SKILL.md` when planning or executing work.
- Read `PROJECT.md` for the visible journey and `.forgeyard/handoffs/CURRENT.md` when resuming another session.
- Keep detailed workflow guidance in skills; keep this file navigational.
- Do not ask the user to choose catalog skills or internal workflow components during normal use; translate the product request into the prepared workflow.

## Scope

- Mutable roots: {{paths.mutable}}
- Protected paths: {{paths.protected}}
- Presentation output: {{presentation.path}}
- Never write outside the selected project root or modify protected paths.
- External effects such as push, publish, deploy, messaging, or spending require explicit authorization at the point of action.

## Delivery workflow

Prioritize the smallest visible user outcome before generalized infrastructure. Claim only dependency-ready tasks and keep no more than {{workflow.maxConcurrency}} independent work items active. Use isolated Git worktrees for concurrent writes. Installed agents and skills are a catalog of capabilities; they are not running workers and should be loaded only when relevant.

The workflow skill is the ordinary controller: `fy_attach`, `fy_plan`, local human consent, `fy_next`, `fy_record`, all frozen `fy_verify` gates, review and `fy_finalize`. Only a current delivered verdict certifies delivery. Native clients own AI sessions, subagents, permissions and Stop; Forgeyard never launches them or handles accounts. One cooperative writer owns this tree. A claimed reviewer name is not independent provenance; medium/high risk needs verified independent review or the supported local human-review dialog.

Use `fy_pause` and explicit local reconciliation for uncertain resumption. MCP arguments are `{requestId, payload}`; the shared strict JSON fallback is `forgeyard tool --root . --json` via stdin. Legacy task/worktree services remain available but are not native certificates. Never merge automatically: integrate registered work only with authorization, then exact registered cleanup. Unregistered/app-owned worktrees must not be deleted.

Required quality commands:

{{quality.commands}}

Do not call a task complete because files changed. Distinguish `implemented`, `verified`, `reviewed`, and `demo-ready`. Verification must match the current task bytes, exact command arguments, and Git revision. Update the current handoff and run report with evidence IDs, remaining risks, and the next bounded action.
