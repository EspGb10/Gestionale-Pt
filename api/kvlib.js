/* Aiuti comuni per le funzioni del gestionale su Vercel.
   Il database è Upstash Redis collegato dal Marketplace di Vercel: le variabili
   KV_REST_API_URL e KV_REST_API_TOKEN (o UPSTASH_REDIS_REST_URL/TOKEN) le mette Vercel da solo.
   La password la scegli tu: variabile APP_PASSWORD nelle impostazioni del progetto. */
const crypto = require("crypto");

const KV_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PASSWORD = () => process.env.APP_PASSWORD || "";
const P = "gpt:";                                   // prefisso delle chiavi nel database
/* recupero password via email (facoltativo): RESEND_API_KEY (da resend.com) e RECOVERY_EMAIL (la tua email) */
const RESEND_KEY = () => process.env.RESEND_API_KEY || "";
const RECOVERY_EMAIL = () => process.env.RECOVERY_EMAIL || "";
const recoveryReady = () => !!(RESEND_KEY() && RECOVERY_EMAIL());

function missing(){
  const m = [];
  if(!KV_URL() || !KV_TOKEN()) m.push("database");
  if(!PASSWORD()) m.push("APP_PASSWORD");
  return m;
}
async function kv(commands){
  const r = await fetch(KV_URL().replace(/\/+$/,"") + "/pipeline", {
    method:"POST", headers:{Authorization:"Bearer " + KV_TOKEN(), "Content-Type":"application/json"},
    body: JSON.stringify(commands)
  });
  if(!r.ok) throw new Error("database " + r.status);
  const out = await r.json();
  return out.map(x=>{ if(x && x.error) throw new Error(x.error); return x ? x.result : null; });
}
/* la chiave d'accesso che resta sul dispositivo: deriva dalla password, cambia se cambi la password */
const tokenFor = pw => crypto.createHash("sha256").update("gestionale-pt:" + pw).digest("hex");
function sameText(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/* chiave valida adesso: quella della password reimpostata via email (salvata nel database come impronta),
   oppure quella di APP_PASSWORD. Se cambi APP_PASSWORD su Vercel, torna a valere quella. */
async function currentToken(){
  const env = tokenFor(PASSWORD());
  try{
    const [raw] = await kv([["GET", P + "pwtoken"]]);
    if(raw){ const o = JSON.parse(raw); if(o && o.token && o.env === env) return o.token; }
  }catch(_){}
  return env;
}
async function authorized(req){
  const h = String(req.headers["authorization"] || "");
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  return !!PASSWORD() && !!t && sameText(t, await currentToken());
}
async function readJson(req){
  if(req.body && typeof req.body === "object") return req.body;
  if(typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}
function send(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
const ipOf = req => String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "?").split(",")[0].trim();

/* Su Vercel ogni file in api/ è anche un indirizzo: questo risponde sempre “non trovato”
   e serve solo come raccolta di aiuti per gli altri file (prima si chiamava _kv.js). */
function notFound(req, res){ res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("not found"); }
module.exports = Object.assign(notFound, {kv, missing, tokenFor, sameText, authorized, currentToken, readJson, send, ipOf, PASSWORD, P, RESEND_KEY, RECOVERY_EMAIL, recoveryReady});
