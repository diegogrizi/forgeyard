import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { NativeStore } from "../../../src/native/store.js";

const directories: string[] = [];
// Ogni prova chiude il proprio store in un `finally`: un'asserzione rossa che saltasse la
// chiusura lascerebbe il handle SQLite aperto dentro la directory che questo `rm` rimuove, e
// l'errore vero finirebbe sepolto sotto un EBUSY.
afterAll(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function openStore(): Promise<NativeStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgeyard-store-"));
  directories.push(directory);
  return NativeStore.open(directory, "a".repeat(64));
}

function thrownBy(read: () => unknown): unknown {
  try { read(); } catch (error) { return error; }
  return undefined;
}

describe("la versione di schema dello stato privato e' letta, non solo scritta", () => {
  test("uno stato scritto prima di un cambio incompatibile e' rifiutato, non interpretato", async () => {
    const store = await openStore();
    try {
      // Un lavoro salvato prima di `baselineHeads` non ha quel campo, e il percorso ordinario
      // lo leggerebbe finendo in un TypeError grezzo. `schemaVersion` era scritto e mai letto,
      // cioe' un controllo che non poteva fallire.
      store.internal("fixture-older-schema", "downgrade", (state) => {
        (state as { schemaVersion: number }).schemaVersion = 1;
        return {};
      });

      expect(thrownBy(() => store.read())).toMatchObject({ code: "FY_STATE_INCOMPATIBLE" });
    } finally {
      store.close();
    }
  });

  test("uno stato scritto alla versione precedente (senza membersByTask) e' rifiutato, non interpretato", async () => {
    const store = await openStore();
    try {
      // Versione 2: un lavoro a quella versione non ha `membersByTask`, e leggerlo come lo
      // stato di oggi finirebbe in un `TypeError` grezzo la prima volta che un gate cercasse
      // il membro della propria attivita'. Lo stesso guasto che il test sopra copre per la
      // versione 1, un cambio incompatibile piu' recente.
      store.internal("fixture-schema-2", "downgrade-to-2", (state) => {
        (state as { schemaVersion: number }).schemaVersion = 2;
        return {};
      });

      expect(thrownBy(() => store.read())).toMatchObject({ code: "FY_STATE_INCOMPATIBLE" });
    } finally {
      store.close();
    }
  });

  test("uno stato scritto da questa versione si legge senza rifiuti", async () => {
    const store = await openStore();
    try {
      expect(store.read().revision).toBe(0);
    } finally {
      store.close();
    }
  });

  test("replay() passa per lo stesso controllo: una risposta gia' in cache non basta a saltarlo", async () => {
    const store = await openStore();
    try {
      const envelope = { protocolVersion: "0.2" as const, requestId: "replay-schema-check", tool: "fy_context", payload: {} };
      // Una risposta per questo requestId esiste ora nella tabella `requests`. `replay()` la
      // troverebbe comunque, perche' interroga quella tabella direttamente e non passa da
      // `read()`: e' la seconda sede della stessa regola, e quella che AGENTS.md apre descrivendo.
      store.change(envelope, 0, () => ({ ok: true }));

      store.internal("fixture-older-schema", "downgrade", (state) => {
        (state as { schemaVersion: number }).schemaVersion = 1;
        return {};
      });

      expect(thrownBy(() => store.replay(envelope))).toMatchObject({ code: "FY_STATE_INCOMPATIBLE" });
    } finally {
      store.close();
    }
  });
});
