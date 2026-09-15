# Harness adapters

Forgeyard authors project intent and pack selection once, then renders a native or explicitly adapted project layout for one selected harness. Initialization never installs global plugins, edits a home-directory configuration, or downloads catalog content.

The source snapshot exposes **202 agents, 183 skills, and 105 commands**. Every adapter preserves those instructions and their local supporting files, but the discovery and enforcement surfaces differ.

## Capability matrix

| Capability | Codex | Claude Code | Cursor |
|---|---|---|---|
| Root instructions | `AGENTS.md` | `CLAUDE.md` | `AGENTS.md` |
| Skills | Native `.agents/skills/` | Native `.claude/skills/` | Agent-requested `.cursor/rules/` plus local sources |
| Agents | Native TOML definitions | Native Markdown subagents | Adapted agent-requested rules |
| Commands | Converted to namespaced skills | Native `.claude/commands/` | Adapted agent-requested rules |
| Per-agent model | Adapter mapping | Preserved | Descriptive only |
| Per-agent tools | Read-only/workspace heuristic | Preserved | Descriptive only |
| Imported hooks | Disabled | Disabled | Disabled |
| Project guard hook | Added only by the separate guardrail layer | Added only by the separate guardrail layer | Advisory validation; no equivalent pre-tool contract claimed |
| Default concurrency | 4 | 4 | 4 |

## Codex

The full profile creates 202 catalog agent TOML files and 288 catalog skill entrypoints. Commands become skills because Codex has no matching project-command artifact. Forgeyard adds one reviewer and two native skills, for 203 agent files and 290 skill entrypoints total. Primary skill files are capped at 8 KiB and link overflow references.

## Claude Code

The full profile creates 202 catalog agents, 183 skills, and 105 commands in native project directories. Forgeyard adds a reviewer plus workflow and showcase skills. Source hook fields and hook files are not activated. Project `.claude/settings.json` sets `disableSkillShellExecution` to `true`, so skill preprocessing cannot silently run embedded shell expressions; a future explicit policy would be required to opt in.

Plugin marketplace installation is unnecessary for generated projects. Flattened, plugin-namespaced project paths avoid cross-plugin collisions and are discovered by Claude Code directly.

## Cursor

Cursor's documented project extension surface is MDC rules. Forgeyard therefore creates **490 agent-requested rules** for the catalog and three more for its workflow, reviewer, and showcase. Each compact rule points to a complete local instruction file under `.cursor/forgeyard/`; supporting references remain adjacent to their owning skill.

This is progressive disclosure: rule descriptions are discoverable, while the complete body enters context only when the rule is selected. Cursor rules do not enforce Claude-specific model aliases, tool allowlists, hook fields, or worktree isolation, so the generated catalog index counts those limitations instead of claiming parity that the host does not provide.

## Structural versus real-client verification

`forgeyard doctor` validates the selected adapter's paths, syntax, references, managed hashes, presentation bundle, and catalog index. It checks whether `codex`, `claude`, or `cursor-agent` is discoverable without invoking it. Real authenticated client runs are separate host checks and are reported as skipped unless explicitly exercised.

Current format references:

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Cursor project rules](https://docs.cursor.com/context/rules-for-ai)
- [Cursor CLI](https://docs.cursor.com/en/cli/using)
