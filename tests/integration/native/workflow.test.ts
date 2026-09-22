import { readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createProjectService } from "../../../src/native/service.js";
import { commitAll, nativeFixture, productPlan } from "../../helpers/native.js";
// Ogni prova di questo file installa un'imbracatura reale: caricamento del registro,
// rendering, applicazione transazionale e comandi Git veri. Il tetto globale di 30 secondi
// è tarato sui test unitari, e un tetto più stretto del lavoro che delimita segnala un
// difetto che non c'e'.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const fixtures: Awaited<ReturnType<typeof nativeFixture>>[] = [];
const services: Awaited<ReturnType<typeof createProjectService>>[] = [];
let requestIndex = 0;

async function setup() {
  const fixture = await nativeFixture();
  fixtures.push(fixture);
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" as const }) });
  services.push(service);
  const attached = await call(service, "fy_attach", { mode: "write", sessionId: "session-a", expectedRevision: 0 });
  return { ...fixture, service, revision: attached.revision };
}

function call(service: Awaited<ReturnType<typeof createProjectService>>, tool: string, payload: unknown,
  requestId = `request-${++requestIndex}`) {
  return service.execute({ protocolVersion: "0.2", requestId, tool, payload });
}

async function planAndConsent(fixture: Awaited<ReturnType<typeof setup>>, risk: "low" | "medium" | "high" = "low") {
  const result = await call(fixture.service, "fy_plan", { sessionId: "session-a", expectedRevision: fixture.revision,
    plan: productPlan(risk) });
  const consent = await fixture.service.consent("filter-orders", "session-a");
  return { ...fixture, revision: consent.revision, planRevision: result.revision };
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true });
});

describe("native project protocol", () => {
  test("Claude file hook follows native consent, current work scope and pause rather than requiring a legacy claim", async () => {
    const fixture = await nativeFixture(); fixtures.push(fixture);
    const service = await createProjectService({ ...fixture, stateDirectory: path.join(fixture.stateDirectory, "Forgeyard"),
      confirmation: async () => ({ accepted: true, channel: "test-fixture" }) }); services.push(service);
    const attached = await call(service, "fy_attach", { mode: "write", sessionId: "session-a", expectedRevision: 0 });
    const planned = await call(service, "fy_plan", { sessionId: "session-a", expectedRevision: attached.revision, plan: productPlan() });
    const hook = async (file_path: string) => execa(process.execPath, [path.join(fixture.root, ".forgeyard/bin/write-guard.mjs")], {
      cwd: fixture.root, input: JSON.stringify({ cwd: fixture.root, session_id: "native-client-session", tool_name: "Edit", tool_input: { file_path } }),
      env: { LOCALAPPDATA: fixture.stateDirectory }, shell: false });
    expect((await hook("src/feature.txt")).stdout).toContain('"permissionDecision":"deny"');
    const consent = await service.consent("filter-orders", "session-a");
    const next = await call(service, "fy_next", { runId: "filter-orders", sessionId: "session-a", expectedRevision: consent.revision });
    expect((await hook("src/feature.txt")).stdout).toBe("");
    expect((await hook("AGENTS.md")).stdout).toContain('"permissionDecision":"deny"');
    const alias = path.join(fixture.root, "src/factory-alias");
    await symlink(path.join(fixture.root, ".forgeyard"), alias, process.platform === "win32" ? "junction" : "dir");
    try { expect((await hook("src/factory-alias/capsule.json")).stdout).toContain('"permissionDecision":"deny"'); }
    finally { await unlink(alias); }
    await call(service, "fy_pause", { runId: "filter-orders", sessionId: "session-a", expectedRevision: next.revision, note: "User pause" });
    expect((await hook("src/feature.txt")).stdout).toContain('"permissionDecision":"deny"');
    expect(planned.result.action).toBe("awaiting-approval");
  });
  test("rejects a second writer for the same real working tree", async () => {
    const fixture = await setup();
    const second = await createProjectService(fixture);
    services.push(second);
    await expect(call(second, "fy_attach", { mode: "write", sessionId: "session-b", expectedRevision: fixture.revision }))
      .rejects.toMatchObject({ code: "FY_WRITER_BUSY" });
    const read = await call(second, "fy_attach", { mode: "read", sessionId: "session-b" });
    expect(read.result).toMatchObject({ mode: "read" });
  });

  test("validates payloads, revisions and idempotency without effect replay", async () => {
    const fixture = await setup();
    await expect(call(fixture.service, "fy_approve", { accepted: true })).rejects.toMatchObject({ code: "FY_PROTOCOL_INVALID" });
    await expect(call(fixture.service, "fy_plan", { sessionId: "session-a", expectedRevision: 0, plan: productPlan() }))
      .rejects.toMatchObject({ code: "FY_REVISION_CONFLICT" });
    const payload = { sessionId: "session-a", expectedRevision: fixture.revision, plan: productPlan() };
    const first = await call(fixture.service, "fy_plan", payload, "retry-safe-plan");
    expect(await call(fixture.service, "fy_plan", payload, "retry-safe-plan")).toEqual(first);
    await expect(call(fixture.service, "fy_plan", { ...payload, root: "C:/", accepted: true }))
      .rejects.toMatchObject({ code: "FY_PROTOCOL_INVALID" });
    await expect(call(fixture.service, "fy_plan", { ...payload, plan: { ...productPlan(), request: "different" } }, "retry-safe-plan"))
      .rejects.toMatchObject({ code: "FY_IDEMPOTENCY_CONFLICT" });
  });

  test("requires a real consent channel and a valid requirement/task graph", async () => {
    const fixture = await setup();
    const invalid = productPlan();
    invalid.tasks[0]!.dependsOn = ["T1"];
    await expect(call(fixture.service, "fy_plan", { sessionId: "session-a", expectedRevision: fixture.revision, plan: invalid }))
      .rejects.toMatchObject({ code: "FY_PLAN_INVALID" });
    const planned = await call(fixture.service, "fy_plan", { sessionId: "session-a", expectedRevision: fixture.revision, plan: productPlan() });
    const next = await call(fixture.service, "fy_next", { runId: "filter-orders", sessionId: "session-a", expectedRevision: planned.revision });
    expect(next.result).toMatchObject({ action: "awaiting-approval" });
    await expect(call(fixture.service, "fy_verify", { runId: "filter-orders", taskId: "T1", gateId: "G001",
      sessionId: "session-a", expectedRevision: next.revision, argv: ["node", "-e", "process.exit(0)"] }))
      .rejects.toMatchObject({ code: "FY_PROTOCOL_INVALID" });
  });

  test("does not certify completion without all gates and criterion evidence", async () => {
    const fixture = await planAndConsent(await setup());
    const result = await call(fixture.service, "fy_finalize", { runId: "filter-orders", sessionId: "session-a", expectedRevision: fixture.revision });
    expect(result.result).toMatchObject({ verdict: "blocked" });
    expect(JSON.stringify(result.result)).toContain("G002");
  });

  test("retains new-feature plans while keeping the same capsule", async () => {
    const fixture = await planAndConsent(await setup());
    const context = await call(fixture.service, "fy_context", {});
    expect(context.result).toMatchObject({ runs: [expect.objectContaining({ id: "filter-orders" })] });
    const persisted = await readFile(path.join(fixture.root, ".forgeyard/project/filter-orders.json"), "utf8");
    expect(persisted).toContain("R1");
    expect(persisted).not.toContain("session-a");
    const capsule = await readFile(path.join(fixture.root, ".forgeyard/capsule.json"), "utf8");
    expect(context.result).toMatchObject({ capsuleId: JSON.parse(capsule).id });
  });

  test("detects policy drift before a run can advance", async () => {
    const fixture = await planAndConsent(await setup());
    const configPath = path.join(fixture.root, "forgeyard.yaml");
    const config = await readFile(configPath, "utf8");
    await writeFile(configPath, config.replace("maxConcurrency: 4", "maxConcurrency: 8"));
    await expect(call(fixture.service, "fy_next", { runId: "filter-orders", sessionId: "session-a", expectedRevision: fixture.revision }))
      .rejects.toMatchObject({ code: "FY_CAPSULE_DRIFT" });
  });
});
