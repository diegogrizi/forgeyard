# Stato della convergenza personale

## Incrementi presenti nel codice

- P0: corretta la dipendenza dello SBOM dai pacchetti opzionali installati. La CI controlla Linux e Windows; non rigenera i risultati attesi durante la verifica. Nessuna dipendenza o licenza modificata.
- P1: ricognizione in sola lettura, topologia del workspace e rilevazione dei manifest per membro.
- P2a: ingresso ordinario senza argomenti, riepilogo italiano, conferma unica, registrazione sotto .forgeyard, esclusione privata, ripetizione senza riscrittura e recupero rispettoso dei file.

La correzione dello SBOM ha superato l'intero npm run verify e i controlli Windows nel commit c713e1faf06cf69368acc5d2ffcd75f1798a1b85. La prima implementazione P2a ha superato gli stessi controlli nel commit bf07e94c43e042dc454a7595d7138e720edc85fa. Ulteriori test di recupero sono stati aggiunti in f0ae43a9d4d4574d8e407a8cfc52521733627572. Per l'esito del commit corrente consultare la CI della PR, non riutilizzare queste attestazioni per revisioni diverse.

## Confine intenzionale

L'area personale non è ancora una capsula completa: lo stato è not-connected. Non presentare il solo workspace.json come una suite agentica pronta. Non chiamare il vecchio connect/prepare sull'area nuova: quelle funzioni hanno ancora assunzioni di singolo repository e proprie regole di proprietà.

Il README principale e la guida personale sono in italiano e mostrano il solo ingresso normale. Il precedente README resta come README-LEGACY.md: è documentazione di manutenzione, non la guida del nuovo utente. Il contenuto e la licenza del vendor restano invariati.

## Prossimo incremento da eseguire

Completare P2/P3 riusando il motore di composizione e preparando collegamenti personali reali per Claude Code/Codex, senza modificare file tracciati. Prima di dichiarare pronto un client occorre verificare la discovery effettiva e distinguere strumenti disponibili da istruzioni soltanto presenti su disco. Lo stato multi-repository e i gate sul working tree richiedono ancora P5: non basta eliminare la precondizione HEAD dalle vecchie funzioni.

P4 copre inventario e riuso dei componenti già presenti. P6 unifica selezione e profili pertinenti. P7 rimuove i percorsi legacy e completa l'italiano, senza introdurre un altro runtime o altri comandi ordinari.

Nessuna prova live con account Claude o Codex è stata eseguita in questi incrementi. La PR rimane in bozza e main non viene unito automaticamente.
