---
name: forgeyard-workflow
description: Use when planning, implementing, verifying, reviewing, or rehearsing delivery work in this Forgeyard project.
---

# Forgeyard workflow for {{project.name}}

Project purpose: {{project.purpose}}

Read `forgeyard.yaml`, the selected task under `.forgeyard/tasks/`, and current Git status before acting. The configured horizon is {{workflow.timeboxMinutes}} minutes and no more than {{workflow.maxConcurrency}} independent work items may be active.

Follow this sequence:

1. **Orient:** identify the current revision, mutable roots, protected paths, available evidence, and open risks.
2. **Define the visible slice:** state one observable user journey that can be demonstrated before building generalized infrastructure.
3. **Plan one task:** give it explicit acceptance criteria, exact files, dependencies, and a verification argv.
4. **Implement:** remain inside declared scope, preserve unrelated changes, and avoid external effects without explicit policy.
5. **Verify:** run the configured command against the current task and revision.
6. **Review:** inspect the frozen revision independently; report findings before summary.
7. **Rehearse:** exercise the visible journey and its offline presentation fallback.
8. **Stop:** report the strongest evidence-backed state and any unmet gate.

Configured quality commands:

{{quality.commands}}

Use status precisely:

- `implemented`: files changed;
- `verified`: required commands passed for the named revision;
- `reviewed`: an independent review inspected that frozen revision;
- `demo-ready`: the observable journey and fallback were exercised.

Never promote an older receipt to a newer revision, treat installed role files as running workers, or invent proof that was not captured.
