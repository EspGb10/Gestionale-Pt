/* Firme delle sedute (v99). File NUOVO: non cambia data.js, login.js, recover.js, kvlib.js.
   Le firme stanno in chiavi separate, NON nei documenti del gestionale, così il gestionale resta leggero:
     gpt:sig:<cliente>     hash: <id seduta> -> firma (JSON, circa 1 KB)
     gpt:sigtok:<codice>   link per far firmare il cliente sul suo telefono: vale 1 ora e si usa una volta sola
     gpt:sigdone:<codice>  “firmato” per chi aspetta sul telefono del trainer (1 ora)
   Con la password del gestionale (come /api/data):
     GET  /api/firme?client=ID              -> {sigs:[...]}
     POST /api/firme {op:"put",  client, sig}     -> salva o sostituisce una firma
     POST /api/firme {op:"del",  client, ids:[]}  -> cancella
     POST /api/firme {op:"drop", client}          -> cancella tutte le firme del cliente (cartella eliminata)
     POST /api/firme {op:"link", client, sig, info} -> {token, exp}   (sig: dati della seduta senza tratti; info: cosa vede il cliente)
     GET  /api/firme?wait=CODICE           -> {state:"waiting"|"signed"|"expired", sig?}
   Senza password (il cliente, dal link):
     GET  /api/firme?t=CODICE              -> {info}
     POST /api/firme {t:CODICE, s:TRATTI}  -> salva la firma e chiude il link */
const crypto = require("crypto");
const {kv, missing, authorized, readJson, send, ipOf, P} = require("./kvlib");

const TTL = 3600;                                          // il link vale 1 ora
const ID = v => typeof v === "string" && v.length > 0 && v.length <= 120 && !/[\s:]/.test(v);
const TOK = v => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const STROKES = v => typeof v === "string" && v.length >= 8 && v.length <= 24000 && /^[0-9a-z.]+$/.test(v);
const DATE = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
function cleanSig(s, strokesRequired){
  if(!s || typeof s !== "object" || !ID(s.id) || !DATE(s.date)) return null;
  if(strokesRequired && !STROKES(s.s)) return null;
  const o = {id: s.id, date: s.date, time: /^\d{2}:\d{2}$/.test(s.time || "") ? s.time : "", via: s.via === "client" ? "client" : "me",
    pkgStart: DATE(s.pkgStart) ? s.pkgStart : "", single: !!s.single, miss: !!s.miss, t: Date.now()};
  if(s.s !== undefined){ if(!STROKES(s.s)) return null; o.s = s.s; }
  /* chiusura di un pacchetto (id “pkg-…”): l'elenco delle sue sedute, per vedere dopo le firme e le date non firmate */
  if(Array.isArray(s.rows)) o.rows = s.rows.filter(r=>r && ID(r.id) && DATE(r.d)).slice(0, 400).map(r=>({id: r.id, d: r.d, m: r.m ? 1 : 0}));
  if(DATE(s.end)) o.end = s.end;
  if(s.total !== undefined && Number.isFinite(Number(s.total))) o.total = Math.max(0, Math.min(1000, Math.round(Number(s.total))));
  if(s.off !== undefined && Number.isFinite(Number(s.off))) o.off = Math.max(0, Math.min(1000, Math.round(Number(s.off))));
  return o;
}
async function tooMany(req){
  const k = P + "sigfail:" + ipOf(req);
  const [n] = await kv([["GET", k]]);
  return Number(n) >= 30;
}
async function fail(req, res, code, error){
  const k = P + "sigfail:" + ipOf(req);
  try{ await kv([["INCR", k], ["EXPIRE", k, 900]]); }catch(_){}
  return send(res, code, {error});
}

module.exports = async (req, res) => {
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  const q = new URL(req.url, "http://x").searchParams;
  let body = {};
  if(req.method === "POST"){ try{ body = await readJson(req) || {}; }catch(_){ return send(res, 400, {error:"json"}); } }
  try{
    /* ---------- il cliente, dal link (senza password) ---------- */
    const pub = req.method === "GET" ? q.get("t") : body.t;
    if(pub !== null && pub !== undefined){
      if(await tooMany(req)) return send(res, 429, {error:"too_many"});
      if(!TOK(pub)) return fail(req, res, 404, "link");
      const [raw] = await kv([["GET", P + "sigtok:" + pub]]);
      let rec = null; try{ rec = raw ? JSON.parse(raw) : null; }catch(_){}
      if(!rec) return fail(req, res, 410, "expired");
      if(req.method === "GET") return send(res, 200, {info: rec.info || {}, exp: rec.exp});
      if(req.method !== "POST") return send(res, 405, {error:"method"});
      if(!STROKES(body.s)) return send(res, 400, {error:"strokes"});
      const sig = cleanSig(Object.assign({}, rec.sig, {s: body.s, via: "client"}), true);
      if(!sig || !ID(rec.client)) return send(res, 400, {error:"sig"});
      const [del] = await kv([["DEL", P + "sigtok:" + pub]]);           // si usa una volta sola
      if(!Number(del)) return send(res, 410, {error:"expired"});
      await kv([["HSET", P + "sig:" + rec.client, sig.id, JSON.stringify(sig)], ["SET", P + "sigdone:" + pub, JSON.stringify(sig), "EX", TTL]]);
      return send(res, 200, {ok: true});
    }
    /* ---------- il trainer (con la password) ---------- */
    if(!(await authorized(req))) return send(res, 401, {error:"login"});
    if(req.method === "GET"){
      const w = q.get("wait");
      if(w !== null){
        if(!TOK(w)) return send(res, 400, {error:"token"});
        const [done, open] = await kv([["GET", P + "sigdone:" + w], ["EXISTS", P + "sigtok:" + w]]);
        if(done){ let s = null; try{ s = JSON.parse(done); }catch(_){} return send(res, 200, {state:"signed", sig:s}); }
        return send(res, 200, {state: Number(open) ? "waiting" : "expired"});
      }
      const c = q.get("client");
      if(!ID(c)) return send(res, 400, {error:"client"});
      const [flat] = await kv([["HGETALL", P + "sig:" + c]]);
      const sigs = [];
      for(let i = 0; flat && i < flat.length; i += 2){ try{ sigs.push(JSON.parse(flat[i+1])); }catch(_){} }
      return send(res, 200, {sigs});
    }
    if(req.method !== "POST") return send(res, 405, {error:"method"});
    if(!ID(body.client)) return send(res, 400, {error:"client"});
    const key = P + "sig:" + body.client;
    if(body.op === "put"){
      const sig = cleanSig(body.sig, false); if(!sig) return send(res, 400, {error:"sig"});
      await kv([["HSET", key, sig.id, JSON.stringify(sig)]]);
      return send(res, 200, {ok: true, sig});
    }
    if(body.op === "del"){
      const ids = Array.isArray(body.ids) ? body.ids.filter(ID).slice(0, 500) : [];
      if(ids.length) await kv([["HDEL", key, ...ids]]);
      return send(res, 200, {ok: true});
    }
    if(body.op === "drop"){                                  // cartella eliminata: via tutte le sue firme
      await kv([["DEL", key]]);
      return send(res, 200, {ok: true});
    }
    if(body.op === "link"){
      const sig = cleanSig(body.sig, false); if(!sig) return send(res, 400, {error:"sig"});
      delete sig.s;
      const info = body.info && typeof body.info === "object" ? body.info : {};
      const txt = JSON.stringify(info); if(txt.length > 60000) return send(res, 413, {error:"info"});
      const token = crypto.randomBytes(24).toString("base64url"), exp = Date.now() + TTL * 1000;
      await kv([["SET", P + "sigtok:" + token, JSON.stringify({client: body.client, sig, info, exp}), "EX", TTL]]);
      return send(res, 200, {token, exp});
    }
    return send(res, 400, {error:"op"});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
