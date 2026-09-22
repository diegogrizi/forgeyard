# Forgeyard

Le suite agentiche più note sono **raccolte di intenzioni**: centinaia di agenti, plugin e
comandi che descrivono come si dovrebbe lavorare. Sono tutte a monte del lavoro. Nessuna
sa rispondere, a valle:

- quali affermazioni del rapporto finale sono sostenute da un comando eseguito, e quali
  sono soltanto prosa del modello?
- la documentazione generata descrive ancora il codice?
- l'imbracatura che ho approvato è quella che ha girato?

Non perché siano scritte male: perché **non hanno un meccanismo**. Un file di istruzioni
non può verificare sé stesso, non può rilevare di essere invecchiato, non può rifiutare
una conclusione non sostenuta. Aggiungere il duecentunesimo agente non colma quel divario.

Forgeyard risponde a quelle domande perché è un programma, non un prompt — e le risposte
sono **meccanismi che possono fallire**, non promesse. Sappiamo quanto vale una raccolta:
ne distribuiamo una, pinnata e attestata, con **202 agenti, 183 skill e 105 comandi**. È
materiale della fabbrica. Non è il prodotto.

> **Questo branch è in ristrutturazione.** Il collegamento nativo all'area personale non è
> completato: l'area resta `not-connected`. **Nessuna prova live con account Claude Code o
> Codex è mai stata eseguita**; tutto ciò che è verificato qui è verificato da test
> strutturali. Lo [stato](docs/STATO.md) dichiara, alla data, cosa è implementato, cosa
> attraversa un percorso ordinario e cosa non è mai stato provato.

## La tesi

> Forgeyard non è una collezione di competenze. È il **registro contabile** del lavoro
> agentico: prepara l'ambiente, e poi tiene i conti di ciò che quell'ambiente afferma.

La parte «fabbrica» — ricognizione, decisione, installazione — è la porta d'ingresso. Il
valore aggiunto è ciò che accade dopo: ogni affermazione prodotta dentro l'imbracatura
porta un **livello di evidenza dichiarato** e un vincolo verificabile alla propria fonte.
La deriva deve essere rilevata da un meccanismo, non dalla buona volontà.

Il ragionamento completo è in [Direzione](docs/DIREZIONE.md); il testo fondativo, in
inglese, è il [manifesto](docs/MANIFESTO.md).

## Un solo ingresso

Il programma si installa una volta sul PC. Poi, dalla cartella su cui vuoi lavorare:

```sh
forgeyard
```

Il comando riconosce la cartella, mostra un riepilogo in italiano e chiede **una sola
conferma** prima di creare l'area personale. Non devi scegliere profili, autori di skill o
orchestratori, e non devi ricordare comandi di analisi separati. Senza terminale
interattivo viene mostrata soltanto un'anteprima: non viene scritto nessun file.

La conversazione resta dove già lavori: nelle app o nelle CLI di **Claude Code** e
**Codex**. Forgeyard non chiama modelli, non legge credenziali e non sostituisce
abbonamenti, quote o permessi dei client.

Cosa si può provare oggi, e cosa resta da collegare, è in [Uso](docs/guide/uso.md).

## Le sei garanzie

Ognuna è codice che può fallire. La spiegazione di ciascuna, con le sue modalità di
fallimento e ciò che **non** promette, è in [Garanzie](docs/guide/garanzie.md).

| | Garanzia | In una riga | |
|---|---|---|---|
| G1 | identità congelata | l'imbracatura approvata è, byte per byte, quella che gira | |
| G2 | evidenza classificata | un verdetto sostenuto da prosa non può essere emesso | |
| G3 | citazioni vive | se la fonte è cambiata, l'affermazione è stantia, non silenziosamente vera | |
| G4 | deriva rilevata | la documentazione che invecchia è un difetto rilevabile | *collegamento in corso* |
| G5 | misura dichiarata | una misura assente resta non misurata, mai zero | *primitiva, non collegata* |
| G6 | coerenza dell'imbracatura | un'imbracatura incoerente viene rifiutata prima di essere scritta | |

Tutte e sei attraversano un percorso ordinario. Per G5 vale una precisazione che la
colonna a destra segnala: il certificato riporta la contabilità del lavoro agentico, ma
**la linea di base umana non è dichiarabile**, quindi il confronto con un costo umano
resta assente — non stimato. Dire «l'AI è stata più veloce» senza un metodo dichiarato è
esattamente il tipo di affermazione che questo prodotto rifiuta, anche quando è la nostra.

Un esempio di cosa significa «può fallire»: al primo giro, il lint dell'imbracatura (G6)
ha trovato un difetto reale nel nostro stesso template. Il file di istruzioni sempre
installato rimandava a due file che soltanto uno dei pack installa, quindi con il profilo
`minimal` la forgia consegnava istruzioni che puntavano a percorsi inesistenti. Nessuno se
ne era accorto, perché un file Markdown non verifica sé stesso.

## Dove puoi usarlo

La cartella può essere vuota, essere essa stessa un repository Git, trovarsi dentro un
repository oppure contenerne diversi. Sono riconosciuti repository senza commit, linked
worktree e submodule.

```text
workspace/
├── .forgeyard/          area personale
├── servizio-ordini/     repository Git
├── servizio-clienti/    repository Git
└── frontend/            repository Git
```

La forgia scrive soltanto nella propria directory, e un'esclusione interna la tiene fuori
dai normali commit anche se Git viene inizializzato dopo. File già tracciati, aree legacy,
modifiche locali e percorsi non sicuri non vengono adottati né sovrascritti in silenzio, e
il `.gitignore` condiviso del software non viene modificato.

## Installazione dal checkout

Il pacchetto non è presentato come una release pubblicata su npm. Servono Node **24.19.0 o
una successiva versione 24.x** e Git. Una volta sola, nella cartella del repository
Forgeyard:

```bash
npm run install:local
```

Fa le tre cose che servono — dipendenze dal lockfile, compilazione, collegamento del
comando — e non tocca niente fuori da questo checkout e dal collegamento globale del
comando `forgeyard`.

Poi il comando ordinario resta `forgeyard`, dalla cartella del tuo lavoro. Il collegamento
di sviluppo usa il checkout locale: una modifica al programma richiede una nuova
compilazione.

## Sviluppo e verifiche

```sh
npm run verify
```

La verifica comprende typecheck, test, build, controllo byte per byte del catalogo
vendored, provenienza rigenerabile, audit di release e contenuto del pacchetto. Le regole
di contribuzione sono in [CONTRIBUTING.md](CONTRIBUTING.md), il comportamento provato in
[CHANGELOG.md](CHANGELOG.md) e il modello di minaccia in [SECURITY.md](SECURITY.md); le
regole di sviluppo di questo repository stanno in `AGENTS.md`, che non viene distribuito
nel pacchetto perché un file di istruzioni dentro `node_modules` non deve entrare nel
contesto di chi lo installa.

I test tengono separati codice verificato, controlli strutturali e prove reali nelle app.
**Non costituiscono una prova di integrazione live con Claude Code o Codex.**

## Documentazione

| Documento | Contenuto |
|---|---|
| [Direzione](docs/DIREZIONE.md) | la tesi, le garanzie, i confini di progetto |
| [Manifesto](docs/MANIFESTO.md) | il testo fondativo, in inglese |
| [Stato](docs/STATO.md) | cosa è implementato, cosa no, cosa non è mai stato provato live |
| [Uso](docs/guide/uso.md) | un ingresso, e la conversazione nel client |
| [Garanzie](docs/guide/garanzie.md) | le sei garanzie, e cosa le fa fallire |
| [Architettura](docs/guide/architettura.md) | la mappa dei moduli e i confini |
| [Provenienza del catalogo](docs/provenance/catalog-sources.md) | origine, licenza e integrità dei byte di terzi |
| [Percorsi legacy](docs/percorsi-legacy.md) | riferimento di manutenzione dei percorsi in dismissione |

## Licenza e provenienza

Codice, documentazione, pack e template originali sono **Apache-2.0**: vedere
[LICENSE](LICENSE) e [NOTICE](NOTICE). I componenti esterni conservano le proprie licenze
e attribuzioni, incluso il catalogo MIT già presente, elencate in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Questa ristrutturazione non cambia la
licenza né i byte dei materiali di terzi.
