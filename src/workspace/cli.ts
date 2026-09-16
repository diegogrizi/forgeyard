import { parseArgs } from "node:util";
import { discoverWorkspace, WorkspaceDiscoveryError, type WorkspaceDiscovery } from "./discovery.js";

export interface WorkspaceCliIo { writeOut(text: string): void; writeErr(text: string): void }
const output: WorkspaceCliIo = {
  writeOut: (text) => { process.stdout.write(text); },
  writeErr: (text) => { process.stderr.write(text); },
};
const HELP = `Uso: forgeyard analizza [cartella] [--json]

Ricognizione in sola lettura della cartella corrente o indicata.
Distingue repository, worktree, submodule e progetti rilevati dai manifest.
Non installa la forgia, non inizializza Git e non esegue script del progetto.

  --json      Restituisce la topologia e gli eventuali limiti in JSON.
  -h, --help  Mostra questo aiuto.
`;
const WARNINGS: Readonly<Record<string, string>> = {
  "invalid-git": "metadati Git non validi o non accessibili",
  "FY_GIT_UNAVAILABLE": "Git non disponibile nel PATH",
  "symlink-skipped": "collegamento simbolico non seguito",
  "invalid-manifest": "manifest non valido",
  "unreadable-manifest": "manifest non leggibile",
  "unreadable-directory": "cartella non leggibile",
  "unsafe-name": "nome non rappresentabile in sicurezza",
  "changed-path": "percorso cambiato durante la scansione",
  "changed-input": "file cambiato durante la scansione",
  "manifest-size-limit": "manifest oltre il limite di dimensione",
  "manifest-byte-limit": "limite di lettura dei manifest raggiunto",
  "entry-limit": "limite di elementi raggiunto",
  "directory-limit": "limite di cartelle raggiunto",
  "depth-limit": "limite di profondità raggiunto",
  "repository-limit": "limite di repository raggiunto",
  "warning-limit": "ulteriori avvisi omessi",
};
const KINDS: Readonly<Record<WorkspaceDiscovery["kind"], string>> = {
  empty: "cartella vuota", directory: "cartella di lavoro", repository: "repository Git", "multi-repository": "workspace con più repository",
};

export function formatWorkspace(result: WorkspaceDiscovery): string {
  const lines = [
    "Forgeyard — analisi del workspace (sola lettura)",
    `Cartella: ${result.root}`, `Tipo: ${KINDS[result.kind]}`,
    `Scansione: ${result.scan.status === "complete" ? "completa entro le esclusioni dichiarate" : "parziale: leggere gli avvisi"}`,
    `Repository rilevati: ${result.repositories.length}`,
    ...result.repositories.map((repo) => `  ${repo.path} (${repo.kind})`),
    `Progetti rilevati: ${result.projects.length}`,
    ...result.projects.map((project) => `  ${project.path}: ${[...project.languages, ...project.frameworks].join(", ") || "manifest presente, stack non determinato"}`),
  ];
  if (result.containingRepository) lines.push(`Repository esterno alla cartella selezionata: ${result.containingRepository}`);
  lines.push(`Cartelle escluse: ${result.scan.excludedDirectories} (dipendenze, output e configurazioni personali).`);
  for (const warning of result.warnings) lines.push(`Avviso: ${WARNINGS[warning.code] ?? warning.code} — ${warning.path}`);
  lines.push("Nessun file modificato. Questa ricognizione non installa né attiva il workflow agentico.");
  return `${lines.join("\n")}\n`;
}

/** Ingresso diagnostico nel binario esistente, riutilizzabile dal futuro wizard. */
export async function runWorkspaceCli(args: readonly string[], io: WorkspaceCliIo = output): Promise<number> {
  let target: string; let json = false;
  try {
    const parsed = parseArgs({ args: [...args], allowPositionals: true, strict: true,
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
    json = parsed.values.json === true;
    if (parsed.positionals.length > 1) throw new Error("too many roots");
    if (parsed.values.help) { io.writeOut(HELP); return 0; }
    target = parsed.positionals[0] ?? ".";
  } catch {
    const error = { code: "FY_WORKSPACE_ARGUMENTS", message: "Argomenti non validi. Usa forgeyard analizza --help." };
    // Solo gli argomenti prima di -- sono opzioni: una cartella chiamata --json non lo è.
    const boundary = args.indexOf("--");
    if (args.slice(0, boundary < 0 ? args.length : boundary).includes("--json")) io.writeOut(`${JSON.stringify({ ok: false, error })}\n`);
    else io.writeErr(`${error.message}\n`);
    return 2;
  }
  try {
    const workspace = await discoverWorkspace(target);
    io.writeOut(json ? `${JSON.stringify({ ok: true, workspace }, null, 2)}\n` : formatWorkspace(workspace));
    return 0;
  } catch (cause) {
    const error = cause instanceof WorkspaceDiscoveryError ? { code: cause.code, message: cause.message }
      : { code: "FY_WORKSPACE_INSPECTION", message: "Analisi non riuscita. Controlla cartella e permessi." };
    if (json) io.writeOut(`${JSON.stringify({ ok: false, error })}\n`);
    else io.writeErr(`${error.message}\n`);
    return 4;
  }
}
