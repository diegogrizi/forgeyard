# P2a — Ingresso unico e area personale del workspace

**Obiettivo:** introdurre il comando senza argomenti e la registrazione privata della cartella selezionata, senza fingere che i collegamenti nativi o il runtime multi-repository siano già disponibili.

**Architettura:** riusare discoverWorkspace e le scritture atomiche già presenti. Nessun secondo motore di esecuzione. Il programma registra una mappa locale sotto .forgeyard; preparazione delle capacità, binding e verifiche del prodotto rimangono gli incrementi P3-P6 del PIANO.md.

**Stack:** TypeScript e Node già fissati dal repository; nessuna nuova dipendenza.

**Specifica:** [PIANO.md](PIANO.md), in particolare ingresso unico, proprietà dei file e separazione workspace/repository.

## Vincoli

Un solo ingresso ordinario: `forgeyard`. Nessun nuovo comando da ricordare per il setup. In assenza di terminale interattivo, solo anteprima e nessuna scrittura. Rifiuto di una scansione incompleta per la registrazione. Conferma esplicita prima di scrivere. Nessuna inizializzazione Git, modifica del .gitignore condiviso, lettura di credenziali o avvio di modelli. Un'area legacy o non riconosciuta viene preservata, non migrata alla cieca.

Per i file dentro .forgeyard, un .gitignore interno con esclusione completa rende privata anche la propria regola: non compare nei normali git add/status. Questo elimina scritture esterne alla cartella per P2a e funziona anche se Git viene inizializzato successivamente. Prima si controlla che non esistano file già indicizzati sotto quel percorso: ignore non rende privati i file tracciati. Eventuali punti di ingresso nativi fuori dalla directory richiederanno in P3 esclusioni locali o configurazioni personali supportate; non modificare istruzioni già tracciate.

## Contratti

- `inspectPersonalWorkspace(root: string): Promise<PersonalPreview>` esegue ricognizione, verifica l'eventuale area esistente e controlla l'indice Git in sola lettura.
- `createPersonalWorkspace(preview: PersonalPreview): Promise<PersonalRegistration>` verifica nuovamente topologia e proprietà, crea solo i file propri e conserva le modifiche concorrenti. Non prende decisioni di consenso.
- `runPersonalEntry(root: string, options: PersonalEntryOptions): Promise<number>` presenta il riepilogo italiano e richiede una sola conferma attraverso il driver esistente; in modalità non interattiva non scrive.
- `PersonalRegistration` ha un marcatore di formato, versione, payload e impronta; contiene mappa locale, data e stato `not-connected`. Non è una capsula di capacità o una certificazione di funzionamento del client.

## Sequenza verificabile

- [ ] Scrivere e osservare il fallimento del test del binario senza argomenti: il vecchio aiuto non è il nuovo ingresso personale.
- [ ] Implementare `src/workspace/personal.ts`: anteprima, rifiuto di file tracciati, creazione privata, integrità e ripetizione senza aggiornamenti.
- [ ] Implementare `src/workspace/entry.ts` e collegarlo in `src/cli/main.ts` solo quando non ci sono argomenti. Riutilizzare il PromptDriver; non clonare il wizard legacy.
- [ ] Verificare cartella vuota, contenitore con repository figli, root Git, sottocartella Git, Git inizializzato dopo la registrazione, rifiuto/cancellazione, area esistente, drift, link e topologia cambiata tra anteprima e scrittura.
- [ ] Eseguire test mirati, verifica completa e controlli Windows; aggiornare lo stato della PR senza merge automatico.

Test osservabile del confine Git:

```ts
await createPersonalWorkspace(await inspectPersonalWorkspace(root));
await git(root, "add", "--all");
expect(await git(root, "ls-files", "--", ".forgeyard")).toBe("");
```

La prova è eseguita soltanto su repository temporanei dei test. Il programma di produzione non fa git add né commit.

## Superficie utente di questo incremento

Il messaggio di successo dice «Area personale creata» e specifica «Collegamento agentico non ancora configurato in questa versione». Non dice «forgia pronta» o «agenti attivi». La ripetizione non modifica la mappa congelata; indica lo stato esistente. Le integrazioni successive completeranno lo stesso ingresso, senza chiedere una sequenza di comandi aggiuntiva.
