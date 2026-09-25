import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { assertTaskMembers } from "../../../src/native/runs.js";
import type { ProductPlan } from "../../../src/native/contracts.js";

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

  test("rifiuta un'attivita' che mescola due membri, e li nomina entrambi", async () => {
    const root = await workspace();
    // Un gate gira una volta per attivita', con una cwd: se gli ambiti stessero in due
    // membri quella cwd non esisterebbe, e la ricevuta non potrebbe dire su quale
    // revisione ha girato.
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ code: "FY_PLAN_INVALID" });
    await expect(assertTaskMembers(root, plan([["frontend/src", "servizio-ordini/src"]])))
      .rejects.toMatchObject({ message: expect.stringContaining("frontend") });
  });

  test("un'attivita' senza ambiti non ha un membro e non viene rifiutata", async () => {
    const root = await workspace();
    // Le attivita' di sola revisione esistono: non scrivono niente, quindi non
    // appartengono a nessun albero.
    expect(await assertTaskMembers(root, plan([[]]))).toEqual({});
  });
});
