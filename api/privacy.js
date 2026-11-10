/* Documento privacy del cliente (v105, aggiornamento). File NUOVO: non cambia data.js, login.js, recover.js, kvlib.js, firme.js.
   Il cliente lo vede SOLO quando il trainer glielo manda; lo legge, preme “Ho letto e accetto” e lo firma.
     gpt:privacy   hash: <cliente> -> {st:"sent", sent}                       (mandato, in attesa della firma)
                                      {st:"signed", sent, at, via, lang, v, s} (firmato: s = tratti della firma)
   Tutto sta solo qui: eliminandolo (op del / drop / wipe) non resta da nessuna parte.
   Senza password (il cliente, dal link della firma di una seduta):
     GET  /api/privacy?t=CODICE                       -> {need: true|false}
     POST /api/privacy {t, op:"sign", s, lang}        -> {ok}   (solo se il documento è stato mandato)
   Con la password del gestionale:
     GET  /api/privacy?list=1                         -> {privacy:{cliente:{st, sent, at, via, lang}}}   (senza firme)
     GET  /api/privacy?client=ID                      -> {doc:{...con la firma}}   (per il PDF)
     POST {op:"send",   client}   mandalo al cliente          · {op:"cancel", client} annulla l'invio
     POST {op:"sign",   client, s, lang}  firma sul telefono del trainer (solo se mandato)
     POST {op:"del",    client}   elimina il documento firmato · {op:"drop", client} cartella eliminata · {op:"wipe"} cancella tutto
   Modulo firmato A PENNA e caricato dal trainer (scanner o foto, già trasformato in PDF dal gestionale), si tiene insieme a quello digitale:
     gpt:privpaper:<cliente>  {date:"AAAA-MM-GG" (data scritta sul foglio), up (quando l'hai caricato), size, data (PDF in base64)}
     gpt:privpaper            hash: <cliente> -> {date, up, size}   (l'elenco, senza il file)
     GET  /api/privacy?paper=ID                       -> {doc:{date, up, size, data}}
     POST {op:"paper", client, date, data}  carica (se il documento era solo mandato al cliente, l'invio si annulla)
     POST {op:"paperdel", client}           elimina il modulo cartaceo (drop e wipe cancellano anche questo) */
const {kv, missing, authorized, readJson, send, P} = require("./kvlib");

const VERSION = 1;                                         // versione del testo del modulo
const ID = v => typeof v === "string" && v.length > 0 && v.length <= 120 && !/[\s:]/.test(v);
const TOK = v => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const STROKES = v => typeof v === "string" && v.length >= 8 && v.length <= 24000 && /^[0-9a-z.]+$/.test(v);
const KEY = P + "privacy", PKEY = P + "privpaper", PDOC = c => P + "privpaper:" + c;
const MAXB64 = 4200000;                                    // ~3 MB di PDF (Vercel accetta al massimo 4,5 MB per richiesta)
const DATE = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const PDF64 = v => typeof v === "string" && v.length > 100 && v.length <= MAXB64 && v.startsWith("JVBER") && /^[A-Za-z0-9+/]+=*$/.test(v);
const parse = raw => { try{ const r = raw ? JSON.parse(raw) : null; return r && typeof r === "object" ? r : null; }catch(_){ return null; } };
const signed = (rec, s, via, lang) => ({st: "signed", sent: Number(rec.sent) || 0, at: Date.now(), via, lang: lang === "en" ? "en" : "it", v: VERSION, s});

async function clientOfSignLink(t){                        // il link della firma (api/firme.js) dice di quale cliente si tratta
  if(!TOK(t)) return "";
  const [raw] = await kv([["GET", P + "sigtok:" + t]]);
  const rec = parse(raw);
  return rec && ID(rec.client) ? rec.client : "";
}

module.exports = async (req, res) => {
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  const q = new URL(req.url, "http://x").searchParams;
  let body = {};
  if(req.method === "POST"){ try{ body = await readJson(req) || {}; }catch(_){ return send(res, 400, {error:"json"}); } }
  try{
    /* ---------- il cliente, dal link della firma (senza password) ---------- */
    const pub = req.method === "GET" ? q.get("t") : body.t;
    if(pub !== null && pub !== undefined){
      const client = await clientOfSignLink(pub);
      if(!client) return send(res, 410, {error:"expired"});
      const [raw] = await kv([["HGET", KEY, client]]);
      const rec = parse(raw);
      if(req.method === "GET") return send(res, 200, {need: !!(rec && rec.st === "sent")});
      if(body.op !== "sign") return send(res, 400, {error:"op"});
      if(!rec || rec.st !== "sent") return send(res, 409, {error:"not_sent"});
      if(!STROKES(body.s)) return send(res, 400, {error:"strokes"});
      await kv([["HSET", KEY, client, JSON.stringify(signed(rec, body.s, "firma", body.lang))]]);
      return send(res, 200, {ok: true});
    }
    /* ---------- il trainer (con la password) ---------- */
    if(!(await authorized(req))) return send(res, 401, {error:"login"});
    if(req.method === "GET"){
      if(q.get("client") !== null){
        const c = q.get("client"); if(!ID(c)) return send(res, 400, {error:"client"});
        const [raw] = await kv([["HGET", KEY, c]]);
        const rec = parse(raw);
        return send(res, 200, {doc: rec && rec.st === "signed" ? rec : null});
      }
      if(q.get("paper") !== null){
        const c = q.get("paper"); if(!ID(c)) return send(res, 400, {error:"client"});
        const [raw] = await kv([["GET", PDOC(c)]]);
        return send(res, 200, {doc: parse(raw)});
      }
      if(q.get("list") === null) return send(res, 400, {error:"what"});
      const [flat, pflat] = await kv([["HGETALL", KEY], ["HGETALL", PKEY]]);
      const paper = {};
      for(let i = 0; pflat && i < pflat.length; i += 2){ const r = parse(pflat[i+1]); if(r) paper[pflat[i]] = {date: r.date, up: r.up, size: r.size}; }
      const out = {};
      for(let i = 0; flat && i < flat.length; i += 2){ const r = parse(flat[i+1]); if(!r) continue;
        out[flat[i]] = r.st === "signed" ? {st: "signed", sent: r.sent || 0, at: r.at, via: r.via, lang: r.lang || "it"} : {st: "sent", sent: r.sent || 0}; }
      return send(res, 200, {privacy: out, paper});
    }
    if(req.method !== "POST") return send(res, 405, {error:"method"});
    const op = body.op;
    if(op === "wipe"){
      const [keys] = await kv([["HKEYS", PKEY]]);
      await kv([["DEL", KEY, PKEY, ...(keys || []).filter(ID).map(PDOC)]]);
      return send(res, 200, {ok: true});
    }
    if(!ID(body.client)) return send(res, 400, {error:"client"});
    const c = body.client;
    const [raw] = await kv([["HGET", KEY, c]]);
    const rec = parse(raw);
    if(op === "send"){
      if(rec && rec.st === "signed") return send(res, 409, {error:"signed"});
      const n = {st: "sent", sent: Date.now()};
      await kv([["HSET", KEY, c, JSON.stringify(n)]]);
      return send(res, 200, {ok: true, item: n});
    }
    if(op === "cancel"){
      if(rec && rec.st === "sent") await kv([["HDEL", KEY, c]]);
      return send(res, 200, {ok: true});
    }
    if(op === "sign"){                                     // il cliente firma sul telefono del trainer
      if(!rec || rec.st !== "sent") return send(res, 409, {error:"not_sent"});
      if(!STROKES(body.s)) return send(res, 400, {error:"strokes"});
      const n = signed(rec, body.s, "gestionale", body.lang);
      await kv([["HSET", KEY, c, JSON.stringify(n)]]);
      return send(res, 200, {ok: true, item: {st: n.st, sent: n.sent, at: n.at, via: n.via, lang: n.lang}});
    }
    if(op === "paper"){                                    // modulo firmato a penna
      if(!DATE(body.date)) return send(res, 400, {error:"date"});
      if(!PDF64(body.data)) return send(res, 400, {error: typeof body.data === "string" && body.data.length > MAXB64 ? "too_big" : "file"});
      const meta = {date: body.date, up: Date.now(), size: Math.round(body.data.length * 3 / 4)};
      const cmds = [["SET", PDOC(c), JSON.stringify(Object.assign({}, meta, {data: body.data}))], ["HSET", PKEY, c, JSON.stringify(meta)]];
      if(rec && rec.st === "sent") cmds.push(["HDEL", KEY, c]);              // era solo mandato: il cliente non lo vede più
      await kv(cmds);
      return send(res, 200, {ok: true, item: meta, cancelled: !!(rec && rec.st === "sent")});
    }
    if(op === "paperdel"){ await kv([["DEL", PDOC(c)], ["HDEL", PKEY, c]]); return send(res, 200, {ok: true}); }
    if(op === "del"){ await kv([["HDEL", KEY, c]]); return send(res, 200, {ok: true}); }
    if(op === "drop"){ await kv([["HDEL", KEY, c], ["DEL", PDOC(c)], ["HDEL", PKEY, c]]); return send(res, 200, {ok: true}); }
    return send(res, 400, {error:"op"});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
