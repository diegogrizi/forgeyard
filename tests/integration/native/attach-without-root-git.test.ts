import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

// Prova piu' lenta di questo file, cronometrata su questa macchina a riposo: 9,5 s.
// Installa un'imbracatura vera su una radice senza `.git` e percorre il protocollo nativo fino
// al primo `fy_plan`. Il tetto dichiarato serve a cogliere un blocco, non a sorvegliare la
// durata: se scade, cronometra prima di dare la colpa alla macchina.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { loadConfig } from "../../../src/config/config.js";
import { applyInstallPlan } from "../../../src/installer/apply.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";
import { createProjectService } from "../../../src/native/service.js";
import type { ProductPlan } from "../../../src/native/contracts.js";
import { git, nativeHarness } from "../../helpers/native.js";

/**
 * A workspace root with no `.git` at all — the exact case this plan exists to stop refusing at
 * `fy_attach` — plus one member repository that does have its own `.git` but no commit yet.
 * `fy_plan` still has to refuse that member, and by name: this second half is not decorative,
 * without it the test would only show that a check was removed, not that the right one moved.
 */
async function noGitRootFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-no-git-root-"));
  const root = path.join(directory, "workspace");
  const memberRelative = "servizio";
  const memberAbsolute = path.join(root, memberRelative);
  await mkdir(memberAbsolute, { recursive: true });
  await git(memberAbsolute, ["init", "-b", "main"]);
  await git(memberAbsolute, ["config", "user.name", "Fixture"]);
  await git(memberAbsolute, ["config", "user.email", "fixture@example.invalid"]);

  const base = await loadConfig(path.resolve("fixtures/answers/minimal.yaml"));
  const config = { ...base, paths: { ...base.paths, mutableRoots: [memberRelative] },
    quality: { commands: [{ name: "unit", argv: ["node", "-e", "process.exit(0)"] as const }] } };
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "minimal", "codex");
  const files = await createCodexAdapter().render(resolved.components, config);
  const plan = buildInstallPlan({ targetRoot: root, config, resolved, renderedFiles: files,
    operationId: "attach-no-git-root-install", forgeyardVersion: "0.1.0" });
  await applyInstallPlan(plan);
  // The root is deliberately left without `.git`: the harness installs into an ordinary
  // directory, and only the member below is a working tree.
  return { directory, root, stateDirectory: path.join(directory, "private-state"), memberRelative };
}

const { register, call } = nativeHarness({ requestPrefix: "attach-no-git" });

test("fy_attach riesce senza un repository alla radice, e fy_plan rifiuta ancora nominando il membro senza commit", async () => {
  const fixture = await noGitRootFixture();
  const service = await createProjectService({ ...fixture,
    confirmation: async () => ({ accepted: true, channel: "test-fixture" }) });
  register(fixture, service);

  // `fy_attach` binds no evidence to a revision: a workspace root that is not a working tree
  // must not block it. This is the exact `FY_GIT_REQUIRED` this whole plan exists to remove.
  const attached = await call(service, "fy_attach", { mode: "write", sessionId: "writer", expectedRevision: 0 });
  expect(attached.result).toMatchObject({ mode: "write" });

  const plan: ProductPlan = {
    id: "attach-no-git-root", request: "Touch the member repository", risk: "low",
    requirements: [{ id: "R1", description: "The member's own history is what a run binds to" }],
    tasks: [{ id: "T1", title: "Touch the member", objective: "Implement inside the member repository",
      requirementIds: ["R1"], dependsOn: [], writeScopes: [fixture.memberRelative], role: "implementer",
      criteria: [{ id: "C1", description: "The gate passes", gateIds: ["G001"] }] }],
  };
  const context = await call(service, "fy_context", {});
  // `fy_plan` still demands a commit — per touched member, and named, not root's absent one.
  await expect(call(service, "fy_plan", { sessionId: "writer", expectedRevision: context.revision, plan }))
    .rejects.toMatchObject({ code: "FY_GIT_REQUIRED", message: expect.stringContaining(fixture.memberRelative) });
});
