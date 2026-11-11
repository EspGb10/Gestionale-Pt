/* ======================= VISUALE CLIENTE (v101) — parte del gestionale =======================
   Modulo FACOLTATIVO: se elimini la cartella visuale-cliente, il gestionale funziona uguale (non mostra più niente di questa funzione).
   Cosa fa:
   - riquadro del dispositivo nella cartella del cliente (in alto a destra di “Pacchetto in corso e pagamenti”)
   - finestra del cliente: QR / Invia link / Copia link, messaggio, sezioni visibili, PIN, consensi, anteprima, Blocca link
   - sezione “📱 Visuale cliente” (tasto nella home): richieste, avvisi, elenco delle pagine, Blocca tutto, attiva / disattiva
   - prepara la situazione del pacchetto e la manda a api/cliente.js a ogni modifica (la pagina del cliente è sempre aggiornata)
   - ogni minuto controlla richieste e avvisi (firme fatte dal cliente, PIN bloccati, tentativi sospetti, richieste di cancellazione)
   Usa le funzioni del gestionale (clients, commit, render, stats, sigActiveRows, …): è caricato dopo lo script principale. */
(function(){
  "use strict";
  if(typeof clients === "undefined" || typeof render !== "function" || typeof commit !== "function") return;
  const $ = id => document.getElementById(id);
  const SECS = [["book", "Prossimi appuntamenti (personal e consulenze)"], ["single", "Sedute singole fatte"], ["prog", "I tuoi progressi (pallini e sedute)"], ["cal", "Calendario presenze"], ["miss", "Lezioni saltate"], ["pay", "Pagamenti e promemoria saldo"], ["goal", "Tessera, status e traguardi"], ["firme", "Firme (vedere e firmare)"]];
  const LAST_KEY = "gpt_pv_last", POLL_MS = 60000, PUSH_MS = 2500;
  let info = {}, infoOk = false, open = false, pollT = 0, lastPoll = 0, polling = false;
  const pushT = {}, toasted = new Set(), knownPend = new Set();
  const off = () => !!settings.viewOff;
  const online = () => (store.mode === "sync" || !!window.__viewTest) && !!sigToken;
  const usable = () => online() && !off();
  const first = c => String(c.name || "").trim().split(/\s+/)[0] || "";
  const nameOf = id => { const c = getClient(id); return c ? c.name : "?"; };
  const lsG = k => { try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(_){ return null; } };
  const lsS = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  const pageUrl = tok => new URL("visuale-cliente/?t=" + encodeURIComponent(tok), location.href).href;
  const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && !a.closest("dialog")); };

  /* ---------- stile (solo di questa funzione) ---------- */
  const css = document.createElement("style");
  css.textContent = `
.pkg-head .dev-row{margin:0;flex:0 1 auto}
.dev-row{display:flex;justify-content:flex-end;margin:0 0 14px}
.dev-card{display:flex;align-items:center;gap:12px;max-width:min(100%,430px);padding:10px 12px 10px 10px;border-radius:16px;background:var(--paper);border:1px solid var(--line);
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 6px 18px -10px rgba(47,107,79,.45);font:inherit;color:var(--pine);text-align:left}
.dev-card.ok,.dev-card.add{cursor:pointer}
.dev-card .dev-ic{flex:0 0 auto;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--moss-soft);color:var(--moss)}
.dev-card .dev-tx{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.dev-card small{font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.dev-card b{font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dev-card .dev-kind{display:flex;align-items:center;flex-wrap:wrap;gap:4px 6px;font-size:.8rem;color:var(--muted);font-weight:600}
.dev-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--moss);margin-left:2px}
.dev-card .dev-act{display:flex;gap:6px;margin-left:6px}
.dev-x{width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:var(--chalk);color:var(--muted);font-size:.95rem;cursor:pointer}
.dev-x:hover{color:var(--danger);border-color:var(--danger)}
.dev-card.add{border-style:dashed;border-color:var(--moss);box-shadow:none;background:transparent}
.dev-card.add b{color:var(--moss)}
.dev-card.pending,.dev-card.warn{border-color:var(--owed);box-shadow:0 0 0 3px rgba(180,83,9,.12)}
.dev-card.pending .dev-ic,.dev-card.warn .dev-ic{background:rgba(180,83,9,.12);color:var(--owed)}
.dev-bad{color:var(--owed);font-weight:700}
@media (max-width:480px){ .dev-row{margin:0 0 14px} .dev-card{width:100%;max-width:none} .dev-card.pending{flex-wrap:wrap} .dev-card.pending .dev-act{margin-left:52px} }
.pv-note{border:1px solid #f0d2b0;background:#fdf3e6;border-radius:14px;padding:12px 14px;margin:0 0 14px}
.pv-note h3{margin:0 0 6px;font-size:1.05rem}
.pv-line{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;padding:8px 0;border-top:1px solid rgba(0,0,0,.06)}
.pv-line:first-of-type{border-top:0}
.pv-line .pv-acts{display:flex;gap:6px;flex-wrap:wrap}
.pv-sec{margin:0 0 16px}
.pv-sec h2{font-size:1.2rem;margin:0 0 8px}
.pv-table{width:100%;border-collapse:collapse}
.pv-table th,.pv-table td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top;font-size:.92rem}
.pv-table th{font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.pv-table .pv-acts{display:flex;gap:6px;flex-wrap:wrap}
.pv-muted{color:var(--muted);font-size:.85rem}
.pv-link{background:none;border:0;padding:0;color:var(--moss);font:inherit;cursor:pointer;text-align:left}
.pv-ok{color:var(--moss);font-weight:700}
.pv-off{opacity:.6}
@media (max-width:640px){ .pv-table thead{display:none} .pv-table tr{display:block;border-bottom:1px solid var(--line);padding:6px 0} .pv-table td{display:block;border:0;padding:3px 0} }
#dlgPV{max-width:560px}
#dlgPV h4{margin:16px 0 6px}
#dlgPV textarea{width:100%;min-height:76px;font:inherit;padding:10px;border-radius:10px;border:1.5px solid var(--line);background:var(--paper);color:var(--pine)}
#dlgPV .pv-secs{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}
@media (max-width:520px){ #dlgPV .pv-secs{grid-template-columns:1fr} }
#dlgPV .pv-row{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
#dlgPV details{margin:10px 0}
#dlgPV summary{cursor:pointer;font-weight:700}
#dlgPVPrev{width:min(430px,96vw);max-width:none;padding:10px}
#dlgPVPrev iframe{width:100%;height:min(76vh,780px);border:1px solid var(--line);border-radius:14px;background:#f2f4f1}
`;
  document.head.appendChild(css);

  /* ---------- finestre ---------- */
  document.body.insertAdjacentHTML("beforeend", `<dialog id="dlgPV" class="sig-dlg"><form method="dialog" id="pvForm"></form></dialog>
<dialog id="dlgPVPrev" class="sig-dlg"><form method="dialog"><button type="submit" value="cancel" formnovalidate class="dlg-x" aria-label="Chiudi" title="Chiudi">✕</button><iframe id="pvFrame" title="Anteprima della visuale cliente"></iframe><div class="dlg-actions"><button class="btn primary" value="cancel">Chiudi anteprima</button></div></form></dialog>`);

  /* ---------- server ---------- */
  async function api(method, qs, body){
    const h = {"Authorization": "Bearer " + sigToken}; if(body) h["Content-Type"] = "application/json";
    const r = await fetch("api/cliente" + (qs || ""), {method, cache: "no-store", headers: h, body: body ? JSON.stringify(body) : undefined});
    if(r.status === 401){ try{ syncAuthLost(); }catch(_){} throw {code: "login"}; }
    if(!r.ok) throw {code: "http", status: r.status};
    return r.json();
  }
  const post = body => api("POST", "", body);
  async function op(body, okMsg){
    try{ const r = await post(body); if(body.client){ if(r.view) info[body.client] = r.view; else if(r.view === null) delete info[body.client]; } refresh(); if(okMsg) toast(okMsg); return r; }
    catch(e){ await messageBox("Non riuscito", e && e.code === "login" ? "Accedi di nuovo e riprova." : "Serve internet: controlla la connessione e riprova."); return null; }
  }

  /* ---------- situazione del pacchetto per la pagina del cliente ---------- */
  function normView(v){
    const o = v && typeof v === "object" ? v : {}, sec = {};
    SECS.forEach(([k])=>{ sec[k] = !(o.sec && o.sec[k] === false); });
    return {msg: String(o.msg || "").slice(0, 300), sec};
  }
  const addD = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function snap(c, upd){
    const v = normView(c.view), has = ptHasCurrent(c), s = stats(c), t = today();
    const past = (c.packages || []).filter(p=>!(typeof isSingle === "function" && isSingle(p))).sort((a, b)=>(b.end || b.start || "").localeCompare(a.end || a.start || ""));
    const last = past[0];
    const o = {v: 1, upd: upd || "", trainer: settings.trainerName || "", first: first(c), msg: v.msg, sec: v.sec, active: ptActive(c), ended: "",
      pkg: null, rows: [], pays: [], allTime: v.sec.goal ? sigAllTime(c) : 0, days: [], old: null,   // (v105: sedute totali e status solo con la sezione traguardi)
      /* appuntamenti dell'agenda (solo promemoria): il cliente vede tipo, giorno e ora — mai se è “singola” o del pacchetto */
      /* tutti quelli dell'ultimo mese (anche passati): la pagina mostra i prossimi e, a richiesta, i passati in grigio */
      book: v.sec.book && typeof normBook === "function" ? normBook(c.book).slice(-60).map(b=>({date: b.date, time: b.time, type: b.type})) : [],
      /* sedute singole fatte (quando non c'era un pacchetto attivo), le più recenti */
      singles: v.sec.single ? (c.packages || []).filter(p=>typeof isSingle === "function" && isSingle(p) && (p.start || p.end)).map(p=>p.start || p.end).sort().reverse().slice(0, 30) : []};
    if(has){
      const {noDate, rows} = sigActiveRows(c);
      o.pkg = {start: s.start || "", total: Number(s.total) || 0, done: Number(s.done) || 0, lost: Number(s.lost) || 0, noDate,
        price: v.sec.pay ? round2(Number(s.price) || 0) : 0, paid: v.sec.pay ? round2(Number(s.paid) || 0) : 0, due: v.sec.pay ? round2(Math.max(0, Number(s.due) || 0)) : 0};
      o.rows = rows.filter(r=>r.date).map(r=>r.miss ? {id: r.id, date: r.date, miss: true} : {id: r.id, date: r.date});
      o.days = o.rows.map(r=>[r.date, r.miss ? "m" : "s"]);
      if(v.sec.pay) o.pays = (c.payLog || []).filter(p=>p && p.date).slice().sort(byDateAsc).map(p=>({date: p.date, amount: round2(Number(p.amount) || 0), method: typeof payMethod === "function" ? payMethod(p.method) : (p.method || "")}));
    } else if(last) o.ended = last.end || t;
    if(last && last.end){
      const until = addD(last.end, has ? 3 : 7);
      if(!has || t <= until){
        const lc = typeof pkgClient === "function" ? pkgClient(c, last) : last, ls = stats(lc);
        o.old = {start: last.start || "", end: last.end, done: Number(ls.done) || 0, total: Number(ls.total) || 0, lost: Number(ls.lost) || 0, until};
      }
    }
    return o;
  }
  /* manda la situazione solo se è cambiata (l'ora “aggiornato il” resta quella dell'ultima modifica vera) */
  async function push(cid, force){
    const c = getClient(cid), v = info[cid];
    if(!c || !v || !v.on || !usable()) return;
    const all = lsG(LAST_KEY) || {}, key = JSON.stringify(snap(c, ""));
    if(!force && all[cid] && all[cid].key === key) return;
    const upd = all[cid] && all[cid].key === key ? all[cid].upd : today() + "T" + sigNowHM();
    try{
      const r = await post({op: "snap", client: cid, snap: snap(c, upd)});
      if(r && r.view) info[cid] = r.view;
      const a2 = lsG(LAST_KEY) || {}; a2[cid] = {key, upd}; lsS(LAST_KEY, a2);
    }catch(_){ /* niente rete: riprovo al prossimo controllo */ }
  }
  function schedule(cid){ if(!info[cid] || !info[cid].on || !usable()) return; clearTimeout(pushT[cid]); pushT[cid] = setTimeout(()=>push(cid), PUSH_MS); }

  /* ---------- controllo ogni minuto: richieste, avvisi, firme del cliente ---------- */
  async function poll(){
    if(!usable() || polling) return;
    polling = true; lastPoll = Date.now();
    try{
      const r = await api("GET", "?list=1");
      info = r.views || {}; infoOk = true;
      const acks = [];
      for(const [cid, v] of Object.entries(info)){
        const c = getClient(cid);
        if(!c) continue;                                                     // (cartella non ancora scaricata su questo dispositivo)
        for(const a of v.alerts || []){
          if(a.k !== "sign") continue;
          if(!toasted.has(a.id)){ toasted.add(a.id); toast(`✅ ${c.name} ha firmato ${a.miss ? "la lezione saltata" : "la seduta"} del ${itDate(a.date)}`); }
          const m = sigMem[cid]; if(m){ if(m.state === "ok") sigLoad(cid, true); else m.state = "stale"; }
          acks.push([cid, a.id]);
        }
        if(v.pending){ const k = cid + "|" + v.pending.at; if(!knownPend.has(k)){ knownPend.add(k); toast(`📱 ${c.name}: nuova richiesta di accesso da “${v.pending.name}”`); } }
        if(v.on) push(cid);
      }
      const by = {}; acks.forEach(([cid, id])=>{ (by[cid] = by[cid] || []).push(id); });
      for(const [cid, ids] of Object.entries(by)){
        try{ const x = await post({op: "ack", client: cid, ids}); if(x && x.view) info[cid] = x.view; }catch(_){}
      }
      refresh();
    }catch(_){ /* niente rete */ }
    finally{ polling = false; }
  }
  function startPoll(){
    clearInterval(pollT);
    pollT = setInterval(()=>{ if(document.visibilityState === "visible" && (Object.keys(info).length || !infoOk)) poll(); }, POLL_MS);
  }
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "visible" && Date.now() - lastPoll > 20000) poll(); });
  window.addEventListener("online", ()=>poll());

  /* aggiorna solo i pezzi della pagina che mostrano la visuale cliente (senza disturbare chi scrive) */
  function refresh(){
    if(!loaded) return;
    if(open && !openId){ if(!typing()) render(); return; }
    if(openId){ const row = $("devRow"), c = getClient(openId); if(row && c){ const tmp = document.createElement("div"); tmp.innerHTML = box(c); if(tmp.firstElementChild) row.replaceWith(tmp.firstElementChild); else row.remove(); } return; }
    if(document.body.dataset.view === "list"){
      const n = $("pvHome"), b = $("pvHomeBtn"), t1 = document.createElement("div");
      t1.innerHTML = homeNotice();
      if(n) n.replaceWith(t1.firstElementChild || document.createTextNode("")); else if(t1.firstElementChild){ const al = document.querySelector("#app .alerts, #app .dash-bar"); if(al) al.before(t1.firstElementChild); }
      if(b){ const t2 = document.createElement("div"); t2.innerHTML = homeBtn(); if(t2.firstElementChild) b.replaceWith(t2.firstElementChild); }
    }
  }

  /* ---------- testi ---------- */
  const DEV_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18.2" r="1.1" fill="currentColor"/><path d="M10 4.6h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const devKind = k => k === "iPhone" || k === "iPad" ? k : k === "Android" ? "Android" : k === "computer" ? "Computer" : "Telefono";   // v103: solo la scritta, senza icona
  function when(ms){
    if(!ms) return ""; const d = new Date(ms); if(isNaN(d)) return "";
    const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
    const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), ds = iso(d), y = iso(new Date(Date.now() - 864e5));
    return (ds === today() ? "oggi" : ds === y ? "ieri" : itDate(ds)) + " alle " + hm;
  }
  function seenText(v){
    if(!v || !v.device) return "";
    if(v.seenAt && v.seenAt >= (v.updAt || 0)) return `✔ visto ${when(v.seenAt)}`;
    return v.seenAt ? `non ha ancora visto l'ultimo aggiornamento (ultimo accesso ${when(v.seenAt)})` : "non ha ancora aperto la pagina";
  }
  const ALERT_TXT = {try: "ha provato ad aprire la pagina con un link non più valido o da un dispositivo tolto", pinlock: "dispositivo bloccato: 5 PIN sbagliati", delreq: "chiede di cancellare i dati della pagina",
    idle: "link spento: non apriva la pagina da 30 giorni (per riattivarla crea un link nuovo)", logout: "ha scollegato il suo dispositivo",
    other: "un altro dispositivo ha provato ad aprire il link (già usato dal telefono del cliente)",
    app: "ha aggiunto la sua pagina alla schermata Home: l'app è attiva con il suo PIN",
    moved: "è rientrato con il suo PIN da un altro browser: quello di prima non funziona più"};   // v105 (11/11)
  /* v104: stato del link quando non c'è ancora un dispositivo */
  const linkState = v => !v ? "" : v.lockWhy === "idle" ? "link spento: 30 giorni senza aprire la pagina" : v.lockWhy === "rejected" ? "richiesta rifiutata: serve un link nuovo"
    : v.on && v.linkOld ? "link scaduto: non usato entro 1 ora" : v.on && !v.bound && v.expAt ? "link valido fino a " + when(v.expAt) : v.on ? "link attivo, in attesa del cliente" : "";
  const alertsOf = v => (v && v.alerts || []).filter(a=>a.k !== "sign" && ALERT_TXT[a.k]);

  /* ---------- riquadro del dispositivo nella cartella ---------- */
  function box(c){
    if(!usable() || !c || c.personal === false) return "";
    const v = info[c.id] || null;
    let inner;
    if(v && v.pending) inner = `<div class="dev-card pending"><span class="dev-ic">${DEV_ICON}</span><span class="dev-tx"><small>Richiesta di accesso</small><b>${esc(v.pending.name)}</b>
        <span class="dev-kind">${devKind(v.pending.kind)} · ${when(v.pending.at)}</span></span>
        <span class="dev-act"><button type="button" class="btn small primary" data-a="pvOk" data-id="${esc(c.id)}">Approva</button><button type="button" class="btn small ghost" data-a="pvNo" data-id="${esc(c.id)}">Rifiuta</button></span></div>`;
    else if(v && v.on && v.device) inner = `<div class="dev-card ok${v.device.blocked ? " warn" : ""}" data-a="pvOpen" data-id="${esc(c.id)}" role="button" tabindex="0" title="Gestisci la visuale cliente"><span class="dev-ic">${DEV_ICON}</span><span class="dev-tx"><small>Dispositivo · ${esc(c.name)}</small><b>${esc(v.device.name)}</b>
        <span class="dev-kind">${devKind(v.device.kind)}${v.app ? `<span class="dev-app"> + app</span>` : ""}<i class="dev-dot" aria-hidden="true"></i>${v.device.blocked ? `<span class="dev-bad">🔒 bloccato (PIN)</span>` : v.device.seen ? "visto " + when(v.device.seen) : "approvato"}</span></span>
        <span class="dev-act"><button type="button" class="dev-x" data-a="pvDel" data-id="${esc(c.id)}" aria-label="Togli il dispositivo" title="Togli il dispositivo">✕</button></span></div>`;
    else inner = `<button type="button" class="dev-card add" data-a="pvOpen" data-id="${esc(c.id)}"><span class="dev-ic">${DEV_ICON}</span><span class="dev-tx"><small>Dispositivo · ${esc(c.name)}</small><b>+ Aggiungi dispositivo</b>${linkState(v) ? `<span class="dev-kind">${esc(linkState(v))}</span>` : ""}</span></button>`;
    return `<div class="dev-row" id="devRow">${inner}</div>`;
  }
  /* ---------- home: tasto e avvisi ---------- */
  function counts(){
    let req = 0, al = 0;
    Object.entries(info).forEach(([cid, v])=>{ if(!getClient(cid)) return; if(v.pending) req++; al += alertsOf(v).length; });
    return {req, al};
  }
  function homeBtn(){
    if(!online()) return "";
    const n = counts(), k = n.req + n.al;
    return `<button class="btn ghost" data-a="pvPage" id="pvHomeBtn">📱 Visuale cliente${!off() && k ? ` <span class="badge">${k}</span>` : ""}</button>`;
  }
  function homeNotice(){
    if(!usable()) return "";
    const lines = [];
    Object.entries(info).forEach(([cid, v])=>{
      const c = getClient(cid); if(!c) return;
      if(v.pending) lines.push(`<div class="pv-line"><span><b>${esc(c.name)}</b> chiede di vedere la sua pagina da “${esc(v.pending.name)}” (${devKind(v.pending.kind)})</span><span class="pv-acts"><button type="button" class="btn small primary" data-a="pvOk" data-id="${esc(cid)}">Approva</button><button type="button" class="btn small ghost" data-a="pvNo" data-id="${esc(cid)}">Rifiuta</button></span></div>`);
      alertsOf(v).forEach(a=>lines.push(`<div class="pv-line"><span><b>${esc(c.name)}</b>: ${esc(ALERT_TXT[a.k])} <span class="pv-muted">(${when(a.at)})</span></span><span class="pv-acts">${a.k === "pinlock" ? `<button type="button" class="btn small primary" data-a="pvUnblock" data-id="${esc(cid)}">Sblocca</button>` : a.k === "delreq" ? `<button type="button" class="btn small" data-a="pvOpen" data-id="${esc(cid)}">Decidi</button>` : ""}<button type="button" class="btn small ghost" data-a="pvAck" data-id="${esc(cid)}" data-al="${esc(a.id)}">Ok, visto</button></span></div>`));
    });
    if(!lines.length) return "";
    return `<section class="pv-note" id="pvHome"><h3>📱 Visuale cliente</h3>${lines.join("")}</section>`;
  }
  /* ---------- sezione “Visuale cliente” ---------- */
  function pageHTML(){
    let h = `<button class="back" data-a="pvClose">‹ Tutte le cartelle</button>
      <div class="stats-head"><h1>📱 Visuale cliente</h1></div>
      <p class="sub">Ogni cliente può avere una pagina sul suo telefono, solo da guardare e sempre aggiornata: sedute, lezioni saltate, pagamenti, traguardi e firme. Il cliente apre il link, scrive il nome del dispositivo e chiede l'accesso: lo approvi tu (massimo 1 dispositivo per cliente), poi sceglie un PIN di 4 cifre. Il link nuovo vale 1 ora: quando il cliente chiede l'accesso resta legato al suo telefono e non scade più (si spegne solo se non apre la pagina per 30 giorni). Per attivarla apri la cartella del cliente e premi <b>+ Aggiungi dispositivo</b>.</p>`;
    if(!online()) return h + `<p class="locked-note">🔒 La visuale cliente funziona solo con il salvataggio online (sincronizzazione tra dispositivi).</p>`;
    if(off()) return h + `<section class="block pv-sec"><h2>Funzione disattivata</h2><p class="sub">Le pagine dei clienti sono spente e nelle cartelle non compare il riquadro del dispositivo.</p><button class="btn primary" data-a="pvOn">Riattiva la visuale cliente</button></section>`;
    const n = counts(), list = Object.entries(info).filter(([cid])=>getClient(cid)).sort((a, b)=>nameOf(a[0]).localeCompare(nameOf(b[0]), "it"));
    const notice = homeNotice();
    h += notice ? notice.replace('id="pvHome"', 'id="pvPageNote"') : `<p class="pv-muted">${infoOk ? "Nessuna richiesta o avviso da vedere." : "Controllo richieste e avvisi…"}</p>`;
    h += `<section class="block pv-sec"><h2>Pagine dei clienti (${list.filter(([, v])=>v.on).length})</h2>`;
    if(!list.length) h += `<p class="sub">Ancora nessuna pagina. Apri la cartella di un cliente e premi <b>+ Aggiungi dispositivo</b>.</p>`;
    else h += `<table class="pv-table"><thead><tr><th>Cliente</th><th>Dispositivo</th><th>Ultimo accesso</th><th></th></tr></thead><tbody>${list.map(([cid, v])=>`<tr class="${v.on ? "" : "pv-off"}">
        <td><button class="pv-link" data-a="open" data-id="${esc(cid)}"><b>${esc(nameOf(cid))}</b></button>${v.locked ? `<br><span class="pv-muted">${v.lockWhy === "idle" ? "link spento: 30 giorni senza aprire la pagina" : v.lockWhy === "rejected" ? "richiesta rifiutata: link non più valido" : "dispositivo tolto: link non più valido"}</span>` : v.on && !v.device && !v.pending && linkState(v) ? `<br><span class="pv-muted">${esc(linkState(v))}</span>` : v.ended ? `<br><span class="pv-muted">pacchetto chiuso il ${itDate(v.ended)}</span>` : ""}</td>
        <td>${v.device ? `${esc(v.device.name)}<br><span class="pv-muted">${devKind(v.device.kind)}${v.device.blocked ? ` · <span class="dev-bad">🔒 bloccato</span>` : ""}</span>` : v.pending ? `<span class="dev-bad">richiesta: ${esc(v.pending.name)}</span>` : `<span class="pv-muted">nessuno</span>`}</td>
        <td>${v.device && v.device.seen ? when(v.device.seen) : "—"}${v.device ? `<br><span class="pv-muted">${esc(seenText(v))}</span>` : ""}</td>
        <td><span class="pv-acts"><button type="button" class="btn small" data-a="pvOpen" data-id="${esc(cid)}">Gestisci</button>${v.on || v.locked ? `<button type="button" class="btn small ghost" data-a="pvBlock" data-id="${esc(cid)}">Blocca link</button>` : ""}</span></td></tr>`).join("")}</tbody></table>`;
    h += `</section>${window.PTPush ? window.PTPush.html() : ""}<section class="block pv-sec"><h2>Emergenza e impostazioni</h2>
      <p class="sub"><b>Blocca tutto</b> spegne subito tutti i link: nessun cliente vede più la sua pagina. Per riattivarla a un cliente premi di nuovo <b>+ Aggiungi dispositivo</b> nella sua cartella (link nuovo).</p>
      <div class="pv-row" style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="btn danger" data-a="pvBlockAll">⛔ Blocca tutto</button><button type="button" class="btn ghost" data-a="pvOff">Disattiva la visuale cliente</button></div>
      <p class="pv-muted">${n.req ? `${n.req} ${n.req === 1 ? "richiesta" : "richieste"} in attesa · ` : ""}Si controlla da sola ogni minuto.</p></section>`;
    return h;
  }

  /* ---------- finestra del cliente ---------- */
  async function dialog(cid){
    let c = getClient(cid); if(!c) return;
    if(!usable()) return messageBox("Visuale cliente", "Serve il salvataggio online (sincronizzazione) e la funzione attiva.");
    let v = info[cid];
    if(!v || !v.on || v.linkOld){                                  // (v104: link non usato entro 1 ora → il server ne crea uno nuovo)
      const r = await op({op: "link", client: cid, trainer: settings.trainerName || "", first: first(c), name: c.name});
      if(!r) return; v = info[cid] = r.view; v.token = r.token;
      push(cid, true);
    } else if(!v.token){
      const r = await op({op: "link", client: cid, trainer: settings.trainerName || "", first: first(c), name: c.name}); if(!r) return; v = info[cid] = Object.assign(r.view || info[cid], {token: r.token});
    }
    const url = pageUrl(v.token), vw = normView(c.view), al = alertsOf(v);
    $("pvForm").innerHTML = `<button type="submit" value="cancel" formnovalidate class="dlg-x" aria-label="Chiudi" title="Chiudi">✕</button><h3>📱 Visuale cliente · ${esc(c.name)}</h3>
      <p class="hint">${v.pending ? `⏳ <b>${esc(v.pending.name)}</b> (${devKind(v.pending.kind)}) chiede l'accesso.` : v.device ? `Dispositivo approvato: <b>${esc(v.device.name)}</b> (${devKind(v.device.kind)})${v.device.blocked ? ` · <span class="dev-bad">🔒 bloccato per troppi PIN sbagliati</span>` : ""}<br>${esc(seenText(v))}` : `Nessun dispositivo: manda il link al cliente. Dovrà chiedere l'accesso e tu lo approvi.<br><b>Il link vale 1 ora${v.expAt ? ` (fino a ${esc(when(v.expAt))})` : ""}</b>: quando il cliente chiede l'accesso resta legato al suo telefono e non scade più.`}</p>
      ${v.pending ? `<div class="pv-row"><button type="button" class="btn primary" data-pv="ok">Approva</button><button type="button" class="btn ghost" data-pv="no">Rifiuta</button></div>` : ""}
      ${v.delreq ? `<div class="pv-note"><b>${esc(c.name)} chiede di cancellare i dati della pagina.</b><p class="pv-muted">Se accetti, la pagina viene spenta e i dati che vedeva il cliente vengono cancellati dal server. Sedute, pagamenti e firme restano nel tuo gestionale.</p><div class="pv-row"><button type="button" class="btn danger" data-pv="erase">Spegni e cancella</button><button type="button" class="btn ghost" data-pv="keep">Tieni la pagina</button></div></div>` : ""}
      ${al.length ? `<div class="pv-note">${al.map(a=>`<div class="pv-line"><span>${esc(ALERT_TXT[a.k])} <span class="pv-muted">(${when(a.at)})</span></span><button type="button" class="btn small ghost" data-pv="ack" data-al="${esc(a.id)}">Ok, visto</button></div>`).join("")}</div>` : ""}
      ${v.device || v.pending ? "" : `<div class="sl-qr" id="pvQr" aria-label="QR code della pagina del cliente"></div>`}
      <div class="sl-btns"><button type="button" class="btn primary" data-pv="send">📤 Invia link</button><button type="button" class="btn ghost" data-pv="copy">📋 Copia link</button></div>
      <input id="pvUrl" class="sl-url" readonly aria-label="Link della pagina del cliente" value="${esc(url)}">
      ${v.bound ? "" : `<div class="pv-row"><button type="button" class="btn small ghost" data-pv="fresh">🔄 Link nuovo (vale 1 ora da adesso)</button></div>`}
      <h4>📢 Avviso per il cliente</h4>
      <p class="hint">Compare in alto nella sua pagina come “Avviso del tuo personal trainer”. Lascia vuoto per non mostrare niente. Il cliente non può rispondere: la pagina è solo da guardare (può solo firmare le sedute non firmate).</p>
      <textarea id="pvMsg" maxlength="300" placeholder="Es. Sabato la palestra è chiusa: la seduta si sposta a lunedì">${esc(vw.msg)}</textarea>
      <h4>Cosa vede il cliente</h4>
      <div class="pv-secs">${SECS.map(([k, l])=>`<label class="check carry"><input type="checkbox" data-sec="${k}"${vw.sec[k] ? " checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
      <div class="pv-row"><button type="button" class="btn" data-pv="preview">👁 Vedi come la vede il cliente</button></div>
      ${v.device ? `<h4>Dispositivo e PIN</h4><div class="pv-row">${v.device.blocked ? `<button type="button" class="btn primary" data-pv="unblock">🔓 Sblocca</button>` : ""}<button type="button" class="btn" data-pv="pin">Azzera il PIN</button><button type="button" class="btn ghost" data-pv="del">✕ Togli il dispositivo</button></div>` : ""}
      <details><summary>Registro dei consensi (${(v.consents || []).length})</summary>${(v.consents || []).length ? `<ul>${v.consents.slice().reverse().map(x=>`<li>${when(x.at)} · “${esc(x.name)}” (${devKind(x.kind)}): ha letto l'informativa e chiesto l'accesso</li>`).join("")}</ul>` : `<p class="pv-muted">Nessuno per ora.</p>`}</details>
      <div class="dlg-actions"><button type="button" class="btn danger" data-pv="block">⛔ Blocca link</button><button class="btn primary" value="cancel">Fatto</button></div>`;
    if($("pvQr")) lib("qrcode").then(q=>{ const qr = q(0, "M"); qr.addData(url); qr.make(); if($("pvQr")) $("pvQr").innerHTML = qr.createSvgTag({cellSize: 5, margin: 3, scalable: true}); })
      .catch(()=>{ if($("pvQr")) $("pvQr").innerHTML = `<p class="none">QR code non disponibile senza internet: usa “Invia link”.</p>`; });
    const dlg = $("dlgPV");
    let next = null;
    const save = () => {
      const cc = getClient(cid); if(!cc) return;
      const nv = {msg: $("pvMsg").value.trim().slice(0, 300), sec: {}};
      dlg.querySelectorAll("[data-sec]").forEach(x=>{ if(!x.checked) nv.sec[x.dataset.sec] = false; });
      const clean = nv.msg || Object.keys(nv.sec).length ? nv : null;
      if(JSON.stringify(clean) === JSON.stringify(cc.view || null)) return;
      const n = Object.assign({}, cc); if(clean) n.view = clean; else delete n.view;
      commit(n, true);
    };
    dlg.onclick = async e=>{
      const b = e.target.closest("[data-pv]"); if(!b) return;
      const w = b.dataset.pv;
      if(w === "copy"){ try{ await navigator.clipboard.writeText(url); toast("Link copiato"); }catch(_){ const i = $("pvUrl"); i.focus(); i.select(); try{ document.execCommand("copy"); toast("Link copiato"); }catch(__){ toast("Tieni premuto il link per copiarlo"); } } return; }
      if(w === "send"){
        const text = `Ciao ${first(getClient(cid)) || ""}! Ecco il link per vedere il tuo percorso (sedute, pagamenti, traguardi e firme): ${url}\nAprilo dal tuo telefono entro 1 ora, scrivi il nome del dispositivo e chiedi l'accesso: lo approvo io.`;
        const touch = matchMedia("(pointer:coarse)").matches;
        try{ if(touch && navigator.share){ await navigator.share({text}); return; } }catch(err){ if(err && err.name === "AbortError") return; }
        const ph = String((getClient(cid) || {}).phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
        const num = ph ? (ph.length === 10 && /^3/.test(ph) ? "39" + ph : ph) : "";
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
        return;
      }
      if(w === "preview"){ save(); return preview(cid); }
      next = w; dlg.close("cancel");
    };
    await ask("dlgPV");
    dlg.onclick = null;
    save();
    if(!next) return;
    if(next === "fresh"){ const r = await op({op: "link", client: cid, fresh: true, trainer: settings.trainerName || "", first: first(getClient(cid) || c), name: (getClient(cid) || c).name}); if(r){ info[cid] = Object.assign(r.view || {}, {token: r.token}); toast("Link nuovo: vale 1 ora"); } return dialog(cid); }
    if(next === "ok") return approve(cid);
    if(next === "no") return op({op: "reject", client: cid}, "Richiesta rifiutata: il link non vale più");
    if(next === "del") return remove(cid);
    if(next === "block") return block(cid);
    if(next === "unblock") return op({op: "unblock", client: cid}, "Dispositivo sbloccato: il cliente può rimettere il suo PIN");
    if(next === "pin"){ if(await messageBox("Azzerare il PIN?", `${c.name} sceglierà un PIN nuovo la prossima volta che apre la pagina.`, {ok: "Azzera il PIN", cancel: "Annulla"})) await op({op: "pinreset", client: cid}, "PIN azzerato"); return dialog(cid); }
    if(next === "ack"){ const ids = al.map(a=>a.id); await op({op: "ack", client: cid, ids}); return dialog(cid); }
    if(next === "keep"){ await op({op: "keep", client: cid}, "Richiesta archiviata: la pagina resta attiva"); return; }
    if(next === "erase"){
      if(!(await messageBox("Spegnere la pagina e cancellare i dati?", "La pagina del cliente viene spenta e i suoi dati vengono cancellati dal server. Sedute, pagamenti e firme restano nel tuo gestionale.", {ok: "Spegni e cancella", cancel: "Annulla", danger: true}))) return;
      const r = await op({op: "block", client: cid}, "Pagina spenta e dati cancellati");
      if(r){ const cc = getClient(cid); if(cc && cc.view){ const n = Object.assign({}, cc); delete n.view; commit(n, true); } render(); }
    }
  }
  async function approve(cid){
    const v = info[cid], c = getClient(cid); if(!v || !v.pending || !c) return;
    if(v.device && !(await messageBox("Sostituire il dispositivo?", `${c.name} può avere un solo dispositivo. Approvando “${v.pending.name}”, “${v.device.name}” non vedrà più la pagina.`, {ok: "Approva e sostituisci", cancel: "Annulla"}))) return;
    await op({op: "approve", client: cid}, `Approvato: ${c.name} ora sceglie il suo PIN`);
  }
  async function remove(cid){
    const v = info[cid], c = getClient(cid); if(!v || !c) return;
    if(!(await messageBox("Togliere il dispositivo?", `${c.name} non potrà più vedere la pagina${v.device ? ` su “${v.device.name}”` : ""} e nessuno potrà chiedere di nuovo l'accesso con questo link. Per ridargli l'accesso premi “+ Aggiungi dispositivo”: verrà creato un link nuovo da mandargli.`, {ok: "Togli il dispositivo", cancel: "Annulla", danger: true}))) return;
    await op({op: "remove", client: cid}, "Dispositivo tolto: il link non vale più");
  }
  async function block(cid){
    const c = getClient(cid);
    if(!(await messageBox("Bloccare il link?", `La pagina di ${c ? c.name : "questo cliente"} si spegne subito e il link non vale più. Per riattivarla premi “+ Aggiungi dispositivo” (link nuovo).`, {ok: "Blocca link", cancel: "Annulla", danger: true}))) return;
    const r = await op({op: "block", client: cid}, "Link bloccato");
    if(r){ delete info[cid]; const all = lsG(LAST_KEY) || {}; delete all[cid]; lsS(LAST_KEY, all); refresh(); }
  }
  async function blockAll(ask2){
    if(ask2 && !(await messageBox("Bloccare tutti i link?", "Tutte le pagine dei clienti si spengono subito. Per riattivarne una premi “+ Aggiungi dispositivo” nella cartella del cliente.", {ok: "Blocca tutto", cancel: "Annulla", danger: true}))) return false;
    try{ await post({op: "blockall"}); }catch(e){ await messageBox("Non riuscito", "Serve internet: controlla la connessione e riprova."); return false; }
    info = {}; lsS(LAST_KEY, {}); refresh(); return true;
  }
  /* anteprima: la stessa pagina del cliente, con i dati di adesso */
  async function preview(cid){
    const c = getClient(cid); if(!c) return;
    const d = snap(c, today() + "T" + sigNowHM()), sigs = {};
    if(d.sec.firme){ const map = await sigEnsure(cid, 4000); if(map) d.rows.forEach(r=>{ const g = map.get(r.id); if(g && g.s) sigs[r.id] = {s: g.s}; }); }
    const fr = $("pvFrame");
    const feed = () => { try{ if(fr.contentWindow && fr.contentWindow.__preview){ fr.contentWindow.__preview(d, sigs); return true; } }catch(_){} return false; };
    const onMsg = e => { if(e.data && e.data.ptPreviewReady) feed(); };
    window.addEventListener("message", onMsg);
    fr.onload = () => { setTimeout(feed, 50); };
    fr.src = "visuale-cliente/?preview=1";
    await ask("dlgPVPrev");
    window.removeEventListener("message", onMsg); fr.src = "about:blank";
  }

  /* ---------- tasti ---------- */
  async function act(a, el){
    const cid = (el && el.dataset && el.dataset.id) || openId;
    switch(a){
      case "pvPage": open = true; render(); window.scrollTo({top: 0}); poll(); return;
      case "pvClose": open = false; render(); window.scrollTo({top: 0}); return;
      case "pvOpen": return dialog(cid);
      case "pvOk": return approve(cid);
      case "pvNo": return op({op: "reject", client: cid}, "Richiesta rifiutata: il link non vale più");
      case "pvDel": return remove(cid);
      case "pvBlock": return block(cid);
      case "pvUnblock": return op({op: "unblock", client: cid}, "Dispositivo sbloccato");
      case "pvAck": return op({op: "ack", client: cid, ids: [el.dataset.al]});
      case "pvBlockAll": return blockAll(true);
      case "pvOff":
        if(!(await messageBox("Disattivare la visuale cliente?", "Tutte le pagine dei clienti si spengono e nelle cartelle non compare più il riquadro del dispositivo. Puoi riattivarla quando vuoi da qui.", {ok: "Disattiva", cancel: "Annulla", danger: true}))) return;
        if(!(await blockAll(false))) return;
        settings.viewOff = true; await saveSettings(); render(); toast("Visuale cliente disattivata"); return;
      case "pvOn": settings.viewOff = false; await saveSettings(); render(); poll(); toast("Visuale cliente attiva"); return;
    }
  }
  /* il riquadro “visto … / approvato” si apre anche con Invio */
  document.addEventListener("keydown", e=>{ const t = e.target; if((e.key === "Enter" || e.key === " ") && t && t.classList && t.classList.contains("dev-card") && t.dataset.a === "pvOpen" && t.tagName !== "BUTTON"){ e.preventDefault(); t.click(); } });

  window.PTView = {
    box, homeBtn, homeNotice, pageHTML, act,
    pageOpen: () => open,
    changed: c => { if(c && c.id) schedule(c.id); },
    dropped: id => { if(info[id] && usable()){ post({op: "block", client: id}).catch(()=>{}); delete info[id]; } },
    wiped: () => { if(Object.keys(info).length && usable()) post({op: "blockall"}).catch(()=>{}); info = {}; },
    _poll: poll, _info: () => info, _snap: snap
  };
  /* avvio: appena il gestionale è collegato al salvataggio online */
  startPoll();
  const kick = setInterval(()=>{ if(loaded && online()){ clearInterval(kick); poll(); } }, 500);
  if(loaded) render();
})();
