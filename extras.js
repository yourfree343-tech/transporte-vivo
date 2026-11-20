// Transporte Vivo — extras: líneas en el mapa, avisos, favoritas, "cómo llegar" e instalación como app.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
  #actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 4px}
  .act{display:flex;align-items:center;gap:10px;height:54px;padding:0 14px;border-radius:16px;border:0;background:var(--card2);font:600 15px var(--font);cursor:pointer;text-align:left}
  .act span{font-size:20px} .act b{display:block;font:500 12px var(--font);color:var(--dim)}
  .act.warn{background:rgba(245,158,11,.14)} .act.warn b{color:#b45309}
  .fav{border-radius:16px;background:var(--card2);padding:10px 12px;margin:8px 0;cursor:pointer}
  .fav h4{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between;gap:8px}
  .fav .mini{display:flex;gap:8px;align-items:center;font-size:14px;padding:3px 0}
  .fav .mini .tm{font:700 14px var(--mono);min-width:46px}
  .fav .mini .hd{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .star{flex:none;width:36px;height:36px;border-radius:50%;border:0;background:var(--card2);font-size:18px;cursor:pointer}
  .star.on{background:rgba(245,158,11,.18)}
  .alert{background:rgba(245,158,11,.12);border-left:4px solid #f59e0b;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14px;line-height:1.45}
  .alert b{display:block;margin-bottom:2px}
  .alert .chips{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
  .plan label{display:block;font:600 12px var(--font);color:var(--dim);margin:10px 2px 4px}
  .plan .inp{position:relative}
  .plan input{width:100%;height:48px;border-radius:14px;border:1.5px solid var(--line);background:var(--card2);color:var(--txt);padding:0 14px;font:16px var(--font);outline:0}
  .plan input:focus{border-color:var(--acc)}
  .plan .sug{position:absolute;z-index:5;left:0;right:0;top:52px;background:var(--card);border-radius:14px;box-shadow:var(--shadow);max-height:240px;overflow:auto;display:none}
  .plan .sug div{padding:12px 14px;cursor:pointer;font-size:15px;border-bottom:1px solid var(--line)}
  .plan .swap{display:block;margin:8px auto 0;border:0;background:var(--card2);border-radius:12px;height:36px;padding:0 14px;cursor:pointer;font:600 14px var(--font)}
  .trip{display:flex;align-items:center;gap:10px;min-height:60px;border-bottom:1px solid var(--line);cursor:pointer}
  .trip .t{font:700 16px var(--mono);white-space:nowrap} .trip .t small{display:block;font:500 12px var(--font);color:var(--dim)}
  .trip .mid{flex:1;min-width:0;font-size:14px} .trip .mid div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .banner{display:flex;gap:10px;align-items:center;background:linear-gradient(135deg,rgba(14,165,107,.14),rgba(8,145,178,.14));border-radius:16px;padding:12px 14px;margin:0 0 10px;font-size:14px;line-height:1.4}
  .banner button{border:0;background:var(--acc);color:#fff;border-radius:12px;height:38px;padding:0 14px;font:700 14px var(--font);cursor:pointer;flex:none}
  .banner .x{width:30px;height:30px;font-size:13px;background:transparent}
  `;
  document.head.appendChild(css);

  // ======================= LÍNEAS EN EL MAPA =======================
  map.createPane('lines'); map.getPane('lines').style.zIndex = 350;
  const lineRenderer = L.canvas({ pane: 'lines', padding: 0.5 });
  const netLayer = L.layerGroup().addTo(map), hiLayer = L.layerGroup().addTo(map);
  const lineData = new Map(); // fid -> Promise<{rid:[[lat,lon]]}>
  const loadLines = fid => {
    const f = feeds.get(fid); if (!f || !f.timetable) return Promise.resolve(null);
    const src = f.timetable.source || fid;
    if (!lineData.has(fid)) lineData.set(fid, fetch(`data/${src}/lines.json`).then(r => r.ok ? r.json() : null).catch(() => null));
    return lineData.get(fid);
  };
  const routeColor = (fid, rid) => { const r = TT.route(fid, rid); return (r && r[2]) || feeds.get(fid).color; };
  async function drawNetwork() {
    netLayer.clearLayers();
    const drawn = new Set();
    for (const [fid, f] of feeds) {
      if (!f.on || f.type === 'bus' || !f.timetable) continue;
      const src = f.timetable.source || fid; if (drawn.has(src)) continue; drawn.add(src);
      const lines = await loadLines(fid); if (!lines || !f.on) continue;
      for (const rid in lines) if (!(onlyFav && FAVL.length) || isFavLine(lineKey(fid, rid))) L.polyline(lines[rid], { renderer: lineRenderer, color: routeColor(fid, rid), weight: f.type === 'alta-velocidad' ? 2 : 3, opacity: f.type === 'alta-velocidad' ? 0.35 : 0.55, interactive: false }).addTo(netLayer);
    }
  }
  let hiKey = '';
  async function highlight(fid, rid) {
    const key = fid + '|' + rid; if (key === hiKey) return; hiKey = key; hiLayer.clearLayers();
    if (!fid || rid == null) return;
    const lines = await loadLines(fid); if (!lines || !lines[rid] || hiKey !== key) return;
    const c = routeColor(fid, rid);
    L.polyline(lines[rid], { renderer: lineRenderer, color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(hiLayer);
    L.polyline(lines[rid], { renderer: lineRenderer, color: c, weight: 5, opacity: 1, interactive: false }).addTo(hiLayer);
  }
  const clearHi = () => { hiKey = ''; hiLayer.clearLayers(); };
  // redibujar la red cuando cambian filtros o llegan horarios
  let netSig = '';
  setInterval(() => {
    const sig = [...feeds.values()].map(f => f.on ? 1 : 0).join('') + ':' + [...feeds.keys()].filter(k => TT.stopsOf(k)).length + ':' + onlyFav + FAVL.map(x => x.k).join(',');
    if (sig !== netSig) { netSig = sig; drawNetwork(); }
  }, 1500);

  // ======================= AVISOS =======================
  let ALERTS = []; // {feed, id, head, text, routes, stops}
  async function pollAlerts() {
    const all = [];
    for (const f of feeds.values()) {
      if (!f.alerts) continue;
      try { (await FeedsClient.alerts(f)).forEach(a => all.push({ ...a, feed: f.id })); } catch (e) {}
    }
    ALERTS = all; renderActions();
  }
  setTimeout(pollAlerts, 2500); setInterval(pollAlerts, 120000);
  let alertFav = (() => { try { return localStorage.getItem('tv-alertfav') !== '0'; } catch { return true; } })();
  const hasFavs = () => FAVL.length > 0 || FAVS.length > 0;
  const alertIsMine = a => a.routes.some(r => isFavLine(lineKey(a.feed, r))) || a.stops.some(sid => FAVS.some(x => x.feed === a.feed && x.sid === sid));
  const visibleAlerts = () => (alertFav && hasFavs()) ? ALERTS.filter(alertIsMine) : ALERTS;
  const alertsFor = (fid, rid, sid) => ALERTS.filter(a => a.feed === fid && ((rid && a.routes.includes(rid)) || (sid && a.stops.includes(sid))));
  const alertHTML = a => {
    const chips = [...new Set(a.routes)].slice(0, 8).map(r => chip(a.feed, r)).join('');
    const txt = esc(a.text).replace(/^(#\w+\s*)+/, '');
    return `<div class="alert">${a.head ? `<b>${esc(a.head)}</b>` : ''}${txt}${chips ? `<div class="chips">${chips}</div>` : ''}</div>`;
  };
  function openAlerts() {
    selected = null; selStation = null; follow = false; clearHi();
    showHome(false); $('body').scrollTop = 0; if (SHEET.state !== 'full') SHEET.set('full');
    const d = $('detail');
    const list = visibleAlerts();
    const groups = {};
    for (const a of list) { const tag = (a.text.match(/^#(\w+)/) || [, 'Renfe'])[1].replace(/^(Mad|Bcn|Rod|Val|Sev|Mal|Bil|Ast|San|Mur|Zar|Cad|Sss)(.*)$/i, (m, x) => ({ mad: 'Madrid', bcn: 'Barcelona', rod: 'Rodalies', val: 'Valencia', sev: 'Sevilla', mal: 'Málaga', bil: 'Bilbao', ast: 'Asturias', san: 'Santander', mur: 'Murcia', zar: 'Zaragoza', cad: 'Cádiz', sss: 'San Sebastián' })[x.toLowerCase()] || x); (groups[tag] = groups[tag] || []).push(a); }
    const toggle = hasFavs() ? `<div class="feed ${alertFav ? 'on' : ''}" id="alertFavRow"><span class="ic" style="background:rgba(245,158,11,.18)">⭐</span><div class="nm">Solo mis favoritas<em>${alertFav ? `Avisos de tus líneas y estaciones (${list.length} de ${ALERTS.length})` : `Todos los avisos (${ALERTS.length})`}</em></div><span class="sw"></span></div>` : `<p class="muted">Guarda líneas o estaciones como favoritas para ver solo sus avisos.</p>`;
    d.innerHTML = `<div class="dh"><h2>⚠️ Avisos (${list.length})</h2><button class="x" id="closeBtn">✕</button></div><div class="sub">Incidencias y cambios de servicio publicados por Renfe</div>` + toggle +
      (list.length ? Object.keys(groups).sort().map(g => `<div class="sect">${esc(g)} · ${groups[g].length}</div>` + groups[g].map(alertHTML).join('')).join('') : `<p class="muted">${alertFav && hasFavs() ? 'Ningún aviso afecta ahora a tus líneas ni estaciones favoritas. 👍' : 'No hay avisos ahora mismo.'}</p>`);
    $('closeBtn').onclick = () => select(null);
    const tr = $('alertFavRow'); if (tr) tr.onclick = () => { alertFav = !alertFav; try { localStorage.setItem('tv-alertfav', alertFav ? '1' : '0'); } catch {} renderActions(); openAlerts(); };
  }

  // ======================= FAVORITAS =======================
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem('tv-favs') || '[]'); } catch { return []; } };
  let FAVS = loadFavs();
  const saveFavs = () => { try { localStorage.setItem('tv-favs', JSON.stringify(FAVS)); } catch {} };
  const isFav = (fid, sid) => FAVS.some(x => x.feed === fid && x.sid === sid);
  async function renderFavs() {
    const box = $('favs'); if (!box) return;
    if (!FAVS.length) { box.innerHTML = ''; return; }
    const now = nowSec();
    const cards = await Promise.all(FAVS.map(async fv => {
      if (!feeds.has(fv.feed)) return '';
      const deps = (await TT.departures(fv.feed, fv.sid)) || [];
      const next = deps.map(([t, tid, rid, hd]) => { const tu = TT.delay(fv.feed, tid); return { t, rid, hd, d: tu ? tu.delay : null }; }).filter(x => x.t + (x.d || 0) >= now - 30).slice(0, 3);
      return `<div class="fav" data-f="${fv.feed}" data-s="${esc(fv.sid)}"><h4><span>⭐ ${esc(fv.name)}</span><span class="muted">${ICON[feeds.get(fv.feed).type] || ''}</span></h4>` +
        (next.length ? next.map(x => `<div class="mini"><span class="tm">${fmtT(x.t)}</span>${chip(fv.feed, x.rid)}<span class="hd">${esc(x.hd)}</span>${x.d != null ? delayTxt(x.d) : ''}</div>`).join('') : `<div class="muted">${TT.stopsOf(fv.feed) ? 'Sin más salidas hoy' : 'Cargando…'}</div>`) + `</div>`;
    }));
    box.innerHTML = `<div class="sect">Tus estaciones</div>` + cards.join('');
  }
  $('favs').addEventListener('click', e => { const c = e.target.closest('.fav'); if (c) selectStation(c.dataset.f, c.dataset.s, true); });
  setInterval(() => { if ($('home').style.display !== 'none') renderFavs(); }, 30000);
  let favT = null; addEventListener('tt-meta', () => { clearTimeout(favT); favT = setTimeout(() => { if ($('home').style.display !== 'none') renderFavs(); }, 400); });

  // ======================= ACCIONES DE INICIO =======================
  function renderActions() {
    const n = visibleAlerts().length, mine = alertFav && hasFavs();
    $('actions').innerHTML = `<button class="act" id="planBtn"><span>🧭</span><div>Cómo llegar<b>Trenes directos</b></div></button>` +
      `<button class="act ${n ? 'warn' : ''}" id="alertBtn"><span>⚠️</span><div>Avisos<b>${n ? n + (mine ? ' en tus favoritas' : ' activos') : (mine ? 'Nada en tus favoritas' : 'Sin avisos')}</b></div></button>`;
    $('planBtn').onclick = () => openPlanner();
    $('alertBtn').onclick = openAlerts;
  }

  // ======================= CÓMO LLEGAR (A → B) =======================
  let plan = { from: null, to: null }; // {name, refs:[[fid,sid]]}
  function stationIndex() {
    const idx = new Map(); const seen = new Set();
    for (const [fid, f] of feeds) {
      const md = TT.stopsOf(fid); if (!md || seen.has(md)) continue; seen.add(md);
      for (const sid in md.stops) { const nm = md.stops[sid][0]; const k = nm.toLowerCase(); if (!idx.has(k)) idx.set(k, { name: nm, refs: [] }); idx.get(k).refs.push([fid, sid]); }
    }
    return idx;
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function openPlanner(pre) {
    selected = null; selStation = null; follow = false; clearHi();
    if (pre) plan.from = pre;
    showHome(false); $('body').scrollTop = 0; if (SHEET.state !== 'full') SHEET.set('full');
    const d = $('detail');
    d.innerHTML = `<div class="dh"><h2>🧭 Cómo llegar</h2><button class="x" id="closeBtn">✕</button></div>
      <div class="sub">Trenes, metros y buses directos para hoy, con su retraso</div>
      <div class="plan">
        <label>Desde</label><div class="inp"><input id="pFrom" placeholder="Estación de salida" autocomplete="off" value="${esc(plan.from ? plan.from.name : '')}"><div class="sug" id="sFrom"></div></div>
        <button class="swap" id="pSwap">⇅ Intercambiar</button>
        <label>Hasta</label><div class="inp"><input id="pTo" placeholder="Estación de llegada" autocomplete="off" value="${esc(plan.to ? plan.to.name : '')}"><div class="sug" id="sTo"></div></div>
      </div><div id="pRes"></div>`;
    $('closeBtn').onclick = () => select(null);
    const wire = (inp, sug, key) => {
      const show = () => {
        const q = norm(inp.value.trim()); if (q.length < 2) { sug.style.display = 'none'; return; }
        const list = [...stationIndex().values()].filter(x => norm(x.name).includes(q)).sort((a, b) => norm(a.name).indexOf(q) - norm(b.name).indexOf(q) || a.name.length - b.name.length).slice(0, 12);
        sug.innerHTML = list.map((x, i) => `<div data-i="${i}">🚉 ${esc(x.name)} <span class="muted">· ${[...new Set(x.refs.map(r => feeds.get(r[0]).name))].slice(0, 2).join(', ')}</span></div>`).join('') || '<div class="muted">Sin resultados</div>';
        sug.style.display = 'block'; sug._list = list;
      };
      inp.addEventListener('input', show); inp.addEventListener('focus', () => { inp.select(); show(); });
      sug.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (!el) return; plan[key] = sug._list[+el.dataset.i]; inp.value = plan[key].name; sug.style.display = 'none'; inp.blur(); compute(); });
    };
    wire($('pFrom'), $('sFrom'), 'from'); wire($('pTo'), $('sTo'), 'to');
    $('pSwap').onclick = () => { [plan.from, plan.to] = [plan.to, plan.from]; openPlanner(); };
    compute();
  }
  async function compute() {
    const res = $('pRes'); if (!res) return;
    if (!plan.from || !plan.to) { res.innerHTML = `<p class="muted" style="margin-top:14px">Elige las dos estaciones. Funciona dentro de la misma red (por ejemplo, entre dos estaciones de Cercanías o de AVE y Larga Distancia).</p>`; return; }
    res.innerHTML = `<p class="muted" style="margin-top:14px">Buscando trenes…</p>`;
    const now = nowSec(), out = [];
    for (const [fid, osid] of plan.from.refs) {
      const dests = new Set(plan.to.refs.filter(r => r[0] === fid).map(r => r[1])); if (!dests.size) continue;
      const deps = ((await TT.departures(fid, osid)) || []).filter(([t]) => t >= now - 300).slice(0, 60);
      await Promise.all(deps.map(async ([t, tid, rid, hd]) => {
        const tr = await TT.trip(fid, tid); if (!tr) return;
        const st = tr.rec[3], i = st.findIndex(([s]) => s === osid); if (i < 0) return;
        const j = st.findIndex(([s], k) => k > i && dests.has(s)); if (j < 0) return;
        const tu = TT.delay(fid, tid); const dl = tu ? tu.delay : null;
        if (t + (dl || 0) < now - 60) return;
        out.push({ fid, tid, rid, hd, dep: t, arr: st[j][1], dl, stops: j - i });
      }));
    }
    out.sort((a, b) => a.dep - b.dep);
    const live = new Map(); for (const v of vehicles.values()) if (v.trip) live.set(v.feed + v.trip, v.id);
    res.innerHTML = `<div class="sect">Próximos directos</div>` + (out.length ? out.slice(0, 12).map(x => {
      const mins = Math.round((x.arr - x.dep) / 60);
      return `<div class="trip" data-v="${live.get(x.fid + x.tid) || ''}"><div class="t">${fmtT(x.dep)}<small>sale</small></div>
        <div class="mid"><div>${chip(x.fid, x.rid)} ${esc(x.hd)}</div><div class="muted">${mins} min · ${x.stops} parada${x.stops > 1 ? 's' : ''}${x.dl != null ? ' · ' + delayTxt(x.dl) : ''}</div></div>
        <div class="t">${fmtT(x.arr + (x.dl > 60 ? x.dl : 0))}<small>llega</small></div>${live.has(x.fid + x.tid) ? '<span class="live-dot"></span>' : ''}</div>`;
    }).join('') : `<p class="muted">No hay trenes directos entre estas estaciones el resto del día.</p>`);
    res.querySelectorAll('.trip').forEach(el => el.onclick = () => { if (el.dataset.v) { select(el.dataset.v); flyVisible(vehicles.get(el.dataset.v).cur, 14); } });
  }

  // ======================= ENGANCHES CON LA FICHA =======================
  HOOKS.vehicleExtra = (fid, rid) => { highlight(fid, rid); return alertsFor(fid, rid).slice(0, 3).map(alertHTML).join(''); };
  HOOKS.stationHead = (fid, sid) => `<button class="star ${isFav(fid, sid) ? 'on' : ''}" id="favBtn" aria-label="Favorita">${isFav(fid, sid) ? '⭐' : '☆'}</button>`;
  HOOKS.stationExtra = (fid, sid) => {
    clearHi();
    const a = alertsFor(fid, null, sid).slice(0, 3).map(alertHTML).join('');
    return a + `<div class="row"><button class="btn" id="goFrom">🧭 Salir desde aquí</button></div>`;
  };
  HOOKS.afterRender = d => {
    const fb = d.querySelector('#favBtn');
    if (fb && selStation) fb.onclick = () => {
      const { feed, stop } = selStation, s = TT.stop(feed, stop);
      if (isFav(feed, stop)) FAVS = FAVS.filter(x => !(x.feed === feed && x.sid === stop)); else FAVS.push({ feed, sid: stop, name: s ? s[0] : stop });
      saveFavs(); fb.classList.toggle('on', isFav(feed, stop)); fb.textContent = isFav(feed, stop) ? '⭐' : '☆'; renderFavs(); renderActions();
    };
    const gf = d.querySelector('#goFrom');
    if (gf && selStation) gf.onclick = () => { const s = TT.stop(selStation.feed, selStation.stop); const e = stationIndex().get((s ? s[0] : '').toLowerCase()); openPlanner(e || null); };
  };
  HOOKS.home = () => { clearHi(); renderFavs(); };

  // ======================= LÍNEAS FAVORITAS =======================
  // clave de línea: operador + id de línea del horario oficial (o, si el operador no publica horarios, la línea que da el tiempo real)
  const lineKey = (fid, rid, v) => {
    if (rid != null) {
      const r = TT.route(fid, rid);
      if (!r) { const m = /^(\d{2})T\d{4}(.+)$/.exec(rid); return m ? `${fid}|${m[1]}|${m[2]}` : null; }
      const grp = /^\d{2}T/.test(rid) ? rid.slice(0, 2) : '';
      return `${fid}|${grp}|${r[0] || r[1]}`;
    }
    return v && v.route ? `${fid}||${v.route}` : null;
  };
  const loadFL = () => { try { return JSON.parse(localStorage.getItem('tv-favlines') || '[]'); } catch { return []; } };
  let FAVL = loadFL();
  let onlyFav = (() => { try { return localStorage.getItem('tv-onlyfav') === '1'; } catch { return false; } })();
  const saveFL = () => { try { localStorage.setItem('tv-favlines', JSON.stringify(FAVL)); localStorage.setItem('tv-onlyfav', onlyFav ? '1' : '0'); } catch {} };
  const isFavLine = k => FAVL.some(x => x.k === k);
  addEventListener('tt-meta', () => {
    let ch = false;
    FAVL = FAVL.map(x => { const p = x.k.split('|'); if (p.length !== 2) return x; const nk = p[1].startsWith('~') ? `${p[0]}||${p[1].slice(1)}` : lineKey(p[0], p[1]); if (!nk) return x; ch = true; return { ...x, k: nk }; });
    if (ch) { const seen = new Set(); FAVL = FAVL.filter(x => !seen.has(x.k) && seen.add(x.k)); saveFL(); renderFavLines(); }
  });
  // averigua en segundo plano la línea oficial de cada vehículo (a partir de su viaje en el horario)
  async function resolveLines() {
    let n = 0;
    for (const v of vehicles.values()) {
      if (v._rt === (v.trip || v.label)) continue;
      if (!TT.stopsOf(v.feed)) { if (!feeds.get(v.feed)?.timetable) { v._rt = v.trip || v.label; v.rid = null; } continue; }
      v._rt = v.trip || v.label;
      const tr = await TT.trip(v.feed, v.trip, v.label).catch(() => null);
      v.rid = tr ? tr.rec[0] : null;
      if (++n >= 60) break;
    }
  }
  setInterval(resolveLines, 1500);
  HOOKS.showVehicle = v => {
    if (!onlyFav || !FAVL.length) return true;
    return isFavLine(lineKey(v.feed, v.rid, v));
  };
  HOOKS.vehicleLine = (fid, rid, v, r) => {
    const k = lineKey(fid, rid, v); if (!k) return '';
    if (rid != null) v.rid = rid;
    const on = isFavLine(k);
    const name = (r && (r[0] || r[1])) || v.route || '';
    const tmp = document.createElement('div'); tmp.innerHTML = chip(fid, rid, name); const col = tmp.firstChild.style.background;
    return `<button class="btn favline ${on ? 'on' : ''}" data-k="${esc(k)}" data-c="${esc(col)}" data-n="${esc(name)}" data-l="${esc(r && r[1] ? r[1] : '')}" style="margin-bottom:8px;width:100%;flex:none">${on ? '⭐ Línea en favoritas' : '☆ Añadir línea ' + esc(name) + ' a favoritas'}</button>`;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('.favline'); if (!b) return;
    const k = b.dataset.k, fid = k.split('|')[0];
    if (isFavLine(k)) FAVL = FAVL.filter(x => x.k !== k);
    else FAVL.push({ k, feed: fid, name: b.dataset.n, long: b.dataset.l, color: b.dataset.c || feeds.get(fid)?.color });
    saveFL(); renderFavLines(); renderActions(); renderDetail();
  });
  function renderFavLines() {
    let box = $('favlines');
    if (!box) { box = document.createElement('div'); box.id = 'favlines'; $('favs').before(box); }
    if (!FAVL.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sect">Tus líneas</div>
      <div class="feed ${onlyFav ? 'on' : ''}" id="onlyFavRow"><span class="ic" style="background:rgba(245,158,11,.18)">⭐</span><div class="nm">Ver solo mis líneas<em>${onlyFav ? 'El mapa solo muestra tus líneas' : 'El mapa muestra todo'}</em></div><span class="sw"></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px">${FAVL.map(x => `<span class="chip" style="background:${x.color || '#666'};padding:6px 10px;font-size:14px" title="${esc(x.long)}">${esc(x.name)} <span data-del="${esc(x.k)}" style="margin-left:6px;opacity:.8;cursor:pointer">✕</span></span>`).join('')}</div>
      <div class="muted" style="font-size:12px">Para añadir una línea, toca un vehículo y pulsa ☆.</div>`;
    $('onlyFavRow').onclick = () => { onlyFav = !onlyFav; saveFL(); renderFavLines(); };
    box.querySelectorAll('[data-del]').forEach(el => el.onclick = e => { e.stopPropagation(); FAVL = FAVL.filter(x => x.k !== el.dataset.del); if (!FAVL.length) onlyFav = false; saveFL(); renderFavLines(); });
  }
  renderFavLines();
  renderActions();

  // ======================= BUSCAR LÍNEAS =======================
  function lineIndex() {
    const idx = new Map(), seen = new Set();
    for (const [fid, f] of feeds) {
      const md = TT.stopsOf(fid); if (!md || seen.has(md)) continue; seen.add(md);
      for (const rid in md.routes) {
        const r = md.routes[rid], k = lineKey(fid, rid); if (!k) continue;
        if (!idx.has(k)) { const t = document.createElement('div'); t.innerHTML = chip(fid, rid, r[0]); idx.set(k, { line: true, k, feed: fid, name: r[0] || r[1], longs: new Set(), rids: [], color: t.firstChild.style.background }); }
        const e = idx.get(k); e.rids.push(rid); if (r[1]) e.longs.add(r[1]);
      }
    }
    for (const e of idx.values()) {
      // nombre del recorrido sin repetir el sentido contrario: "A - B" y "B - A" → "A ⇄ B"
      const L = [...e.longs], out = [];
      for (const l of L) { const p = l.split(' - '); const rev = p.slice().reverse().join(' - '); if (!out.some(o => o.raw === rev)) out.push({ raw: l, txt: p.length === 2 ? p.join(' ⇄ ') : l }); }
      e.long = out.map(o => o.txt).slice(0, 2).join(' · ');
    }
    return idx;
  }
  HOOKS.searchLines = (words, match) => {
    const live = new Map(); for (const v of vehicles.values()) { const k = lineKey(v.feed, v.rid, v); if (k) live.set(k, (live.get(k) || 0) + 1); }
    const q = words.join(' ');
    return [...lineIndex().values()].filter(e => match(`${e.name} ${e.long}`))
      .map(e => ({ ...e, live: live.get(e.k) || 0, score: (e.name.toLowerCase() === q ? 0 : 1) }))
      .sort((a, b) => a.score - b.score || b.live - a.live).slice(0, 12);
  };
  HOOKS.openLine = e => {
    selected = null; selStation = null; follow = false;
    showHome(false); $('body').scrollTop = 0; if (SHEET.state === 'peek') SHEET.set('half');
    hiKey = 'line:' + e.k; hiLayer.clearLayers();
    loadLines(e.feed).then(lines => {
      if (!lines || hiKey !== 'line:' + e.k) return;
      const all = [];
      for (const rid of e.rids) if (lines[rid]) {
        L.polyline(lines[rid], { renderer: lineRenderer, color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(hiLayer);
        L.polyline(lines[rid], { renderer: lineRenderer, color: e.color, weight: 5, interactive: false }).addTo(hiLayer);
        all.push(...lines[rid]);
      }
      if (all.length) map.fitBounds(L.latLngBounds(all), { paddingTopLeft: [20, 90], paddingBottomRight: [20, SHEET.visible() + 20], maxZoom: 13 });
    });
    const vs = [...vehicles.values()].filter(v => lineKey(v.feed, v.rid, v) === e.k);
    const on = isFavLine(e.k);
    const d = $('detail');
    d.innerHTML = `<div class="dh"><h2><span class="chip" style="background:${e.color}">${esc(e.name)}</span> ${esc(e.long)}</h2><button class="x" id="closeBtn">✕</button></div>
      <div class="sub">${ICON[feeds.get(e.feed).type] || ''} ${esc(feeds.get(e.feed).name)}</div>
      <button class="btn favline ${on ? 'on' : ''}" data-k="${esc(e.k)}" data-c="${esc(e.color)}" data-n="${esc(e.name)}" data-l="${esc(e.long)}" style="margin-bottom:8px;width:100%;flex:none">${on ? '⭐ Línea en favoritas' : '☆ Añadir línea ' + esc(e.name) + ' a favoritas'}</button>
      ${alertsFor(e.feed).filter(a => a.routes.some(r => lineKey(e.feed, r) === e.k)).slice(0, 3).map(alertHTML).join('')}
      <div class="sect">En circulación ahora · ${vs.length}</div>` +
      (vs.length ? vs.map(v => `<div class="dep" data-v="${v.id}"><span class="tm">${esc((String(v.label).match(/\d{4,6}/) || [''])[0])}</span><span class="hd">${(() => { const r = TT.route(v.feed, v.rid); return esc(r && r[1] ? r[1] : v.label); })()}</span><span class="live-dot"></span></div>`).join('')
        : '<p class="muted">Ahora mismo no hay vehículos de esta línea en directo.</p>');
    $('closeBtn').onclick = () => select(null);
    d.querySelectorAll('[data-v]').forEach(el => el.onclick = () => { select(el.dataset.v); flyVisible(vehicles.get(el.dataset.v).cur, 14); });
  };

  // ======================= INSTALAR COMO APP =======================
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const dismissed = () => { try { return localStorage.getItem('tv-install-x') === '1'; } catch { return false; } };
  let deferred = null;
  function showInstall(html, onGo) {
    if (standalone || dismissed()) return;
    $('install').innerHTML = `<div class="banner"><span style="font-size:26px">📲</span><div style="flex:1">${html}</div>${onGo ? '<button id="instGo">Instalar</button>' : ''}<button class="x" id="instX">✕</button></div>`;
    if (onGo) $('instGo').onclick = onGo;
    $('instX').onclick = () => { try { localStorage.setItem('tv-install-x', '1'); } catch {} $('install').innerHTML = ''; };
  }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferred = e;
    showInstall('<b>Instálala como app</b><br>Con su icono y a pantalla completa.', async () => { deferred.prompt(); await deferred.userChoice.catch(() => {}); $('install').innerHTML = ''; });
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone)
    showInstall('<b>Instálala como app</b><br>Toca <b>Compartir</b> <span style="font-size:16px">⎋</span> y luego <b>Añadir a pantalla de inicio</b>.');
})();
