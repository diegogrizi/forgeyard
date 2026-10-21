# Provenienza delle fonti esterne

Forgeyard distribuisce i riferimenti al catalogo portabile, con una selezione di plugin
ammessi. I contenuti di terzi vengono recuperati quando servono a una preparazione.

- Progetto: [`wshobson/agents`](https://github.com/wshobson/agents)
- Revisione richiesta per una nuova preparazione: `HEAD`
- Licenza dichiarata della fonte: MIT
- Riferimento e selezione: `packs/ecosystem/source.json`
- Metadati della fonte: `sources/catalog.yaml`

Il pacchetto npm contiene il riferimento e il manifest del pack `ecosystem`. Lo snapshot
del catalogo, la sua vecchia attestazione `UPSTREAM.json` e i vettori `npm-carriers` sono
stati rimossi dal pacchetto. La cache dei download vive fuori dal repository e dal
pacchetto distribuito.

## Recupero e identità dell'installazione

Una nuova preparazione risolve `HEAD` a un commit esatto e recupera soltanto i plugin
selezionati e la licenza upstream. Forgeyard legge questi contenuti senza eseguire
script o hook della fonte.

L'indice generato nel progetto conserva fonte, commit esatto e licenza. Il lock e il
manifest registrano le impronte dei file installati; l'inventario della cache conserva
quelle dei file scaricati.
Questa identità rimane congelata durante l'uso ordinario e le successive preparazioni
dell'installazione esistente. L'aggiornamento esplicito è il punto in cui viene risolta
una revisione nuova; un cambiamento upstream da solo non modifica il progetto.

Se il recupero necessario non riesce, la preparazione fallisce con un errore che invita
a controllare connessione e disponibilità della fonte. La cache conserva contenuti
indirizzati per revisione e selezione e ne verifica le impronte prima del riuso.

## Che cosa verifica la release

```sh
npm run catalog:check
npm run provenance:check
```

`catalog:check` lavora offline. Valida il riferimento, la coerenza di repository,
revisione e licenza fra pack e catalogo delle fonti, e i nomi dei plugin richiamati dai
profili, dalle regole di selezione e dai descrittori di capacità. Le esclusioni delle
regole indicano componenti da non selezionare: non ampliano la lista da scaricare.
Questo controllo non interroga upstream e non dichiara verificata l'esistenza attuale
dei plugin remoti. L'acquisizione verifica i contenuti effettivamente recuperati.

`provenance:check` confronta gli avvisi e lo SBOM con gli input locali. Gli avvisi
indicano la fonte MIT come riferimento esterno. Lo SBOM SPDX la descrive con
un'annotazione, senza presentarla come codice incorporato nel pacchetto e senza una
relazione `CONTAINS` per il catalogo. Le dipendenze npm rimangono descritte dal lock.

L'audit di release rifiuta un albero del vecchio catalogo o vettori `npm-carriers`
ricomparsi sotto `packs/ecosystem/`. Il test del pacchetto pubblico verifica che di quel
pack viaggino soltanto `pack.yaml` e `source.json`.

La serializzazione dei pacchetti npm nello SBOM usa soltanto il lock normalizzato —
nome, versione, licenza dichiarata, URL e impronte — e comprende anche i pacchetti
opzionali non installati. Una licenza mancante resta `NOASSERTION`: gli artefatti non
dipendono dai binding opzionali della piattaforma che li genera.

Il codice di adattamento di Forgeyard resta Apache-2.0. I file esterni mantengono le
proprie attribuzioni e licenze nell'installazione che li contiene.
