import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readCapsule } from "../../../src/capsule/capsule.js";
import { createProjectService } from "../../../src/native/service.js";
import { NativeStore } from "../../../src/native/store.js";
import { workspaceIdentity } from "../../../src/native/workspace.js";
import { nativeFixture, productPlan } from "../../helpers/native.js";
// Ogni prova di questo file installa un'imbracatura reale: caricamento del registro,
// rendering, applicazione transazionale e comandi Git veri. Il tetto globale di 30 secondi
// è tarato sui test unitari, e un tetto più stretto del lavoro che delimita segnala un
// difetto che non c'e'.
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
