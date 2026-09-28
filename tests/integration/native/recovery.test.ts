import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readCapsule } from "../../../src/capsule/capsule.js";
import { createProjectService } from "../../../src/native/service.js";
import { NativeStore } from "../../../src/native/store.js";
import { workspaceIdentity } from "../../../src/native/workspace.js";
import { nativeFixture, productPlan, regenerateFixtureCapsule } from "../../helpers/native.js";
// Ogni prova di questo file installa un'imbracatura reale: caricamento del registro,
// rendering, applicazione transazionale e comandi Git veri. Prova piu' lenta, cronometrata
// su questa macchina a riposo: 16,8 s. Il tetto globale di 30 s e' tarato sui test unitari,
// e un tetto piu' stretto del lavoro che delimita segnala un difetto che non c'e'.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const fixtures: Awaited<ReturnType<typeof nativeFixture>>[] = [];
const services: Awaited<ReturnType<typeof createProjectService>>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true });
});

test("a finished installation whose service crashed can be adopted only after exact journal and local confirmation", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const identity = await workspaceIdentity(fixture.root); const capsule = await readCapsule(fixture.root);
  const store = await NativeStore.open(fixture.stateDirectory, identity.id);
  store.internal("fixture-interruption", "interrupted-install", (state) => {
    state.installation = { requestId: "apply-crashed", fingerprint: "a".repeat(64), operationId: "native-fixture-install",
      capsuleId: capsule.id, capsule, createdPaths: [], status: "uncertain", owner: "ceased-fixture-service", ownerPid: 2147483646 };
    return {};
  }); store.close();
  let confirmations = 0;
  const service = await createProjectService({ ...fixture, confirmation: async () => {
    confirmations += 1; return { accepted: true, channel: "test-fixture" }; } }); services.push(service);
  const result = await service.reconcileInstallation();
  expect(result.result).toMatchObject({ reconciled: true, installed: true, capsuleId: capsule.id });
  expect(confirmations).toBe(1);
  expect((await service.execute({ protocolVersion: "0.2", requestId: "after-reconcile", tool: "fy_context", payload: {} })).result.installation).toBeNull();
});

test("an expired writer with no product run still has a local recovery route", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const identity = await workspaceIdentity(fixture.root); const store = await NativeStore.open(fixture.stateDirectory, identity.id);
  store.internal("fixture-expiry", "expired-empty-writer", (state) => {
    state.writer = { sessionId: "old", expiresAt: "2020-01-01T00:00:00.000Z", baselineSha256: "a".repeat(64) }; return {};
  }); store.close();
  const service = await createProjectService({ ...fixture, confirmation: async () => ({ accepted: true, channel: "test-fixture" }) }); services.push(service);
  const restored = await service.reconcileWriter("new");
  expect(restored.result).toMatchObject({ reconciled: true, mode: "write" });
  expect((await service.execute({ protocolVersion: "0.2", requestId: "new-plan", tool: "fy_plan",
    payload: { sessionId: "new", expectedRevision: restored.revision, plan: productPlan() } })).result.action).toBe("awaiting-approval");
});

/**
 * Il difetto riprodotto col binario compilato: uno scrittore si attacca, la configurazione
 * posseduta cambia, `forgeyard update` rigenera la capsula, e da quel momento **ogni** chiamata
 * del protocollo risponde `FY_CAPSULE_MIGRATION_REQUIRED` — anche la sola lettura del contesto —
 * perche' ogni via che potrebbe riscrivere l'id memorizzato passa dallo stesso guard.
 */
test("a capsule replaced under an attached writer blocks every call, and this route is the way out", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const descriptions: string[] = [];
  const service = await createProjectService({ ...fixture, confirmation: async (input) => {
    descriptions.push(input.description); return { accepted: true, channel: "test-fixture" }; } });
  services.push(service);
  const attached = await service.execute({ protocolVersion: "0.2", requestId: "attach-before-swap",
    tool: "fy_attach", payload: { mode: "write", sessionId: "writer", expectedRevision: 0 } });
  const stored = String(attached.result.capsuleId);

  const swapped = await regenerateFixtureCapsule(fixture.root, 240);
  expect(swapped.id).not.toBe(stored);

  const blocked: readonly (readonly [string, Record<string, unknown>])[] = [
    ["fy_context", {}],
    ["fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 1 }],
    ["fy_plan", { sessionId: "writer", expectedRevision: 1, plan: productPlan() }],
  ];
  for (const [tool, payload] of blocked) {
    await expect(service.execute({ protocolVersion: "0.2", requestId: `blocked-${tool}`, tool, payload }))
      .rejects.toMatchObject({ code: "FY_CAPSULE_MIGRATION_REQUIRED",
        // Il rimedio nomina un comando che esiste: un rimedio inesistente e' un difetto.
        message: expect.stringContaining("forgeyard reconcile-capsule") });
  }
  await expect(service.reconcileWriter("another")).rejects.toMatchObject({ code: "FY_CAPSULE_MIGRATION_REQUIRED" });

  const reconciled = await service.reconcileCapsule();
  expect(reconciled.result).toMatchObject({ reconciled: true, capsuleId: swapped.id,
    previousCapsuleId: stored, writerReleased: true });
  // La conferma mostra la policy che si accetta, non soltanto due impronte.
  expect(descriptions.at(-1)).toContain(stored);
  expect(descriptions.at(-1)).toContain(swapped.id);
  expect(descriptions.at(-1)).toContain("policy.timeboxMinutes: 300 -> 240");

  const context = await service.execute({ protocolVersion: "0.2", requestId: "context-after-reconcile",
    tool: "fy_context", payload: {} });
  expect(context.result).toMatchObject({ capsuleId: swapped.id, writerStatus: "available" });
  const reattached = await service.execute({ protocolVersion: "0.2", requestId: "attach-after-reconcile",
    tool: "fy_attach", payload: { mode: "write", sessionId: "writer", expectedRevision: context.revision } });
  expect(reattached.result).toMatchObject({ mode: "write", capsuleId: swapped.id });
});

test("a capsule swap under an existing run is refused: that run's consent was given against the stored capsule", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  let confirmations = 0;
  const service = await createProjectService({ ...fixture, confirmation: async () => {
    confirmations += 1; return { accepted: true, channel: "test-fixture" }; } });
  services.push(service);
  const attached = await service.execute({ protocolVersion: "0.2", requestId: "attach-before-plan",
    tool: "fy_attach", payload: { mode: "write", sessionId: "writer", expectedRevision: 0 } });
  const planned = await service.execute({ protocolVersion: "0.2", requestId: "plan-before-swap", tool: "fy_plan",
    payload: { sessionId: "writer", expectedRevision: attached.revision, plan: productPlan() } });
  expect(planned.result.action).toBe("awaiting-approval");

  await regenerateFixtureCapsule(fixture.root, 240);

  await expect(service.reconcileCapsule()).rejects.toMatchObject({ code: "FY_RECONCILIATION_REQUIRED",
    message: expect.stringContaining("forgeyard reconcile --root") });
  // Un rifiuto non apre un dialogo: non si chiede a una persona di confermare ciò che non avviene.
  expect(confirmations).toBe(0);
});

test("recovering an interrupted disconnect accepts files already restored, and refuses foreign targets", async () => {
  const fixture = await nativeFixture(); fixtures.push(fixture);
  const { connectNativeClient, disconnectNativeClient } = await import("../../../src/native/bindings.js");
  const input = { ...fixture, client: "codex" as const, cliPath: path.join(fixture.directory, "fixture-cli.mjs") };
  const config = path.join(fixture.root, ".codex/config.toml"); await writeFile(config, '# foreign\nmodel = "user"\n');
  await connectNativeClient(input);
  const identity = await workspaceIdentity(fixture.root); const metadata = path.join(fixture.stateDirectory, identity.id, "codex-bindings.json");
  const binding = JSON.parse(await readFile(metadata, "utf8")) as { phase: string; entries: { target: string; original: string | null; restored?: string | null }[] };
  binding.phase = "disconnecting"; for (const entry of binding.entries) entry.restored = entry.original;
  await writeFile(metadata, JSON.stringify(binding)); await writeFile(config, binding.entries[0]!.original!);
  await disconnectNativeClient(input); expect(await readFile(config, "utf8")).toBe('# foreign\nmodel = "user"\n');
  await connectNativeClient(input);
  const malformed = JSON.parse(await readFile(metadata, "utf8")) as typeof binding;
  const unrelated = path.join(fixture.directory, "unrelated.txt"); await writeFile(unrelated, "preserve me");
  malformed.entries[0]!.target = unrelated; await writeFile(metadata, JSON.stringify(malformed));
  await expect(disconnectNativeClient(input)).rejects.toMatchObject({ code: "FY_BINDING_INVALID" });
  expect(await readFile(unrelated, "utf8")).toBe("preserve me");
});
