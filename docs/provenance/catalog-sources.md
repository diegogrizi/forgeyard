# Provenienza e integrità del catalogo

Il catalogo portabile di Forgeyard viene da una sola fonte distribuibile e pinnata.

- Progetto: [`wshobson/agents`](https://github.com/wshobson/agents)
- Revisione: `4236bb91f8395b0435f1d8b8baf9e8e4c69a8620`
- Licenza: MIT
- Ambito vendored: soltanto l'albero `plugins/` upstream
- Inventario: **1.007 file sorgente**, **211.594 righe fisiche**, 6.737.904 byte canonici LF
- Componenti: **202 agenti**, **183 skill**, **105 comandi**
- Impronta dell'albero, sha256: `cf4df3cf9f4412a2ce2024c83c58df09dbf16de2327cf7df841a8081bf044c97`

La licenza upstream è conservata in `packs/ecosystem/vendor/LICENSE`. I metadati della
fonte, leggibili da un programma, stanno in `sources/catalog.yaml`, mentre
`packs/ecosystem/vendor/UPSTREAM.json` lega insieme repository, commit, licenza,
conteggi, lunghezza in byte, impronta della licenza e impronta dell'albero.

I conteggi di questa pagina non sono un obiettivo di crescita: sono un'attestazione. Sono
verificati a ogni release dal comando della sezione seguente, ed è quel comando — non
questa prosa — a stabilire se sono ancora veri.

## Il confine di verifica

```sh
npm run catalog:check
npm run provenance:check
```

Il primo comando legge ricorsivamente l'albero vendored, rifiuta i collegamenti simbolici
e i percorsi non sicuri, normalizza i fine riga del testo per l'impronta canonica e
confronta ogni valore attestato. Un byte cambiato, un file rimosso, un file in più o una
licenza mancante fanno fallire la release.

Il secondo lega quell'attestazione al manifest del pack e al catalogo delle fonti.
`THIRD_PARTY_NOTICES.md` e `SBOM.spdx.json` sono generati, ed elencano lo snapshot del
vendor separatamente dalle dipendenze npm. Il test del pacchetto pubblico conferma che
licenza, attestazione e contenuto del catalogo siano presenti.

La serializzazione dei pacchetti npm dentro lo SBOM usa soltanto il lock normalizzato —
nome, versione, licenza dichiarata, URL e impronte — e comprende anche i pacchetti
opzionali non installati. Una licenza mancante resta `NOASSERTION` invece di essere
recuperata dal disco: altrimenti l'artefatto dipenderebbe dai binding nativi opzionali
della piattaforma su cui è stato generato, e il confronto byte per byte non sarebbe
riproducibile tra Linux e Windows.

## L'eccezione di trasporto npm

npm omette deliberatamente i file `.gitignore` annidati dai tarball dei pacchetti. Un
file upstream, `plugins/ship-mate/.gitignore`, viaggia quindi byte per byte come
`npm-carriers/ship-mate.gitignore`, e la corrispondenza è dichiarata in `UPSTREAM.json`.
L'originale resta nell'albero vendored di Git e i suoi byte restano parte
dell'attestazione sui 1.007 file; il vettore preserva quei byte nell'artefatto npm senza
far finta che npm ne abbia mantenuto il percorso.

## Ciò che è nostro e ciò che non lo è

L'albero vendored è materiale MIT immutabile. Il codice di adattamento di Forgeyard, che
è Apache-2.0, lo legge e lo trasforma **senza eseguire script o hook upstream**. Gli hook
importati dal catalogo sono catalogati e lasciati disattivati, non simulati in silenzio.

L'output generato usa percorsi con namespace, valida i metadati di skill e agenti,
rifiuta le collisioni e registra la proprietà a livello di file per aggiornamento e
rollback. I conteggi qui sopra descrivono materiale su disco: non sono un'affermazione su
quanto venga eseguito contemporaneamente, e non sono la dimensione di un prompt. Come il
catalogo entra in contesto è descritto in [Architettura](../guide/architettura.md).
