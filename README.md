# Forgeyard

```sh
npx forgeyard init ./my-project --profile hackathon --adapter codex
```

Forgeyard installs a project-scoped, auditable workflow for agent-assisted software development. It is a factory for instructions, skills, reviewer roles, verification tasks, evidence receipts, and an offline presentation—not an LLM runtime, model router, or fleet of background workers.

M1 supports Node.js 24.19, the `hackathon` profile, and the Codex adapter. Task execution and evidence receipts are emulated by the local Forgeyard CLI. Other harness adapters and a native scheduler are not claimed.

## What the hackathon profile optimizes

The profile is designed for a short build window. It asks for one concrete purpose, installs a workflow that prioritizes the shortest visible user slice, binds verification evidence to a clean Git revision, and creates a presentation bundle that works without network access.

The installed file count is not the prompt size. `AGENTS.md` stays navigational, while detailed workflows live in project skills that Codex loads when relevant. Likewise, a reviewer definition is a role contract, not a running process. Forgeyard M1 launches no worker fleet; its default maximum concurrency is four work items for a human or compatible harness to coordinate deliberately.

## Install from this checkout

```sh
npm ci
npm run build
npm link
forgeyard --help
```

The package does not contact an update service, send analytics, or download packs at runtime. The selected profile, schemas, source catalog, and pack bodies ship with the package.

## Commands

Interactive initialization:

```sh
forgeyard init ./my-project --profile hackathon --adapter codex
```

Non-interactive initialization from a reviewed answer file:

```sh
forgeyard init ./my-project --profile hackathon --adapter codex --answers ./answers.yaml --yes
```

Resolve, render, validate, and preflight without creating the target:

```sh
forgeyard init ./my-project --profile hackathon --adapter codex --answers ./answers.yaml --dry-run --json
```

Inspect installed structure, ownership hashes, generated content, and the offline presentation:

```sh
forgeyard doctor ./my-project
```

Run the command stored in task `T001` and write a hash-only receipt. Verification requires a real, clean Git `HEAD`:

```sh
git -C ./my-project add --all
git -C ./my-project commit -m "freeze verification candidate"
forgeyard verify T001 --root ./my-project --json
```

Preview or apply an update from the installed human configuration and the packaged registry:

```sh
forgeyard update ./my-project --dry-run --json
forgeyard update ./my-project --yes
```

Reverse the latest applied install or update by its operation ID:

```sh
forgeyard rollback 20260915T120000000Z-init-a1b2c3 --root ./my-project --yes
```

Rolling back the initial installation is the supported uninstall path. It removes unchanged Forgeyard-managed files, preserves `forgeyard.yaml`, and leaves unrelated project files alone. Operation and recovery journals remain under `.forgeyard/state/operations/`.

## Installed layout

```text
AGENTS.md
.agents/skills/forgeyard-workflow/SKILL.md
.agents/skills/forgeyard-showcase/SKILL.md
.codex/agents/reviewer.toml
.forgeyard/tasks/T001.yaml
presentation/index.html
presentation/styles.css
presentation/app.js
presentation/README.md
forgeyard.yaml
forgeyard.lock
```

`forgeyard.yaml` is a human-owned seed. Forgeyard never overwrites local changes to it. Other listed outputs are managed: their installed hashes are recorded in `.forgeyard/manifest.json`. Update and rollback stop with an ownership conflict if a managed file was changed or an unknown destination would be replaced. Reconcile that file explicitly before retrying.

## Privacy and execution boundaries

- `doctor --deny-term` keeps supplied terms in process memory and reports only generic rule IDs and paths.
- Verification executes the exact argv array stored in the selected task with shell expansion disabled. It records hashes and byte counts, never stdout or stderr bodies.
- The generated presentation uses local HTML, CSS, JavaScript, and system fonts. It has no remote assets, analytics, embeds, or network calls.
- Agent prompt permissions are instructions, not operating-system isolation. Run Codex and Forgeyard with OS permissions appropriate for the repository.
- M1 does not perform automatic deployments, purchases, account changes, issue updates, or other external side effects.

See [SECURITY.md](SECURITY.md) for the threat model and disclosure path.

## License and provenance

Original Forgeyard code, documentation, packs, and templates are licensed under Apache-2.0. Direct dependencies have exact catalog records in `sources/catalog.yaml`; `THIRD_PARTY_NOTICES.md` and `SBOM.spdx.json` are generated deterministically from that catalog, installed metadata, and the complete npm lock graph.

Non-original pack content cannot pass the release validator without a referenced source record and known license. M1 pack bodies are marked `original`; references studied during design are not copied into the distributed packs. The design rationale and future boundaries are recorded in the [architecture specification](docs/superpowers/specs/2026-09-15-forgeyard-architecture-design.md).

## Development

```sh
npm ci
npm run provenance:check
npm run verify
```

Contribution and release rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Proven behavior is listed in [CHANGELOG.md](CHANGELOG.md).
