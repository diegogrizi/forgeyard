import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 142,9 s.
// Il tetto globale di 30 s e' tarato sui test unitari; qui si installano imbracature vere,
// si esegue Git e la CLI compilata. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });
import { sha256Text } from "../../../src/core/hash.js";
import { createProjectService, type ProjectService } from "../../../src/native/service.js";
import type { NativeGateRunner } from "../../../src/native/contracts.js";
import { commitAll, nativeFixture, nativeHarness, productPlan } from "../../helpers/native.js";

const { fixtures, services, call, mutation } = nativeHarness({ requestPrefix: "delivery", runId: "filter-orders" });
async function setup(risk: "low" | "medium" = "low", gateRunner?: NativeGateRunner) {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }), ...(gateRunner ? { gateRunner } : {}) });
  services.push(service);
  await call(service, "fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 0 });
  await mutation(service, "fy_plan", { plan: productPlan(risk) });
  await service.consent("filter-orders", "writer");
  await mutation(service, "fy_next", {});
  const review = "# Review\nThe fixture test and intended interface were inspected. No findings.\n";
  await writeFile(path.join(fixture.root, "src/review.md"), review);
  await commitAll(fixture.root);
  await mutation(service, "fy_record", { record: { kind: "criterion", taskId: "T1", criterionId: "C1", outcome: "met",
    evidence: [{ path: "src/feature.test.mjs", sha256: sha256Text(await readFile(path.join(fixture.root, "src/feature.test.mjs"), "utf8")) }] } });
  return { ...fixture, service, reviewRef: { path: "src/review.md", sha256: sha256Text(review) } };
}
// La fixture arriva per argomento, non dall'array condiviso: `fixtures.at(-1)` legava
// questa prova all'ordine di esecuzione, e con prove concorrenti leggeva il registro di
// un'altra. In serie coincideva sempre, quindi il difetto non si vedeva.
async function gates(fixture: { service: ProjectService; stateDirectory: string }) {
  const { service } = fixture;
  for (const gateId of ["G001", "G002"]) {
    const started = await mutation(service, "fy_verify", { taskId: "T1", gateId });
    await service.waitForOperations();
    const result = await call(service, "fy_operation", { action: "status", operationId: started.result.operationId });
    const log = await readFile(path.join(fixture.stateDirectory, "gate-logs", `${started.result.operationId}.json`), "utf8");
    expect(result.result.operation, log).toMatchObject({ status: "passed", exitCode: 0 });
  }
}

test.concurrent("real finite gates certify a clean revision; the report does not invalidate that revision", async () => {
  const fixture = await setup();
  await gates(fixture);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  const first = await mutation(fixture.service, "fy_finalize", {});
  expect(first.result).toMatchObject({ verdict: "delivered", gaps: [] });
  expect(JSON.parse(await readFile(path.join(fixture.root, String(first.result.report)), "utf8")))
    .toMatchObject({ verdict: "delivered", gates: [expect.objectContaining({ testsDiscovered: 1 }), expect.objectContaining({ gateId: "G002" })] });
  const second = await mutation(fixture.service, "fy_finalize", {});
  expect(second.result).toMatchObject({ verdict: "delivered", gaps: [] });
});

test.concurrent("zero tests cannot become passed evidence even with exit zero", async () => {
  const fixture = await setup("low", async () => ({ exitCode: 0, stdout: "# tests 0\n# pass 0\n", stderr: "" }));
  const started = await mutation(fixture.service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await fixture.service.waitForOperations();
  const result = await call(fixture.service, "fy_operation", { action: "status", operationId: started.result.operationId });
  expect(result.result.operation).toMatchObject({ status: "failed", failure: "zero-tests", testsDiscovered: 0 });
});

test.concurrent("a claimed native subagent does not certify independent medium-risk review", async () => {
  const fixture = await setup("medium");
  await gates(fixture);
  await mutation(fixture.service, "fy_review", { origin: "native-subagent", artifact: fixture.reviewRef, findings: [] });
  const result = await mutation(fixture.service, "fy_finalize", {});
  expect(result.result).toMatchObject({ verdict: "blocked", gaps: ["review:independent-provenance-required"] });
  const human = await fixture.service.humanReview("filter-orders", "writer", fixture.reviewRef);
  expect(human.result).toMatchObject({ independent: true, confirmationChannel: "test-fixture" });
  expect((await mutation(fixture.service, "fy_finalize", {})).result).toMatchObject({ verdict: "delivered", gaps: [] });
});

test.concurrent("pause retains ownership and explicit local reconciliation resumes the same capsule", async () => {
  const fixture = await setup();
  await mutation(fixture.service, "fy_pause", { note: "Pause at the user's request" });
  await expect(mutation(fixture.service, "fy_next", {})).rejects.toMatchObject({ code: "FY_RECONCILIATION_REQUIRED" });
  const resumed = await fixture.service.reconcile("filter-orders", "writer");
  expect(resumed.result).toMatchObject({ status: "implementing", approved: true });
  expect((await mutation(fixture.service, "fy_next", {})).result).toMatchObject({ action: "work" });
});

test.concurrent("retrying a gate does not spawn it twice, and a later failed attempt supersedes an old pass", async () => {
  let invocations = 0;
  const fixture = await setup("low", async () => ({ exitCode: ++invocations === 1 ? 0 : 1,
    stdout: "# tests 1\n# pass 1\n# fail 0", stderr: "" }));
  const context = await call(fixture.service, "fy_context", {});
  const payload = { sessionId: "writer", expectedRevision: context.revision, runId: "filter-orders", taskId: "T1", gateId: "G001" };
  const first = await call(fixture.service, "fy_verify", payload, "same-gate-request");
  await fixture.service.waitForOperations();
  expect(await call(fixture.service, "fy_verify", payload, "same-gate-request")).toEqual(first);
  expect(invocations).toBe(1);
  await mutation(fixture.service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await fixture.service.waitForOperations();
  const finalized = await mutation(fixture.service, "fy_finalize", {});
  expect(finalized.result.gaps).toContain("gate:T1/G001");
});

test.concurrent("a running gate is canceled by pause without releasing the writer; it can resume after termination", async () => {
  const fixture = await setup("low", async ({ signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ exitCode: 130, stdout: "", stderr: "", canceled: true }), { once: true });
  }));
  const gate = await mutation(fixture.service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await mutation(fixture.service, "fy_pause", { note: "User pause" });
  await fixture.service.waitForOperations();
  expect((await call(fixture.service, "fy_operation", { action: "status", operationId: gate.result.operationId })).result.operation)
    .toMatchObject({ status: "canceled" });
  expect((await call(fixture.service, "fy_context", {})).result).toMatchObject({ writerStatus: "reserved" });
  expect((await fixture.service.reconcile("filter-orders", "writer")).result).toMatchObject({ status: "implementing" });
});

test.concurrent("changes made by a nominally passing gate invalidate its evidence", async () => {
  const fixture = await setup("low", async ({ cwd }) => {
    await writeFile(path.join(cwd, "src/feature.txt"), "changed during verification\n");
    return { exitCode: 0, stdout: "# tests 1\n# pass 1", stderr: "" };
  });
  const gate = await mutation(fixture.service, "fy_verify", { taskId: "T1", gateId: "G001" });
  await fixture.service.waitForOperations();
  expect((await call(fixture.service, "fy_operation", { action: "status", operationId: gate.result.operationId })).result.operation)
    .toMatchObject({ status: "failed", failure: "stale-inputs" });
});

test.concurrent("a delivered task is reopened when its criterion evidence or tested revision changes", async () => {
  const fixture = await setup(); await gates(fixture);
  await mutation(fixture.service, "fy_review", { origin: "same-session", artifact: fixture.reviewRef, findings: [] });
  expect((await mutation(fixture.service, "fy_finalize", {})).result.verdict).toBe("delivered");
  await writeFile(path.join(fixture.root, "src/feature.test.mjs"), "// changed evidence\n"); await commitAll(fixture.root);
  const next = await mutation(fixture.service, "fy_next", {});
  expect(next.result).toMatchObject({ action: "work", task: { id: "T1" } });
  expect(next.result.gaps).toContain("criterion-evidence:T1/C1");
  const context = await call(fixture.service, "fy_context", {});
  expect(context.result.runs).toEqual(expect.arrayContaining([expect.objectContaining({ status: "implementing",
    tasks: [expect.objectContaining({ completed: false })] })]));
  const final = await mutation(fixture.service, "fy_finalize", {});
  expect(final.result).toMatchObject({ verdict: "blocked", report: null });
  expect(final.result.gaps).toContain("criterion-evidence:T1/C1");
});
