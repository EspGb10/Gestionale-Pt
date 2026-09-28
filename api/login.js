/* POST /api/login  {password}  ->  {token}
   Dopo 10 tentativi sbagliati in 15 minuti blocca per un po' (contro chi prova a indovinare). */
const {kv, missing, tokenFor, sameText, readJson, send, ipOf, PASSWORD, P} = require("./_kv");

module.exports = async (req, res) => {
  if(req.method !== "POST") return send(res, 405, {error:"method"});
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  let body; try{ body = await readJson(req); }catch(_){ return send(res, 400, {error:"json"}); }
  const failKey = P + "fail:" + ipOf(req);
  try{
    const [fails] = await kv([["GET", failKey]]);
    if(Number(fails) >= 10) return send(res, 429, {error:"too_many"});
    if(!sameText(String(body.password || ""), PASSWORD())){
      await kv([["INCR", failKey], ["EXPIRE", failKey, 900]]);
      return send(res, 401, {error:"wrong_password"});
    }
    await kv([["DEL", failKey]]);
    return send(res, 200, {token: tokenFor(PASSWORD())});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
