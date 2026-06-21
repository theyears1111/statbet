# StatBet Terminal — guida per pubblicarlo online

Questa è la tua app di analisi statistica. Segui i passi nell'ordine.
Non serve saper programmare: si tratta solo di copiare, incollare e cliccare.

---

## Cosa ti serve (tutto gratis)
1. Un account **API-Football** (per i dati)
2. Un account **GitHub** (per ospitare il codice)
3. Un account **Vercel** (per mettere il sito online)

---

## PASSO 1 — Prendi la chiave dei dati (5 minuti)

1. Vai su **https://dashboard.api-football.com/register**
2. Registrati con email e password, conferma l'email
3. Entra nella dashboard: nella pagina principale trovi la tua **API Key**
   (una lunga stringa di lettere e numeri)
4. **Copiala e tienila da parte** — ti serve al Passo 4

> Il piano gratuito dà 100 richieste al giorno: perfetto per provare da solo.

---

## PASSO 2 — Metti il codice su GitHub (5 minuti)

1. Vai su **https://github.com** e registrati (se non hai un account)
2. In alto a destra clicca **+** → **New repository**
3. Dai un nome (es. `statbet`), lascia tutto com'è, clicca **Create repository**
4. Nella pagina che appare clicca **"uploading an existing file"**
5. Trascina dentro **TUTTI i file di questa cartella** (compresa la sottocartella `api`)
6. Clicca **Commit changes**

> Importante: la cartella `api` con dentro `data.js` deve restare una cartella,
> non un file singolo. Se trascini la cartella intera, GitHub la ricrea da solo.

---

## PASSO 3 — Pubblica con Vercel (3 minuti)

1. Vai su **https://vercel.com** e accedi **con il tuo account GitHub** (pulsante "Continue with GitHub")
2. Clicca **Add New… → Project**
3. Trova il repository `statbet` nell'elenco e clicca **Import**
4. **NON cliccare ancora Deploy.** Prima fai il Passo 4 qui sotto.

---

## PASSO 4 — Inserisci la chiave segreta (1 minuto)

Sempre nella schermata di Vercel, prima del Deploy:

1. Apri la sezione **Environment Variables**
2. Nel campo **Key (Name)** scrivi esattamente:  `API_FOOTBALL_KEY`
3. Nel campo **Value** incolla la chiave che hai copiato al Passo 1
4. Clicca **Add**
5. Ora clicca **Deploy**

Aspetta un minuto. Quando vedi i coriandoli, clicca **Visit**: l'app è online! 🎉

---

## Come si usa

- La home mostra le partite di oggi (ora soprattutto i **Mondiali**, i campionati sono fermi)
- Clicca una partita per vedere streak, medie, primi tempi, scontri diretti, ritardatari
  e le **scommesse suggerite**
- In alto nella scheda cambi la **finestra** (ultime 10/20/50) e il **filtro**
  (tutte le competizioni / casa-trasferta / solo questa competizione)
- Il pulsante **⟳ Aggiorna dati** ricarica (consuma qualche richiesta, usalo con parsimonia)

---

## Cose da sapere (importante)

- **Corner, tiri e xG** non ci sono nella versione gratuita: richiedono il piano a
  pagamento di API-Football (~19$/mese). Quando lo attivi, fammelo sapere e li aggiungiamo.
- **Per renderlo pubblico** (tanti utenti) serve comunque il piano a pagamento: il gratuito
  finisce le 100 richieste troppo in fretta. Per uso personale va benissimo così.
- Se gli ID dei campionati non tornano, vanno verificati una volta con l'endpoint `/leagues`
  di API-Football (te lo spiego se serve).
- Il punteggio "Vantaggio" e le scommesse suggerite sono uno strumento di supporto,
  non una garanzia. I segnali basati su xG valgono più di quelli basati solo su strisce.

---

## Se qualcosa non funziona
Apri l'app: se vedi un errore rosso, di solito è la chiave (`API_FOOTBALL_KEY`)
non impostata o sbagliata. Ricontrolla il Passo 4 su Vercel
(Settings → Environment Variables) e poi rilancia il deploy (Deployments → … → Redeploy).
