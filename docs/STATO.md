# Stato di Forgeyard

## Aggiornamento del 22 ottobre 2026: consenso leggibile

Il dialogo Windows presenta un riepilogo in italiano: progetto, operazione richiesta,
file interessati, comandi previsti, limiti e autorizzazioni escluse. Preparazione,
approvazione del piano, ripresa e recuperi hanno testi e pulsanti specifici. Nei recuperi
che non autorizzano sviluppo, i comandi non sono presentati come eseguibili.

Il primo restyling non bastava: il testo del collaudo era ancora scritto per sviluppatori.
La finestra distingue ora il permesso (modificare i file elencati ed eseguire i controlli)
dal lavoro proposto. Il clic sul piano registra il consenso, non esegue subito la modifica.
Le indicazioni di `fy_plan` chiedono una descrizione comprensibile del risultato, con esempi
prima/dopo quando utili. È una guida per l'assistente, non una garanzia automatica di
comprensibilità: il testo salvato resta integrale, senza riscritture nascoste.

La finestra resta nativa, senza browser, server o nuove dipendenze. I dettagli tecnici
conservano piano esatto, impronte, informazioni della richiesta e politica completa in
sola lettura. Il testo del progetto resta un dato, mai codice da eseguire. Nessun pulsante
di approvazione è associato automaticamente a Invio; Annulla e la chiusura restano rifiuti.

Le prove Windows costruiscono i controlli senza mostrare un consenso né registrare
autorizzazioni. Verificano anche Unicode, ritorni a capo, riepiloghi mancanti e un percorso
lungo nella finestra stretta. Le anteprime isolate sono renderizzate dai controlli reali;
il dettaglio è stato aperto e confrontato con il contenuto completo. Queste prove non
sostituiscono il clic di una persona nella nuova interfaccia.

Il primo consenso reale è riuscito avviando il comando da una PowerShell aperta dall'utente.
La riconciliazione è stata riletta dallo stato; il vecchio piano si è poi fermato per
`timebox-exhausted`, senza azzerare il limite. Il nuovo piano di collaudo è in attesa di
approvazione. Il prodotto temporaneo non è stato implementato e il giro completo con
Codex resta non verificato.

Verifica della nuova interfaccia: `npm run verify` con uscita 0, 85 file di test,
674 prove superate e una saltata; ultima fase test in 57,81 s. Superati anche catalogo,
provenienza, audit di release e controllo del pacchetto. Nessuna nuova dipendenza.

## Collaudo del 22 ottobre 2026: visibilità del consenso Windows

La ripetizione ha isolato un difetto concreto nell'avvio della finestra: `execa`
usa `windowsHide: true` per impostazione predefinita. Con lo stesso script e lo
stesso piano, WinForms dichiarava `Visible: true`, ma Windows riportava
`IsWindowVisible: false`. Cambiando soltanto l'opzione in `windowsHide: false`,
il controllo Windows è diventato vero. `-WindowStyle Hidden` resta per nascondere
la console di PowerShell, non il dialogo.

La correzione è coperta da un test prima rosso e poi verde sul contratto di avvio.
La finestra del comando reale corretto espone ora titolo e handle e risulta
visibile secondo le API di Windows. **Nel primo tentativo avviato dalla chat l'utente
non ha confermato di vederla né effettuato un clic**; il tentativo è scaduto senza
decisione, senza consenso e senza cambiare il writer o i sorgenti di prova.
La causa della mancata visibilità dal lato utente resta da chiarire: questa
correzione non dimostra il giro completo con Codex.

Non sono stati azzerati il limite temporale del vecchio piano, i permessi o le
verifiche del consenso. In quel momento il collaudo è rimasto in pausa; la successiva
riconciliazione umana da PowerShell e il nuovo piano sono descritti nell'aggiornamento sopra.

Verifica locale: `npm run verify` con uscita 0, 85 file di test,
664 prove superate e una saltata; fase test in 219,55 s. Catalogo, provenienza,
audit di release e contenuto del pacchetto verificati. Non è un esito di CI o
una consegna certificata del prodotto di prova.

## Collaudo del 21 ottobre 2026: pacchetto e Codex

Il pacchetto npm locale è stato installato in una directory temporanea separata dal
checkout, senza pubblicarlo su npm. L'ingresso ordinario ha preparato un piccolo
repository JavaScript, recuperando sei capacità dalla fonte reale e fissandone il commit.

La prova ha trovato due difetti, ora corretti con test prima rossi e poi verdi:

- le capacità generate fuori da `.forgeyard` restavano visibili a Git. Il collegamento
  esclude ora i soli file installati, invariati e non tracciati; i seed preesistenti e i
  file estranei restano visibili. Le esclusioni sono locali e il distacco le rimuove;
- la ricognizione ometteva le cartelle dei test dagli ambiti modificabili. Le cartelle
  esistenti `test`, `tests` e `__tests__` sono ora riconosciute insieme al codice.

La revisione ha corretto anche due casi limite: con soli test resta disponibile la radice
predefinita `src`; con più worktree già collegati, le nuove esclusioni della suite vengono
rifiutate prima di scrivere il collegamento (`FY_PRIVACY_SCOPE`), perché `info/exclude` è
condiviso e potrebbe nascondere file personali negli altri alberi. Non è stata introdotta
una configurazione Git alternativa. Prima di aggiungere worktree a un repository già
preparato, rimuovere il collegamento posseduto: le sue esclusioni sono comuni, non isolate.

L'anteprima dichiara anche le superfici generate fuori da `.forgeyard`. Nel repository
temporaneo corretto è stato committato soltanto il puntatore portabile aggiunto ad
`AGENTS.md`, non la suite.

**Il giro completo con Codex resta non verificato.** Codex CLI autenticato, versione
`0.163.0-alpha.11`, ha prima rifiutato una configurazione personale estranea alla factory;
isolata quella configurazione per la sola invocazione, le sessioni risultavano in sola
lettura e rifiutavano perfino la lettura della skill. Nessuna impostazione globale è stata
cambiata. Dalla sessione Codex corrente, il protocollo locale alternativo ha attraversato
contesto, acquisizione del writer e piano reale. La conferma successiva non è apparsa
all'utente: il processo non esponeva una finestra e il tentativo è stato chiuso senza
consenso (`FY_CONFIRMATION_UNAVAILABLE`). Una diagnostica senza finestra ha verificato
il trasporto del piano fino al punto di visualizzazione, non la visualizzazione stessa.

Non sono stati modificati i sorgenti del prodotto di prova, né eseguiti gate di consegna.
Implementazione, interruzione/ripresa durante il lavoro e consegna certificata restano
da provare da un client interattivo in grado di mostrare il consenso. Non sono stati
aggiunti aggiramenti del consenso o modificati i permessi dell'account.

La pausa prima dell'implementazione è stata registrata con `fy_pause` e riletta con
`fy_context` da un processo nuovo. Non è una prova di ripresa dopo un consenso.

Un giro della verifica completa ha trovato anche una race preesistente nel test di pausa:
la prova tentava di fermare un gate ancora in preparazione, mentre il suo avvio cambiava
la revisione. Il rifiuto del runtime era corretto; il test aspetta ora l'avvio effettivo.
La pulizia delle fixture cancella i propri job prima di chiudere i servizi, così una
prova fallita non resta sospesa su un gate fittizio in attesa di cancellazione. Nessun
controllo di revisione del prodotto è stato indebolito.

Verifica finale locale: `npm run verify` con uscita 0, 85 file di test,
663 prove superate e una saltata; fase test in 57,03 s. Catalogo esterno, provenienza,
audit di release e contenuto del pacchetto verificati. Non è un esito di CI o del giro live.

## Aggiornamento del 21 ottobre 2026: catalogo esterno

Il catalogo incorporato è stato sostituito con riferimenti alle fonti. Le nuove
preparazioni scaricano i soli plugin selezionati e la licenza dalla revisione corrente;
il progetto registra il commit esatto. Il riuso conserva la revisione installata,
mentre `update` propone quella corrente. I contenuti scaricati sono conservati in una
cache esterna al repository. I test della factory usano una piccola fonte controllata,
senza dipendere da Internet. È stato provato anche il recupero reale da GitHub e il
rendering del profilo curato, senza scrivere un progetto di prova. Questo non è una
prova live in un client AI autenticato.

La verifica locale dell'incremento (`npm run verify`) è terminata con uscita 0:
85 file di test, 656 prove superate e una saltata; fase test in 55,29 s. Sono passati
anche typecheck, build, riferimenti esterni, provenienza, audit e controllo del pacchetto.

Le sezioni seguenti conservano le misure storiche di settembre, compresi i conteggi
del vecchio snapshot: non descrivono il contenuto del pacchetto corrente.

Registrato il **23 settembre 2026** sul branch `refactor/forgia-personale-workspace`.
Questo documento vale alla data indicata: il prodotto è in ristrutturazione, e va riletto
insieme al registro dei commit. Per la tesi e i confini di progetto, vedere
[la direzione](DIREZIONE.md).

Tre livelli, tenuti distinti in tutto il documento:

| Livello | Significato |
|---|---|
| **implementato** | esiste il codice, con i propri test automatici |
| **sul percorso** | un comando ordinario lo attraversa, non solo i suoi test |
| **provato live** | eseguito davvero contro un account Claude Code o Codex |

## Il confine più importante

**Nessuna prova live completa con account Claude Code o Codex è stata conclusa.** Tutto ciò
che è dichiarato verificato in questo repository è verificato da test strutturali,
locali o di CI: rendering deterministico, confini di scrittura, integrità delle
impronte, riproducibilità della provenienza. Un test di trasporto sull'SDK ufficiale
non è una sessione autenticata; un controllo strutturale non prova il comportamento di
un client reale, delle sue autorizzazioni o della sua interfaccia.

Dove questo documento dice «sul percorso», intende *il percorso del programma*. Non
intende che qualcuno abbia visto Claude Code o Codex attraversarlo.

## Le sei garanzie

Le garanzie sono descritte una per una, con le loro modalità di fallimento, in
[Garanzie](guide/garanzie.md).

| Garanzia | Sede | Implementato | Sul percorso |
|---|---|---|---|
| G1 identità congelata | `src/capsule/capsule.ts` | sì | sì: la capsula è letta e verificata dal runtime nativo |
| G2 evidenza classificata | `src/evidence/epistemic.ts` | sì | sì: il verdetto di consegna `fy_finalize` |
| G3 citazioni vive | `src/evidence/citations.ts` | sì | sì: validazione dei riferimenti di evidenza nel runtime nativo |
| G4 deriva rilevata | `src/drift/scan.ts` | sì | sì: controllo `harness-drift` del doctor |
| G5 misura dichiarata | `src/measure/accounting.ts` | sì | sì: contabilità nel certificato di consegna, senza linea di base umana |
| G6 coerenza dell'imbracatura | `src/doctor/harness-lint.ts` | sì | sì: gate su `buildInstallPlan`, quindi su ogni percorso di installazione |

**Tutte e sei attraversano un percorso ordinario.** Per G5 vale una precisazione che non
va arrotondata: il certificato riporta la contabilità del lavoro agentico, ma il confronto
con un costo umano compare **soltanto** se qualcuno ha dichiarato una linea di base in
`forgeyard.yaml`. In sua assenza il confronto è **assente**, non stimato.

## Gli incrementi del piano

| ID | Obiettivo | Stato |
|---|---|---|
| P0 | verifiche riproducibili, SBOM indipendente dalla piattaforma | implementato |
| P1 | ricognizione in sola lettura del workspace | implementato |
| P2a | ingresso senza argomenti, riepilogo italiano, registrazione privata | implementato |
| P2b | installazione della suite nell'area personale | implementato |
| P3 | collegamento nativo ai client dall'area personale | implementato, **mai provato live** |
| P4 | inventario e riuso dei componenti globali già presenti | inventario fatto; il riuso è un'altra cosa (sotto) |
| P5 | esecuzione su più repository membri | implementato, **mai provato live** |
| P6 | selezione unificata e profili pertinenti | la contraddizione fra le due sedi è chiusa (sotto); l'unificazione no |
| P7 | percorso ordinario interamente italiano, rimozione dei percorsi legacy | in corso |

Un solo comando, `forgeyard`, porta una cartella da vuota a preparata: ricognizione, una
domanda di prodotto, una conferma, area personale, imbracatura installata, collegamento
nativo invocato. Ogni passo è dichiarato e alla riesecuzione vengono ripresi soltanto
quelli mancanti.

**Il confine di P3 resta quello che conta.** Il collegamento scrive un namespace MCP
posseduto nel progetto, e questo è stato verificato: l'osservazione dello stato riconosce
ciò che lo scrittore reale produce, per entrambi i client. Ma **nessuno ha mai aperto una
cartella così preparata in un Claude Code o in un Codex autenticato.** Che il client legga
quel namespace, chieda la fiducia che deve chiedere e attraversi il workflow è, alla data
di questo documento, non verificato. Il messaggio finale dell'ingresso lo dichiara invece
di dedurlo, e lo stesso confine è dichiarato a chi prova per la prima volta in
[Primo avvio](guide/primo-avvio.md).

## Cosa la misura ha detto su P5

Misurata all'inizio di questo lavoro, su un workspace con due repository membri: l'ingresso
guidato lo riconosceva correttamente (`multi-repository`, 2 repository, 2 progetti) e
**installava l'imbracatura senza obiezioni**, 79 file. Poi il primo `fy_attach` rispondeva
`FY_GIT_REQUIRED`: il runtime legava un lavoro a un solo albero Git e a un solo HEAD, e alla
radice di quel workspace non ce n'era nessuno.

Il prodotto **preparava volentieri una cartella in cui si sarebbe poi rifiutato di
lavorare**, senza dirlo prima della conferma. Un'imbracatura installata e inerte non era una
funzione mancante: era un effetto non dichiarato travestito da limite tecnico.

Quel legame è cambiato, non soltanto l'avvertimento che lo dichiarava: un lavoro nativo
attraversa ora più repository membri di uno stesso workspace. Le prove si legano agli HEAD
dei **soli membri toccati**; un'attività non può mescolare membri, e un piano che lo fa
viene rifiutato prima che qualunque lavoro parta (`FY_PLAN_INVALID`); un gate gira dentro il
membro che possiede la sua attività, non alla radice del workspace. L'anteprima non stampa
più l'avvertimento su questo caso: il limite dichiarato ora vale soltanto per una cartella
senza alcun repository, dove resta vero.

Un limite residuo dell'anteprima va registrato, e non è nuovo: un membro presente ma senza
ancora un commit non riceve l'avvertimento, perché il controllo conta i repository trovati
dalla ricognizione, non i loro commit. Il rifiuto arriva comunque, a `fy_plan`, che nomina il
membro senza commit. Lo stesso buco esisteva già, prima di questo lavoro, per una radice
senza commit: non è una regressione, è un limite conosciuto scritto invece che taciuto.

Due cose restano scoperte, e per due ragioni diverse. La **prova live** manca per lo stesso
motivo di P3: queste sono prove strutturali su fixture con Git vero, e nessuno ha ancora
aperto un workspace a due repository in un Claude Code o in un Codex autenticato — una prova
strutturale non è una prova live con un client. La **consegna parziale** — finalizzare un
lavoro che ha consegnato in un membro e non nell'altro — manca per scelta di design, non per
limite tecnico: «il frontend è rilasciabile senza il backend?» è una domanda di prodotto, e
non ha una risposta tecnica che questo programma possa dare al posto di chi lo usa.
## Cosa la misura ha detto su P6

«Selezione unificata» presupponeva che ce ne fosse una. Ce n'erano due: l'ingresso guidato
compone il profilo `tailored` dalle regole in `sources/capabilities.yaml`, mentre
`init --profile hackathon` leggeva un elenco di 22 plugin scritto a mano. Due sedi per la
stessa domanda, e la più permissiva installava cinque volte tanto.

La contraddizione non era teorica. Le regole **escludono** `agent-orchestration`,
`agent-teams`, `conductor` e `full-stack-orchestration` con la motivazione «Forgeyard è l'unico
flusso di consegna primario». Il profilo curato **li installava tutti e quattro**, perché le
esclusioni erano applicate soltanto in `compose.ts` e `resolve.ts` non le consultava. Non una
scelta: un'omissione, del tipo che «una regola, una sede» prevede esattamente.

Altri tre — `before-you-build`, `pptx-deck-creation`, `startup-business-analyst` — erano nel
profilo senza alcuna ragione registrata, mentre ogni scelta di `tailored` ne porta una.
`pptx-deck-creation` serviva le slide, che non esistono più. Una capacità per cui nessuno ha
scritto un perché è un'affermazione, non una selezione: sono stati tolti, e tornano scrivendo
la ragione in `sources/capabilities.yaml`.

Risultato misurato: il profilo curato passa da 22 a **15** capacità, e l'installazione da 339 a
**249** file per Codex. Due controlli lo tengono fermo
(`tests/unit/meta/profile-selection.test.ts`): nessun profilo installa ciò che le regole
escludono, e nessuno seleziona ciò di cui non sa dire il perché.
## Cosa la misura ha detto su P4

P4 era scritto come «inventario e **riuso** dei componenti globali». Il riuso, come lo
immaginavamo, non esiste: su questa macchina il client ha **10 plugin** dal marketplace
`claude-plugins-official`, il nostro catalogo ne distribuisce **92** da `wshobson/agents`, e i
nomi in comune sono **zero**. Non c'è niente da non reinstallare.

Il problema vero è un altro, e si vede negli stessi dati: le funzioni si sovrappongono anche
quando i nomi no. Il client fornisce già `superpowers`, che porta la propria disciplina su TDD,
debug e su quando si può dire «fatto»; noi installiamo `tdd-workflows`, `debugging-toolkit` e la
scala dell'evidenza. Non sono file duplicati: sono **autorità concorrenti**, ed è esattamente il
problema che questa suite dice di voler togliere.

Quindi P4 dichiara e non deduce. L'anteprima nomina i plugin che il client fornisce **per
questa cartella** prima della conferma, e si ferma là: due plugin di marketplace diversi con
funzione simile non sono lo stesso artefatto, e affermare un'equivalenza che non possiamo
provare sarebbe il difetto che la scala dell'evidenza esiste per impedire.

Un plugin installato con `scope: local` appartiene al progetto che il registro nomina.
Su questa macchina sono 10 su 13, e nessuno di essi vale qui.
## Rimozioni compiute

Il **pacchetto presentazione è stato rimosso** il 23 settembre 2026: `packs/presentation/`,
i due auditor, la skill `forgeyard-showcase`, l'attività T004, la sezione `presentation` della
configurazione e i golden corrispondenti non esistono più. Un motore di slide non appartiene a
una fabbrica di imbracature, e la sua sola garanzia — che i byte generati non chiamino la rete
— sopravvive come regola generale `content.remote-asset`, che ora sorveglia ogni file web
generato, incluso il guard di scrittura.

Il **ciclo di vita legacy è stato rimosso** il 22 settembre 2026: `src/orchestrator/`,
`src/worktrees/`, `src/observability/`, `src/guard/` e i comandi `task`, `workspace`,
`ledger` e `guard` non esistono più. Sono sopravvissuti il contratto di attività e le
ricevute di verifica, e il guard di scrittura è diventato nativo soltanto. Il profilo
manuale `full` è stato rimosso; resta `hackathon` come selezione curata.

Ciò che resta di essi è descritto, per la sola manutenzione, in
[Comandi avanzati](percorsi-legacy.md). Non è la guida di ingresso, e non va ampliato.

Già dismesso: l'**adapter Cursor**. Il prodotto rende un'imbracatura per Claude Code e
per Codex, e `HARNESS_IDS` ha due valori, quindi un terzo adapter è un errore di tipo
e non un percorso morto. Le esclusioni protettive di `.cursor` restano dove servono: la
ricognizione non attraversa quella directory e il runtime rifiuta scritture al suo
interno. Non possedere un percorso non significa poterlo toccare.

## Difetti che i nostri controlli hanno trovato

Vale registrarli: un controllo che non ha mai trovato nulla non è ancora un controllo.

- **Il lint dell'imbracatura (G6), al primo giro.** Il template di istruzioni sempre
  installato rimandava a `PROJECT.md` e a `.forgeyard/handoffs/CURRENT.md`, che soltanto
  il pack `delivery` installa. Con il profilo `minimal` la forgia consegnava istruzioni
  che puntavano a due file inesistenti. Nessuno se ne era accorto, perché un file
  Markdown non verifica sé stesso. La frase è ora derivata dagli slot effettivamente
  renderizzati, calcolata in una sola sede e usata da entrambi gli adapter.
- **Il lint sulle imbracature reali.** Alla data di questo documento, dopo quella
  correzione il profilo `minimal` risulta coerente su entrambi gli adapter. Con il
  catalogo di terze parti installato il lint **dichiara** circa 344 rilievi — tra cui 28
  riferimenti interni che quella composizione non installa — e **non respinge**
  l'installazione: quei byte sono conservati identici sotto la loro licenza e non sono
  nostri da riparare. È la differenza fra dichiarato e bloccante, misurata.
- **Il guard di scrittura che negava tutto.** Il hook risolveva la radice del progetto con
  `realpathSync`, il servizio con la `realpath` asincrona: su Windows la prima conserva la forma
  breve 8.3 di un componente del percorso, la seconda la espande. Due grafie della stessa
  cartella producono due identità di workspace, quindi il hook non trovava lo stato del
  progetto e negava **ogni** scrittura. Un guard che nega tutto sembra un guard severo ed è un
  guard che non ha mai girato: il difetto era invisibile a occhio e l'ha trovato il test di
  integrazione del protocollo nativo. Ora entrambi i lati usano lo stesso risolutore, e un test
  lega le due sedi invece di un commento.
- **Il controllo di deriva che bocciava ogni installazione nuova.** Due volte lo stesso errore
  di categoria, già commesso e corretto per i percorsi protetti: `harness-drift` smentiva una
  **dichiarazione** con un'**osservazione** presa da un altro vocabolario.
  I gate congelati li dichiara chi prepara, e possono invocare un programma che l'ispezione non
  enumera: ogni cartella appena preparata risultava in deriva bloccante. Le radici scrivibili
  sono una concessione e non un avvistamento: un profilo che concedeva una radice di cui non
  installava il contenuto faceva risultare rotta ogni sua installazione corretta. Il confronto
  sui gate vale ora soltanto dove i due vocabolari si toccano, e le politiche di percorso —
  protette o scrivibili — non si confrontano affatto. Entrambi i difetti li ha trovati la
  verifica completa, non una rilettura del codice.
- **Il lint dell'imbracatura, la seconda volta.** Correggendo quel guard ho lasciato in un
  commento il percorso assoluto della macchina su cui stavo lavorando, nome utente compreso.
  Il lint (**G6**) ha rifiutato l'installazione prima che il file venisse scritto: un template
  che finisce in ogni progetto non porta con sé il percorso di chi l'ha scritto.
- **Il confronto byte per byte dello SBOM.** Il generatore arricchiva il lock con le
  homepage dei pacchetti presenti in `node_modules`: i binding nativi opzionali
  installati su Linux e su Windows sono diversi, quindi l'artefatto non era
  riproducibile. La serializzazione usa ora soltanto il lock normalizzato; una licenza
  mancante resta `NOASSERTION` invece di essere recuperata dal disco.

## Stato delle verifiche

Alla data di questo documento, e su questa macchina:

- `npm run verify` è la verifica completa: typecheck, test, build, controllo byte per byte
  del catalogo vendored, provenienza rigenerabile, audit di release e contenuto del
  pacchetto. La CI controlla Linux e Windows, e non rigenera i risultati attesi prima di
  confrontarli.
- **Il 28 settembre 2026 `npm run verify` è passato interamente su questa macchina in 950,60 s,
  con codice di uscita 0**: 81 file di test, 612 prove superate, una saltata e nessuna fallita;
  catalogo verificato byte per byte (**1.007 file sorgente**, **211.594 righe fisiche**),
  provenienza rigenerabile senza differenze, audit di release passato (202 agenti, 183 skill e
  105 comandi) e contenuto del pacchetto controllato. La misura è stata presa ad albero fermo,
  senza nessun editor sul repository, e il codice di uscita è stato letto da `npm` e non da un
  `echo` — due difetti di metodo commessi poco prima, che insieme avevano prodotto un «exit 0»
  per un giro con un rosso dentro.
  **La revisione è `530d9d0`**, e nominarla serve: una misura è di un albero, non di una data.
  L'unica cosa cambiata dopo di essa è questa voce. Vale per questa macchina: non è
  un'attestazione riusabile per un'altra.
- **Un rosso ambientale, per una volta dimostrato invece che dichiarato.** Lo stesso albero
  `530d9d0` è stato verificato due volte di seguito: il primo giro ha prodotto 22 prove rosse
  in 2869 s, il secondo nessuna in 950,60 s. L'unica variabile misurata fra i due era la memoria
  libera — 0,64 GB contro 5,77 GB su 15,66 — con CPU allo 0% e disco al 2% in entrambi. I rossi
  erano `EBUSY` su `rmdir` e conteggi sbagliati in `discovery.test.ts`, che da solo passava in
  303 s invece dei 23 s che gli costa il suo lavoro. Nessun commit fra i due giri è raggiungibile
  da quel file. La regola resta quella che tre diagnosi sbagliate hanno scritto: «ambientale» va
  sostenuto come qualunque altra affermazione, e qui la prova è il secondo giro, non il ragionamento.
- **Il costo della verifica non è cresciuto con il lavoro sui repository membri.** 950,60 s cade
  **dentro** l'intervallo di 879-1047 s misurato il 24 settembre, quando la suite aveva 71 file
  e 548 prove: quel lavoro ne ha aggiunti 10 e 64, incluse cinque prove che installano
  un'imbracatura vera su due repository Git e percorrono l'intero protocollo con gate reali.
  **Misurata è la non crescita**, non la sua spiegazione: che le prove pesanti girino in
  parallelo e che quindi la più lenta non si sommi al totale è l'inferenza più semplice che la
  regge, non un secondo dato. Il dato è sufficiente per la decisione che ne dipende:
  `native/membri` resta nel percorso di verifica predefinito invece di essere spostata altrove.
- **I tetti dei test sono stati misurati tutti, e la regola è diventata un controllo.** Le 120
  prove di `tests/integration` e `tests/roundtrip` sono state cronometrate una per una, a
  macchina ferma: vanno da 10 ms a 332,7 s. Le due suite più pesanti dichiarano **due** misure,
  perché sotto la suite completa i worker si contendono gli stessi processi Git e lo stesso
  lavoro costa circa il doppio: `native/membri` 332,7 s a riposo e 779,8 s sotto carico,
  `native/delivery` 142,9 s e 568,0 s. Quattro suite stavano sotto il tetto globale di
  30 s tarato sui test unitari — `problem-first-preparation` da solo ne costa 40,9 — e
  andavano in rosso a ogni carico. Ogni suite pesante dichiara ora il proprio tetto **con la
  misura accanto**, e un test lo verifica (`tests/unit/meta/declared-timeouts.test.ts`):
  la regola viveva in `AGENTS.md` come prosa, e quattro file se l'erano dimenticata.
  Distinguere le due diagnosi conta: `problem-first-preparation` aveva un tetto **sotto** il
  proprio lavoro, mentre `installer/update` ne misura 9,4 e aveva 3x di margine, consumato
  dal carico. Solo la prima è un difetto del tetto.
- **Tre gruppi di test erano dichiarati «fallimenti ambientali»: non lo erano.** Una misura
  li ha smentiti tutti e tre, e sono stati corretti il 22 settembre 2026. L'helper Git di
  `discovery.test.ts` aveva un tetto di 10 secondi per un lavoro che ne richiede 23; la
  fixture di `registry/load.test.ts` costruiva una radice non canonica e la confrontava con
  una risolta; i test di `tests/integration/native` installano un'imbracatura vera e
  costano circa cento secondi ciascuno, contro un tetto globale tarato sui test unitari.
  Con tetti proporzionati e una fixture canonica, tutti e tre passano.
- La lezione resta registrata in [AGENTS.md](../AGENTS.md): **«ambientale» è una diagnosi,
  e una diagnosi va sostenuta come qualunque altra affermazione.** Un tetto più stretto del
  lavoro che racchiude segnala un difetto che non c'è, e insegna a ignorare i rossi.

Per l'esito di una revisione specifica va consultata la CI di quella revisione. Nessuna
attestazione di questo documento va riusata per una revisione diversa.

## Cosa questo repository non fa

- Non chiama modelli, non legge credenziali, non avvia né configura client AI, non
  sostituisce abbonamenti, quote o permessi.
- Non promette isolamento dal sistema operativo. I lease e i controlli sono
  cooperativi, non una sandbox contro un altro processo con gli stessi privilegi.
- Non misura automaticamente il costo di un provider. Una misura assente resta
  `unmeasured`, mai zero.
- Non esegue push, deploy, pubblicazioni, acquisti o messaggi: sono effetti esterni
  separati e autorizzati.
- Non esegue hook o script del catalogo di terzi. I file recuperati mantengono provenienza,
  impronte e licenza; il loro contenuto non è incorporato nel pacchetto della factory.
