# Forgeyard

Un comando prepara la cartella per Claude Code e Codex. Poi il lavoro si chiude solo se ciò che l'agente afferma poggia su una prova.

[![Node](https://img.shields.io/badge/Node-24.19%2B-3c873a)](#installazione) [![Claude Code](https://img.shields.io/badge/Claude%20Code-supportato-d97757)](docs/guide/uso.md) [![Codex](https://img.shields.io/badge/Codex-supportato-412991)](docs/guide/uso.md) [![Licenza](https://img.shields.io/badge/licenza-Apache--2.0-blue)](LICENSE)

Usi **Claude Code** o **Codex** per scrivere software. Prima del codice c'è sempre lo stesso lavoro: capire il progetto, comporre un ambiente che non si contraddica, ricordare da dove si parte. Forgeyard fa quel lavoro sulla tua macchina. Guarda la cartella, ti chiede il risultato, ti mostra cosa scriverà e, dopo il tuo sì, lascia l'ambiente pronto. Poi torni nel client che usi già e parli del software.

**Un comando. Una domanda. Una conferma.**

```bash
forgeyard
```

- Legge il progetto prima di farti una domanda.
- Sceglie un ambiente coerente per quella cartella, e te lo mostra.
- Una consegna si chiude quando l'affermazione poggia su una prova.

> [!NOTE]
> **Nessuna prova live con account Claude Code o Codex è mai stata eseguita.** Ciò che questa pagina descrive è verificato da test strutturali, locali e di CI: nessuno ha ancora aperto una cartella preparata in un client autenticato. Lo [stato](docs/STATO.md) lo registra con la sua data.

---

## Installazione

Ti servono Node.js, Git e un client. Forgeyard usa quelli che hai già.

| | |
|---|---|
| **Node.js** | `24.19.0` o una successiva `24.x`. Controlla con `node --version`. |
| **Git** | raggiungibile nel `PATH`. La ricognizione ne legge i metadati: dov'è un repository, se è un worktree o un submodule, quali file sono già tracciati. |
| **Un client** | Claude Code oppure Codex, già installato e autenticato. La conversazione e l'account restano lì. |

Si installa dal checkout. Il pacchetto npm pubblico non c'è: le dipendenze restano quelle del lockfile.

```bash
git clone https://github.com/diegogrizi/forgeyard.git
cd forgeyard
npm run install:local
```

Il comando installa le dipendenze, compila e collega `forgeyard` ai comandi di npm, puntando a questo checkout. Non scrive nelle cartelle dei tuoi progetti e non tocca l'account del client. Se aggiorni il checkout, ricompila con `npm run build` prima di riusare il comando.

## Preparare una cartella

Apri il terminale nella cartella su cui vuoi lavorare. Può essere vuota, essere un repository, stare dentro un repository o contenerne diversi.

```bash
forgeyard
```

Niente profili, niente autori di skill, niente ordine da ricordare. Il client lo decidono la cartella e la macchina, e l'anteprima dice il perché: un `CLAUDE.md` già presente prepara Claude Code, un `AGENTS.md` già presente prepara Codex. Senza nessuno dei due file conta il client installato su questa macchina; se li trova installati entrambi, o nessuno, prepara il formato di Codex.

Immagina il checkout del servizio ordini. Vuoi il pagamento con carta, e il database dei clienti deve restare com'è. L'unica domanda è il risultato, in una riga:

```text
Che risultato vuoi ottenere?
> Il servizio ordini accetta il pagamento con carta, senza toccare il database dei clienti
```

Poi arriva l'anteprima: quale client, quante capacità entrano e quante restano fuori, quali verifiche il progetto dichiara già e quanti file. La conferma, se non rispondi, è no. Un no lascia la cartella come l'hai trovata. Senza un terminale interattivo — un pipe, uno script — vedi solo l'anteprima, e non viene scritto nessun file.

Il sì fa tre cose, e il programma le dice mentre le fa.

1. **Area personale.** Crea `.forgeyard/`, con la mappa della cartella e un'esclusione che la tiene fuori dai commit.
2. **Imbracatura.** Installa l'ambiente dell'assistente: istruzioni, capacità scelte per questo progetto, controlli, e un'identità fissata byte per byte.
3. **Collegamento.** Registra un server locale che il client può avviare: la voce `forgeyard` in `.mcp.json` per Claude Code, la sezione `[mcp_servers.forgeyard]` in `.codex/config.toml` per Codex.

Se il client, all'apertura, chiede di abilitare quel server, accettalo dai suoi controlli e riapri la cartella. La fiducia resta una sua decisione.

Alla seconda esecuzione vengono rifatti soltanto i passi che mancano. Se non manca niente, non chiede niente e non scrive niente.

Ogni riga di quello schermo è spiegata in [Primo avvio](docs/guide/primo-avvio.md).

## Lavorare

Apri la cartella nel client che la riga finale ha nominato. Descrivi il risultato, i vincoli e come si vede che è fatto:

> Nel servizio ordini serve il pagamento con carta. Non toccare il database dei clienti. Quando hai finito, dimmi su quali prove poggia il risultato.

Descrivi il risultato con parole tue. L'ambiente sceglie procedura, contesto e controlli.

1. L'assistente legge il progetto e propone un piano: requisiti, attività, ambiti di scrittura, criteri osservabili.
2. Te lo fa confermare. Il sì vale per quel piano, su questa macchina.
3. Implementa dentro gli ambiti confermati.
4. Esegue i controlli che l'anteprima ti ha mostrato, e ne registra l'esito.
5. Chiude con un verdetto che dichiara il sostegno più debole. Un criterio sorretto solo da prosa resta bloccato.

Il giro completo, e cosa succede se un passo si interrompe, è in [Uso](docs/guide/uso.md). Da un sintomo alla causa: [Problemi](docs/guide/problemi.md).

## Cosa resta sotto controllo

L'imbracatura è l'ambiente con cui l'assistente lavorerà su questa cartella. Sei meccanismi la tengono onesta. Ognuno è codice, e ognuno ha un modo di mancare: il dettaglio, compresi i codici con cui si presenta, è in [Garanzie](docs/guide/garanzie.md).

| | |
|---|---|
| **Identità** | L'imbracatura che hai approvato è quella che gira. Se un suo file cambia, non si apre. |
| **Evidenza** | Ogni affermazione ha un livello: un comando eseguito, dei byte letti, un'inferenza che cita le prove, oppure prosa del modello. La prosa non chiude una consegna. |
| **Citazioni** | Un riferimento punta ai byte letti. Se la fonte cambia, la citazione è stantia. |
| **Deriva** | Le istruzioni vengono confrontate con il codice. Una documentazione invecchiata compare come rilievo, con una severità. |
| **Misura** | Tempo e costo sono un numero con un metodo dichiarato. Se in `forgeyard.yaml` hai dichiarato una linea di base umana, il certificato la confronta. Senza quella dichiarazione il confronto è assente. |
| **Coerenza** | Prima di scrivere, un'imbracatura incoerente viene rifiutata: un rimando a un file che non verrà installato, un segnaposto rimasto, un percorso della macchina di chi l'ha generata. |

## Dove finiscono i file

```text
workspace/
├── .forgeyard/          area personale, fuori dai commit
├── servizio-ordini/     repository Git
├── servizio-clienti/    repository Git
└── frontend/            repository Git
```

Durante la preparazione il codice dei progetti non viene modificato. L'area personale si scrive da sé la propria esclusione, e il `.gitignore` condiviso del software resta com'è quando la cartella è un repository: l'esclusione della configurazione del client sta in `.git/info/exclude`, perché quella configurazione contiene percorsi di questa macchina. In una cartella che non è un repository, la stessa esclusione è una regola in `.gitignore`.

Se un `CLAUDE.md` o un `AGENTS.md` esiste già, in coda arriva un blocco delimitato. L'anteprima elenca queste scritture prima del sì.

Sono riconosciuti anche repository senza commit, worktree collegati e submodule. Un lavoro può attraversare più repository della stessa cartella; un'attività resta dentro un solo membro, perché il suo controllo gira una volta, in un solo albero.

Nella cartella già preparata, `forgeyard update` aggiorna l'imbracatura e `forgeyard rollback` annulla l'ultima operazione reversibile. Per iniziare non servono. Quali comandi sono l'ingresso e quali no: [Comandi avanzati](docs/percorsi-legacy.md).

## Confini

- Modelli, credenziali, abbonamenti e quote restano nel client. Forgeyard non li legge e non li sostituisce.
- Push, issue remote, deploy e messaggi li autorizzi tu, nel momento in cui li fai.
- I byte di terze parti restano quelli della loro licenza. In preparazione il programma non esegue gli hook e gli script di quel catalogo.
- Insieme al programma viaggia un catalogo pinnato — 202 agenti, 183 skill e 105 comandi — di cui la preparazione usa la parte che il progetto regge. Origine e impronte: [Provenienza](docs/provenance/catalog-sources.md).

## Per chi lavora su questo repository

```bash
npm run verify
```

Typecheck, test, build, controllo byte per byte del catalogo, provenienza, audit di release e contenuto del pacchetto. L'esito misurato, con data e revisione, è in [Stato](docs/STATO.md). Le regole di sviluppo sono in [AGENTS.md](AGENTS.md), il modo di contribuire in [CONTRIBUTING.md](CONTRIBUTING.md), il modello di minaccia in [SECURITY.md](SECURITY.md).

## Documentazione

Per usare il programma basta questa pagina. Il resto è lì quando vuoi andare più a fondo.

| | |
|---|---|
| [Primo avvio](docs/guide/primo-avvio.md) | ogni riga dello schermo, e cosa succede se un passo non riesce |
| [Uso](docs/guide/uso.md) | il giro di lavoro nel client, dal piano al verdetto |
| [Problemi](docs/guide/problemi.md) | un sintomo, la causa, cosa fare |
| [Garanzie](docs/guide/garanzie.md) | i sei meccanismi, come mancano, cosa non promettono |
| [Manifesto](docs/MANIFESTO.md) | il testo da cui il programma discende, in inglese |
| [Direzione](docs/DIREZIONE.md) | la tesi e i confini di progetto |
| [Stato](docs/STATO.md) | cosa è implementato, cosa attraversa il percorso ordinario, cosa è stato misurato |
| [Architettura](docs/guide/architettura.md) | la mappa dei moduli |
| [Provenienza del catalogo](docs/provenance/catalog-sources.md) | origine, licenza e integrità dei byte di terzi |
| [Comandi avanzati](docs/percorsi-legacy.md) | diagnosi, aggiornamento, rollback, e i comandi che non sono l'ingresso |

## Licenza

Codice, documentazione, pack e template originali sono [Apache-2.0](LICENSE). Le attribuzioni stanno in [NOTICE](NOTICE). I componenti esterni, catalogo compreso, conservano le proprie licenze in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
