import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadTaskGraph, readyTaskIds } from "../../../src/orchestrator/graph.js";

const temporaryRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-graph-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".forgeyard", "tasks"), { recursive: true });
  return root;
}

async function putTask(root: string, fileName: string, body: string): Promise<void> {
  await writeFile(path.join(root, ".forgeyard", "tasks", fileName), `${body.trim()}\n`, "utf8");
}

function task(id: string, dependsOn: readonly string[] = [], writeScopes: readonly string[] = ["src"]): string {
  return [
    "schemaVersion: 1",
    `id: ${id}`,
    `title: ${id} title`,
    `objective: Deliver ${id}`,
    "acceptanceCriteria:",
    "  - The observable behavior works",
    ...(dependsOn.length === 0
      ? ["dependsOn: []"]
      : ["dependsOn:", ...dependsOn.map((dependency) => `  - ${dependency}`)]),
    "writeScopes:",
    ...writeScopes.map((scope) => `  - ${scope}`),
    "role: implementer",
    "capabilities:",
    "  - implementation",
    "limits:",
    "  minutes: 45",
    "  maxRetries: 2",
    "evidence:",
    "  required: true",
    "integration:",
    "  owner: integrator",
    "  target: current",
    "command:",
    "  - node",
    "  - -e",
    "  - process.exit(0)",
    "required: true",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Forgeyard task graph", () => {
  test("loads a deterministic DAG and returns only dependency-ready tasks", async () => {
    const root = await freshRoot();
    await putTask(root, "T002.yaml", task("T002", ["T001"], ["src/api"]));
    await putTask(root, "T001.yaml", task("T001", [], ["src/ui"]));

    const graph = await loadTaskGraph({
      root,
      mutableRoots: ["src", "presentation"],
      protectedPaths: [".git", ".env"],
    });

    expect(graph.tasks.map((entry) => entry.task.id)).toEqual(["T001", "T002"]);
    expect(graph.tasks[0]).toEqual(expect.objectContaining({ definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(graph.graphSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readyTaskIds(graph, new Set())).toEqual(["T001"]);
    expect(readyTaskIds(graph, new Set(["T001"]))).toEqual(["T002"]);
  });

  test("normalizes legacy verification tasks into a schedulable definition", async () => {
    const root = await freshRoot();
    await putTask(root, "T001.yaml", [
      "schemaVersion: 1",
      "id: T001",
      "title: Verify slice",
      'command: ["node", "-e", "process.exit(0)"]',
      "required: true",
    ].join("\n"));

    const graph = await loadTaskGraph({ root, mutableRoots: ["src"], protectedPaths: [".git"] });

    expect(graph.tasks[0]!.task).toEqual(expect.objectContaining({
      id: "T001",
      objective: "Verify slice",
      acceptanceCriteria: ["The verification command exits successfully."],
      dependsOn: [],
      writeScopes: ["src"],
      role: "implementer",
      limits: { minutes: 60, maxRetries: 2 },
      evidence: { required: true },
    }));
  });

  test.each([
    ["missing dependency", task("T001", ["T999"]), "FY_GRAPH_INVALID"],
    ["unsafe scope", task("T001", [], ["../outside"]), "FY_PATH_UNSAFE"],
    ["case-colliding scopes", task("T001", [], ["src/ui", "SRC/UI"]), "FY_PATH_UNSAFE"],
    ["scope outside mutable roots", task("T001", [], ["docs"]), "FY_SCOPE_DENIED"],
    ["scope inside a protected path", task("T001", [], ["src/secrets"]), "FY_SCOPE_DENIED"],
  ])("rejects %s", async (_name, source, code) => {
    const root = await freshRoot();
    await putTask(root, "T001.yaml", source);

    await expect(loadTaskGraph({
      root,
      mutableRoots: ["src"],
      protectedPaths: [".git", "src/secrets"],
    })).rejects.toEqual(expect.objectContaining({ code }));
  });

  test("rejects dependency cycles", async () => {
    const root = await freshRoot();
    await putTask(root, "T001.yaml", task("T001", ["T002"]));
    await putTask(root, "T002.yaml", task("T002", ["T001"]));

    await expect(loadTaskGraph({
      root,
      mutableRoots: ["src"],
      protectedPaths: [".git"],
    })).rejects.toEqual(expect.objectContaining({ code: "FY_GRAPH_INVALID" }));
  });
});
