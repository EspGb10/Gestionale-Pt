/* Recupero password via email.
   POST /api/recover {action:"request"}                  -> manda alla tua email (RECOVERY_EMAIL) un link valido 30 minuti
   POST /api/recover {action:"reset", code, password}    -> imposta la nuova password (il link vale una volta sola)
   Serve un account gratuito su resend.com: variabili RESEND_API_KEY e RECOVERY_EMAIL nelle impostazioni del progetto. */
const crypto = require("crypto");
const {kv, missing, tokenFor, sameText, readJson, send, ipOf, PASSWORD, P, RESEND_KEY, RECOVERY_EMAIL, recoveryReady} = require("./kvlib");
const sha = s => crypto.createHash("sha256").update("gestionale-pt-reset:" + s).digest("hex");
const mask = e => String(e).replace(/^(.)(.*)(.@.*)$/, (m, a, b, c)=>a + "*".repeat(Math.min(b.length, 6)) + c);
const RESET = P + "reset", WAIT = P + "resetwait", TRIES = P + "resettries";

module.exports = async (req, res) => {
  if(req.method !== "POST") return send(res, 405, {error:"method"});
  const miss = missing();
  if(miss.length) return send(res, 503, {error:"setup", missing:miss});
  let body; try{ body = await readJson(req); }catch(_){ return send(res, 400, {error:"json"}); }
  try{
    if(body.action === "request"){
      if(!recoveryReady()) return send(res, 503, {error:"not_configured"});
      const [wait] = await kv([["GET", WAIT]]);
      if(wait) return send(res, 429, {error:"wait", to: mask(RECOVERY_EMAIL())});
      const code = crypto.randomBytes(24).toString("hex");
      await kv([["SET", RESET, sha(code), "EX", 1800], ["SET", WAIT, "1", "EX", 120], ["DEL", TRIES]]);
      const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
      const proto = req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
        : (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");          // su Vercel è sempre https
      const link = `${proto}://${host}/?reset=${code}`;
      const r = await fetch("https://api.resend.com/emails", {
        method:"POST", headers:{Authorization:"Bearer " + RESEND_KEY(), "Content-Type":"application/json"},
        body: JSON.stringify({
          from: process.env.RECOVERY_FROM || "Gestionale PT <onboarding@resend.dev>",
          to: [RECOVERY_EMAIL()],
          subject: "Gestionale PT: imposta una nuova password",
          html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1C2B24">
            <h2 style="margin:0 0 12px">Gestionale PT</h2>
            <p>Hai chiesto di reimpostare la password del gestionale.</p>
            <p><a href="${link}" style="display:inline-block;background:#2F6B4F;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Imposta una nuova password</a></p>
            <p style="color:#5E6B64;font-size:14px">Il link vale <b>30 minuti</b> e si può usare una volta sola.<br>Se non sei stato tu, ignora questa email: la password resta quella di prima.</p></div>`,
          text: `Gestionale PT\n\nHai chiesto di reimpostare la password. Apri questo link entro 30 minuti:\n${link}\n\nSe non sei stato tu, ignora questa email.`
        })
      });
      if(!r.ok){ await kv([["DEL", RESET, WAIT]]); return send(res, 502, {error:"email", detail:"invio " + r.status}); }
      return send(res, 200, {ok:true, to: mask(RECOVERY_EMAIL())});
    }
    if(body.action === "reset"){
      const code = String(body.code || ""), pw = String(body.password || "");
      if(pw.length < 6) return send(res, 400, {error:"short"});
      const [saved, tries] = await kv([["GET", RESET], ["GET", TRIES]]);
      if(!saved || Number(tries) >= 5) return send(res, 400, {error:"expired"});
      if(!code || !sameText(sha(code), saved)){
        await kv([["INCR", TRIES], ["EXPIRE", TRIES, 1800]]);
        return send(res, 400, {error:"invalid"});
      }
      const token = tokenFor(pw);
      await kv([["SET", P + "pwtoken", JSON.stringify({token, env: tokenFor(PASSWORD()), t: Date.now()})], ["DEL", RESET, TRIES], ["DEL", P + "fail:" + ipOf(req)]]);
      return send(res, 200, {ok:true, token});
    }
    return send(res, 400, {error:"action"});
  }catch(e){ return send(res, 502, {error:"database", detail:String(e.message || e)}); }
};
