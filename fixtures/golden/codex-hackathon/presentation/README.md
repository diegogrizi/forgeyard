# Signal Garden presentation runbook

- Audience: Product reviewers
- Maximum speaking time: 7 minutes
- Build timebox: 300 minutes

## Before presenting

- Replace every generic instruction in `index.html` with project-specific copy.
- Replace “Add verified evidence” only with evidence that is current for the Git revision being shown.
- Run the configured checks:
- test: ["node","-e","process.exit(0)"]
- Open `index.html` directly in a browser and confirm that no network connection is required.
- Rehearse both the live path and a current local screenshot or recording fallback.
- Check desktop, mobile, short-landscape, keyboard, pointer, console, and print output.

## Timed speaker script

The markers below allocate the configured 7 minute limit. Rehearse to the end time, not beyond it.

| Time | Slide | Speaker goal |
| --- | --- | --- |
| 0:00–0:34 | Opening | Frame the purpose. |
| 0:34–1:16 | Problem | Make the costly moment concrete. |
| 1:16–1:49 | Audience | Identify the first audience. |
| 1:49–2:27 | Insight | State the product insight. |
| 2:27–3:17 | Solution | Explain the visible promise. |
| 3:17–4:29 | Demo | Run the complete live path. |
| 4:29–5:23 | Evidence | Show revision-bound proof. |
| 5:23–6:01 | Architecture | Explain only outcome-critical structure. |
| 6:01–6:31 | Value | Translate proof into value. |
| 6:31–7:00 | Ask | Ask for one next decision. |

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
