# Forgeyard — istruzioni per lo sviluppo

Forgeyard è una **forgia personale**: un programma installato una volta sul PC, richiamabile
in una cartella vuota, in un repository o sopra più repository. La conversazione resta nelle
app e nelle CLI native di **Claude Code** e **Codex**. Il nucleo non chiama modelli, non legge
credenziali e non avvia altri client AI.

Prima di modificare i confini del prodotto, leggi [la direzione](docs/DIREZIONE.md). Per sapere
cosa è implementato e cosa no, leggi [lo stato](docs/STATO.md), che tiene distinti tre livelli:
**implementato**, **sul percorso ordinario**, **provato live**.

---

## 🎯 La tesi, in una riga

> Forgeyard non è una collezione di competenze. È il **registro contabile** del lavoro agentico:
> prepara l'ambiente, e poi tiene i conti di ciò che quell'ambiente afferma.

Ne discende il criterio di progetto che governa ogni scelta tecnica di questo repository:

> **Quando una regola può diventare una proprietà del tipo o un controllo eseguibile, non va
> scritta in prosa.** La prosa resta per spiegare il perché.

---

## 🧭 Le regole che non si negoziano

### Una regola, una sede

Se una regola è enunciata in due file, **divergeranno** — e il consumatore più permissivo
diventa il contratto reale. È già successo due volte in questo repository: il binario
instradava i comandi nativi su una seconda copia più corta dell'elenco, e il write-guard aveva
un ramo legacy più debole del percorso nativo. In codice: la regola vive in un modulo, gli
altri la importano.

Corollario: **un controllo deve avere la granularità del contratto che protegge.** Verificare
che un file esista non protegge da un controllo assente *dentro* quel file.

Quando la duplicazione è **inevitabile**, la regola va fissata da un test, non da un commento.
Il guard di scrittura non può importare il servizio, e ricevere l'identità del workspace da un
file dentro il progetto la renderebbe falsificabile: quell'identità è quindi calcolata due
volte per necessità. Le due sedi hanno usato due risolutori di percorso diversi, e il guard ha
negato **ogni** scrittura finché un test non le ha legate. Una duplicazione necessaria non è
un'eccezione alla regola: è la regola che richiede un controllo eseguibile al posto della
disciplina.

### Un ingresso, nessuna sequenza da ricordare

L'ingresso ordinario è `forgeyard`, senza argomenti. L'utente non deve scegliere profili,
autori di skill o orchestratori, e non deve imparare un ordine di invocazione. Ogni aggiunta
che richieda di ricordare un comando in più va motivata rispetto a questa esperienza.

I comandi avanzati restano ispezionabili, ma **non sono il tutorial**.

### Onestà delle evidenze

- Un'inferenza non viene mai presentata come evidenza verificata.
- Un test strutturale non viene mai presentato come prova live con un client.
- **Un controllo non eseguibile va dichiarato, non simulato.**
- Una misura assente resta `unmeasured`. Mai zero, mai una stima plausibile.

### Confini di scrittura

- Workspace, repository membri e directory privata della forgia restano separati.
- Mai `git init` nella cartella padre per aggirare l'assenza di un repository.
- La suite personale non va committata nei repository assistiti. **Nessun percorso di macchina
  entra in un file già tracciato**: la configurazione del client viene rifiutata se lo è
  (`FY_BINDING_TRACKED`). Un blocco portabile e delimitato può invece essere aggiunto in coda a
  un file di istruzioni già presente, anche tracciato, perché è committabile senza danno ed è
  reversibile — ma va **dichiarato nell'anteprima prima della conferma**, insieme a ogni altra
  scrittura fuori da `.forgeyard`. Un effetto non dichiarato prima del consenso vale come un
  verdetto non sostenuto. Usare esclusioni Git locali soltanto per percorsi posseduti e non
  tracciati. Mai `assume-unchanged` o `skip-worktree`.
- Nessuna telemetria, nessun effetto esterno automatico, nessuna promessa di isolamento dal
  sistema operativo. Push, issue remote e deploy richiedono autorizzazione al punto d'azione.

### Terze parti

Conservare byte e attribuzioni dei componenti esterni. Nessuna esecuzione di hook o script
durante la ricognizione. Non modificare lockfile o dipendenze per adattarli incidentalmente
all'ambiente di sviluppo: se cambiano, rigenerare anche provenienza e avvisi.

---

## 🏗️ L'architettura, e cosa non reintrodurre

**Un motore solo.** Il secondo ciclo di vita è stato rimosso: `orchestrator/`, `worktrees/`,
`observability/`, `guard/` e i comandi `task`, `workspace`, `ledger`, `guard` non esistono più.
Sopravvive il runtime nativo cooperativo. Non creare un secondo motore parallelo.

**Dismessi, non reintrodurre**: l'adapter Cursor e il profilo `full`. I percorsi legacy ancora
presenti sono elencati in [comandi avanzati](docs/percorsi-legacy.md), che distingue i quattro
in dismissione — `inspect`, `prepare`, `init`, `verify` — dai tre pienamente supportati:
`doctor` regge G4 e G6, `update` è l'unica via di aggiornamento, `rollback` la via d'uscita.
I primi non vanno ampliati.

Le sei garanzie e i moduli che le realizzano sono in
[architettura](docs/guide/architettura.md) e [garanzie](docs/guide/garanzie.md). Ogni garanzia
è **codice che può fallire**: se aggiungi una garanzia, aggiungi anche il modo in cui fallisce.

---

## 🌍 Lingua

| Cosa | Lingua |
|---|---|
| Documentazione, messaggi utente del percorso ordinario, istruzioni first-party | **italiano** |
| Codice, identificatori, chiavi di protocollo, codici di errore, commenti tecnici | **inglese** |
| Licenze, `NOTICE`, `THIRD_PARTY_NOTICES.md`, contenuti di terzi | **non tradurre** |

Un codice d'errore e un percorso sono identificatori, non prosa: possono comparire in un
messaggio italiano purché accompagnati dall'azione da compiere.

---

## ✅ Come si lavora

1. **Prima il test, poi l'implementazione minima.** Non riscrivere il progetto da zero.
2. Ogni incremento lascia una differenza **piccola, testabile e rivedibile**.
3. Preservare rendering deterministico, confinamento dei percorsi, proprietà dei file,
   recupero transazionale ed evidenze legate ai contenuti verificati.
4. Non committare log locali, credenziali, output di test, target di prova o stato operativo
   personale.

Prima di dichiarare un incremento verificato:

```bash
npm run verify
```

più `git diff --check` e i test mirati dell'incremento. Distinguere sempre test locali, CI e
prove reali nelle app.

### ⚠️ Un rosso non è ambientale finché non lo hai misurato

Per un'intera sessione tre gruppi di test sono stati dichiarati «fallimenti ambientali»
e non inseguiti. **Erano tutti e tre difetti nostri**, e una misura li ha smentiti:

| Sintomo | Diagnosi data | Causa reale |
|---|---|---|
| `discovery.test.ts` sul submodule | carico della macchina | l'helper Git aveva un tetto di 10 s per un lavoro che ne richiede 23 |
| `registry/load.test.ts` sui percorsi | forma breve 8.3 di Windows | la fixture costruiva una radice non canonica e la confrontava con una risolta |
| `tests/integration/native` a 30 s | tempi di importazione sotto carico | il tetto globale è tarato sui test unitari; quei test installano un'imbracatura vera e costano ~100 s |

La regola che ne segue vale quanto le tre correzioni: **«ambientale» è una diagnosi, e una
diagnosi va sostenuta come qualunque altra affermazione.** Prima di attribuire un rosso
alla macchina, misura quanto impiega davvero il lavoro che il test delimita. Un tetto più
stretto del lavoro che racchiude segnala un difetto che non c'è, e insegna a ignorare i
rossi — che è il danno peggiore.

Se un test scade, rieseguilo isolato **e cronometra ciò che fa** prima di concludere.

Questa regola non è più affidata alla memoria. Ogni suite in `tests/integration/` e
`tests/roundtrip/` **dichiara il proprio tetto in testa al file, con la durata misurata
della sua prova più lenta**, e un test lo verifica: `tests/unit/meta/declared-timeouts.test.ts`.
Era prosa, e quattro suite se ne erano dimenticate — il difetto è emerso solo sotto carico.
Il tetto dichiarato serve a cogliere un blocco, non a sorvegliare la durata.
