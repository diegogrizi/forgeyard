# Current handoff: {{project.name}}

- Current revision: record the exact Git commit before handing work over.
- Active task: record the claimed task ID and worker ID.
- Last checkpoint: summarize the last reproducible state.
- Next safe action: name one command or bounded edit.

## Evidence available

List receipt IDs and whether each still matches the current task definition, command arguments, and Git revision.

## Open risks

List unresolved blockers, failed checks, and assumptions. Do not describe a changed file as verified evidence.

## Local recovery

Start with `fy_context`, inspect Git status, and resume the recorded run. If the writer lease is uncertain, use `forgeyard reconcile` rather than starting a second writer. Never paste credentials or private transcripts into this file.
