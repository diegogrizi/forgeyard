# Percorsi legacy

Riferimento di manutenzione, **non** la guida di ingresso. Per iniziare, vedere
[Uso](guide/uso.md).

Questi percorsi sono ancora nel checkout e i loro comandi rispondono, ma sono in
dismissione: non vanno ampliati, e non vanno presentati come il modo ordinario di usare
Forgeyard. Cosa sia già stato rimosso e cosa sia ancora in corso è registrato, con la sua
data, in [Stato](STATO.md). Il motivo del taglio è in [Direzione](DIREZIONE.md).

Restano documentati perché servono a tre cose: ispezionare un progetto preparato con essi,
recuperarlo dopo un'interruzione, e disinstallare.

## Preparazione deterministica

Anteprima dell'evidenza e della composizione proposta, senza scrivere nulla:

```sh
forgeyard inspect ./mio-progetto --brief "Aggiungi il recupero del checkout"
```

Preparazione da un brief, da specifiche relative al progetto o da un README esistente:

```sh
forgeyard prepare ./mio-progetto --spec requirements.md --timebox 240 --autonomy balanced --yes
```

La preparazione automatica legge evidenza locale limitata senza seguire i collegamenti
simbolici e senza leggere valori segreti; sceglie un insieme di capacità minimo e coerente
ed esclude esplicitamente gli orchestratori concorrenti; preserva un `AGENTS.md` o
`CLAUDE.md` di root già esistente installando le istruzioni compagne in
`.forgeyard/HOST.md`; registra la decisione, così un aggiornamento successivo non
reinterpreta in silenzio la deriva del repository; e passa dallo stesso confine
transazionale di doctor e rollback dell'installazione manuale.

## Installazione manuale per profilo

`forgeyard init` resta disponibile quando si vuole deliberatamente un profilo fisso del
catalogo. Non è il punto di partenza consigliato.

```sh
forgeyard init ./mio-progetto --profile minimal --adapter codex
forgeyard init ./mio-progetto --profile minimal --adapter claude-code
forgeyard init ./mio-progetto --profile minimal --adapter codex --answers ./answers.yaml --yes
forgeyard init ./mio-progetto --profile minimal --adapter codex --answers ./answers.yaml --dry-run --json
```

I profili manuali `full` e `hackathon` sono in rimozione: `full` installa tutto, che è
esattamente la libreria di intenzioni da cui il prodotto si distingue. `minimal` è il
piccolo nucleo di ciclo di vita.

## Ispezione, verifica, aggiornamento, disinstallazione

```sh
forgeyard doctor ./mio-progetto
forgeyard update ./mio-progetto --dry-run --json
forgeyard update ./mio-progetto --yes
forgeyard rollback <id-operazione> --root ./mio-progetto --yes
```

La verifica di un'attività esegue l'esatto array argv memorizzato, con l'espansione della
shell disabilitata, e registra impronte e conteggi di byte — mai il corpo di stdout o
stderr. Richiede un `HEAD` Git reale e pulito:

```sh
git -C ./mio-progetto add --all
git -C ./mio-progetto commit -m "congela il candidato di verifica"
forgeyard verify T001 --root ./mio-progetto --json
```

Una ricevuta è corrente soltanto mentre restano invariati i byte dell'attività, l'argv
esatto, un `HEAD` pulito e il commit. Un commit successivo rende deliberatamente stantia
la ricevuta precedente: si riesegue la verifica, non si promuove la prova vecchia. **Una
ricevuta legacy non è il certificato di consegna nativo**, che è derivato dall'evidenza
corrente e dichiara i propri livelli — vedere [Garanzie](guide/garanzie.md).

Il rollback dell'installazione iniziale è il percorso di disinstallazione supportato:
rimuove i file gestiti rimasti invariati, conserva `forgeyard.yaml` e lascia stare i file
non correlati. I giornali di recupero restano sotto `.forgeyard/state/operations/`. Sono
preservati anche i file seme umani — il brief di progetto, il passaggio di consegne
corrente e il rapporto di run — così disinstallare la fabbrica gestita non cancella
l'intento del progetto né la storia della consegna.

## Grafo delle attività e worktree

```sh
forgeyard task status --root .
forgeyard task next --root . --json
forgeyard task claim T001 --worker implementer-1 --root .
forgeyard task checkpoint T001 --worker implementer-1 --note "test RED catturato" --root .
forgeyard task resume T001 --worker implementer-1 --root .
forgeyard task complete T001 --worker implementer-1 --receipt <id-ricevuta> --root .
forgeyard guard T001 src/esempio.ts --root .
```

Le osservazioni di consumo sono esplicite, una per volta, e tutte obbligatorie:

```sh
forgeyard ledger record --task T001 --provider <id> --model <id> \
  --input-tokens <n> --output-tokens <n> --cost-usd <valore> --duration-ms <n> --root .
```

Le definizioni delle attività stanno in `.forgeyard/tasks/`; claim, checkpoint, scadenze,
fallimenti e identificativi di evidenza stanno separatamente in
`.forgeyard/state/run.json`, così modificare una definizione non riscrive in silenzio la
storia. Un ordine di lavoro non rivendica un'attività e non avvia un client. `claim`
applica la prontezza delle dipendenze, il tetto di concorrenza, i budget di
tentativi, tempo e costo, e gli ambiti di scrittura sovrapposti. Se esiste un tetto di
costo ma il client non ha riportato un consumo, l'ordine dice `unmeasured`: mai zero.

```sh
forgeyard workspace create T001 --worker implementer-1 --root .
forgeyard workspace validate T001 --worker implementer-1 --root .
forgeyard workspace integrate T001 --worker implementer-1 --root .
forgeyard workspace cleanup T001 --worker implementer-1 --root .
```

L'integrazione è serializzata da un lock atomico su una ref Git con un record immutabile
di proprietario — token, host, processo — che permette di recuperare un proprietario locale
morto senza un timeout sul tempo trascorso. Verifica il branch dell'attività, prepara un
merge senza commit, esegue il comando sull'albero combinato, annulla un merge fallito o in
conflitto, crea il commit di merge soltanto dopo quel gate, e verifica di nuovo il commit
congelato. Dopo quel punto di successo durevole rimuove il worktree, verifica che l'esatta
registrazione in `.git/worktrees` sia scomparsa, e in una sola transazione di ref conferma
che il branch obiettivo è invariato mentre elimina il branch del worker soltanto sul
commit validato. Se la pulizia si interrompe, l'integrazione completata resta registrata e
`workspace cleanup` ritenta soltanto la pulizia.

Forgeyard non esegue push, non fa deploy, non elimina con forza un branch non unito, non
rimuove una directory non registrata e non risolve un conflitto al posto dell'operatore.

## Limiti dichiarati di questi percorsi

- Forgeyard non avvia Claude Code, Codex o una flotta di worker a pagamento.
- Non garantisce isolamento dal sistema operativo a partire da una policy nei prompt.
- Non analizza comandi di shell arbitrari per inferire ogni mutazione possibile del
  filesystem.
- Non misura automaticamente i token o il costo di un provider: `forgeyard ledger record`
  accetta soltanto osservazioni esplicite.
- I controlli strutturali dell'adapter non sono evidenza di una sessione autenticata con
  un client reale.
- Deploy, pubblicazione, messaggi e acquisti restano fuori dal workflow installato.
