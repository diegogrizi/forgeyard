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
| Project write guard | Advisory `forgeyard guard` | Native `PreToolUse` for file tools plus CLI | Advisory `forgeyard guard` |
| Task DAG scheduler | Shared local CLI | Shared local CLI | Shared local CLI |
| Default concurrency | 4 | 4 | 4 |

## Codex

The full profile creates 202 catalog agent TOML files and 288 catalog skill entrypoints. Commands become skills because Codex has no matching project-command artifact. Forgeyard adds one reviewer and two native skills, for 203 agent files and 290 skill entrypoints total. Primary skill files are capped at 8 KiB and link overflow references.

Codex projects include the dependency-free guard script and the common task CLI, but no native project hook is claimed. Agents must call `forgeyard guard` before a proposed write when the host itself does not enforce the scope.

## Claude Code

The full profile creates 202 catalog agents, 183 skills, and 105 commands in native project directories. Forgeyard adds a reviewer plus workflow and showcase skills. Source hook fields and hook files are not activated. Project `.claude/settings.json` sets `disableSkillShellExecution` to `true`, so skill preprocessing cannot silently run embedded shell expressions; a future explicit policy would be required to opt in.

Plugin marketplace installation is unnecessary for generated projects. Flattened, plugin-namespaced project paths avoid cross-plugin collisions and are discovered by Claude Code directly.

Forgeyard's original project hook matches `Edit|Write|NotebookEdit`. It binds the hook session to an active claimed task, resolves existing path ancestors to prevent link escape, and denies ambiguous identity, project escape, protected paths, or paths outside the task scope. An allowed result emits no approval, so normal Claude Code permissions still apply. Arbitrary shell commands are not claimed as deterministically path-guarded because parsing every shell mutation would be unsafe; host permission rules and explicit task policy still govern `Bash`.

## Cursor

Cursor's documented project extension surface is MDC rules. Forgeyard therefore creates **490 agent-requested rules** for the catalog and three more for its workflow, reviewer, and showcase. Each compact rule points to a complete local instruction file under `.cursor/forgeyard/`; supporting references remain adjacent to their owning skill.

This is progressive disclosure: rule descriptions are discoverable, while the complete body enters context only when the rule is selected. Cursor rules do not enforce Claude-specific model aliases, tool allowlists, hook fields, or worktree isolation, so the generated catalog index counts those limitations instead of claiming parity that the host does not provide.

Cursor receives the common guard script and CLI contract, but no equivalent native pre-tool hook is claimed.

## Structural versus real-client verification

`forgeyard doctor` validates the selected adapter's paths, syntax, references, managed hashes, presentation bundle, and catalog index. It checks whether `codex`, `claude`, or `cursor-agent` is discoverable without invoking it. Real authenticated client runs are separate host checks and are reported as skipped unless explicitly exercised.

Current format references:

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks-guide)
- [Cursor project rules](https://docs.cursor.com/context/rules-for-ai)
- [Cursor CLI](https://docs.cursor.com/en/cli/using)
