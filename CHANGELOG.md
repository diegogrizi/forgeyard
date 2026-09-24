# Changelog

Le modifiche rilevanti sono registrate qui. Il versionamento semantico si applica da
quando esistono release pubblicate.

## Non rilasciato

Ristrutturazione verso la tesi descritta in [Direzione](docs/DIREZIONE.md). Per lo stato
alla data, con la distinzione fra implementato, sul percorso e provato live, vedere
[Stato](docs/STATO.md).

### Aggiunto

- Le garanzie meccaniche come moduli con i propri test: scala dell'evidenza e citazioni
  vive (`src/evidence/`), scansione della deriva (`src/drift/`), contabilità dichiarata
  (`src/measure/`) e coerenza dell'imbracatura generata (`src/doctor/harness-lint.ts`).
- Il lint dell'imbracatura come gate su `buildInstallPlan`: ogni percorso di installazione
  lo attraversa, e un'imbracatura incoerente viene rifiutata prima di essere scritta. I
  byte di terze parti sono dichiarati ma non respingono l'installazione.
- Il certificato di consegna dichiara i livelli di evidenza del proprio supporto, il
  livello più debole e ciò su cui poggia in ultima istanza.
- **Un solo comando prepara una cartella dall'inizio alla fine**: ricognizione, una domanda
  di prodotto, una conferma, area personale, imbracatura, collegamento nativo. Ogni passo è
  dichiarato e alla riesecuzione vengono ripresi soltanto quelli mancanti. La regola «una
  sola domanda» è meccanica: il servizio di preparazione riceve un driver di prompt che
  rifiuta ogni domanda.
- Il certificato riporta una contabilità dichiarata. `forgeyard.yaml` accetta
  `measurement.humanBaseline`, e il certificato registra i valori usati con la loro
  impronta, così una modifica successiva non cambia un verdetto già emesso.
- Il doctor confronta il progetto con l'imbracatura congelata (controllo `harness-drift`),
  senza affondare il verdetto dell'installazione.
- `npm run install:local`: una riga installa il programma.
- `forgeyard rollback` senza argomenti annulla l'ultima operazione reversibile, che è
  l'unica che il sistema permette di annullare.

- Forgeyard guarda per la prima volta cosa il client fornisce già: un modulo in sola lettura
  interpreta il registro dei plugin, distingue le installazioni valide per questa cartella da
  quelle legate ad altri progetti, e l'anteprima le nomina prima della conferma. Un registro
  illeggibile resta `non osservato`, mai «zero plugin».

- Il profilo curato obbedisce alle regole di capacità. Installava i quattro orchestratori che le
  regole escludono come concorrenti di Forgeyard, perché le esclusioni vivevano solo nel
  percorso composto. Da 22 a 15 capacità, da 339 a 249 file, e due controlli che lo tengono
  fermo.

- L'anteprima dichiara quando il lavoro nativo **non potrà partire** nella cartella scelta.
  Un workspace con più repository riceveva l'imbracatura completa e poi rifiutava ogni
  `fy_attach` con `FY_GIT_REQUIRED`: preparata e inerte, senza che nessuno l'avesse detto
  prima della conferma.
- La stessa riga nomina ora il file giusto: `.git/info/exclude` dentro un repository, una
  regola in `.gitignore` fuori. Erano due file diversi chiamati con un nome solo.

### Corretto

- Le istruzioni sempre installate rimandavano a due seed che solo il pack `delivery`
  installa: con il profilo `minimal` la forgia consegnava percorsi inesistenti. Trovato
  dal lint dell'imbracatura al primo giro.
- Il binario instradava i comandi nativi su una seconda copia più corta dell'elenco: tre
  comandi documentati fallivano come sconosciuti.
- `atomicText` perdeva il rename per fallimenti transitori su Windows, e verificava
  l'impronta prima di una pubblicazione non atomica: due creazioni concorrenti potevano
  essere entrambe acconsentite con i byte di una sola. La pubblicazione di una creazione è
  ora esclusiva, con degradazione dove i link fisici non esistono.
- La liveness dei riferimenti di evidenza era implementata due volte; ne resta una.
- La scansione della deriva confrontava i percorsi protetti congelati con quelli osservati:
  una protezione è una politica, non un'osservazione, e ogni progetto correttamente
  preparato risultava in deriva. Confronto rimosso.
- Una risposta vuota alla domanda di prodotto annullava la preparazione. Ora fa tentare la
  sola evidenza del progetto, e soltanto se non basta dichiara che serve una descrizione.
- Le istruzioni generate citavano `forgeyard task`, `forgeyard workspace` e i worktree:
  in un'imbracatura installata sarebbero stati strumenti fantasma.

### Rimosso

- L'adapter Cursor. Il prodotto supporta Claude Code e Codex.
- Il profilo `full`, che installava l'intero catalogo senza scegliere niente.
- `README-LEGACY.md` e la pianificazione storica; il contenuto di riferimento ancora vero
  è in [percorsi-legacy](docs/percorsi-legacy.md).
- **Il secondo motore di esecuzione**, 4.715 righe: `orchestrator/`, `worktrees/`,
  `observability/`, `guard/` e i comandi `task`, `workspace`, `ledger`, `guard`. Due
  sistemi di attività significano zero autorità. Conservati il contratto di attività e le
  ricevute di verifica.
- **Il pacchetto presentazione**: `packs/presentation/`, i due auditor, la skill
  `forgeyard-showcase`, l'attività T004, la sezione `presentation` della configurazione, gli
  undici slot nei due adapter e i golden. La sua unica garanzia utile sopravvive come regola
  generale `content.remote-asset`: nessun file web generato chiama la rete, guard compreso.
- **Il registro a catena** (`src/ledger/`, 1.065 righe con i suoi test). Era elencato fra i
  moduli e verificato dai propri test, ma nessun percorso del prodotto lo attraversava e non
  era una delle sei garanzie: un «registro di eventi verificabile» che nessuno scrive è
  esattamente la raccolta di intenzioni da cui questo prodotto dice di distinguersi. La tesi
  del registro contabile resta, ed è realizzata dalla scala dell'evidenza e dalla contabilità,
  che invece sono sul percorso.
- `src/adapters/adapter.ts`: un alias di tipo che nessuno importava.
- Il ramo legacy del write-guard, che era il più permissivo dei due percorsi che
  proteggono la stessa cosa. Ora l'assenza di un work order nativo nega, non degrada.

## 0.1.0 - 2026-09-15

> **Nota aggiunta il 22 settembre 2026.** Questa voce descrive uno stato **mai
> pubblicato** e superato dalla ristrutturazione qui sopra: l'adapter Cursor e il profilo
> `full` non esistono più, e i conteggi di file installati che cita non sono più
> raggiungibili da nessun profilo. Il corpo non è stato modificato, perché resta il
> registro di ciò che fu costruito allora.

### Added

- Problem-first `inspect` and `prepare` commands that read bounded repository evidence, infer project type and quality commands, select a minimal coherent capability set, preserve existing host instructions, and pin an explainable tailored suite.
- Project-specific task contracts and `task next` work orders containing the actual request, role, capabilities, scopes, acceptance criteria, verification argv, time/cost state, stable worker identity, and exact host prompt.
- A generated natural-language workflow controller that resolves product ambiguity, uses guided or host-native dispatch, and keeps internal skills and lifecycle commands out of ordinary user interaction.
- Validated usage-ledger summaries and durable per-task cost-budget stops that distinguish absent measurement from measured zero.
- A Node.js CLI with lifecycle, verification, resumable task, usage-ledger, write-guard, and Git-workspace commands with stable plain or JSON output.
- `minimal`, curated `hackathon`, and complete `full` profiles with deterministic local selection and a default concurrency cap of four.
- A pinned MIT portable catalog containing 1,007 source files, 211,594 physical lines, 202 agents, 183 native skills, 105 commands, and supporting references.
- A Codex catalog adapter that renders namespaced agents and skills, converts commands to skill entrypoints, splits oversized instructions safely, and leaves unsupported hooks disabled.
- A Claude Code adapter with native project agents, skills, commands, `CLAUDE.md`, and safe project settings that disable implicit skill shell expansion.
- A Cursor adapter with compact agent-requested MDC rules backed by complete local instruction files and explicit reporting for unenforced agent policies.
- Transactional install, hash-aware update, operation-scoped rollback, seed preservation, ownership conflict detection, and automatic reversal after failed post-write checks.
- Clean-Git verification receipts bound to the exact task bytes, argv array, and Git revision without persisted stdout or stderr bodies.
- A persistent dependency-aware task scheduler with claims, checkpoints, resume, retry and time stops, overlapping-scope prevention, and a default concurrency cap of four.
- Deterministic task write guards, including an original Claude Code `PreToolUse` file-tool hook and an advisory CLI contract for Codex and Cursor.
- Real Git task worktrees with frozen bases, independent validation, owner-token serialized integration, combined-tree verification, conflict-safe aborts, exact revision-bound post-merge cleanup, dead-owner lock recovery, and an idempotent cleanup recovery command.
- A 300-minute visible-slice DAG that allocates 90 minutes to the first journey, 135 to reliability, 30 to independent review, and 45 to the demo freeze.
- Project brief, durable knowledge policy, decision, handoff, explicit usage, and revision-bound run-report assets with seed-aware rollback behavior.
- An original ten-slide offline presentation pack with keyboard, pointer, responsive, reduced-motion, and print behavior.
- Structural, content, presentation, provenance, adversarial filesystem, real-Git, golden, and built-CLI round-trip tests.
- Deterministic third-party notices and an SPDX 2.3 software bill of materials generated from the complete npm lock graph and verified vendor attestations.
- Catalog byte, license, package-content, path-safety, collision, profile, full-render, and documentation-drift gates.
- A clean acceptance run covering 61 test files and 343 tests, followed by build, catalog, provenance, release, and package-content audits. The dry-run npm package contains 1,167 entries (about 2.21 MB compressed and 8.31 MB unpacked).

### Limits

- Task execution and evidence handling are local CLI services; Forgeyard coordinates workers but does not itself launch an LLM runtime or paid model processes.
- Provider usage is enforced only when an explicit observation is recorded; unavailable usage remains visibly unmeasured.
- Host-client invocation is reported as unavailable or skipped unless separately and explicitly verified.
