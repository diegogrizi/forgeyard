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
- La suite personale non va committata nei repository assistiti. Non modificare file già
  tracciati per installarla; usare esclusioni Git locali soltanto per percorsi posseduti e non
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
presenti sono elencati in [percorsi-legacy](docs/percorsi-legacy.md); non ampliarli.

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

### ⚠️ Due classi di fallimento ambientale note

Su macchine cariche o con uno scanner di file aggressivo, due gruppi di test falliscono per
ragioni che **non sono difetti del codice**. Vanno riconosciuti e dichiarati, non inseguiti:

| Sintomo | Causa |
|---|---|
| Test che scadono esattamente a 30 s, spesso in `tests/integration/native` | tempi dominati dall'importazione dei moduli sotto carico; passano rieseguiti da soli |
| `tests/unit/registry/load.test.ts` confronta percorsi temporanei diversi | forma breve 8.3 di Windows (`DIEGO~1.GRI`) contro forma lunga risolta |

Se un test scade, rieseguilo isolato prima di concludere qualcosa.
