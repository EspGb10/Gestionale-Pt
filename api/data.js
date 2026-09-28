/* I dati del gestionale: un documento per cliente, più le impostazioni.
   GET  /api/data?ping=1        -> controlla che tutto sia configurato
   GET  /api/data?since=REV     -> i documenti cambiati dopo REV
   POST /api/data {ops:[{id, data|null}]} -> salva (data) o elimina (null) */
const {kv, missing, authorized, readJson, send, P} = require("./_kv");
const REV = P + "rev", DOCS = P + "docs";

module.exports = async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  if(req.method === "GET" && q.get("ping")){
    const miss = missing();
    return send(res, 200, {ok:true, app:"gestionale-pt", configured: miss.length === 0, missing: miss});
  }
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  if(!authorized(req)) return send(res, 401, {error:"login"});
  try{
    if(req.method === "GET"){
      const since = Number(q.get("since")) || 0;
      const [rev] = await kv([["GET", REV]]);
      const now = Number(rev) || 0;
      if(since && since >= now) return send(res, 200, {rev: now, docs:{}});
      const [flat] = await kv([["HGETALL", DOCS]]);
      const docs = {};
      for(let i = 0; flat && i < flat.length; i += 2){
        let d; try{ d = JSON.parse(flat[i+1]); }catch(_){ continue; }
        if(!since || (d.rev || 0) > since) docs[flat[i]] = d;
      }
      return send(res, 200, {rev: now, docs});
    }
    if(req.method === "POST"){
      const body = await readJson(req);
      const ops = Array.isArray(body.ops) ? body.ops.filter(o=>o && typeof o.id === "string" && o.id && o.id.length <= 120) : [];
      if(!ops.length) return send(res, 400, {error:"ops"});
      if(ops.length > 200) return send(res, 413, {error:"too_many_ops"});
      const [top] = await kv([["INCRBY", REV, ops.length]]);
      const first = Number(top) - ops.length + 1, fields = [], revs = {};
      ops.forEach((o, i)=>{
        const rev = first + i; revs[o.id] = rev;
        const doc = o.data === null || o.data === undefined ? {rev, deleted:true, t:Date.now()} : {rev, data:o.data, t:Date.now()};
        fields.push(o.id, JSON.stringify(doc));
      });
      await kv([["HSET", DOCS, ...fields]]);
      return send(res, 200, {rev: Number(top), revs});
    }
    return send(res, 405, {error:"method"});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
