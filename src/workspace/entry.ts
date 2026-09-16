import { createInquirerPromptDriver, type PromptDriver } from "../config/wizard.js";
import { WorkspaceDiscoveryError } from "./discovery.js";
import { inspectPersonalWorkspace, createPersonalWorkspace, PersonalWorkspaceError } from "./personal.js";
import type { WorkspaceCliIo } from "./cli.js";

export interface PersonalEntryOptions {
  interactive?: boolean;
  prompts?: PromptDriver;
  io?: WorkspaceCliIo;
}
const output: WorkspaceCliIo = {
  writeOut: (text) => { process.stdout.write(text); },
  writeErr: (text) => { process.stderr.write(text); },
};

/** Unico ingresso ordinario. I dettagli diagnostici non diventano una sequenza per l'utente. */
export async function runPersonalEntry(root = process.cwd(), options: PersonalEntryOptions = {}): Promise<number> {
  const io = options.io ?? output;
  try {
    const preview = await inspectPersonalWorkspace(root);
    io.writeOut(`Forgeyard — preparazione personale\nCartella: ${preview.root}\n`);
    if (preview.current) {
      io.writeOut("Area personale già presente. Nessuna reinstallazione o aggiornamento automatico.\n" +
        "Collegamento agentico non ancora configurato in questa versione.\n");
      return 0;
    }
    io.writeOut(`Repository rilevati: ${preview.discovery.repositories.length}. Progetti rilevati: ${preview.discovery.projects.length}.\n`);
    for (const project of preview.discovery.projects.slice(0, 12))
      io.writeOut(`  ${project.path}: ${[...project.languages, ...project.frameworks].join(", ") || "stack da chiarire nella conversazione"}\n`);
    if (preview.discovery.projects.length > 12) io.writeOut("Altri progetti presenti nella mappa locale.\n");
    if (preview.discovery.scan.status !== "complete") {
      io.writeErr("Scansione parziale: nessuna area personale creata. Risolvi gli avvisi prima di confermare.\n");
      for (const warning of preview.discovery.warnings.slice(0, 8)) io.writeErr(`  ${warning.code}: ${warning.path}\n`);
      return 4;
    }
    io.writeOut("I file saranno privati nella cartella .forgeyard; codice, Git e repository figli non verranno modificati.\n" +
      "Questo incremento prepara l'area locale, non attiva ancora la suite nelle app.\n");
    const interactive = options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!interactive) {
      io.writeOut("Solo anteprima: nessun file scritto. Esegui forgeyard in un terminale interattivo per confermare.\n");
      return 0;
    }
    const prompts = options.prompts ?? createInquirerPromptDriver();
    if (!await prompts.confirm("personal.prepare", "Confermi la creazione dell'area personale in questa cartella?", false)) {
      io.writeOut("Preparazione annullata. Nessun file scritto.\n"); return 0;
    }
    await createPersonalWorkspace(preview);
    io.writeOut("Area personale creata.\nCollegamento agentico non ancora configurato in questa versione.\n");
    return 0;
  } catch (error) {
    if (error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name)) {
      io.writeOut("Preparazione annullata prima della conferma.\n"); return 0;
    }
    const message = error instanceof PersonalWorkspaceError || error instanceof WorkspaceDiscoveryError
      ? error.message : "Preparazione non riuscita. Controlla permessi e area personale prima di riprovare.";
    io.writeErr(`${message}\n`);
    return 4;
  }
}
