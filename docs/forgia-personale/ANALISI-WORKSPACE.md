# Prima base del workspace personale

Incremento P1 del [piano](PIANO.md). Il comando diagnostico non sostituisce il futuro setup: espone la ricognizione da integrare nel wizard e nel servizio nativo.

Dopo la compilazione del checkout e il collegamento del binario esistente (`npm ci`, `npm run build`, `npm link`), dalla cartella di lavoro:

```sh
forgeyard analizza
forgeyard analizza --json
```

È possibile indicare una cartella diversa senza spostarsi: `forgeyard analizza /percorso/workspace`. Il pacchetto non è presentato come una release npm pubblicata. Queste istruzioni si riferiscono al checkout del branch.

## Comportamento implementato

La scansione in sola lettura distingue una cartella vuota, un contenitore, una root Git e un workspace con più repository. Riconosce repository senza commit, linked worktree e submodule. I progetti rilevati dai manifest vengono associati al repository più vicino, senza inventare un Git esterno. Quando la cartella selezionata è dentro un repository esterno, la root resta quella scelta e il contenitore Git viene soltanto segnalato.

Legge soltanto i manifest ammessi per rilevare indizi JVM/Spring, JavaScript/TypeScript, React, Angular, Next.js, NestJS, CMake e Meson. Non esegue gli script, non restituisce i contenuti dei manifest e non considera una rilevazione prova di supporto verificato.

Nessuna scrittura, inizializzazione Git, installazione, accesso ai modelli, modifica di configurazioni o download. I metadati Git sono interrogati con rev-parse; non vengono invocati hook o comandi applicativi. Non vengono attraversati collegamenti simbolici nella scansione; i percorsi amministrativi di Git vengono risolti per riconoscere worktree e submodule, non per leggerne i segreti.

## Limiti espliciti

Default: profondità 6, 4.096 elementi, 64 repository, 1.024 cartelle; manifest fino a 128 KiB ciascuno e 2 MiB complessivi. Directory di dipendenze, output e configurazioni personali sono escluse. La scansione è per livelli; se raggiunge un limite, i risultati sono parziali e dichiarati tali. Il campione entro un limite non è una lista completa, né un ordinamento garantito di tutto ciò che esiste sul disco.

Il JSON contiene `scan.status`, limiti e avvisi. Exit 0 indica una risposta valida, anche se parziale: il chiamante deve leggere `scan.status`. Exit 2 indica argomenti invalidi; exit 4 una root o un'ispezione non utilizzabile. Nessun installer dovrà interpretare automaticamente `scan.status: limited` come autorizzazione a modificare il workspace.

Il filesystem può cambiare durante la scansione: questa è una ricognizione, non uno snapshot transazionale né una sandbox contro processi con gli stessi privilegi.

## Cosa non è ancora implementato da P1

La forgiatura privata, le esclusioni Git dei file della suite, il riuso dei plugin globali, i binding nativi del workspace e l'esecuzione multi-repository sono gli incrementi successivi. I comandi legacy connect/prepare mantengono i propri limiti: non usare questo diagnostico come prova che siano già migrati.

Il risultato finale resta: programma una volta sul PC; forgia locale nella cartella scelta; conversazione in Claude/Codex; soltanto software nei commit dei repository.
