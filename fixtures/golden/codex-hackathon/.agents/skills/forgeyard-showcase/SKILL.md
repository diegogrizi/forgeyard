---
name: forgeyard-showcase
description: Turn the current project into an evidence-backed, accessible, offline presentation and rehearsed demo.
---

# Forgeyard showcase

Use this skill when the project needs a presentation, demo script, or final narrative. The generated deck is a starting structure, not permission to invent results.

## Read before editing

1. Read `forgeyard.yaml` for the project purpose, audience, timebox, and presentation duration.
2. Read `.forgeyard/tasks/` to understand the promised visible outcome.
3. Read current receipts in `.forgeyard/evidence/` and confirm that each receipt still matches the current Git revision, task bytes, and command.
4. Inspect the product itself and the exact live-demo path.

## Build the story

1. Replace every generic prompt in `presentation/index.html` with project-specific language.
2. Keep the sequence: problem, audience, insight, solution, demo, evidence, architecture, value, and ask.
3. Put the observable user journey before implementation detail.
4. Replace each “Add verified evidence” slot only with a current receipt, directly inspected behavior, or another reproducible source.
5. If a claim is not yet supported, label it as unverified or remove it. Never invent metrics, users, test results, quotes, or outcomes.

## Prepare the demo

1. Define one short happy path with a known starting state, one meaningful action, and one visible result.
2. Prepare a local screenshot or recording fallback using only original assets or assets whose source and license are recorded in the project.
3. Keep the deck self-contained: local files, local system fonts, no remote requests, no tracking, and no embedded third-party pages.
4. Preserve semantic landmarks, heading order, contrast, visible focus, reduced-motion behavior, keyboard navigation, pointer controls, and print output.

## Verify and rehearse

1. Open `presentation/index.html` locally and exercise Previous and Next with a pointer.
2. Exercise Arrow Left/Right, Page Up/Down, Home, and End.
3. Check the complete deck at desktop and mobile widths, including a short landscape viewport.
4. Confirm the browser console is clean and that the deck attempts no network request.
5. Run the project quality commands and refresh stale verification receipts before citing them.
6. Complete the timed speaker script and likely-question checklist in `presentation/README.md`.
7. Rehearse the live path and its fallback within the configured duration.

Finish only when the story, live behavior, fallback, and evidence all describe the same revision.
