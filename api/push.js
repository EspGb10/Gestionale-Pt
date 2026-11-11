/* v105 (11/11): NOTIFICHE sul telefono del trainer. File NUOVO. Solo con la password del gestionale.
     GET  /api/push?key=1                         -> {key}  chiave pubblica (per attivare le notifiche sul telefono)
     POST {op:"sub", sub:{endpoint, keys:{p256dh, auth}}, name, lang}   attiva le notifiche su questo telefono
     POST {op:"unsub", endpoint}                  le spegne su questo telefono
     POST {op:"test", endpoint}                   notifica di prova su questo telefono
   Le notifiche vere le manda api/cliente.js (richieste di accesso e avvisi di sicurezza). */
const {missing, authorized, readJson, send} = require("./kvlib");
const push = require("./_pushlib");
const B64U = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);
const URLOK = v => { try{ const u = new URL(v); return u.protocol === "https:" && v.length <= 1000; }catch(_){ return false; } };

module.exports = async (req, res) => {
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  if(!(await authorized(req))) return send(res, 401, {error:"auth"});
  try{
    const q = new URL(req.url, "http://x").searchParams;
    if(req.method === "GET"){
      if(q.get("key") !== null){ const v = await push.vapid(); return send(res, 200, {key: v.pub}); }
      if(q.get("list") !== null){ const l = await push.subs(); return send(res, 200, {n: l.length, phones: l.map(s=>({name: s.name || "", at: s.at || 0}))}); }
      return send(res, 400, {error:"what"});
    }
    if(req.method !== "POST") return send(res, 405, {error:"method"});
    let body = {}; try{ body = await readJson(req) || {}; }catch(_){ return send(res, 400, {error:"json"}); }
    const op = body.op;
    if(op === "sub"){
      const s = body.sub || {};
      if(!URLOK(s.endpoint) || !s.keys || !B64U(s.keys.p256dh, 80, 100) || !B64U(s.keys.auth, 16, 30)) return send(res, 400, {error:"sub"});
      await push.addSub(s, String(body.name || "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40), body.lang);
      return send(res, 200, {ok: true});
    }
    if(op === "unsub"){ if(!URLOK(body.endpoint)) return send(res, 400, {error:"endpoint"}); await push.delSub(body.endpoint); return send(res, 200, {ok: true}); }
    if(op === "test"){
      if(typeof body.endpoint !== "string" || body.endpoint.length > 1000) return send(res, 400, {error:"endpoint"});   // (va solo ai telefoni già salvati)
      const n = await push.sendAll({it: {title: "🔔 Notifiche attive", body: "Da ora ti arrivano qui le richieste di accesso e gli avvisi di sicurezza della visuale cliente."},
        en: {title: "🔔 Notifications on", body: "From now on you'll get access requests and security alerts from the client view here."}, tag: "test", url: "./"}, body.endpoint);
      return send(res, 200, {ok: true, sent: n});
    }
    return send(res, 400, {error:"op"});
  }catch(e){ return send(res, 500, {error:"server"}); }
};
