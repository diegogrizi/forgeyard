import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterAll, describe, expect, test, vi } from "vitest";

// Ogni prova crea due repository Git veri e ci committa. Prova piu' lenta cronometrata a
// macchina ferma: 18,5 s. Il tetto globale di 30 s e' tarato su prove unitarie che non
// generano processi; il tetto dichiarato qui serve a cogliere un blocco, non a sorvegliare
// la durata.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

import { changedSince, dirtyInputGaps, namedUncleanMembers, uncleanMemberClause,
  workspaceSnapshot } from "../../../src/native/workspace.js";

const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function git(cwd: string, args: string[]): Promise<void> {
  await execa("git", args, { cwd, shell: false, stdin: "ignore" });
}

async function twoMembers(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-snap-"));
  roots.push(root);
  for (const member of ["frontend", "servizio-ordini"]) {
    const directory = path.join(root, member);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(path.join(directory, "src", "index.ts"), "export const x = 1;\n");
    await git(directory, ["init", "-b", "main"]);
    await git(directory, ["config", "user.name", "Fixture"]);
    await git(directory, ["config", "user.email", "fixture@example.invalid"]);
    await git(directory, ["add", "--all"]);
    await git(directory, ["commit", "-m", "init"]);
  }
  return root;
}

describe("fotografia di un workspace con piu' membri", () => {
  test("riporta un HEAD per ogni membro toccato", async () => {
    const root = await twoMembers();
    const snapshot = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);
    expect([...snapshot.members.keys()]).toEqual(["frontend", "servizio-ordini"]);
    expect(snapshot.members.get("frontend")?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.members.get("servizio-ordini")?.head).toMatch(/^[0-9a-f]{40}$/);
  });

  test("un commit in un membro non toccato non cambia l'aggregato", async () => {
    const root = await twoMembers();
    const before = await workspaceSnapshot(root, ["frontend"]);

    await writeFile(path.join(root, "servizio-ordini", "src", "nuovo.ts"), "export const y = 2;\n");
    await git(path.join(root, "servizio-ordini"), ["add", "--all"]);
    await git(path.join(root, "servizio-ordini"), ["commit", "-m", "estraneo"]);

    // Assenza di effetto, non assenza di controllo: quel commit non puo' aver cambiato
    // cio' che i gate di `frontend` hanno verificato.
    expect((await workspaceSnapshot(root, ["frontend"])).sha256).toBe(before.sha256);
  });

  test("un commit in un membro toccato cambia l'aggregato", async () => {
    const root = await twoMembers();
    const before = await workspaceSnapshot(root, ["frontend"]);

    await writeFile(path.join(root, "frontend", "src", "nuovo.ts"), "export const y = 2;\n");
    await git(path.join(root, "frontend"), ["add", "--all"]);
    await git(path.join(root, "frontend"), ["commit", "-m", "toccato"]);

    expect((await workspaceSnapshot(root, ["frontend"])).sha256).not.toBe(before.sha256);
  });

  test("l'aggregato non dipende dall'ordine in cui i membri sono chiesti", async () => {
    const root = await twoMembers();
    const uno = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);
    const due = await workspaceSnapshot(root, ["servizio-ordini", "frontend"]);
    expect(uno.sha256).toBe(due.sha256);
  });

  test("un membro senza commit lascia il proprio HEAD a null", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-snap-"));
    roots.push(root);
    await mkdir(path.join(root, "vuoto"), { recursive: true });
    await git(path.join(root, "vuoto"), ["init", "-b", "main"]);
    const snapshot = await workspaceSnapshot(root, ["vuoto"]);
    expect(snapshot.members.get("vuoto")?.head).toBeNull();
  });

  test("una fotografia su zero membri e' rifiutata, non aggregata a vuoto", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-snap-"));
    roots.push(root);
    // Su zero membri `clean` sarebbe vero per vacuita' e il digest sarebbe una costante:
    // ogni confronto di staleness contro di lui passerebbe sempre. L'invariante appartiene
    // a questa funzione, non alla prosa di chi la chiama.
    await expect(workspaceSnapshot(root, [])).rejects.toMatchObject({ code: "FY_INTERNAL" });
  });

  test("senza membri espliciti fotografa la radice, come prima", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-snap-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n");
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Fixture"]);
    await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["add", "--all"]);
    await git(root, ["commit", "-m", "init"]);

    const snapshot = await workspaceSnapshot(root);
    expect([...snapshot.members.keys()]).toEqual(["."]);
    expect(snapshot.members.get(".")?.head).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("un albero sporco dice QUALE membro lo e'", () => {
  test("il divario nomina il membro sporco, e solo quello", async () => {
    const root = await twoMembers();
    // Sporco uno dei due membri: chi legge il rifiuto deve sapere dove andare, e su due
    // repository `git:dirty-inputs` da solo lo manda a cercare.
    await writeFile(path.join(root, "servizio-ordini", "src", "bozza.ts"), "export const y = 2;\n");
    const snapshot = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);

    expect(dirtyInputGaps(snapshot)).toEqual(["git:dirty-inputs:servizio-ordini"]);
    expect(uncleanMemberClause(snapshot)).toContain("servizio-ordini");
    // E il membro pulito non compare: un rifiuto che accusasse anche frontend manderebbe
    // chi legge a cercare un guasto dove non c'e'.
    expect(uncleanMemberClause(snapshot)).not.toContain("frontend");
  });

  test("due membri sporchi danno due divari, uno per membro", async () => {
    const root = await twoMembers();
    for (const member of ["frontend", "servizio-ordini"])
      await writeFile(path.join(root, member, "src", "bozza.ts"), "export const y = 2;\n");
    const snapshot = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);

    // Un divario per membro, non uno che li elenca: un divario e' una cosa da chiudere, e
    // committare in un membro deve toglierne esattamente uno.
    expect(dirtyInputGaps(snapshot)).toEqual(["git:dirty-inputs:frontend", "git:dirty-inputs:servizio-ordini"]);
    expect(namedUncleanMembers(snapshot)).toEqual(["frontend", "servizio-ordini"]);
  });

  test("a repository singolo il divario resta quello di oggi, e il messaggio non cambia", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-snap-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n");
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Fixture"]);
    await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["add", "--all"]);
    await git(root, ["commit", "-m", "init"]);
    await writeFile(path.join(root, "src", "bozza.ts"), "export const y = 2;\n");

    const snapshot = await workspaceSnapshot(root);
    // Il membro "." non si nomina: un progetto a repository singolo non deve imparare una
    // seconda grammatica, ne' nei divari ne' nei messaggi di rifiuto.
    expect(dirtyInputGaps(snapshot)).toEqual(["git:dirty-inputs"]);
    expect(namedUncleanMembers(snapshot)).toEqual([]);
    expect(uncleanMemberClause(snapshot)).toBe("");
  });

  test("un albero pulito non produce divari ne' clausola", async () => {
    const root = await twoMembers();
    const snapshot = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);
    expect(dirtyInputGaps(snapshot)).toEqual([]);
    expect(uncleanMemberClause(snapshot)).toBe("");
  });
});

describe("cosa e' cambiato da una baseline per membro", () => {
  test("i percorsi tornano relativi al workspace, col prefisso del membro", async () => {
    const root = await twoMembers();
    const before = await workspaceSnapshot(root, ["frontend", "servizio-ordini"]);
    const baselines = {
      frontend: before.members.get("frontend")!.head!,
      "servizio-ordini": before.members.get("servizio-ordini")!.head!,
    };

    await writeFile(path.join(root, "frontend", "src", "index.ts"), "export const x = 2;\n");
    await git(path.join(root, "frontend"), ["add", "--all"]);
    await git(path.join(root, "frontend"), ["commit", "-m", "cambio"]);

    expect(await changedSince(root, baselines)).toEqual(["frontend/src/index.ts"]);
  });
});
