import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";

import { createCodexAdapter } from "../../src/adapters/codex.js";
import { loadConfig } from "../../src/config/config.js";
import { applyInstallPlan } from "../../src/installer/apply.js";
import { buildInstallPlan } from "../../src/installer/plan.js";
import { loadRegistry } from "../../src/registry/load.js";
import { resolveProfile } from "../../src/registry/resolve.js";
import type { ProductPlan } from "../../src/native/contracts.js";

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
