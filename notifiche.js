/* ======================= v105 (11/11): NOTIFICHE SUL TELEFONO DEL TRAINER =======================
   File FACOLTATIVO: se lo togli, il gestionale funziona uguale (sparisce solo il riquadro “🔔 Notifiche sul telefono”).
   - riquadro nella sezione “📱 Visuale cliente”: attiva / prova / disattiva le notifiche su QUESTO telefono
   - le notifiche le manda il server (api/cliente.js → api/_pushlib.js): richieste di accesso e avvisi di sicurezza
   - iPhone: funzionano solo con il gestionale aperto dall'icona sulla schermata Home (iOS 16.4 o più recente)
   - tocco sulla notifica: si apre il gestionale sulla sezione “📱 Visuale cliente” */
(function(){
  "use strict";
  if(typeof sigApi !== "function" || typeof render !== "function") return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const CAN = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let state = "check", busy = false;                       // check | on | off | denied | needhome | nosupport | offline
  const devName = () => IOS ? (/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone") : /Android/.test(navigator.userAgent) ? "Android" : "Computer";
  const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c=>c.charCodeAt(0)); };
  async function current(){ const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
  async function refresh(){
    if(!CAN) state = IOS && !STANDALONE ? "needhome" : "nosupport";
    else if(IOS && !STANDALONE) state = "needhome";
    else if(typeof sigOnline === "function" && !sigOnline()) state = "offline";
    else if(Notification.permission === "denied") state = "denied";
    else { try{ state = Notification.permission === "granted" && await current() ? "on" : "off"; }catch(_){ state = "off"; } }
    paint();
  }
  let rq = 0;
  const later = () => { if(busy) return; clearTimeout(rq); rq = setTimeout(refresh, 150); };   // ricontrollo ogni volta che la sezione compare
  function html(inner){
    if(!inner) later();                                     // (dal gestionale: ricontrollo; da paint: no, altrimenti non finirebbe mai)
    const sub = `<p class="sub">Ti arriva una notifica, anche con l'app chiusa, quando un cliente <b>chiede l'accesso</b> alla sua pagina e per gli <b>avvisi di sicurezza</b>: link aperto da un altro telefono, PIN bloccato, dispositivo tolto che riprova.</p>`;
    let body;
    if(state === "on") body = `<p class="push-ok">✅ Notifiche attive su questo telefono.</p><div class="pv-row push-row"><button type="button" class="btn" data-push="test"${busy ? " disabled" : ""}>📨 Manda una prova</button><button type="button" class="btn ghost" data-push="off"${busy ? " disabled" : ""}>Disattiva</button></div>`;
    else if(state === "off") body = `<div class="pv-row push-row"><button type="button" class="btn primary" data-push="on"${busy ? " disabled" : ""}>🔔 Attiva notifiche su questo telefono</button></div><p class="pv-muted">Il telefono ti chiederà il permesso: premi <b>“Consenti”</b>.</p>`;
    else if(state === "needhome") body = `<p class="push-warn">📲 Su iPhone le notifiche funzionano solo se apri il gestionale dall'<b>icona sulla schermata Home</b>.</p><p class="pv-muted">In Safari premi il tasto Condividi (il quadrato con la freccia), poi <b>“Aggiungi alla schermata Home”</b>. Apri il gestionale da quell'icona e torna qui.</p>`;
    else if(state === "denied") body = `<p class="push-warn">🔕 Le notifiche per il gestionale sono bloccate sul telefono.</p><p class="pv-muted">Per riattivarle: <b>Impostazioni</b> del telefono → <b>Notifiche</b> → <b>Gestionale PT</b> → <b>Consenti notifiche</b>. Poi torna qui.</p>`;
    else if(state === "nosupport") body = `<p class="push-warn">Questo telefono o browser non può ricevere le notifiche. Su iPhone serve iOS 16.4 o più recente.</p>`;
    else if(state === "offline") body = `<p class="pv-muted">Le notifiche funzionano solo con il salvataggio online (sincronizzazione).</p>`;
    else body = `<p class="pv-muted">Controllo…</p>`;
    return `<section class="block pv-sec" id="pushSec"><h2>🔔 Notifiche sul telefono</h2>${sub}${body}</section>`;
  }
  function paint(){
    const el = $("pushSec"); if(!el) return;
    const tmp = document.createElement("div"); tmp.innerHTML = html(true); const n = tmp.firstElementChild;
    el.replaceWith(n); if(typeof LANG !== "undefined" && LANG === "en" && typeof i18nWalk === "function") i18nWalk(n);
  }
  const say = t => { if(typeof toast === "function") toast(t); };
  async function enable(){
    /* il permesso va chiesto SUBITO al tocco (su iPhone altrimenti non compare) */
    let perm; try{ perm = await Notification.requestPermission(); }catch(_){ perm = Notification.permission; }
    if(perm !== "granted"){ await refresh(); if(Notification.permission === "denied") say("Notifiche bloccate: riattivale dalle Impostazioni del telefono"); return; }
    busy = true; paint();
    try{
      const {key} = await sigApi("GET", "api/push?key=1");
      const reg = await navigator.serviceWorker.ready;
      let s = await reg.pushManager.getSubscription();
      if(!s) s = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64u(key)});
      await sigApi("POST", "api/push", {op: "sub", sub: s.toJSON(), name: devName(), lang: typeof LANG !== "undefined" ? LANG : "it"});
      busy = false; await refresh(); say("Notifiche attive su questo telefono");
      try{ await sigApi("POST", "api/push", {op: "test", endpoint: s.endpoint}); }catch(_){}
    }catch(e){ busy = false; await refresh(); say("Non riesco ad attivare le notifiche: controlla la connessione e riprova"); }
  }
  async function disable(){
    busy = true; paint();
    try{ const s = await current(); if(s){ try{ await sigApi("POST", "api/push", {op: "unsub", endpoint: s.endpoint}); }catch(_){} await s.unsubscribe(); } say("Notifiche disattivate su questo telefono"); }
    catch(_){ say("Non riesco a disattivarle: riprova"); }
    busy = false; refresh();
  }
  async function test(){
    busy = true; paint();
    try{ const s = await current(); if(!s){ busy = false; return refresh(); } const r = await sigApi("POST", "api/push", {op: "test", endpoint: s.endpoint});
      say(r && r.sent ? "Notifica di prova inviata: arriva tra pochi secondi" : "Non è arrivata: disattiva e riattiva le notifiche"); }
    catch(_){ say("Non riesco a mandarla: controlla la connessione"); }
    busy = false; paint();
  }
  document.addEventListener("click", e=>{
    const b = e.target.closest("[data-push]"); if(!b || busy) return;
    const a = b.dataset.push;
    if(a === "on") enable(); else if(a === "off") disable(); else if(a === "test") test();
  });
  /* tocco sulla notifica: apri la sezione “📱 Visuale cliente” */
  const openView = () => { const b = $("pvHomeBtn"); if(b){ b.click(); return true; } return false; };
  if(CAN) navigator.serviceWorker.addEventListener("message", e=>{ if(e.data && e.data.open === "visuale") setTimeout(openView, 200); });
  if(location.hash === "#visuale"){ history.replaceState(null, "", location.pathname + location.search); let n = 0; const t = setInterval(()=>{ if(openView() || ++n > 30) clearInterval(t); }, 300); }
  window.PTPush = {html, refresh};
  setTimeout(refresh, 500);
})();
