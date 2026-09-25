# Risoluzione dei problemi

Ogni voce ha la stessa forma: **sintomo osservabile → causa → cosa fare**. Cerca il
sintomo, cioè quello che vedi davvero sullo schermo, non la causa che immagini.

Se non hai ancora preparato una cartella, il percorso completo è in
[Primo avvio](primo-avvio.md).

Due cose da sapere prima di leggere il resto.

**I codici di errore sono identificatori, non prosa.** Un codice come
`FY_PERSONAL_TRACKED` resta in inglese anche dentro un messaggio italiano, e serve per
cercare: è stabile, mentre una frase può essere riscritta. I comandi avanzati stampano
`CODICE: messaggio` e, quando esiste, una riga `Remediation:` con l'azione da compiere.

**Un rifiuto non è un guasto.** Molte delle voci qui sotto descrivono il programma che si
ferma **invece** di fare la cosa sbagliata in silenzio: una scansione parziale che non
autorizza una registrazione, un file tracciato che non viene reso privato da una regola di
esclusione, un verdetto che non viene emesso perché nessuna prova lo sostiene. Riconoscere
quei casi come funzionamento corretto è metà del lavoro di questa pagina.

## Installazione e comando

#### `forgeyard` non è un comando riconosciuto

Il terminale risponde che il nome non corrisponde a nessun comando. Quel messaggio lo
scrive la shell, non Forgeyard: non c'è nessun codice di errore da cercare, perché il
programma non è mai partito.

**Causa.** Una di queste tre: `npm run install:local` non è mai stato eseguito; la
cartella dei comandi globali di npm non è nel `PATH`; oppure il terminale era già aperto
quando il collegamento è stato creato, e sta ancora usando il `PATH` di prima.

**Cosa fare.** Nella cartella del checkout di Forgeyard:

```bash
npm run install:local
```

Poi controlla che il collegamento esista davvero:

```bash
npm ls --global --depth=0
```

`forgeyard` deve comparire nell'elenco. Se c'è ma il comando resta irraggiungibile, il
problema è il `PATH`: chiedi a npm dove mette i comandi globali,

```bash
npm prefix --global
```

e verifica che quella cartella sia nel `PATH` del tuo utente. In ogni caso **riapri il
terminale** dopo un'installazione: una finestra aperta prima non vede il nuovo `PATH`.

Nota: il collegamento punta al checkout locale. Se hai modificato il programma e il
comportamento non cambia, manca una nuova compilazione (`npm run build`).

## L'ingresso

#### L'ingresso mostra soltanto un'anteprima e non scrive niente

L'ultima riga è:

```text
Solo anteprima: nessun file scritto. Esegui forgeyard in un terminale interattivo per confermare.
```

Prima di quella riga compare `Passi mancanti: area personale, imbracatura, collegamento
nativo.` e, se il piano dell'imbracatura non è deducibile senza la domanda di prodotto,
`Il piano dell'imbracatura dipende dal risultato voluto: quella domanda richiede un
terminale interattivo.` Il codice di uscita è `0`.

**Causa.** L'ingresso scrive soltanto quando **sia** lo standard input **sia** lo standard
output sono un terminale vero. Non lo sono quando l'output è rediretto su file, incanalato
in una pipe, catturato da un'automazione o da un runner di attività dell'editor, oppure
eseguito in CI.

**Cosa fare.** Niente da riparare: **è il comportamento previsto**. Una conferma non può
essere sottintesa da un contesto che non può nemmeno porre la domanda, e la conferma
dell'ingresso non ha un `--yes`. Esegui `forgeyard` in un terminale interattivo e rispondi
alle due richieste. Se ti serviva soltanto ispezionare la cartella senza scrivere, questo
output è già la risposta.

#### «Scansione parziale: nessuna preparazione autorizzata»

Su errore standard:

```text
Scansione parziale: nessuna preparazione autorizzata. Risolvi gli avvisi prima di confermare.
```

seguito da un massimo di otto righe nella forma `  codice: percorso`. Il codice di uscita
è `4`. Lo stesso rifiuto, se arriva al momento della scrittura, porta il codice
`FY_PERSONAL_INCOMPLETE`.

**Causa.** La ricognizione ha dichiarato di non aver potuto vedere tutto, e **una mappa
incompleta viene rifiutata invece di essere completata a indovinare**. Basta un solo
avviso perché la scansione sia dichiarata parziale. I codici che possono comparire, con il
significato che il programma stesso dà loro:

| Codice | Significato |
|---|---|
| `invalid-git` | metadati Git non validi o non accessibili |
| `FY_GIT_UNAVAILABLE` | Git non disponibile nel PATH |
| `symlink-skipped` | collegamento simbolico non seguito |
| `invalid-manifest` | manifest non valido |
| `unreadable-manifest` | manifest non leggibile |
| `unreadable-directory` | cartella non leggibile |
| `unsafe-name` | nome non rappresentabile in sicurezza |
| `changed-path` | percorso cambiato durante la scansione |
| `changed-input` | file cambiato durante la scansione |
| `manifest-size-limit` | manifest oltre il limite di dimensione |
| `manifest-byte-limit` | limite di lettura dei manifest raggiunto |
| `entry-limit` | limite di elementi raggiunto |
| `directory-limit` | limite di cartelle raggiunto |
| `depth-limit` | limite di profondità raggiunto |
| `repository-limit` | limite di repository raggiunto |
| `warning-limit` | ulteriori avvisi omessi |

**Cosa fare.** Prima leggi l'elenco completo, che l'ingresso tronca ma il diagnostico no:

```bash
forgeyard analizza
```

Poi agisci sulla classe dell'avviso. Un limite raggiunto (`entry-limit`,
`directory-limit`, `depth-limit`, `repository-limit`) di solito significa che hai puntato
Forgeyard troppo in alto: scegli una cartella più specifica, quella che contiene davvero
il lavoro. Un problema di permessi (`unreadable-directory`, `unreadable-manifest`) si
risolve rendendo leggibile quel percorso o spostandolo fuori dalla cartella selezionata.
`changed-path` e `changed-input` indicano che qualcosa stava scrivendo mentre leggevamo:
chiudi build, watcher e indicizzatori e riesegui. `symlink-skipped` è dichiarato per
principio, perché i collegamenti simbolici non vengono mai attraversati.

#### «La cartella .forgeyard contiene file già tracciati»

```text
La cartella .forgeyard contiene file già tracciati. Un'esclusione non li rende personali: serve una migrazione esplicita.
```

Codice: `FY_PERSONAL_TRACKED`. Se invece l'indice Git non è stato nemmeno interrogabile,
il codice è `FY_PERSONAL_GIT`, con il messaggio `Impossibile verificare l'indice Git.
Nessuna registrazione autorizzata.`

**Causa.** Nell'indice del repository ci sono già file sotto `.forgeyard/`, probabilmente
committati da una versione precedente o da un'altra persona. **Un'esclusione Git non rende
privato un file già tracciato**: continuerebbe a comparire nei diff e nei commit, e
l'esclusione darebbe soltanto l'illusione contraria. Forgeyard si ferma perché la
soluzione richiede una decisione che non è sua: quei file appartengono alla storia del
repository.

**Cosa fare.** Guarda cosa c'è:

```bash
git ls-files -- .forgeyard
```

Poi decidi **tu**, esplicitamente, e mettilo in un commit: togliere quei file dall'indice
conservandoli sul disco (`git rm --cached`), oppure spostare il lavoro in una cartella
diversa. Forgeyard non lo fa al posto tuo e non usa mai `assume-unchanged` o
`skip-worktree` per nascondere il problema. Dopo il commit della migrazione, riesegui
`forgeyard`.

#### L'area personale esiste già, non è riconosciuta, o è in deriva

Diversi messaggi, tutti con lo stesso significato di fondo — **l'area che c'è non viene
toccata**:

| Messaggio | Codice |
|---|---|
| `L'area personale esiste già. Nessun contenuto è stato sovrascritto.` | `FY_PERSONAL_CONFLICT` |
| `Esiste già un'area .forgeyard non riconosciuta o incompleta. È stata preservata; serve una migrazione esplicita.` | `FY_PERSONAL_CONFLICT` |
| `La cartella .forgeyard non è un'area personale regolare; non verrà modificata.` | `FY_PERSONAL_CONFLICT` |
| `Un'altra operazione ha già preparato l'area personale. Nessun file sovrascritto.` | `FY_PERSONAL_CONFLICT` |
| `L'area personale è cambiata, incompleta o appartiene a un'altra cartella. I file non sono stati riscritti.` | `FY_PERSONAL_DRIFT` |
| `La topologia è cambiata dopo l'anteprima. Riapri forgeyard per rivedere il riepilogo.` | `FY_PERSONAL_STALE` |

Separato, e con esito `4`, il caso dell'inventario illeggibile:
`L'inventario dell'imbracatura in .forgeyard non è leggibile. Nessun file è stato scritto:
serve una verifica esplicita.`

**Attenzione a non confondere questi errori con la normalità.** Se la riga che leggi è
`Area personale: presente.` dentro il riepilogo di stato, non c'è nessun problema: è
l'ingresso che riconosce il lavoro già fatto e riprenderà soltanto i passi mancanti.

**Causa.** In `.forgeyard/` c'è qualcosa che non è un'area creata da Forgeyard, oppure lo
era e non lo è più: file estranei, registrazione mancante o modificata, regola di
esclusione riscritta, oppure una registrazione che nomina una cartella diversa — tipico di
una cartella copiata o rinominata. `FY_PERSONAL_STALE` è il caso più benigno: fra
l'anteprima e la conferma la cartella è cambiata, quindi il riepilogo che hai approvato non
descrive più la realtà.

**Cosa fare.** Per `FY_PERSONAL_STALE`, riesegui `forgeyard` e rileggi il riepilogo. Per
gli altri, apri `.forgeyard/` e guarda cosa contiene: i tuoi dati sono lì e non sono stati
riscritti. Se è un'area di una versione precedente o di un'altra cartella, la migrazione è
un atto tuo — spostare o rimuovere quel contenuto dopo averlo esaminato — e poi
`forgeyard` riparte. Se invece l'area è a posto e vuoi annullare l'ultima preparazione,
vedi [Come annullare un'operazione](#come-annullare-unoperazione).

Un caso a parte è il recupero interrotto, con codice `FY_PERSONAL_RECOVERY`: il programma
rimuove **soltanto** byte identici a quelli che aveva appena creato, e se trova
un'aggiunta concorrente o un file modificato conserva l'area e lo dichiara. Non cancella
mai ricorsivamente.

## Il collegamento con il client

#### Il collegamento nativo non riesce, e l'imbracatura resta installata

Su errore standard, con il nome del client al posto di `<Client>`:

```text
Collegamento nativo non configurato per <Client>: <causa>
```

e subito dopo:

```text
L'imbracatura resta installata. Installa o sblocca il client, poi riesegui forgeyard: verrà ripreso soltanto il collegamento.
```

Il codice di uscita è `4`, e **la riga finale di successo non viene emessa**: uscire con
successo significherebbe «pronto», e non lo è.

**Causa.** La `<causa>` porta il codice tecnico. I più probabili:

| Codice | Cosa è successo |
|---|---|
| `FY_NAMESPACE_CONFLICT` | il namespace `forgeyard` nel file del client esiste già ma non risulta nostro |
| `FY_BINDING_TRACKED` | la configurazione del client è **già tracciata** da Git: non ci scriviamo percorsi di macchina |
| `FY_BINDING_DRIFT` | un blocco posseduto è cambiato sotto di noi; viene preservato |
| `FY_BINDING_INVALID` | i metadati locali di proprietà, o la configurazione MCP del progetto, non sono validi |
| `FY_BINDING_RECOVERY_REQUIRED` | una disconnessione posseduta è rimasta a metà |
| `FY_STATE_UNSAFE` / `FY_PATH_UNSAFE` | la proprietà locale finirebbe dentro il progetto, o l'esclusione Git fuori dalla directory Git comune |

**Cosa fare.** Per `FY_NAMESPACE_CONFLICT`, apri `.mcp.json` (Claude Code) o
`.codex/config.toml` (Codex) e guarda chi possiede quel namespace: se è una
configurazione tua precedente, rimuovila consapevolmente; Forgeyard non sovrascrive
configurazioni estranee. Per `FY_BINDING_TRACKED`, la configurazione del client è sotto
controllo di versione: usa un file di configurazione del progetto deliberatamente non
tracciato, perché committare i percorsi di questa macchina romperebbe il repository per
tutti gli altri. Per `FY_BINDING_RECOVERY_REQUIRED`, completa prima la disconnessione:

```bash
forgeyard disconnect --root .
```

In tutti i casi, dopo aver risolto riesegui `forgeyard`: l'area e l'imbracatura sono già a
posto e verrà ripreso **soltanto** il collegamento.

#### Il client è aperto ma non sembra usare la forgia

L'assistente risponde come farebbe in una cartella qualsiasi: nessun segno che stia usando
gli strumenti della forgia.

**Causa.** Due possibilità, e vanno distinte.

La prima: il namespace è scritto ma il client non lo ha ancora **abilitato**. Scrivere la
configurazione non equivale a ottenere la fiducia del client, e Forgeyard non se la
concede da sola. Il messaggio finale dell'ingresso lo dice: `se il client chiede di
abilitare il server, fallo con i suoi controlli e riapri il progetto.`

La seconda, che va detta: **nessuna prova live con un account Claude Code o Codex reale è
mai stata eseguita.** Che un client legga quel namespace, chieda la fiducia che deve
chiedere e attraversi il workflow è, alla data, non verificato. Tutto ciò che è dichiarato
verificato qui lo è da test strutturali.

**Cosa fare.** Prima verifica che dalla nostra parte sia tutto scritto:

```bash
forgeyard
```

Se fra le righe di stato leggi `Collegamento nativo: presente.` la configurazione c'è, e
se non manca nient'altro seguirà `Niente da preparare: nessun file scritto.` A quel punto
il resto sta nei controlli del client:
abilita o approva il server MCP di progetto con la sua interfaccia, poi **riapri il
progetto**. Controlla anche che nella cartella esista il file previsto (`.mcp.json` per
Claude Code, `.codex/config.toml` per Codex) e che il puntatore alle istruzioni sia
presente in `CLAUDE.md` o `AGENTS.md`.

Se dopo tutto questo il client continua a ignorare la forgia, non stai inseguendo un
difetto noto: sei oltre il confine di ciò che è stato verificato. Vedi
[Stato](../STATO.md).

#### L'assistente dice che una modifica è stata negata da Forgeyard

Nel client uno strumento di scrittura (`Edit`, `Write`, `NotebookEdit`) viene rifiutato con un
messaggio che comincia con `Forgeyard denied this file tool because ...`.

**Causa.** È il guard di scrittura, e quasi sempre **sta facendo il suo lavoro**: rifiuta
prima che il file venga toccato, invece di accorgersene dopo. Il motivo è nella coda del
messaggio.

| La coda del messaggio | Cosa è successo | Cosa fare |
|---|---|---|
| `no current native work order defines a write scope for this project` | non c'è un ordine di lavoro corrente: il piano non è stato approvato, o la sessione non ha il ruolo di scrittore | fai approvare il piano nel client; l'approvazione umana non ha scorciatoie |
| `the requested file is outside the claimed task write scopes` | il file è fuori dagli ambiti che l'attività corrente ha dichiarato | se serve davvero, si cambia il piano e lo si riapprova, non si aggira |
| `the requested file is a protected project path` | il file sta in un percorso protetto (Git, l'area personale, le istruzioni, la configurazione dei client) | quei percorsi non si modificano dall'interno del lavoro assistito |
| `the requested file is outside the selected project` | il percorso esce dal progetto | è il confine di scrittura |
| `the requested file resolves through a link outside the selected project` | il percorso esce dal progetto **attraverso un collegamento** | il confine vale anche per i collegamenti: è controllato sul percorso risolto, non su quello scritto |
| `the tool input does not contain a supported file path` | lo strumento non ha passato un percorso utilizzabile | non è una regola sul tuo progetto: il guard non rifiuta ciò che non riesce a leggere |
| `the guard could not validate trusted task state` | il guard non ha potuto leggere lo stato di cui si fida, e in dubbio rifiuta | è l'unica riga che può indicare un difetto invece di una regola |

**Se però sono negate *tutte* le scritture**, anche subito dopo un'approvazione valida, non
è una regola: è un difetto. Un guard che nega tutto ha l'aspetto di un guard severo, ed è
un guard che non ha mai girato. È già successo una volta — il guard e il servizio
risolvevano lo stesso percorso in due grafie diverse, e le due identità non combaciavano —
ed è corretto e coperto da un test. Se ricapita è da segnalare come bug, non da aggiustare
cambiando configurazione.

#### Il programma si ferma dicendo che lo stato privato precede un cambiamento incompatibile

Uno strumento nativo (`fy_attach`, `fy_context`, o qualunque altro del protocollo) risponde
con il codice `FY_STATE_INCOMPATIBLE`, e il messaggio dichiara due numeri di schema: quello
che lo stato registrato porta e quello che questa versione di Forgeyard scrive.

**Causa.** Lo stato privato del lavoro nativo — non un file del progetto, ma una directory
fuori dall'albero di lavoro dove il runtime tiene revisione, attività e operazioni — è stato
scritto da una versione di Forgeyard precedente a un cambiamento della sua forma, e non
esiste una migrazione fra le due. Leggerlo come se fosse quello di oggi comparirebbe come un
errore generico su un campo assente: il controllo lo dichiara invece, con i due numeri di
schema.

**Cosa fare.** Rimuovi quella directory di stato privata e ricomincia un lavoro: nessun file
del progetto viene toccato, perché quello stato non ha mai vissuto nel repository.
## Verdetti e controlli

#### Un verdetto di consegna è `blocked` con `evidence:unsupported-verdict`

Il certificato di consegna non dichiara `delivered` ma `blocked`, e fra i divari compare
`evidence:unsupported-verdict`.

**Causa — ed è il punto: questo è il meccanismo che funziona, non un difetto.** È la
garanzia G2. Ogni affermazione porta un livello dichiarato — `executed` (un gate è stato
eseguito), `observed` (dei byte sono stati letti), `derived` (un'inferenza che cita
evidenza superiore), `asserted` (prosa del modello) — e la regola che dà valore all'intera
scala è una sola: **un verdetto che si appoggia a prosa non può essere emesso**. Anche un
supporto vuoto non è un supporto. Quel divario compare esattamente quando il supporto del
verdetto non è certificabile, ed è un gate, non una nota a piè di pagina.

Di norma non compare da solo. Accanto possono esserci altri divari, che dicono cosa manca
in concreto: `gate:<attività>/<gate>` per un gate richiesto che non è passato sulla
revisione corrente, `criterion:<attività>/<criterio>` per un criterio non soddisfatto,
`test-gate:missing:<attività>` per un'attività che scrive senza un gate di riepilogo dei
test, `review:required`, `review:unresolved-findings`,
`review:independent-provenance-required` per la review, `git:dirty-inputs` per un albero
di lavoro sporco, `operation:active-or-uncertain` per un'operazione ancora in corso o di
esito incerto, `timebox-exhausted` e `repair-budget-exhausted` per i budget.

**Cosa fare.** Non cercare di aggirarlo: produci l'evidenza che manca. Leggi gli altri
divari e chiudili uno per uno — esegui i gate richiesti sulla revisione testata, lega i
criteri a evidenza corrente, registra la review dove serve, pulisci gli input Git — poi
fai riderivare il verdetto. Se qualcosa cambia dopo, il completamento si **riapre**: un
rapporto vecchio resta un documento storico, non una prova corrente. Il ragionamento
completo è in [Garanzie](garanzie.md).

Una forma diversa dello stesso rifiuto è `FY_CLAIM_INVALID`, che respinge le affermazioni
non verificabili prima ancora di pesarle: un'impronta che non è uno sha256 minuscolo, un
istante mal formato, un identificativo duplicato, una derivazione circolare o derivata da
prosa.

#### Il controllo `harness-drift` segnala deriva

Nel rapporto di `forgeyard doctor` il controllo `harness-drift` non risulta passato. Il
messaggio dichiara i conteggi per severità e i primi rilievi, e finisce con la frase che
conta: `Drift is reported without failing the installation verdict: a project that grew is
not a broken install.`

**Causa. Non è un'installazione rotta.** È la garanzia G4: l'imbracatura ha congelato un
profilo del progetto — tipo, linguaggi, framework, gate, file posseduti — e il progetto
nel frattempo è cambiato. La documentazione che invecchia è un difetto
rilevabile, e questo controllo è il rilevatore. Il controllo **non è richiesto**: nessun
suo esito affonda il rapporto.

Lo stesso controllo ha altri due esiti che non sono deriva. `unavailable` significa che
non c'era una capsula congelata leggibile, oppure che il progetto non è stato ispezionabile
in sola lettura: non è un giudizio sul progetto. `skipped` copre tre casi, e il messaggio
dice quale:

| Il messaggio dice | Significa |
|---|---|
| `the project inspection stopped at its bounds (...)` | l'ispezione si è fermata su un limite dichiarato, quindi l'allineamento non è dichiarabile: non aver visto una cosa non prova che non ci sia |
| `what the remaining differences rest on is not something this inspection observes` | il rilievo poggia su un'osservazione che l'ispezione non fa. È l'esito normale di una cartella appena preparata: il gate lo dichiara chi prepara, e può invocare un programma che l'ispezione non enumera |
| `differs from the frozen harness without contradicting what it needs to operate` | ci sono differenze **sotto** la severità bloccante, riportate senza emettere un verdetto |

**Cosa fare.** Leggi i rilievi e poi scegli, esplicitamente, una delle due strade che il
controllo stesso indica come rimedio: aggiornare l'imbracatura, oppure ripristinare ciò che
l'imbracatura congelata dà per assunto. Non c'è una terza strada che «ricertifichi»
modificando il lock. Un input malformato al confronto è invece `FY_DRIFT_INVALID`.

Da non confondere con `FY_CAPSULE_DRIFT`, che è G1 e **blocca**: se un file
dell'imbracatura non corrisponde più alla propria impronta, la capsula non si apre e il
lavoro si ferma, invece di procedere su basi diverse da quelle approvate.

## Come annullare un'operazione

#### Hai preparato la cartella e vuoi tornare indietro

```bash
forgeyard rollback
```

**Senza argomenti.** Non devi trovare l'identificatore di un'operazione: l'unica
operazione reversibile è comunque l'ultima, quindi chiedere a una persona di cercarne il
nome aggiungerebbe una ricerca senza aggiungere una scelta. Il comando mostra
**un'anteprima** di cosa verrebbe rimosso e cosa ripristinato, e chiede **una conferma**
prima di scrivere, con risposta predefinita no. Da un'altra cartella, indica la radice con
`--root`. Senza un terminale interattivo il comando si ferma all'anteprima, come
l'ingresso.

Se in quella cartella non c'è niente da annullare, il comando risponde con
`FY_OPERATION_UNKNOWN` e il messaggio `Questa cartella non ha operazioni Forgeyard da
annullare.`, con l'indicazione di eseguire `forgeyard` per prepararla.

Due limiti che vale la pena conoscere prima. Il rollback si ferma con
`FY_OWNERSHIP_CONFLICT` se dovrebbe sostituire un file sconosciuto o modificato
localmente: rimuove soltanto i file gestiti rimasti invariati e conserva i file seme
umani. E **non** rimuove il collegamento nativo, che vive in una proprietà locale separata:
per quello serve il comando dedicato.

```bash
forgeyard disconnect --root .
```

Anche `disconnect` rimuove soltanto i blocchi posseduti e rimasti invariati, e lascia dove
sono l'imbracatura del progetto e qualunque configurazione estranea.

## Per chi sviluppa sul repository

#### Un test scade, e sembra colpa della macchina

Quasi sempre non lo è. Su questo repository tre gruppi di test venivano dati per
«fallimenti ambientali» — carico della macchina, scanner di file, forma dei percorsi
Windows — e una misura li ha smentiti tutti e tre: erano tetti di tempo più stretti del
lavoro che delimitavano, e una fixture che costruiva un percorso non canonico.

*Cosa fare:* riesegui il gruppo isolato **e cronometra ciò che fa davvero**. Se il lavoro
dentro il test impiega più del suo tetto, il difetto è nel tetto. I test che installano
un'imbracatura reale — caricamento del registro, rendering, applicazione, comandi Git —
dichiarano il proprio tetto in testa al file, perché costano molto più di un test unitario.

Soltanto dopo aver misurato, un esito può essere attribuito all'ambiente. Prima di allora
non è un esito rosso e non è un esito verde: è una diagnosi non sostenuta, e vale quanto
qualunque altra affermazione non sostenuta.

In generale, prima di dichiarare un incremento verificato vale la verifica completa:

```bash
npm run verify
```

e va sempre tenuta la distinzione fra test locali, CI e prove reali nelle app. **I test non
costituiscono una prova di integrazione live con Claude Code o Codex.**

## Dove guardare ancora

| Se cerchi | Vai a |
|---|---|
| il percorso completo dal nulla al primo risultato | [Primo avvio](primo-avvio.md) |
| cosa si può fare oggi e cosa resta da collegare | [Uso](uso.md) |
| cosa promette ogni meccanismo e cosa lo fa fallire | [Garanzie](garanzie.md) |
| quali moduli esistono e quali confini rispettano | [Architettura](architettura.md) |
| cosa è implementato, cosa no, cosa non è mai stato provato live | [Stato](../STATO.md) |
| i comandi oltre l'ingresso, e quali sono in dismissione | [Comandi avanzati](../percorsi-legacy.md) |
