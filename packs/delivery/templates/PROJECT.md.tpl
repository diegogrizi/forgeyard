# {{project.name}}

## Delivery brief

Purpose: {{project.purpose}}

Mode: {{project.mode}}

Audience: {{presentation.audience}}

Delivery horizon: {{workflow.timeboxMinutes}} minutes

## First visible journey

Describe one journey a real user can complete from entry to observable result. Keep this narrower than the eventual product and make it demonstrable without explaining hidden infrastructure.

## Acceptance boundary

- The journey has a concrete starting state, user action, and visible outcome.
- The outcome works locally at the revision named by the evidence receipt.
- Failure and empty states used by the journey are understandable.
- The offline presentation shows the same behavior and cites only captured evidence.

## Working boundaries

- Mutable roots: {{paths.mutable}}
- Protected paths: {{paths.protected}}
- Presentation bundle: {{presentation.path}}
- Maximum concurrent claims: {{workflow.maxConcurrency}}

## Required verification

{{quality.commands}}

Update this seed document with the actual user, pain, journey, proof, and deliberate exclusions before implementation expands.
