import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createProjectService } from "../../../src/native/service.js";

const directories: string[] = [];
const services: Awaited<ReturnType<typeof createProjectService>>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

test("composition and native preview share mandatory method/test/review coverage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-prepare-native-"));
  directories.push(directory);
  const root = path.join(directory, "project");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "frontend",
    dependencies: { react: "19.0.0", typescript: "5.0.0" }, scripts: { test: "node --test" } }));
  const service = await createProjectService({ root, stateDirectory: path.join(directory, "state") });
  services.push(service);
  const payload = { brief: "Correggi l'errore senza cambiare l'API pubblica",
    proposal: { intent: "maintenance", risk: "medium", needs: ["domain.react"], evidence: [] } };
  const composed = await service.execute({ protocolVersion: "0.2", requestId: "compose-1", tool: "fy_compose", payload });
  expect(composed.result.composition).toMatchObject({ coverage: expect.arrayContaining([
    expect.objectContaining({ requirement: "method.coordinate" }),
    expect.objectContaining({ requirement: "quality.test" }),
    expect.objectContaining({ requirement: "quality.review" }),
  ]) });
  const preview = await service.execute({ protocolVersion: "0.2", requestId: "preview-1", tool: "fy_prepare", payload });
  expect(preview.result).toMatchObject({ applied: false, status: "preview",
    decision: { orchestration: { maxConcurrency: 1 } } });
  expect(preview.result.decision).toMatchObject({ normalizedNeeds: { intent: "maintenance", risk: "medium", needs: ["domain.react"] } });
});

test("native apply confirms the actual frozen capsule and identical retry does not install/approve twice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-apply-")); directories.push(directory);
  const root = path.join(directory, "project"); await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "existing", dependencies: { react: "19" }, scripts: { test: "node --test" } }));
  let dialogs = 0; let approvedId = "";
  const service = await createProjectService({ root, stateDirectory: path.join(directory, "private-state"),
    confirmation: async (input) => { dialogs += 1; approvedId = input.capsule.id;
      expect(input.capsule.payload.files.some((file) => file.path === "forgeyard.lock")).toBe(true);
      expect(input.description).toContain("Exact installation:"); return { accepted: true, channel: "test-fixture" }; } });
  services.push(service);
  const request = { protocolVersion: "0.2", requestId: "apply-once", tool: "fy_apply", payload: {
    brief: "Fix the existing API without changing compatibility", adapter: "codex", expectedRevision: 0,
    proposal: { intent: "maintenance", risk: "medium", needs: ["domain.react"], evidence: [] },
  } };
  const first = await service.execute(request); expect(first.result).toMatchObject({ applied: true, capsuleId: approvedId });
  expect(await service.execute(request)).toEqual(first); expect(dialogs).toBe(1);
});

test("two concurrent native applies cannot enter two installer transactions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-race-")); directories.push(directory);
  const root = path.join(directory, "project"); await mkdir(root);
  let dialogs = 0;
  const options = { root, stateDirectory: path.join(directory, "private-state"), confirmation: async () => {
    dialogs += 1; return { accepted: true, channel: "test-fixture" as const }; } };
  const a = await createProjectService(options); const b = await createProjectService(options); services.push(a, b);
  const proposal = { intent: "maintenance", risk: "medium", needs: [], evidence: [] };
  const results = await Promise.allSettled([a.execute({ protocolVersion: "0.2", requestId: "apply-a", tool: "fy_apply",
    payload: { brief: "Maintain the existing behavior", adapter: "codex", proposal, expectedRevision: 0 } }),
    b.execute({ protocolVersion: "0.2", requestId: "apply-b", tool: "fy_apply",
      payload: { brief: "Maintain the existing behavior", adapter: "claude-code", proposal, expectedRevision: 0 } })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(dialogs).toBe(1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: expect.stringMatching(/FY_REVISION_CONFLICT|FY_PREPARATION_BUSY/) });
});

test("nested Spring module preserves a project-relative gate working directory end to end", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-java-")); directories.push(directory);
  const root = path.join(directory, "project"); await mkdir(path.join(root, "backend"), { recursive: true });
  await writeFile(path.join(root, "backend/pom.xml"), "<project><groupId>org.springframework.boot</groupId></project>");
  await writeFile(path.join(root, "backend/mvnw.cmd"), "@rem inspected fixture only\n");
  const service = await createProjectService({ root, stateDirectory: path.join(directory, "private-state") }); services.push(service);
  const preview = await service.execute({ protocolVersion: "0.2", requestId: "nested-module", tool: "fy_prepare", payload: {
    brief: "Maintain the existing backend API", proposal: { intent: "maintenance", risk: "medium", needs: ["domain.spring"], evidence: [] },
  } });
  expect(preview.result).toMatchObject({ status: "preview" });
});

test("native constraints freeze proposed project scopes, gates and generic work intensity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-constraints-")); directories.push(directory);
  const root = path.join(directory, "project"); await mkdir(root);
  const service = await createProjectService({ root, stateDirectory: path.join(directory, "private-state"),
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }) }); services.push(service);
  const payload = { brief: "Build a portable service", proposal: { intent: "new-project", risk: "medium", needs: [], evidence: [] },
    constraints: { maxConcurrency: 7, autonomy: "supervised", mutableRoots: ["service", "tests"],
      qualityCommands: [{ name: "unit-tests", argv: ["node", "--test", "tests/service.test.mjs"] }] } };
  const preview = await service.execute({ protocolVersion: "0.2", requestId: "constraints-preview", tool: "fy_prepare", payload });
  expect(preview.result).toMatchObject({ capsuleId: expect.stringMatching(/^[a-f0-9]{64}$/),
    policy: { maxConcurrency: 7, mutableRoots: ["service", "tests"], autonomy: "supervised" },
    gates: [{ id: "G001", parser: "test-summary", argv: ["node", "--test", "tests/service.test.mjs"] }] });
  const applied = await service.execute({ protocolVersion: "0.2", requestId: "constraints-apply", tool: "fy_apply",
    payload: { ...payload, expectedRevision: preview.revision } });
  expect(applied.result).toMatchObject({ applied: true, capsuleId: preview.result.capsuleId });
});

test("simultaneous identical apply retries do not display two dialogs or enter two installations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-identical-race-")); directories.push(directory);
  const root = path.join(directory, "project"); await mkdir(root); let dialogs = 0;
  const service = await createProjectService({ root, stateDirectory: path.join(directory, "private-state"),
    confirmation: async () => { dialogs += 1; return { accepted: true, channel: "test-fixture" }; } }); services.push(service);
  const envelope = { protocolVersion: "0.2", requestId: "concurrent-identical", tool: "fy_apply", payload: {
    brief: "Maintain existing behavior", expectedRevision: 0, proposal: { intent: "maintenance", risk: "medium", needs: [], evidence: [] } } };
  const results = await Promise.allSettled([service.execute(envelope), service.execute(envelope)]);
  expect(dialogs).toBe(1);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const success = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<unknown>).value;
  expect(await service.execute(envelope)).toEqual(success);
});
