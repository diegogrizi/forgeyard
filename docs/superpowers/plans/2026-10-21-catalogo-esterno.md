# Catalogo esterno su richiesta

## Obiettivo approvato

Forgeyard conserva riferimenti alle fonti e i nomi delle capacità selezionabili. I contenuti
si scaricano dalle fonti esterne quando si prepara un progetto. Ogni nuova preparazione usa
la revisione corrente; un progetto già preparato conserva quella installata fino a `update`.

## Confini

- Togliere lo snapshot `packs/ecosystem/vendor/` dal repository e dal pacchetto.
- Riutilizzare selettore e adapter esistenti: nessun nuovo motore di sviluppo.
- Risolvere HEAD in un commit esatto e scaricare soltanto i plugin selezionati e la licenza.
- Conservare cache fuori dal repository; nessuna esecuzione di script o hook scaricati.
- Conservare revisione e impronte nell'indice installato, protetto dai controlli esistenti.
- La ricognizione e le verifiche della factory restano offline; la preparazione dichiara
  il recupero esterno. Un errore di rete lascia il progetto senza scritture parziali.

## Lavoro

- [x] Testare acquisizione selettiva, aggiornamento della fonte, cache e dati non validi.
- [x] Collegare riferimenti esterni a registry, adapter e preparazione/aggiornamento.
- [x] Sostituire i test dipendenti dal grande snapshot con una piccola fonte controllata.
- [x] Rimuovere lo snapshot, aggiornare provenienza, pacchetto e documentazione.
- [x] Verificare il percorso reale di download, i test mirati e `npm run verify`.

## Criteri di riuscita

Il pacchetto non incorpora contenuti del catalogo esterno. Due preparazioni nuove possono
ricevere revisioni diverse della fonte. Riprendere un progetto non lo aggiorna. Un `update`
mostra le differenze prima di applicarle. Test e audit non dipendono da Internet.

## Revisione mirata

La revisione indipendente ha individuato due regressioni: una selezione vuota che provava
comunque a scaricare il catalogo, e una fonte aggiornata fra consenso e scrittura che
poteva cambiare l'installazione approvata. Entrambe sono state riprodotte da test falliti
prima della correzione e poi superate. Il consenso nativo conserva ora la revisione
della prima anteprima per tutte le successive verifiche e per l'applicazione.

Verifica finale locale: `npm run verify` con uscita 0, 85 file di test superati,
656 prove superate e una saltata. Test complessivi: 55,29 s. Controlli del catalogo
esterno, provenienza, audit di release e pacchetto superati.
