import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
  projectNativeBinding,
  runPersonalEntry,
  type HarnessPreparation,
  type NativeBinding,
  type PersonalEntryOptions,
} from "../../../src/workspace/entry.js";
import { createPersonalWorkspace, inspectPersonalWorkspace } from "../../../src/workspace/personal.js";
import type { HarnessId } from "../../../src/core/contracts.js";
import type { PrepareCommandInput, PrepareCommandResult } from "../../../src/application/forgeyard.js";
import type { PreparationDecision, ProjectInspection } from "../../../src/intake/contracts.js";
import type { PromptDriver } from "../../../src/config/wizard.js";
import type { ClientInventory } from "../../../src/inventory/client-plugins.js";

const execute = promisify(execFile);
async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-ingresso-unita-")));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { timeout: 120_000 })).stdout.trim();
}

/** Un doppio: l'installazione reale non è il soggetto di questi test e supera la scadenza su questa macchina. */
function prepareResult(root: string, adapter: HarnessId, created: readonly string[], applied: boolean): PrepareCommandResult {
  const inspection: ProjectInspection = {
    schemaVersion: 1, root, name: "lavoro", request: "risultato voluto", mode: "existing", kind: "backend",
    languages: ["typescript"], frameworks: [], packageManagers: ["npm"],
    qualityCommands: [{ name: "test", argv: ["npm", "test"] }], mutableRoots: ["src"],
    instructionSurfaces: ["CLAUDE.md"], sources: ["brief"], evidence: [], questions: [], warnings: [],
    confidence: "medium", analysisSha256: "a".repeat(64),
  };
  const decision: PreparationDecision = {
    schemaVersion: 1, profile: "tailored", adapter,
    adapterReason: "Existing CLAUDE.md instructions identify the project host.",
    catalog: { selection: "curated", plugins: [] }, packs: ["foundation"],
    selected: Array.from({ length: 8 }, (_, index) => ({ id: `capacita-${index}`, reason: "inferita" })),
    excluded: Array.from({ length: 4 }, (_, index) => ({ id: `esclusa-${index}`, reason: "non pertinente" })),
    timeboxMinutes: 300, orchestration: { mode: "native", maxConcurrency: 2 },
    autonomy: { level: "balanced", stopOnAmbiguity: true, externalEffects: "ask" },
    analysisSha256: "b".repeat(64),
  };
  return {
    schemaVersion: 1, ok: true, command: "prepare", root, operationId: "20260101000000-prepare-abcdef",
    applied, status: applied ? "applied" : "preview",
    changes: { created, updated: [], removed: [], unchanged: [], preserved: [] },
    doctor: applied ? { passed: 9, failed: 0, skipped: 2, unavailable: 1 } : null,
    inspection, decision,
  };
}
interface HarnessDouble extends HarnessPreparation { previews: PrepareCommandInput[]; applies: PrepareCommandInput[] }
function harnessDouble(options: { adapter?: HarnessId; files?: number; failApply?: unknown; failPreview?: unknown } = {}): HarnessDouble {
  const adapter = options.adapter ?? "claude-code";
  const created = Array.from({ length: options.files ?? 24 }, (_, index) => `.forgeyard/file-${index}.md`);
  const double: HarnessDouble = {
    previews: [], applies: [],
    prepare: async (input) => {
      if (input.dryRun) {
        double.previews.push(input);
        if (options.failPreview !== undefined) throw options.failPreview;
        return prepareResult(input.targetRoot, adapter, created, false);
      }
      double.applies.push(input);
      if (options.failApply !== undefined) throw options.failApply;
      // L'imbracatura installata dichiara il proprio client: la riesecuzione non lo decide di nuovo.
      await mkdir(path.join(input.targetRoot, ".forgeyard"), { recursive: true });
      await writeFile(path.join(input.targetRoot, ".forgeyard/manifest.json"), `${JSON.stringify({
        schemaVersion: 1, forgeyardVersion: "0.1.0", profile: "tailored", adapter,
        latestOperationId: "20260101000000-prepare-abcdef", files: [],
      }, null, 2)}\n`);
      return prepareResult(input.targetRoot, adapter, created, true);
    },
  };
  return double;
}
interface NativeDouble extends NativeBinding { connected: HarnessId[] }
function nativeDouble(options: { fail?: unknown } = {}): NativeDouble {
  const double: NativeDouble = {
    connected: [],
    // L'osservazione è quella di produzione: nessuna prova con un client reale.
    observe: projectNativeBinding.observe,
    connect: async ({ client }) => {
      if (options.fail !== undefined) throw options.fail;
      double.connected.push(client);
    },
  };
  return double;
}
function driver(answers: { outcome?: string; confirm?: boolean }, log: string[]): PromptDriver {
  return {
    input: async (id) => {
      log.push(`input:${id}`);
      if (answers.outcome === undefined) throw new Error("domanda di prodotto non attesa");
      return answers.outcome;
    },
    confirm: async (id) => {
      log.push(`confirm:${id}`);
      if (answers.confirm === undefined) throw new Error("conferma non attesa");
      return answers.confirm;
    },
    select: async () => { throw new Error("nessuna scelta di profilo o adapter è consentita"); },
    number: async () => { throw new Error("nessun budget o concorrenza è chiesto all'utente"); },
  };
}
function inventory(plugins: readonly { id: string; scope: "user" | "local"; projectPath?: string }[],
  observed = true): ClientInventory {
  return {
    observed,
    limitations: [],
    plugins: plugins.map((plugin) => ({
      id: plugin.id, marketplace: "un-mercato", scope: plugin.scope,
      projectPath: plugin.projectPath ?? null, version: "v1", gitCommitSha: "a".repeat(40),
    })),
  };
}

async function entry(root: string, options: {
  interactive?: boolean; outcome?: string; confirm?: boolean;
  harness?: HarnessPreparation; native?: NativeBinding;
  commandLookup?: (name: string) => Promise<boolean>;
  clientInventory?: () => Promise<ClientInventory>;
}) {
  const log: string[] = [];
  let stdout = ""; let stderr = "";
  const injected: PersonalEntryOptions = {
    interactive: options.interactive ?? true,
    prompts: driver({ ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
      ...(options.confirm === undefined ? {} : { confirm: options.confirm }) }, log),
    io: { writeOut: (text) => { stdout += text; }, writeErr: (text) => { stderr += text; } },
    ...(options.harness === undefined ? {} : { harness: options.harness }),
    ...(options.native === undefined ? {} : { native: options.native }),
    // Senza iniezione la sonda leggerebbe il PATH reale: un test non dipende da cosa
    // questa macchina ha installato.
    commandLookup: options.commandLookup ?? (async () => false),
    ...(options.clientInventory === undefined ? {} : { clientInventory: options.clientInventory }),
  };
  return { exitCode: await runPersonalEntry(root, injected), stdout, stderr, log };
}
async function installedConnection(root: string): Promise<void> {
  await writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { forgeyard: { type: "stdio" } } }, null, 2)}\n`);
}
async function installedHarness(root: string, adapter: HarnessId = "claude-code"): Promise<void> {
  await writeFile(path.join(root, ".forgeyard/manifest.json"), `${JSON.stringify({
    schemaVersion: 1, forgeyardVersion: "0.1.0", profile: "tailored", adapter,
    latestOperationId: "20260101000000-prepare-abcdef", files: [],
  }, null, 2)}\n`);
}

test("una cartella vuota si prepara con una sola domanda e una sola conferma", async () => temporary(async (root) => {
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toEqual(["input:workspace.outcome", "confirm:workspace.prepare"]);
  expect(result.stdout).toContain("Verrà preparato:");
  expect(result.stdout).toContain("Client: Claude Code — un CLAUDE.md esistente identifica l'host del progetto");
  expect(result.stdout).toContain("Capacità selezionate: 8    escluse: 4");
  expect(result.stdout).toContain("Verifiche: npm test");
  expect(result.stdout).toContain("Area personale creata.");
  expect(result.stdout).toContain("Imbracatura installata: 24 file.");
  expect(result.stdout).toContain("Collegamento nativo configurato per Claude Code.");
  expect(result.stdout).toContain("Apri questa cartella in Claude Code e descrivi il lavoro");
  expect(result.stdout).toContain("Il collegamento non è stato provato con Claude Code");
  expect(harness.applies).toHaveLength(1);
  expect(native.connected).toEqual(["claude-code"]);
  // L'ordine è dichiarato dai byte: l'area privata esiste prima dell'inventario dell'imbracatura.
  expect((await inspectPersonalWorkspace(root)).current?.payload.connection).toBe("not-connected");
  expect((await readdir(path.join(root, ".forgeyard"))).sort()).toEqual([".gitignore", "manifest.json", "workspace.json"]);
}));

// Un effetto non dichiarato prima del consenso vale come un verdetto non sostenuto: l'utente
// conferma una volta sola, quindi ogni scrittura che esce da .forgeyard va nominata prima.
test("l'anteprima nomina le scritture fuori dall'area personale prima di chiedere conferma",
  async () => temporary(async (root) => {
    await writeFile(path.join(root, "CLAUDE.md"), "# progetto");
    const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: false,
      harness: harnessDouble(), native: nativeDouble() });

    const summary = result.stdout.slice(result.stdout.indexOf("Verrà preparato:"),
      result.stdout.indexOf("Preparazione annullata"));
    expect(summary).toContain(".mcp.json");
    // Il file di istruzioni esiste già: riceverà un blocco in coda, e può essere tracciato.
    expect(summary).toContain("CLAUDE.md: un blocco delimitato in coda");
    // Fuori da un repository la regola finisce in un `.gitignore`, non in
    // `.git/info/exclude`: la fixture di questa prova non e' un repository.
    expect(summary).toContain("una regola in .gitignore");
    // La riga di chiusura non può più affermare che Git non viene toccato.
    expect(summary).not.toContain("Git e repository figli non vengono modificati");
  }));

// Un agente che riceve la nostra imbracatura sopra i plugin che il client già fornisce si
// ritrova due autorità sulla stessa cosa. Dirlo prima della conferma non lo impedisce, ma
// smette di nasconderlo.
// Il lavoro nativo richiede un albero di lavoro Git unico con un HEAD. Su un workspace che
// contiene piu' repository l'imbracatura si installa benissimo e poi `fy_attach` risponde
// FY_GIT_REQUIRED: preparare una cartella in cui ci si rifiutera' di lavorare, senza dirlo
// prima della conferma, e' un effetto non dichiarato travestito da limite tecnico.
test("l'anteprima avverte quando il lavoro nativo non potra' partire in questa cartella",
  async () => temporary(async (root) => {
    await mkdir(path.join(root, "servizio"));
    await git(path.join(root, "servizio"), "init", "-b", "main");
    await mkdir(path.join(root, "frontend"));
    await git(path.join(root, "frontend"), "init", "-b", "main");

    const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: false,
      harness: harnessDouble(), native: nativeDouble() });

    expect(result.stdout).toContain("Lavoro nativo: non parte in questa cartella");
    expect(result.stdout).toContain("2 repository");
  }));

test("non avverte quando la cartella e' un solo repository", async () => temporary(async (root) => {
  await git(root, "init", "-b", "main");

  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: false,
    harness: harnessDouble(), native: nativeDouble() });

  expect(result.stdout).not.toContain("Lavoro nativo: non parte");
}));

test("l'anteprima dice quali plugin il client fornisce già per questa cartella", async () =>
  temporary(async (root) => {
    const result = await entry(root, {
      outcome: "Un servizio di ricerca", confirm: false, harness: harnessDouble(), native: nativeDouble(),
      clientInventory: async () => inventory([
        { id: "superpowers", scope: "user" },
        { id: "auth0", scope: "user" },
        { id: "altrui", scope: "local", projectPath: path.join(root, "altro-progetto") },
      ]),
    });

    // Ordinati e senza quello legato a un altro progetto.
    expect(result.stdout).toContain("Il client fornisce già: auth0, superpowers");
    expect(result.stdout).not.toContain("altrui");
  }));

test("un registro illeggibile non diventa 'nessun plugin'", async () => temporary(async (root) => {
  const result = await entry(root, {
    outcome: "Un servizio di ricerca", confirm: false, harness: harnessDouble(), native: nativeDouble(),
    clientInventory: async () => inventory([], false),
  });

  // Assenza di osservazione, non osservazione di assenza.
  expect(result.stdout).toContain("non osservabili su questa macchina");
}));

test("nessun plugin attivo qui e' detto, non taciuto", async () => temporary(async (root) => {
  const result = await entry(root, {
    outcome: "Un servizio di ricerca", confirm: false, harness: harnessDouble(), native: nativeDouble(),
    clientInventory: async () => inventory([]),
  });

  expect(result.stdout).toContain("nessuno attivo per questa cartella");
}));

test("per Codex non si annuncia un registro che non esiste", async () => temporary(async (root) => {
  const result = await entry(root, {
    outcome: "Un servizio di ricerca", confirm: false, native: nativeDouble(),
    harness: harnessDouble({ adapter: "codex" }),
    clientInventory: async () => { throw new Error("Codex non ha un registro di plugin da leggere"); },
  });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("Il client fornisce");
  expect(result.stdout).not.toContain("Plugin già presenti");
}));

test("l'anteprima non annuncia un blocco in un file di istruzioni che non esiste", async () =>
  temporary(async (root) => {
    const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: false,
      harness: harnessDouble(), native: nativeDouble() });

    // Senza un CLAUDE.md preesistente la forgia crea il proprio, che porta già il puntatore.
    expect(result.stdout).not.toContain("CLAUDE.md: un blocco delimitato in coda");
    expect(result.stdout).toContain(".mcp.json");
  }));

test("il brief dell'utente è l'unico ingresso di prodotto passato al servizio", async () => temporary(async (root) => {
  const harness = harnessDouble(); const native = nativeDouble();
  await entry(root, { outcome: "  Correggere il calcolo delle scadenze  ", confirm: true, harness, native });
  expect(harness.previews[0]).toMatchObject({ brief: "Correggere il calcolo delle scadenze", dryRun: true, nonInteractive: true, yes: false });
  expect(harness.applies[0]).toMatchObject({ brief: "Correggere il calcolo delle scadenze", dryRun: false, nonInteractive: true, yes: true });
}));

test("una root Git si prepara senza indicizzare la forgia", async () => temporary(async (root) => {
  await git(root, "init", "-b", "main");
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ devDependencies: { typescript: "5" } }));
  const harness = harnessDouble({ adapter: "codex" }); const native = nativeDouble();
  const result = await entry(root, { outcome: "Un backend di ordini", confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Repository rilevati: 1. Progetti rilevati: 1.");
  expect(result.stdout).toContain("  .: typescript");
  expect(result.stdout).toContain("Collegamento nativo configurato per Codex.");
  expect(native.connected).toEqual(["codex"]);
  await git(root, "add", "--all");
  expect(await git(root, "ls-files", "--", ".forgeyard")).toBe("");
  expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe("node_modules/\n");
}));

test("un contenitore multi-repository si prepara una volta sola, senza scrivere nei figli", async () => temporary(async (root) => {
  for (const name of ["api", "web"]) { await mkdir(path.join(root, name)); await git(path.join(root, name), "init", "-b", "main"); }
  await writeFile(path.join(root, "web/package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  const before = await git(path.join(root, "web"), "status", "--porcelain=v1", "--untracked-files=all");
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { outcome: "Unire i due servizi", confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Repository rilevati: 2. Progetti rilevati: 1.");
  expect(harness.applies).toHaveLength(1);
  expect(await readdir(path.join(root, "api"))).toEqual([".git"]);
  expect(await git(path.join(root, "web"), "status", "--porcelain=v1", "--untracked-files=all")).toBe(before);
}));

test("senza terminale interattivo mostra soltanto l'anteprima e non chiede niente", async () => temporary(async (root) => {
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { interactive: false, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toEqual([]);
  expect(result.stdout).toContain("Passi mancanti: area personale, imbracatura, collegamento nativo.");
  expect(result.stdout).toMatch(/anteprima/i);
  expect(result.stdout).toContain("File dell'imbracatura da creare: 24");
  expect(harness.previews[0]).toMatchObject({ dryRun: true, nonInteractive: true });
  expect(harness.previews[0]?.brief).toBeUndefined();
  expect(harness.applies).toEqual([]);
  expect(native.connected).toEqual([]);
  expect(await readdir(root)).toEqual([]);
}));

test("senza terminale il piano non deducibile viene dichiarato, non inventato", async () => temporary(async (root) => {
  const harness = harnessDouble({ failPreview: { code: "FY_INTAKE_INCOMPLETE" } });
  const result = await entry(root, { interactive: false, harness, native: nativeDouble() });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("richiede un terminale interattivo");
  expect(result.stdout).not.toContain("Capacità selezionate");
  expect(await readdir(root)).toEqual([]);
}));

test("il rifiuto della conferma non scrive niente e non installa niente", async () => temporary(async (root) => {
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: false, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Preparazione annullata. Nessun file scritto.");
  expect(harness.applies).toEqual([]);
  expect(native.connected).toEqual([]);
  expect(await readdir(root)).toEqual([]);
}));

// Leggere prima di chiedere: una risposta vuota fa tentare l'evidenza del progetto,
// e soltanto se non basta viene detto che serve una descrizione.
test("una risposta vuota prepara comunque se il progetto dice da solo cosa vuole", async () => temporary(async (root) => {
  const harness = harnessDouble();
  const native = nativeDouble();
  const result = await entry(root, { outcome: "   ", confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("provo a dedurre il risultato dal progetto");
  expect(harness.previews).toHaveLength(1);
  expect(harness.previews[0]).not.toHaveProperty("brief");
  expect(native.connected).toEqual(["claude-code"]);
}));

test("una risposta vuota su un progetto che non si spiega chiede una descrizione", async () => temporary(async (root) => {
  const harness = harnessDouble({ failPreview: { code: "FY_INTAKE_INCOMPLETE" } });
  const result = await entry(root, { outcome: "   ", harness, native: nativeDouble() });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Il progetto non dice da solo quale risultato vuoi ottenere");
  expect(harness.applies).toEqual([]);
  expect(await readdir(root)).toEqual([]);
}));

test("una scansione parziale rifiuta la preparazione prima di qualunque domanda", async () => temporary(async (root) => {
  await writeFile(path.join(root, "package.json"), "not-json");
  const harness = harnessDouble();
  const result = await entry(root, { outcome: "Un servizio", confirm: true, harness, native: nativeDouble() });
  expect(result.exitCode).toBe(4);
  expect(result.stderr).toContain("Scansione parziale");
  expect(result.log).toEqual([]);
  expect(harness.previews).toEqual([]);
  expect(await readdir(root)).toEqual(["package.json"]);
}));

test("un'area completa non viene reinstallata e non scrive niente", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  await installedHarness(root); await installedConnection(root);
  const file = path.join(root, ".forgeyard/workspace.json");
  const before = await readFile(file, "utf8"); const mtime = (await stat(file)).mtimeMs;
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toEqual([]);
  expect(result.stdout).toContain("Area personale: presente.");
  expect(result.stdout).toContain("Imbracatura: presente per Claude Code.");
  expect(result.stdout).toContain("Collegamento nativo: presente.");
  expect(result.stdout).toContain("Niente da preparare: nessun file scritto.");
  expect(harness.previews).toEqual([]);
  expect(native.connected).toEqual([]);
  expect(await readFile(file, "utf8")).toBe(before);
  expect((await stat(file)).mtimeMs).toBe(mtime);
}));

test("con l'imbracatura mancante viene completato soltanto quel passo", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  const file = path.join(root, ".forgeyard/workspace.json");
  const mtime = (await stat(file)).mtimeMs;
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toEqual(["input:workspace.outcome", "confirm:workspace.prepare"]);
  expect(result.stdout).toContain("Area personale: presente.");
  expect(result.stdout).not.toContain("Area personale creata.");
  expect(result.stdout).toContain("Imbracatura installata: 24 file.");
  expect(harness.applies).toHaveLength(1);
  expect(native.connected).toEqual(["claude-code"]);
  expect((await stat(file)).mtimeMs).toBe(mtime);
}));

test("con il solo collegamento mancante non viene posta la domanda di prodotto", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  await installedHarness(root, "codex");
  const harness = harnessDouble(); const native = nativeDouble();
  const result = await entry(root, { confirm: true, harness, native });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toEqual(["confirm:workspace.prepare"]);
  expect(result.stdout).toContain("Solo il collegamento nativo: l'imbracatura presente non viene reinstallata.");
  expect(result.stdout).toContain("Collegamento nativo configurato per Codex.");
  expect(harness.previews).toEqual([]);
  expect(harness.applies).toEqual([]);
  expect(native.connected).toEqual(["codex"]);
}));

test("un collegamento nativo non riuscito non viene mai dichiarato pronto", async () => temporary(async (root) => {
  const harness = harnessDouble();
  const native = nativeDouble({ fail: Object.assign(new Error("Local binding refused"), { code: "FY_BINDING_TRACKED" }) });
  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: true, harness, native });
  expect(result.exitCode).toBe(4);
  expect(result.stdout).toContain("Area personale creata.");
  expect(result.stdout).toContain("Imbracatura installata: 24 file.");
  expect(result.stderr).toContain("Collegamento nativo non configurato per Claude Code: FY_BINDING_TRACKED");
  expect(result.stdout).toContain("L'imbracatura resta installata.");
  expect(result.stdout).not.toContain("Collegamento nativo configurato per");
  expect(result.stdout).not.toContain("la forgia fa il resto");
  // La riesecuzione riprende soltanto il collegamento, senza ridomandare il risultato.
  const second = await entry(root, { confirm: true, harness, native: nativeDouble() });
  expect(second.exitCode, second.stderr).toBe(0);
  expect(second.log).toEqual(["confirm:workspace.prepare"]);
  expect(harness.applies).toHaveLength(1);
}));

test("un'installazione non riuscita conserva l'area e non tenta il collegamento", async () => temporary(async (root) => {
  const harness = harnessDouble({ failApply: Object.assign(new Error("would replace an unknown file"),
    { code: "FY_OWNERSHIP_CONFLICT", paths: [".forgeyard/.gitignore"] }) });
  const native = nativeDouble();
  const result = await entry(root, { outcome: "Un servizio di ricerca", confirm: true, harness, native });
  expect(result.exitCode).toBe(4);
  expect(result.stdout).toContain("Area personale creata.");
  expect(result.stderr).toContain("Imbracatura non installata: FY_OWNERSHIP_CONFLICT (.forgeyard/.gitignore)");
  expect(result.stdout).toContain("L'area personale resta come è e nessun collegamento nativo è stato configurato.");
  expect(native.connected).toEqual([]);
  expect((await inspectPersonalWorkspace(root)).current).not.toBeNull();
}));

test("un inventario dell'imbracatura illeggibile non autorizza nessuna scrittura", async () => temporary(async (root) => {
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  await writeFile(path.join(root, ".forgeyard/manifest.json"), "{ non leggibile");
  const harness = harnessDouble();
  const result = await entry(root, { outcome: "Un servizio", confirm: true, harness, native: nativeDouble() });
  expect(result.exitCode).toBe(4);
  expect(result.stderr).toContain("non è leggibile");
  expect(result.log).toEqual([]);
  expect(harness.previews).toEqual([]);
  expect(await readFile(path.join(root, ".forgeyard/manifest.json"), "utf8")).toBe("{ non leggibile");
}));

test("un'area della forgia non riconosciuta viene preservata e dichiarata", async () => temporary(async (root) => {
  await mkdir(path.join(root, ".forgeyard"));
  await writeFile(path.join(root, ".forgeyard/capsule.json"), "legacy");
  const harness = harnessDouble();
  const result = await entry(root, { outcome: "Un servizio", confirm: true, harness, native: nativeDouble() });
  expect(result.exitCode).toBe(4);
  expect(result.log).toEqual([]);
  expect(harness.previews).toEqual([]);
  expect(await readFile(path.join(root, ".forgeyard/capsule.json"), "utf8")).toBe("legacy");
}));

// Scegliere per la persona: senza un file di istruzioni, l'adapter segue il client che
// la macchina ha davvero, invece del formato portabile predefinito.
test("l'adapter segue il client installato quando il progetto non lo dichiara", async () => temporary(async (root) => {
  const harness = harnessDouble();
  await entry(root, {
    outcome: "Un servizio", confirm: true, harness, native: nativeDouble(),
    commandLookup: async (name) => name === "claude",
  });

  expect(harness.previews[0]?.harnessAvailability).toEqual({ "claude-code": true, codex: false });
}));

test("la sonda non viene eseguita al posto della persona: il progetto che dichiara vince", async () => temporary(async (root) => {
  await writeFile(path.join(root, "CLAUDE.md"), "# Progetto" + String.fromCharCode(10));
  const harness = harnessDouble();
  await entry(root, {
    outcome: "Un servizio", confirm: true, harness, native: nativeDouble(),
    commandLookup: async (name) => name === "codex",
  });

  // La disponibilità viene comunque riportata; la precedenza la decide la composizione.
  expect(harness.previews[0]?.harnessAvailability).toEqual({ "claude-code": false, codex: true });
}));
