# Un lavoro su più repository membri — design

Registrato il **25 settembre 2026**. Incremento **P5** del piano in [Stato](../../STATO.md).

## Il problema, misurato

Su un workspace che contiene due repository membri, oggi:

| Passo | Esito misurato |
|---|---|
| ricognizione | corretta: `multi-repository`, 2 repository, 2 progetti |
| ingresso guidato | installa 79 file **senza obiezioni** |
| primo `fy_attach` | **`FY_GIT_REQUIRED`** |

Il runtime lega un lavoro a un solo albero Git e a un solo HEAD, e alla radice di
quel workspace non ce n'è nessuno. Da `f9caf51` l'anteprima almeno **lo dichiara**
prima della conferma, invece di far scoprire il rifiuto dopo l'installazione.

Questo documento progetta l'esecuzione vera.

## Cosa NON è il problema

L'analisi iniziale sosteneva che servisse ridefinire cosa sia una revisione. Era
sovraccarica. Le evidenze sono **già** naturalmente per repository: ogni membro ha
il proprio commit e i propri gate, quindi «la prova del pezzo di lavoro svolto lì»
è ben definita senza inventare concetti.

Due fatti verificati restringono ulteriormente il lavoro:

- **Il write-guard non va toccato.** Prende la radice da `CLAUDE_PROJECT_DIR` — la
  cartella che il client apre — e confronta percorsi già relativi a quella. Un
  ambito `servizio-ordini/src` lo gestisce oggi.
- **La capsula e lo schema del protocollo 0.2 restano invariati.** La capsula è
  indirizzata per contenuto: cambiarne la forma invaliderebbe ogni installazione.

## Decisioni

Quattro, prese esplicitamente e non derivabili dal codice.

| # | Decisione | Conseguenza |
|---|---|---|
| 1 | **Una imbracatura alla radice del workspace**, non una per membro | una sola copia del catalogo, istruzioni in un posto, l'agente vede tutti i membri |
| 2 | **Un lavoro può attraversare i membri**; le prove si legano a più HEAD | è il caso cross reale, non N sessioni che non si parlano |
| 3 | **`delivered` richiede ogni membro toccato pulito** | altrimenti `blocked`, col membro nel divario. Nessuno stato nuovo da interpretare |
| 4 | **Contano solo i membri toccati** | un commit in un membro estraneo non invalida niente, e due lavori paralleli non si annullano |

La decisione 3 è la regola di oggi — nessun gate mancante, nessuna consegna —
estesa ai membri. La decisione 4 è ciò che rende possibile la convivenza di più
lavori nello stesso workspace: la regola conservativa di oggi, dove ogni movimento
dell'albero rende stantie le prove, in multi-repository impedirebbe a qualunque
lavoro di arrivare a `delivered`.

## Architettura

### Da un ambito al suo membro

Il servizio non esegue la ricognizione, quindi non chiede a nessuno quali siano i
membri: li **osserva**. Per ogni ambito di scrittura risale da `root/<ambito>`
verso `root` cercando un albero di lavoro Git.

```text
writeScopes: ["servizio-ordini/src", "frontend/src"]
   ↓  risalita alla ricerca di un albero Git
membri toccati: {"servizio-ordini", "frontend"}
```

Nel caso a repository singolo la risalita si ferma sulla radice e il membro è
`"."`: **il comportamento di oggi per costruzione**, non per un ramo speciale.
Questa funzione è pura rispetto alla decisione e fa solo I/O di presenza, quindi
è provabile senza un runtime.

Due casi vanno decisi qui, non a implementazione in corso:

- **Un ambito che non esiste ancora.** Gli ambiti di scrittura nominano cartelle che
  il lavoro può creare. La risalita parte quindi dall'antenato più vicino che esiste
  davvero: un ambito `frontend/src/nuovo` in un `frontend` che è un repository dà
  `frontend`, senza pretendere che `src/nuovo` sia già lì.
- **Un repository annidato dentro un membro.** Vince l'albero **più vicino**: chi possiede
  quel percorso è il working tree che lo contiene, ed è il suo HEAD a dire se è cambiato.
  È la stessa regola che la ricognizione applica già ai repository annidati.

### Dove vive il multi-HEAD

```text
WorkspaceSnapshot
├── members: Map<membro, { head, clean, sha256, changedPaths }>   ← nuovo
└── sha256: string        ← aggregato sui SOLI membri toccati
```

L'impronta aggregata resta **una stringa**. Quindi `invalidEvidence`,
`currentCompletion`, `evidenceGaps` e il confronto con `grant.approvalBaseline`
non cambiano forma, e i circa quaranta punti del servizio che passano quella
stringa restano come sono. La natura multi-HEAD vive *dentro* il calcolo del
digest; la mappa viaggia accanto e serve a nominare il membro nei divari.

Le quattro letture Git per membro girano **in parallelo**, con lo stesso pool che
ha dimezzato il costo delle chiamate di protocollo: un membro in più non aggiunge
un round trip in fila.

### Le due forme persistite che cambiano

| Sito | Oggi | Domani | Perché |
|---|---|---|---|
| `NativeRun.baselineHead` | `string` | `Record<membro, string>` | serve per `git diff <baseline> HEAD` e `changedSince`: con N membri servono N baseline e N `cwd` |
| ricevuta del gate, `gitCommit` | `string` | `Record<membro, string>` | una ricevuta deve dire su quale revisione ha girato, e con due membri ce ne sono due |

Il costo di compatibilità è **teorico**: quelle forme vivono nello stato privato,
e P3 non è mai stato provato live, quindi non esistono lavori in corso da migrare.
Va detto, non scoperto a metà.

### Diff e artefatto di revisione

Il diff che alimenta l'artefatto di revisione itera i membri con la propria `cwd`
e concatena, ogni sezione etichettata col membro. Un lavoro su un solo membro
produce un artefatto indistinguibile da quello di oggi.

## Come fallisce

Ogni garanzia ha il proprio modo di rompersi, altrimenti non è una garanzia.

| Situazione | Esito |
|---|---|
| un ambito non sta in nessun albero Git | `FY_GIT_REQUIRED` che **nomina l'ambito**, non la radice |
| un membro toccato non ha commit | rifiutato, col nome del membro |
| gate fallito in un membro | `blocked`, divario `gate:servizio-ordini/T1/G001` |
| la radice non è un repository | **non è più un errore**, se i membri lo sono |

I divari sono già stringhe: qualificarli col membro non cambia nessuna forma, e il
messaggio d'errore guadagna l'unica informazione che serve a chi lo legge — *quale*
membro.

## Come si prova

**Unità.** La derivazione ambito→membro, inclusi i casi limite: ambito alla radice,
membro annidato in una sottocartella, ambito che non sta in nessun repository,
ambito che risale oltre la radice. E l'aggregato che **ignora** i membri non
toccati, che è la decisione 4 resa verificabile.

**Integrazione.** Una fixture con due repository membri e quattro prove:

1. un lavoro su un solo membro consegna, e il suo certificato cita un HEAD;
2. un lavoro su due membri consegna, e cita due HEAD;
3. un gate fallito in un membro blocca il lavoro, e il divario nomina quel membro;
4. un commit in un membro **non toccato** non invalida le prove — la decisione 4
   provata dal comportamento e non dall'aritmetica.

Il nuovo file di integrazione dichiara il proprio tetto con la durata misurata
della sua prova più lenta, come impone `tests/unit/meta/declared-timeouts.test.ts`.

## Cosa questo design non fa

- Non introduce la **consegna parziale**: un lavoro su due membri è consegnato o
  bloccato, mai «uno su due». Definire il parziale è una domanda di prodotto
  («il frontend è rilasciabile senza il backend?») e non ha una risposta tecnica.
- Non conserva le prove di un membro pulito quando il lavoro riprende. Sarebbe la
  porta da cui rientra la promozione di una prova vecchia, che le ricevute stantie
  esistono per impedire.
- Non registra gli HEAD dei membri estranei come contesto: sarebbero dati che
  nessun controllo usa.
- Non crea un servizio per membro. Sarebbe **un secondo motore parallelo**, che
  [AGENTS.md](../../../AGENTS.md) vieta, e due autorità sullo stesso lease di
  scrittura.
