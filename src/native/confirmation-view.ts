import type { ConfirmationKind, HumanConfirmation } from "./contracts.js";
import { gateWorkingDirectory } from "./gates.js";
import { memberRoot } from "./members.js";
import { requiredGates } from "./runs.js";

type ConfirmationInput = Parameters<HumanConfirmation>[0];

const ACTIONS: Record<ConfirmationKind, { heading: string; intro: string; approveLabel: string; goal?: string }> = {
  plan: { heading: "Controlla il piano",
    intro: "Autorizzi il lavoro descritto qui sotto e le verifiche previste, soltanto nel progetto indicato.",
    approveLabel: "Autorizza il piano" },
  resume: { heading: "Riprendi da dove eri rimasto",
    intro: "Confermi che la sessione precedente non sta più scrivendo. Questa sessione riprende lo stesso piano: non azzera tempi, spese registrate o verifiche già raccolte.",
    approveLabel: "Riprendi il lavoro" },
  install: { heading: "Prepara l'ambiente di lavoro",
    intro: "Crei i file dell'ambiente agentico elencati qui sotto. Questa conferma non avvia un client AI e non autorizza l'implementazione dell'applicazione.",
    approveLabel: "Prepara l'ambiente" },
  review: { heading: "Conferma la tua revisione",
    intro: "Apri i dettagli e controlla personalmente la relazione, le modifiche e i rilievi. Confermando dichiari risolti i problemi importanti o bloccanti di questa esatta revisione.",
    approveLabel: "Conferma la revisione" },
  "recover-installation": { heading: "Recupera la preparazione interrotta",
    goal: "Riconoscere la preparazione completata o liberare quella non applicata, senza ripetere operazioni.",
    intro: "Confermi che la vecchia preparazione si è fermata. Nei dettagli trovi se verrà riconosciuta un'installazione completata o liberata una prenotazione non applicata. Nessuno script viene rilanciato e nessun file eliminato.",
    approveLabel: "Conferma il recupero" },
  "accept-capsule": { heading: "Controlla le regole cambiate",
    goal: "Accettare le regole attuali del progetto dopo averle confrontate con quelle precedenti.",
    intro: "Apri i dettagli e confronta le regole precedenti con quelle attuali. Accetti il nuovo ambiente e liberi la precedente sessione di scrittura. Nessun piano di sviluppo viene approvato.",
    approveLabel: "Accetta le nuove regole" },
  "recover-writer": { heading: "Recupera la sessione di scrittura",
    goal: "Passare il controllo del progetto alla sessione attuale, senza avviare lo sviluppo.",
    intro: "Confermi che la sessione precedente non sta più scrivendo. Trasferisci soltanto il controllo cooperativo del progetto. Nessuna modifica al prodotto o esecuzione di test viene autorizzata.",
    approveLabel: "Recupera la sessione" },
  "recover-operation": { heading: "Controlla la verifica interrotta",
    goal: "Registrare la verifica interrotta come non verificata, dopo aver controllato che sia terminata.",
    intro: "Confermi di aver controllato gli effetti della verifica e che i suoi processi sono terminati. Il risultato resta non verificato: non viene trasformato in un successo e il comando non viene ripetuto.",
    approveLabel: "Registra il recupero" },
};

/** Human-readable fields and exact technical evidence travel in the same payload. */
export function confirmationView(input: ConfirmationInput) {
  const writes = input.kind === "plan" || input.kind === "resume";
  const paths = input.kind === "install" ? [...(input.paths ?? [])] : writes || input.kind === "review" ?
    [...new Set(input.plan.tasks.flatMap((task) => task.writeScopes))] : [];
  const quote = (arg: string) => /^[\w./:@=+-]+$/.test(arg) ? arg : JSON.stringify(arg);
  const mapped = input.membersByTask !== undefined && ["plan", "resume", "review", "recover-operation"].includes(input.kind);
  const commands = input.capsule.payload.gates.flatMap((gate) => {
    const command = gate.argv.map(quote).join(" ");
    if (!mapped) return [`${command}\nCartella relativa al repository di ciascuna attività: ${gate.cwd ?? "."}`];
    return input.plan.tasks.filter((task) => requiredGates(task, input.capsule).includes(gate.id)).map((task) => {
      const root = memberRoot(input.projectRoot, input.membersByTask![task.id] ?? ".");
      return `${command}\nCartella: ${gateWorkingDirectory(root, gate.cwd).replaceAll("\\", "/")}`;
    });
  });
  const policy = input.capsule.payload.policy;
  const risk = { low: "basso", medium: "medio", high: "alto" }[input.plan.risk];
  return {
    ...ACTIONS[input.kind], projectRoot: input.projectRoot, goal: ACTIONS[input.kind].goal ?? input.plan.request,
    scopeLabel: input.kind === "install" ? "File dell'ambiente da creare" :
      writes ? "File e cartelle che il piano può modificare" : "File del piano da consultare",
    paths,
    commandLabel: writes ? "Comandi di verifica autorizzati" : "Comandi del progetto (non eseguiti da questa conferma)",
    commands: [...new Set(commands)],
    limits: [`Rischio dichiarato nel piano: ${risk}. Non è una garanzia di sicurezza.`,
      `Orizzonte configurato: ${policy.timeboxMinutes} minuti dalla creazione del piano, non da questo clic.`,
      policy.maxRecordedCostUsd === null ? "Tetto di spesa registrata: non impostato." :
        `Tetto di spesa registrata: ${String(policy.maxRecordedCostUsd).replace(".", ",")} USD.`,
      "Costo effettivo e quote del provider: non misurati né controllati da Forgeyard."],
    deadlineAt: input.deadlineAt ?? null,
    boundary: "Questo clic non autorizza push, pubblicazioni, deploy o altre azioni esterne. " +
      "Non cambia account o abbonamenti e non avvia sessioni AI. I permessi del client restano separati; " +
      "gli ambiti sono controlli cooperativi, non un isolamento del sistema operativo.",
  };
}
