# Catalog and context

Forgeyard deliberately separates the amount of useful material installed on disk from the amount of text placed in a model prompt.

## What is actually distributed

The pinned ecosystem snapshot contains **1,007 source files** and **211,594 physical lines**. Its portable inventory has **202 catalog agents**, **183 native skills**, **105 commands**, and supporting files. These are real local files verified by hash, not generated filler.

For Codex, Forgeyard translates the portable inventory as follows:

| Portable component | Codex output | Loading behavior |
|---|---|---|
| Agent | `.codex/agents/<plugin>--<agent>.toml` | Selected as a role when useful |
| Skill | `.agents/skills/<plugin>--<skill>/SKILL.md` | Metadata discovered first; body loaded on demand |
| Command | A namespaced skill entrypoint | Invoked deliberately by name or trigger |
| Reference or asset | A file beside its owning skill | Read only when the skill points to it |
| Hook | Catalog capability note | Disabled when the adapter cannot enforce it safely |

The full Codex result contains **203 agent files** and **290 skill entrypoints** after adding Forgeyard's reviewer, workflow skill, and presentation skill. The curated hackathon result contains **52 agent files** and **119 skill entrypoints**.

## Why the context does not explode

Loading is progressive:

1. `AGENTS.md` provides a short map of project authority and workflow.
2. The host discovers compact skill names and descriptions.
3. A matching capability loads one primary `SKILL.md`.
4. That skill can point to focused references or assets.
5. Repository search retrieves only the code regions needed for the current task.

Forgeyard caps generated primary skill entrypoints at 8 KiB. Longer upstream instructions are split outside fenced code blocks and linked as references. The complete catalog therefore remains searchable on disk without becoming one enormous system prompt.

## Profiles and runtime reality

| Profile | Catalog selection | Installed Codex inventory |
|---|---|---|
| `minimal` | None | 1 agent file, 1 skill entrypoint |
| `hackathon` | Curated 22-plugin selection | 52 agent files, 119 skill entrypoints |
| `full` | Every local plugin | 203 agent files, 290 skill entrypoints |

An agent file is a role contract, not a process. Installing 203 roles does not start 203 models, terminals, or worktrees. The **maximum concurrency remains 4** by default, and the Forgeyard CLI coordinates claims without launching a worker fleet. Its local scheduler exposes only a small dependency-ready subset; the operator or compatible host starts the actual worker.

The practical advantage of a large library is preparation: architecture, product, frontend, backend, data, QA, security, accessibility, documentation, operations, and presentation capabilities are already locally discoverable when a short build begins. The advantage does not come from reading or running all of them.

## Which profile to use

- Choose `minimal` when testing the lifecycle kernel or adding Forgeyard to a sensitive existing repository.
- Choose `hackathon` for a short delivery window where discovery, implementation, proof, and presentation all matter.
- Choose `full` when you want the whole offline library available and accept a larger project tree.

All three profiles use the same path confinement, ownership hashes, update checks, rollback journal, evidence format, and default concurrency policy.

## Physical line inventory

The 0.1.0 acceptance snapshot counts UTF-8 physical lines from `git ls-files`; generated `dist/` output and `node_modules/` are not tracked and are excluded. Categories below are stated separately because a repository total is not the same thing as authored implementation.

| Measurement | Files | Physical lines |
|---|---:|---:|
| Authored executable implementation (`src/`, release tooling, build/test configuration, and the two shipped JavaScript runtimes) | 55 | 10,327 |
| Authored tests | 57 | 6,416 |
| Test and golden fixtures | 18 | 1,368 |
| Attested upstream catalog source | 1,007 | 211,594 |
| Packaged vendor directory, including its license, attestation, and npm carrier | 1,010 | 211,649 |
| All tracked non-vendor material, including authored assets, documentation, generated SBOM/notices, manifests, and lockfiles | 189 | 37,059 |
| Entire tracked repository | 1,199 | 248,708 |

The implementation, test, and fixture rows are focused measurements, while the two final rows are complete partitions against the packaged vendor directory. Generated provenance and dependency lock data are deliberately not described as hand-authored code.
