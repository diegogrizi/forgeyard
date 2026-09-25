# Un lavoro su più repository membri — piano di implementazione

> **Per chi esegue in modo agentico:** SKILL RICHIESTA — usare `superpowers:subagent-driven-development` (consigliata) oppure `superpowers:executing-plans` per implementare attività per attività. I passi usano caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** far girare un lavoro nativo su più repository membri di un workspace, con le prove legate agli HEAD dei soli membri toccati.

**Architettura:** il servizio osserva a quale albero Git appartiene ogni ambito di scrittura, fotografa i membri toccati in parallelo e compone **una** impronta aggregata su di essi — così i circa quaranta punti che passano quella stringa non cambiano. Un lavoro può avere attività in membri diversi; un'attività non può mescolare membri, e questo dà a ogni gate una `cwd` sola e una ricevuta invariata.

**Stack:** TypeScript strict (ESM, Node 24), vitest, execa per Git.

**Spec:** [`docs/superpowers/specs/2026-09-25-lavoro-multi-repository-design.md`](../specs/2026-09-25-lavoro-multi-repository-design.md)

## Vincoli globali

- **Prima il test, poi l'implementazione minima.** Nessun passo di implementazione senza un test rosso che lo giustifica (`AGENTS.md`).
- Ogni incremento lascia una differenza **piccola, testabile e rivedibile**, e finisce con un commit.
- **Italiano** per documentazione e messaggi utente del percorso ordinario; **inglese** per codice, identificatori, chiavi di protocollo, codici d'errore e commenti tecnici.
- La **capsula** e lo **schema del protocollo 0.2** non si toccano: la capsula è indirizzata per contenuto.
- Il **write-guard** non si tocca: confronta percorsi già relativi alla cartella che il client apre.
- Ogni suite in `tests/integration/` e `tests/roundtrip/` **dichiara il proprio tetto** in testa al file con la durata misurata della sua prova più lenta (`tests/unit/meta/declared-timeouts.test.ts` lo verifica, e verifica anche che nessun tetto per-prova lo scavalchi).
- Verifica completa prima di dichiarare fatto un incremento: `npm run verify` più `git diff --check`.
- `npx tsc --noEmit -p tsconfig.json` deve restare pulito dopo ogni attività.

## Struttura dei file

| File | Responsabilità | Attività |
|---|---|---|
| `src/native/members.ts` *(nuovo)* | da un ambito di scrittura al suo repository membro; nient'altro | 1 |
| `tests/unit/native/members.test.ts` *(nuovo)* | i casi limite della risalita | 1 |
| `src/native/workspace.ts` | fotografia per membro e impronta aggregata sui soli toccati | 2, 3 |
| `tests/unit/native/workspace-snapshot.test.ts` *(nuovo)* | l'aggregato ignora i membri non toccati | 2 |
| `src/native/runs.ts` | validazione «un'attività, un membro»; divari qualificati col membro | 4, 6 |
| `tests/unit/native/runs-members.test.ts` *(nuovo)* | il piano che mescola membri è rifiutato; i divari nominano il membro | 4, 6 |
| `src/native/contracts.ts` | `baselineHeads` al posto di `baselineHead` | 5 |
| `src/native/service.ts` | le sedi che consumano un HEAD solo | 5, 7 |
| `tests/integration/native/membri.test.ts` *(nuovo)* | i quattro scenari su una fixture a due repository | 8 |
| `tests/helpers/native.ts` | fixture con due repository membri | 8 |

Il nuovo modulo `members.ts` esiste perché la domanda «a quale albero appartiene questo percorso» è una cosa sola, va provata da sola, e non appartiene né allo snapshot né al servizio.

---

### Attività 1: da un ambito al suo membro

**File:**
- Creare: `src/native/members.ts`
- Test: `tests/unit/native/members.test.ts`

**Interfacce:**
- Consuma: `nativeError` da `src/native/store.js`; `resolveInsideRoot` da `src/core/paths.js`
- Produce:
  - `memberForScope(root: string, scope: string): Promise<string>` — percorso del membro relativo a `root`, portabile, `"."` se è la radice stessa. Lancia `FY_GIT_REQUIRED` se nessun antenato è un albero Git.
  - `touchedMembers(root: string, scopes: readonly string[]): Promise<readonly string[]>` — insieme ordinato e deduplicato.

- [ ] **Passo 1: scrivere il test rosso**

Creare `tests/unit/native/members.test.ts`:

```ts
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

  test("l'insieme dei membri toccati e' ordinato e deduplicato", async () => {
    const root = await workspace();
    expect(await touchedMembers(root, ["frontend/src", "servizio-ordini/src", "frontend/test"]))
      .toEqual(["frontend", "servizio-ordini"]);
  });
});
```

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/native/members.test.ts`
Atteso: FAIL — `Cannot find module '../../../src/native/members.js'`

- [ ] **Passo 3: implementazione minima**

Creare `src/native/members.ts`:

```ts
import { lstat } from "node:fs/promises";
import path from "node:path";

import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { nativeError } from "./store.js";

/** True for a directory `.git` and for the `.git` file a linked worktree uses. */
async function isWorkingTree(directory: string): Promise<boolean> {
  try {
    await lstat(path.join(directory, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Which member repository owns this write scope. The service never runs discovery, so it does
 * not ask anyone: it observes. The walk starts at the nearest ancestor that exists on disk,
 * because a write scope may name a directory the work is about to create, and it stops at the
 * nearest working tree, because whoever owns a path is the tree containing it — and it is that
 * tree's HEAD that says whether the path changed.
 */
export async function memberForScope(root: string, scope: string): Promise<string> {
  const absoluteRoot = path.resolve(root);
  let cursor = resolveInsideRoot(absoluteRoot, scope);
  for (;;) {
    if (await isWorkingTree(cursor)) {
      const relative = path.relative(absoluteRoot, cursor);
      return relative.length === 0 ? "." : normalizePortablePath(relative);
    }
    if (cursor === absoluteRoot) {
      throw nativeError("FY_GIT_REQUIRED",
        `Write scope '${scope}' is not inside a Git working tree. A governed run binds its evidence to a revision, and this path has none.`);
    }
    cursor = path.dirname(cursor);
  }
}

/** Ordered and deduplicated, so two reads of one plan produce one set. */
export async function touchedMembers(root: string, scopes: readonly string[]): Promise<readonly string[]> {
  const members = new Set<string>();
  for (const scope of scopes) members.add(await memberForScope(root, scope));
  return [...members].sort((left, right) => left.localeCompare(right, "en"));
}
```

- [ ] **Passo 4: eseguire e verificare che passi**

Eseguire: `npx vitest run tests/unit/native/members.test.ts`
Atteso: PASS, 7 prove.

Se il caso «antenato più vicino che esiste» fallisce, la causa è `resolveInsideRoot` che rifiuta un percorso inesistente: in quel caso sostituirlo con `path.resolve(absoluteRoot, scope)` più un controllo di confinamento esplicito, e aggiungere una prova che un ambito `../fuori` venga rifiutato.

- [ ] **Passo 5: commit**

```bash
git add src/native/members.ts tests/unit/native/members.test.ts
git commit -m "feat: osserva a quale repository membro appartiene un ambito di scrittura"
```

---

### Attività 2: fotografia per membro, aggregato sui soli toccati

**File:**
- Modificare: `src/native/workspace.ts` (il tipo `WorkspaceSnapshot` e `workspaceSnapshot`)
- Test: `tests/unit/native/workspace-snapshot.test.ts` *(nuovo)*

**Interfacce:**
- Consuma: `touchedMembers` dall'Attività 1
- Produce:
  - `export interface MemberSnapshot { head: string | null; clean: boolean; sha256: string; changedPaths: readonly string[] }`
  - `WorkspaceSnapshot` diventa `{ members: ReadonlyMap<string, MemberSnapshot>; sha256: string; clean: boolean; changedPaths: readonly string[] }` — **`head` viene rimosso**: con più membri non esiste «l'» HEAD, e un campo che mente è peggio di un campo assente.
  - `workspaceSnapshot(root: string, members: readonly string[] = ["."]): Promise<WorkspaceSnapshot>`

- [ ] **Passo 1: scrivere il test rosso**

Creare `tests/unit/native/workspace-snapshot.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterAll, describe, expect, test, vi } from "vitest";

// Ogni prova crea due repository Git veri e ci committa. Prova piu' lenta cronometrata a
// macchina ferma: DA MISURARE AL PASSO 4 e scritta qui prima del commit.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

import { workspaceSnapshot } from "../../../src/native/workspace.js";

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
```

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/native/workspace-snapshot.test.ts`
Atteso: FAIL — `snapshot.members` è `undefined`.

- [ ] **Passo 3: implementazione minima**

In `src/native/workspace.ts`, sostituire il tipo e la funzione. Il corpo che oggi fotografa una radice diventa `memberSnapshot`, invariato nella sostanza — stesse quattro letture in parallelo, stessi rifiuti su percorsi non regolari e input privati, stessi limiti di byte:

```ts
export interface MemberSnapshot {
  head: string | null; clean: boolean; sha256: string; changedPaths: readonly string[];
}
export interface WorkspaceSnapshot {
  /** One entry per touched member, keyed by its path relative to the workspace root. */
  members: ReadonlyMap<string, MemberSnapshot>;
  /** Aggregate over the touched members only, so an unrelated member cannot invalidate a run. */
  sha256: string;
  clean: boolean;
  /** Workspace-relative, member prefix included. */
  changedPaths: readonly string[];
}

async function memberSnapshot(memberRoot: string): Promise<MemberSnapshot> {
  // ... il corpo attuale di workspaceSnapshot, con `root` rinominato `memberRoot`
  // e il `return` finale senza il campo `head` rimosso dall'aggregato:
  //   return { head, clean, changedPaths, sha256: sha256Text(canonicalJson({ head, status, hashes })) };
}

/**
 * One snapshot per touched member, composed into one digest. The members run concurrently:
 * a second repository must not cost a second round trip in a row.
 */
export async function workspaceSnapshot(
  root: string,
  members: readonly string[] = ["."],
): Promise<WorkspaceSnapshot> {
  const ordered = [...new Set(members)].sort((left, right) => left.localeCompare(right, "en"));
  const snapshots = await Promise.all(ordered.map(async (member) =>
    [member, await memberSnapshot(member === "." ? root : path.join(root, member))] as const));
  const byMember = new Map(snapshots);
  return {
    members: byMember,
    clean: snapshots.every(([, snapshot]) => snapshot.clean),
    changedPaths: snapshots.flatMap(([member, snapshot]) =>
      snapshot.changedPaths.map((changed) => member === "." ? changed : `${member}/${changed}`)),
    // Sorted member entries: the digest is a property of the set, not of the request order.
    sha256: sha256Text(canonicalJson(snapshots.map(([member, snapshot]) => ({ member, sha256: snapshot.sha256 })))),
  };
}
```

- [ ] **Passo 4: eseguire, verificare che passi, e cronometrare**

Eseguire: `npx vitest run tests/unit/native/workspace-snapshot.test.ts --reporter=verbose`
Atteso: PASS, 6 prove.

Prendere il millisecondaggio della prova **più lenta** dall'output e sostituirlo a `DA MISURARE AL PASSO 4` nel commento in testa al file, nella forma `12,3 s`. Il file sta in `tests/unit/`, quindi il controllo meta non lo impone — ma il tetto dichiarato senza la sua misura è esattamente l'abitudine che questo repository ha già pagato.

- [ ] **Passo 5: commit**

```bash
git add src/native/workspace.ts tests/unit/native/workspace-snapshot.test.ts
git commit -m "feat: la fotografia del workspace copre un membro per volta, e aggrega sui soli toccati"
```

---

### Attività 3: `changedSince` per membro

**File:**
- Modificare: `src/native/workspace.ts` (`changedSince`)
- Test: `tests/unit/native/workspace-snapshot.test.ts` (aggiungere un `describe`)

**Interfacce:**
- Consuma: `MemberSnapshot`, `workspaceSnapshot` dall'Attività 2
- Produce: `changedSince(root: string, baselines: Readonly<Record<string, string>>): Promise<readonly string[]>` — percorsi **relativi al workspace**, prefisso del membro incluso.

- [ ] **Passo 1: scrivere il test rosso**

Aggiungere in fondo a `tests/unit/native/workspace-snapshot.test.ts`:

```ts
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
```

Aggiungere `changedSince` all'import in testa al file.

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/native/workspace-snapshot.test.ts -t "col prefisso del membro"`
Atteso: FAIL — `changedSince` riceve un oggetto dove attende una stringa.

- [ ] **Passo 3: implementazione minima**

```ts
/**
 * Paths changed since each member's own baseline, returned workspace-relative so a caller can
 * match them against write scopes without knowing which member they came from.
 */
export async function changedSince(
  root: string,
  baselines: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
  const members = Object.keys(baselines).sort((left, right) => left.localeCompare(right, "en"));
  const current = await workspaceSnapshot(root, members);
  const perMember = await Promise.all(members.map(async (member) => {
    const memberRoot = member === "." ? root : path.join(root, member);
    const committed = await git(memberRoot, ["diff", "--name-only", "-z", baselines[member]!, "HEAD", "--"]);
    if (committed.exitCode !== 0) throw nativeError("FY_GIT_REQUIRED", `The approved baseline for member '${member}' is unavailable.`);
    return committed.stdout.split("\0").filter(Boolean)
      .map((changed) => member === "." ? changed : `${member}/${changed}`);
  }));
  return [...new Set([...perMember.flat(), ...current.changedPaths])]
    .sort((left, right) => left.localeCompare(right, "en"));
}
```

- [ ] **Passo 4: eseguire e verificare che passi**

Eseguire: `npx vitest run tests/unit/native/workspace-snapshot.test.ts`
Atteso: PASS, 7 prove.

- [ ] **Passo 5: commit**

```bash
git add src/native/workspace.ts tests/unit/native/workspace-snapshot.test.ts
git commit -m "feat: changedSince confronta ogni membro con la propria baseline"
```

---

### Attività 4: un'attività non mescola membri

**File:**
- Modificare: `src/native/runs.ts` (aggiungere la validazione)
- Test: `tests/unit/native/runs-members.test.ts` *(nuovo)*

**Interfacce:**
- Consuma: `memberForScope` dall'Attività 1
- Produce: `assertTaskMembers(root: string, plan: ProductPlan): Promise<Readonly<Record<string, string>>>` — mappa `taskId → membro`. Lancia `FY_PLAN_INVALID` se un'attività mescola membri.

- [ ] **Passo 1: scrivere il test rosso**

Creare `tests/unit/native/runs-members.test.ts`:

```ts
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
```

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/native/runs-members.test.ts`
Atteso: FAIL — `assertTaskMembers` non è esportata.

- [ ] **Passo 3: implementazione minima**

In `src/native/runs.ts`:

```ts
import { memberForScope } from "./members.js";

/**
 * Which member each task belongs to. A run may have tasks in different members — that is the
 * cross-repository case — but a task may not mix them: its gate runs once, with one `cwd`, and
 * its receipt has to name the revision it ran against. A task with no write scope has no member.
 */
export async function assertTaskMembers(
  root: string,
  plan: ProductPlan,
): Promise<Readonly<Record<string, string>>> {
  const byTask: Record<string, string> = {};
  for (const task of plan.tasks) {
    const members = new Set<string>();
    for (const scope of task.writeScopes) members.add(await memberForScope(root, scope));
    if (members.size > 1) {
      throw nativeError("FY_PLAN_INVALID",
        `Task '${task.id}' writes into more than one member repository (${[...members].sort().join(", ")}). Split it: a gate runs once, in one working tree.`);
    }
    const [member] = [...members];
    if (member !== undefined) byTask[task.id] = member;
  }
  return byTask;
}
```

- [ ] **Passo 4: eseguire e verificare che passi**

Eseguire: `npx vitest run tests/unit/native/runs-members.test.ts`
Atteso: PASS, 3 prove.

- [ ] **Passo 5: commit**

```bash
git add src/native/runs.ts tests/unit/native/runs-members.test.ts
git commit -m "feat: un'attività non mescola repository membri, e un piano che lo fa è rifiutato"
```

---

### Attività 5: `baselineHeads` al posto di `baselineHead`

**File:**
- Modificare: `src/native/contracts.ts:34`
- Modificare: `src/native/service.ts` — righe 180, 205, 229, 555, 587 e la riga 562 del testo di revisione
- Test: la suite nativa esistente, che deve restare verde

**Interfacce:**
- Consuma: `workspaceSnapshot(root, members)` (Attività 2), `changedSince(root, baselines)` (Attività 3), `assertTaskMembers` (Attività 4)
- Produce: `NativeRun.baselineHeads: Readonly<Record<string, string>>`

- [ ] **Passo 1: scrivere il test rosso**

Aggiungere in `tests/unit/native/runs-members.test.ts`:

```ts
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
```

Aggiungere `NativeRun` all'import dei tipi.

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx tsc --noEmit -p tsconfig.json`
Atteso: FAIL — `Property 'baselineHeads' does not exist on type 'NativeRun'`.

- [ ] **Passo 3: implementazione minima**

In `src/native/contracts.ts`, sostituire la riga 34:

```ts
  /** One commit per touched member: with several members there is no single "the" HEAD. */
  baselineHeads: Readonly<Record<string, string>>;
```

In `src/native/service.ts`, le cinque sedi:

```ts
// riga ~180 — la radice non deve piu' essere un albero Git; i membri toccati devono esserlo
const missing = [...snapshot.members].filter(([, member]) => member.head === null).map(([name]) => name);
if (missing.length > 0) throw nativeError("FY_GIT_REQUIRED",
  `Native runs bind evidence to a revision, and these member repositories have no commit yet: ${missing.sort().join(", ")}.`);

// riga ~229 — la baseline si costruisce dalla fotografia
baselineHeads: Object.fromEntries([...snapshot.members].map(([name, member]) => [name, member.head!])),

// riga ~205 e ~587 — changedSince prende la mappa
const changed = await changedSince(this.identity.root, run.baselineHeads);

// riga ~555 — un diff per membro, ognuno con la propria cwd ed etichettato
const diffs = await Promise.all(Object.entries(run.baselineHeads).sort(([left], [right]) =>
  left.localeCompare(right, "en")).map(async ([member, baseline]) => {
    const memberRoot = member === "." ? this.identity.root : path.join(this.identity.root, member);
    const scopes = run.plan.tasks.flatMap((task) => task.writeScopes)
      .filter((scope) => scope === member || scope.startsWith(`${member}/`))
      .map((scope) => member === "." ? scope : scope.slice(member.length + 1));
    const result = await execa("git", ["diff", "--no-ext-diff", "--no-textconv", "--unified=3",
      baseline, "HEAD", "--", ...scopes], { cwd: memberRoot, shell: false, stdin: "ignore",
      timeout: 10000, maxBuffer: 131072, env: { GIT_OPTIONAL_LOCKS: "0" } });
    return `# member: ${member}\n${result.stdout}`;
  }));
const diff = { stdout: diffs.join("\n") };

// riga ~562 — il testo di revisione elenca i membri invece di "il" commit
`Git: ${Object.entries(run.baselineHeads).sort(([a], [b]) => a.localeCompare(b, "en"))
  .map(([member, head]) => `${member}@${head}`).join(" ")}\nInput: ${snapshot.sha256}\n`
```

Dove `fy_plan` crea il lavoro, chiamare `assertTaskMembers(this.identity.root, plan)` e passare i membri risultanti a `workspaceSnapshot`.

- [ ] **Passo 4: eseguire la suite nativa e verificare che sia verde**

Eseguire: `npx vitest run tests/integration/native tests/unit/native`
Atteso: PASS. Le prove esistenti usano un repository singolo, quindi il membro è `"."` e il comportamento non cambia: **se una prova esistente si rompe, è una regressione, non una prova da aggiornare.**

- [ ] **Passo 5: commit**

```bash
git add src/native/contracts.ts src/native/service.ts tests/unit/native/runs-members.test.ts
git commit -m "feat: la baseline di un lavoro porta un commit per membro toccato"
```

---

### Attività 6: i divari nominano il membro

**File:**
- Modificare: `src/native/runs.ts` (`evidenceGaps`)
- Modificare: `src/native/service.ts` (i chiamanti di `evidenceGaps`: righe ~172, ~270, e il punto di `fy_finalize`)
- Test: `tests/unit/native/runs-members.test.ts`

**Interfacce:**
- Consuma: la mappa `taskId → membro` dell'Attività 4
- Produce: `evidenceGaps(state, run, capsule, inputSha256, invalidEvidence, membersByTask)` — i divari di gate diventano `gate:<membro>/<taskId>/<gateId>` quando il membro non è `"."`

- [ ] **Passo 1: scrivere il test rosso**

Aggiungere in `tests/unit/native/runs-members.test.ts`:

```ts
describe("i divari nominano il membro", () => {
  test("un gate mancante in un membro porta il membro nel divario", () => {
    const gaps = evidenceGaps(state, run, capsule, "a".repeat(64), [], { T1: "servizio-ordini" });
    expect(gaps).toContain("gate:servizio-ordini/T1/G001");
  });

  test("con il membro '.' il divario resta quello di oggi", () => {
    // Il caso a repository singolo non cambia forma: un divario nuovo obbligherebbe
    // chiunque legga i rapporti esistenti a imparare due grammatiche.
    const gaps = evidenceGaps(state, run, capsule, "a".repeat(64), [], { T1: "." });
    expect(gaps).toContain("gate:T1/G001");
  });
});
```

Costruire `state`, `run` e `capsule` riusando le fixture di `tests/helpers/native.ts`; se non bastano, aggiungere lì una `minimalState()` e una `minimalCapsule()` e documentare che servono a questo.

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/native/runs-members.test.ts -t "nominano il membro"`
Atteso: FAIL — `evidenceGaps` accetta cinque argomenti.

- [ ] **Passo 3: implementazione minima**

In `src/native/runs.ts`, dentro `evidenceGaps`, dove nasce il divario di gate:

```ts
/** `.` keeps today's shape: a single-repository report must not learn a second grammar. */
const qualify = (taskId: string, suffix: string): string => {
  const member = membersByTask[taskId];
  return member === undefined || member === "." ? suffix : `${member}/${suffix}`;
};
// ... e dove oggi si fa gaps.push(`gate:${task.id}/${gate}`):
gaps.push(`gate:${qualify(task.id, `${task.id}/${gate}`)}`);
```

- [ ] **Passo 4: eseguire e verificare che passi**

Eseguire: `npx vitest run tests/unit/native/runs-members.test.ts`
Atteso: PASS.

Poi: `npx vitest run tests/integration/native` — atteso PASS, perché i lavori a repository singolo producono `"."` e i divari restano identici.

- [ ] **Passo 5: commit**

```bash
git add src/native/runs.ts src/native/service.ts tests/unit/native/runs-members.test.ts tests/helpers/native.ts
git commit -m "feat: un divario di gate nomina il repository membro in cui manca"
```

---

### Attività 7: il rapporto di consegna dichiara le revisioni

**File:**
- Modificare: `src/native/service.ts:342` (il contenuto del rapporto)
- Test: `tests/integration/native/membri.test.ts` (Attività 8) copre questo; nessun test unitario a parte

**Interfacce:**
- Consuma: `snapshot.members` (Attività 2)
- Produce: nel rapporto, `gitCommits: Record<membro, commit>` al posto di `gitCommit: string`

- [ ] **Passo 1: scrivere il test rosso**

Rinviato all'Attività 8, dove la fixture a due repository lo rende osservabile. **Non implementare prima**: senza quel test questo passo non ha un rosso che lo giustifichi.

- [ ] **Passo 2: implementazione minima (dopo il rosso dell'Attività 8)**

```ts
gitCommits: Object.fromEntries([...snapshot.members].map(([member, snapshot]) => [member, snapshot.head])),
```

- [ ] **Passo 3: commit**

```bash
git add src/native/service.ts
git commit -m "feat: il rapporto di consegna dichiara una revisione per membro"
```

---

### Attività 8: i quattro scenari su due repository

**File:**
- Creare: `tests/integration/native/membri.test.ts`
- Modificare: `tests/helpers/native.ts` (aggiungere `multiMemberFixture`)

**Interfacce:**
- Consuma: tutto quanto sopra
- Produce: `multiMemberFixture(): Promise<{ directory: string; root: string; stateDirectory: string; members: readonly string[] }>`

- [ ] **Passo 1: scrivere la fixture e il test rosso**

In `tests/helpers/native.ts`, aggiungere accanto a `nativeFixture` una `multiMemberFixture` che crea `frontend/` e `servizio-ordini/`, ognuno con `src/feature.txt`, `src/feature.test.mjs`, `git init`, un commit, e installa l'imbracatura **alla radice** con il profilo `minimal` — riusando `loadRegistry`, `resolveProfile`, `createCodexAdapter`, `buildInstallPlan`, `applyInstallPlan` come fa `nativeFixture`.

Creare `tests/integration/native/membri.test.ts` con le quattro prove:

```ts
import { afterAll, expect, test, vi } from "vitest";

// Ogni prova installa un'imbracatura vera su due repository e percorre il protocollo con
// gate reali. Prova piu' lenta cronometrata a macchina ferma: DA MISURARE AL PASSO 3.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

test("un lavoro su un solo membro consegna, e il rapporto cita un HEAD", async () => { /* ... */ });
test("un lavoro su due membri consegna, e il rapporto cita due HEAD", async () => { /* ... */ });
test("un gate fallito in un membro blocca, e il divario nomina quel membro", async () => { /* ... */ });
test("un commit in un membro non toccato non invalida le prove", async () => { /* ... */ });
```

Ogni prova segue la sequenza che `tests/integration/native/delivery.test.ts` usa già: `fy_attach`, `fy_plan`, `consent`, `fy_next`, `fy_record`, i gate, `fy_review`, `fy_finalize`. Il piano ha due attività, una per membro, con `writeScopes: ["frontend/src"]` e `["servizio-ordini/src"]`.

- [ ] **Passo 2: eseguirlo e verificare che fallisca**

Eseguire: `npx vitest run tests/integration/native/membri.test.ts`
Atteso: FAIL sulla prima prova, per il `gitCommits` che l'Attività 7 non ha ancora scritto.

- [ ] **Passo 3: completare l'Attività 7, eseguire, cronometrare**

Eseguire: `npx vitest run tests/integration/native/membri.test.ts --reporter=verbose`
Atteso: PASS, 4 prove. Sostituire il millisecondaggio della più lenta a `DA MISURARE AL PASSO 3`.

- [ ] **Passo 4: verificare che il controllo meta accetti il nuovo file**

Eseguire: `npx vitest run tests/unit/meta`
Atteso: PASS, 5 prove — il nuovo file dichiara il tetto e la sua misura.

- [ ] **Passo 5: verifica completa e commit**

```bash
npm run verify
git diff --check
git add tests/integration/native/membri.test.ts tests/helpers/native.ts
git commit -m "test: i quattro scenari di un lavoro su due repository membri"
```

---

### Attività 9: l'anteprima non avverte più, e i documenti lo dicono

**File:**
- Modificare: `src/workspace/entry.ts` (`nativeWorkBlocker`)
- Modificare: `tests/unit/workspace/entry.test.ts` (le due prove dell'avvertimento)
- Modificare: `docs/STATO.md` (la riga P5 e la sezione «Cosa la misura ha detto su P5»), `CHANGELOG.md`

**Interfacce:** nessuna nuova.

- [ ] **Passo 1: aggiornare i test dell'avvertimento**

L'avvertimento «Lavoro nativo: non parte in questa cartella perché contiene 2 repository» **diventa falso**: quel lavoro adesso parte. La prova che lo attende va rovesciata — un workspace con due repository **non** deve più riceverlo — e va tenuta quella che verifica il caso senza alcun repository, dove il limite resta vero.

- [ ] **Passo 2: eseguirla e verificare che fallisca**

Eseguire: `npx vitest run tests/unit/workspace/entry.test.ts`
Atteso: FAIL — l'anteprima emette ancora l'avvertimento.

- [ ] **Passo 3: restringere la condizione**

In `nativeWorkBlocker`, il ramo `repositories.length > 1` sparisce: resta soltanto «non è un repository Git **e** non contiene repository membri».

- [ ] **Passo 4: eseguire e verificare che passi**

Eseguire: `npx vitest run tests/unit/workspace/entry.test.ts`
Atteso: PASS.

- [ ] **Passo 5: aggiornare i documenti e committare**

`docs/STATO.md`: la riga P5 passa a **implementato**, e la sezione «Cosa la misura ha detto su P5» va riscritta al passato — la misura che l'ha motivata resta registrata, ma il rifiuto non c'è più. Aggiornare anche il conteggio delle prove con quello dell'ultima verifica.

```bash
npm run verify
git add src/workspace/entry.ts tests/unit/workspace/entry.test.ts docs/STATO.md CHANGELOG.md
git commit -m "feat: un workspace con più repository membri non è più un limite dichiarato"
```

---

## Auto-revisione di questo piano

**Copertura della spec.** Le quattro decisioni e l'invariante per attività sono coperte: decisione 1 (imbracatura alla radice) è lo stato di fatto e non richiede lavoro; decisione 2 → Attività 2 e 5; decisione 3 → Attività 6; decisione 4 → Attività 2, prova «un commit in un membro non toccato»; invariante per attività → Attività 4. Le quattro modalità di fallimento della spec sono coperte da Attività 1 (ambito fuori da ogni albero), 5 (membro senza commit), 6 (gate fallito che nomina il membro) e 9 (la radice non è più un errore).

**Segnaposto.** Due passi rinviano deliberatamente un valore: le due misure di tempo, che vanno cronometrate e non inventate, e il corpo delle quattro prove d'integrazione, che segue una sequenza già esistente e nominata (`delivery.test.ts`). Entrambi hanno un passo esplicito che li chiude. Nessun «TBD».

**Coerenza dei tipi.** `memberForScope` e `touchedMembers` (Attività 1) sono consumate con la stessa firma in 2 e 4. `MemberSnapshot`/`WorkspaceSnapshot` (2) sono consumati in 3, 5 e 7. `baselineHeads` (5) è consumato in 3 e 6. `assertTaskMembers` restituisce `Record<taskId, membro>`, che è esattamente ciò che `evidenceGaps` riceve in 6.

**Ordine.** L'Attività 7 dipende dal rosso dell'8 e lo dichiara. Tutte le altre dipendono solo da attività precedenti.
