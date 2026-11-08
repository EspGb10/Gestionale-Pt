/* Pagina del cliente (v101). File NUOVO: non cambia data.js, login.js, recover.js, kvlib.js, firme.js.
   Il cliente apre un link (cliente.html?t=CODICE) e vede SOLO la situazione del suo pacchetto, sempre aggiornata.
   Ogni dispositivo deve essere approvato dal trainer (massimo 1 per cliente), poi il cliente sceglie un PIN di 4 cifre.
   Chiavi nel database:
     gpt:view            hash: <cliente> -> scheda della pagina (link, dispositivo, richiesta, avvisi, consensi…)
     gpt:viewtok:<cod>   -> <cliente>
     gpt:viewsnap:<cl>   -> situazione del pacchetto (la prepara il gestionale a ogni modifica)
     gpt:viewsess:<k>    -> accesso aperto dopo il PIN (12 ore)
     gpt:viewfail:<ip>   -> tentativi sbagliati (blocco per 15 minuti dopo 30)
   Senza password (il cliente, dal link):
     GET  ?t=COD&d=DISP[&k=ACCESSO]  -> {state: new|waiting|setpin|pin|ok|removed|expired|blocked}  (410 = link spento)
     POST {t, d, op:"ask", name, kind, consent}   chiede l'accesso (con la spunta dell'informativa)
     POST {t, d, op:"setpin", pin} · {op:"pin", pin}   -> {state:"ok", k, data, sigs}
     POST {t, d, k, op:"sign", id, s}   firma una seduta non firmata · {op:"logout"} scollega il dispositivo · {op:"bye"} chiude l'accesso
     POST {t, d, k, op:"delreq"}      chiede di cancellare i dati della pagina (decide il trainer)
   Con la password del gestionale:
     GET  ?list=1  -> {views:{cliente:{…}}}
     POST {op:"link", client, trainer, first}   -> {token}  (lo stesso finché il dispositivo non viene tolto o il link bloccato)
     POST {op:"snap", client, snap} · approve · reject · remove · block · pinreset · unblock · ack(ids) · keep · blockall */
const crypto = require("crypto");
const {kv, missing, authorized, readJson, send, ipOf, P} = require("./kvlib");

const ID = v => typeof v === "string" && v.length > 0 && v.length <= 120 && !/[\s:]/.test(v);
const TOK = v => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const DEV = v => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
const DATE = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const PIN = v => typeof v === "string" && /^\d{4}$/.test(v);
const STROKES = v => typeof v === "string" && v.length >= 8 && v.length <= 24000 && /^[0-9a-z.]+$/.test(v);
const hash = v => crypto.createHash("sha256").update(String(v)).digest("base64url").slice(0, 32);
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const KINDS = ["iPhone", "iPad", "Android", "computer", "altro"];
const DAY = 86400000, IDLE_DAYS = 30, RENEW_DAYS = 7, SESS = 43200, MAX_FAILS = 5;
const romeDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("sv-SE", {timeZone: "Europe/Rome"});
const romeHM = (ms = Date.now()) => new Date(ms).toLocaleTimeString("it-IT", {timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false});
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pinHash = (dev, pin) => hash("pin:" + dev.salt + ":" + pin);

async function getRec(client){ const [raw] = await kv([["HGET", P + "view", client]]); try{ return raw ? JSON.parse(raw) : null; }catch(_){ return null; } }
const putRec = (client, rec) => kv([["HSET", P + "view", client, JSON.stringify(rec)]]);
function alert(rec, k, extra){
  rec.alerts = (Array.isArray(rec.alerts) ? rec.alerts : []).slice(-29);
  rec.alerts.push(Object.assign({id: crypto.randomBytes(6).toString("base64url"), k, at: Date.now()}, extra || {}));
}
/* quello che vede il gestionale (mai PIN, impronte o codici dei dispositivi) */
const devPub = d => d ? {name: d.name, kind: d.kind, at: d.at, seen: d.seen || 0, blocked: !!d.blocked, pin: !!d.pin} : null;
const sessDel = rec => (Array.isArray(rec && rec.sess) ? rec.sess : []).filter(TOK).map(k=>["DEL", P + "viewsess:" + k]);
const pub = rec => rec ? {on: !!rec.token && !rec.locked, locked: !!rec.locked, device: devPub(rec.device),
  pending: rec.pending ? {name: rec.pending.name, kind: rec.pending.kind, at: rec.pending.at} : null,
  alerts: rec.alerts || [], consents: rec.consents || [], delreq: rec.delreq || 0, seenAt: rec.seenAt || 0, updAt: rec.updAt || 0,
  ended: rec.ended || "", created: rec.created || 0} : null;
/* il pacchetto è chiuso da più di 7 giorni e non è stato rinnovato */
const expired = rec => DATE(rec.ended) && romeDay() > addDays(rec.ended, RENEW_DAYS);
async function tooMany(req){ const [n] = await kv([["GET", P + "viewfail:" + ipOf(req)]]); return Number(n) >= 30; }
async function fail(req, res, code, error){ const k = P + "viewfail:" + ipOf(req); try{ await kv([["INCR", k], ["EXPIRE", k, 900]]); }catch(_){} return send(res, code, {error}); }
async function payload(client, rec){
  const [snapRaw, flat] = await kv([["GET", P + "viewsnap:" + client], ["HGETALL", P + "sig:" + client]]);
  let data = null; try{ data = snapRaw ? JSON.parse(snapRaw) : null; }catch(_){}
  const ids = new Set(((data && data.rows) || []).map(r=>r.id)), sigs = {};
  if(!data || !data.sec || data.sec.firme !== false){
    for(let i = 0; flat && i < flat.length; i += 2){ if(!ids.has(flat[i])) continue; try{ const s = JSON.parse(flat[i+1]); if(s && s.s) sigs[flat[i]] = {s: s.s, via: s.via, time: s.time}; }catch(_){} }
  }
  return {data, sigs, device: rec.device ? rec.device.name : ""};
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
      const d = req.method === "GET" ? q.get("d") : body.d;
      if(!DEV(d)) return send(res, 400, {error:"device"});
      const hd = hash(d), who = {trainer: rec.trainer || "", first: rec.first || ""};
      const mine = !!(rec.device && rec.device.h === hd);
      /* dispositivo tolto dal trainer: nessuno può più chiedere l'accesso con questo link */
      if(rec.locked){
        if(!rec.lastTry || Date.now() - rec.lastTry > 3600000){ rec.lastTry = Date.now(); alert(rec, "try", {name: ""}); await putRec(client, rec); }
        return send(res, 200, Object.assign({state:"removed"}, who));
      }
      if(expired(rec)) return send(res, 200, Object.assign({state:"expired", ended: rec.ended}, who));
      /* 30 giorni senza aprire la pagina: l'approvazione scade, va chiesta di nuovo */
      if(mine && Date.now() - (rec.device.seen || rec.device.appr || Date.now()) > IDLE_DAYS * DAY){
        rec.device = null; alert(rec, "idle"); await putRec(client, rec);
        return send(res, 200, Object.assign({state:"new", again: true}, who));
      }
      const op = req.method === "POST" ? body.op : "get";
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
        rec.consents = (rec.consents || []).slice(-19); rec.consents.push({at, name, kind});
        await putRec(client, rec);
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
      if(op === "bye"){ await kv([["DEL", P + "viewsess:" + body.k]]); return send(res, 200, {ok: true}); }
      if(op === "logout"){                                       // il cliente scollega il suo dispositivo
        rec.device = null; alert(rec, "logout");
        await kv([["DEL", P + "viewsess:" + body.k], ["HSET", P + "view", client, JSON.stringify(rec)]]);
        return send(res, 200, {ok: true});
      }
      if(op === "delreq"){
        rec.delreq = Date.now(); alert(rec, "delreq");
        await putRec(client, rec);
        return send(res, 200, {ok: true});
      }
      return send(res, 400, {error:"op"});
    }
    /* ---------- il trainer (con la password) ---------- */
    if(!(await authorized(req))) return send(res, 401, {error:"login"});
    if(req.method === "GET"){
      if(q.get("list") === null) return send(res, 400, {error:"what"});
      const [flat] = await kv([["HGETALL", P + "view"]]);
      const views = {};
      for(let i = 0; flat && i < flat.length; i += 2){ try{ views[flat[i]] = pub(JSON.parse(flat[i+1])); }catch(_){} }
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
      /* link nuovo se non c'era o se il dispositivo era stato tolto (il vecchio link non vale più) */
      if(!rec || !rec.token || rec.locked){
        const cmds = [];
        if(rec && TOK(rec.token)) cmds.push(["DEL", P + "viewtok:" + rec.token]);
        rec = Object.assign(rec || {}, {token: crypto.randomBytes(24).toString("base64url"), device: null, pending: null, locked: false, created: Date.now()});
        cmds.push(["SET", P + "viewtok:" + rec.token, client]);
        await kv(cmds);
      }
      rec.trainer = clean(body.trainer, 60); rec.first = clean(body.first, 40); rec.t = Date.now();
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
        rec.device = Object.assign({}, rec.pending, {appr: Date.now()}); rec.pending = null;
        rec.rejected = (rec.rejected || []).filter(x=>x !== rec.device.h);
        await putRec(client, rec);
      }
      return send(res, 200, {ok: true, view: pub(rec)});
    }
    if(op === "reject"){ if(rec.pending) rej(rec.pending.h); rec.pending = null; await putRec(client, rec); return send(res, 200, {ok: true, view: pub(rec)}); }
    if(op === "remove"){                                       // dispositivo tolto: il link non vale più per nessuno
      if(rec.device) rej(rec.device.h); if(rec.pending) rej(rec.pending.h);
      rec.device = null; rec.pending = null; rec.locked = true;
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
