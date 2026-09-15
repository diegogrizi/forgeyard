import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCodexAdapter } from "../../../src/adapters/codex.js";
import { loadConfig } from "../../../src/config/config.js";
import type { InstallPlan, PlannedFile } from "../../../src/core/contracts.js";
import { sha256Text } from "../../../src/core/hash.js";
import { buildInstallPlan } from "../../../src/installer/plan.js";
import { loadRegistry } from "../../../src/registry/load.js";
import { resolveProfile } from "../../../src/registry/resolve.js";

export const temporaryRoots: string[] = [];

export async function freshLifecycleRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-lifecycle-"));
  temporaryRoots.push(root);
  return root;
}

export async function cleanLifecycleRoots(): Promise<void> {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function basePlan(root: string, operationId = "20260915T130000000Z-base01"): Promise<InstallPlan> {
  const config = await loadConfig(path.resolve("fixtures/answers/hackathon.yaml"));
  const registry = await loadRegistry(path.resolve("."));
  const resolved = resolveProfile(registry, "hackathon", "codex");
  const renderedFiles = await createCodexAdapter().render(resolved.components, config);
  return buildInstallPlan({
    targetRoot: root,
    config,
    resolved,
    renderedFiles,
    operationId,
    forgeyardVersion: "0.1.0",
  });
}

function withContent(file: PlannedFile, content: string): PlannedFile {
  return { ...file, content, sha256: sha256Text(content) };
}

export function changedPlan(base: InstallPlan, operationId = "20260915T131000000Z-next01"): InstallPlan {
  const changed: PlannedFile[] = base.files
    .filter((file) => file.path !== ".codex/agents/reviewer.toml")
    .map((file) =>
      file.path === "AGENTS.md" ? withContent(file, `${file.content}\nUpdate marker.\n`) : file,
    );
  const extraContent = "Generated lifecycle note.\n";
  changed.push({
    path: "notes/generated.md",
    content: extraContent,
    sha256: sha256Text(extraContent),
    componentId: "foundation.lifecycle-note",
    ownership: "managed",
  });
  return { ...base, operationId, files: changed };
}

export async function payloadSnapshot(plan: InstallPlan): Promise<Map<string, string | undefined>> {
  const snapshot = new Map<string, string | undefined>();
  for (const file of plan.files) {
    try {
      snapshot.set(file.path, await readFile(path.join(plan.targetRoot, ...file.path.split("/")), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") snapshot.set(file.path, undefined);
      else throw error;
    }
  }
  return snapshot;
}
