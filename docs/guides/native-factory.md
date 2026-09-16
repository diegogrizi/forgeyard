# Native-first Forgeyard

Forgeyard is a factory, not a second coding assistant. You keep working in your
chosen Codex or Claude Code app/CLI. That assistant understands the product and
uses deterministic local Forgeyard tools to prepare its harness and check work.
No AI client, provider API, account, subscription or model session is launched
or configured by the factory.

## Start from a problem

Build this unpublished checkout using npm ci and npm run build, with Node
>=24.19.0 <25. Connect from the product directory:

~~~sh
node /absolute/path/to/forgeyard/dist/cli/main.js connect --root . --client codex
~~~

Choose claude-code instead for Claude Code. The owned project-local MCP namespace
and instruction pointer preserve foreign settings. Tracked client configurations
are refused rather than overwritten with machine paths. Enable/trust the server
through the native client if required, then reopen the project. No global or
account settings and no automatic trust policy changes occur.

Say: "This is the repository, these are the requirements and constraints.
Prepare the right environment, then implement and verify the result."

The assistant reads first, proposes intent/risk/capabilities/hash-bound evidence,
then uses the resolver. It chooses minimal dependency-closed admitted coverage
with one coordinator and reasoned exclusions. It does not ask you to pick skill
authors. Missing capability coverage fails explicitly, not as imaginary expertise.

Optional setup constraints let the assistant propose project-relative mutable
paths, real quality/test commands and their working directories, timebox,
supervision, optional presentation, concurrency and recorded-cost ceiling.
Detection is not execution. A Git diff check alone cannot certify writing work.
The preview exposes policy, gates, capsule ID, file changes and scan limits.

Installation atomically reserves the tree before its local confirmation. Only
the exact approved render enters the transactional installer. This prepares the
harness; it does not implement an application.

## Ordinary development loop

1. Read fy_context and referenced project inputs; attach one cooperative writer.
2. Create a new fy_plan for each outcome: requirements, dependent tasks, roles,
   precise scopes and observable criteria mapped to frozen quality gates.
   An old empty queue is not a reason to stop.
3. Obtain exact local human consent for plan/policy/baseline. The assistant may
   display the dialog, but cannot approve by supplying a field. Native
   permissions apply separately.
4. Follow fy_next, implement within scope, load pertinent skills, and record
   checkpoints/decisions/criterion references. Commit only authorized intended
   changes before certification; do not silently commit unrelated changes.
5. Run every required frozen gate ID. Writing tasks require all configured gates
   and a test-summary gate. MCP returns an operation handle to poll at bounded
   intervals. JSON CLI waits for its finite gate, returning the original prepared
   response; refresh context for its terminal result and revision.
6. Record review artifacts/findings on the tested revision. Same-session review
   is not independent; a model-supplied worker name is not attestation.
   Medium/high risk uses local human review until independent native origins
   can be verified.
7. fy_finalize derives blocked/delivered from current evidence, gates, review
   provenance, scope, clean Git inputs and budgets. Revision-specific ignored
   reports do not invalidate their own tested commit.

Criterion records are evidence-linked declarations, not universal correctness
proof. Gates are observed finite processes. Test gates reject zero tests, all
skipped/todo tests, failures, unrecognized summaries and changed inputs/capsule.
Changing evidence or the tested revision reopens completion; old reports remain
historical, not current proof.

MCP arguments are requestId and payload. Mutations need sessionId and current
expectedRevision. JSON stdin uses protocolVersion 0.2, requestId, tool and
payload. Identical retries return stored responses; changed inputs under an old
request ID are rejected. No alternate root, arbitrary verification argv, model
grant, sampling, provider API or authentication endpoint is exposed.

## Stable harness and durable state

The capsule freezes compiler/protocol, selected projections and provenance lock,
method, gates and policy with canonical hashes and owned-file integrity checks.
Its inventory and actual project files are Git-portable. This is not a standalone
archive containing all canonical source bytes. Requirements, tasks, checkpoints,
decisions and reports evolve separately. Updating the factory does not update
installed projects. Capsule drift stops work; migration is explicit.

Execution state/events/idempotency use private SQLite outside the working tree
and common Git directory. The factory does not serialize its credentials,
transcripts or writer/session metadata into product artifacts; supplied product
descriptions must remain secret-free. SQLite mutations are atomic; file materialization uses a
conservative durable outbox. Leases and checks are cooperative, not an OS sandbox
against another same-user process.

## Pause, recover and concurrency

The native client owns AI conversations, subagents, Stop, permissions and quotas.
Forgeyard owns only finite gates. Pause retains the writer and cancels only
locally owned HF gates, never provider/native/foreign sessions. Gates have bounded
output/timeouts and a reduced environment. Project scripts can have effects and
spawn children; direct-child termination does not prove the whole tree ended.

Expiry is not automatic takeover. Local human-only routes are:

~~~sh
forgeyard reconcile --root . --run <id> --session <id>
forgeyard reconcile-writer --root . --session <id>
forgeyard reconcile-install --root .
forgeyard reconcile-operation --root . --operation <id>
~~~

The assistant can invoke them. Idle writer recovery applies only before any
product run exists. Installation recovery checks the exact journal/capsule and
doctor, or absence of planned creations; no deletion or installer replay occurs.
Incomplete journals remain a stop. Gate recovery requires known processes to
be absent plus human inspection of effects/children; it marks the attempt
unverified and retains ownership. Unknown process identity remains a stop.
Resume the exact run afterward, without resetting budgets. No dialog has --yes
or an MCP approval counterpart.

One writer owns this tree. Configured work-item concurrency (1–16) is not promised
native AI-session capacity. Maintenance defaults to one; larger work can use a
reasonable inferred limit or explicit constraint. Manual legacy profiles retain
four default claims. No subscription tier is inferred. Unknown cost is not zero;
the recorded ceiling is not an enforceable provider bill or quota.

Worktrees are optional, with no native automatic merge. Explicitly authorized
legacy registered integration serializes merge and removes only its registered
tree, Git administration entry and merged worker branch. Cleanup is retryable.
App-owned/unregistered trees are not targets. Disconnect removes only unchanged
owned binding blocks, including interrupted-disconnect recovery; project harness
and foreign settings remain.

## Dossier v0.2 alignment and limits

| Expected outcome | Implemented boundary |
|---|---|
| Product first | Native interpretation, strict needs, bounded evidence |
| Curated coherent composition | Minimal dependency-closed coverage, one coordinator, exclusions |
| Ready project-specific harness | Shared renderer/transactional installer, exact local consent |
| New features and resumption | New linked plans, private atomic state, stable capsule |
| Verified delivery | Current criteria references, all gates, review provenance, derived report |
| Governable autonomy | Single writer, finite gates, time/repair/reported-cost stops |
| Multi-tool operation | Owned Codex/Claude MCP, JSON fallback; layout-only Cursor |
| Worktree cleanup | Exact registered lifecycle; no automatic native merge |

Not claimed complete:

- Codex app/CLI and Claude Code app/CLI live client/version/OS acceptance.
  Official SDK transport tests do not exercise their actual permissions or UI.
- A real person's production consent/review test. Windows click UI is implemented;
  other OS human-confirmation adapters are unavailable and fail closed.
- Independently attested native-subagent review. Names do not count; medium/high
  risk uses the implemented local human-review route.
- Signed remote catalog distribution, quarantine/admission/revocation and
  automatic curated refresh. Bundled content remains pinned/licensed/byte-checked.
  Descriptor admission is not behavioral evaluation of every third-party skill.
- APM integration/licensing spike and conditional fallback.
- Full standalone canonical-byte archive and certified compatibility with an
  unseen complete external schema appendix.
- General native-state upgrade/migration orchestration. Explicit installer
  update/rollback does not silently migrate private runs; changed capsule stops.
- Universal stack understanding, all summary formats, process-tree OS isolation
  or hard provider billing. Recognized Node TAP/spec, common JUnit/Maven,
  Vitest/Jest, Python, Rust, .NET and Go JSON summaries still depend on actual
  output. Gradle may require a verified project-specific summary configuration.

Official references:
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).
Configuration documentation does not establish live compatibility.
