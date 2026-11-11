/* Pagina del cliente (v101). File NUOVO: non cambia data.js, login.js, recover.js, kvlib.js, firme.js.
   Il cliente apre un link (cliente.html?t=CODICE) e vede SOLO la situazione del suo pacchetto, sempre aggiornata.
   Ogni dispositivo deve essere approvato dal trainer (massimo 1 per cliente), poi il cliente sceglie un PIN di 4 cifre.
   v104: il link nuovo vale 1 ORA. Quando il cliente invia la richiesta (entro l'ora; se l'ha aperto entro l'ora ha tempo fino a 24 ore)
   il link si lega a quel dispositivo e non scade più. Un altro dispositivo vede “link già usato” (avviso al trainer, max 1 all'ora).
   30 giorni senza aprire la pagina → il link si spegne (serve un link nuovo). Richiesta rifiutata → link spento.
   Chiavi nel database:
     gpt:view            hash: <cliente> -> scheda della pagina (link, dispositivo, richiesta, avvisi, consensi…)
     gpt:viewtok:<cod>   -> <cliente>
     gpt:viewsnap:<cl>   -> situazione del pacchetto (la prepara il gestionale a ogni modifica)
     gpt:viewsess:<k>    -> accesso aperto dopo il PIN (12 ore)
     gpt:viewfail:<ip>   -> tentativi sbagliati (blocco per 15 minuti dopo 30)
   Senza password (il cliente, dal link):
     GET  ?t=COD&d=DISP[&k=ACCESSO]  -> {state: new|waiting|setpin|pin|ok|removed|expired|blocked}  (410 = link spento)
     POST {t, d, op:"ask", name, kind, consent}   chiede l'accesso (con la spunta dell'informativa)
     POST {t, d, op:"setpin", pin} · {op:"pin", pin}   -> {state:"ok", k, data, sigs, privacy}   (privacy: documento privacy da firmare)
     POST {t, d, k, op:"privacy", s, lang}       -> v105: firma del documento privacy mandato dal trainer
     POST {t, d, k, op:"sign", id, s}   firma una seduta non firmata · {op:"logout"} scollega il dispositivo · {op:"bye"} chiude l'accesso
     POST {t, d, k, op:"delreq"}      chiede di cancellare i dati della pagina (decide il trainer)
     POST {t, d, k, op:"xfer"} -> {x}  codice (30 minuti, una volta sola) per passare l'approvazione all'icona sulla schermata Home
     POST {t, d, op:"claim", x}        l'icona (su iPhone è un “dispositivo” nuovo) diventa la sua app (Safari continua a funzionare); poi serve il PIN
     v105 (11/11): GET …&a=1 dall'icona sulla schermata Home → {state:"apppin"} se il link è già del suo telefono:
     POST {t, d, op:"app", pin}        con il PIN del cliente l'icona diventa la sua app (una sola alla volta; Safari resta) e il trainer riceve l'avviso
     POST {t, d, op:"move", pin}       “link già usato” ma è il suo telefono: con il PIN la pagina si sposta su questo browser (avviso + notifica)
     Cookie pt_dev (HttpOnly): il server ricorda il telefono anche se Safari cancella la memoria del sito (risposta con {dev} da salvare)
   Con la password del gestionale:
     GET  ?list=1  -> {views:{cliente:{…}}}
     POST {op:"link", client, trainer, first[, fresh]}   -> {token}  (lo stesso finché è valido; nuovo se spento, non usato entro 1 ora, o fresh senza dispositivo)
     POST {op:"snap", client, snap} · approve · reject · remove · block · pinreset · unblock · ack(ids) · keep · blockall */
const crypto = require("crypto");
const {kv, missing, authorized, readJson, send: sendRaw, ipOf, P} = require("./kvlib");
/* v105 (11/11): il telefono del cliente lo ricorda anche il server, con un cookie che Safari non cancella dopo 7 giorni
   (Safari cancella la memoria del sito se il cliente non apre la pagina per 7 giorni: senza cookie vedrebbe “link già usato”) */
const DEV_COOKIE = "pt_dev";
const cookieDev = req => { const m = /(?:^|;\s*)pt_dev=([A-Za-z0-9_-]{16,64})(?:;|$)/.exec(String(req.headers.cookie || "")); return m ? m[1] : ""; };
const send = (res, code, obj) => {
  if(res.__ptCookie) res.setHeader("Set-Cookie", `${DEV_COOKIE}=${res.__ptCookie}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`);
  if(res.__ptDev && obj && typeof obj === "object") obj = Object.assign({dev: res.__ptDev}, obj);   // la pagina riprende il suo codice del telefono
  return sendRaw(res, code, obj);
};

const ID = v => typeof v === "string" && v.length > 0 && v.length <= 120 && !/[\s:]/.test(v);
const TOK = v => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const DEV = v => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
const DATE = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const PIN = v => typeof v === "string" && /^\d{4}$/.test(v);
const STROKES = v => typeof v === "string" && v.length >= 8 && v.length <= 24000 && /^[0-9a-z.]+$/.test(v);
const hash = v => crypto.createHash("sha256").update(String(v)).digest("base64url").slice(0, 32);
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const KINDS = ["iPhone", "iPad", "Android", "computer", "altro"];
const DAY = 86400000, IDLE_DAYS = 30, RENEW_DAYS = 7, SESS = 43200, MAX_FAILS = 5, HOUR = 3600000;
const romeDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("sv-SE", {timeZone: "Europe/Rome"});
const romeHM = (ms = Date.now()) => new Date(ms).toLocaleTimeString("it-IT", {timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false});
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pinHash = (dev, pin) => hash("pin:" + dev.salt + ":" + pin);

/* v105 (11/11): notifiche sul telefono del trainer (api/_pushlib.js): richieste di accesso e avvisi di sicurezza */
const PUSH_NOTE = {
  ask: (n, x)=>({it: {title: "📱 Richiesta di accesso", body: `${n} chiede di vedere la sua pagina da “${x}”. Apri il gestionale per approvare.`},
                 en: {title: "📱 Access request", body: `${n} is asking to see their page from “${x}”. Open the app to approve.`}}),
  other: n=>({it: {title: "⚠️ Link già usato", body: `Un altro telefono ha provato ad aprire il link di ${n}.`},
              en: {title: "⚠️ Link already used", body: `Another phone tried to open ${n}'s link.`}}),
  pinlock: n=>({it: {title: "🔒 PIN bloccato", body: `${n}: 5 PIN sbagliati, la pagina è bloccata. Puoi sbloccarla dal gestionale.`},
                en: {title: "🔒 PIN locked", body: `${n}: 5 wrong PINs, the page is locked. You can unlock it from the app.`}}),
  delreq: n=>({it: {title: "🗑 Richiesta di cancellazione", body: `${n} chiede di cancellare i dati della sua pagina.`},
               en: {title: "🗑 Deletion request", body: `${n} is asking to delete their page's data.`}}),
  try: n=>({it: {title: "⚠️ Tentativo di accesso", body: `Qualcuno ha provato ad aprire la pagina di ${n} con un link non più valido o da un dispositivo tolto.`},
            en: {title: "⚠️ Access attempt", body: `Someone tried to open ${n}'s page with a link that's no longer valid or from a removed device.`}})
};
async function notify(rec, k, x){
  try{
    if(k === "moved") PUSH_NOTE.moved = n=>({it: {title: "🔁 Pagina spostata", body: `${n} è rientrato con il suo PIN da un altro browser: quello di prima non funziona più.`},
                                             en: {title: "🔁 Page moved", body: `${n} signed back in with their PIN from another browser: the previous one no longer works.`}});
    const f = PUSH_NOTE[k]; if(!f) return;
    await require("./_pushlib").sendAll(Object.assign(f(rec.name || rec.first || "Un cliente", clean(x, 40)), {tag: k + "-" + Date.now(), url: "./#visuale"}));
  }catch(_){}                                                     // le notifiche non devono mai bloccare la pagina del cliente
}
async function getRec(client){ const [raw] = await kv([["HGET", P + "view", client]]); try{ return raw ? JSON.parse(raw) : null; }catch(_){ return null; } }
const putRec = (client, rec) => kv([["HSET", P + "view", client, JSON.stringify(rec)]]);
function alert(rec, k, extra){
  rec.alerts = (Array.isArray(rec.alerts) ? rec.alerts : []).slice(-29);
  rec.alerts.push(Object.assign({id: crypto.randomBytes(6).toString("base64url"), k, at: Date.now()}, extra || {}));
}
/* v104: a quale dispositivo è legato il link (anche per i link creati prima della v104) */
const boundH = rec => rec.bh || (rec.device && rec.device.h) || (rec.pending && rec.pending.h) || "";
const linkOld = rec => !boundH(rec) && Date.now() - (Number(rec.created) || 0) > HOUR;          // non usato entro 1 ora
const openedInTime = (rec, hd) => (rec.opened || []).includes(hd) && Date.now() - (Number(rec.created) || 0) <= DAY;
const idleDev = rec => !!(rec.device && Date.now() - (rec.device.seen || rec.device.appr || Date.now()) > IDLE_DAYS * DAY);
/* 30 giorni senza aprire la pagina: il link si spegne (comandi da mandare al database) */
function lockIdle(rec){ rec.device = null; rec.pending = null; rec.app = null; rec.locked = true; rec.lockWhy = "idle"; alert(rec, "idle"); const sd = sessDel(rec); rec.sess = []; return sd; }
/* quello che vede il gestionale (mai PIN, impronte o codici dei dispositivi) */
const devPub = d => d ? {name: d.name, kind: d.kind, at: d.at, seen: d.seen || 0, blocked: !!d.blocked, pin: !!d.pin} : null;
const sessDel = rec => (Array.isArray(rec && rec.sess) ? rec.sess : []).filter(TOK).map(k=>["DEL", P + "viewsess:" + k])
  .concat((Array.isArray(rec && rec.xf) ? rec.xf : []).filter(TOK).map(k=>["DEL", P + "viewxfer:" + k]));   // (anche i codici per l'icona)
const pub = rec => rec ? {on: !!rec.token && !rec.locked, locked: !!rec.locked, device: devPub(rec.device), app: rec.device && rec.app ? {at: rec.app.at} : null,
  pending: rec.pending ? {name: rec.pending.name, kind: rec.pending.kind, at: rec.pending.at} : null,
  alerts: rec.alerts || [], consents: rec.consents || [], delreq: rec.delreq || 0, seenAt: rec.seenAt || 0, updAt: rec.updAt || 0,
  ended: rec.ended || "", created: rec.created || 0,
  bound: !!boundH(rec), linkOld: !rec.locked && linkOld(rec), expAt: boundH(rec) ? 0 : (Number(rec.created) || 0) + HOUR, lockWhy: rec.locked ? rec.lockWhy || "removed" : ""} : null;
/* il pacchetto è chiuso da più di 7 giorni e non è stato rinnovato */
const expired = rec => DATE(rec.ended) && romeDay() > addDays(rec.ended, RENEW_DAYS);
async function tooMany(req){ const [n] = await kv([["GET", P + "viewfail:" + ipOf(req)]]); return Number(n) >= 30; }
async function fail(req, res, code, error){ const k = P + "viewfail:" + ipOf(req); try{ await kv([["INCR", k], ["EXPIRE", k, 900]]); }catch(_){} return send(res, code, {error}); }
async function payload(client, rec){
  const [snapRaw, flat, privRaw] = await kv([["GET", P + "viewsnap:" + client], ["HGETALL", P + "sig:" + client], ["HGET", P + "privacy", client]]);
  let data = null; try{ data = snapRaw ? JSON.parse(snapRaw) : null; }catch(_){}
  const ids = new Set(((data && data.rows) || []).map(r=>r.id)), sigs = {};
  if(!data || !data.sec || data.sec.firme !== false){
    for(let i = 0; flat && i < flat.length; i += 2){ if(!ids.has(flat[i])) continue; try{ const s = JSON.parse(flat[i+1]); if(s && s.s) sigs[flat[i]] = {s: s.s, via: s.via, time: s.time}; }catch(_){} }
  }
  let pv = null; try{ pv = privRaw ? JSON.parse(privRaw) : null; }catch(_){}
  return {data, sigs, device: rec.device ? rec.device.name : "", privacy: !!(pv && pv.st === "sent")};   // v105 (privacy): il trainer gli ha mandato il documento da firmare
}
async function openSession(client, rec, hd){
  const k = crypto.randomBytes(24).toString("base64url");
  rec.seenAt = Date.now(); rec.device.seen = rec.seenAt;
  rec.sess = (Array.isArray(rec.sess) ? rec.sess : []).slice(-4).concat(k);     // per chiudere gli accessi aperti quando spegni il link
  await kv([["SET", P + "viewsess:" + k, JSON.stringify({c: client, h: hd}), "EX", SESS], ["HSET", P + "view", client, JSON.stringify(rec)]]);
  return k;
}
async function session(k, client, hd){
  if(!TOK(k)) return false;
  const [raw] = await kv([["GET", P + "viewsess:" + k]]);
  let s = null; try{ s = raw ? JSON.parse(raw) : null; }catch(_){}
  return !!(s && s.c === client && s.h === hd);
}

module.exports = async (req, res) => {
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  const q = new URL(req.url, "http://x").searchParams;
  let body = {};
  if(req.method === "POST"){ try{ body = await readJson(req) || {}; }catch(_){ return send(res, 400, {error:"json"}); } }
  try{
    /* ---------- il cliente, dal link (senza password) ---------- */
    const t = req.method === "GET" ? q.get("t") : body.t;
    if(t !== null && t !== undefined){
      if(await tooMany(req)) return send(res, 429, {error:"too_many"});
      if(!TOK(t)) return fail(req, res, 404, "link");
      const [client] = await kv([["GET", P + "viewtok:" + t]]);
      if(!client) return fail(req, res, 410, "off");
      const rec = await getRec(client);
      if(!rec || rec.token !== t) return fail(req, res, 410, "off");
      let d = req.method === "GET" ? q.get("d") : body.d;
      if(!DEV(d)) return send(res, 400, {error:"device"});
      { const ck = cookieDev(req), isMine = h => !!(rec.device && (rec.device.h === h || (rec.app && rec.app.h === h))) || !!(rec.pending && rec.pending.h === h) || (!rec.device && rec.bh === h);
        if(ck && ck !== d && !isMine(hash(d)) && isMine(hash(ck))){ d = ck; res.__ptDev = ck; }   // memoria di Safari cancellata: è lo stesso telefono
        res.__ptCookie = d; }
      const hd = hash(d), who = {trainer: rec.trainer || "", first: rec.first || ""};
      const mine = !!(rec.device && (rec.device.h === hd || (rec.app && rec.app.h === hd)));   // v105: anche la sua app sulla schermata Home
      const isApp = req.method === "GET" ? q.get("a") === "1" : body.a === true;                  // aperta dall'icona sulla schermata Home
      /* 30 giorni senza aprire la pagina: il link si spegne, serve un link nuovo (v104) */
      if(idleDev(rec)){ const sd = lockIdle(rec); await kv([...sd, ["HSET", P + "view", client, JSON.stringify(rec)]]); return send(res, 200, Object.assign({state:"idle"}, who)); }
      /* dispositivo tolto, richiesta rifiutata o 30 giorni: nessuno può più chiedere l'accesso con questo link */
      if(rec.locked){
        if(!rec.lastTry || Date.now() - rec.lastTry > 3600000){ rec.lastTry = Date.now(); alert(rec, "try", {name: ""}); await putRec(client, rec); await notify(rec, "try"); }
        return send(res, 200, Object.assign({state: rec.lockWhy === "idle" ? "idle" : "removed"}, who));
      }
      if(expired(rec)) return send(res, 200, Object.assign({state:"expired", ended: rec.ended}, who));
      const op = req.method === "POST" ? body.op : "get";
      /* icona sulla schermata Home: prende l'approvazione del dispositivo che ha creato il codice (stesso telefono) */
      if(op === "claim"){
        if(!TOK(body.x)) return send(res, 400, {error:"x"});
        const [raw] = await kv([["GET", P + "viewxfer:" + body.x]]);
        let xr = null; try{ xr = raw ? JSON.parse(raw) : null; }catch(_){}
        if(!xr || xr.c !== client || !rec.device || rec.device.h !== xr.h || rec.device.blocked) return send(res, 200, Object.assign({state: mine ? "pin" : boundH(rec) && boundH(rec) !== hd ? "used" : "new", claimed: false}, who));
        rec.app = {h: hd, at: Date.now()}; rec.device.seen = Date.now(); alert(rec, "app", {name: rec.device.name});   // v105: l'icona diventa la sua app, Safari continua a funzionare
        await kv([["DEL", P + "viewxfer:" + body.x], ["HSET", P + "view", client, JSON.stringify(rec)]]);
        return send(res, 200, Object.assign({state: rec.device.pin ? "pin" : "setpin", claimed: true}, who));
      }
      /* v105 (11/11): l'icona sulla schermata Home (su iPhone ha una memoria sua) usa il link una seconda volta, solo con il PIN del cliente */
      if(op === "app" && !mine){
        if(!rec.device || !rec.device.pin) return send(res, 200, Object.assign({state:"used"}, who));
        if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
        if(!PIN(body.pin) || pinHash(rec.device, body.pin) !== rec.device.pin){
          rec.device.fails = (Number(rec.device.fails) || 0) + 1;
          if(rec.device.fails >= MAX_FAILS){ rec.device.blocked = true; alert(rec, "pinlock", {name: rec.device.name}); }
          await putRec(client, rec);
          if(rec.device.blocked) await notify(rec, "pinlock");
          return send(res, 200, Object.assign({state: rec.device.blocked ? "blocked" : "apppin", wrong: true, left: Math.max(0, MAX_FAILS - rec.device.fails)}, who));
        }
        rec.device.fails = 0; rec.app = {h: hd, at: Date.now()}; alert(rec, "app", {name: rec.device.name});   // una sola app: quella vecchia non vale più
        const k = await openSession(client, rec, hd);
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      /* v105 (11/11): “link già usato” ma è il suo telefono (memoria cancellata, finestra privata, altro browser): con il suo PIN la pagina si sposta qui */
      if(op === "move" && !mine){
        if(!rec.device || !rec.device.pin) return send(res, 200, Object.assign({state:"used"}, who));
        if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
        if(!PIN(body.pin) || pinHash(rec.device, body.pin) !== rec.device.pin){
          rec.device.fails = (Number(rec.device.fails) || 0) + 1;
          if(rec.device.fails >= MAX_FAILS){ rec.device.blocked = true; alert(rec, "pinlock", {name: rec.device.name}); }
          await putRec(client, rec);
          if(rec.device.blocked) await notify(rec, "pinlock");
          return send(res, 200, Object.assign({state: rec.device.blocked ? "blocked" : "movepin", wrong: true, left: Math.max(0, MAX_FAILS - rec.device.fails)}, who));
        }
        const old = rec.device.h; rec.device.fails = 0; rec.device.h = hd; rec.bh = hd; rec.moved = "";
        rec.rejected = (rec.rejected || []).filter(x=>x !== hd);
        alert(rec, "moved", {name: rec.device.name});
        const sd = sessDel(rec).filter(c=>c[1].includes("viewsess:")); rec.sess = [];      // il browser di prima esce
        await kv(sd.length ? sd : [["GET", P + "x"]]);
        const k = await openSession(client, rec, hd);
        await notify(rec, "moved");
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      /* v104: link legato a un altro dispositivo → “link già usato” (avviso al trainer al massimo una volta all'ora) */
      const bh = boundH(rec);
      if(bh && bh !== hd && !mine && rec.moved === hd) return send(res, 200, Object.assign({state:"moved"}, who));   // stesso telefono: ora si apre dall'icona
      if(bh && bh !== hd && !mine){
        if(isApp && rec.device && rec.device.pin && !rec.device.blocked) return send(res, 200, Object.assign({state:"apppin"}, who));   // v105: è la sua icona? chiede il PIN
        if(!rec.lastOther || Date.now() - rec.lastOther > HOUR){ rec.lastOther = Date.now(); alert(rec, "other"); await putRec(client, rec); await notify(rec, "other"); }
        return send(res, 200, Object.assign({state:"used", canPin: !!(rec.device && rec.device.pin && !rec.device.blocked)}, who));
      }
      /* v104: link non usato entro 1 ora (chi l'ha aperto in tempo può ancora inviare la richiesta, fino a 24 ore) */
      if(!bh && linkOld(rec) && !openedInTime(rec, hd)) return send(res, 200, Object.assign({state:"linkold"}, who));
      if(!bh && req.method === "GET" && !(rec.opened || []).includes(hd)){ rec.opened = (rec.opened || []).slice(-4).concat(hd); await putRec(client, rec); }
      if(req.method === "GET"){
        if(mine){
          if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
          if(!rec.device.pin) return send(res, 200, Object.assign({state:"setpin"}, who));
          const k = q.get("k");
          if(k && await session(k, client, hd)){
            if(!rec.seenAt || Date.now() - rec.seenAt > 60000 || rec.seenAt < (rec.updAt || 0)){ rec.seenAt = Date.now(); rec.device.seen = rec.seenAt; await putRec(client, rec); }
            return send(res, 200, Object.assign({state:"ok"}, who, await payload(client, rec)));
          }
          return send(res, 200, Object.assign({state:"pin"}, who));
        }
        if(rec.pending && rec.pending.h === hd) return send(res, 200, Object.assign({state:"waiting", name: rec.pending.name}, who));
        return send(res, 200, Object.assign({state:"new"}, who));
      }
      if(req.method !== "POST") return send(res, 405, {error:"method"});
      if(op === "ask"){
        if(mine) return send(res, 200, {state: rec.device.pin ? "pin" : "setpin"});
        if(body.consent !== true) return send(res, 400, {error:"consent"});
        const name = clean(body.name, 40);
        if(name.length < 2) return send(res, 400, {error:"name"});
        const kind = KINDS.includes(body.kind) ? body.kind : "altro", at = Date.now();
        if((rec.rejected || []).includes(hd)) alert(rec, "try", {name});     // dispositivo già rifiutato o tolto che riprova
        rec.pending = {h: hd, name, kind, at};
        if(!rec.bh){ rec.bh = hd; rec.bound = at; rec.opened = []; }        // v104: da qui il link è di questo dispositivo, senza scadenza
        rec.consents = (rec.consents || []).slice(-19); rec.consents.push({at, name, kind});
        await putRec(client, rec);
        await notify(rec, "ask", name);
        return send(res, 200, Object.assign({state:"waiting", name}, who));
      }
      if(!mine) return send(res, 403, {error:"device"});
      if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
      if(op === "setpin"){
        if(rec.device.pin) return send(res, 409, {error:"pin_set"});
        if(!PIN(body.pin)) return send(res, 400, {error:"pin"});
        rec.device.salt = crypto.randomBytes(9).toString("base64url"); rec.device.pin = pinHash(rec.device, body.pin); rec.device.fails = 0;
        const k = await openSession(client, rec, hd);
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      if(op === "pin"){
        if(!rec.device.pin) return send(res, 200, Object.assign({state:"setpin"}, who));
        if(!PIN(body.pin) || pinHash(rec.device, body.pin) !== rec.device.pin){
          rec.device.fails = (Number(rec.device.fails) || 0) + 1;
          if(rec.device.fails >= MAX_FAILS){ rec.device.blocked = true; alert(rec, "pinlock", {name: rec.device.name}); }
          await putRec(client, rec);
          if(rec.device.blocked) await notify(rec, "pinlock");
          return send(res, 200, Object.assign({state: rec.device.blocked ? "blocked" : "pin", wrong: true, left: Math.max(0, MAX_FAILS - rec.device.fails)}, who));
        }
        rec.device.fails = 0;
        const k = await openSession(client, rec, hd);
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      if(!(await session(body.k, client, hd))) return send(res, 200, Object.assign({state:"pin"}, who));
      if(op === "sign"){
        if(!ID(body.id) || !STROKES(body.s)) return send(res, 400, {error:"sig"});
        const [snapRaw, old] = await kv([["GET", P + "viewsnap:" + client], ["HGET", P + "sig:" + client, body.id]]);
        let data = null; try{ data = snapRaw ? JSON.parse(snapRaw) : null; }catch(_){}
        if(data && data.sec && data.sec.firme === false) return send(res, 403, {error:"hidden"});
        const row = ((data && data.rows) || []).find(r=>r.id === body.id);
        if(!row || !DATE(row.date)) return send(res, 404, {error:"row"});
        let prev = null; try{ prev = old ? JSON.parse(old) : null; }catch(_){}
        if(prev && prev.s) return send(res, 409, {error:"signed"});        // quelle già firmate non si cambiano
        const now = Date.now();
        const sig = {id: body.id, date: row.date, time: romeHM(now), via: "client", pkgStart: data.pkg && DATE(data.pkg.start) ? data.pkg.start : "",
          single: false, miss: !!row.miss, t: now, s: body.s};
        alert(rec, "sign", {date: row.date, miss: !!row.miss, sid: body.id});
        await kv([["HSET", P + "sig:" + client, sig.id, JSON.stringify(sig)], ["HSET", P + "view", client, JSON.stringify(rec)]]);
        return send(res, 200, {ok: true});
      }
      if(op === "xfer"){
        const x = crypto.randomBytes(18).toString("base64url");
        rec.xf = (Array.isArray(rec.xf) ? rec.xf : []).slice(-2).concat(x);
        await kv([["SET", P + "viewxfer:" + x, JSON.stringify({c: client, h: hd}), "EX", 1800], ["HSET", P + "view", client, JSON.stringify(rec)]]);
        return send(res, 200, {x});
      }
      if(op === "bye"){ await kv([["DEL", P + "viewsess:" + body.k]]); return send(res, 200, {ok: true}); }
      if(op === "logout"){                                       // il cliente scollega il suo dispositivo
        if(rec.app && rec.app.h === hd && rec.device.h !== hd) rec.app = null; else { rec.device = null; rec.app = null; }   // v105: dall'app scollega solo l'app
        alert(rec, "logout");
        await kv([["DEL", P + "viewsess:" + body.k], ["HSET", P + "view", client, JSON.stringify(rec)]]);
        return send(res, 200, {ok: true});
      }
      /* v105 (privacy): firma del documento privacy mandato dal trainer (api/privacy.js tiene i documenti) */
      if(op === "privacy"){
        if(!STROKES(body.s)) return send(res, 400, {error:"strokes"});
        const [pr] = await kv([["HGET", P + "privacy", client]]);
        let pv = null; try{ pv = pr ? JSON.parse(pr) : null; }catch(_){}
        if(!pv || pv.st !== "sent") return send(res, 409, {error:"not_sent"});
        const doc = {st: "signed", sent: Number(pv.sent) || 0, at: Date.now(), via: "visuale", lang: body.lang === "en" ? "en" : "it", v: 1, s: body.s};
        await kv([["HSET", P + "privacy", client, JSON.stringify(doc)]]);
        return send(res, 200, {ok: true});
      }
      if(op === "delreq"){
        rec.delreq = Date.now(); alert(rec, "delreq");
        await putRec(client, rec);
        await notify(rec, "delreq");
        return send(res, 200, {ok: true});
      }
      return send(res, 400, {error:"op"});
    }
    /* ---------- il trainer (con la password) ---------- */
    if(!(await authorized(req))) return send(res, 401, {error:"login"});
    if(req.method === "GET"){
      if(q.get("list") === null) return send(res, 400, {error:"what"});
      const [flat] = await kv([["HGETALL", P + "view"]]);
      const views = {}, cmds = [];
      for(let i = 0; flat && i < flat.length; i += 2){ try{ const r = JSON.parse(flat[i+1]);
        if(r && !r.locked && idleDev(r)){ cmds.push(...lockIdle(r), ["HSET", P + "view", flat[i], JSON.stringify(r)]); }   // v104: 30 giorni → link spento
        views[flat[i]] = pub(r); }catch(_){} }
      if(cmds.length) await kv(cmds);
      return send(res, 200, {views, now: Date.now()});
    }
    if(req.method !== "POST") return send(res, 405, {error:"method"});
    if(body.op === "blockall"){                                  // tasto d'emergenza: spegne tutti i link
      const [flat] = await kv([["HGETALL", P + "view"]]);
      const cmds = [["DEL", P + "view"]];
      for(let i = 0; flat && i < flat.length; i += 2){
        cmds.push(["DEL", P + "viewsnap:" + flat[i]]);
        try{ const r = JSON.parse(flat[i+1]); if(r && TOK(r.token)) cmds.push(["DEL", P + "viewtok:" + r.token]); cmds.push(...sessDel(r)); }catch(_){}
      }
      await kv(cmds);
      return send(res, 200, {ok: true, n: cmds.length - 1});
    }
    const client = body.client;
    if(!ID(client)) return send(res, 400, {error:"client"});
    let rec = await getRec(client);
    const op = body.op;
    if(op === "link"){
      /* link nuovo se non c'era, se il link era spento, se non è stato usato entro 1 ora o se chiedi “Link nuovo” (solo se non è ancora legato a un dispositivo) */
      if(!rec || !rec.token || rec.locked || linkOld(rec) || (body.fresh === true && !boundH(rec))){
        const cmds = [];
        if(rec && TOK(rec.token)) cmds.push(["DEL", P + "viewtok:" + rec.token]);
        rec = Object.assign(rec || {}, {token: crypto.randomBytes(24).toString("base64url"), device: null, app: null, pending: null, locked: false, created: Date.now(), bh: "", bound: 0, opened: [], lockWhy: "", lastOther: 0, moved: ""});
        cmds.push(["SET", P + "viewtok:" + rec.token, client]);
        await kv(cmds);
      }
      rec.trainer = clean(body.trainer, 60); rec.first = clean(body.first, 40); rec.t = Date.now();
      if(body.name) rec.name = clean(body.name, 60);                     // v105: nome completo (per le notifiche al trainer)
      await putRec(client, rec);
      return send(res, 200, {token: rec.token, view: pub(rec)});
    }
    if(op === "snap"){
      const txt = JSON.stringify(body.snap || null);
      if(txt.length > 200000) return send(res, 413, {error:"snap"});
      if(!rec || !rec.token) return send(res, 200, {ok: true, skipped: true});    // nessun link: niente da aggiornare
      const sh = hash(txt), ended = body.snap && DATE(body.snap.ended) ? body.snap.ended : "";
      const cmds = [["SET", P + "viewsnap:" + client, txt]];
      if(rec.sh !== sh || rec.ended !== ended){ rec.sh = sh; rec.updAt = Date.now(); rec.ended = ended; cmds.push(["HSET", P + "view", client, JSON.stringify(rec)]); }
      await kv(cmds);
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(!rec) return send(res, 200, {ok: true, view: null});
    const rej = h => { if(h){ rec.rejected = (rec.rejected || []).filter(x=>x !== h).slice(-9); rec.rejected.push(h); } };
    if(op === "approve"){
      if(rec.pending){
        if(rec.device) rej(rec.device.h);                      // massimo 1 dispositivo: il vecchio viene sostituito
        rec.device = Object.assign({}, rec.pending, {appr: Date.now()}); rec.pending = null; rec.app = null;
        rec.rejected = (rec.rejected || []).filter(x=>x !== rec.device.h);
        await putRec(client, rec);
      }
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "reject"){                                       // v104: richiesta rifiutata → il link non vale più (per riprovare serve un link nuovo)
      if(rec.pending){ rej(rec.pending.h); rec.pending = null; if(!rec.device){ rec.locked = true; rec.lockWhy = "rejected"; } }
      await putRec(client, rec); return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "remove"){                                       // dispositivo tolto: il link non vale più per nessuno
      if(rec.device) rej(rec.device.h); if(rec.pending) rej(rec.pending.h);
      rec.device = null; rec.pending = null; rec.app = null; rec.locked = true; rec.lockWhy = "removed";
      const sd = sessDel(rec); rec.sess = [];
      await kv([...sd, ["HSET", P + "view", client, JSON.stringify(rec)]]);
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "pinreset"){ if(rec.device){ delete rec.device.pin; delete rec.device.salt; rec.device.fails = 0; rec.device.blocked = false; await putRec(client, rec); } return send(res, 200, {ok: true, view: pub(rec)}); }
    if(op === "unblock"){ if(rec.device){ rec.device.fails = 0; rec.device.blocked = false; await putRec(client, rec); } return send(res, 200, {ok: true, view: pub(rec)}); }
    if(op === "ack"){
      const ids = Array.isArray(body.ids) ? body.ids : [];
      rec.alerts = (rec.alerts || []).filter(a=>!ids.includes(a.id));
      await putRec(client, rec);
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "keep"){ rec.delreq = 0; rec.alerts = (rec.alerts || []).filter(a=>a.k !== "delreq"); await putRec(client, rec); return send(res, 200, {ok: true, view: pub(rec)}); }
    if(op === "block"){                                       // link spento (a mano, cartella eliminata o richiesta di cancellazione)
      const cmds = [["HDEL", P + "view", client], ["DEL", P + "viewsnap:" + client]];
      if(TOK(rec.token)) cmds.push(["DEL", P + "viewtok:" + rec.token]);
      cmds.push(...sessDel(rec));
      await kv(cmds);
      return send(res, 200, {ok: true, view: null});
    }
    return send(res, 400, {error:"op"});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
