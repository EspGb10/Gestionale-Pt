/* Gestionale PT: funziona anche senza internet.
   Quando pubblichi una versione nuova, cambia il numero qui sotto (v1 -> v2). */
const CACHE = "gestionale-pt-v65";
const SHELL = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./favicon-32.png"];
/* librerie per Word e PDF e caratteri: se possibile le salvo subito, così funzionano offline */
const EXTRA = [
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Barlow:wght@400;500;600&display=swap"
];
self.addEventListener("install", e=>{
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.all(EXTRA.map(u=>c.add(new Request(u, {mode:"no-cors"})).catch(()=>{})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e=>{
  e.waitUntil((async ()=>{
    for(const k of await caches.keys()) if(k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin && url.pathname.includes("/api/")) return;   // il database: sempre dalla rete, mai dalla memoria
  // la pagina: prima internet (così gli aggiornamenti arrivano subito), se manca la copia salvata
  if(req.mode === "navigate"){
    e.respondWith((async ()=>{
      try{
        const fresh = await fetch(req);
        const c = await caches.open(CACHE); c.put("./index.html", fresh.clone());
        return fresh;
      }catch(_){
        return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }
  // librerie e caratteri esterni: la copia salvata, altrimenti internet (e la salvo)
  if(/(^|\.)cdnjs\.cloudflare\.com$|fonts\.googleapis\.com$|fonts\.gstatic\.com$/.test(url.hostname)){
    e.respondWith((async ()=>{
      const hit = await caches.match(req, {ignoreVary:true}) || await caches.match(req.url, {ignoreVary:true});
      if(hit) return hit;
      try{
        const res = await fetch(req);
        const c = await caches.open(CACHE); c.put(req, res.clone());
        return res;
      }catch(_){ return Response.error(); }
    })());
    return;
  }
  // file dell'app (icone, manifest): la copia salvata, e intanto la aggiorno
  if(url.origin === self.location.origin){
    e.respondWith((async ()=>{
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then(res=>{ if(res && res.ok) c.put(req, res.clone()); return res; }).catch(()=>null);
      return hit || (await net) || Response.error();
    })());
  }
});
