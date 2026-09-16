# Correzione dello SBOM dipendente dalla piattaforma

Il confronto byte per byte falliva perché il generatore arricchiva il lock con le homepage dei pacchetti presenti in node_modules. I binding nativi opzionali installati su Linux e Windows sono diversi; anche una licenza recuperata soltanto dal disco avrebbe avuto lo stesso problema.

## Regola adottata

La serializzazione dei pacchetti npm usa soltanto il lock normalizzato: nome, versione, licenza dichiarata, URL e impronte. Una licenza mancante resta NOASSERTION. Non vengono aggiunte homepage dal disco. Il grafo comprende anche pacchetti opzionali non installati. Attribuzioni, licenze e riferimenti del vendor continuano a provenire dal catalogo e dall'attestazione versionati. La validazione delle dipendenze dirette resta attiva.

Il file SBOM.spdx.json è stato rigenerato esplicitamente con il generatore corretto, non normalizzato nei test. I test che lo confrontano byte per byte non sono stati rimossi o indeboliti. La CI di verifica non rigenera i risultati attesi prima del confronto.

## Evidenza della regressione

Nel commit 055cc62e2118c6303b5fb13416c7cfd8c7377957, tre delle quattro nuove prove falliscono con il generatore precedente. Dopo la correzione in 51efa9ed5abda93f16c04a7c7e5cdedaa75a9bd3, quattro prove su quattro passano; passano anche i cinque test di integrazione sulla provenienza con l'artefatto rigenerato.

Il job 104916551917 ha prodotto il blob Git 1df8040edd1c9d611166463a3173c5d3cc7d9b8d dopo tali verifiche. La procedura temporanea ha creato esclusivamente quel blob, senza spostare branch o unire PR; è stata rimossa dopo l'acquisizione dell'artefatto. La CI ordinaria conserva permessi di sola lettura.

Queste prove non certificano i client AI. La verifica completa e quella Windows sono controlli separati della PR. Non inferire il loro risultato dalla sola rigenerazione.
