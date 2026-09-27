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
- **Importa documenti** serve solo per le schede Word, PDF o di testo dei singoli clienti; i backup si importano da **⚙ Dati**.
- **Non caricare mai il file di backup su GitHub**: il repository è pubblico.
- Funziona anche senza internet (compresi Word e PDF, dopo la prima apertura con internet).
- In questa versione non ci sono i pulsanti Google Drive / Dropbox / condivisione con il cliente: servono il collegamento con claude.ai o una versione con account (si può aggiungere più avanti).

## Aggiornare l'app

Carica il nuovo `index.html` (e gli altri file cambiati) sopra quelli vecchi, poi in `sw.js` cambia `gestionale-pt-v1` in `gestionale-pt-v2`. Apri l'app con internet: si aggiorna da sola.
