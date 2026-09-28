# Forgeyard

La fucina del software agentico: prepara Claude Code e Codex, guida il lavoro e verifica ogni consegna.

[![Node](https://img.shields.io/badge/Node-24.19%2B-3c873a)](#installazione) [![Claude Code](https://img.shields.io/badge/Claude%20Code-supportato-d97757)](docs/guide/uso.md) [![Codex](https://img.shields.io/badge/Codex-supportato-412991)](docs/guide/uso.md) [![Licenza](https://img.shields.io/badge/licenza-Apache--2.0-blue)](LICENSE)

Forgeyard trasforma una cartella di lavoro in un'officina in cui Claude Code e Codex costruiscono software con metodo. Che la cartella sia vuota, un repository o un insieme di repository, l'agente sa che cosa deve ottenere, entro quali confini può muoversi e come si dimostra che il lavoro è finito.

Tutto avviene in tre tempi. Con un solo comando Forgeyard prepara l'ambiente, poi guida l'agente dal piano alla consegna e infine verifica che ogni affermazione si regga su una prova concreta, come un comando eseguito o un file letto davvero. Alla fine hai software che puoi accettare sapendo su che cosa poggia, invece di doverti fidare sulla parola.

Un comando, una domanda, una conferma. Niente profili da scegliere e niente skill da ricordare a memoria.

## Installazione

Servono Node.js 24.19 (o una 24.x successiva), Git e, naturalmente, Claude Code o Codex già installato e collegato al tuo account. Forgeyard non tocca l'account e non chiama alcun modello, perché la conversazione resta nel client che usi già.

Per il momento non esiste un pacchetto npm, quindi si installa dal sorgente:

```bash
git clone https://github.com/diegogrizi/forgeyard.git
cd forgeyard
npm run install:local
```

Il comando installa le dipendenze indicate nel lockfile, compila il progetto e rende `forgeyard` disponibile in qualsiasi cartella, senza scrivere nulla nei tuoi progetti. Quando aggiorni il checkout, ricordati di rilanciare `npm run build`.

## Preparare la cartella

Apri il terminale nella cartella in cui vuoi lavorare e lancia `forgeyard`. Il programma la esamina, capisce che tipo di progetto contiene e sceglie il client da preparare. Se trova un `CLAUDE.md` sceglie Claude Code, se trova un `AGENTS.md` sceglie Codex. Se non c'è nessuno dei due file guarda quale client hai installato, e se li trova entrambi, o nessuno, ripiega sul formato di Codex.

A quel punto ti fa l'unica domanda a cui non può rispondere da solo:

```text
Che risultato vuoi ottenere?
> Il servizio ordini accetta il pagamento con carta, senza toccare il database dei clienti
```

Prima di scrivere qualsiasi cosa ti presenta un riepilogo con il client scelto, le capacità selezionate, le verifiche che userà e il numero di file da creare. Se rispondi di no, o ti limiti a premere Invio, la cartella resta esattamente com'era. Se invece confermi, Forgeyard crea la propria area privata in `.forgeyard/`, installa l'ambiente dell'agente (che nei messaggi chiama *imbracatura*) e lo collega al client come server locale. Può capitare che all'apertura il client ti chieda di abilitare quel server. In quel caso accetta e riapri la cartella.

Puoi rilanciarlo quando vuoi, perché rifà soltanto i passaggi che mancano e, se non ne manca nessuno, non tocca nulla. Se lo avvii da uno script, senza un terminale interattivo, si limita a mostrarti il riepilogo.

Il significato di ogni riga che compare a schermo è spiegato in [Primo avvio](docs/guide/primo-avvio.md).

## Guidare il lavoro

Il lavoro vero si svolge nel client che usi già, ma dentro l'officina che Forgeyard ha appena allestito. Apri la cartella e descrivi con parole tue quello che ti serve, per esempio:

> Aggiungi al servizio ordini il pagamento con carta, senza toccare il database dei clienti, e quando hai finito dimmi su quali prove si basa il risultato.

Non devi scegliere procedure né richiamare skill per nome, perché ci pensa l'ambiente. L'agente studia il progetto e ti propone un piano che dice cosa cambierà, dove interverrà e come si capirà che il lavoro è finito. Una volta approvato il piano, si muove solo entro quei confini, esegue le verifiche che hai visto nel riepilogo e chiude con un verdetto che dichiara su quali prove si regge.

Il giro completo, compreso quello che succede quando qualcosa si interrompe a metà, è descritto in [Uso](docs/guide/uso.md). Se qualcosa non funziona, il punto di partenza è [Problemi](docs/guide/problemi.md).

## Verificare la consegna

Qui sta la vera differenza rispetto alle raccolte di agenti e skill che circolano in rete. Quelle spiegano come si dovrebbe lavorare, ma restano istruzioni scritte: un agente può ignorarle senza che nessuno se ne accorga, e a lavoro finito non c'è modo di distinguere le affermazioni verificate da quelle che non lo sono.

Forgeyard invece è un programma, e questo gli permette di trasformare le regole in controlli veri e propri. Sono sei. Il primo garantisce che l'ambiente in funzione sia esattamente quello che hai approvato, e se uno dei suoi file cambia il lavoro si ferma. Il secondo assegna a ogni affermazione un livello di prova, e quelle fatte solo di parole non bastano a chiudere un lavoro. Il terzo lega ogni citazione al contenuto che l'agente ha letto davvero, così che la citazione scada quando il file cambia. Il quarto, con `forgeyard doctor`, si accorge di quando le istruzioni smettono di descrivere il codice.

Il quinto misura tempo e costo con un metodo dichiarato, e li confronta con quelli di un lavoro umano se hai indicato una linea di base in `forgeyard.yaml`. L'ultimo, infine, rifiuta un ambiente incoerente prima ancora di scriverlo, per esempio quando contiene un link a un file inesistente o un segnaposto dimenticato.

Ciascun controllo, quando scatta, lo segnala con un codice d'errore preciso. Li trovi tutti in [Garanzie](docs/guide/garanzie.md), mentre le idee da cui nasce il progetto sono raccontate per esteso in [Direzione](docs/DIREZIONE.md).

## Cosa cambia nella tua cartella

Il tuo codice non viene toccato. Forgeyard tiene la propria memoria in `.forgeyard/`, che resta fuori dai commit, mentre l'ambiente dell'agente finisce dove il client va a cercarlo. Con Claude Code, per esempio, si tratta della cartella `.claude/`, accompagnata da `PROJECT.md`, `forgeyard.yaml` e `forgeyard.lock` nella radice. Questi file sono visibili a Git, quindi sta a te decidere se includerli nei commit.

La configurazione del client (`.mcp.json` oppure `.codex/config.toml`) contiene percorsi legati a questo computer, per cui viene esclusa da Git tramite `.git/info/exclude` e il tuo `.gitignore` resta com'è. Solo quando la cartella non è un repository l'esclusione finisce in `.gitignore`. Se il file di istruzioni del client esiste già, Forgeyard ci aggiunge in fondo un blocco ben delimitato e te lo segnala nel riepilogo, prima della conferma.

Sono supportati anche i repository senza commit, i worktree collegati, i submodule e le cartelle che contengono più repository. In quest'ultimo caso un lavoro può coinvolgerli tutti, ma ogni singola attività resta confinata in uno solo.

Per aggiornare l'ambiente c'è `forgeyard update`, mentre per annullare l'ultima operazione c'è `forgeyard rollback`. Gli altri comandi sono raccolti in [Comandi avanzati](docs/percorsi-legacy.md), ma per cominciare non servono.

## Cosa resta nelle tue mani

Modelli, credenziali, abbonamenti e quote restano affare del client, e Forgeyard non li tocca. Push, deploy e issue partono solo quando li autorizzi tu, nel momento in cui servono, e non viene inviata alcuna telemetria.

Insieme al programma arriva anche la materia prima: un catalogo di terze parti bloccato a una versione precisa, che comprende 202 agenti, 183 skill e 105 comandi. Durante la preparazione Forgeyard ne sceglie soltanto ciò che serve al tuo progetto, senza eseguirne hook o script. Origine e licenze sono documentate in [Provenienza](docs/provenance/catalog-sources.md).

## Per chi vuole mettere mano al codice

Il punto di partenza è [AGENTS.md](AGENTS.md), che raccoglie le regole del progetto. La verifica completa si lancia con un solo comando:

```bash
npm run verify
```

Esegue typecheck, test e build, controlla il catalogo byte per byte, rigenera la provenienza e verifica il contenuto del pacchetto. L'ultimo esito misurato, con la sua data, è riportato in [Stato](docs/STATO.md). Per contribuire c'è [CONTRIBUTING.md](CONTRIBUTING.md), per le segnalazioni di sicurezza [SECURITY.md](SECURITY.md).

## Documentazione

Per cominciare basta questa pagina, il resto è lì quando vuoi approfondire.

| | |
|---|---|
| [Primo avvio](docs/guide/primo-avvio.md) | ogni riga dello schermo, e cosa succede se un passaggio non va a buon fine |
| [Uso](docs/guide/uso.md) | il lavoro nel client, dal piano al verdetto |
| [Problemi](docs/guide/problemi.md) | dal sintomo alla causa, e come rimediare |
| [Garanzie](docs/guide/garanzie.md) | i sei controlli, come scattano e che cosa coprono |
| [Manifesto](docs/MANIFESTO.md) | il testo da cui è nato il progetto, in inglese |
| [Direzione](docs/DIREZIONE.md) | la tesi e i confini del progetto |
| [Stato](docs/STATO.md) | a che punto è ogni parte del progetto |
| [Architettura](docs/guide/architettura.md) | la mappa dei moduli |
| [Provenienza del catalogo](docs/provenance/catalog-sources.md) | origine, licenza e integrità dei file di terzi |
| [Comandi avanzati](docs/percorsi-legacy.md) | diagnosi, aggiornamento, rollback e gli altri comandi |

## Licenza

Codice, documentazione, pack e template originali sono distribuiti con licenza [Apache-2.0](LICENSE), con le attribuzioni in [NOTICE](NOTICE). I componenti esterni, catalogo compreso, mantengono le rispettive licenze, elencate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
