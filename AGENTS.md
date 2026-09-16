# Forgeyard — istruzioni per lo sviluppo

Forgeyard deve diventare una forgia personale: programma installato una volta sul PC, richiamabile in un workspace vuoto, in un repository o sopra piu repository. La conversazione rimane nelle app/CLI native di Claude Code e Codex. Il nucleo non chiama modelli, non legge credenziali e non avvia altri client AI.

## Direzione approvata

Leggere [il piano della forgia personale](docs/forgia-personale/PIANO.md) prima di modificare i confini del prodotto. Il piano distingue il comportamento implementato dalle fasi successive: non descrivere come gia funzionante l'intero percorso multi-repository.

- Scrivere documentazione, nuovi messaggi utente, istruzioni first-party e commenti utili in italiano. Conservare identificatori tecnici e chiavi di protocollo; non tradurre licenze o contenuti di terzi.
- Supportare Claude Code e Codex come obiettivo del prodotto. Cursor e i profili legacy rimangono solo finche la migrazione non ne elimina in sicurezza i riferimenti; non ampliarli.
- Lavorare per incrementi verificabili: prima test, poi implementazione minima. Non riscrivere il progetto da zero e non creare un secondo motore parallelo.
- Separare workspace, repository membri e directory privata della forgia. Non eseguire git init nella cartella padre per aggirare l'assenza di un repository.
- La suite personale non deve essere committata nei repository assistiti. Non modificare file gia tracciati per installarla; usare esclusioni Git locali soltanto per percorsi posseduti e non tracciati. Non usare assume-unchanged o skip-worktree.
- Preservare rendering deterministico, confinamento dei percorsi, proprieta dei file, recupero transazionale ed evidenze legate ai contenuti verificati.
- Non aggiungere telemetria, effetti esterni automatici o promesse di isolamento del sistema operativo. Push, issue remote e deploy richiedono autorizzazione.
- Conservare byte e attribuzioni dei componenti esterni. Nessuna esecuzione di hook/script durante la ricognizione. Nessuna modifica della licenza in questo refactoring.
- Non modificare lockfile o dipendenze per adattarli incidentalmente all'ambiente di sviluppo. Se cambiano, rigenerare anche provenienza e avvisi.
- Non committare log locali, credenziali, output di test, target di prova o stato operativo personale.
- Prima di dichiarare un incremento verificato, eseguire i suoi test, npm run verify e git diff --check. Distinguere test locali, CI e prove reali nelle app. Un controllo non eseguibile va dichiarato, non simulato.
