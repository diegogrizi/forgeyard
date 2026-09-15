---
name: forgeyard-workflow
description: Use when the user asks to build, change, fix, resume, review, verify, or demonstrate software in this prepared Forgeyard project.
---

# Forgeyard workflow for Signal Garden

Start from the user's product-language request, not from the internal catalog. Forgeyard's job is to convert that request into a bounded, resumable, evidence-backed delivery loop.

## Orient and clarify

Read `forgeyard.yaml`, `.forgeyard/COMPOSITION.md`, `PROJECT.md` when present, `.forgeyard/handoffs/CURRENT.md`, and Git status. The prepared project purpose is: Help a small team demonstrate one trustworthy user journey.

Ask one concise product or constraint question only when `intake.questions` contains an unresolved item or the current request has unresolved product ambiguity that would materially change the result. Do not ask the user to select skills, roles, workflow phases, authors, or internal commands. If the current request conflicts with the stored task contract, stop and explain the mismatch instead of weakening evidence traceability.

## Controller loop

1. Run `forgeyard task status --root . --json`. Resume an active task from its checkpoint before selecting new work.
2. Run `forgeyard task next --root . --json`. Treat each returned work order as the complete bounded dispatch contract.
3. In `guided` mode, execute the single returned `hostPrompt`. In `native` mode, dispatch up to the returned orders through the host-native worker or subagent facility, one prompt per worker. If the host has no such facility, execute one order at a time. `task next` does not claim tasks and does not launch model clients.
4. The worker follows the returned `hostPrompt`: claim before editing, stay inside write scopes, checkpoint durable progress, run the exact verification, and complete only with a current receipt.
5. Use a worktree only for concurrent writing tasks. After validation, run `forgeyard workspace integrate`; successful integration removes the registered worktree, its Git administration entry, and only the merged worker branch. If cleanup is interrupted after integration, retry `forgeyard workspace cleanup`; do not repeat integration or delete an unregistered directory.
6. Continue until no work order remains or a governed stop requires user input. Update the handoff and run report with the exact revision, receipts, open risks, and next product action.

## Governing decisions

- `unmeasured` cost means no explicit provider observation exists; it never means zero. Record usage only from an actual host/provider observation.
- `measured` cost is enforced against the task ceiling. A cost stop, deadline, retry stop, stale receipt, scope conflict, or material ambiguity is a real stop—not permission to bypass the gate.
- Installed agents and skills are capabilities to load when a work order names them, not running processes and not content to load wholesale.
- Push, publish, deploy, messages, purchases, and every other external effect require explicit authorization at the point of action.
- Report `implemented`, `verified`, `reviewed`, and `demo-ready` as distinct states. Never promote evidence from an older task definition, argv, or Git revision.

Configured horizon: 300 minutes. Maximum active claims: 4.

Configured quality commands:

- test: ["node","-e","process.exit(0)"]
