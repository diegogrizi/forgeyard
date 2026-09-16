# Convergenza verso la forgia personale

Baseline: commit 7f198e12f2eafadb2ec7d26640d4f497caa56bf5. Branch di lavoro: refactor/forgia-personale-workspace. Direzione approvata dal proponente il 16 settembre 2026. Nessun merge automatico in main.

## Contratto del prodotto

Un programma locale installato una volta prepara il workspace indicato dall'utente. Il workspace puo essere vuoto, coincidere con un repository Git o contenere piu repository indipendenti. Lo sviluppatore apre quella stessa cartella in Claude Code o Codex e parla del lavoro: la suite prepara contesto, capacita e metodo senza imporre una seconda chat. I client mantengono account, sessioni, permessi e quote.

La forgia e personale: i suoi file non devono accompagnare il software nei commit. Task e piani sono locali; issue su GitHub, push e deploy sono azioni esterne separate. Il catalogo puo evolvere, ma non modifica implicitamente gli ambienti gia composti. Riusare un plugin globale richiede rilevarne disponibilita e versione effettive, non soltanto il nome.

## Vincolo UX: un ingresso, nessuna sequenza da ricordare

Dopo l'installazione una tantum del programma sul PC, l'ingresso ordinario previsto e `forgeyard`, eseguito nella cartella su cui si vuole lavorare. Il comando senza argomenti deve guidare la preparazione in italiano: rileva prima, chiede soltanto decisioni non ricavabili e mostra una conferma comprensibile. Questa e la specifica da realizzare in P2, non una dichiarazione che il comportamento sia gia implementato nel binario attuale.

Nell'uso quotidiano l'utente apre quella cartella nel proprio Claude Code o Codex e conversa. Non deve eseguire nuovamente il setup a ogni chat, avviare manualmente un server o sequenziare comandi per analisi, composizione, installazione, pianificazione, claim, verifica e ripresa.

Se la forgia esiste gia, lo stesso ingresso riconosce lo stato e offre, quando serve, poche azioni descritte in italiano. Non reinstalla, non aggiorna la capsula e non modifica i plugin globali soltanto perche e stato richiamato. La normale ripresa resta possibile dalla conversazione nativa.

I comandi diagnostici e le operazioni del protocollo sono strumenti interni o avanzati, non passi obbligatori del tutorial. In particolare `forgeyard analizza` e una superficie diagnostica di P1: non deve diventare il primo di molti comandi richiesti per preparare un progetto. L'interfaccia finale deve riutilizzare la stessa ricognizione automaticamente. Non aggiungere alias o nuove famiglie di comandi per nascondere percorsi duplicati: convergere su un solo percorso.

Autorizzazioni e fiducia richieste dal client restano esplicite: un ingresso semplice non deve aggirarle o dichiarare l'integrazione pronta senza un collegamento funzionante. Errori e recupero devono indicare un'azione comprensibile; i dettagli tecnici rimangono ispezionabili senza doverli memorizzare.

Criteri di accettazione UX:
- Da un workspace nuovo, l'utente prepara la forgia con il solo ingresso `forgeyard`, oltre alle eventuali autorizzazioni native, senza scegliere skill, autori o orchestratori.
- Alla successiva apertura nel client, una richiesta in linguaggio naturale avvia o riprende il percorso senza comandi manuali di lifecycle.
- La stessa esperienza vale per root Git e contenitore multi-repository; non si chiede all'utente di scegliere una sequenza diversa.
- Guida rapida, wizard e messaggi ordinari non prescrivono successioni di comandi diagnostici/interni.

## Che cosa contiene la cartella .forgeyard/

`.forgeyard/` e una directory, non un file eseguibile ne una seconda applicazione completa da copiare in ogni repository. Contiene o referenzia l'ambiente specifico del workspace: mappa dei progetti, composizione congelata, regole, skill pertinenti e informazioni persistenti di lavoro. La posizione del ledger privato del programma resta separata quando richiesto dai vincoli di sicurezza.

Il comportamento nasce dalla collaborazione di tre parti: il programma Forgeyard installato sul PC esegue le operazioni locali; i file e riferimenti del workspace descrivono il contesto e il metodo; Claude Code o Codex ragiona e usa i propri strumenti nella conversazione. Le istruzioni non addestrano un nuovo modello e non eseguono codice da sole.

Il collegamento con il client e indispensabile. Una directory arbitraria chiamata .forgeyard non viene automaticamente riconosciuta dai coding agent. P3 deve predisporre punti d'ingresso e configurazioni native supportate, con pochi riferimenti al contenuto locale e, dove serve, un servizio MCP locale avviato dal client. Non richiedere all'utente un secondo terminale da tenere aperto. Non promettere che basti un unico file fisico: possono servire piccoli file nelle posizioni previste dal client, sempre con proprieta e privacy esplicite.

Non duplicare necessariamente tutte le skill nel workspace: riusare componenti esistenti quando effettivamente disponibili e compatibili, registrando provenienza e drift. La selezione congelata non diventa immutabile se i suoi riferimenti globali possono cambiare senza rilevazione.

Il modello mentale dell'utente resta semplice: programma una volta sul PC; imbracatura locale del workspace; conversazione nel coding agent; soltanto codice e artefatti del prodotto nei commit autorizzati.

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
