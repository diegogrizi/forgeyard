# Governed project work orders implementation plan

> **Execution rule:** implement one task at a time with tests red before production changes; commit each coherent task on `main`.

**Goal:** Make a prepared Forgeyard suite translate its stored product request into project-specific, budget-governed work orders that a compatible host can execute without asking the user to sequence internal lifecycle commands.

**Architecture:** Keep host execution native and explicit. Task YAML remains the durable contract; the scheduler remains the transition authority; the local ledger remains the only cost evidence. `task next` derives bounded work orders from those three sources. No model client is launched and no absent provider measurement is treated as zero cost.

**Constraints:** Deterministic output, argv-only commands, project confinement, stable saved composition, no network, no credential discovery, no silent external effects, exact worktree cleanup semantics, and backward compatibility for manual profiles.

---

## Task 1: Render the actual project request and allocated budget into task contracts

**Files:**
- Modify: `packs/foundation/templates/task.yaml.tpl`
- Modify: `packs/delivery/templates/T002.yaml.tpl`
- Modify: `packs/delivery/templates/T003.yaml.tpl`
- Modify: `packs/presentation/templates/T004.yaml.tpl`
- Modify: `src/adapters/factory-context.ts`
- Modify: `src/adapters/codex.ts`
- Modify: `src/adapters/claude-code.ts`
- Modify: `src/adapters/cursor.ts`
- Modify: `tests/unit/adapters/delivery-output.test.ts`

- [x] Add failing assertions that every rendered task contains the stored request, a project-kind role/capability selection, and—when configured—a deterministic share of the total USD budget.
- [x] Add shared bounded task wording and budget-allocation helpers.
- [x] Render valid YAML for manual and automatic configurations; omit `maxCostUsd` when no budget exists.
- [x] Run adapter and schema tests.
- [x] Commit as `feat: tailor generated project tasks`.

## Task 2: Read explicit usage and enforce task cost limits

**Files:**
- Modify: `src/observability/ledger.ts`
- Modify: `src/orchestrator/contracts.ts`
- Modify: `src/orchestrator/scheduler.ts`
- Modify: `schemas/run-state.schema.json`
- Modify: `tests/unit/observability/ledger.test.ts`
- Modify: `tests/integration/orchestrator/scheduler.test.ts`

- [ ] Add failing tests for deterministic usage summaries, malformed ledger rejection, unmeasured cost, claim refusal at the recorded limit, and completion refusal above it.
- [ ] Implement a bounded ledger reader that validates every event and sums only explicit usage observations.
- [ ] Add a scheduler cost port and durable `cost-budget-exhausted` stop reason.
- [ ] Preserve the distinction between unmeasured and zero-cost observations.
- [ ] Run ledger, scheduler, state-schema, and type tests.
- [ ] Commit as `feat: enforce recorded task budgets`.

## Task 3: Return host-executable work orders from `task next`

**Files:**
- Create: `src/orchestrator/work-orders.ts`
- Modify: `src/orchestrator/contracts.ts`
- Modify: `src/application/orchestration.ts`
- Modify: `src/cli/program.ts`
- Create: `tests/unit/orchestrator/work-orders.test.ts`
- Modify: `tests/unit/cli/task-program.test.ts`

- [ ] Add failing tests proving guided mode returns one order and native mode returns at most remaining capacity.
- [ ] Include task ID, title, objective, role, capabilities, write scopes, remaining time, measured/unmeasured cost state, and an exact host prompt.
- [ ] Make `task next --json` return work orders while `task status` remains a state view.
- [ ] Keep lifecycle claims explicit; generating an order must not claim or launch a worker.
- [ ] Run work-order, application, CLI, and scheduler tests.
- [ ] Commit as `feat: expose bounded host work orders`.

## Task 4: Turn the generated workflow skill into the ordinary controller

**Files:**
- Modify: `packs/foundation/skills/forgeyard-workflow/SKILL.md.tpl`
- Modify: `packs/foundation/templates/AGENTS.md.tpl`
- Modify: `docs/guides/delivery-workflow.md`
- Create: `tests/roundtrip/controller-work-orders.test.ts`

- [ ] Add a failing round-trip that prepares a project and proves the generated controller routes a natural-language request through questions, work orders, claims, verification, integration/cleanup, and evidence-backed reporting without asking the user to choose skills.
- [ ] Document guided/native dispatch, cost measurement semantics, ambiguity stops, and external-effect authorization.
- [ ] Verify existing host-instruction preservation and no client-launch claim.
- [ ] Run the packaged round-trip and release audit.
- [ ] Commit as `feat: make the host skill the workflow controller`.

## Task 5: Close the governed-work-order milestone

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-15-manifesto-aligned-factory-design.md`
- Modify: this plan

- [ ] Update documentation only for behavior proved by tests.
- [ ] Run `npm run verify`, `git diff --check`, and inspect `npm pack --dry-run --json`.
- [ ] Confirm `main` is the only registered local worktree and no forbidden identity term exists.
- [ ] Commit as `feat: complete governed project work orders`.
