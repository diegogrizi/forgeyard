import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // I file girano in parallelo: il pool e' a processi, quindi ogni file ha il proprio,
    // e ogni fixture ha gia' la propria cartella temporanea e il proprio stato privato.
    // Era spento dal 15 settembre senza una ragione scritta. Misurato: 2400 s in serie
    // contro 894 s in parallelo su questa macchina, 2,7 volte. Accenderlo ha smascherato
    // due difetti veri — nove tetti per-test che ne scavalcavano uno dichiarato, e sette
    // file che ricostruivano `dist/` l'uno sotto i piedi dell'altro — entrambi corretti.
    fileParallelism: true,
    // Con dodici core, undici worker piu' le prove concorrenti dentro i file arrivavano a
    // oltre cinquanta processi fra Git e Node: i rossi comparivano in file che non avevano
    // colpa, cioe' sovrasaturazione e non gare. Il tetto tiene la concorrenza sotto controllo.
    maxWorkers: 4,
    // Le prove dentro un file restano in sequenza: condividono le loro fixture.
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
