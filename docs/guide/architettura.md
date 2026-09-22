# Architettura

La mappa dei moduli e i confini che rispettano. L'architettura di arrivo, e il motivo per
cui è quella, sono in [Direzione](../DIREZIONE.md); qui c'è come si legge il codice che
esiste oggi. Questo branch è in ristrutturazione: la sezione sui moduli in uscita non è
una nota storica, sono percorsi ancora presenti nel checkout.

## Moduli del nucleo

| Modulo | Responsabilità |
|---|---|
| `src/core/` | impronte, percorsi portabili, errori, contratti condivisi |
| `src/workspace/` | ricognizione in sola lettura, area personale, ingresso unico |
| `src/intake/` | ispezione, evidenza, requisiti, regole di capacità, composizione |
| `src/capsule/` | identità congelata dell'imbracatura (G1) |
| `src/adapters/` | rendering per `claude-code` e `codex` |
| `src/installer/` | piano, applicazione, aggiornamento e rollback transazionali |
| `src/native/` | runtime MCP cooperativo, protocollo, gate, binding nativi, stato privato |
| `src/evidence/` | ricevute, scala epistemica (G2), citazioni vive (G3) |
| `src/drift/` | scansione imbracatura contro codice (G4) |
| `src/measure/` | contabilità di costo e tempo contro una linea di base dichiarata (G5) |
| `src/doctor/` | controlli strutturali e lint dell'imbracatura (G6) |
| `src/registry/` | caricamento e risoluzione dei pack |
| `src/catalog/` | lettura del catalogo portabile e del suo frontmatter |
| `src/provenance/` | SBOM, notices, attestazione del vendor |
| `src/cli/` | superficie a riga di comando |

La tabella descrive responsabilità, non attivazione. `src/drift/` e `src/measure/`
esistono con i loro test ma non sono ancora chiamati da un percorso ordinario: quale
garanzia sia attiva e quale no è registrato, con la sua data, in [Stato](../STATO.md).

## Un motore solo

Il secondo ciclo di vita è stato rimosso il 22 settembre 2026: `src/orchestrator/`,
`src/worktrees/`, `src/observability/` e `src/guard/` non esistono più, con i comandi
`task`, `workspace`, `ledger` e `guard`. Restano nel checkout, come percorsi avanzati e
non come tutorial, i comandi `inspect`, `prepare`, `init`, `doctor`, `verify`, `update` e
`rollback`, più il pacchetto presentazione. Vedere
[Percorsi legacy](../percorsi-legacy.md) e [Stato](../STATO.md).

## I confini

**Un ingresso.** `forgeyard` senza argomenti è l'ingresso ordinario. La ricognizione
diagnostica e le operazioni del protocollo sono strumenti interni o avanzati, non passi
del tutorial. Non si aggiungono alias o nuove famiglie di comandi per nascondere percorsi
duplicati: si converge su un percorso.

**Una regola, una sede.** Il gate di coerenza sta dentro la costruzione del piano di
installazione, non in ogni comando che installa. La scala dell'evidenza sta in un modulo,
e chi emette un verdetto la importa. Una regola enunciata in due file divergerebbe, e il
consumatore più permissivo diventerebbe il contratto reale.

**Il nucleo non chiama modelli.** Nessuna chiamata a un provider, nessuna lettura di
credenziali, nessun avvio di client AI, nessuna telemetria. Il runtime possiede soltanto
gate finiti; il client nativo possiede conversazioni, subagent, interruzione, permessi e
quote.

**I percorsi sono confinati.** Il rendering è deterministico, i percorsi generati non
lasciano il progetto, i collegamenti simbolici non vengono attraversati nella ricognizione
né seguiti nelle citazioni, e gli alberi del catalogo rifiutano traversal, link, collisioni
per differenza di sole maiuscole e deriva dei byte prima di essere resi.

**La proprietà dei file è dichiarata.** Le impronte dei file gestiti stanno nel manifest
dell'installazione; aggiornamento e rollback si fermano su un conflitto di proprietà se un
file gestito è cambiato o se una destinazione ignota verrebbe sostituita. I file seme
umani non vengono sovrascritti, e il rollback li conserva.

**Lo stato privato sta fuori dall'albero di lavoro.** Stato di esecuzione, eventi e
idempotenza vivono in un SQLite privato fuori dal working tree e dalla directory Git
comune. La fabbrica non serializza credenziali, trascritti o metadati di sessione negli
artefatti di prodotto.

**La forgia non entra nei commit del software.** L'area personale scrive soltanto nella
propria directory, con un'esclusione interna che rende privata anche la propria regola.
Per una root Git si preferisce `info/exclude` alla modifica del `.gitignore` condiviso, e
un file già tracciato non viene reso privato da una regola di esclusione: il programma si
ferma.

**Un solo writer.** Un albero di lavoro ha un writer cooperativo; le altre sessioni
leggono. La concorrenza configurata è un limite di pianificazione, non una promessa di
capacità di sessioni native, e nessun livello di abbonamento viene inferito.

**Cooperativo non è isolamento.** Lease e controlli proteggono da una collisione tra
processi che collaborano, non da un altro processo con gli stessi privilegi. Le
autorizzazioni dei prompt esprimono un'intenzione; non sono isolamento del sistema
operativo.

## Le due imbracature

Il prodotto supporta **Claude Code** e **Codex**. `HARNESS_IDS` ha due valori, quindi un
adapter non selezionabile è un errore di compilazione e non un percorso morto. Una
installazione ha per obiettivo una imbracatura.

| Capacità | Codex | Claude Code |
|---|---|---|
| Istruzioni radice | `AGENTS.md` | `CLAUDE.md` |
| Skill | `.agents/skills/` native | `.claude/skills/` native |
| Agenti | definizioni TOML in `.codex/agents/` | subagent Markdown in `.claude/agents/` |
| Comandi | convertiti in skill con namespace | `.claude/commands/` nativi |
| Modello per agente | mappatura dell'adapter | preservato |
| Strumenti per agente | euristica sola-lettura o workspace | preservati |
| Hook importati dal catalogo | disattivati | disattivati |
| Guardia sulle scritture | `forgeyard guard`, contratto consultivo | `PreToolUse` nativo per gli strumenti sui file, più la CLI |
| Avvio di worker del modello | non supportato | non supportato |

Gli hook e i campi hook del catalogo di terzi non vengono attivati: sono catalogati e
lasciati disattivati, invece di essere simulati in silenzio. Nei progetti Claude Code il
`.claude/settings.json` di progetto imposta **`disableSkillShellExecution`** a `true`,
così la preparazione di una skill non può eseguire espressioni di shell incorporate;
abilitarlo richiederebbe una policy esplicita futura.

La guardia originale di Forgeyard per Claude Code intercetta `Edit`, `Write` e
`NotebookEdit`, lega la sessione dell'hook all'attività attiva, risolve gli antenati
esistenti del percorso per impedire una fuga via link, e nega identità ambigue, uscite dal
progetto, percorsi protetti e percorsi fuori dall'ambito. Un risultato consentito non
emette un'approvazione, quindi i permessi normali del client continuano a valere. I
comandi di shell arbitrari **non** sono dichiarati deterministicamente protetti: analizzare
ogni mutazione possibile di una shell non sarebbe sicuro.

## Il catalogo non è il prodotto

Forgeyard distribuisce uno snapshot pinnato e attestato di un catalogo di terzi: **202
agenti, 183 skill e 105 comandi**. È conoscenza della fabbrica, non un menù da studiare
prima di iniziare, e non un obiettivo di crescita. La provenienza esatta e il confine di
verifica sono in [Provenienza del catalogo](../provenance/catalog-sources.md).

La dimensione del catalogo non è la dimensione del prompt. Il caricamento è progressivo:
le istruzioni radice restano una mappa breve; il client scopre prima nomi e descrizioni
compatti; il corpo di una skill entra in contesto soltanto quando quella skill viene
selezionata; una skill può poi puntare a riferimenti focalizzati. I file primari generati
hanno un tetto di 8 KiB, e le istruzioni upstream più lunghe vengono spezzate fuori dai
blocchi di codice recintati e collegate come riferimenti.

Un file di agente è un contratto di ruolo, non un processo. Installare duecento ruoli non
avvia duecento modelli, terminali o worktree.

## Verifica strutturale e verifica reale

`forgeyard doctor` valida percorsi, sintassi, riferimenti, impronte dei file gestiti e
indice del catalogo. Controlla se `codex` o `claude` sono individuabili, senza invocarli.
Il confronto fra profilo congelato e profilo corrente (G4) esiste come modulo ma **non è
ancora collegato** a questo rapporto.

Questo è tutto ciò che quel controllo dice. **Una verifica strutturale non è una sessione
autenticata con un client reale.** Vedere [Stato](../STATO.md) per il confine, e
[SECURITY.md](../../SECURITY.md) per il modello di minaccia.
