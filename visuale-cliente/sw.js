/* Pagina del cliente (visuale-cliente/): funziona anche senza internet.
   Vale SOLO per la cartella visuale-cliente (non tocca il gestionale). Le situazioni aggiornate arrivano sempre da internet (/api/). */
const CACHE = "pt-cliente-v102";
const FILES = ["./", "./manifest.webmanifest", "../icon-192.png", "../icon-512.png", "../apple-touch-icon.png", "../favicon-32.png"];
self.addEventListener("install", e=>{
  e.waitUntil((async ()=>{ const c = await caches.open(CACHE); await Promise.all(FILES.map(u=>c.add(u).catch(()=>{}))); await self.skipWaiting(); })());
});
self.addEventListener("activate", e=>{
  e.waitUntil((async ()=>{ for(const k of await caches.keys()) if(k.startsWith("pt-cliente-") && k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin && (url.pathname.includes("/api/") || /gestione\.js$/.test(url.pathname))) return;
  if(req.mode === "navigate"){
    e.respondWith((async ()=>{
      try{
        const fresh = await fetch(req);
        if(fresh && fresh.ok){ const c = await caches.open(CACHE); c.put("./", fresh.clone()); }
        else if(fresh && (fresh.status === 404 || fresh.status === 410)){   // la cartella visuale-cliente è stata eliminata: niente copie vecchie sul telefono
          for(const k of await caches.keys()) if(k.startsWith("pt-cliente-")) await caches.delete(k);
          try{ await self.registration.unregister(); }catch(_){}
        }
        return fresh;
      }
      catch(_){ return (await caches.match("./")) || Response.error(); }
    })());
    return;
  }
  if(/fonts\.googleapis\.com$|fonts\.gstatic\.com$/.test(url.hostname) || url.origin === self.location.origin){
    e.respondWith((async ()=>{
      const c = await caches.open(CACHE), hit = await c.match(req, {ignoreVary:true});
      const net = fetch(req).then(res=>{ if(res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(()=>null);
      return hit || (await net) || Response.error();
    })());
  }
});
