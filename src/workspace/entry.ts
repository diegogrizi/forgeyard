import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createInquirerPromptDriver, type PromptDriver } from "../config/wizard.js";
import { HARNESS_IDS, type HarnessId } from "../core/contracts.js";
import { WorkspaceDiscoveryError } from "./discovery.js";
import { inspectPersonalWorkspace, createPersonalWorkspace, PersonalWorkspaceError, type PersonalPreview } from "./personal.js";
import { commandOnPath } from "../doctor/run-doctor.js";
import { partitionForProject, readClientInventory, type ClientInventory } from "../inventory/client-plugins.js";
import type { WorkspaceCliIo } from "./cli.js";
import type { PrepareCommandInput, PrepareCommandResult } from "../application/forgeyard.js";

/** The stable preparation API, reduced to what the entry composes. Injectable: a test must not install a real harness. */
export interface HarnessPreparation {
  prepare(input: PrepareCommandInput): Promise<PrepareCommandResult>;
}
/** Native binding split in two: state is observed without writing, so a missing step can be offered before it is taken. */
export interface NativeBinding {
  observe(input: { root: string; client: HarnessId }): Promise<boolean>;
  connect(input: { root: string; client: HarnessId }): Promise<void>;
}
export interface PersonalEntryOptions {
  interactive?: boolean;
  prompts?: PromptDriver;
  io?: WorkspaceCliIo;
  harness?: HarnessPreparation;
  native?: NativeBinding;
  /** Executable probe, injectable: a test must not depend on what this machine has installed. */
  commandLookup?: (name: string) => Promise<boolean>;
  /** What the client already provides. Injectable: a test must not read this machine's registry. */
  clientInventory?: () => Promise<ClientInventory>;
  forgeyardVersion?: string;
}
interface EntrySteps { area: boolean; harness: boolean; connection: boolean }

const output: WorkspaceCliIo = {
  writeOut: (text) => { process.stdout.write(text); },
  writeErr: (text) => { process.stderr.write(text); },
};
const CLIENT_LABEL: Readonly<Record<HarnessId, string>> = { "claude-code": "Claude Code", codex: "Codex" };
const STEP_LABEL: Readonly<Record<keyof EntrySteps, string>> = {
  area: "area personale", harness: "imbracatura", connection: "collegamento nativo",
};
// The reasons are produced in one place (src/intake/compose.ts) and are English by convention;
// the ordinary path speaks Italian, so an unrecognized reason is omitted instead of translated by guess.
const ADAPTER_REASON: Readonly<Record<string, string>> = {
  "Existing CLAUDE.md instructions identify the project host.": "un CLAUDE.md esistente identifica l'host del progetto",
  "Existing AGENTS.md instructions identify the project host.": "un AGENTS.md esistente identifica l'host del progetto",
  "Selected by an explicit project constraint.": "scelto da un vincolo esplicito del progetto",
  "The codex executable is available on this host.": "l'eseguibile codex è disponibile su questa macchina",
  "The claude-code executable is available on this host.": "l'eseguibile claude-code è disponibile su questa macchina",
  "Codex project layout is the portable format fallback; runtime availability is unverified.":
    "formato portabile predefinito; la disponibilità del client non è verificata",
};
const MANIFEST_LIMIT = 8_388_608;
const CONFIG_LIMIT = 1_048_576;

async function optionalStat(target: string) {
  try { return await lstat(target); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
/** Read-only observation: never creates a parent directory and never follows a link. */
async function observedText(target: string, maximum: number): Promise<string | null> {
  const stats = await optionalStat(target);
  if (!stats || stats.isSymbolicLink() || !stats.isFile() || stats.size > maximum) return null;
  return readFile(target, "utf8");
}

/** The installed harness declares its own client: the entry does not decide it again on re-entry. */
async function installedHarness(root: string): Promise<HarnessId | "absent" | "invalid"> {
  const target = path.join(root, ".forgeyard", "manifest.json");
  const stats = await optionalStat(target);
  if (!stats) return "absent";
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MANIFEST_LIMIT) return "invalid";
  try {
    const value: unknown = JSON.parse(await readFile(target, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "invalid";
    const adapter = (value as { adapter?: unknown }).adapter;
    if ((value as { schemaVersion?: unknown }).schemaVersion !== 1) return "invalid";
    return HARNESS_IDS.includes(adapter as HarnessId) ? adapter as HarnessId : "invalid";
  } catch { return "invalid"; }
}

/** Observes the project-owned namespace the client actually reads. Absence is not a diagnosis of the client. */
async function observeBinding(root: string, client: HarnessId): Promise<boolean> {
  if (client === "codex") {
    const source = await observedText(path.join(root, ".codex", "config.toml"), CONFIG_LIMIT);
    return source !== null && /^\s*\[mcp_servers\.forgeyard\]/mu.test(source);
  }
  const source = await observedText(path.join(root, ".mcp.json"), CONFIG_LIMIT);
  if (source === null) return false;
  try {
    const value: unknown = JSON.parse(source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const servers = (value as { mcpServers?: unknown }).mcpServers;
    return typeof servers === "object" && servers !== null && !Array.isArray(servers) &&
      (servers as Record<string, unknown>).forgeyard !== undefined;
  } catch { return false; }
}

function refusedPrompts(): PromptDriver {
  // One product question and one confirmation belong to the entry. A service that asked its
  // own question would multiply the sequence the user must remember, so it cannot.
  const refuse = async (): Promise<never> => {
    throw new Error("The personal entry owns every question asked on the ordinary path.");
  };
  return { input: refuse, select: refuse, number: refuse, confirm: refuse };
}
/** Default binding. Its observation is read-only; `connect` writes only project-scoped, owned blocks. */
export const projectNativeBinding: NativeBinding = {
  observe: async ({ root, client }) => observeBinding(root, client),
  connect: async ({ root, client }) => {
    // Project scope only: no global setting, no account, no automatic trust.
    await (await import("../native/bindings.js")).connectNativeClient({ root, client });
  },
};

/** Italian frame plus the technical code: an error code and a path are identifiers, not prose. */
function declaredCause(error: unknown): string {
  if (error instanceof PersonalWorkspaceError || error instanceof WorkspaceDiscoveryError) return error.message;
  const source = error as { code?: unknown; paths?: unknown } | null;
  const code = typeof source?.code === "string" ? source.code : null;
  const paths = Array.isArray(source?.paths)
    ? source.paths.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
  if (code === null) return "causa locale non identificata";
  return paths.length === 0 ? code : `${code} (${paths.join(", ")})`;
}

/**
 * The plugin ids the client already provides for this project, deduplicated and ordered.
 * `null` when the registry could not be read; `undefined` for a client that has no such
 * registry to read, where announcing one would invent a concept the user does not have.
 */
async function providedByClient(
  client: HarnessId,
  root: string,
  read: () => Promise<ClientInventory>,
): Promise<readonly string[] | null | undefined> {
  if (client !== "claude-code") return undefined;
  const inventory = await read();
  if (!inventory.observed) return null;
  return [...new Set(partitionForProject(inventory, root).available.map((plugin) => plugin.id))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

/** True when the client's instruction file is already there, and so will be appended to. */
async function instructionsPresent(root: string, client: HarnessId): Promise<boolean> {
  try { return (await lstat(path.join(root, client === "codex" ? "AGENTS.md" : "CLAUDE.md"))).isFile(); }
  catch { return false; }
}

/**
 * What connecting the client writes outside the private area. The entry asks once, so every
 * effect that leaves `.forgeyard` is named before that question instead of being found
 * afterwards in `git status`. An instruction file the factory creates itself already carries
 * the pointer, so only one that was already there gets a block appended.
 */
/**
 * What the client already provides for this project. Our capabilities are added on top of
 * these, not instead of them: a plugin from another marketplace is not ours to equate with
 * one of ours, so the overlap is declared and left to the reader rather than resolved by a
 * guess. `null` means the registry could not be read, which is not the same as no plugins.
 */
/**
 * Why a native run cannot start here, or null when it can. A native run now spans several
 * member repositories, and `fy_attach` itself asks for no Git at all: evidence binds to the
 * HEADs of only the members a task actually touches, and that requirement is enforced at
 * `fy_plan`, not here — so this check counts repositories the reconnaissance found, not
 * their commits. Only a folder with no Git anywhere, neither at the root nor in a member,
 * can never satisfy `fy_plan` later: preparing it without saying so first is an undeclared
 * effect wearing a technical limit as a costume.
 */
function nativeWorkBlocker(discovery: PersonalPreview["discovery"]): string | null {
  if (discovery.kind === "repository" || discovery.repositories.length > 0) return null;
  return "non è un repository Git e non contiene repository membri";
}

function writeNativeWorkBlocker(io: WorkspaceCliIo, reason: string | null): void {
  if (reason === null) return;
  io.writeOut(`  Lavoro nativo: non parte in questa cartella perché ${reason}.\n`);
  io.writeOut("  L'imbracatura viene installata lo stesso e resta utile; per lavorare inizializza un repository Git e crea un commit.\n");
}

function writeProvidedByClient(io: WorkspaceCliIo, provided: readonly string[] | null | undefined): void {
  if (provided === undefined) return;
  if (provided === null) {
    io.writeOut("  Plugin già presenti nel client: non osservabili su questa macchina.\n");
    return;
  }
  io.writeOut(provided.length === 0
    ? "  Plugin già presenti nel client: nessuno attivo per questa cartella.\n"
    : `  Il client fornisce già: ${provided.join(", ")}. Le capacità qui sopra si aggiungono a quelle.\n`);
}

function connectionEffects(client: HarnessId, present: boolean, insideRepository: boolean): readonly string[] {
  return [
    client === "codex" ? ".codex/config.toml" : ".mcp.json",
    ...(present ? [`${client === "codex" ? "AGENTS.md" : "CLAUDE.md"}: un blocco delimitato in coda`] : []),
    // Fuori da un repository non esiste `.git/info/exclude`: la regola finisce in un
    // `.gitignore`, che è un file diverso e visibile. Chiamarli con lo stesso nome
    // farebbe cercare all'utente un file che non c'è.
    insideRepository
      ? "un'esclusione in .git/info/exclude per la sola configurazione del client"
      : "una regola in .gitignore per la sola configurazione del client",
  ];
}

function writeTopology(io: WorkspaceCliIo, preview: PersonalPreview): void {
  io.writeOut(`Repository rilevati: ${preview.discovery.repositories.length}. Progetti rilevati: ${preview.discovery.projects.length}.\n`);
  for (const project of preview.discovery.projects.slice(0, 12))
    io.writeOut(`  ${project.path}: ${[...project.languages, ...project.frameworks].join(", ") || "stack da chiarire nella conversazione"}\n`);
  if (preview.discovery.projects.length > 12) io.writeOut("Altri progetti presenti nella mappa locale.\n");
}

function writeState(io: WorkspaceCliIo, steps: EntrySteps, client: HarnessId | null): void {
  io.writeOut(`Area personale: ${steps.area ? "presente" : "da creare"}.\n`);
  io.writeOut(`Imbracatura: ${steps.harness && client ? `presente per ${CLIENT_LABEL[client]}` : "da installare"}.\n`);
  io.writeOut(`Collegamento nativo: ${steps.connection ? "presente" : "da configurare"}.\n`);
}

function writePlanSummary(io: WorkspaceCliIo, plan: PrepareCommandResult | null, client: HarnessId,
  connection: readonly string[] | null, provided: readonly string[] | null | undefined,
  nativeBlocker: string | null): void {
  io.writeOut("Verrà preparato:\n");
  const translated = plan === null ? undefined : ADAPTER_REASON[plan.decision.adapterReason];
  io.writeOut(`  Client: ${CLIENT_LABEL[client]}${translated === undefined ? "" : ` — ${translated}`}\n`);
  if (plan === null) {
    io.writeOut("  Solo il collegamento nativo: l'imbracatura presente non viene reinstallata.\n");
  } else {
    io.writeOut(`  Capacità selezionate: ${plan.decision.selected.length}    escluse: ${plan.decision.excluded.length}\n`);
    const checks = plan.inspection.qualityCommands.map((command) => command.argv.join(" "));
    if (checks.length > 0) io.writeOut(`  Verifiche: ${checks.join(" · ")}\n`);
    io.writeOut(`  File dell'imbracatura da creare: ${plan.changes.created.length}\n`);
  }
  writeNativeWorkBlocker(io, nativeBlocker);
  writeProvidedByClient(io, provided);
  if (connection !== null)
    io.writeOut(`  Fuori da .forgeyard: ${connection.join("; ")}. Ogni scrittura è delimitata e reversibile.\n`);
  io.writeOut("  I file privati restano in .forgeyard; il codice e i repository figli non vengono modificati.\n");
}

function prepareInput(root: string, brief: string | null, apply: boolean,
  availability?: Partial<Record<HarnessId, boolean>>): PrepareCommandInput {
  // nonInteractive keeps the service silent: the entry has already asked, once.
  return { targetRoot: root, yes: apply, dryRun: !apply, nonInteractive: true,
    ...(brief === null ? {} : { brief }),
    ...(availability === undefined ? {} : { harnessAvailability: availability }) };
}

/**
 * Which client is actually installed. A project with no instruction file would otherwise
 * fall back to the portable layout even on a machine that only has the other client, and
 * choosing for the person is the whole point. Reading PATH is not an external effect, and
 * the candidate is never executed.
 */
async function installedClients(
  lookup: (name: string) => Promise<boolean>,
): Promise<Partial<Record<HarnessId, boolean>>> {
  const [claude, codex] = await Promise.all([lookup("claude"), lookup("codex")]);
  return { "claude-code": claude, codex };
}

/** Unico ingresso ordinario. I dettagli diagnostici non diventano una sequenza per l'utente. */
export async function runPersonalEntry(root = process.cwd(), options: PersonalEntryOptions = {}): Promise<number> {
  const io = options.io ?? output;
  try {
    const preview = await inspectPersonalWorkspace(root);
    const availability = await installedClients(options.commandLookup ?? commandOnPath);
    io.writeOut(`Forgeyard — preparazione personale\nCartella: ${preview.root}\n`);
    writeTopology(io, preview);

    const installed = await installedHarness(preview.root);
    if (installed === "invalid") {
      io.writeErr("L'inventario dell'imbracatura in .forgeyard non è leggibile. Nessun file è stato scritto: serve una verifica esplicita.\n");
      return 4;
    }
    const native = options.native ?? projectNativeBinding;
    const inventoryOf = options.clientInventory ?? (() => readClientInventory());
    // `steps.harness` is exactly `client !== null`: an installed harness always names its client,
    // so the entry never decides the adapter again for a project that already carries one.
    const client = installed === "absent" ? null : installed;
    const steps: EntrySteps = {
      area: preview.current !== null,
      harness: client !== null,
      connection: client !== null && await native.observe({ root: preview.root, client }),
    };
    const pending = (Object.keys(STEP_LABEL) as (keyof EntrySteps)[]).filter((step) => !steps[step]);
    if (steps.area || steps.harness || steps.connection) writeState(io, steps, client);
    if (pending.length === 0) {
      io.writeOut("Niente da preparare: nessun file scritto.\n" +
        `Apri questa cartella in ${CLIENT_LABEL[client!]} e descrivi il lavoro: la forgia fa il resto.\n`);
      return 0;
    }

    if (preview.discovery.scan.status !== "complete") {
      io.writeErr("Scansione parziale: nessuna preparazione autorizzata. Risolvi gli avvisi prima di confermare.\n");
      for (const warning of preview.discovery.warnings.slice(0, 8)) io.writeErr(`  ${warning.code}: ${warning.path}\n`);
      return 4;
    }

    // Loaded only when a harness step is actually pending: the ordinary path must stay cheap.
    let service = options.harness;
    const harness = async (): Promise<HarnessPreparation> => service ??= (await import("../application/forgeyard.js"))
      .createForgeyardService({ prompts: refusedPrompts(), forgeyardVersion: options.forgeyardVersion ?? "0.1.0" });
    const interactive = options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!interactive) {
      io.writeOut(`Passi mancanti: ${pending.map((step) => STEP_LABEL[step]).join(", ")}.\n`);
      if (!steps.harness) {
        // Without a terminal the product question cannot be asked, so the plan is previewed
        // from the project's own inputs when they carry the outcome, and declared missing otherwise.
        try {
          const previewed = await (await harness()).prepare(prepareInput(preview.root, null, false, availability));
          writePlanSummary(io, previewed, previewed.decision.adapter, steps.connection
            ? null
            : connectionEffects(previewed.decision.adapter,
              await instructionsPresent(preview.root, previewed.decision.adapter),
              preview.discovery.kind === "repository"),
            await providedByClient(previewed.decision.adapter, preview.root, inventoryOf),
            nativeWorkBlocker(preview.discovery));
        } catch (error) {
          io.writeOut((error as { code?: unknown } | null)?.code === "FY_INTAKE_INCOMPLETE"
            ? "Il piano dell'imbracatura dipende dal risultato voluto: quella domanda richiede un terminale interattivo.\n"
            : `Anteprima del piano non disponibile: ${declaredCause(error)}\n`);
        }
      }
      io.writeOut("Solo anteprima: nessun file scritto. Esegui forgeyard in un terminale interattivo per confermare.\n");
      return 0;
    }

    const prompts = options.prompts ?? createInquirerPromptDriver();
    let brief: string | null = null;
    let plan: PrepareCommandResult | null = null;
    if (!steps.harness) {
      // The one thing the program cannot deduce. Asked once, whatever the reconnaissance found.
      brief = (await prompts.input("workspace.outcome", "Che risultato vuoi ottenere?")).trim();
      // An empty answer is not a refusal: the factory reads what already exists before it
      // asks, so it tries the project's own evidence and only then says it is not enough.
      const described = brief.length === 0 ? null : brief;
      if (described === null) io.writeOut("Nessuna descrizione: provo a dedurre il risultato dal progetto.\n");
      try {
        plan = await (await harness()).prepare(prepareInput(preview.root, described, false, availability));
      } catch (error) {
        if (described !== null || (error as { code?: unknown } | null)?.code !== "FY_INTAKE_INCOMPLETE") throw error;
        io.writeOut("Il progetto non dice da solo quale risultato vuoi ottenere.\n" +
          "Riesegui forgeyard e descrivi il risultato in una riga: è l'unica cosa che il programma non può dedurre.\n");
        return 0;
      }
    }
    const target = plan?.decision.adapter ?? client!;
    writePlanSummary(io, plan, target, steps.connection
      ? null
      : connectionEffects(target, await instructionsPresent(preview.root, target),
        preview.discovery.kind === "repository"),
      await providedByClient(target, preview.root, inventoryOf), nativeWorkBlocker(preview.discovery));
    if (!await prompts.confirm("workspace.prepare", "Confermi la preparazione di questa cartella?", false)) {
      io.writeOut("Preparazione annullata. Nessun file scritto.\n");
      return 0;
    }

    // Ordered writes. A failed step leaves the earlier ones in place and is declared, not undone:
    // applyInstallPlan owns its own transactional recovery, and deleting a just-created private
    // area from downstream would destroy state nobody asked to lose.
    if (!steps.area) {
      try { await createPersonalWorkspace(preview); }
      catch (error) {
        io.writeErr(`Area personale non creata: ${declaredCause(error)}\n`);
        io.writeOut("Nessun altro passo è stato tentato.\n");
        return 4;
      }
      io.writeOut("Area personale creata.\n");
    }
    if (!steps.harness) {
      let applied: PrepareCommandResult;
      try { applied = await (await harness()).prepare(prepareInput(preview.root, brief, true, availability)); }
      catch (error) {
        io.writeErr(`Imbracatura non installata: ${declaredCause(error)}\n`);
        io.writeOut("L'area personale resta come è e nessun collegamento nativo è stato configurato.\n" +
          "Riesegui forgeyard in questa cartella: verranno ripresi soltanto i passi mancanti.\n");
        return 4;
      }
      // The preview counts a pre-existing privacy rule among the files to create, while the
      // install preserves it. Reporting both numbers explains the difference instead of
      // leaving the reader to wonder which of the two is wrong.
      const preserved = applied.changes.preserved.length;
      const createdCount = applied.changes.created.length;
      io.writeOut(createdCount === 0
        ? "Imbracatura già coerente: nessun file creato.\n"
        : `Imbracatura installata: ${createdCount} file${preserved === 0 ? "" : `, ${preserved} ${preserved === 1 ? "conservato" : "conservati"}`}.\n`);
    }
    if (!steps.connection) {
      try { await native.connect({ root: preview.root, client: target }); }
      catch (error) {
        io.writeErr(`Collegamento nativo non configurato per ${CLIENT_LABEL[target]}: ${declaredCause(error)}\n`);
        io.writeOut("L'imbracatura resta installata. Installa o sblocca il client, poi riesegui forgeyard: verrà ripreso soltanto il collegamento.\n");
        return 4;
      }
      io.writeOut(`Collegamento nativo configurato per ${CLIENT_LABEL[target]}.\n`);
    }
    io.writeOut(`Il collegamento non è stato provato con ${CLIENT_LABEL[target]}: se il client chiede di abilitare il server, fallo con i suoi controlli e riapri il progetto.\n` +
      `Apri questa cartella in ${CLIENT_LABEL[target]} e descrivi il lavoro: la forgia fa il resto.\n`);
    return 0;
  } catch (error) {
    if (error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name)) {
      io.writeOut("Preparazione annullata prima della conferma.\n"); return 0;
    }
    const message = error instanceof PersonalWorkspaceError || error instanceof WorkspaceDiscoveryError
      ? error.message : `Preparazione non riuscita: ${declaredCause(error)}. Controlla permessi e area personale prima di riprovare.`;
    io.writeErr(`${message}\n`);
    return 4;
  }
}
