# {{project.name}} project instructions

Purpose: {{project.purpose}}

This is a {{project.mode}} project initialized with a {{workflow.timeboxMinutes}}-minute delivery horizon.

## Read first

- Treat `forgeyard.yaml` as the human-owned project intent.
- Read the selected file in `.forgeyard/tasks/` before changing code.
- Load `.agents/skills/forgeyard-workflow/SKILL.md` when planning or executing work.
- Keep detailed workflow guidance in skills; keep this file navigational.

## Scope

- Mutable roots: {{paths.mutable}}
- Protected paths: {{paths.protected}}
- Presentation output: {{presentation.path}}
- Never write outside the selected project root or modify protected paths.
- External effects such as push, publish, deploy, messaging, or spending require explicit project policy.

## Delivery workflow

Prioritize the smallest visible user outcome before generalized infrastructure. Keep no more than {{workflow.maxConcurrency}} independent work items active. A role definition is not proof that a worker ran.

Required quality commands:

{{quality.commands}}

Do not call a task complete because files changed. Distinguish `implemented`, `verified`, `reviewed`, and `demo-ready`. Verification must match the current task bytes, exact command arguments, and Git revision.
