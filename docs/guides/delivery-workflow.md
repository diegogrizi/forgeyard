# Resumable delivery workflow

Forgeyard installs a delivery graph sized to the selected project composition, plus project memory, decision and handoff records, explicit usage accounting, and a run report. Presentation assets and the fourth task are installed only when the requested outcome includes a demo/pitch/showcase or `--presentation` is explicit. The graph coordinates work; it does not start model clients or pretend that every installed role is active.

## Full five-hour presentation graph

| Task | Default share | Dependency | Write scope | Observable gate |
|---|---:|---|---|---|
| `T001` first visible slice | 30% / 90 min | none | configured mutable roots | one journey reaches a visible result |
| `T002` reliable demonstration | 45% / 135 min | `T001` | configured mutable roots | journey and critical edge states pass verification |
| `T003` independent review | 10% / 30 min | `T002` | none | read-only findings inspect the frozen revision |
| `T004` demo freeze | 15% / 45 min | `T003` | presentation root | live path and offline fallback tell the same evidence-backed story |

The displayed minutes use the default 300-minute horizon. Forgeyard scales each share from `timeboxMinutes`. A focused short maintenance composition keeps only `T001`; an ordinary non-presentation delivery composition installs `T001` through `T003`; presentation adds `T004`. Manual `hackathon` and `full` profiles retain the complete four-task graph.

## Ordinary host use

After preparation, speak in product language: for example, “Implement this feature,” “Fix this without changing the public API,” or “Resume the current work.” The generated host instructions route the request through the project brief, task graph, evidence rules, review, and handoff state. The commands below remain the inspectable control plane and recovery surface; they are not a vocabulary the project owner must memorize for every change.

Task definitions live in `.forgeyard/tasks/`. Runtime claims, checkpoints, deadlines, failures, evidence IDs, and workspace metadata live separately in `.forgeyard/state/run.json`, so editing a definition cannot silently rewrite history.

## Operator loop

```sh
forgeyard task status --root .
forgeyard task next --root .
forgeyard task claim T001 --worker implementer-1 --session local-session --root .
forgeyard task checkpoint T001 --worker implementer-1 --note "Journey works; freeze the revision" --root .
forgeyard task resume T001 --worker implementer-1 --root .
forgeyard verify T001 --root . --json
forgeyard task complete T001 --worker implementer-1 --receipt <receipt-id> --root .
```

`claim` succeeds only when dependencies, concurrency, overlapping-scope, retry, and time-budget rules allow it. The worker ID is stable across process restarts. A checkpoint is a short recovery instruction, not evidence that the task passed.

Before an uncertain write, run:

```sh
forgeyard guard T001 src/example.ts --root .
```

Claude Code invokes the same project-local decision automatically for native file tools. Codex and Cursor receive the CLI guard as an advisory contract because their project surfaces do not expose the same hook.

## Isolated parallel work

```sh
forgeyard workspace create T001 --worker implementer-1 --root .
forgeyard workspace validate T001 --worker implementer-1 --root .
forgeyard workspace integrate T001 --worker implementer-1 --root .
# Recovery only, when automatic cleanup reports an interruption:
forgeyard workspace cleanup T001 --worker implementer-1 --root .
```

Each claimed task gets a deterministic Git branch and worktree from a frozen base. Validation happens in that worktree. Integration is serialized, requires clean checkouts and valid ancestry, performs a no-commit merge, tests the combined tree, aborts on conflict or failure, commits only after the gate passes, and verifies the resulting commit again. Once that success is durable, Forgeyard uses `git worktree remove` to remove the checkout and its exact `.git/worktrees` administration entry, verifies that the registration disappeared, then uses one Git ref transaction to confirm the target branch is unchanged while deleting `refs/heads/<worker-branch>` only at the validated commit. If the directory was already removed manually, the same non-force command targets only that exact stale registration; Forgeyard does not run repository-wide pruning. An existing directory that is no longer registered is never deleted automatically.

If the filesystem or Git interrupts either cleanup step, the merge and completed task state remain intact. Re-running `workspace cleanup` resumes the idempotent cleanup without repeating integration. Forgeyard checks the worker branch both before and after worktree removal, proves that it is still the validated task revision, and verifies that the target branch still contains the recorded integration. The serialized lock is an atomic Git ref whose immutable owner record contains a token, host, and process; a later invocation can recover a dead local owner without using an unsafe elapsed-time timeout. Forgeyard does not push, deploy, force-delete an unmerged branch, or resolve a conflict on the operator's behalf.

The concurrency cap applies to actual claims. Automatic preparation infers a project-appropriate value, normally one to four, while an explicit constraint may use 1–16. Hundreds of installed agent descriptions are a searchable library; they are not hundreds of simultaneous processes and are not loaded into one prompt.

## Evidence, continuity, and reports

- `PROJECT.md` is the human-owned delivery brief and visible-journey boundary.
- `.forgeyard/knowledge/README.md` defines safe durable project memory.
- `.forgeyard/decisions/0000-template.md` records consequential choices and alternatives.
- `.forgeyard/handoffs/CURRENT.md` carries the exact revision, active task, checkpoint, next action, and open risks between sessions.
- `.forgeyard/reports/RUN_REPORT.md` separates implemented, verified, reviewed, and demo-ready states.
- `.forgeyard/usage/README.md` explains explicit provider usage observations without retaining prompts or outputs.

A verification receipt stores hashes and byte counts, not command output. It is current only while the task bytes, exact argv, clean Git `HEAD`, and commit match. A later code commit deliberately makes the older receipt stale; run verification again rather than promoting the old proof.

`PROJECT.md`, the current handoff, and the run report are seed files: updates preserve operator edits, and rollback keeps them. Task definitions, guides, guards, and presentation assets are managed files and retain conflict-aware update semantics.

## Honest limitations

- Forgeyard does not launch Codex, Claude Code, Cursor, or a paid worker fleet.
- It cannot guarantee operating-system isolation from a prompt policy alone.
- It does not parse arbitrary shell commands to infer every possible filesystem mutation.
- It does not measure provider tokens or cost automatically; `forgeyard ledger record` accepts only explicit observations.
- Structural adapter checks are not evidence of a real authenticated model-client run.
- Deployment, publishing, messaging, purchases, and other external effects remain outside the default workflow.

The deterministic round-trip suite exercises manual initialization, project-specific frontend/backend preparation, process interruption and resume, dependency order, stale evidence after a code commit, optional presentation, all selected task completions, and the offline presentation audit. These are structural/local proofs; an authenticated host-client run remains separate evidence.
