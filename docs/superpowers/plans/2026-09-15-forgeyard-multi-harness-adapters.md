# Forgeyard multi-harness adapter implementation plan

**Goal:** Render the complete pinned catalog and Forgeyard-native workflow into structurally valid, project-scoped Codex, Claude Code, and Cursor layouts without global installation or runtime downloads.

**Architecture:** Keep one canonical profile and catalog resolver. Generalize the harness identifier at the configuration, lock, manifest, application, and doctor boundaries, then implement independent adapter renderers. Claude Code receives native project agents, skills, commands, and restrictive project settings. Cursor receives agent-requested MDC rules backed by local, lazily referenced instruction files because its public project contract does not enforce Claude-style per-agent tools or models.

**Verified references:** Current official Claude Code plugin, skill, subagent, and hook documentation; current official Cursor project-rule and CLI documentation; the pinned MIT portable catalog already attested in Forgeyard.

## Constraints

- Supported harness IDs are `codex`, `claude-code`, and `cursor`.
- One install targets one harness; updates may switch harnesses transactionally through the human-owned configuration.
- No adapter writes user-global settings, installs marketplaces, contacts a network, or activates imported hooks.
- Agent, skill, and command IDs are plugin-namespaced and collision checked.
- All derived files remain owned by the source catalog component and reversible file by file.
- Claude Code dynamic skill shell expansion is disabled by generated project settings unless a later explicit policy opts in.
- Cursor tool allowlists, models, hooks, and true subagent isolation are reported as unsupported or adapted, never claimed as enforced.
- Behavior changes use RED, GREEN, focused verification, and a separate commit per task.

## Task 1: Generalize the harness boundary

- [ ] Add a `HarnessId` contract and widen configuration, profile resolution, install plans, lock files, manifests, schemas, and wizard choices.
- [ ] Add an adapter factory and make the application and doctor select adapters from installed metadata.
- [ ] Preserve existing Codex outputs and stable check IDs.
- [ ] Test all accepted harness IDs, unknown-ID rejection, lock/manifest parsing, and executable discovery names.
- [ ] Commit as `feat: generalize Forgeyard harness selection`.

## Task 2: Render the portable catalog for Claude Code

- [ ] Write transform tests for namespaced agents, native skills, native commands, supporting files, metadata filtering, command collisions, license/index output, and disabled shell expansion.
- [ ] Generate `.claude/agents/`, `.claude/skills/`, `.claude/commands/`, `.claude/settings.json`, and Forgeyard catalog/license metadata.
- [ ] Preserve supported Claude frontmatter and source bodies; never copy or enable imported hook configuration.
- [ ] Run a full-catalog golden test expecting 202 catalog agents, 183 catalog skills, and 105 catalog commands.
- [ ] Commit as `feat: render the licensed catalog for Claude Code`.

## Task 3: Complete the Claude Code project adapter

- [ ] Map foundation and presentation slots to `CLAUDE.md`, native Forgeyard skills, a read-only reviewer agent, task state, and offline presentation assets.
- [ ] Validate every generated Markdown frontmatter document, settings JSON, task YAML, path, and catalog count.
- [ ] Add minimal, hackathon, and full built-CLI round trips plus doctor coverage.
- [ ] Commit as `feat: add the Claude Code factory adapter`.

## Task 4: Render the portable catalog for Cursor

- [ ] Write transform tests for agent-requested `.cursor/rules/*.mdc` files and lazily referenced local instruction trees.
- [ ] Preserve full agent, skill, command, and supporting-file content below `.cursor/forgeyard/` while keeping each discovery rule compact.
- [ ] Emit an explicit capability report for unenforced models, tool allowlists, hooks, and subagent isolation.
- [ ] Run a full-catalog golden test expecting 490 catalog rules backed by 202 agent, 183 skill, and 105 command instruction entries.
- [ ] Commit as `feat: render the licensed catalog for Cursor`.

## Task 5: Complete the Cursor project adapter

- [ ] Map foundation and presentation slots to `AGENTS.md`, Forgeyard MDC rules, task state, and offline presentation assets.
- [ ] Validate MDC frontmatter, local references, task YAML, path uniqueness, and presentation output.
- [ ] Add minimal, hackathon, and full built-CLI round trips plus doctor coverage.
- [ ] Commit as `feat: add the Cursor factory adapter`.

## Task 6: Close documentation and release gates

- [ ] Document exact per-harness mappings and capability differences.
- [ ] Add package and release assertions for all adapter modules and public claims.
- [ ] Run `npm ci`, `npm run verify`, `npm run audit:dependencies`, a dynamic forbidden-identity scan, and `git diff --check`.
- [ ] Commit as `docs: publish the Forgeyard harness matrix`.

## Completion boundary

This plan closes native project output for the three required harnesses. It does not by itself close the separate task-graph scheduler, resumability, write-scope pre-tool guard, or run-ledger acceptance criteria; those receive the next executable plan.
