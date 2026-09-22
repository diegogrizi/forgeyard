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

## Rimossi: grafo delle attività, worktree e ledger

Registrato il **22 settembre 2026.** I comandi `forgeyard task`, `forgeyard workspace`,
`forgeyard ledger` e `forgeyard guard` **non esistono più**, insieme allo scheduler, ai
worktree Git di attività, al registro delle osservazioni e alla valutazione degli ambiti
fuori dal runtime nativo.

Il repository conteneva due cicli di vita per la stessa cosa — piano, attività, claim,
checkpoint, verifica, finalizzazione — e due sistemi di attività significano zero autorità.
È sopravvissuto il runtime nativo cooperativo, che è quello allineato al manifesto e quello
che le app attraversano davvero.

**Cosa resta.** Il contratto di attività e le ricevute di verifica: un file in
`.forgeyard/tasks/` non è un pezzo di scheduler, è un contratto con obiettivo, criteri,
argv di verifica e ambiti di scrittura, e `forgeyard verify <task-id>` produce ancora una
ricevuta legata ai byte dell'attività e alla revisione Git.

**Il guard di scrittura.** Il gancio `PreToolUse` per Claude Code resta, ed è diventato
nativo soltanto. Prima preferiva lo stato nativo e in sua mancanza cadeva su un file JSON:
ma quel ramo era il più permissivo dei due percorsi che proteggono la stessa cosa, e il
consumatore più permissivo diventa il contratto reale. Il percorso nativo verifica
capsula, lease dello scrittore, concessione di consenso e ogni impronta dell'imbracatura
congelata prima di rispondere; l'assenza di un work order nativo adesso nega, non degrada.

Per Codex, che non offre lo stesso contratto `PreToolUse`, gli ambiti di scrittura
arrivano nel work order restituito da `fy_next` e restano **consultivi**: un'istruzione
non è un confine applicato dal sistema operativo.

## Limiti dichiarati di questi percorsi

- Forgeyard non avvia Claude Code, Codex o una flotta di worker a pagamento.
- Non garantisce isolamento dal sistema operativo a partire da una policy nei prompt.
- Non analizza comandi di shell arbitrari per inferire ogni mutazione possibile del
  filesystem.
- Non misura automaticamente i token o il costo di un provider: il runtime nativo accetta
  soltanto osservazioni esplicitamente riportate, e un'osservazione assente resta non
  misurata.
- I controlli strutturali dell'adapter non sono evidenza di una sessione autenticata con
  un client reale.
- Deploy, pubblicazione, messaggi e acquisti restano fuori dal workflow installato.
