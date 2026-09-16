# Usare la forgia personale

## Il programma e il workspace sono due cose diverse

Forgeyard viene installato una volta sul PC. Nel workspace mantiene soltanto l'ambiente specifico del lavoro; non copia l'intero programma in ogni microservizio. Claude Code e Codex restano i client nei quali lo sviluppatore conversa.

L'ingresso ordinario è `forgeyard`, senza sottocomandi. Il diagnostico separato resta uno strumento avanzato: l'utente non deve eseguirlo prima della preparazione.

## Disponibile in questo incremento

Il comando senza argomenti analizza la cartella corrente, riepiloga repository e progetti e propone la creazione dell'area personale. La conferma è esplicita. Senza terminale interattivo, il comportamento è solo anteprima.

Vengono creati `.forgeyard/workspace.json`, contenente una mappa identificabile del workspace, e `.forgeyard/.gitignore`, che esclude tutta l'area privata, compresa la regola stessa. Non vengono inizializzati repository né modificati i file dei repository figli o le istruzioni native già presenti.

Il messaggio «Area personale creata» significa registrazione riuscita. **Non significa ancora che la suite sia installata e connessa a Claude o Codex.** Lo stato persistito è `not-connected`; il programma lo dichiara anche a schermo. Non collegare i vecchi installer a questa area per aggirare lo stato: la migrazione deve essere esplicita.

Alla seconda esecuzione l'area riconosciuta viene conservata, senza una nuova conferma d'installazione e senza riscrivere mappa o data. La sua impronta rileva alterazioni accidentali, non autentica i file contro un processo ostile con i tuoi privilegi.

## Protezione del software

Una root Git è accettata anche senza commit. Se il workspace è una sottocartella di un repository, rimane selezionata quella cartella: il programma non sale arbitrariamente alla root Git per installarsi.

Prima della creazione vengono controllati eventuali file della forgia già nell'indice. Un file tracciato non diventa privato grazie a una regola ignore, quindi il programma si ferma invece di nascondere il problema. Le esclusioni evitano le aggiunte normali; non possono impedire una forzatura esplicita di Git da parte dell'utente.

Un'area preesistente non riconosciuta, un link simbolico o una configurazione modificata vengono preservati. Se la scansione è parziale, non viene applicata una registrazione basata su una mappa incompleta. Se la topologia cambia dopo l'anteprima, serve rivedere il riepilogo attraverso lo stesso ingresso.

Il recupero dopo un errore rimuove soltanto i file ancora identici a quelli creati dall'operazione. Se trova un'aggiunta concorrente o byte modificati, conserva l'area e segnala la situazione: nessuna cancellazione ricorsiva per forzare la riuscita.

## Passaggi ancora necessari

Occorre collegare l'area ai punti d'ingresso reali dei client, distribuire o riusare le capacità pertinenti, integrare lo stato e le verifiche per i repository membri e collaudare il percorso completo nelle app. Questi passaggi completeranno lo stesso comando, non diventeranno una sequenza obbligatoria da memorizzare.

Il risultato finale è sempre: preparo una volta il workspace, apro la mia conversazione, descrivo il software. Le issue locali sono parte del lavoro; pubblicare issue remote, effettuare push o deploy resta un effetto esterno distinto e autorizzato.
