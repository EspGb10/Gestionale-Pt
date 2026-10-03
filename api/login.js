/* POST /api/login  {password}  ->  {token}
   Dopo 10 tentativi sbagliati in 15 minuti blocca per un po' (contro chi prova a indovinare). */
const {kv, missing, tokenFor, sameText, currentToken, readJson, send, ipOf, P} = require("./kvlib");

module.exports = async (req, res) => {
  if(req.method !== "POST") return send(res, 405, {error:"method"});
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  let body; try{ body = await readJson(req); }catch(_){ return send(res, 400, {error:"json"}); }
  const failKey = P + "fail:" + ipOf(req);
  try{
    const [fails] = await kv([["GET", failKey]]);
    if(Number(fails) >= 10) return send(res, 429, {error:"too_many"});
    const tok = await currentToken();                      // password di Vercel oppure quella reimpostata via email
    if(!sameText(tokenFor(String(body.password || "")), tok)){
      await kv([["INCR", failKey], ["EXPIRE", failKey, 900]]);
      return send(res, 401, {error:"wrong_password"});
    }
    await kv([["DEL", failKey]]);
    return send(res, 200, {token: tok});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
