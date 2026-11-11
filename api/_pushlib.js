/* v105 (11/11): NOTIFICHE sul telefono del trainer (Web Push). File NUOVO, usato da api/push.js e api/cliente.js.
   Il nome inizia con “_”: Vercel non lo pubblica come indirizzo, è solo una libreria.
   Niente librerie esterne: chiavi (VAPID), firma e cifratura del messaggio (RFC 8291, aes128gcm) con il “crypto” di Node.
   Chiavi nel database:
     gpt:push:vapid   -> {pub, jwk}  la coppia di chiavi del gestionale (creata da sola la prima volta, non serve impostare niente su Vercel)
     gpt:push:subs    hash: <impronta> -> {endpoint, keys:{p256dh, auth}, at, name, lang}  i telefoni con le notifiche attive */
const crypto = require("crypto");
const {kv, P} = require("./kvlib");
const VKEY = P + "push:vapid", SKEY = P + "push:subs", MAX_SUBS = 10;
const b64u = b => Buffer.from(b).toString("base64url");
const subId = endpoint => crypto.createHash("sha256").update(String(endpoint)).digest("base64url").slice(0, 32);

/* la coppia di chiavi: si crea una volta sola e resta nel database */
async function vapid(){
  const [raw] = await kv([["GET", VKEY]]);
  if(raw){ try{ const v = JSON.parse(raw); if(v && v.pub && v.jwk) return v; }catch(_){} }
  const {privateKey} = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const jwk = privateKey.export({format: "jwk"});
  const pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
  const v = {pub, jwk};
  const [r] = await kv([["SET", VKEY, JSON.stringify(v), "NX"]]);          // se due richieste arrivano insieme, vince la prima
  if(r === "OK") return v;
  const [again] = await kv([["GET", VKEY]]); return JSON.parse(again);
}
/* firma per il servizio di notifiche (Apple / Google / Mozilla): JWT ES256, vale 12 ore */
function vapidAuth(v, endpoint, contact){
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({typ: "JWT", alg: "ES256"}));
  const body = b64u(JSON.stringify({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact}));
  const key = crypto.createPrivateKey({key: v.jwk, format: "jwk"});
  const sig = crypto.sign("sha256", Buffer.from(head + "." + body), {key, dsaEncoding: "ieee-p1363"});
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}
/* cifratura del messaggio per quel telefono (RFC 8291 + RFC 8188, un solo blocco) */
function encrypt(sub, text){
  const uaPub = Buffer.from(sub.keys.p256dh, "base64url"), auth = Buffer.from(sub.keys.auth, "base64url");
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}
/* manda a un telefono: true = arrivata al servizio, "gone" = telefono non più valido (da togliere) */
async function sendOne(v, sub, note, contact){
  const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), 4000);
  try{
    const r = await fetch(sub.endpoint, {method: "POST", signal: ctl.signal, body: encrypt(sub, JSON.stringify(note)),
      headers: {"TTL": "86400", "Urgency": "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Authorization": vapidAuth(v, sub.endpoint, contact)}});
    if(r.status === 404 || r.status === 410) return "gone";
    return r.ok;
  }catch(_){ return false; }
  finally{ clearTimeout(timer); }
}
async function subs(){
  const [flat] = await kv([["HGETALL", SKEY]]); const out = [];
  for(let i = 0; flat && i < flat.length; i += 2){ try{ const s = JSON.parse(flat[i+1]); if(s && s.endpoint && s.keys) out.push(Object.assign({id: flat[i]}, s)); }catch(_){} }
  return out;
}
/* manda a tutti i telefoni del trainer. note = {it:{title, body}, en:{title, body}, tag, url} */
async function sendAll(note, only){
  let list = await subs(); if(only) list = list.filter(s=>s.endpoint === only);
  if(!list.length) return 0;
  const v = await vapid(), contact = "mailto:notifiche@gestionale-pt.app";
  const res = await Promise.all(list.map(s=>{ const t = note[s.lang === "en" ? "en" : "it"] || note.it; return sendOne(v, s, {title: t.title, body: t.body, tag: note.tag || "", url: note.url || "./"}, contact); }));
  const gone = list.filter((s, i)=>res[i] === "gone").map(s=>s.id);
  if(gone.length) await kv([["HDEL", SKEY, ...gone]]);
  return res.filter(x=>x === true).length;
}
async function addSub(sub, name, lang){
  const id = subId(sub.endpoint), list = await subs(), cmds = [];
  const others = list.filter(s=>s.id !== id).sort((a, b)=>(a.at || 0) - (b.at || 0));
  if(others.length >= MAX_SUBS) cmds.push(["HDEL", SKEY, ...others.slice(0, others.length - MAX_SUBS + 1).map(s=>s.id)]);
  cmds.push(["HSET", SKEY, id, JSON.stringify({endpoint: sub.endpoint, keys: {p256dh: sub.keys.p256dh, auth: sub.keys.auth}, at: Date.now(), name, lang: lang === "en" ? "en" : "it"})]);
  await kv(cmds);
}
const delSub = endpoint => kv([["HDEL", SKEY, subId(endpoint)]]);
module.exports = {vapid, sendAll, addSub, delSub, subs, encrypt, vapidAuth};
