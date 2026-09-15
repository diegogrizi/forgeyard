# {{project.name}} presentation runbook

- Audience: {{presentation.audience}}
- Maximum speaking time: {{presentation.durationMinutes}} minutes
- Build timebox: {{workflow.timeboxMinutes}} minutes

## Before presenting

- Replace every generic instruction in `index.html` with project-specific copy.
- Replace “Add verified evidence” only with evidence that is current for the Git revision being shown.
- Run the configured checks:
{{quality.commands}}
- Open `index.html` directly in a browser and confirm that no network connection is required.
- Rehearse both the live path and a current local screenshot or recording fallback.
- Check desktop, mobile, short-landscape, keyboard, pointer, console, and print output.

## Timed speaker script

The markers below allocate the configured {{presentation.durationMinutes}} minute limit. Rehearse to the end time, not beyond it.

| Time | Slide | Speaker goal |
| --- | --- | --- |
{{presentation.timeline}}

## Live demo path

1. Starting state: add the exact local URL, file, account state, or fixture.
2. Meaningful action: add the shortest interaction that exposes the product decision.
3. Visible result: add the precise state the audience should see.
4. Stop condition: return to the deck as soon as that result is clear.

## Fallback

- Local screenshot or recording:
- Revision captured:
- How to open it offline:
- Limitation it does not prove:

## Likely questions

- Which part is working now, and which part remains a hypothesis?
- What evidence is tied to the current revision?
- Why was this audience and problem selected?
- What is the most important technical tradeoff?
- What failed or was deliberately left out?
- What single next step would reduce the largest uncertainty?

## Final integrity check

The deck, live product, fallback, task definition, and receipts must all describe the same revision. Remove or label any unsupported claim before presenting.
