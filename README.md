# Forgeyard

Un comando prepara la cartella per Claude Code e Codex. Poi il lavoro si chiude solo se ciò che l'agente afferma poggia su una prova.

[![Node](https://img.shields.io/badge/Node-24.19%2B-3c873a)](#installazione) [![Claude Code](https://img.shields.io/badge/Claude%20Code-supportato-d97757)](docs/guide/uso.md) [![Codex](https://img.shields.io/badge/Codex-supportato-412991)](docs/guide/uso.md) [![Licenza](https://img.shields.io/badge/licenza-Apache--2.0-blue)](LICENSE)

Se lavori con Claude Code o Codex conosci la routine. Prima di scrivere una riga devi spiegare il progetto all'agente, mettere insieme istruzioni e skill e sperare che non si contraddicano. Alla fine l'agente ti dice «fatto, i test passano», e tu devi credergli sulla parola.

Forgeyard si occupa di tutte e due le cose. Lo lanci nella cartella, lui la guarda, ti fa una sola domanda, ti mostra cosa installerà e aspetta il tuo sì. Poi torni nel client di sempre e lavori come al solito, con una differenza: l'agente non può più chiudere un lavoro con la sola parola. Ogni affermazione deve poggiare su qualcosa che si può controllare, come un comando eseguito o un file letto, altrimenti il lavoro resta aperto.

Un comando, una domanda, una conferma. Non ci sono profili da scegliere né skill da ricordare per nome.

> [!NOTE]
> **Nessuna prova live con account Claude Code o Codex è mai stata eseguita.** Quello che leggi qui è verificato da test automatici, in locale e in CI, ma nessuno ha ancora aperto una cartella preparata in un client vero, con un account autenticato. Lo [stato](docs/STATO.md) tiene il conto preciso, con la data.

## Installazione

Ti servono Node.js 24.19 o una 24.x successiva, Git, e Claude Code o Codex già installato e collegato al tuo account. Forgeyard non tocca l'account e non chiama modelli: la conversazione resta nel client che usi già.

Non c'è ancora un pacchetto su npm, quindi si installa dal sorgente:

```bash
git clone https://github.com/diegogrizi/forgeyard.git
cd forgeyard
npm run install:local
```

Il comando installa le dipendenze dal lockfile, compila e rende `forgeyard` disponibile da qualunque cartella. Non scrive niente nei tuoi progetti. Se più avanti aggiorni il checkout, rilancia `npm run build`.

## Preparare una cartella

Apri il terminale nella cartella su cui vuoi lavorare e lancia `forgeyard`. Va bene una cartella vuota, un repository o una cartella che ne contiene diversi.

Forgeyard guarda cosa c'è e sceglie il client da solo. Se trova un `CLAUDE.md` prepara Claude Code, se trova un `AGENTS.md` prepara Codex, altrimenti guarda quale dei due hai installato. Se li hai tutti e due, o nessuno, usa il formato di Codex. Poi ti fa l'unica domanda a cui non può rispondere da solo:

```text
Che risultato vuoi ottenere?
> Il servizio ordini accetta il pagamento con carta, senza toccare il database dei clienti
```

Prima di scrivere qualunque cosa ti mostra un riepilogo: quale client, quante capacità ha scelto, quali verifiche userà e quanti file creerà. Se dici di no, o premi invio senza rispondere, la cartella resta com'era. Se dici sì, crea la sua area privata in `.forgeyard/`, installa l'ambiente per l'agente (sullo schermo lo chiama *imbracatura*) e lo collega al client come server locale. Se all'apertura il client ti chiede di abilitare quel server, accetta e riapri la cartella.

Se lo rilanci, rifà solo quello che manca, e se non manca niente non tocca niente. Se invece lo lanci da uno script, senza un terminale, ti mostra il riepilogo e si ferma lì.

Cosa significa ogni riga che vedi a schermo è spiegato in [Primo avvio](docs/guide/primo-avvio.md).

## Lavorare nel client

Da qui in poi si lavora nel client. Apri la cartella e descrivi quello che vuoi con parole tue, per esempio:

> Nel servizio ordini serve il pagamento con carta. Non toccare il database dei clienti. Quando hai finito, dimmi su quali prove poggia il risultato.

L'agente legge il progetto e ti propone un piano: cosa cambierà, dove scriverà e come si vedrà che è fatto. Quando lo approvi, lavora solo dentro quei confini, esegue le verifiche che hai visto nel riepilogo e chiude con un verdetto che dice su cosa poggia. Se un punto è sostenuto solo dalle sue parole, il verdetto resta bloccato.

Il giro completo, compreso cosa succede se qualcosa si interrompe a metà, è in [Uso](docs/guide/uso.md). Se qualcosa non va, parti da [Problemi](docs/guide/problemi.md).

## Perché un programma e non una raccolta di prompt

Le raccolte di agenti e skill che si trovano in giro descrivono come si dovrebbe lavorare. Però sono istruzioni scritte: un agente può ignorarle senza che nessuno se ne accorga, e a lavoro finito non c'è modo di sapere quali affermazioni del rapporto sono state verificate e quali no.

Forgeyard è un programma, e questo ci permette di trasformare le regole in controlli. Sono sei:

- **Identità.** L'ambiente che hai approvato è esattamente quello che gira. Se un suo file cambia, il lavoro si ferma.
- **Evidenza.** Ogni affermazione ha un livello di prova, e una fatta solo di parole non basta a chiudere un lavoro.
- **Citazioni.** Quando l'agente cita un file, la citazione è legata al contenuto che ha letto. Se il file cambia, la citazione scade.
- **Deriva.** Se le istruzioni smettono di descrivere il codice, `forgeyard doctor` se ne accorge.
- **Misura.** Tempo e costo sono numeri con un metodo. Il confronto con un lavoro umano compare solo se hai dichiarato tu una linea di base in `forgeyard.yaml`.
- **Coerenza.** Un ambiente con un link a un file che non c'è, o con un segnaposto dimenticato, viene rifiutato prima di essere scritto.

Ognuno di questi controlli è codice che può fallire, e quando fallisce lo dice con un suo codice d'errore. Li trovi tutti in [Garanzie](docs/guide/garanzie.md), e la versione lunga del perché è in [Direzione](docs/DIREZIONE.md).

## Cosa tocca nella tua cartella

Il tuo codice resta com'è. La memoria di Forgeyard sta in `.forgeyard/`, che resta fuori dai commit. L'ambiente per l'agente va dove il client se lo aspetta: con Claude Code, per esempio, in `.claude/`, insieme a `PROJECT.md`, `forgeyard.yaml` e `forgeyard.lock` alla radice. Questi file, per ora, Git li vede.

La configurazione del client (`.mcp.json` o `.codex/config.toml`) contiene percorsi di questa macchina, quindi viene esclusa da Git con `.git/info/exclude` e il tuo `.gitignore` resta com'è. Se la cartella non è un repository, l'esclusione diventa una regola in `.gitignore`. Se il file di istruzioni del client esiste già, ci aggiunge in fondo un blocco delimitato, e te lo dice nel riepilogo prima del sì.

Funziona anche con repository senza commit, worktree collegati e submodule, e con una cartella che contiene più repository. In quel caso un lavoro può toccarli tutti, ma ogni singola attività resta dentro uno solo.

Per aggiornare l'ambiente c'è `forgeyard update`, per annullare l'ultima operazione `forgeyard rollback`. Gli altri comandi sono in [Comandi avanzati](docs/percorsi-legacy.md), ma per iniziare non ti servono.

## Cosa non fa

Forgeyard non chiama modelli, non legge credenziali e non sostituisce abbonamenti o quote: tutto questo resta nel client. Non fa push, deploy o issue da solo, perché quelli li autorizzi tu quando succedono. E non manda telemetria.

Insieme al programma arriva un catalogo di terze parti fissato a una versione precisa, con 202 agenti, 183 skill e 105 comandi. La preparazione ne prende solo quello che serve al tuo progetto e non ne esegue hook o script. Da dove viene e con quale licenza è in [Provenienza](docs/provenance/catalog-sources.md).

## Se vuoi lavorare sul codice

Parti da [AGENTS.md](AGENTS.md), dove ci sono le regole del progetto. La verifica completa è un comando solo:

```bash
npm run verify
```

Fa typecheck, test e build, controlla il catalogo byte per byte, rigenera la provenienza e verifica il contenuto del pacchetto. L'ultimo esito misurato, con la data, è in [Stato](docs/STATO.md). Per contribuire c'è [CONTRIBUTING.md](CONTRIBUTING.md), per la sicurezza [SECURITY.md](SECURITY.md).

## Documentazione

Per iniziare basta questa pagina. Il resto serve quando vuoi andare più a fondo.

| | |
|---|---|
| [Primo avvio](docs/guide/primo-avvio.md) | ogni riga dello schermo, e cosa succede se un passo non riesce |
| [Uso](docs/guide/uso.md) | il lavoro nel client, dal piano al verdetto |
| [Problemi](docs/guide/problemi.md) | dal sintomo alla causa, e cosa fare |
| [Garanzie](docs/guide/garanzie.md) | i sei controlli, come falliscono e cosa non promettono |
| [Manifesto](docs/MANIFESTO.md) | il testo da cui è nato il progetto, in inglese |
| [Direzione](docs/DIREZIONE.md) | la tesi e i confini del progetto |
| [Stato](docs/STATO.md) | cosa c'è, cosa manca e cosa non è mai stato provato dal vivo |
| [Architettura](docs/guide/architettura.md) | la mappa dei moduli |
| [Provenienza del catalogo](docs/provenance/catalog-sources.md) | origine, licenza e integrità dei file di terzi |
| [Comandi avanzati](docs/percorsi-legacy.md) | diagnosi, aggiornamento, rollback e gli altri comandi |

## Licenza

Il codice, la documentazione, i pack e i template originali sono sotto [Apache-2.0](LICENSE), con le attribuzioni in [NOTICE](NOTICE). I componenti esterni, catalogo compreso, mantengono le loro licenze, elencate in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
