# Forgeyard

```sh
npx forgeyard prepare ./my-project --brief "Add accessible checkout recovery"
```

Describe the software outcome; Forgeyard prepares the agentic environment needed to deliver it. It inspects the repository and supplied specifications, detects the stack and existing host conventions, selects one coherent workflow plus the relevant capabilities, records why each choice was made, and installs a stable project-scoped suite.

You do not need to choose a profile, compare skill repositories, name an orchestration framework, or remember a sequence of internal lifecycle commands before starting. The result remains inspectable in `forgeyard.yaml`, `forgeyard.lock`, and `.forgeyard/COMPOSITION.md`.

Forgeyard is an auditable factory and lifecycle manager, not an LLM runtime. It prepares instructions, roles, skills, task state, evidence rules, guards, and optional presentation support for Codex, Claude Code, or Cursor. The selected host executes model work; an installed role is not a running or billable process.

## Problem-first preparation

Preview the evidence and proposed composition without writing:

```sh
npx forgeyard inspect ./my-project --brief "Add accessible checkout recovery"
```

Prepare from a brief, one or more project-relative specifications, or an existing README:

```sh
npx forgeyard prepare ./my-project \
  --spec requirements.md \
  --timebox 240 \
  --autonomy balanced \
  --yes
```

Forgeyard asks one product question only when it cannot infer the requested outcome. Normal preparation does not ask which plugins, profiles, authors, paths, test runners, or orchestration packages you prefer. Explicit constraints remain available: `--adapter`, `--max-concurrency`, `--budget-usd`, `--presentation`, and `--no-presentation`.

Automatic preparation:

- reads bounded, project-local evidence without following symlinks or reading secret values;
- chooses a minimal coherent capability set and explicitly excludes competing orchestrators;
- preserves an existing root `AGENTS.md` or `CLAUDE.md` and installs its companion instructions at `.forgeyard/HOST.md`;
- makes presentation work opt-in from the request or an explicit flag;
- stores the decision so `forgeyard update` does not silently reinterpret later repository drift;
- previews and applies through the same transactional doctor and rollback boundary as manual installation.

The distributed catalog is real, pinned content—not a line-count placeholder. Its attested snapshot contains **1,007 source files**, **211,594 physical lines**, **202 catalog agents**, **183 native skills**, and **105 commands**. The Codex adapter converts those commands into on-demand skills and keeps the original license and provenance visible.

## Advanced manual profiles

| Profile | Intended use | Codex output |
|---|---|---|
| `minimal` | Small trusted lifecycle kernel | 1 reviewer, 1 workflow skill, task/evidence state |
| `hackathon` | Curated idea-to-demo team, four-stage delivery DAG, continuity records, and offline presentation | 52 agent files, 119 skill entrypoints |
| `full` | Entire local capability library | 203 agent files, 290 skill entrypoints |

The totals include Forgeyard-native components. In `full`, 202 agent files and 288 skill entrypoints come from the catalog; Forgeyard adds its reviewer and two workflow/presentation skills.

Catalog size is not prompt size. Root instructions remain navigational, the host discovers compact names and descriptions, and complete instructions load only when a capability is selected. Manual profiles default to four concurrent claims. Automatic preparation infers a smaller project-appropriate limit, normally one to four, and an explicit override may use the supported range of 1–16. No subscription tier or account price is inferred. In every case, 203 installed agent files do not launch 203 workers.

See [Catalog and context](docs/guides/catalog-and-context.md) for the loading model and [Catalog sources](docs/provenance/catalog-sources.md) for exact provenance.

See [Resumable delivery workflow](docs/guides/delivery-workflow.md) for the five-hour DAG, operator commands, worktree path, continuity records, and exact limitations.

## Supported project adapters

Forgeyard renders the selected project composition into three project-scoped layouts:

| Adapter | Native project surface | Full-profile result |
|---|---|---|
| `codex` | `AGENTS.md`, `.agents/skills/`, `.codex/agents/` | 203 agent files, 290 skill entrypoints |
| `claude-code` | `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, `.claude/commands/` | 203 agent files, 185 skills, 105 commands |
| `cursor` | `AGENTS.md`, `.cursor/rules/`, lazily referenced `.cursor/forgeyard/` sources | 493 rules: 490 catalog rules plus 3 Forgeyard rules |

One installation targets one adapter. `prepare` recognizes existing `CLAUDE.md`, Cursor rules, or `AGENTS.md`; otherwise it uses the Codex layout as a portable fallback unless `--adapter` supplies a project constraint. See the [harness guide](docs/guides/harnesses.md) for exact transformations and unsupported features.

## Install from this checkout

```sh
npm ci
npm run build
npm link
forgeyard --help
```

Preparation and manual initialization are offline. Forgeyard does not contact an update service, download packs, send analytics, or activate vendored scripts and hooks. Profiles, schemas, source metadata, templates, and catalog bytes ship inside the npm package.

## Advanced manual installation

`forgeyard init` remains available when you deliberately want a fixed catalog profile. It is not the recommended starting point for ordinary project work.

Interactive curated setup:

```sh
forgeyard init ./my-project --profile hackathon --adapter codex
```

Install the small kernel or the entire catalog:

```sh
forgeyard init ./my-project --profile minimal --adapter codex
forgeyard init ./my-project --profile full --adapter codex
```

Target Claude Code or Cursor with the same profile:

```sh
forgeyard init ./my-project --profile hackathon --adapter claude-code
forgeyard init ./my-project --profile full --adapter cursor
```

Use a reviewed answer file without prompts:

```sh
forgeyard init ./my-project --profile full --adapter codex --answers ./answers.yaml --yes
```

Resolve, render, validate, and preflight without creating the target:

```sh
forgeyard init ./my-project --profile hackathon --adapter codex --answers ./answers.yaml --dry-run --json
```

Codex, Claude Code, and Cursor adapters are executable through the same CLI. Unsupported imported hooks are catalogued and left disabled instead of being silently simulated; Cursor also reports that Claude-style per-agent model, tool, and isolation fields are descriptive rather than enforced.

## Lifecycle commands

The generated host instructions and workflow skill use these commands as implementation machinery. They remain documented for inspection, recovery, and advanced control; normal conversation with a compatible host can stay in product language.

Inspect installed structure, ownership hashes, catalog indexes, and presentation assets:

```sh
forgeyard doctor ./my-project
```

Run the command stored in task `T001` and write a hash-only receipt. Verification requires a real, clean Git `HEAD`:

```sh
git -C ./my-project add --all
git -C ./my-project commit -m "freeze verification candidate"
forgeyard verify T001 --root ./my-project --json
```

Drive the persistent task graph through separate CLI processes:

```sh
forgeyard task status --root ./my-project
forgeyard task claim T001 --worker implementer-1 --root ./my-project
forgeyard task checkpoint T001 --worker implementer-1 --note "RED test captured" --root ./my-project
forgeyard task resume T001 --worker implementer-1 --root ./my-project
forgeyard task complete T001 --worker implementer-1 --receipt <receipt-id> --root ./my-project
```

`claim` enforces dependency readiness, the configured concurrency cap, retry/time budgets, and overlapping write scopes. `checkpoint` and `resume` persist through process interruption. Check a proposed write explicitly with `forgeyard guard T001 src/feature.ts --root ./my-project`. Claude Code projects also invoke the installed guard automatically before native `Write`, `Edit`, and `NotebookEdit` tools.

For isolated branch work, create and validate a task worktree, then integrate it from the clean target branch:

```sh
forgeyard workspace create T001 --worker implementer-1 --root ./my-project
forgeyard workspace validate T001 --worker implementer-1 --root ./my-project
forgeyard workspace integrate T001 --worker implementer-1 --root ./my-project
# Only needed if automatic post-merge cleanup was interrupted:
forgeyard workspace cleanup T001 --worker implementer-1 --root ./my-project
```

Integration is serialized by an atomic, owner-token Git-ref lock that can recover a dead local owner without expiring a live long-running integration. Forgeyard verifies the task branch, stages a no-commit merge, runs the combined-tree command, aborts a failed or conflicted merge, creates the merge commit only after that gate, verifies the frozen integration commit again, and then completes the task. After that durable success point it runs `git worktree remove`, verifies that the exact `.git/worktrees` registration disappeared, and uses one Git ref transaction to confirm the target branch is unchanged while deleting `refs/heads/<worker-branch>` only at the exact validated commit. If the directory is already missing, the same non-force command removes only that worktree's stale Git registration instead of pruning the repository. If cleanup is interrupted, the completed integration remains recorded and `workspace cleanup` retries only the cleanup; Forgeyard never repeats the merge, pushes, deploys, force-deletes an unmerged branch, or deletes an unregistered directory.

Preview or apply an update from the human-owned configuration and packaged registry:

```sh
forgeyard update ./my-project --dry-run --json
forgeyard update ./my-project --yes
```

Reverse an applied operation by its ID:

```sh
forgeyard rollback 20260915T120000000Z-init-a1b2c3 --root ./my-project --yes
```

Rolling back the initial installation is the supported uninstall path. It removes unchanged managed files, preserves `forgeyard.yaml`, and leaves unrelated project files alone. Recovery journals remain under `.forgeyard/state/operations/`.

Human-owned seed files (`PROJECT.md`, the current handoff, and the run report) are also preserved so uninstalling the managed factory does not erase project intent or delivery history.

## Installed shape

The exact tree depends on the project composition and adapter. A Codex project can contain:

```text
AGENTS.md
.agents/skills/forgeyard-workflow/SKILL.md
.agents/skills/<plugin>--<skill>/SKILL.md
.codex/agents/<plugin>--<agent>.toml
.forgeyard/catalog/ecosystem.json
.forgeyard/licenses/wshobson-agents.LICENSE
.forgeyard/tasks/T001.yaml
.forgeyard/tasks/T002.yaml
.forgeyard/tasks/T003.yaml
.forgeyard/tasks/T004.yaml
.forgeyard/COMPOSITION.md
.forgeyard/bin/write-guard.mjs
.forgeyard/knowledge/README.md
.forgeyard/decisions/0000-template.md
.forgeyard/handoffs/CURRENT.md
.forgeyard/reports/RUN_REPORT.md
.forgeyard/usage/README.md
PROJECT.md
presentation/index.html
presentation/styles.css
presentation/app.js
presentation/README.md
forgeyard.yaml
forgeyard.lock
```

`T004` and `presentation/` are present only when presentation support was selected. A focused maintenance suite may contain only the kernel task; a normal non-presentation delivery suite contains `T001` through `T003`.

Claude Code uses `.claude/agents`, `.claude/skills`, and `.claude/commands`; Cursor uses `.cursor/rules` with complete backing instructions below `.cursor/forgeyard`. Forgeyard does not write user-global harness configuration.

`forgeyard.yaml` is a human-owned seed and is never overwritten. Managed output hashes are recorded in `.forgeyard/manifest.json`. Update and rollback stop on an ownership conflict if a managed file changed or an unknown destination would be replaced.

## Safety boundaries

- Verification executes the exact task argv array with shell expansion disabled and records hashes and byte counts, never stdout or stderr bodies.
- Catalog trees reject path traversal, symbolic links, case-fold collisions, and byte drift before rendering.
- Generated paths are project-confined; installs and updates are transactional and reversible.
- Vendored hooks remain disabled content. Forgeyard's original Claude Code hook checks native file-tool paths against the active task before execution; it does not claim to parse arbitrary shell mutations.
- Codex and Cursor expose the same deterministic path decision through `forgeyard guard`, but their project adapters report it as advisory because they do not offer the same project `PreToolUse` contract.
- Prompt permissions express intent; they are not operating-system isolation. Run the host with appropriate repository permissions.
- Automatic deployment, publishing, purchases, account changes, and messaging remain outside the installed workflow unless a future explicit project policy adds them.
- Forgeyard does not silently start paid model clients. Structural adapter and round-trip tests prove the prepared environment, not an authenticated Codex, Claude Code, or Cursor session. Real client execution is host-provided and must be reported as separate evidence.
- Presentation output is local HTML/CSS/JavaScript with no remote assets, analytics, tracking, or inherited event identity.

See [SECURITY.md](SECURITY.md) for the threat model.

## License and provenance

Original Forgeyard code, documentation, packs, and templates are Apache-2.0. The portable catalog is an unmodified, pinned MIT-licensed snapshot of [`wshobson/agents`](https://github.com/wshobson/agents) at commit `4236bb91f8395b0435f1d8b8baf9e8e4c69a8620`.

`npm run catalog:check` verifies all vendored bytes against `packs/ecosystem/vendor/UPSTREAM.json`. `THIRD_PARTY_NOTICES.md` and `SBOM.spdx.json` are generated from the source catalog, installed dependency metadata, the lock graph, and the verified vendor attestation. Release checks fail on changed bytes, missing license text, unknown provenance, path hazards, forbidden identity terms, or unexpected package omissions.

## Development

```sh
npm ci
npm run catalog:check
npm run provenance:check
npm run verify
```

Contribution and release rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Proven behavior is listed in [CHANGELOG.md](CHANGELOG.md).
