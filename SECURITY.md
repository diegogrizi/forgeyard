# Security policy

## Supported version

Security fixes are prepared for the current `0.1.x` line. Forgeyard renders for the Codex and Claude Code adapters.

## Report a vulnerability

Use the source repository's private **Report a vulnerability** channel. Include the affected Forgeyard version, operating system, minimal reproduction, impact, and whether the report contains secrets. If that private channel is unavailable, no disclosure mailbox is currently monitored; do not publish sensitive details in an issue. Contact the repository owner privately to establish a disclosure channel first.

## Threat model

Forgeyard treats project paths, answer files, installed manifests, operation journals, task definitions, registry entries, and generated text as untrusted input.

The installer and registry reject traversal, encoded separators, case-folding collisions, unsafe absolute paths, symbolic links or junctions in destinations, unknown ownership, and hash drift. Mutations stage content and retain operation journals so failures can be recovered or diagnosed without printing file bodies.

Verification executes only the argv array in the selected installed task. It uses direct process spawning with shell interpretation disabled, requires a real clean Git `HEAD`, applies a timeout and output limit, and stores hashes rather than command output. This prevents shell expansion by Forgeyard; it does not make an untrusted executable or argument safe. Review task files before running `verify`.

Prompt-level tool permissions and reviewer instructions are policy guidance, not an operating-system sandbox. A model or CLI process can use every permission granted to its host account. Use a disposable worktree, least-privilege credentials, scoped environment variables, and host isolation when the repository is not trusted.

## Secrets and privacy

- Do not put credentials, tokens, private deny terms, or personal data in answer files, prompts, task definitions, generated presentations, journals, issues, or evidence receipts.
- Pass a private release deny term only through the named process environment variable accepted by the release audit; the value is never printed or serialized.
- Verification stdout and stderr remain local to the process and are represented only by hashes and byte counts in receipts.
- Forgeyard has no telemetry, analytics, update check, or runtime pack download.

## Unsupported automatic effects

M1 does not authorize or implement automatic deployment, publishing, purchases, account mutation, outbound messaging, issue-tracker changes, or other external effects. A generated workflow cannot grant authority beyond the user's operating-system and tool permissions.
