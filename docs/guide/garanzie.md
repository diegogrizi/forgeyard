# Garanzie

Sei garanzie, e per ognuna la stessa domanda: **cosa la fa fallire?** Una garanzia che
non può fallire non è una garanzia, è una frase. Qui ci sono i meccanismi, i loro codici
di errore e — soprattutto — ciò che non promettono.

La tesi da cui discendono è in [Direzione](../DIREZIONE.md). Quanto di ognuna è
davvero sul percorso di un comando ordinario è registrato, con la sua data, in
[Stato](../STATO.md). Cosa fare quando una di queste garanzie ti si presenta come un
rifiuto — un verdetto bloccato, una deriva segnalata — è in
[Risoluzione dei problemi](problemi.md).

## G1 — Identità congelata

**La promessa.** L'imbracatura approvata è, byte per byte, l'imbracatura che gira.

**Il meccanismo.** La capsula (`.forgeyard/capsule.json`) è indirizzata per contenuto:
compilatore e versione di protocollo, proiezioni selezionate, lock di provenienza,
metodo, gate e policy, più l'inventario dei file posseduti con le loro impronte. Ogni
mutazione del runtime nativo cita la capsula corrente.

**Cosa la fa fallire.** Se un file dell'imbracatura non corrisponde più al proprio
digest, la capsula non si apre: `FY_CAPSULE_DRIFT` e il lavoro si ferma, invece di
procedere su basi diverse da quelle approvate. La migrazione è un atto esplicito.

**Cosa non promette.** La capsula non è un archivio autonomo che contenga tutti i byte
canonici delle sorgenti: è un'identità più un inventario. Aggiornare la fabbrica non
aggiorna i progetti già installati, e non li migra in silenzio.

## G2 — Evidenza classificata

**La promessa.** Ogni affermazione porta un livello dichiarato, e i livelli non sono
interscambiabili.

| Livello | Significato | Cosa deve portare |
|---|---|---|
| `executed` | un gate congelato è stato eseguito | identificativo del gate, impronta dell'argv, exit code, impronta degli input, istante |
| `observed` | dei byte sono stati letti | percorso di progetto, impronta dei byte, locatore opzionale, istante |
| `derived` | inferenza da evidenza citata | le affermazioni su cui poggia, e una regola ispezionabile |
| `asserted` | prosa del modello | nulla: è prosa, e lo dichiara |

**Il meccanismo.** La scala è un tipo somma, non un'etichetta. Una derivazione **non
viene mai promossa** al livello delle proprie fonti: un'inferenza costruita su due gate
eseguiti resta un'inferenza. Ciò su cui poggia è riportato a parte, e una catena vale
quanto il suo anello più debole.

Il verdetto di consegna (`fy_finalize`) riformula il run su questa scala: i gate che
hanno girato sono `executed`; un criterio soddisfatto da tutti i gate che nomina è una
inferenza fondata su di essi; un criterio sostenuto soltanto da impronte, e ogni
artefatto di review, sono `observed`; le decisioni registrate sono prosa. Il certificato
dichiara i livelli del proprio supporto, il livello più debole e su cosa poggia in
ultima istanza, così un lettore distingue una consegna sostenuta da test eseguiti da una
sostenuta da ispezione di file.

**Cosa la fa fallire.** La regola che dà valore all'intera scala:

> Un verdetto che si appoggia a un'affermazione `asserted` non può essere emesso.

Se il supporto non è certificabile, il verdetto è `blocked` e compare il divario
`evidence:unsupported-verdict`. È un gate, non una nota a piè di pagina. Sono rifiutate
con `FY_CLAIM_INVALID` anche le forme non verificabili: un'impronta che non è uno sha256
minuscolo, un istante che non è un UTC ISO-8601 con i millisecondi, un identificativo
duplicato, una derivazione circolare, una catena troppo profonda, una derivazione da
prosa. **Un supporto vuoto non è un supporto**: l'insieme vuoto non è certificabile.

**Cosa non promette.** Un verdetto `delivered` non è una prova di correttezza universale
del software. Dice che i criteri dichiarati sono legati a evidenza corrente, che i gate
richiesti sono passati su quella revisione, e su cosa poggia il tutto.

## G3 — Citazioni vive

**La promessa.** Un'affermazione non punta a un file: punta a un percorso, un locatore
opzionale e l'impronta dei byte che ha letto.

**Il meccanismo.** Uno stato per citazione, ricalcolabile in qualunque momento senza
rieseguire nulla:

| Stato | Significato |
|---|---|
| `live` | la fonte esiste e ha ancora l'impronta citata |
| `stale` | la fonte esiste ma i byte sono cambiati |
| `missing` | la fonte non è raggiungibile come file regolare e limitato |

I collegamenti simbolici non vengono mai seguiti, i percorsi non lasciano la root, e il
tutto è limitato in byte. Un errore che significa «non è il file regolare che la
citazione dichiara» diventa `missing`; qualunque altro errore resta un'eccezione,
perché un difetto di programmazione non deve nascondersi dentro un risultato.

**Cosa la fa fallire.** Il runtime nativo rifiuta un riferimento di evidenza che non sia
`live`, e un criterio sostenuto da una fonte cambiata o scomparsa non sostiene più il
verdetto. Una citazione mal formata è `FY_CITATION_INVALID`; procedere con fonti non
vive è `FY_CITATION_STALE`.

**Cosa non promette.** La liveness confronta byte. Dice che la fonte è la stessa, non che
l'affermazione fosse corretta quando è stata scritta.

## G4 — Deriva rilevata

**La promessa.** L'imbracatura genera istruzioni che descrivono il progetto; il progetto
cambia. La documentazione che invecchia è un difetto rilevabile, non un fatto della vita.

**Il meccanismo.** Una scansione confronta il profilo congelato nella capsula — tipo,
linguaggi, framework, gate, file posseduti — con un'ispezione fresca e limitata dello stesso
progetto. Il rapporto porta l'impronta dei due profili confrontati, così può essere citato.

| Severità | Esempi |
|---|---|
| bloccante | il comando di un gate non esiste più, la sua directory è scomparsa, un file dell'imbracatura è cambiato o illeggibile |
| importante | un framework o un linguaggio dichiarato non si vede più, il tipo di progetto è cambiato |
| informativa | un framework o un linguaggio è comparso |

**Le politiche di percorso non sono confrontate**, ed è una scelta. Né i percorsi protetti
né le radici scrivibili: sono regole, non osservazioni. L'imbracatura protegge `.env` perché
le scritture vengano rifiutate *se* mai comparisse, e concede una radice perché vengano
permesse *se* mai venisse creata. In entrambi i casi l'assenza del percorso non impedisce
all'imbracatura di operare, e la capsula ha congelato una regola e non un avvistamento:
un percorso scomparso non si distingue da uno che non c'è mai stato. Confrontarli misurava
come derivata ogni installazione corretta di un profilo che concedeva una radice di cui non
installava il contenuto: cioè un controllo che nessuno legge.

Una conclusione vale quanto l'osservazione che la sostiene, e due cose la rendono
**inconclusiva**. La prima: una scansione limitata dichiara ciò che non ha visitato, e non
avere visto una cosa non prova che non ci sia. La seconda: l'osservazione appartiene a un
vocabolario diverso da quello della dichiarazione congelata. Un gate è dichiarato da chi
prepara e può invocare un programma che l'ispezione non enumera; il suo comando risulta
assente dall'elenco scoperto anche quando è perfettamente presente sul disco. Il confronto
vale quindi soltanto dove i due vocabolari si toccano — l'ispezione ha visto altri comandi
di quello stesso programma — e altrove il rilievo è dichiarato senza concludere, nella sua
stessa frase e non solo in un campo. Un'impronta cambiata e una capacità comparsa poggiano
su ciò che è stato osservato, quindi restano conclusive.

**Cosa la fa fallire.** Un input malformato è `FY_DRIFT_INVALID`.

**Cosa non promette.** La deriva **non blocca**: è informazione su un progetto che è
cresciuto, non un'installazione rotta. Ed è una scansione, non uno snapshot transazionale:
il filesystem può cambiare mentre gira.

**Dove la incontri.** Nel controllo `harness-drift` di `forgeyard doctor`. Non è un
controllo richiesto: la deriva non affonda il verdetto dell'installazione, perché un
progetto che è cresciuto non ha un'installazione rotta. Un esito negativo è riservato alla
deriva che impedisce all'imbracatura approvata di operare.

## G5 — Misura dichiarata

> **Il confronto con un costo umano avviene solo se qualcuno lo dichiara.** Il certificato
> riporta sempre il lato agentico; il lato umano compare soltanto quando è stato dichiarato
> in `forgeyard.yaml`, e in sua assenza resta **assente** — non stimato.

**La promessa.** «L'AI è stata più veloce» diventa un numero con un metodo dichiarato e
un margine, oppure resta non misurato.

**Il meccanismo.** Osservazioni riportate esplicitamente da una parte; dall'altra una
linea di base umana **dichiarata da una persona** — metodo (`declared-estimate` o
`reference-class`), ore, tariffa, confidenza e la fonte ispezionabile della stima, con
un intervallo di ore opzionale da cui derivare i limiti del rapporto.

La regola che dà valore ai numeri:

> Una misura che non è stata riportata torna `unmeasured` con la sua ragione. Mai zero,
> mai una stima plausibile.

Ne segue il resto. Se anche una sola osservazione non ha riportato un costo, il costo
totale è `unmeasured`: una somma parziale sarebbe una bugia. Uno span di orologio richiede
almeno due osservazioni. Un rapporto che dividerebbe per zero è `unmeasured` con quella
ragione, non infinito. E il rapporto porta i propri avvertimenti: meno di tre
osservazioni sono un campione sottile, osservazioni sovrapposte lo dicono, uno span più
lungo della somma delle durate dichiara che il rapporto sui tempi ignora il tempo di
attesa, una linea di base senza intervallo dichiara di sembrare più precisa di quanto sia.

**Cosa la fa fallire.** Una misura negativa, non finita, non intera dove serve, o una
linea di base incoerente con il proprio intervallo: `FY_MEASURE_INVALID`. Il modulo è
puro — nessun I/O, nessun orologio, nessuna casualità — quindi non può né raccogliere né
inventare.

**La linea di base umana non è inferibile.** Deve essere dichiarata da una persona, in un
file che quella persona possiede. Senza quella dichiarazione il confronto resta
**assente**, non stimato: nessun rapporto, nessun intervallo, nessun «circa». Un numero
che nessuno ha firmato non è una linea di base, è un'opinione con i decimali.

**Come si dichiara.** In `forgeyard.yaml`, che è il file posseduto dalla persona:

```yaml
measurement:
  humanBaseline:
    method: declared-estimate      # oppure reference-class
    hours: 8
    hourlyRateUsd: 75
    confidence: medium
    source: "Stima del responsabile tecnico, 2026-09-22"
    rangeHours: { low: 6, high: 12 }
```

Il run conserva le osservazioni **una per una** — provider, modello, token in ingresso e
in uscita, durata, costo — invece del solo totale, perché un totale non è auditabile.
L'istante di ciascuna lo timbra il programma: un timestamp fornito dal modello non è
un'osservazione.

La linea di base **non entra nella capsula**: non governa niente in esecuzione, e
congelarla avrebbe cambiato l'identità delle imbracature già installate senza motivo. Il
certificato registra invece i valori usati e la loro impronta, così una modifica
successiva del file non può cambiare un verdetto già emesso.

**Cosa non promette.** Il tetto di costo registrato non è un limite di spesa presso il
provider, e Forgeyard non misura automaticamente i token.

## G6 — Coerenza dell'imbracatura generata

**La promessa.** Forgeyard non copia template: **compila** un'imbracatura, e la rifiuta
se è incoerente, prima di scriverla su disco.

**Il meccanismo.** Il lint gira dentro la costruzione del piano di installazione, che è
l'unico punto da cui esce un'imbracatura: il gate vale quindi per ogni percorso di
installazione e aggiornamento, senza essere enunciato due volte.

| Regola | Severità | Difetto |
|---|---|---|
| `dangling-reference` | bloccante | un riferimento che non risolve su nessun file installato o preesistente |
| `absolute-path-leak` | bloccante | un percorso assoluto della macchina di chi ha generato |
| `unresolved-placeholder` | bloccante | un segnaposto non sostituito |
| `duplicate-authority` | bloccante | due componenti omonimi che collidono in silenzio |
| `context-budget-exceeded` | importante | un file di istruzioni oltre il proprio tetto di byte |
| `orphan-reference` | importante | un file installato che nessuna istruzione raggiunge |
| `empty-instruction` | importante | un'istruzione senza contenuto azionabile |
| `volatile-reference` | importante | un riferimento che invecchia da solo: SHA di commit, numero di riga |

I tetti di contesto sono misurati in byte, distinguendo il file di istruzioni radice dagli
altri. Le citazioni dentro blocchi di codice recintati non contano come riferimenti
volatili: in un comando di esempio un valore volatile è legittimo.

**Ownership.** Un difetto sui byte **vendored** viene dichiarato ma non respinge
l'installazione: quei byte sono conservati identici sotto la loro licenza e non sono
nostri da riparare. Soltanto un bloccante su byte **generati da noi** ferma
l'installazione, con `FY_HARNESS_INCOHERENT`, e l'imbracatura non viene scritta.

La differenza fra dichiarato e bloccante non è teorica, ed è misurabile su
un'installazione reale: l'imbracatura minima passa pulita su entrambi gli adapter, mentre
con il catalogo di terze parti installato il lint dichiara **centinaia** di rilievi — in
gran parte riferimenti interni che quella composizione non installa — senza fermare
l'installazione. I conteggi esatti, con la loro data, sono in [Stato](../STATO.md).

**Cosa non promette.** Il lint verifica la coerenza strutturale di ciò che installa. Non
giudica se un'istruzione sia un buon consiglio, e non è una valutazione del
comportamento di ogni skill di terzi.

## Perché in codice e non in prosa

Una convenzione scritta in un prompt si può violare per distrazione, e la violazione è
silenziosa: l'agente *crede* di seguire le istruzioni mentre ne ignora dei pezzi. Il
criterio di progetto è quindi uno: **quando una regola può diventare una proprietà del
tipo o un controllo eseguibile, non va scritta in prosa.** La prosa resta per spiegare il
perché — ed è quello che sta facendo questa pagina.

Due corollari, imparati da difetti reali:

- **Una regola, una sede.** Se una regola è enunciata in due file, divergeranno, e il
  consumatore più permissivo diventa il contratto reale. In codice: la regola vive in un
  modulo, gli altri la importano. È per questo che G6 sta dentro la costruzione del
  piano, e non in ogni comando che installa.
- **Il controllo deve avere la granularità del contratto che protegge.** Verificare che
  un file esista non protegge da un controllo assente *dentro* quel file.

Dove vivono i moduli e quali confini rispettano è in [Architettura](architettura.md).
