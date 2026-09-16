# Forgeyard — la forgia personale

Un programma installato una volta sul PC, un ambiente personale nella cartella scelta, la conversazione nelle app o CLI di **Claude Code e Codex**. La forgia deve aiutare a sviluppare il software senza imporre una seconda chat o una collezione di comandi da imparare.

**Questo branch è in ristrutturazione.** Non è ancora una release completa della suite personale: sono implementate la ricognizione del workspace e la registrazione privata. Il collegamento automatico alle conversazioni native, la selezione unificata e il riuso dei plugin globali sono i passaggi successivi.

## Un solo ingresso ordinario

Dopo avere installato il programma, apri il terminale nella cartella di lavoro ed esegui:

```sh
forgeyard
```

Il comando riconosce la cartella, mostra un riepilogo in italiano e chiede una sola conferma prima di creare l'area personale. Non devi scegliere profili, autori di skill, orchestratori o conoscere comandi di analisi separati. Senza terminale interattivo viene mostrata soltanto un'anteprima: non vengono scritti file.

Se l'area è già presente, non viene reinstallata e non viene aggiornata automaticamente. La versione attuale indica esplicitamente che il collegamento agentico non è ancora configurato: creare l'area non significa avere già agenti attivi.

## Dove puoi usarlo

La cartella può essere vuota, essere essa stessa un repository Git, trovarsi dentro un repository oppure contenerne diversi. Sono riconosciuti anche repository senza commit, worktree e submodule. La ricognizione dei manifest individua i progetti nei diversi membri senza eseguire i loro script.

```text
workspace/
├── .forgeyard/          ambiente personale
├── servizio-ordini/    repository Git
├── servizio-clienti/   repository Git
└── frontend/           repository Git
```

La registrazione scrive soltanto nella propria directory. Un'esclusione interna mantiene i file della forgia fuori dai normali commit, anche se Git viene inizializzato successivamente. File già tracciati, aree legacy, modifiche locali e percorsi non sicuri non vengono adottati o sovrascritti implicitamente. Non viene modificato il .gitignore condiviso del software.

## L'esperienza finale resta nella tua conversazione

A integrazione completata, aprirai la stessa cartella in Claude Code o Codex e descriverai il risultato: requisiti, attività, capacità e verifiche saranno gestiti dal workflow predisposto. Il programma non richiederà API key per un proprio modello, non leggerà le credenziali dei client e non sostituirà i loro abbonamenti o permessi.

**Questa integrazione finale non è ancora completata da questo incremento.** La [guida personale](docs/guides/forgia-personale.md) distingue ciò che puoi provare ora da ciò che resta da collegare. I vecchi percorsi non vanno usati per completare automaticamente una nuova area personale.

## Installazione dal checkout, per sviluppo

Il pacchetto non è presentato come una release già pubblicata su npm. Per collegare il comando da questo checkout servono Node **24.19.0 o una successiva versione 24.x** e Git. Nella cartella del repository Forgeyard, una volta:

```sh
npm ci
npm run build
npm link
```

Poi il comando ordinario resta `forgeyard`, dalla cartella del tuo lavoro. Il collegamento di sviluppo usa il checkout locale: le modifiche al programma richiedono una nuova compilazione; non trasformano la registrazione del workspace in una suite già completa.

## Sviluppo, verifiche e migrazione

La PR mantiene separati codice verificato, test strutturali e prove reali nelle app. I controlli includono registrazione privata, assenza di modifiche ai repository, preservazione dei file e riproducibilità dello SBOM su piattaforme diverse. I test non costituiscono una prova di integrazione live con Claude o Codex.

Il precedente [README tecnico](README-LEGACY.md) è conservato come documentazione dei percorsi legacy ancora presenti: **non è la guida iniziale della forgia personale**. I riferimenti a Cursor, profili completi, presentazioni e comandi di lifecycle verranno dismessi dopo la migrazione, non ampliati.

## Licenza

Codice e documentazione originali restano **Apache-2.0**. I componenti esterni conservano le proprie licenze e attribuzioni, incluso il catalogo MIT già presente. Questa ristrutturazione non cambia la licenza né i byte dei materiali di terzi.
