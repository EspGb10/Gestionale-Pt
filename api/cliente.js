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
     POST {t, d, op:"move", pin}       v115: “link già usato” ma è un suo dispositivo: con il PIN diventa il SECONDO dispositivo (massimo 2, nessuna notifica);
                                       con 2 dispositivi già registrati il terzo resta fuori (notifica al trainer). Un dispositivo tolto non rientra da solo.
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
/* v114: “stesso telefono, altro browser” (app Google, Chrome, link aperto da WhatsApp o Gmail): stessa rete + stesso tipo di telefono → niente notifiche al trainer.
   Si salva solo un'impronta cifrata (mai l'indirizzo vero) e il tipo di telefono; un telefono diverso fa sempre arrivare l'avviso. */
const netOf = req => { const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim(); return ip ? hash("net:" + ip).slice(0, 16) : ""; };
const osOf = req => { const u = String(req.headers["user-agent"] || ""); return /iPhone|iPod/.test(u) ? "iPhone" : /iPad|Macintosh/.test(u) ? "iPad/Mac" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : "altro"; };
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const KINDS = ["iPhone", "iPad", "Android", "computer", "altro"];
const DAY = 86400000, IDLE_DAYS = 30, RENEW_DAYS = 7, SESS = 43200, MAX_FAILS = 5, HOUR = 3600000, MAX_ASK = 3;
const romeDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("sv-SE", {timeZone: "Europe/Rome"});
const romeHM = (ms = Date.now()) => new Date(ms).toLocaleTimeString("it-IT", {timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false});
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pinHash = (dev, pin) => hash("pin:" + dev.salt + ":" + pin);

/* v105 (11/11): notifiche sul telefono del trainer (api/_pushlib.js): richieste di accesso e avvisi di sicurezza */
const PUSH_NOTE = {
  ask: (n, x)=>({it: {title: "📱 Richiesta di accesso", body: `${n} chiede di vedere la sua pagina da “${x}”. Apri il gestionale per approvare.`},
                 en: {title: "📱 Access request", body: `${n} is asking to see their page from “${x}”. Open the app to approve.`}}),
  other: (n, x)=>(x === "3" ? {it: {title: "⚠️ Link già usato", body: `Un terzo dispositivo ha provato ad aprire il link di ${n} (ne ha già 2 registrati).`},
                                en: {title: "⚠️ Link already used", body: `A third device tried to open ${n}'s link (2 are already registered).`}}
                             : {it: {title: "⚠️ Link già usato", body: `Un altro telefono ha provato ad aprire il link di ${n}.`},
                                en: {title: "⚠️ Link already used", body: `Another phone tried to open ${n}'s link.`}}),
  pinlock: n=>({it: {title: "🔒 PIN bloccato", body: `${n}: 5 PIN sbagliati, la pagina è bloccata. Puoi sbloccarla dal gestionale.`},
                en: {title: "🔒 PIN locked", body: `${n}: 5 wrong PINs, the page is locked. You can unlock it from the app.`}}),
  banned: (n, x)=>({it: {title: "🚫 Dispositivo bloccato", body: `Un dispositivo bloccato${x ? ` (“${x}”)` : ""} ha provato ad aprire il link di ${n}.`},
                    en: {title: "🚫 Blocked device", body: `A blocked device${x ? ` (“${x}”)` : ""} tried to open ${n}'s link.`}}),
  delreq: n=>({it: {title: "🗑 Richiesta di cancellazione", body: `${n} chiede di cancellare i dati della sua pagina.`},
               en: {title: "🗑 Deletion request", body: `${n} is asking to delete their page's data.`}}),
  try: n=>({it: {title: "⚠️ Tentativo di accesso", body: `Qualcuno ha provato ad aprire la pagina di ${n} con un link non più valido o da un dispositivo tolto. Dal gestionale puoi creare un link nuovo.`},
            en: {title: "⚠️ Access attempt", body: `Someone tried to open ${n}'s page with a link that's no longer valid or from a removed device. You can create a new link from the app.`}})
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
function lockIdle(rec){ rec.idleOf = [...hsOf(rec.device), rec.app && rec.app.h, ...hsOf(rec.dev2)].filter(Boolean); rec.idleWhere = rec.device && rec.device.where || ""; rec.device = null; rec.dev2 = null; rec.pending = null; rec.app = null; rec.locked = true; rec.lockWhy = "idle"; rec.triedOnce = false; alert(rec, "idle"); const sd = sessDel(rec); rec.sess = []; return sd; }
/* quello che vede il gestionale (mai PIN, impronte o codici dei dispositivi) */
const devPub = d => d ? {name: d.name, kind: d.kind, at: d.at, seen: d.seen || 0, blocked: !!d.blocked, pin: !!d.pin} : null;
const sessDel = rec => (Array.isArray(rec && rec.sess) ? rec.sess : []).filter(TOK).map(k=>["DEL", P + "viewsess:" + k])
  .concat((Array.isArray(rec && rec.xf) ? rec.xf : []).filter(TOK).map(k=>["DEL", P + "viewxfer:" + k]));   // (anche i codici per l'icona)
/* v115: il secondo dispositivo (registrato dal cliente con il suo PIN) e la promozione a principale quando togli il primo */
/* v115: cronologia dei dispositivi tolti o rifiutati (per cliente) e blocchi permanenti (per tutti i link: gpt:viewban) */
const newId = () => crypto.randomBytes(6).toString("base64url");
const histOf = rec => Array.isArray(rec.hist) ? rec.hist : [];
const histPush = (rec, e) => { rec.hist = histOf(rec).filter(x=>x.id !== e.id).slice(-29).concat(e); };
const histFind = (rec, h, fp, why) => histOf(rec).find(x=>!x.ban && (!why || x.why === why) && ((Array.isArray(x.hs) && x.hs.includes(h)) || (fp && x.fp && x.fp === fp)));
const histDrop = (rec, h, fp) => { rec.hist = histOf(rec).filter(x=>x.ban || !((Array.isArray(x.hs) && x.hs.includes(h)) || (fp && x.fp && x.fp === fp))); };
async function loadBans(){ const [flat] = await kv([["HGETALL", P + "viewban"]]); const out = [];
  for(let i = 0; flat && i < flat.length; i += 2){ try{ const b = JSON.parse(flat[i+1]); if(b && typeof b === "object"){ b.id = flat[i]; out.push(b); } }catch(_){} } return out; }
const hasH = (dv, h) => !!(dv && h && (dv.h === h || (Array.isArray(dv.al) && dv.al.includes(h))));   // v115: un dispositivo = un telefono con tutti i suoi browser/app
const hsOf = dv => dv ? [dv.h].concat(Array.isArray(dv.al) ? dv.al : []).filter(Boolean) : [];
const devName = v => clean(v, 40).replace(/\s+/g, " ");   // nomi dei dispositivi: diversi anche solo per un carattere
const dev2Pub = d => d ? {name: d.name, kind: d.kind, at: d.at, seen: d.seen || 0} : null;
const kindOf = req => { const o = osOf(req); return o === "iPhone" ? "iPhone" : o === "Android" ? "Android" : o === "iPad/Mac" ? (/iPad/.test(String(req.headers["user-agent"] || "")) ? "iPad" : "computer") : o === "Windows" ? "computer" : "altro"; };
function promote(rec){   // il secondo dispositivo diventa il principale (stesso PIN)
  const m = rec.device, s = rec.dev2;
  rec.device = Object.assign({}, s, {pin: m.pin, salt: m.salt, fails: m.fails || 0, blocked: !!m.blocked, appr: m.appr || Date.now()});
  rec.dev2 = null; rec.bh = s.h; if(rec.app && !hsOf(s).includes(rec.app.of)) rec.app = null;
}
const pub = rec => rec ? {on: !!rec.token && !rec.locked, locked: !!rec.locked, device: devPub(rec.device), dev2: rec.device ? dev2Pub(rec.dev2) : null, app: rec.device && rec.app ? {at: rec.app.at} : null,
  pending: rec.pending ? {name: rec.pending.name, kind: rec.pending.kind, at: rec.pending.at} : null,
  alerts: rec.alerts || [], consents: rec.consents || [],
  hist: histOf(rec).map(e=>({id: e.id, name: e.name || "", kind: e.kind || "", why: e.why, at: e.at || 0, n: e.n || 0, ban: !!e.ban, banAt: e.banAt || 0})), delreq: rec.delreq || 0, seenAt: rec.seenAt || 0, updAt: rec.updAt || 0,
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
  rec.seenAt = Date.now(); rec.device.seen = rec.seenAt; if(rec.dev2 && rec.dev2.h === hd) rec.dev2.seen = rec.seenAt;
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
      { const ck = cookieDev(req), isMine = h => !!(rec.device && (hasH(rec.device, h) || (rec.app && rec.app.h === h) || hasH(rec.dev2, h))) || !!(rec.pending && rec.pending.h === h) || (!rec.device && rec.bh === h);
        if(ck && ck !== d && !isMine(hash(d)) && isMine(hash(ck))){ d = ck; res.__ptDev = ck; }   // memoria di Safari cancellata: è lo stesso telefono
        res.__ptCookie = d; }
      const hd = hash(d), who = {trainer: rec.trainer || "", first: rec.first || ""};
      const mine = !!(rec.device && (hasH(rec.device, hd) || (rec.app && rec.app.h === hd) || hasH(rec.dev2, hd)));   // v105: anche la sua app sulla schermata Home · v115: e gli altri browser/app dei suoi 2 dispositivi
      const isD2 = !!(mine && hasH(rec.dev2, hd));
      /* v115: impronta del TELEFONO (tipo, schermo, densità, fuso orario): uguale in Safari, WhatsApp, Instagram, Telegram e nell'icona dello stesso telefono */
      const fIn = req.method === "GET" ? q.get("f") : body.f;
      const fpNow = typeof fIn === "string" && /^[0-9A-Za-z.x|\/_+-]{3,80}$/.test(fIn) ? hash("fp:" + osOf(req) + "|" + fIn).slice(0, 16) : "";
      const same1 = !!(fpNow && rec.device && rec.device.fp === fpNow), same2 = !!(fpNow && rec.dev2 && rec.dev2.fp === fpNow);
      /* v115: dispositivo bloccato permanentemente dal trainer: nessun link, di nessun cliente (1 notifica al primo tentativo) */
      { const ban = (await loadBans()).find(b=>(Array.isArray(b.hs) && b.hs.includes(hd)) || (!mine && fpNow && b.fp && b.fp === fpNow));
        if(ban){
          if(!ban.n){ const {id, ...keep} = ban; keep.n = 1; alert(rec, "banned", {name: ban.name || ""});
            await kv([["HSET", P + "viewban", id, JSON.stringify(keep)], ["HSET", P + "view", client, JSON.stringify(rec)]]); await notify(rec, "banned", ban.name || ""); }
          return send(res, 200, Object.assign({state:"banned"}, who));
        } }
      const isApp = req.method === "GET" ? q.get("a") === "1" : body.a === true;                  // aperta dall'icona sulla schermata Home
      const nt = netOf(req), here = nt ? nt + "|" + osOf(req) : "";                                // v114: rete + tipo di telefono
      if(mine){ const me = isD2 ? rec.dev2 : rec.device; let dirty = false;
        if(here && me.where !== here){ me.where = here; dirty = true; }
        if(fpNow && !me.fp){ me.fp = fpNow; dirty = true; }   // impronta registrata alla prima apertura (anche per i dispositivi approvati prima della v115)
        if(dirty) await putRec(client, rec); }
      const refW = rec.device ? rec.device.where : rec.pending ? rec.pending.where : "", samePh = !!(here && refW && refW === here);
      /* 30 giorni senza aprire la pagina: il link si spegne, serve un link nuovo (v104) */
      if(idleDev(rec)){ const sd = lockIdle(rec); await kv([...sd, ["HSET", P + "view", client, JSON.stringify(rec)]]); return send(res, 200, Object.assign({state:"idle"}, who)); }
      /* dispositivo tolto, richiesta rifiutata o 30 giorni: nessuno può più chiedere l'accesso con questo link */
      if(rec.locked){
        const sameIdle = rec.lockWhy === "idle" && ((rec.idleOf || []).includes(hd) || !!(here && rec.idleWhere === here));   // v114: è il suo telefono: serve solo un link nuovo, nessun avviso
        if(!sameIdle && !rec.triedOnce){ rec.triedOnce = true; rec.lastTry = Date.now();   // v114: una volta sola per questo link (poi crei un link nuovo e quello vecchio non vale più)
          alert(rec, "try", {name: ""}); await putRec(client, rec); await notify(rec, "try"); }
        return send(res, 200, Object.assign({state: rec.lockWhy === "idle" ? "idle" : "removed"}, who));
      }
      if(expired(rec)) return send(res, 200, Object.assign({state:"expired", ended: rec.ended}, who));
      const op = req.method === "POST" ? body.op : "get";
      /* icona sulla schermata Home: prende l'approvazione del dispositivo che ha creato il codice (stesso telefono) */
      if(op === "claim"){
        if(!TOK(body.x)) return send(res, 400, {error:"x"});
        const [raw] = await kv([["GET", P + "viewxfer:" + body.x]]);
        let xr = null; try{ xr = raw ? JSON.parse(raw) : null; }catch(_){}
        if(!xr || xr.c !== client || !rec.device || (!hasH(rec.device, xr.h) && !hasH(rec.dev2, xr.h)) || rec.device.blocked) return send(res, 200, Object.assign({state: mine ? "pin" : boundH(rec) && boundH(rec) !== hd ? "used" : "new", claimed: false}, who));
        rec.app = {h: hd, at: Date.now(), of: xr.h}; rec.device.seen = Date.now(); alert(rec, "app", {name: rec.device.name});   // v105: l'icona diventa la sua app, Safari continua a funzionare
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
        rec.device.fails = 0;
        if(same2 && !same1){ rec.dev2.al = (rec.dev2.al || []).slice(-5).concat(hd); }                         // v115: icona sul secondo telefono
        else { rec.app = {h: hd, at: Date.now(), of: rec.device.h}; alert(rec, "app", {name: rec.device.name}); }   // una sola app: quella vecchia non vale più
        const k = await openSession(client, rec, hd);
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      /* v105 (11/11): “link già usato” ma è il suo telefono (memoria cancellata, finestra privata, altro browser): con il suo PIN la pagina si sposta qui */
      if(op === "move" && !mine){
        if(!rec.device || !rec.device.pin) return send(res, 200, Object.assign({state:"used"}, who));
        if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
        if((rec.rejected || []).includes(hd)) return send(res, 200, Object.assign({state:"devoff"}, who));       // v115: dispositivo tolto dal trainer
        /* v115: stesso telefono di un dispositivo già registrato (altra app o browser) → si aggiunge a quel dispositivo; telefono nuovo → 2° dispositivo (con un nome diverso) */
        const tgt = same1 ? 1 : same2 ? 2 : !rec.dev2 ? 0 : -1;
        if(tgt < 0) return send(res, 200, Object.assign({state:"used", full: true, canPin: false}, who));          // ne ha già 2
        const back = tgt === 0 ? histFind(rec, hd, fpNow, "removed") : null;                                     // v115: dispositivo tolto che rientra
        const nm2 = tgt === 0 ? (back && devName(back.name) !== devName(rec.device.name) && !body.name ? devName(back.name) : devName(body.name)) : "";
        if(tgt === 0 && nm2.length < 2) return send(res, 400, {error:"name"});
        if(tgt === 0 && nm2 === devName(rec.device.name)) return send(res, 409, {error:"name_same", other: rec.device.name});
        if(!PIN(body.pin) || pinHash(rec.device, body.pin) !== rec.device.pin){
          rec.device.fails = (Number(rec.device.fails) || 0) + 1;
          if(rec.device.fails >= MAX_FAILS){ rec.device.blocked = true; alert(rec, "pinlock", {name: rec.device.name}); }
          await putRec(client, rec);
          if(rec.device.blocked) await notify(rec, "pinlock");
          return send(res, 200, Object.assign({state: rec.device.blocked ? "blocked" : "movepin", wrong: true, left: Math.max(0, MAX_FAILS - rec.device.fails)}, who));
        }
        rec.device.fails = 0;
        if(tgt === 1) rec.device.al = (rec.device.al || []).slice(-5).concat(hd);
        else if(tgt === 2) rec.dev2.al = (rec.dev2.al || []).slice(-5).concat(hd);
        else { rec.dev2 = {h: hd, fp: fpNow || (back && back.fp) || "", name: nm2, kind: back && back.kind || kindOf(req), at: Date.now(), seen: Date.now(), where: here, al: back ? (back.hs || []).filter(x=>x !== hd).slice(-6) : []};
          if(back) rec.hist = histOf(rec).filter(x=>x.id !== back.id); }                                            // v115: torna al suo posto e sparisce dalla cronologia
        const k = await openSession(client, rec, hd);                                                            // nessuna notifica: con il PIN giusto è il cliente
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      /* v104: link legato a un altro dispositivo → “link già usato” (avviso al trainer al massimo una volta all'ora) */
      const bh = boundH(rec);
      if(bh && bh !== hd && !mine && rec.moved === hd) return send(res, 200, Object.assign({state:"moved"}, who));   // stesso telefono: ora si apre dall'icona
      if(bh && bh !== hd && !mine){
        /* v115: un dispositivo tolto dal trainer che riprova → avviso UNA volta (per quel dispositivo), non può rientrare da solo */
        if(rec.device && (rec.rejected || []).includes(hd)){
          const grp = (rec.offG || []).find(g=>Array.isArray(g.hs) && g.hs.includes(hd));                 // v115: tutte le app di quel telefono = un avviso solo
          if(grp ? !grp.n : !(rec.triedH || []).includes(hd)){ if(grp) grp.n = 1; else rec.triedH = (rec.triedH || []).slice(-9).concat(hd); alert(rec, "try", {name: ""}); await putRec(client, rec); await notify(rec, "try"); }
          return send(res, 200, Object.assign({state:"devoff"}, who));
        }
        if(isApp && rec.device && rec.device.pin && !rec.device.blocked) return send(res, 200, Object.assign({state:"apppin"}, who));   // v105: è la sua icona? chiede il PIN
        const okPin = !!(rec.device && rec.device.pin && !rec.device.blocked);
        if(okPin && (same1 || same2)) return send(res, 200, Object.assign({state:"used", canPin: true, same: same1 ? 1 : 2, other: same1 ? rec.device.name : rec.dev2.name}, who));   // v115: stesso telefono, altra app o browser: con il PIN entra, nessuna notifica
        if(okPin && !rec.dev2){ const bk = histFind(rec, hd, fpNow, "removed");                                  // v115: posto libero per il 2° dispositivo: con il PIN entra, nessuna notifica
          return send(res, 200, Object.assign({state:"used", canPin: true}, bk && devName(bk.name) !== devName(rec.device.name) ? {back: bk.name} : {}, who)); }
        const full = !!(rec.device && rec.dev2);
        if(!full && (samePh || (fpNow && rec.pending && rec.pending.fp === fpNow))) return send(res, 200, Object.assign({state:"used", canPin: false}, who));   // stesso telefono in attesa di approvazione o senza PIN
        if(!rec.lastOther || Date.now() - rec.lastOther > HOUR){ rec.lastOther = Date.now(); alert(rec, "other", full ? {n: 3} : {}); await putRec(client, rec); await notify(rec, "other", full ? "3" : ""); }
        return send(res, 200, Object.assign({state:"used", canPin: false, full}, who));
      }
      /* v104: link non usato entro 1 ora (chi l'ha aperto in tempo può ancora inviare la richiesta, fino a 24 ore) */
      if(!bh && linkOld(rec) && !openedInTime(rec, hd)) return send(res, 200, Object.assign({state:"linkold"}, who));
      if(!bh && req.method === "GET" && !(rec.opened || []).includes(hd)){ rec.opened = (rec.opened || []).slice(-4).concat(hd); await putRec(client, rec); }
      if(req.method === "GET"){
        if(mine){
          if(rec.device.blocked) return send(res, 200, Object.assign({state:"blocked"}, who));
          if(!rec.device.pin) return send(res, 200, Object.assign(isD2 ? {state:"pinwait", other: rec.device.name} : {state:"setpin"}, who));   // v115: il PIN nuovo si crea sul primo dispositivo
          const k = q.get("k");
          if(k && await session(k, client, hd)){
            if(!rec.seenAt || Date.now() - rec.seenAt > 60000 || rec.seenAt < (rec.updAt || 0)){ rec.seenAt = Date.now(); rec.device.seen = rec.seenAt; if(isD2) rec.dev2.seen = rec.seenAt; await putRec(client, rec); }
            return send(res, 200, Object.assign({state:"ok"}, who, await payload(client, rec)));
          }
          return send(res, 200, Object.assign({state:"pin", d2: isD2, other: isD2 ? rec.device.name : ""}, who));   // v115: sul 2° “digita il PIN creato sul primo dispositivo”
        }
        if(rec.pending && rec.pending.h === hd) return send(res, 200, Object.assign({state:"waiting", name: rec.pending.name}, who));
        const rj = histFind(rec, hd, fpNow, "rejected");                                                        // v115: richieste rifiutate (massimo 3)
        if(rj && (rj.n || 0) >= MAX_ASK) return send(res, 200, Object.assign({state:"askmax"}, who));
        return send(res, 200, Object.assign({state:"new", rej: rj ? rj.n || 0 : 0, max: MAX_ASK}, who));
      }
      if(req.method !== "POST") return send(res, 405, {error:"method"});
      if(op === "ask"){
        if(mine) return send(res, 200, {state: rec.device.pin ? "pin" : "setpin"});
        if(body.consent !== true) return send(res, 400, {error:"consent"});
        { const rj = histFind(rec, hd, fpNow, "rejected"); if(rj && (rj.n || 0) >= MAX_ASK) return send(res, 200, Object.assign({state:"askmax"}, who)); }
        const name = clean(body.name, 40);
        if(name.length < 2) return send(res, 400, {error:"name"});
        const kind = KINDS.includes(body.kind) ? body.kind : "altro", at = Date.now();
        if((rec.rejected || []).includes(hd)) alert(rec, "try", {name});     // dispositivo già rifiutato o tolto che riprova
        rec.pending = {h: hd, name, kind, at, where: here, fp: fpNow};
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
        if(isD2) return send(res, 200, Object.assign({state:"pinwait", other: rec.device.name}, who));
        if(!PIN(body.pin)) return send(res, 400, {error:"pin"});
        rec.device.salt = crypto.randomBytes(9).toString("base64url"); rec.device.pin = pinHash(rec.device, body.pin); rec.device.fails = 0;
        const k = await openSession(client, rec, hd);
        return send(res, 200, Object.assign({state:"ok", k}, who, await payload(client, rec)));
      }
      if(op === "pin"){
        if(!rec.device.pin) return send(res, 200, Object.assign(isD2 ? {state:"pinwait", other: rec.device.name} : {state:"setpin"}, who));
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
        if(rec.app && rec.app.h === hd && rec.device.h !== hd) rec.app = null;                 // v105: dall'app scollega solo l'app
        else if(isD2) rec.dev2 = null;                                                          // v115: dal secondo dispositivo scollega solo quello
        else if(rec.dev2) promote(rec);                                                         // v115: dal primo: il secondo diventa il principale
        else { rec.device = null; rec.app = null; }
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
      if(op === "delreq") return send(res, 403, {error:"off"});         // v106: dalla pagina del cliente non si chiede più di cancellare i dati (decide il trainer)
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
        rec = Object.assign(rec || {}, {token: crypto.randomBytes(24).toString("base64url"), device: null, dev2: null, triedH: [], offG: [], rejected: [], app: null, pending: null, locked: false, created: Date.now(), bh: "", bound: 0, opened: [], lockWhy: "", lastOther: 0, moved: "", idleOf: [], idleWhere: "", triedOnce: false});
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
    const rej = h => { if(h){ rec.rejected = (rec.rejected || []).filter(x=>x !== h).slice(-29); rec.rejected.push(h); } };
    const rejDev = dv => hsOf(dv).forEach(rej);                                                   // v115: tutti i browser/app di quel telefono
    if(op === "approve"){
      if(rec.pending){
        rejDev(rec.device); rejDev(rec.dev2); rec.dev2 = null;   // il dispositivo approvato sostituisce quelli di prima
        rec.device = Object.assign({}, rec.pending, {appr: Date.now()}); rec.pending = null; rec.app = null;
        histDrop(rec, rec.device.h, rec.device.fp);                                              // v115: approvato → sparisce dalla cronologia
        rec.rejected = (rec.rejected || []).filter(x=>x !== rec.device.h);
        await putRec(client, rec);
      }
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "reject"){                                       // v104: richiesta rifiutata → il link non vale più (per riprovare serve un link nuovo)
      if(rec.pending){ const p = rec.pending, e = histFind(rec, p.h, p.fp, "rejected");               // v115: va nella cronologia; può richiedere al massimo 3 volte in tutto
        histPush(rec, Object.assign(e || {id: newId(), why: "rejected", hs: []}, {name: p.name, kind: p.kind, fp: p.fp || (e && e.fp) || "", hs: [...new Set([...(e ? e.hs || [] : []), p.h])].slice(-8), at: Date.now(), n: (e ? e.n || 1 : 0) + 1}));
        rec.pending = null; }
      await putRec(client, rec); return send(res, 200, {ok: true, view: pub(rec)});
    }
    /* v115: cronologia: blocca permanentemente, sblocca (torna “tolto”), elimina (se era bloccato resta bloccato per sempre) */
    if(op === "ban" || op === "unban" || op === "histdel"){
      const e = histOf(rec).find(x=>x.id === body.id); if(!e) return send(res, 404, {error:"hist"});
      if(op === "ban"){ e.ban = e.id; e.banAt = Date.now();
        await kv([["HSET", P + "viewban", e.id, JSON.stringify({fp: e.fp || "", hs: e.hs || [], name: e.name || "", client, at: e.banAt})], ["HSET", P + "view", client, JSON.stringify(rec)]]); }
      else if(op === "unban"){ e.ban = ""; e.banAt = 0; await kv([["HDEL", P + "viewban", e.id], ["HSET", P + "view", client, JSON.stringify(rec)]]); }
      else { rec.hist = histOf(rec).filter(x=>x.id !== e.id); await putRec(client, rec); }
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    /* v115: il trainer cambia il nome di un dispositivo (i 2 nomi devono essere diversi) */
    if(op === "rename"){
      const d = body.which === "dev2" ? rec.dev2 : rec.device, o = body.which === "dev2" ? rec.device : rec.dev2;
      if(!d) return send(res, 404, {error:"device"});
      const nm = devName(body.name);
      if(nm.length < 2) return send(res, 400, {error:"name"});
      if(o && devName(o.name) === nm) return send(res, 409, {error:"name_same"});
      d.name = nm; await putRec(client, rec);
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "remove" && body.which === "dev2" && !rec.dev2) return send(res, 200, {ok: true, view: pub(rec)});   // v115: già tolto (finestra vecchia): non spegnere tutto
    /* v115: togli UN dispositivo (l'altro continua a funzionare, il link resta acceso) */
    if(op === "remove" && rec.device && rec.dev2 && (body.which === "dev2" || body.which === "main")){
      const goneDev = body.which === "dev2" ? rec.dev2 : rec.device, gone = hsOf(goneDev);
      histPush(rec, {id: newId(), why: "removed", name: goneDev.name, kind: goneDev.kind, fp: goneDev.fp || "", hs: gone.slice(-8), at: Date.now(), slot: body.which === "dev2" ? 2 : 1});   // v115: cronologia (può rientrare)
      if(body.which === "dev2"){ if(rec.app && gone.includes(rec.app.of)) rec.app = null; rec.dev2 = null; } else promote(rec);
      await putRec(client, rec);
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "remove"){                                       // dispositivo tolto: il link non vale più per nessuno
      [rec.device, rec.dev2].forEach(dv=>{ if(dv) histPush(rec, {id: newId(), why: "removed", name: dv.name, kind: dv.kind, fp: dv.fp || "", hs: hsOf(dv).slice(-8), at: Date.now()}); });   // v115: cronologia
      rejDev(rec.device); if(rec.pending) rej(rec.pending.h); rejDev(rec.dev2);
      rec.device = null; rec.dev2 = null; rec.pending = null; rec.app = null; rec.locked = true; rec.lockWhy = "removed"; rec.triedOnce = false;
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
