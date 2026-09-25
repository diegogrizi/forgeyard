import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { memberForScope, touchedMembers } from "../../../src/native/members.js";

const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
  roots.push(root);
  for (const member of ["servizio-ordini", "frontend"]) {
    await mkdir(path.join(root, member, ".git"), { recursive: true });
    await mkdir(path.join(root, member, "src"), { recursive: true });
  }
  return root;
}

describe("da un ambito di scrittura al suo repository membro", () => {
  test("riconosce il membro che contiene l'ambito", async () => {
    const root = await workspace();
    expect(await memberForScope(root, "servizio-ordini/src")).toBe("servizio-ordini");
  });

  test("un ambito che non esiste ancora risale dall'antenato piu' vicino che esiste", async () => {
    const root = await workspace();
    // Gli ambiti nominano cartelle che il lavoro puo' creare: la risalita non pretende
    // che la foglia sia gia' sul disco.
    expect(await memberForScope(root, "frontend/src/ancora-da-creare")).toBe("frontend");
  });

  test("la radice stessa e' un membro, e si chiama '.'", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    expect(await memberForScope(root, "src")).toBe(".");
  });

  test("vince l'albero piu' vicino, non il piu' esterno", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
    roots.push(root);
    await mkdir(path.join(root, ".git"), { recursive: true });
    await mkdir(path.join(root, "annidato", ".git"), { recursive: true });
    await mkdir(path.join(root, "annidato", "src"), { recursive: true });
    // Chi possiede quel percorso e' il working tree che lo contiene, ed e' il suo HEAD
    // a dire se e' cambiato.
    expect(await memberForScope(root, "annidato/src")).toBe("annidato");
  });

  test("un .git come file — un linked worktree — conta come albero", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
    roots.push(root);
    await mkdir(path.join(root, "collegato"), { recursive: true });
    await writeFile(path.join(root, "collegato", ".git"), "gitdir: /altrove/.git/worktrees/collegato\n");
    expect(await memberForScope(root, "collegato")).toBe("collegato");
  });

  test("un ambito che non sta in nessun albero Git e' rifiutato, e nomina l'ambito", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
    roots.push(root);
    await mkdir(path.join(root, "senza-git"), { recursive: true });
    await expect(memberForScope(root, "senza-git")).rejects.toMatchObject({ code: "FY_GIT_REQUIRED" });
    await expect(memberForScope(root, "senza-git")).rejects.toMatchObject({
      message: expect.stringContaining("senza-git"),
    });
  });

  test("un ambito che risale oltre la radice e' rifiutato", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-membri-"));
    roots.push(root);
    // Il confinamento e' una garanzia, non un effetto collaterale dell'helper: questa prova
    // se ne accorgerebbe se resolveInsideRoot diventasse un path.resolve senza controllo.
    await expect(memberForScope(root, "../fuori")).rejects.toMatchObject({ code: "FY_PATH_UNSAFE" });
  });

  test("l'insieme dei membri toccati e' ordinato e deduplicato", async () => {
    const root = await workspace();
    expect(await touchedMembers(root, ["frontend/src", "servizio-ordini/src", "frontend/test"]))
      .toEqual(["frontend", "servizio-ordini"]);
  });
});
