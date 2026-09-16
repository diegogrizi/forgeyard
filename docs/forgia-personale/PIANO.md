# Convergenza verso la forgia personale

Baseline: commit 7f198e12f2eafadb2ec7d26640d4f497caa56bf5. Branch di lavoro: refactor/forgia-personale-workspace. Direzione approvata dal proponente il 16 settembre 2026. Nessun merge automatico in main.

## Contratto del prodotto

Un programma locale installato una volta prepara il workspace indicato dall'utente. Il workspace puo essere vuoto, coincidere con un repository Git o contenere piu repository indipendenti. Lo sviluppatore apre quella stessa cartella in Claude Code o Codex e parla del lavoro: la suite prepara contesto, capacita e metodo senza imporre una seconda chat. I client mantengono account, sessioni, permessi e quote.

La forgia e personale: i suoi file non devono accompagnare il software nei commit. Task e piani sono locali; issue su GitHub, push e deploy sono azioni esterne separate. Il catalogo puo evolvere, ma non modifica implicitamente gli ambienti gia composti. Riusare un plugin globale richiede rilevarne disponibilita e versione effettive, non soltanto il nome.

## Ordine degli incrementi

| ID | Obiettivo | Criterio di accettazione |
|---|---|---|
| P0 | Baseline e verifiche riproducibili | CI senza account AI; limiti dell'ambiente espliciti. |
| P1 | Ricognizione read-only del workspace | Distinguere cartella, repository e repository figli; rilevare manifest per membro; nessuna scrittura o esecuzione di script del progetto. |
| P2 | Installazione personale | Un ingresso guidato; anteprima; suite locale; file tracciati e repository figli preservati; rollback ownership-safe. |
| P3 | Binding nativi del workspace | Claude e Codex leggono la suite aprendo la root scelta; prove reali nelle rispettive app/CLI; nessun caricamento padre presunto quando si apre direttamente un figlio. |
| P4 | Riuso dell'ambiente esistente | Inventario read-only di plugin/skill effettivi; deduplicazione per origine/contenuto; drift visibile; nessuna lettura di segreti. |
| P5 | Esecuzione su uno o piu membri | Piani e verifiche per repository, anche sul working tree; nessun commit obbligatorio; un writer cooperativo; niente merge impliciti. |
| P6 | Selezione unica e profili pertinenti | Unificare regole e resolver; Java/Spring, JS/TS, React, Angular, C++; integrazione LLM come competenza del progetto, non provider della factory. |
| P7 | Italiano e rimozione legacy | Percorso normale interamente italiano; dismettere Cursor, profili full/hackathon e presentazioni dal nucleo solo dopo migrazione dei riferimenti. |

Non implementare tutti gli incrementi in una riscrittura. Ogni incremento deve lasciare una differenza piccola, testabile e rivedibile. I numeri del catalogo non sono un obiettivo di crescita.

## Primo incremento di codice (P1)

Aggiungere un comando diagnostico in italiano `forgeyard analizza [cartella]`. E una ricognizione, non una nuova installazione alternativa a prepare/connect. Il comando espone la topologia da riutilizzare nei successivi P2/P5. Non deve gia promettere orchestrazione multi-repository.

File previsti:
- src/workspace/discovery.ts: topologia, confini Git e manifest, con scansione limitata.
- src/workspace/cli.ts: ingresso diagnostico e formattazione in italiano.
- src/cli/main.ts: collegamento al binario esistente senza cambiare i comandi legacy.
- tests/unit/workspace/discovery.test.ts: cartelle vuote, repository singolo, multi-repository, sottocartelle, worktree/submodule, limiti, link e metadati Git invalidi.
- tests/unit/workspace/cli.test.ts e tests/roundtrip/workspace-inspection.test.ts: input rigoroso, JSON e comando dal pacchetto compilato.

La rilevazione per manifest e distinta da competenza verificata: trovare angular.json o package.json non certifica una integrazione. Una scansione limitata deve dichiarare cosa non ha visitato. Nessuna raccolta dei file .env, delle chiavi o dei valori di configurazione personale.

## Vincoli di migrazione

P1 non cambia il vecchio workspaceIdentity: togliere soltanto il controllo Git romperebbe snapshot, gate e ripresa senza sostituirli. P2 non deve inserire istruzioni che dichiarino attivo un servizio multi-repository ancora assente. P3 deve provare le regole reali di discovery dei client. P5 deve sostituire le assunzioni HEAD/root del servizio con stati per membro; nessun git init artificiale del contenitore.

Per una root Git, preferire info/exclude alla modifica del .gitignore condiviso. Un file gia tracciato non viene reso personale aggiungendo un'esclusione. I collegamenti necessari al client devono essere locali e preservare le configurazioni esistenti.

## Conferma della direzione

La domanda guida e: apro il mio workspace in Claude/Codex, chiedo una modifica e consegno soltanto il software? Qualsiasi aggiunta che richieda di conoscere autori di skill, profili universali o nuove chat va motivata rispetto a questa esperienza. L'inventario globale e i comandi interni sono meccanismi della factory, non compiti da imporre allo sviluppatore.
