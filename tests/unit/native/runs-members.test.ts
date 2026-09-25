import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { compileCapsule, type Capsule } from "../../../src/capsule/capsule.js";
import type { ForgeyardConfig } from "../../../src/core/contracts.js";
import { assertTaskMembers, evidenceGaps } from "../../../src/native/runs.js";
import type { NativeRun, NativeState, ProductPlan } from "../../../src/native/contracts.js";

const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-attivita-"));
  roots.push(root);
  for (const member of ["frontend", "servizio-ordini"]) {
    await mkdir(path.join(root, member, ".git"), { recursive: true });
    await mkdir(path.join(root, member, "src"), { recursive: true });
  }
  return root;
}

function plan(writeScopes: readonly string[][]): ProductPlan {
  return {
    id: "filter-orders", request: "Add the requested filter", risk: "low",
    requirements: [{ id: "R1", description: "The requested result is available" }],
    tasks: writeScopes.map((scopes, index) => ({
      id: `T${index + 1}`, title: "Deliver", objective: "Implement",
      requirementIds: ["R1"], dependsOn: [], writeScopes: [...scopes], role: "implementer",
      criteria: [{ id: "C1", description: "Meets the contract", gateIds: ["G001"] }],
    })),
  } as ProductPlan;
}

describe("un lavoro attraversa i membri, un'attivita' no", () => {
  test("assegna a ogni attivita' il proprio membro", async () => {
    const root = await workspace();
    expect(await assertTaskMembers(root, plan([["frontend/src"], ["servizio-ordini/src"]])))
      .toEqual({ T1: "frontend", T2: "servizio-ordini" });
  });

  test("un piano a repository singolo produce ancora '.'", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-attivita-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    // Un piano a repository singolo deve continuare a produrre ".", ed e' cio' che
    // conserva il comportamento di oggi.
    expect(await assertTaskMembers(root, plan([["src"]]))).toEqual({ T1: "." });
  });

  test("rifiuta un'attivita' che mescola due membri, e li nomina entrambi", async () => {
    const root = await workspace();
    // Un gate gira una volta per attivita', con una cwd: se gli ambiti stessero in due
    // membri quella cwd non esisterebbe, e la ricevuta non potrebbe dire su quale
    // revisione ha girato.
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ code: "FY_PLAN_INVALID" });
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ message: expect.stringContaining("frontend") });
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ message: expect.stringContaining("servizio-ordini") });
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ message: expect.stringContaining("T1") });
  });

  test("un'attivita' senza ambiti non ha un membro e non viene rifiutata", async () => {
    const root = await workspace();
    // Le attivita' di sola revisione esistono: non scrivono niente, quindi non
    // appartengono a nessun albero.
    expect(await assertTaskMembers(root, plan([[]]))).toEqual({});
  });
});

describe("la baseline di un lavoro", () => {
  test("porta un commit per ogni membro toccato", () => {
    // La forma e' il contratto: `baselineHead: string` non puo' rappresentare due membri,
    // e un campo che ne rappresenta uno solo mentirebbe sul secondo.
    const run: Pick<NativeRun, "baselineHeads"> = {
      baselineHeads: { frontend: "a".repeat(40), "servizio-ordini": "b".repeat(40) },
    };
    expect(Object.keys(run.baselineHeads)).toEqual(["frontend", "servizio-ordini"]);
  });
});

// A minimal but real capsule, compiled by the production function rather than hand-written:
// a hand-rolled literal would silently drift from what `compileCapsule` actually produces.
const capsuleConfig: ForgeyardConfig = {
  schemaVersion: 1,
  project: { name: "Divari", purpose: "Prova unitaria", mode: "new" },
  harnesses: ["codex"],
  profile: "minimal",
  catalog: { selection: "none", plugins: [] },
  timeboxMinutes: 60,
  quality: { commands: [{ name: "unit", argv: ["node", "-e", "process.exit(0)"] }] },
  paths: { mutableRoots: ["src"], protectedPaths: [] },
  orchestration: { mode: "guided", maxConcurrency: 1 },
};
const capsule: Capsule = compileCapsule(capsuleConfig, []);

const state: NativeState = { schemaVersion: 3, revision: 0, capsuleId: null, writer: null,
  runs: [], grants: [], operations: [], artifacts: [] };

// A complete `NativeRun`, not a partial cast: `membersByTask` is what these tests exercise,
// and an `as NativeRun` over an incomplete object would let a missing field pass silently.
function runWith(overrides: Partial<NativeRun> = {}): NativeRun {
  return {
    plan: plan([["src"]]), planSha256: "a".repeat(64), capsuleId: "b".repeat(64), status: "verifying",
    createdAt: "2026-09-25T10:00:00.000Z", deadlineAt: "2026-09-25T15:00:00.000Z", repairs: 0,
    approvalBaseline: "c".repeat(64), artifactSha256: "d".repeat(64),
    baselineHeads: { ".": "e".repeat(40) },
    checkpoints: [], criteria: [], reviews: [], completedTaskIds: [], decisions: [],
    recordedCostUsd: null, usage: [], membersByTask: {},
    ...overrides,
  };
}

describe("i divari nominano il membro", () => {
  test("un gate mancante in un membro porta il membro nel divario", () => {
    const run = runWith({ membersByTask: { T1: "servizio-ordini" } });
    expect(evidenceGaps(state, run, capsule, "a".repeat(64), [])).toContain("gate:servizio-ordini/T1/G001");
  });

  test("con il membro '.' il divario resta quello di oggi", () => {
    // Il caso a repository singolo non cambia forma: un divario nuovo obbligherebbe
    // chiunque legga i rapporti esistenti a imparare due grammatiche.
    const run = runWith({ membersByTask: { T1: "." } });
    expect(evidenceGaps(state, run, capsule, "a".repeat(64), [])).toContain("gate:T1/G001");
  });

  test("un'attivita' senza ambiti non ha membro, e il divario resta quello di oggi", () => {
    const run = runWith({ membersByTask: {} });
    expect(evidenceGaps(state, run, capsule, "a".repeat(64), [])).toContain("gate:T1/G001");
  });
});
