# Stato di Forgeyard

Registrato il **22 settembre 2026** sul branch `refactor/forgia-personale-workspace`.
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

**Nessuna prova live con account Claude Code o Codex è mai stata eseguita.** Tutto ciò
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
| G4 deriva rilevata | `src/drift/scan.ts` | sì | **in corso**: il collegamento al doctor è in lavorazione |
| G5 misura dichiarata | `src/measure/accounting.ts` | sì | sì: contabilità nel certificato di consegna, senza linea di base umana |
| G6 coerenza dell'imbracatura | `src/doctor/harness-lint.ts` | sì | sì: gate su `buildInstallPlan`, quindi su ogni percorso di installazione |

Quattro delle sei garanzie sono collegate, e lo sono davvero. Le altre due non vanno
arrotondate per simmetria:

- **G4 non è ancora collegata.** La scansione esiste, con i suoi test: confronta il
  profilo congelato con un'ispezione fresca e marca inconclusive le conclusioni che una
  scansione limitata non può confermare. Il collegamento a `forgeyard doctor` è in
  lavorazione in parallelo e non è atterrato: non dichiararlo fatto.
- **G5 non è su nessun percorso.** Il modulo calcola, formatta e rifiuta di inventare: una
  misura non riportata torna `unmeasured` con la sua ragione. Ma nessun percorso del
  prodotto lo chiama. Collegarlo richiede di estendere il protocollo nativo e lo stato del
  run per registrare le osservazioni di consumo una per una — provider, modello, token,
  durata, costo — e di leggere una linea di base umana dichiarata in un file posseduto da
  una persona. È stato deciso di non farlo ora, perché la suite che lo verificherebbe non
  è eseguibile in modo affidabile su questa macchina: una garanzia dichiarata mancante è
  preferibile a una dichiarata pronta e non verificata. **Oggi il certificato di consegna
  non riporta nessuna contabilità.**

## Il percorso della forgia personale

L'ordine degli incrementi è quello del piano confluito in [la direzione](DIREZIONE.md).

| Incremento | Contenuto | Stato |
|---|---|---|
| P0 | verifiche riproducibili, SBOM indipendente dalla piattaforma | implementato |
| P1 | ricognizione in sola lettura del workspace | implementato |
| P2a | ingresso senza argomenti, riepilogo italiano, registrazione privata | implementato |
| P2b | installazione della suite nell'area personale | **da fare** |
| P3 | collegamento nativo ai client dall'area personale | **da fare** |
| P4 | inventario e riuso dei componenti globali già presenti | **da fare** |
| P5 | esecuzione su più repository membri | **da fare** |
| P6 | selezione unificata e profili pertinenti | **da fare** |
| P7 | percorso ordinario interamente italiano, rimozione dei percorsi legacy | in corso |

L'area personale creata da P2a persiste lo stato **`not-connected`**, e lo dichiara
anche a schermo. Il messaggio «Area personale creata» significa che la registrazione è
riuscita: non significa che esista una suite installata, né che un client la veda.
Vedere [Uso](guide/uso.md) per cosa si può provare oggi.

## In corso di rimozione

Questi tagli sono **in corso**, non compiuti. Il checkout li contiene ancora, e i
comandi corrispondenti rispondono ancora:

- il pacchetto presentazione.

Il **ciclo di vita legacy è stato rimosso** il 22 settembre 2026: `src/orchestrator/`,
`src/worktrees/`, `src/observability/`, `src/guard/` e i comandi `task`, `workspace`,
`ledger` e `guard` non esistono più. Sono sopravvissuti il contratto di attività e le
ricevute di verifica, e il guard di scrittura è diventato nativo soltanto. Il profilo
manuale `full` è stato rimosso; resta `hackathon` come selezione curata.

Ciò che resta di essi è descritto, per la sola manutenzione, in
[Percorsi legacy](percorsi-legacy.md). Non è la guida di ingresso, e non va ampliato.

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
- **La suite di integrazione del runtime nativo non è verificabile ora su questa
  macchina.** I suoi tempi sono dominati dall'importazione dei moduli e superano la
  scadenza di 30 secondi sotto carico. Non è un esito rosso e non è un esito verde: è un
  controllo non eseguibile, e va dichiarato tale invece di essere simulato.
- La stessa classe di scadenza si osserva, in modo intermittente, sul test che ricalcola
  le metriche del catalogo mentre la macchina è occupata: passa se rieseguito da solo.
  Un esito dipendente dal carico non è una prova, in nessuna delle due direzioni.

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
- Non esegue hook o script del catalogo di terzi. I byte vendored restano invariati
  sotto la loro licenza.
