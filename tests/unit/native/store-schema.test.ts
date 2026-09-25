import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { NativeStore } from "../../../src/native/store.js";

const directories: string[] = [];
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
    // Un lavoro salvato prima di `baselineHeads` non ha quel campo, e il percorso ordinario
    // lo leggerebbe finendo in un TypeError grezzo. `schemaVersion` era scritto e mai letto,
    // cioe' un controllo che non poteva fallire.
    store.internal("fixture-older-schema", "downgrade", (state) => {
      (state as { schemaVersion: number }).schemaVersion = 1;
      return {};
    });

    expect(thrownBy(() => store.read())).toMatchObject({ code: "FY_STATE_INCOMPATIBLE" });
    store.close();
  });

  test("uno stato scritto da questa versione si legge senza rifiuti", async () => {
    const store = await openStore();
    expect(store.read().revision).toBe(0);
    store.close();
  });

  test("replay() passa per lo stesso controllo: una risposta gia' in cache non basta a saltarlo", async () => {
    const store = await openStore();
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
    store.close();
  });
});
