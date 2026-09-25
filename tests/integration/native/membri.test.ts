import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 332,7 s; dentro la
// suite nativa completa la stessa prova misura 779,8 s, perche' quattro worker si contendono
// gli stessi processi Git. Ogni prova installa un'imbracatura vera su DUE repository e percorre
// il protocollo con gate reali, quindi ogni chiamata paga una fotografia Git per membro.
// Il tetto dichiarato serve a cogliere un blocco, non a sorvegliare la durata: a 600 s era piu'
// stretto del lavoro che racchiude, e quattro delle cinque prove di allora diventavano rosse sotto carico
// senza che nulla fosse rotto. Se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 1_800_000, hookTimeout: 1_800_000 });

import { sha256Text } from "../../../src/core/hash.js";
import { nativeGateRunner } from "../../../src/native/gates.js";
import { createProjectService, type ProjectService } from "../../../src/native/service.js";
import type { NativeGateRunner } from "../../../src/native/contracts.js";
import { commitAll, multiMemberFixture, multiMemberPlan, nativeHarness } from "../../helpers/native.js";

const { registerFixture, registerService, call, mutation } = nativeHarness({ requestPrefix: "membri", runId: "filter-orders" });

const REVIEW = "# Review\nThe fixture test and intended interface were inspected. No findings.\n";

/** `fy_plan` + `consent`: the part of `setup` a second, parallel run needs on its own. */
async function planRun(fixture: { service: ProjectService }, id: string, members: readonly string[]) {
  await mutation(fixture.service, "fy_plan", { plan: multiMemberPlan(members, id) });
  await fixture.service.consent(id, "writer");
}

/**
 * The protocol walkthrough of `delivery.test.ts`, with the member list as its argument: one task
 * per member, one criterion recorded per task against that member's own test file, and the
 * review artifact committed inside the first member's scope. The harness files at the workspace
 * root belong to no member, so no member's working tree is dirty at this point.
 */
async function setup(members: readonly string[], gateRunner?: NativeGateRunner) {
  const fixture = await multiMemberFixture();
  registerFixture(fixture);
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }), ...(gateRunner ? { gateRunner } : {}) });
  registerService(service);
  await call(service, "fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 0 });
  await planRun({ service }, "filter-orders", members);
  await mutation(service, "fy_next", {});
  const host = members[0]!;
  const reviewPath = `${host}/src/review.md`;
  await writeFile(path.join(fixture.root, reviewPath), REVIEW);
  await commitAll(path.join(fixture.root, host));
  for (const [position, member] of members.entries()) {
    const evidencePath = `${member}/src/feature.test.mjs`;
    await mutation(service, "fy_record", { record: { kind: "criterion", taskId: `T${position + 1}`,
      criterionId: "C1", outcome: "met", evidence: [{ path: evidencePath,
        sha256: sha256Text(await readFile(path.join(fixture.root, evidencePath), "utf8")) }] } });
  }
  // `members` is overwritten deliberately: the fixture's own tuple is the two repositories that
  // exist on disk, while this run touches only the ones its plan names, and the two lists differ
  // in three of the five scenarios. Spreading the fixture's tuple through under that name would
  // hand a caller the wrong one.
  return { ...fixture, members, service, reviewRef: { path: reviewPath, sha256: sha256Text(REVIEW) } };
}

/** Every required gate of every named task, each asserted to have really passed. */
async function gates(fixture: { service: ProjectService; stateDirectory: string }, taskIds: readonly string[]) {
  const { service } = fixture;
  for (const taskId of taskIds) for (const gateId of ["G001", "G002"]) {
    const started = await mutation(service, "fy_verify", { taskId, gateId });
    await service.waitForOperations();
    const result = await call(service, "fy_operation", { action: "status", operationId: started.result.operationId });
    const log = await readFile(path.join(fixture.stateDirectory, "gate-logs", `${String(started.result.operationId)}.json`), "utf8");
    expect(result.result.operation, log).toMatchObject({ status: "passed", exitCode: 0 });
  }
}

/**
 * A gate runner that fails in exactly one member and delegates to the real runner everywhere
 * else. Its only input is the `cwd` it is handed — it never sees a task or a gate ID — so the
 * two outcomes the test below observes, T1's gate passing and T2's failing, can only come from
 * two different working directories. And the passing one really executed
 * `node --test src/feature.test.mjs`, a file that exists inside the member and not at the
 * workspace root: that gate could not have passed anywhere but in its own member.
 */
function failingIn(member: string): NativeGateRunner {
  return async (input) => path.basename(input.cwd) === member
    ? { exitCode: 1, stdout: "# tests 1\n# pass 0\n# fail 1\n", stderr: "" }
    : nativeGateRunner(input);
}

test.concurrent("un lavoro su un solo membro consegna, e il rapporto cita un HEAD", async () => {
  const fixture = await setup(["frontend"]);
  await gates(fixture, ["T1"]);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result).toMatchObject({ verdict: "delivered", gaps: [] });
  const report = JSON.parse(await readFile(path.join(fixture.root, String(final.result.report)), "utf8")) as
    { gitCommits: Record<string, string> };
  // Un solo membro toccato: il rapporto dichiara una revisione, e dichiara DI CHI e'.
  expect(Object.keys(report.gitCommits)).toEqual(["frontend"]);
  expect(report.gitCommits.frontend).toMatch(/^[0-9a-f]{40}$/);
});

test.concurrent("un lavoro su due membri consegna, e il rapporto cita due HEAD", async () => {
  const fixture = await setup(["frontend", "servizio-ordini"]);
  await gates(fixture, ["T1", "T2"]);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result).toMatchObject({ verdict: "delivered", gaps: [] });
  const report = JSON.parse(await readFile(path.join(fixture.root, String(final.result.report)), "utf8")) as
    { gitCommits: Record<string, string> };
  expect(Object.keys(report.gitCommits).sort()).toEqual(["frontend", "servizio-ordini"]);
  // Due repository distinti, due storie distinte: un rapporto che citasse lo stesso commito
  // per entrambi starebbe dichiarando una revisione che non esiste.
  expect(report.gitCommits.frontend).not.toBe(report.gitCommits["servizio-ordini"]);
});

test.concurrent("un gate fallito in un membro blocca, e il divario nomina quel membro", async () => {
  // Il gate fallisce SOLO in servizio-ordini: il runner distingue i due membri dalla cwd che
  // riceve, che e' anche la prova che la cwd del gate e' quella del membro e non la radice.
  const fixture = await setup(["frontend", "servizio-ordini"], failingIn("servizio-ordini"));
  await gates(fixture, ["T1"]);
  // T2's gate really runs, and really fails. Without this the gap below would only say the gate
  // never ran, `failingIn` would never be invoked, and nothing in this test would depend on the
  // `cwd` the runner receives — which is the half the gap's member name is supposed to prove.
  const failed = await mutation(fixture.service, "fy_verify", { taskId: "T2", gateId: "G001" });
  await fixture.service.waitForOperations();
  expect((await call(fixture.service, "fy_operation", { action: "status", operationId: failed.result.operationId }))
    .result.operation).toMatchObject({ status: "failed", exitCode: 1, failure: "nonzero-exit" });
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result.verdict).toBe("blocked");
  const gaps = final.result.gaps as readonly string[];
  expect(gaps).toContain("gate:servizio-ordini/T2/G001");
  // E il membro sano non viene nominato: un divario che accusasse anche frontend manderebbe
  // chi legge a cercare un guasto dove non c'e'.
  expect(gaps.some((gap: string) => gap.startsWith("gate:frontend/"))).toBe(false);
});

test.concurrent("un commit in un membro non toccato non invalida le prove", async () => {
  const fixture = await setup(["frontend"]);
  await gates(fixture, ["T1"]);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  // Un commit in servizio-ordini, che nessuna attivita' di questo lavoro tocca. E' la
  // decisione 4 del design, provata dal comportamento e non dall'aritmetica del digest.
  await writeFile(path.join(fixture.root, "servizio-ordini", "src", "estraneo.txt"), "altro lavoro\n");
  await commitAll(path.join(fixture.root, "servizio-ordini"));
  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result).toMatchObject({ verdict: "delivered", gaps: [] });
});

test.concurrent("un albero sporco dice QUALE membro lo e', nel divario e nel rifiuto", async () => {
  // La decisione 3 del design chiede «blocked, col membro nel divario». Il divario di gate lo
  // nominava gia'; quello di albero sporco no, e su due membri chi legge doveva andare a
  // scoprire quale dei due. Nessun gate qui: e' la prova piu' economica del file.
  const fixture = await setup(["frontend", "servizio-ordini"]);
  await writeFile(path.join(fixture.root, "servizio-ordini", "src", "bozza.txt"), "lavoro non committato\n");

  await expect(mutation(fixture.service, "fy_verify", { taskId: "T2", gateId: "G001" }))
    .rejects.toMatchObject({ code: "FY_GIT_REQUIRED", message: expect.stringContaining("servizio-ordini") });

  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result.verdict).toBe("blocked");
  const gaps = final.result.gaps as readonly string[];
  expect(gaps).toContain("git:dirty-inputs:servizio-ordini");
  // Il membro pulito non viene accusato. E qui, dove nessun ambito sta nella radice, non
  // compare nemmeno il divario nudo accanto a quello qualificato: un lettore che ne vedesse
  // due penserebbe a due alberi sporchi. Vale per questa fixture, non in generale — in un
  // workspace la cui radice e' a sua volta un albero di lavoro, '.' e' un membro come gli
  // altri e il divario nudo e' il suo.
  expect(gaps).not.toContain("git:dirty-inputs:frontend");
  expect(gaps).not.toContain("git:dirty-inputs");
});

test.concurrent("due lavori su membri disgiunti non si invalidano a vicenda", async () => {
  // Chiesto dalla review dell'Attivita' 2': la regola «una fotografia per lavoro, sui suoi
  // membri» vive oggi solo in un commento in service.ts. Qui diventa un comportamento.
  const fixture = await setup(["frontend"]);
  await gates(fixture, ["T1"]);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  expect((await mutation(fixture.service, "fy_finalize", {})).result.verdict).toBe("delivered");

  // Un secondo lavoro, con un altro id, sull'altro membro. Il primo resta consegnato:
  // avanzare su servizio-ordini non puo' rendere stantie le prove raccolte su frontend.
  await planRun(fixture, "filter-shipping", ["servizio-ordini"]);
  await writeFile(path.join(fixture.root, "servizio-ordini", "src", "feature.txt"), "seconda modifica\n");
  await commitAll(path.join(fixture.root, "servizio-ordini"));
  const context = await call(fixture.service, "fy_context", {});
  const first = (context.result.runs as { id: string; status: string }[]).find((run) => run.id === "filter-orders");
  expect(first?.status).toBe("delivered");
});
