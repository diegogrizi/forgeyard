# Uso

Forgeyard è un programma locale. Si installa una volta, prepara l'ambiente nella cartella
indicata e poi tiene i conti di ciò che quell'ambiente afferma. La conversazione resta
dove già lavori: nelle app o nelle CLI di **Claude Code** e **Codex**.

Prima di leggere il resto: questo branch è in ristrutturazione, e i due percorsi descritti
sotto **non sono ancora convergenti**. [Lo stato](../STATO.md) dice, alla data, cosa è
implementato e cosa no.

## Installazione dal checkout

Il pacchetto non è presentato come una release pubblicata su npm. Servono Node
**24.19.0 o una successiva versione 24.x** e Git. Una volta, nella cartella del
repository Forgeyard:

```sh
npm ci
npm run build
npm link
```

Il collegamento di sviluppo usa il checkout locale: una modifica al programma richiede
una nuova compilazione. La preparazione è offline. Forgeyard non contatta un servizio di
aggiornamento, non scarica pack, non invia dati d'uso e non attiva gli script o gli hook
del catalogo di terzi.

## Percorso ordinario: un solo ingresso

Apri il terminale nella cartella su cui vuoi lavorare ed esegui:

```sh
forgeyard
```

Il comando riconosce la cartella, mostra un riepilogo in italiano e chiede **una sola
conferma** prima di creare l'area personale. Non devi scegliere un profilo, un autore di
skill, un orchestratore, né ricordare comandi di analisi separati. Senza terminale
interattivo viene mostrata soltanto un'anteprima: non viene scritto nessun file.

Vengono creati due file, ed entrambi stanno dentro la propria directory:

| File | Contenuto |
|---|---|
| `.forgeyard/workspace.json` | la mappa identificabile del workspace, con la sua impronta |
| `.forgeyard/.gitignore` | l'esclusione dell'intera area privata, compresa la propria regola |

Se l'area è già presente non viene reinstallata, la mappa e la data non vengono riscritte
e non serve una nuova conferma. L'impronta rileva alterazioni accidentali; non autentica i
file contro un processo ostile che gira con i tuoi privilegi.

**Lo stato persistito è `not-connected`.** Il messaggio «Area personale creata» significa
registrazione riuscita, non «forgia pronta» e non «agenti attivi». I vecchi installer non
vanno puntati su quest'area per aggirare quello stato: hanno ancora assunzioni di singolo
repository e proprie regole di proprietà.

### Dove puoi usarlo

La cartella può essere vuota, essere essa stessa un repository Git, trovarsi dentro un
repository oppure contenerne diversi. Sono riconosciuti repository senza commit, linked
worktree e submodule. La ricognizione individua i progetti dai manifest ammessi, uno per
membro, senza eseguirne gli script e senza restituirne il contenuto.

```text
workspace/
├── .forgeyard/          area personale
├── servizio-ordini/     repository Git
├── servizio-clienti/    repository Git
└── frontend/            repository Git
```

Se il workspace è una sottocartella di un repository, resta selezionata quella cartella:
il programma non risale alla root Git per installarsi. Non inizializza repository, non
modifica il `.gitignore` condiviso del software, non adotta aree legacy e non sovrascrive
file già tracciati — se trova nell'indice un file della forgia si ferma, perché una regola
di esclusione non rende privato un file tracciato.

Una scansione parziale non basta per registrare: la ricognizione dichiara i limiti che ha
raggiunto, e una mappa incompleta viene rifiutata invece di essere completata a
indovinare. Il recupero dopo un errore rimuove soltanto i file ancora identici a quelli
creati dall'operazione: se trova un'aggiunta concorrente o byte modificati conserva
l'area e lo segnala.

### Ricognizione da sola

La stessa ricognizione è disponibile come diagnostico, per ispezione:

```sh
forgeyard analizza
forgeyard analizza --json
```

Non è un passo del percorso ordinario e non va eseguita prima di `forgeyard`: l'ingresso
la riusa già. Exit 0 indica una risposta valida **anche se parziale**, quindi chi la
consuma deve leggere `scan.status`; exit 2 segnala argomenti non validi, exit 4 una root
o un'ispezione non utilizzabili.

## Percorso nativo, per un singolo repository

Questo è il percorso su cui vivono oggi le garanzie di consegna. Vale per un repository
alla volta, ed è distinto dall'area personale descritta sopra: i due non sono ancora
stati uniti.

Dalla cartella del prodotto, scegliendo il proprio client:

```sh
forgeyard connect --root . --client codex
forgeyard connect --root . --client claude-code
```

Il collegamento crea un namespace MCP posseduto e un puntatore alle istruzioni, e
preserva le configurazioni estranee. Una configurazione del client già tracciata viene
**rifiutata**, non sovrascritta con percorsi della macchina. Se il client richiede di
abilitare o approvare il server, fallo con i suoi controlli e riapri il progetto: nessuna
impostazione globale o di account viene toccata, e nessuna politica di fiducia viene
cambiata al tuo posto. `forgeyard disconnect --root .` rimuove soltanto i blocchi
posseduti e rimasti invariati.

Poi si conversa nel client, in linguaggio di prodotto:

> Questo è il repository, questi i requisiti e i vincoli. Prepara l'ambiente giusto, poi
> implementa e verifica il risultato.

L'assistente legge prima, propone intento, rischio, capacità ed evidenza legata alle
impronte, e usa gli strumenti locali. Il ciclo ordinario è questo:

1. legge il contesto e gli input di progetto citati, e attacca **un solo** writer
   cooperativo sull'albero di lavoro;
2. crea un piano nuovo per ogni risultato — requisiti, attività dipendenti, ruoli,
   ambiti di scrittura precisi, criteri osservabili legati ai gate congelati. Una coda
   vuota non è una ragione per fermarsi;
3. ottiene il **consenso umano locale ed esatto** per piano, policy e linea di base.
   L'assistente può mostrare la finestra di conferma, ma non può approvare compilando un
   campo, e nessuna conferma nativa ha un `--yes`;
4. segue gli ordini di lavoro, implementa dentro l'ambito, carica le skill pertinenti e
   registra checkpoint, decisioni e riferimenti ai criteri;
5. esegue **tutti** i gate congelati richiesti. Un'attività di scrittura richiede i gate
   configurati e un gate di riepilogo dei test. I gate sono processi finiti e osservati,
   con output e timeout limitati e un ambiente ridotto;
6. registra gli artefatti di review sulla revisione testata. Una review della stessa
   sessione non è indipendente, e un nome di worker fornito dal modello non è
   un'attestazione: rischio medio o alto passa dalla review umana locale;
7. deriva il verdetto di consegna dall'evidenza corrente — criteri, gate, provenienza
   della review, ambito, input Git puliti, budget.

Il verdetto dichiara i livelli di evidenza del proprio supporto, il livello più debole e
su cosa poggia in ultima istanza. Se il supporto non è certificabile, il verdetto è
`blocked` e compare il divario `evidence:unsupported-verdict`. Il perché è in
[Garanzie](garanzie.md).

Cambiare l'evidenza o la revisione testata **riapre** il completamento: un rapporto
vecchio resta un documento storico, non una prova corrente.

### Quando qualcosa si interrompe

La scadenza di un lease non è un'acquisizione automatica. Il recupero passa da comandi
locali espliciti (`reconcile`, `reconcile-writer`, `reconcile-install`,
`reconcile-operation`), ognuno con la propria conferma umana. Un'identità di processo
sconosciuta resta un blocco: la terminazione di un figlio diretto non prova che l'intero
albero sia finito, e il recupero di un gate marca il tentativo come non verificato invece
di dichiararlo riuscito.

## Cosa non succede, mai

- Forgeyard non chiama modelli, non legge credenziali, non avvia Claude Code o Codex e
  non sostituisce i loro abbonamenti, quote o permessi.
- Le autorizzazioni dei prompt esprimono un'intenzione; non sono isolamento del sistema
  operativo. Esegui il client con i permessi appropriati sul repository.
- Un'inferenza non viene presentata come evidenza verificata, e un controllo strutturale
  non viene presentato come prova live con un client.
- Push, issue remote, deploy, pubblicazioni, acquisti e messaggi restano effetti esterni
  separati e autorizzati.

## Passaggi ancora necessari

Collegare l'area personale ai punti d'ingresso reali dei client, distribuire o riusare le
capacità pertinenti, integrare stato e verifiche per i repository membri, e collaudare il
percorso completo nelle app. Questi passaggi completeranno **lo stesso** ingresso: non
diventeranno una sequenza di comandi da memorizzare.

Il risultato finale resta quello: preparo una volta il workspace, apro la mia
conversazione, descrivo il software, e nei commit finisce soltanto il software.
