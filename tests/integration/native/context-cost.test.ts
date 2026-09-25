import { expect, test, vi } from "vitest";

// Prova piu' lenta di questo file — l'unica — cronometrata su questa macchina a riposo tre
// volte: 24,1 s, 24,7 s e 36,0 s; vale la peggiore delle tre. Installa un'imbracatura vera,
// apre un servizio nativo e percorre `fy_context` su un archivio di dodici lavori, ciascuno
// con la propria fotografia Git. Il tetto globale di 30 s e' tarato sui test unitari, ed e'
// gia' sotto la misura peggiore. Il tetto dichiarato serve a cogliere un blocco, non a
// sorvegliare la durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

/**
 * `fy_context` e' la chiamata di lettura ordinaria, e fotografava OGNI lavoro in archivio —
 * quattro processi Git per membro, circa 850 ms l'uno su Windows, senza alcun limite. Contare le
 * fotografie e' l'unico modo di osservarlo: i lavori fuori dalla finestra riportata non
 * compaiono nella risposta, quindi nessuna asserzione sul risultato potrebbe distinguerli.
 */
vi.mock("../../../src/native/workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/native/workspace.js")>();
  return { ...actual, workspaceSnapshot: vi.fn(actual.workspaceSnapshot) };
});

import { readCapsule } from "../../../src/capsule/capsule.js";
import type { NativeRun } from "../../../src/native/contracts.js";
import { createProjectService } from "../../../src/native/service.js";
import { NativeStore } from "../../../src/native/store.js";
import { workspaceIdentity, workspaceSnapshot } from "../../../src/native/workspace.js";
import { nativeFixture, nativeHarness, productPlan } from "../../helpers/native.js";

const { registerFixture, registerService, call } = nativeHarness({ requestPrefix: "context-cost" });

/** Un lavoro archiviato completo: un cast parziale lascerebbe passare un campo assente. */
function archivedRun(id: string, head: string): NativeRun {
  return { plan: { ...productPlan(), id }, planSha256: "a".repeat(64), capsuleId: "b".repeat(64),
    status: "implementing", createdAt: "2026-09-25T10:00:00.000Z", deadlineAt: "2126-09-25T10:00:00.000Z",
    repairs: 0, approvalBaseline: "c".repeat(64), artifactSha256: "d".repeat(64),
    baselineHeads: { ".": head }, membersByTask: { T1: "." }, checkpoints: [], criteria: [],
    reviews: [], completedTaskIds: [], decisions: [], recordedCostUsd: null, usage: [] };
}

test("fy_context fotografa i lavori che riporta, non tutti quelli in archivio", async () => {
  const fixture = await nativeFixture();
  registerFixture(fixture);
  const identity = await workspaceIdentity(fixture.root);
  const head = (await workspaceSnapshot(fixture.root)).members.get(".")!.head!;

  // Dodici lavori archiviati, scritti direttamente nello stato privato: percorrerli dal
  // protocollo costerebbe dodici piani e dodici consensi per provare un limite.
  const store = await NativeStore.open(fixture.stateDirectory, identity.id);
  store.internal("fixture-archive", "twelve-runs", (state) => {
    for (let index = 1; index <= 12; index += 1) state.runs.push(archivedRun(`lavoro-${String(index)}`, head));
    state.capsuleId = null;
    return {};
  });
  store.close();

  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }) });
  registerService(service);
  // La capsula esiste davvero: senza, `fy_context` non rinfrescherebbe alcun lavoro e la
  // prova misurerebbe zero fotografie per il motivo sbagliato.
  expect((await readCapsule(fixture.root)).id).toMatch(/^[0-9a-f]{64}$/);

  vi.mocked(workspaceSnapshot).mockClear();
  const context = await call(service, "fy_context", {});

  const reported = (context.result.runs as { id: string }[]).map((run) => run.id);
  expect(reported).toEqual(["lavoro-3", "lavoro-4", "lavoro-5", "lavoro-6", "lavoro-7",
    "lavoro-8", "lavoro-9", "lavoro-10", "lavoro-11", "lavoro-12"]);
  expect(context.result.historyLimited).toBe(true);
  // Una fotografia per lavoro riportato, non per lavoro esistente: il limite del costo e'
  // lo stesso limite della risposta, e non una seconda regola che puo' divergere.
  expect(vi.mocked(workspaceSnapshot).mock.calls.length).toBe(reported.length);
});
