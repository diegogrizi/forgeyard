# Primo avvio

Per chi ha una cartella di codice e vuole provare, senza sapere niente di Forgeyard.

Forgeyard è un programma locale. Si installa **una volta** sul PC; poi, dalla cartella su
cui vuoi lavorare, lo esegui **una volta** e la cartella è preparata. La conversazione con
l'assistente resta dove già lavori: nelle app o nelle CLI di **Claude Code** e **Codex**.
Forgeyard non chiama modelli e non legge credenziali.

Questa pagina va letta nell'ordine in cui è scritta. Se qualcosa non va, i sintomi con le
loro cause stanno in [Risoluzione dei problemi](problemi.md).

## 1. Cosa serve prima

Tre cose, e **nessuna la installa Forgeyard per te**.

### Node 24

```bash
node --version
```

La risposta è un numero come `v24.19.0`. I tre numeri separati da punti sono, in ordine,
versione **maggiore**, **minore** e di **correzione**: la maggiore è quella che conta, e
deve essere `24`. Forgeyard dichiara il proprio intervallo nel campo `engines` di
`package.json`, ed è `>=24.19.0 <25`. Quindi va bene la `24.19.0` e qualunque `24.x`
successiva — per esempio `v24.21.0` — mentre non vanno bene né una `24` precedente come
`v24.18.0` né una `25`.

Se il comando non esiste, o se il numero è più basso di `24.19.0`, installa Node 24 — dal
sito ufficiale del progetto oppure con il gestore di versioni che già usi — riapri il
terminale e ricontrolla. Il terminale legge il `PATH` all'apertura: una nuova
installazione non compare in una finestra aperta prima.

### Git

```bash
git --version
```

Serve perché la ricognizione della cartella legge **soltanto metadati Git**: dove comincia
un repository, se è un worktree o un submodule, quali file sono già tracciati. Non esegue
hook, fetch, checkout, `git init` né script del progetto. Senza Git raggiungibile nel
`PATH` la ricognizione si ferma dichiarando il codice `FY_GIT_UNAVAILABLE`, e non viene
scritto niente.

### Il client: Claude Code **oppure** Codex

```bash
claude --version
```

```bash
codex --version
```

Uno dei due deve essere già installato, autenticato e funzionante. **Forgeyard non
installa il client e non ne gestisce l'account**: non chiama modelli, non legge
credenziali, non avvia Claude Code o Codex e non sostituisce i loro abbonamenti, quote o
permessi. Se il client non funziona da solo, non funzionerà nemmeno dentro la forgia.

Quale dei due verrà preparato non lo scegli tu con un'opzione: lo decide la ricognizione
dagli indizi del progetto, e lo **dichiara** nel riepilogo prima di chiedere conferma
(§3).

## 2. Installare il programma

Una volta sola, nella cartella del checkout di Forgeyard:

```bash
npm run install:local
```

Quel comando fa tre cose, nell'ordine:

1. installa le dipendenze **dal lockfile**, quindi alle versioni esatte e riproducibili
   che il repository dichiara, senza risolverle di nuovo;
2. compila il programma;
3. collega il comando `forgeyard` fra i comandi globali di npm, facendolo puntare a
   **questo** checkout.

Cosa **non** tocca: niente fuori da questo checkout e dal collegamento globale del
comando. Non scrive nelle cartelle su cui lavorerai, non modifica configurazioni globali
o di account del client, non cambia politiche di fiducia, non contatta un servizio di
aggiornamento, non scarica pack, non invia dati d'uso e non attiva gli hook o gli script
del catalogo di terzi.

**Non è una release pubblicata su npm.** Non esiste un `npm install -g` da eseguire al
posto di questo: si parte dal checkout, deliberatamente. Il collegamento è di sviluppo e
punta al checkout locale, quindi una modifica al programma richiede una nuova
compilazione:

```bash
npm run build
```

## 3. La prima volta in una cartella

Apri il terminale nella cartella su cui vuoi lavorare ed esegui:

```bash
forgeyard
```

Senza argomenti, senza opzioni da scegliere. La cartella può essere vuota, essere essa
stessa un repository Git, trovarsi dentro un repository oppure contenerne diversi.

Questa è una sessione reale su una cartella che contiene un solo progetto. I nomi, i
motivi e i numeri dipendono dalla tua cartella: non sono una promessa, sono ciò che quella
cartella ha prodotto.

```text
Forgeyard — preparazione personale
Cartella: C:\lavoro\workspace
Repository rilevati: 0. Progetti rilevati: 1.
  servizio-ordini: typescript, react
Che risultato vuoi ottenere?
Verrà preparato:
  Client: Codex — formato portabile predefinito; la disponibilità del client non è verificata
  Capacità selezionate: 6    escluse: 4
  Verifiche: git diff --check
  File dell'imbracatura da creare: 80
  Fuori da .forgeyard: .codex/config.toml; un'esclusione Git locale per la sola configurazione del client. Ogni scrittura è delimitata e reversibile.
  I file privati restano in .forgeyard; il codice e i repository figli non vengono modificati.
Confermi la preparazione di questa cartella?
```

Riga per riga.

**`Cartella: ...`** — la cartella che è stata effettivamente selezionata, nella sua forma
risolta. Se stai dentro un repository più grande, resta selezionata **questa** cartella:
il programma non risale alla radice Git per installarsi altrove.

**`Repository rilevati: 0. Progetti rilevati: 1.`** — la topologia, cioè cosa la
ricognizione ha visto. «Repository» sono le radici Git trovate, distinte fra repository,
worktree e submodule. «Progetti» sono le cartelle con un manifest riconosciuto. Qui zero e
uno perché la cartella di esempio non è un repository e contiene un solo progetto.

**`  servizio-ordini: typescript, react`** — una riga per progetto, con linguaggi e
framework **dedotti dai manifest**, senza eseguirne gli script. Se non si deduce niente la
riga dice `stack da chiarire nella conversazione`, che è un'ammissione, non un errore: lo
chiarirai parlando. Oltre il dodicesimo progetto compare `Altri progetti presenti nella
mappa locale.` invece dell'elenco intero.

**`Che risultato vuoi ottenere?`** — l'**unica** domanda. È l'unica cosa che il programma
non può dedurre. Rispondi in una riga, in linguaggio di prodotto: *«aggiungere il
pagamento con carta al servizio ordini»* va benissimo. Se lasci la risposta vuota, il
programma dice `Nessuna descrizione: provo a dedurre il risultato dal progetto.` e tenta
con ciò che il progetto già dichiara; se non basta risponde

```text
Il progetto non dice da solo quale risultato vuoi ottenere.
Riesegui forgeyard e descrivi il risultato in una riga: è l'unica cosa che il programma non può dedurre.
```

e si ferma senza scrivere niente.

**`Verrà preparato:`** — il riepilogo di ciò che verrebbe fatto, prima che venga fatto.
Le righe che seguono sono il piano, non un resoconto.

**`  Client: Codex — ...`** — quale imbracatura verrebbe installata, e **perché**. Su
questo percorso il motivo è uno di tre, e lo decide il progetto:

| Motivo mostrato | Cosa significa |
|---|---|
| `un CLAUDE.md esistente identifica l'host del progetto` | il progetto porta già istruzioni per Claude Code, quindi si prepara Claude Code |
| `un AGENTS.md esistente identifica l'host del progetto` | il progetto porta già istruzioni per Codex, quindi si prepara Codex |
| `formato portabile predefinito; la disponibilità del client non è verificata` | nessuno dei due indizi: si ripiega sul formato portabile di Codex |

L'ultimo è il caso dell'esempio, e vale la pena notare **come** è scritto: dice che la
disponibilità del client non è stata verificata, invece di far finta di saperlo. Che tu
abbia `codex` installato o no, quella riga non cambia: l'ingresso ordinario non cerca
l'eseguibile per decidere.

Se hai già un `CLAUDE.md` o un `AGENTS.md` nella cartella e vuoi l'altro client, la scelta
si forza soltanto dai comandi avanzati descritti in
[Percorsi legacy](../percorsi-legacy.md), non dall'ingresso.

**`  Capacità selezionate: 6    escluse: 4`** — quante capacità del catalogo entrerebbero
nell'imbracatura e quante sono state escluse. Non devi sceglierle né conoscerle per nome.

**`  Verifiche: git diff --check`** — i controlli eseguibili che l'imbracatura
installerebbe come propri gate, mostrati con la riga di comando esatta. Se non ce n'è
nessuno, la riga non compare.

**`  File dell'imbracatura da creare: 80`** — quanti file verrebbero scritti. Il numero è
del piano, e il resoconto dopo la conferma può differire: vedere §4.

**`  Il client fornisce già: ...`** — i plugin che il tuo client ha già attivi **per questa
cartella**, letti dal suo registro senza toccarlo. Non vengono rimossi né sostituiti: le
capacità dell'imbracatura si aggiungono a quelli, e se due fanno una cosa simile lo vedi
prima di confermare invece di scoprirlo dopo. Un plugin installato per un altro progetto
non compare, perché qui non vale. Se il registro non è leggibile la riga lo dice, e non
finge che tu non abbia niente. Per Codex la riga non compare: non ha un registro del genere.

**`  Fuori da .forgeyard: ...`** — le scritture che escono dall'area personale, elencate
prima della domanda e non scoperte dopo in `git status`: la configurazione MCP del client,
un'esclusione Git locale per quella sola configurazione e, **soltanto se un file di
istruzioni esiste già**, un blocco delimitato aggiunto in coda. Se la forgia crea da sé quel
file, il puntatore è già dentro e non viene annunciato niente.

**L'ultima riga del riepilogo** — `I file privati restano in .forgeyard; il codice e i
repository figli non vengono modificati.` — è il confine di scrittura, ripetuto dove
serve: appena prima di chiedere il permesso.

**`Confermi la preparazione di questa cartella?`** — l'**unica** conferma, e la risposta
predefinita è no. Se rispondi no: `Preparazione annullata. Nessun file scritto.` Se
interrompi prima di rispondere: `Preparazione annullata prima della conferma.` In entrambi
i casi la cartella è come l'hai trovata.

### Se la cartella è già in parte preparata

Quando almeno uno dei tre passi è già fatto, subito dopo la topologia compaiono tre righe
di stato:

```text
Area personale: presente.
Imbracatura: presente per Codex.
Collegamento nativo: da configurare.
```

L'imbracatura installata **dichiara il proprio client**, quindi alla riesecuzione la
scelta non viene rifatta — e la domanda sul risultato non viene nemmeno posta, perché
riguarda soltanto l'installazione dell'imbracatura. Se non manca niente, il programma non
chiede niente:

```text
Niente da preparare: nessun file scritto.
Apri questa cartella in Codex e descrivi il lavoro: la forgia fa il resto.
```

### Senza un terminale interattivo

Se l'output è rediretto, incanalato in una pipe o eseguito da un'automazione, la domanda
non può essere posta e **non viene scritto nessun file**. Vedi l'anteprima, l'elenco dei
passi mancanti e questa riga finale:

```text
Solo anteprima: nessun file scritto. Esegui forgeyard in un terminale interattivo per confermare.
```

È il comportamento previsto, non un difetto.

## 4. Cosa succede dopo la conferma

Tre passi, in quest'ordine, ognuno con la propria riga dichiarata.

**1. Area personale** — `Area personale creata.`

Vengono creati due file dentro `.forgeyard/`: `workspace.json`, la mappa della cartella
con la propria impronta, e `.gitignore`, che esclude dai commit l'intera area privata
**compresa la propria regola**. In parole semplici: la forgia si prende una cartella sua e
si tiene fuori dai tuoi commit. Il `.gitignore` condiviso del software non viene toccato.

L'impronta serve a rilevare alterazioni accidentali. Non autentica i file contro un
processo ostile che gira con i tuoi privilegi.

**2. Imbracatura** — `Imbracatura installata: 79 file, 1 conservato.`

Sono le istruzioni per l'assistente, le capacità selezionate, i gate e la **capsula
congelata** che ne fissa l'identità byte per byte. Se era già tutto a posto la riga è
`Imbracatura già coerente: nessun file creato.`

I due numeri sono due cose diverse, e per questo compaiono entrambi: i file creati e i
file **conservati**, cioè già presenti e preservati invece di essere riscritti. È anche il
motivo per cui il totale può non coincidere con il numero mostrato nell'anteprima.

**3. Collegamento nativo** — `Collegamento nativo configurato per Codex.`

Questo passo scrive un **namespace MCP posseduto dentro il progetto** — cioè un blocco di
configurazione che dichiara al client come avviare il server locale di Forgeyard:

| Client | File nel progetto | Blocco posseduto |
|---|---|---|
| Claude Code | `.mcp.json` | la voce `forgeyard` dentro `mcpServers` |
| Codex | `.codex/config.toml` | la sezione `[mcp_servers.forgeyard]` |

Insieme al namespace viene aggiunto un puntatore alle istruzioni in `CLAUDE.md` o
`AGENTS.md` — a meno che quel file non sia già posseduto dalla forgia — e un'esclusione
Git **locale** per la configurazione del client, perché contiene percorsi di *questa*
macchina e non deve finire nei commit: `info/exclude` nella directory Git comune quando
c'è un repository, il `.gitignore` altrimenti. Una configurazione del client **già
tracciata** viene rifiutata, non sovrascritta.

Poi l'ultima cosa che il programma dice è questa:

```text
Il collegamento non è stato provato con Codex: se il client chiede di abilitare il server, fallo con i suoi controlli e riapri il progetto.
Apri questa cartella in Codex e descrivi il lavoro: la forgia fa il resto.
```

Va letta per intero. **Che il collegamento sia stato scritto non significa che un client
lo abbia letto.** Il client può chiederti di abilitare o approvare quel server con i
**propri** controlli: è una decisione che appartiene a lui, e Forgeyard non la prende al
tuo posto. Nessuna impostazione globale o di account viene toccata, e nessuna politica di
fiducia viene cambiata per te.

### Se un passo non riesce

I passi precedenti restano dove sono e l'esito è dichiarato, invece di essere disfatto:
un'imbracatura non installata lascia l'area come è e non tenta il collegamento; un
collegamento non riuscito lascia l'imbracatura installata e **non** emette il messaggio
finale, perché uscire con successo significherebbe «pronto». Riesegui `forgeyard` nella
stessa cartella: vengono ripresi soltanto i passi mancanti. I sintomi precisi sono in
[Risoluzione dei problemi](problemi.md).

## 5. Aprire la cartella nel client e lavorare

Apri la cartella preparata nel client che la riga finale ha nominato. Poi parla in
**linguaggio di prodotto**: cosa vuoi ottenere, con quali vincoli, e come si vede che è
fatto. Un esempio concreto:

> Nel servizio ordini serve il pagamento con carta. Non toccare il database dei clienti.
> Quando hai finito, dimmi su quali prove poggia il risultato.

Oppure, per un lavoro già descritto nel repository:

> Questo è il repository, questi i requisiti e i vincoli. Prepara l'ambiente giusto, poi
> implementa e verifica il risultato.

**La cosa che conta: non c'è una sequenza di skill o comandi da ricordare.** Non devi
invocare una skill per nome, non devi nominare un agente, non devi scegliere un
orchestratore e non devi imparare un ordine di invocazione. Descrivi il risultato;
l'imbracatura installata dice all'assistente come procedere, quali controlli attraversare
e cosa non può dichiarare senza prove. Il ciclo che ne segue — piano, consenso, ambiti di
scrittura, gate, review, verdetto — è descritto in [Uso](uso.md).

## 6. Cosa **non** devi fare

- **Non devi scegliere profili**, autori di skill o orchestratori. La selezione la fa la
  ricognizione e la dichiara nel riepilogo, prima della conferma.
- **Non devi invocare skill per nome.** Un file di agente è un contratto di ruolo, non un
  comando da lanciare: installarne molti non avvia molti processi.
- **Non devi rieseguire il setup a ogni conversazione.** `forgeyard` si esegue una volta
  per cartella. Alla riesecuzione riprende soltanto i passi mancanti, e se non manca
  niente lo dice.
- **Non devi eseguire `forgeyard analizza` prima di `forgeyard`.** È un diagnostico in
  sola lettura; l'ingresso quella ricognizione la fa già.
- **Non devi committare l'area privata.** L'esclusione dentro `.forgeyard/` lo fa già, e
  il `.gitignore` condiviso del software resta come è.

## 7. Prima di fidarti

Hai visto cosa fa e perché può essere utile. Qui c'è il confine, detto per intero, prima
che tu ci appoggi del lavoro vero.

**Nessuna prova live con un account Claude Code o Codex reale è mai stata eseguita.** I
tre passi descritti sopra hanno i loro test, e ciò che scrivono è osservabile sul disco.
Il quarto passo — il client che *legge* quel namespace, ti chiede la fiducia che deve
chiederti e attraversa il workflow — alla data non è verificato. Tutto ciò che questo
repository dichiara verificato lo è da **test strutturali**: rendering deterministico,
confini di scrittura, integrità delle impronte, riproducibilità della provenienza. Un test
di trasporto su un SDK ufficiale non è una sessione autenticata, e un controllo
strutturale non prova il comportamento di un client reale, delle sue autorizzazioni o
della sua interfaccia.

In pratica, per te: al primo tentativo quel passaggio lo verifichi tu, con i tuoi occhi.
Se il client non carica il server, non stai inseguendo un difetto nascosto — stai
incontrando un confine che era dichiarato. E se lo carica, sei la prima persona a saperlo.

Cosa è implementato, cosa attraversa un percorso ordinario e cosa non è mai stato provato
live è registrato, con la sua data, in [Stato](../STATO.md).

## Dove andare adesso

| Se vuoi | Vai a |
|---|---|
| sapere cosa si può fare oggi e cosa resta da collegare | [Uso](uso.md) |
| partire da un sintomo e arrivare a cosa fare | [Risoluzione dei problemi](problemi.md) |
| sapere cosa promettono i meccanismi e cosa li fa fallire | [Garanzie](garanzie.md) |
| sapere cosa è implementato e cosa no | [Stato](../STATO.md) |
| capire perché il prodotto è fatto così | [Direzione](../DIREZIONE.md) |
