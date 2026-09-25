import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 30,2 s.
// Installa un'imbracatura vera con un secondo repository annidato e percorre il protocollo
// nativo fino a un gate reale (runner iniettato). Il tetto dichiarato serve a cogliere un
// blocco, non a sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

import { createProjectService } from "../../../src/native/service.js";
import type { NativeGateRunner, ProductPlan } from "../../../src/native/contracts.js";
import { commitAll, git, nativeFixture, nativeHarness } from "../../helpers/native.js";

const { registerFixture, registerService, call, mutation } = nativeHarness({ requestPrefix: "gate-cwd", runId: "gate-cwd-check" });

test("un gate gira con la cwd del membro della sua attivita', non la radice del workspace", async () => {
  const fixture = await nativeFixture();
  registerFixture(fixture);
  // Inside the service, `this.identity.root` is `realpath(path.resolve(input))`, and on this
  // machine `realpath` can answer in a different form (an 8.3 short name) than the string this
  // fixture was handed. Comparing against the unresolved value would be the same canonical-
  // vs-unresolved mismatch AGENTS.md already tells the story of for `registry/load.test.ts`:
  // resolve here too, so both sides of the assertion name the same directory the same way.
  const root = await realpath(fixture.root);

  const seenCwds: string[] = [];
  const gateRunner: NativeGateRunner = async ({ cwd }) => {
    seenCwds.push(cwd);
    return { exitCode: 0, stdout: "# tests 1\n# pass 1\n", stderr: "" };
  };
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }), gateRunner });
  registerService(service);

  // `fy_attach` snapshots the root as member ".": it must still be a clean, ordinary working
  // tree at this point. The nested member is created only after this call returns, so root's
  // own `git status` never has to explain a second `.git` living inside its tree — an embedded
  // repository shows up to its parent as a single non-regular, untracked path, which is a
  // fixture concern, not the thing under test here.
  await call(service, "fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 0 });

  // A member nested inside the root's own working tree: it has its own `.git`, so
  // `memberForScope` stops there instead of walking up to the root. A task scoped to it
  // therefore belongs to a member other than ".", and that member's own directory is a
  // different path from the root in this fixture — which is what lets the assertion below
  // distinguish "ran in the member" from "ran at the workspace root". From here on the run
  // only ever touches this member, never the root, so root is not snapshotted again.
  const memberRelative = "src/member-b";
  const memberAbsolute = path.join(root, "src", "member-b");
  await mkdir(memberAbsolute, { recursive: true });
  await writeFile(path.join(memberAbsolute, "marker.txt"), "member-b\n");
  await git(memberAbsolute, ["init", "-b", "main"]);
  await git(memberAbsolute, ["config", "user.name", "Fixture"]);
  await git(memberAbsolute, ["config", "user.email", "fixture@example.invalid"]);
  await commitAll(memberAbsolute);

  const plan: ProductPlan = {
    id: "gate-cwd-check", request: "Verify the gate runs inside its own member", risk: "low",
    requirements: [{ id: "R1", description: "The gate observes the member's own working tree" }],
    tasks: [{ id: "T1", title: "Touch member-b", objective: "Implement inside the nested member",
      requirementIds: ["R1"], dependsOn: [], writeScopes: [memberRelative], role: "implementer",
      criteria: [{ id: "C1", description: "The gate passes", gateIds: ["G001"] }] }],
  };
  await mutation(service, "fy_plan", { plan });
  await service.consent("gate-cwd-check", "writer");
  await mutation(service, "fy_next", {});
  await mutation(service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await service.waitForOperations();

  // The precise value, not just "truthy": a runner that received the workspace root instead
  // of the member would fail this exact comparison, since the two are different directories.
  expect(seenCwds).toEqual([memberAbsolute]);
  expect(seenCwds[0]).not.toBe(root);
});

test("un'attivita' senza ambiti di scrittura gira il gate alla radice del workspace", async () => {
  const fixture = await nativeFixture();
  registerFixture(fixture);
  // Same canonicalization concern as the test above: compare against what `realpath` actually
  // answers, not the string the fixture was handed.
  const root = await realpath(fixture.root);

  const seenCwds: string[] = [];
  const gateRunner: NativeGateRunner = async ({ cwd }) => {
    seenCwds.push(cwd);
    return { exitCode: 0, stdout: "# tests 1\n# pass 1\n", stderr: "" };
  };
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }), gateRunner });
  registerService(service);

  await call(service, "fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 0 });

  // A review-only task writes nowhere, so `assertTaskMembers` gives it no entry in
  // `membersByTask`. `performGate`'s `?? "."` is the only thing standing between that absent
  // entry and `memberRoot` receiving `undefined`: this pins that its gate runs at the
  // workspace root, not that it merely "does not crash".
  const plan: ProductPlan = {
    id: "gate-cwd-check", request: "Verify a scopeless task's gate runs at the workspace root", risk: "low",
    requirements: [{ id: "R1", description: "A review-only task's gate still runs, at the root" }],
    tasks: [{ id: "T1", title: "Review only", objective: "This task has no write scope",
      requirementIds: ["R1"], dependsOn: [], writeScopes: [], role: "reviewer",
      criteria: [{ id: "C1", description: "The gate passes", gateIds: ["G001"] }] }],
  };
  await mutation(service, "fy_plan", { plan });
  await service.consent("gate-cwd-check", "writer");
  await mutation(service, "fy_next", {});
  // `fy_plan` registers the proposed-plan artifact, and `flushArtifacts()` writes it to disk
  // workspace-root-relative right after every call. With this task's only member being the
  // root itself, that untracked file would make `fy_verify`'s cleanliness check refuse the
  // gate — the same reason `tests/helpers/native.ts`'s callers commit between `fy_next` and
  // verifying. It is a fixture step, not part of what this test observes.
  await commitAll(root);
  await mutation(service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await service.waitForOperations();

  expect(seenCwds).toEqual([root]);
});
