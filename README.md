# Gestionale Personal Trainer

Clienti, pacchetti, sedute e pagamenti. Funziona nel browser e si installa sulla schermata Home dell'iPhone come un'app, anche senza internet.

## Pubblicarlo su GitHub (una volta sola)

1. Entra su github.com (account gratuito).
2. In alto a destra **+** → **New repository**.
   - Nome: `gestionale-pt`
   - Visibilità: **Public** (con l'account gratuito GitHub Pages funziona solo così: il *codice* è visibile, i *tuoi dati* no, restano sul tuo telefono).
   - Premi **Create repository**.
3. Nella pagina del repository: **uploading an existing file** (oppure **Add file → Upload files**).
4. Seleziona **tutti i file** di questa cartella e trascinali (o sceglili). Premi **Commit changes**.
5. **Settings → Pages**. In "Build and deployment": Source **Deploy from a branch**, Branch **main**, cartella **/ (root)** → **Save**.
6. Dopo 1–2 minuti in alto compare l'indirizzo, tipo `https://TUONOME.github.io/gestionale-pt/`.

## Installarlo sull'iPhone

1. Apri l'indirizzo con **Safari**.
2. Tocca **Condividi** (quadrato con freccia) → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Apri il gestionale **dall'icona sulla Home** (non da Safari).

## Portare dentro i tuoi clienti

1. Apri il gestionale dall'icona sulla Home.
2. Tocca **⚙ Dati** (piccolo, accanto a "I miei clienti") → **Importa dati** → scegli lo ZIP del backup (`Gestionale PT - backup ….zip`) oppure il file `.json`.

> Importa il backup **dall'icona sulla Home**: su iPhone l'app sulla Home e Safari hanno memorie separate.

## Da sapere

- I dati restano **solo su questo dispositivo**. Ogni tanto tocca **⚙ Dati → Esporta dati** (con la spunta "Includi le cartelle dei clienti") e conserva lo ZIP (iCloud Drive, Google Drive, email): serve se cambi telefono o vuoi dare i dati a un'altra persona.
- Togliendo quella spunta esporti **solo i dati del programma** (impostazioni), senza nessun dato dei clienti.
- **Esporta documenti** crea la scheda completa dei clienti che scegli, in **Word** o in **PDF**: sul telefono la condividi (WhatsApp, Mail, File), al computer la salvi in una cartella. Più clienti insieme arrivano in un unico ZIP.
- **Importa documenti** legge quelle schede (Word, PDF, testo, oppure lo ZIP) e le trasforma di nuovo in cartelle normali. I backup completi invece si importano da **⚙ Dati**.
- **Non caricare mai il file di backup su GitHub**: il repository è pubblico.
- Funziona anche senza internet (compresi Word e PDF, dopo la prima apertura con internet).
- In questa versione non ci sono i pulsanti Google Drive / Dropbox / condivisione con il cliente: servono il collegamento con claude.ai o una versione con account (si può aggiungere più avanti).

## Filtri e statistiche

- Sotto la ricerca, il tasto **Filtri** mostra: tutti i clienti, saldo in sospeso, saldo completato, lezioni 1 to 1 da finire.
- **📊 Statistiche andamento**: incassi e sedute mese per mese o anno per anno, mesi migliori e peggiori, recap di ogni cliente (rinnovi, pacchetto tipico, ogni quanto rinnova). Solo da vedere: non si esporta. Con **🙈 Nascondi importi** gli importi spariscono dallo schermo.
- Le statistiche finiscono in un file solo se, in **⚙ Dati → Esporta dati**, lasci la spunta **Includi le statistiche**.

## Spese di gestione

- **💸 Spese di gestione** (facoltative): le spese per lavorare (struttura, affitto sala, assicurazione…), **mensili**, **annuali** o **una tantum**. Per mensili e annuali il promemoria "da pagare" si può spegnere, e con **⏭ Salta** puoi saltare un mese (o un anno), anche in anticipo: in quel periodo niente avviso e niente sottratto. Una spesa entra nelle statistiche solo quando premi **Segna pagata**. Se non inserisci spese, le statistiche restano come sono.
- Ogni volta che ne paghi una premi **Segna pagata**: le statistiche la tolgono dagli incassi nel mese del pagamento e mostrano il **guadagno netto**.
- Le spese sono dati tuoi (non dei clienti): finiscono nel backup di **⚙ Dati**, anche in "solo dati del programma".

## Sincronizzazione con Vercel (iPhone ⇄ computer)

Pubblicato su **Vercel**, il gestionale salva i dati in un piccolo database (Upstash Redis, piano gratuito) e li sincronizza su tutti i dispositivi dove fai l'accesso con la tua password. Su GitHub Pages invece resta "dati in questo browser".

1. **Vercel → Add New → Project** → importa il repository `Gestionale-Pt` → Framework Preset **Other** → **Deploy**.
2. Nel progetto: **Storage → Create Database → Upstash for Redis** → piano **Free** → regione **Frankfurt** → collegalo al progetto. Le chiavi del database le inserisce Vercel da solo.
3. **Settings → Environment Variables** → aggiungi `APP_PASSWORD` con la password che vuoi usare (almeno 10 caratteri) → **Save**.
4. **Deployments** → menu **⋯** dell'ultimo → **Redeploy**.
5. Apri l'indirizzo `https://….vercel.app`, scrivi la password e porta dentro i dati con **⚙ Dati → Importa dati**.
6. Sull'iPhone apri lo stesso indirizzo con Safari → **Aggiungi alla schermata Home** → password (una volta sola).

- Le modifiche arrivano sugli altri dispositivi entro 15 secondi, e subito quando riapri l'app.
- Senza internet si lavora lo stesso: una fascia arancione avvisa che le modifiche sono in coda e partono da sole.
- **⚙ Dati → Esci da questo dispositivo** scollega un dispositivo. Cambiando `APP_PASSWORD` su Vercel (e facendo Redeploy) tutti i dispositivi devono rientrare.
- Il database gratuito viene archiviato dopo 30 giorni senza utilizzo: se lo usi regolarmente non succede.
- La cartella `api/` contiene le funzioni per Vercel: nessuna password o chiave è scritta nei file.

## Aggiornare l'app

Carica il nuovo `index.html` (e gli altri file cambiati) sopra quelli vecchi, poi in `sw.js` cambia `gestionale-pt-v1` in `gestionale-pt-v2`. Apri l'app con internet: si aggiorna da sola.
