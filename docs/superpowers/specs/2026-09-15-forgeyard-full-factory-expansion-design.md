# Forgeyard Full Factory Expansion

## Status and correction

**Status:** Historical catalog-and-kernel milestone completed on 2026-09-15; it is not a claim that the manifesto-level factory is complete. The later problem-first design supersedes its user-entry and composition assumptions. Authenticated model-client launch, external effects, wider harnesses, and multi-repository coordination remain outside this milestone.

The first Forgeyard M1 was a reliable installer kernel, not the complete factory requested by the product owner. This expansion combined that kernel with the licensed catalog, three adapters, executable local orchestration, guardrails, continuity assets, and the idea-to-demo workflow described below. It did not yet remove the user's obligation to choose profiles and ecosystem components; the later manifesto-aligned work adds that missing layer.

The benchmark's bootstrap commit added 409 files and 81,997 physical lines in one operation. Its installed surface contained 32 direct agent definitions, 102 direct skills, 45 direct commands, 73 canonical tool files, 22 compatibility tool files, and a 64-file optional voice subsystem. The 32 agents were available roles, not 32 simultaneous workers: the installed scheduler capped parallel work at four.

The correction is to preserve the tested kernel and add a large, licensed, English-language component catalog plus executable workflow layers. The catalog may be large on disk while remaining lazy in model context.

### Recorded milestone evidence

- At the recorded milestone revision, the clean gate passed 55 test files and 276 tests, then build, catalog attestation, provenance generation check, release audit, and package-content inspection. These counts are historical, not the current repository total.
- The pinned source catalog remains 1,007 files and 211,594 physical lines with 202 agents, 183 skills, and 105 commands.
- The package dry-run contains 1,149 entries.
- The dependency audit reports zero known vulnerabilities at the configured threshold.
- The five-hour fixture resumes through fresh CLI processes, proves an older receipt stale after a new code commit, completes all four DAG tasks, and passes the offline presentation audit.

## Product target

Forgeyard is a project-scoped installer and lifecycle manager for agent-assisted development factories. In the current problem-first interface, the user describes the software outcome and material constraints; Forgeyard inspects the project and selects a tailored profile, harness layout, capabilities, and safety limits. Fixed manual profiles remain an advanced interface.

Forgeyard must support two distinct ideas:

1. A small trusted kernel that plans, installs, validates, updates, and rolls back files.
2. A broad catalog that is discoverable on demand and can exceed the benchmark without injecting every instruction into every prompt.

The `hackathon` profile installs a curated delivery team and five-hour workflow. The `full` profile installs the entire licensed catalog. The automatic `tailored` profile selects smaller project-specific subsets without changing the kernel.

## Catalog strategy

Forgeyard will distribute an exact pinned snapshot of the MIT-licensed `wshobson/agents` portable plugin catalog. The source snapshot is English, already organized around progressive disclosure, and contains native concepts for agents, skills, commands, hooks, and multiple harnesses.

The vendored snapshot is immutable:

- source URL: `https://github.com/wshobson/agents`
- revision: `4236bb91f8395b0435f1d8b8baf9e8e4c69a8620`
- license: MIT
- upstream copyright and license text remain intact
- vendored bytes are verified against a machine-readable inventory

Forgeyard-specific behavior is authored separately under the Apache-2.0 project license. Concepts observed in unlicensed benchmark material may inform clean-room behavior, but its wording or source code is not redistributed.

## Required capability surface

The complete factory must cover at least these layers:

- project intake and stack detection;
- purpose, requirements, epics, user stories, and task decomposition;
- task graph, dependency validation, state transitions, and resumability;
- bounded scheduling with a default maximum concurrency of four;
- architecture, frontend, backend, database, testing, documentation, accessibility, UX, security, and release roles;
- per-agent write scopes and deterministic path guards;
- TDD, debugging, code review, verification, and integration gates;
- worktree-aware isolation and serialized integration;
- evidence receipts tied to task, command, and Git revision;
- local memory, knowledge, decision, and run-report structures;
- cost/time ledger and post-session analysis without credential capture;
- prototype generation and a polished offline HTML presentation workflow;
- transactional install, update, rollback, and uninstall;
- Codex, Claude Code, and Cursor native outputs;
- provenance, notices, SBOM, deny-term scans, and reproducible package checks.

Optional voice, semantic search, and heavyweight external runtimes remain opt-in. Their absence must not weaken the core development workflow.

## Profiles

### `minimal`

Foundation instructions, one workflow skill, one reviewer, task state, evidence, doctor, update, and rollback.

### `hackathon`

Everything needed to turn an idea into a demonstrable vertical slice within a five-hour timebox:

- discovery and product framing;
- architecture and task decomposition;
- frontend, backend, data, QA, accessibility, UX, security, and documentation roles;
- bounded parallel scheduling;
- verification evidence;
- offline presentation, demo script, and fallback artifacts.

At least 32 role definitions must be available to this profile, while the scheduler still defaults to four concurrent workers.

### `full`

All locally distributable catalog plugins and all Forgeyard-native workflow packs. The full profile is an on-disk capability library, not an instruction to launch every role.

## Canonical component model

File components remain supported. A new tree component represents an immutable directory of licensed portable plugin material:

```yaml
- id: ecosystem.portable-catalog
  kind: catalog
  entry: vendor
  entryType: tree
  format: portable-plugin-marketplace-v1
  slot: catalog.portable.primary
  template: false
  ownership: managed
  requires: []
  conflicts: []
```

The registry recursively validates tree components, rejects links and case-fold collisions, records every relative path and SHA-256, and computes a deterministic aggregate hash. Installer ownership remains file-granular after adapter rendering.

## Harness behavior

### Codex

- skills become `.agents/skills/<plugin>--<skill>/SKILL.md` plus references/assets;
- agents become `.codex/agents/<plugin>--<agent>.toml`;
- commands become user-invocable skills because commands are not a native Codex component;
- oversized skill bodies are split at safe section boundaries with explicit reference pointers;
- unsupported hooks remain catalogued but disabled and reported honestly.

### Claude Code

- agents, skills, and commands render into native project directories;
- imported catalog hooks remain disabled, while Forgeyard's original project-scoped file-tool guard is activated explicitly;
- no global marketplace or shell-profile mutation occurs.

### Cursor

- portable skills and agents are emitted in Cursor-supported project paths;
- command and model differences are adapted explicitly;
- unsupported enforcement is reported rather than simulated silently.

## Context budget

Catalog size and prompt size are measured separately. Forgeyard generates a compact index containing names, descriptions, triggers, and paths. Full bodies load only after a matching capability is selected. Context files remain navigational and may not embed the whole catalog.

The release gate records:

- distributed catalog files and physical lines;
- installed agents, skills, commands, and references per harness;
- largest skill body and every split performed;
- duplicate IDs and output collisions;
- unsupported capabilities per harness.

The full distributed catalog must contain at least 80,000 non-generated, licensed physical lines. This is a completeness floor, not a quality score.

## Security and ownership

- Tree traversal, symlinks, hard-link surprises, case collisions, and output escapes are rejected.
- Imported content cannot write outside declared project paths by itself.
- Hook activation requires an explicit profile choice and a supported harness.
- Generated task commands use argv arrays, never interpolated shell strings.
- Secrets, absolute user paths, local logs, transcripts, and runtime evidence are never vendored.
- Installed files remain managed or seeded individually and can be rolled back.

## Provenance and release policy

Every vendored tree has a source record, immutable revision, license, inventory, and preserved license file. Generated notices name vendored sources separately from npm dependencies. Release checks fail for unreferenced sources, changed vendor bytes, unknown licenses, missing notices, forbidden identity terms, or unreviewed remote assets.

Distributed presentation content remains original, offline, responsive, accessible, and neutral. No competition, employer, organizer, participant, or team branding may appear in templates, skills, examples, assets, or metadata.

## Acceptance criteria

This historical expansion milestone was considered complete only when:

- `full` installs at least 80,000 licensed catalog lines;
- `hackathon` exposes at least 32 roles and a complete idea-to-demo workflow;
- catalog metadata proves the exact counts of agents, skills, commands, and references;
- Codex, Claude Code, and Cursor outputs pass structural and golden tests;
- the default scheduler caps concurrency at four and never equates installed roles with active workers;
- a generated fixture resumes after interruption and invalidates stale evidence after code changes;
- write-scope guards block an out-of-scope mutation before a tool executes where the harness supports hooks;
- presentation output is fully offline and contains no forbidden identity terms;
- install, update, rollback, and uninstall preserve user-owned files;
- every distributed byte has attributable provenance and the release gate passes from a clean install.

All criteria above that are enforceable without an authenticated external model client pass in the recorded local gate. Real-client invocation remains a separate optional host-evidence claim, not an inferred success.
