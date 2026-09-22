# Forgeyard

Il registro contabile del lavoro agentico: prepara l'ambiente di sviluppo, poi tiene i conti di ciò che quell'ambiente afferma — con sei garanzie che sono codice capace di fallire.

[![Node](https://img.shields.io/badge/Node-24.19%2B-3c873a)](#prova-in-due-minuti) [![Claude Code](https://img.shields.io/badge/Claude%20Code-supportato-d97757)](docs/guide/uso.md) [![Codex](https://img.shields.io/badge/Codex-supportato-412991)](docs/guide/uso.md) [![Licenza](https://img.shields.io/badge/licenza-Apache--2.0-blue)](LICENSE) [![Stato](https://img.shields.io/badge/stato-in%20ristrutturazione-e8a33d)](docs/STATO.md)

```text
$ forgeyard
Forgeyard — preparazione personale
Cartella: /lavoro/checkout-service
Repository rilevati: 1. Progetti rilevati: 1.
  .: javascript

Che risultato vuoi ottenere? > Il carrello deve recuperare una sessione interrotta

Verrà preparato:
  Client: Claude Code — un CLAUDE.md esistente identifica l'host del progetto
  Capacità selezionate: 6    escluse: 4
  Verifiche: npm test
  File dell'imbracatura da creare: 71
  I file privati restano in .forgeyard; codice, Git e repository figli non vengono modificati.
Confermi la preparazione di questa cartella? > sì

Area personale creata.
Imbracatura installata: 70 file, 1 conservato.
Collegamento nativo configurato per Claude Code.
Il collegamento non è stato provato con Claude Code: se il client chiede di abilitare il server, fallo con i suoi controlli e riapri il progetto.
Apri questa cartella in Claude Code e descrivi il lavoro: la forgia fa il resto.
```

*Output reale, su un repository Git temporaneo, con il connettore nativo reale — solo il percorso è stato accorciato. Un comando, una domanda, una conferma: non ci sono skill da invocare per nome né un ordine da ricordare. Dopo, `git status` non vede `.forgeyard`.*

> [!NOTE]
> **Nessuna prova live con un account Claude Code o Codex è mai stata eseguita.** Tutto ciò che è verificato qui lo è da test strutturali. Lo [stato](docs/STATO.md) lo registra con la sua data, e tiene distinti tre livelli: implementato, sul percorso ordinario, provato live.

## Prova in due minuti

**1. Installa il programma, una volta sola.** Nella cartella di questo repository:

```bash
npm run install:local
```

Fa dipendenze dal lockfile, compilazione e collegamento del comando. Non tocca niente fuori da questo checkout e dal collegamento globale di `forgeyard`.

**2. Preparala.** Nella cartella su cui vuoi lavorare:

```bash
forgeyard
```

**Servono Node 24.19.0 o una successiva 24.x, e Git.** Il client — Claude Code o Codex — lo installi tu: Forgeyard non lo installa, non ne legge le credenziali e non ne gestisce l'account.

**Senza terminale interattivo viene mostrata soltanto un'anteprima**, e non viene scritto nessun file. Alla riesecuzione vengono ripresi soltanto i passi mancanti.

[→ Primo avvio, passo per passo](docs/guide/primo-avvio.md) · [→ Uso: un ingresso, e la conversazione nel client](docs/guide/uso.md)

## Le sei garanzie

Ognuna è un meccanismo che può fallire, con il suo modo di fallire:

| | Garanzia | In una riga | Cosa la fa fallire |
|---|---|---|---|
| **G1** | identità congelata | l'imbracatura approvata è, byte per byte, quella che gira | `FY_CAPSULE_DRIFT` |
| **G2** | evidenza classificata | un verdetto sostenuto da prosa non può essere emesso | `evidence:unsupported-verdict` |
| **G3** | citazioni vive | se la fonte è cambiata, l'affermazione è stantia, non silenziosamente vera | `FY_CITATION_STALE` |
| **G4** | deriva rilevata | la documentazione che invecchia è un difetto rilevabile | controllo `harness-drift` |
| **G5** | misura dichiarata | una misura assente resta non misurata, mai zero | `FY_MEASURE_INVALID` |
| **G6** | coerenza dell'imbracatura | un'imbracatura incoerente viene rifiutata prima di essere scritta | `FY_HARNESS_INCOHERENT` |

Sei codici di errore sono la prova più economica che queste non sono promesse. Un esempio di cosa significa: al primo giro, il lint dell'imbracatura (**G6**) ha trovato un difetto reale nel **nostro stesso** template — il file di istruzioni sempre installato rimandava a due file che soltanto uno dei pack installa. Nessuno se ne era accorto, perché un file Markdown non verifica sé stesso.

Per **G5** vale una precisazione: il confronto con un costo umano compare soltanto se qualcuno ha firmato una linea di base in `forgeyard.yaml`; in sua assenza è assente, non stimato.

[→ Garanzie: i meccanismi, i codici di errore, e cosa non promettono](docs/guide/garanzie.md)

## Perché un programma e non una raccolta

Le suite agentiche più note sono **raccolte di intenzioni**: centinaia di agenti, plugin e comandi che descrivono come si dovrebbe lavorare. Sono tutte a monte del lavoro, e nessuna sa rispondere a valle: quali affermazioni del rapporto finale sono sostenute da un comando eseguito? La documentazione generata descrive ancora il codice? L'imbracatura che ho approvato è quella che ha girato?

Non perché siano scritte male: perché **non hanno un meccanismo**. Una convenzione scritta in un prompt si viola per distrazione, e la violazione è silenziosa.

| Disciplina | In una raccolta | In Forgeyard |
|---|---|---|
| Livello di evidenza | etichetta in prosa, aggirabile | tipo somma: un verdetto accetta solo evidenza di rango sufficiente |
| Riferimento a una foglia di contesto | link che si spera esista | risolto e verificato prima dell'installazione |
| Nome di strumento in un agente | stringa YAML che può essere inventata | valore tipizzato: la classe di difetto non esiste |
| Budget di contesto | nessuno | byte misurati per file, con tetto |

> **Quando una regola può diventare una proprietà del tipo o un controllo eseguibile, non va scritta in prosa.** La prosa resta per spiegare il perché.

Sappiamo quanto vale una raccolta: ne distribuiamo una, pinnata e attestata — **202 agenti, 183 skill e 105 comandi**. È materiale della fabbrica, non il prodotto.

[→ Direzione: la tesi e i confini di progetto](docs/DIREZIONE.md) · [→ Manifesto](docs/MANIFESTO.md)

## Senza un sistema, e con Forgeyard

| | Senza un sistema | Con Forgeyard |
|---|---|---|
| «I test passano» | lo dice il rapporto finale | un gate osservato, oppure il verdetto è `blocked` |
| Le istruzioni installate | si spera che i link risolvano | rifiutate prima della scrittura se non risolvono |
| Dopo un mese | la documentazione descrive un codice che non esiste più | la deriva è un rilievo con una severità |
| «È costato meno di un umano» | un'opinione con i decimali | un metodo firmato, oppure nessun confronto |
| Per iniziare | scegli profilo, scope, hook, e ricorda l'ordine | un comando, una domanda, una conferma |

## Dove puoi usarlo

La cartella può essere vuota, essere essa stessa un repository Git, trovarsi dentro un repository oppure contenerne diversi. Sono riconosciuti repository senza commit, linked worktree e submodule.

```text
workspace/
├── .forgeyard/          area personale, fuori dai commit
├── servizio-ordini/     repository Git
├── servizio-clienti/    repository Git
└── frontend/            repository Git
```

La forgia scrive soltanto nella propria directory, e un'esclusione interna la tiene fuori dai normali commit anche se Git viene inizializzato dopo. File già tracciati, aree legacy e percorsi non sicuri non vengono adottati né sovrascritti in silenzio, e il `.gitignore` condiviso del software non viene modificato.

## Domande scomode

#### È pronto per la produzione?

No. Il branch è in ristrutturazione e nessuna prova live con un account reale è mai stata eseguita. Lo [stato](docs/STATO.md) lo dice con una data e tre livelli distinti, invece di un aggettivo.

#### Chiama modelli o legge le mie credenziali?

No. Forgeyard non chiama modelli, non legge credenziali, non avvia client AI e non sostituisce abbonamenti, quote o permessi. Nessuna telemetria, nessun effetto esterno automatico: push, deploy e issue remote richiedono autorizzazione al punto d'azione.

#### Funziona con Cursor?

No, e non per pigrizia: l'abbiamo rimosso. I campi per modello, strumenti e isolamento di quell'adapter restavano descrittivi e non applicabili, e due adapter le cui garanzie si possono dimostrare valgono più di tre che si possono soltanto raccontare.

#### Quanti comandi devo imparare?

Uno: `forgeyard`. Il resto sono operazioni avanzate, ispezionabili ma non necessarie — e dentro la conversazione non c'è nessuna skill da invocare per nome.

## Sviluppo e verifiche

```bash
npm run verify
```

Comprende typecheck, test, build, controllo byte per byte del catalogo vendored, provenienza rigenerabile, audit di release e contenuto del pacchetto. Le regole di sviluppo sono in [AGENTS.md](AGENTS.md), quelle di contribuzione in [CONTRIBUTING.md](CONTRIBUTING.md), il comportamento provato in [CHANGELOG.md](CHANGELOG.md) e il modello di minaccia in [SECURITY.md](SECURITY.md).

I test che installano un'imbracatura reale dichiarano in testa al file il proprio tetto di tempo, perché costano molto più di un test unitario. Se un test scade, **cronometra il lavoro prima di dare la colpa alla macchina**: su questo repository tre gruppi dati per «ambientali» erano tetti più stretti del lavoro che delimitavano.

## Documentazione

In quest'ordine: **Primo avvio → Uso → Garanzie → Direzione → Stato.** Architettura, Problemi e Provenienza sono riferimenti, non un percorso.

| Documento | Contenuto |
|---|---|
| [Primo avvio](docs/guide/primo-avvio.md) | dalla cartella al primo risultato, senza sapere niente del prodotto |
| [Uso](docs/guide/uso.md) | un ingresso, e la conversazione nel client |
| [Garanzie](docs/guide/garanzie.md) | le sei garanzie, come falliscono, cosa non promettono |
| [Direzione](docs/DIREZIONE.md) | la tesi, le garanzie, i confini di progetto |
| [Stato](docs/STATO.md) | cosa è implementato, cosa no, cosa non è mai stato provato live |
| [Architettura](docs/guide/architettura.md) | la mappa dei moduli e i confini |
| [Problemi](docs/guide/problemi.md) | sintomo, causa, cosa fare |
| [Manifesto](docs/MANIFESTO.md) | il testo fondativo, in inglese |
| [Provenienza del catalogo](docs/provenance/catalog-sources.md) | origine, licenza e integrità dei byte di terzi |
| [Percorsi legacy](docs/percorsi-legacy.md) | riferimento di manutenzione dei percorsi in dismissione |

## Licenza e provenienza

Codice, documentazione, pack e template originali sono **Apache-2.0**: vedere [LICENSE](LICENSE) e [NOTICE](NOTICE). I componenti esterni conservano le proprie licenze e attribuzioni, incluso il catalogo MIT già presente, elencate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Questa ristrutturazione non cambia la licenza né i byte dei materiali di terzi.
