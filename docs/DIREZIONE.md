# Direzione: Forgeyard è un registro, non una libreria

Documento di indirizzo del refactoring. Sostituisce la pianificazione storica sparsa —
ora rimossa dal repository — e unifica il piano della forgia personale. Chi modifica i
confini del prodotto legge prima questo file.

## 1. Il problema con lo stato dell'arte

I repository agentici più popolari sono **librerie di intenzioni**: raccolte di 150
agenti, 170 plugin, 40 slash-command che descrivono *come si dovrebbe lavorare*.
Sono tutti a monte del lavoro. Nessuno di essi sa rispondere, a valle:

- che cosa è stato cambiato davvero, e contro quale requisito;
- quali affermazioni del rapporto finale sono sostenute da un comando eseguito, e
  quali sono soltanto prosa del modello;
- la documentazione generata descrive ancora il codice, una settimana dopo?
- quanto è costato, con quale metodo di confronto;
- l'imbracatura che ho approvato è l'imbracatura che ha girato?

Una raccolta di Markdown non può rispondere a queste domande. Non perché sia scritta
male: perché **non ha un meccanismo**. Un file di istruzioni non può verificare sé
stesso, non può rilevare di essere invecchiato, non può rifiutare una conclusione non
sostenuta.

Aggiungere il duecentunesimo agente non colma quel divario. Lo allarga.

## 2. La tesi

> Forgeyard non è una collezione di competenze. È il **registro contabile** del lavoro
> agentico: prepara l'ambiente, e poi tiene i conti di ciò che quell'ambiente afferma.

La parte «fabbrica» — ricognizione, decisione, installazione — è la porta d'ingresso.
Il valore aggiunto è ciò che accade dopo: ogni affermazione prodotta dentro
l'imbracatura porta un **livello di evidenza dichiarato** e un vincolo verificabile
alla propria fonte. La deriva è rilevata da un meccanismo, non dalla buona volontà.

Questo è realizzabile perché Forgeyard è un programma, non un prompt. È l'unico
vantaggio strutturale che abbiamo sulle raccolte, e va speso tutto qui.

## 3. Le sei garanzie meccaniche

Ognuna è codice che può fallire, non una promessa in un README.

### G1 — Identità congelata

L'imbracatura approvata è, byte per byte, l'imbracatura che gira. La capsula
(`.forgeyard/capsule.json`) è indirizzata per contenuto: policy, gate, selezione,
inventario dei file con i loro digest. Se un file dell'imbracatura cambia, la capsula
non si apre e il lavoro si ferma, invece di procedere su basi diverse da quelle
approvate.

*Stato: `src/capsule/capsule.ts`. Sul percorso ordinario: la capsula viene letta e
verificata dal runtime nativo.*

### G2 — Evidenza classificata

Ogni affermazione porta un livello, e i livelli non sono interscambiabili:

| Livello | Significato | Vincolo |
|---|---|---|
| `executed` | un comando è stato eseguito | argv + exit code + digest dell'input |
| `observed` | un contenuto è stato letto | percorso + digest dei byte letti |
| `derived` | inferenza da evidenza citata | deve citare almeno una evidenza di livello superiore |
| `asserted` | prosa del modello | non può sostenere un verdetto |

La regola che dà valore all'intera scala è una: **un verdetto di consegna che si
appoggia a una affermazione `asserted` non può essere emesso.** Il livello non è
un'etichetta descrittiva, è un gate.

*Stato: `src/evidence/epistemic.ts`. Sul percorso ordinario: `fy_finalize` riformula il
run sulla scala, e il certificato dichiara il livello più debole del proprio supporto e su
cosa poggia in ultima istanza.*

### G3 — Citazioni vive

Una affermazione non punta a un file: punta a `percorso#locatore@digest`. Se la fonte
è cambiata o è scomparsa, l'affermazione diventa **stantia**, non silenziosamente
vera. La staleness è calcolabile in qualunque momento senza rieseguire nulla.

*Stato: `src/evidence/citations.ts`, unica implementazione della liveness. Sul percorso
ordinario: il runtime nativo la usa per validare i riferimenti di evidenza.*

### G4 — Deriva rilevata

L'imbracatura genera istruzioni che descrivono il progetto. Il progetto cambia. Una
scansione confronta ciò che le istruzioni affermano con ciò che il codice mostra, e
riporta i punti divergenti. La documentazione che invecchia è un difetto rilevabile,
non un fatto della vita.

*Stato: `src/drift/scan.ts`. Sul percorso ordinario: il controllo `harness-drift` del
doctor. Non è richiesto e non affonda il verdetto dell'installazione: un progetto che è
cresciuto non ha un'installazione rotta.*

### G5 — Misura dichiarata

Costo e tempo del lavoro agentico, confrontati con una linea di base umana
**esplicita e ispezionabile**. «L'AI è stata più veloce» diventa un numero con un
metodo dichiarato e un margine di incertezza, oppure resta non misurato — mai zero.

*Stato: `src/measure/accounting.ts`, riportata dal certificato di consegna. La linea di
base umana **non è ancora dichiarabile**, quindi il confronto resta assente invece di
stimato: dichiararla in un file posseduto da una persona è il prossimo incremento.*

### G6 — Coerenza dell'imbracatura generata

Forgeyard non copia template: **compila** un'imbracatura e la rifiuta se è
incoerente, prima di scriverla su disco. Un riferimento che non risolve, un
segnaposto non sostituito, un percorso assoluto della macchina di chi ha generato,
due skill omonime che collidono silenziosamente, un file di istruzioni oltre il
budget di contesto: sono difetti rilevabili meccanicamente.

Questa garanzia nasce da un difetto misurato su una suite agentica reale
installata in un altro repository: nell'imbracatura derivata **44 link su 47 erano
rotti** e i file generati contenevano i percorsi assoluti della macchina
dell'autore. Nessuno se ne era accorto, perché un file Markdown non verifica sé
stesso.

*Stato: `src/doctor/harness-lint.ts`. Sul percorso ordinario: `buildInstallPlan` la
attraversa, quindi la attraversa ogni percorso di installazione.*

## 3-bis. Perché un programma e non una raccolta

Le suite agentiche più note vivono in Markdown. Una convenzione scritta in un
prompt si può violare per distrazione, e la violazione è silenziosa: l'agente
*crede* di seguire le istruzioni mentre ne ignora dei pezzi. Forgeyard è scritto in
TypeScript, e questo consente una classe di garanzie che una raccolta non può
offrire:

| Disciplina | In una raccolta | In Forgeyard |
|---|---|---|
| Livello di evidenza | etichetta in prosa, aggirabile | tipo somma: un verdetto accetta solo evidenza di rango sufficiente |
| Ambito di scrittura di un ruolo | frase «non scrive mai in…» | confine verificato prima della scrittura |
| Riferimento a una foglia di contesto | link che si spera esista | risolto e verificato in fase di compilazione |
| Nome di strumento in un agente | stringa YAML che può essere inventata | valore tipizzato: la classe di difetto non esiste |
| Isolamento di un contesto | regola da rispettare | campo assente dal tipo: violarlo non compila |
| Budget di contesto | nessuno | byte misurati per file, con tetto |

Il criterio di progetto che ne deriva: **quando una regola può diventare una
proprietà del tipo o un controllo eseguibile, non va scritta in prosa.** La prosa
resta per spiegare il perché.

Due corollari, imparati dagli errori di quella suite reale:

- **Una regola, una sede.** Se una regola è enunciata in due file, divergeranno — e
  il consumatore più permissivo diventa il contratto reale. In codice: la regola
  vive in un modulo, gli altri la importano.
- **Il controllo deve avere la granularità del contratto che protegge.** Verificare
  che un file esista non protegge da un controllo assente *dentro* quel file. Un
  registro tipizzato di controlli, in cui il registro *è* la lista, rende un
  controllo dichiarato e non implementato un errore di compilazione.

## 4. Il vincolo UX non cambia

Un ingresso ordinario: `forgeyard` nella cartella di lavoro. La conversazione resta
nelle app native di Claude Code e Codex. Le sei garanzie sono meccanismi interni:
l'utente ne vede gli esiti, non deve conoscerne i comandi.

Forgeyard non chiama modelli, non legge credenziali, non sostituisce abbonamenti o
permessi dei client. Un'inferenza non viene mai presentata come evidenza verificata;
un test strutturale non viene mai presentato come prova live con un client.

## 5. Cosa viene tagliato, e perché

Il repository contiene tre motori sovrapposti. Ne sopravvive uno.

| Rimosso | Peso | Motivo |
|---|---|---|
| Adapter Cursor | ~760 righe + riferimenti in 19 file | Il prodotto supporta Claude Code e Codex. Un terzo adapter descrittivo non enforceable diluisce le garanzie. |
| Pacchetto presentazione | 1 pack, 2 auditor, 1 attività, una sezione di configurazione, 11 slot in due adapter e i golden | Un motore di slide non appartiene a una fabbrica di imbracature. Rimosso il 23 settembre 2026; era intrecciato con il doppio rispetto a quanto questa riga stimava. |
| Profilo `full` | 69 plugin vendored senza selettore | Installava tutto: è esattamente la libreria di intenzioni da cui ci distinguiamo. `hackathon` resta come selezione curata. |
| Ciclo di vita legacy: `orchestrator/`, `worktrees/`, `observability/`, `guard/`, comandi `task`/`workspace`/`ledger`/`guard` | 4.715 righe | Duplicava il runtime nativo cooperativo. Due sistemi di task significano zero autorità. |
| Superficie CLI legacy `init`/`inspect`/`prepare`/`update`/`rollback` come percorso ordinario | — | Un ingresso. Restano operazioni avanzate, non il tutorial. |

Conservati il contratto di attività e le ricevute di verifica: un file di task è un
contratto con obiettivo, criteri, argv di verifica e ambiti, non un pezzo di scheduler.
Il guard di scrittura è diventato nativo soltanto: il suo ramo legacy era il più
permissivo dei due percorsi che proteggono la stessa cosa.

Il catalogo vendored resta uno snapshot MIT pinnato e attestato: la potatura richiede
di rigenerare `UPSTREAM.json`, SBOM e notices, ed è un incremento a sé.

## 6. Architettura di arrivo

```text
src/
  core/        hash, percorsi, errori, contratti
  workspace/   ricognizione, area personale, ingresso unico
  intake/      ispezione → evidenza → composizione
  capsule/     identità congelata dell'imbracatura          [G1]
  adapters/    claude-code, codex
  installer/   plan / apply / update / rollback transazionali
  native/      runtime MCP cooperativo + binding nativi
  evidence/    ricevute + scala epistemica + citazioni       [G2, G3]
  drift/       scansione imbracatura ↔ codice               [G4]
  measure/     contabilità costo/tempo con linea di base    [G5]
  ledger/      catena di eventi verificabile
  doctor/      controlli strutturali + lint dell'imbracatura [G6]
  registry/    caricamento dei pack
  provenance/  SBOM e notices
```

## 7. Onde di lavoro

1. **Asciugatura** — i tagli della sezione 5, un incremento verificabile per taglio.
2. **Garanzie** — i moduli nuovi di G2–G5, sviluppati in parallelo perché su file nuovi.
3. **Integrazione** — le garanzie entrano nel runtime nativo e nel verdetto di consegna.
4. **Documentazione** — una sola narrazione in italiano; la pianificazione storica esce.
5. **Verifica** — `npm run verify`, provenienza rigenerata, CI su Linux e Windows.

Ogni onda lascia una differenza piccola, testabile e rivedibile. Prima il test, poi
l'implementazione minima. Un controllo non eseguibile va dichiarato, non simulato.

## 8. Convenzioni

Documentazione e messaggi utente del percorso ordinario in italiano. Codice,
identificatori, chiavi di protocollo, codici di errore e commenti tecnici in inglese.
I contenuti di terzi non vengono tradotti né modificati nei byte.
