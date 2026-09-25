import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterAll } from "vitest";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { loadConfig } from "../../src/config/config.js";
import { applyInstallPlan } from "../../src/installer/apply.js";
import { buildInstallPlan } from "../../src/installer/plan.js";
import { loadRegistry } from "../../src/registry/load.js";
import { resolveProfile } from "../../src/registry/resolve.js";
import type { NativeResponse, ProductPlan } from "../../src/native/contracts.js";
import type { ProjectService } from "../../src/native/service.js";

export async function nativeFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-native-"));
  const root = path.join(directory, "project");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "feature.txt"), "initial\n");
  const base = await loadConfig(path.resolve("fixtures/answers/minimal.yaml"));
  const config = { ...base, paths: { ...base.paths, mutableRoots: ["src"] },
    quality: { commands: [
      { name: "unit", argv: ["node", "--test", "src/feature.test.mjs"] as const },
      { name: "lint", argv: ["node", "-e", "process.exit(0)"] as const },
    ] } };
  await writeFile(path.join(root, "src", "feature.test.mjs"),
    'import {test} from "node:test"; import assert from "node:assert/strict"; test("feature",()=>assert.equal(1,1));\n');
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "minimal", "codex");
  const files = await createCodexAdapter().render(resolved.components, config);
  const plan = buildInstallPlan({ targetRoot: root, config, resolved, renderedFiles: files,
    operationId: "native-fixture-install", forgeyardVersion: "0.1.0" });
  await applyInstallPlan(plan);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await commitAll(root);
  return { directory, root, stateDirectory: path.join(directory, "private-state") };
}

export async function git(root: string, argv: string[]) {
  return execa("git", argv, { cwd: root, shell: false, stdin: "ignore" });
}

export async function commitAll(root: string) {
  await git(root, ["add", "--all"]);
  await git(root, ["commit", "-m", "fixture revision"]);
}

export function productPlan(risk: "low" | "medium" | "high" = "low"): ProductPlan {
  return {
    id: "filter-orders", request: "Add the requested filter", risk,
    requirements: [{ id: "R1", description: "The requested result is available" }],
    tasks: [{ id: "T1", title: "Deliver the filter", objective: "Implement the approved result",
      requirementIds: ["R1"], dependsOn: [], writeScopes: ["src"], role: "implementer",
      criteria: [{ id: "C1", description: "The filter meets the agreed contract", gateIds: ["G001"] }] }],
  };
}

/**
 * Two real member repositories under one workspace root that is deliberately not a Git working
 * tree — the shape this whole plan exists to enable. The harness is installed once, at the root:
 * one copy of the catalog, one place for the instructions, and an agent that sees both members.
 * Those harness files are tracked by nobody, because the root is no repository and they sit
 * outside both members, so neither member's status ever mentions them.
 */
export async function multiMemberFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
  const root = path.join(directory, "workspace");
  const members = ["frontend", "servizio-ordini"] as const;
  for (const member of members) {
    const memberRoot = path.join(root, member);
    await mkdir(path.join(memberRoot, "src"), { recursive: true });
    await writeFile(path.join(memberRoot, "src", "feature.txt"), "initial\n");
    await writeFile(path.join(memberRoot, "src", "feature.test.mjs"),
      'import {test} from "node:test"; import assert from "node:assert/strict"; test("feature",()=>assert.equal(1,1));\n');
    await git(memberRoot, ["init", "-b", "main"]);
    await git(memberRoot, ["config", "user.name", "Fixture"]);
    await git(memberRoot, ["config", "user.email", "fixture@example.invalid"]);
    await commitAll(memberRoot);
  }
  // L'imbracatura sta alla radice: una copia per il workspace, non una per membro.
  // La radice NON e' un repository Git, ed e' esattamente il caso che questo piano abilita.
  const base = await loadConfig(path.resolve("fixtures/answers/minimal.yaml"));
  const config = { ...base, paths: { ...base.paths, mutableRoots: members.map((member) => `${member}/src`) },
    quality: { commands: [
      { name: "unit", argv: ["node", "--test", "src/feature.test.mjs"] as const },
      { name: "lint", argv: ["node", "-e", "process.exit(0)"] as const },
    ] } };
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "minimal", "codex");
  const files = await createCodexAdapter().render(resolved.components, config);
  await applyInstallPlan(buildInstallPlan({ targetRoot: root, config, resolved, renderedFiles: files,
    operationId: "multi-member-install", forgeyardVersion: "0.1.0" }));
  return { directory, root, stateDirectory: path.join(directory, "private-state"), members };
}

/** One task per member: the cross-repository case, with no task mixing two of them. */
export function multiMemberPlan(members: readonly string[] = ["frontend", "servizio-ordini"],
  id = "filter-orders"): ProductPlan {
  return {
    id, request: "Add the requested filter across both services", risk: "low",
    requirements: [{ id: "R1", description: "The requested result is available" }],
    tasks: members.map((member, position) => ({
      id: `T${position + 1}`, title: `Deliver the filter in ${member}`,
      objective: "Implement the approved result", requirementIds: ["R1"], dependsOn: [],
      writeScopes: [`${member}/src`], role: "implementer" as const,
      criteria: [{ id: "C1", description: "The filter meets the agreed contract", gateIds: ["G001"] }],
    })),
  };
}

/**
 * The scaffolding every suite in `tests/integration/native/` needs: request IDs that do not
 * collide, the read-then-write pair a mutating tool requires, and the teardown that closes the
 * services before removing the directories they hold handles in. It existed in three
 * near-identical copies and a fourth was one test away. It carries no rule, so the duplication
 * was not the kind `AGENTS.md` forbids — but a suite should get the teardown by asking for the
 * harness, not by remembering to write it, so `afterAll` is registered here.
 *
 * The two arrays stay private and `register` is the only way in. An earlier shape handed them
 * back and every suite still wrote `fixtures.push(...)` and `services.push(...)` by hand: the
 * teardown was automatic but half of what it needs was not, which is the same thing to forget
 * one line later.
 */
export function nativeHarness(options: { requestPrefix: string; runId?: string }) {
  const fixtures: { directory: string }[] = [];
  const services: ProjectService[] = [];
  let index = 0;
  afterAll(async () => {
    // Services first: a gate still running holds a handle inside the directory being removed.
    for (const service of services.splice(0)) await service.close();
    for (const fixture of fixtures.splice(0)) await rm(fixture.directory, { recursive: true, force: true });
  });
  /** A fixture and the service opened on it, handed to the teardown in one statement. */
  function register(fixture: { directory: string }, service: ProjectService): void {
    fixtures.push(fixture);
    services.push(service);
  }
  async function call(service: ProjectService, tool: string, payload: Record<string, unknown>,
    requestId = `${options.requestPrefix}-${++index}`): Promise<NativeResponse> {
    return service.execute({ protocolVersion: "0.2", requestId, tool, payload });
  }
  async function mutation(service: ProjectService, tool: string, payload: Record<string, unknown>): Promise<NativeResponse> {
    const context = await call(service, "fy_context", {});
    return call(service, tool, { sessionId: "writer", expectedRevision: context.revision,
      ...(tool === "fy_plan" || options.runId === undefined ? {} : { runId: options.runId }), ...payload });
  }
  return { register, call, mutation };
}
