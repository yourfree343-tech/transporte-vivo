// Transporte Vivo — planificador de trayectos con transbordos (horarios oficiales del día + retrasos en directo).
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const R = 6371000, rad = Math.PI / 180;
  const dist = (a, b) => { const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const WALK = 1.1;           // m/s, paso tranquilo
  const CHANGE = 180;         // margen mínimo de transbordo (s)
  const MAX_ROUNDS = 3;       // hasta 2 transbordos
  const WINDOW = 3 * 3600;    // buscar salidas en las próximas 3 horas

  const css = document.createElement('style');
  css.textContent = `
  #planner{background:var(--card2);border-radius:18px;padding:10px;margin:2px 0 10px;position:relative}
  #planner .pf{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:13px;height:50px;padding:0 12px;margin:0 0 6px;border:1.5px solid transparent}
  #planner .pf:focus-within{border-color:var(--acc)}
  #planner .pf span{font-size:18px;width:22px;text-align:center}
  #planner .pf input{flex:1;min-width:0;border:0;outline:0;background:none;color:var(--txt);font:600 16px var(--font)}
  #planner .pf input::placeholder{color:var(--dim);font-weight:500}
  #planner .sw2{position:absolute;right:20px;top:38px;width:38px;height:38px;border-radius:50%;border:0;background:var(--card);box-shadow:0 2px 8px rgba(0,0,0,.12);font-size:16px;cursor:pointer;z-index:2}
  #planner .go{width:100%;height:48px;border:0;border-radius:13px;background:var(--acc);color:#fff;font:700 16px var(--font);cursor:pointer;margin-top:2px}
  #planner .go:disabled{opacity:.45}
  #plSug{position:absolute;left:10px;right:10px;z-index:20;background:var(--card);border-radius:14px;box-shadow:var(--shadow);max-height:46vh;overflow:auto;display:none}
  #plSug div{padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;font-size:15px;display:flex;gap:8px;align-items:center}
  #plSug div small{margin-left:auto;color:var(--dim);font-size:12px;text-align:right}
  .it{border-radius:16px;background:var(--card2);padding:12px;margin:8px 0;cursor:pointer}
  .it .top{display:flex;align-items:baseline;gap:8px}
  .it .top b{font:700 20px var(--mono)} .it .top .du{margin-left:auto;font:700 15px var(--font)}
  .it .legs{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;font-size:13px;color:var(--dim)}
  .it .meta{margin-top:6px;font-size:13px;color:var(--dim)}
  .step{display:flex;gap:12px;position:relative;padding:0 0 14px 0}
  .step .ln{width:14px;flex:none;display:flex;flex-direction:column;align-items:center}
  .step .ln i{width:14px;height:14px;border-radius:50%;border:3px solid var(--txt);background:var(--card);flex:none}
  .step .ln u{flex:1;width:4px;margin-top:2px;border-radius:2px}
  .step .tx{flex:1;min-width:0;font-size:15px;line-height:1.35}
  .step .tx .t{font:700 15px var(--mono);margin-right:6px}
  .step .tx small{display:block;color:var(--dim);font-size:13px;margin-top:2px}
  .trips-saved .tr{display:flex;align-items:center;gap:10px;background:var(--card2);border-radius:14px;padding:12px;margin:6px 0;cursor:pointer;font-size:15px}
  .trips-saved .tr b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  document.head.appendChild(css);

  // ---------- índice de estaciones (todas las redes con horario) ----------
  function allStops() {
    const out = [], seen = new Set();
    for (const [fid, f] of feeds) {
      const md = TT.stopsOf(fid); if (!md || seen.has(md)) continue; seen.add(md);
      for (const sid in md.stops) { const s = md.stops[sid]; out.push({ fid, sid, name: s[0], ll: [s[1], s[2]], type: f.type }); }
    }
    return out;
  }
  // agrupa por nombre y cercanía (≤ 800 m): "Chamartín" de Cercanías y de AVE es el mismo sitio
  function places(q) {
    const words = fold(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
    const hits = allStops().filter(s => { const n = fold(s.name); return words.every(w => n.includes(w)); });
    const groups = [];
    for (const s of hits) {
      const g = groups.find(g => fold(g.name) === fold(s.name) && dist(g.ll, s.ll) < 800);
      if (g) { g.refs.push(s); continue; }
      groups.push({ name: s.name, ll: s.ll, refs: [s] });
    }
    const w0 = words[0];
    groups.sort((a, b) => (fold(a.name).indexOf(w0) - fold(b.name).indexOf(w0)) || a.name.length - b.name.length);
    return groups.slice(0, 15);
  }
  const nets = g => [...new Set(g.refs.map(r => feeds.get(r.fid).name.replace(/ \(Euskadi\)/, '')))].slice(0, 2).join(' · ');

  // ---------- carga de viajes del día ----------
  const tripCache = new Map(); // src -> Promise<{trips, dep}>
  function loadTrips(fid) {
    const f = feeds.get(fid), md = TT.stopsOf(fid); if (!f || !md) return Promise.resolve(null);
    const src = md.src || fid;
    if (!tripCache.has(src)) tripCache.set(src, (async () => {
      const parts = await Promise.all(Array.from({ length: md.buckets }, (_, i) => fetch(`data/${src}/t/${i}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}))));
      const trips = [], dep = new Map();
      for (const p of parts) for (const tid in p) {
        const rec = p[tid]; if (!Array.isArray(rec)) continue; // alias "#1234"
        const idx = trips.length; trips.push({ fid, tid, rid: rec[0], head: rec[1], st: rec[3] });
        rec[3].forEach(([sid, t], pos) => { if (pos === rec[3].length - 1) return; const k = fid + ':' + sid; if (!dep.has(k)) dep.set(k, []); dep.get(k).push([t, idx, pos]); });
      }
      for (const a of dep.values()) a.sort((x, y) => x[0] - y[0]);
      return { trips, dep };
    })());
    return tripCache.get(src);
  }

  // ---------- búsqueda de trayectos (rondas: 0, 1 y 2 transbordos) ----------
  async function route(from, to, t0) {
    const stops = allStops();
    const near = (ll, m) => stops.filter(s => dist(ll, s.ll) <= m);
    // redes que intervienen: las del origen y destino, más Cercanías y AV/LD si son lejos
    const fids = new Set([...from.refs, ...to.refs].map(r => r.fid));
    for (const s of near(from.ll, 1200).concat(near(to.ll, 1200))) fids.add(s.fid);
    if (dist(from.ll, to.ll) > 15000) for (const id of ['renfe-cercanias', 'renfe-ld']) if (TT.stopsOf(id)) fids.add(id);
    const data = new Map();
    await Promise.all([...fids].map(async fid => { const d = await loadTrips(fid); if (d) data.set(fid, d); }));
    const pool = stops.filter(s => data.has(s.fid));
    const byKey = new Map(pool.map(s => [s.fid + ':' + s.sid, s]));
    // transbordos a pie: paradas a ≤ 400 m (rejilla para ir rápido)
    const grid = new Map(), cell = ll => Math.floor(ll[0] / 0.004) + ',' + Math.floor(ll[1] / 0.005);
    for (const s of pool) { const c = cell(s.ll); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(s); }
    const walkFrom = s => {
      const out = []; const [a, b] = cell(s.ll).split(',').map(Number);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get((a + i) + ',' + (b + j)) || []) {
        if (o === s) continue; const d = dist(s.ll, o.ll); if (d <= 400) out.push([o.fid + ':' + o.sid, Math.round(d / WALK) + 60, d]);
      }
      return out;
    };
    const delayOf = (fid, tid, sid) => { const u = TT.delay(fid, tid); if (!u) return 0; const d = u.stops && u.stops[sid] != null ? u.stops[sid] : u.delay; return Math.max(0, d || 0); };
    // destino: paradas del lugar + las que estén a ≤ 500 m andando
    const goal = new Map();
    for (const r of to.refs) goal.set(r.fid + ':' + r.sid, 0);
    for (const s of pool) { const d = dist(to.ll, s.ll); if (d <= 500 && !goal.has(s.fid + ':' + s.sid)) goal.set(s.fid + ':' + s.sid, Math.round(d / WALK)); }
    // origen
    const best = new Map(), label = new Map(); let marked = new Map();
    const startPts = from.here ? pool.filter(s => dist(from.ll, s.ll) <= 1500).map(s => [s.fid + ':' + s.sid, Math.round(dist(from.ll, s.ll) / WALK)]) : from.refs.map(r => [r.fid + ':' + r.sid, 0]);
    for (const [k, w] of startPts) { const a = t0 + w; if (!best.has(k) || a < best.get(k)) { best.set(k, a); label.set(k, { kind: 'start', walk: w }); marked.set(k, a); } }
    if (!from.here) for (const r of from.refs) for (const [k, w] of walkFrom({ fid: r.fid, sid: r.sid, ll: r.ll })) { const a = t0 + w; if (!best.has(k) || a < best.get(k)) { best.set(k, a); label.set(k, { kind: 'walk', from: r.fid + ':' + r.sid, secs: w }); marked.set(k, a); } }
    let bestGoal = Infinity;
    for (let round = 0; round < MAX_ROUNDS && marked.size; round++) {
      const next = new Map();
      for (const [k, a] of marked) {
        const fid = k.slice(0, k.indexOf(':')), d = data.get(fid); if (!d) continue;
        const lst = d.dep.get(k); if (!lst) continue;
        const ready = a + (label.get(k).kind === 'start' ? 0 : CHANGE);
        let lo = 0, hi = lst.length; while (lo < hi) { const m = (lo + hi) >> 1; if (lst[m][0] + 600 < ready) lo = m + 1; else hi = m; } // margen por retrasos
        const seenRoute = new Map();
        for (let i = lo; i < lst.length; i++) {
          const [t, ti, pos] = lst[i]; const trip = d.trips[ti]; const sid = k.slice(fid.length + 1);
          const dt = t + delayOf(fid, trip.tid, sid);
          if (dt < ready) continue; if (dt > ready + WINDOW || dt > bestGoal) break;
          const rk = trip.rid + '|' + trip.head; const c = seenRoute.get(rk) || 0; if (c >= 2) continue; seenRoute.set(rk, c + 1);
          for (let j = pos + 1; j < trip.st.length; j++) {
            const [s2, t2] = trip.st[j]; const k2 = fid + ':' + s2; const at = t2 + delayOf(fid, trip.tid, s2);
            if (at >= bestGoal) break;
            if (!best.has(k2) || at < best.get(k2)) {
              best.set(k2, at); next.set(k2, at);
              label.set(k2, { kind: 'ride', fid, trip, boardPos: pos, alightPos: j, from: k, dep: dt, arr: at, round });
              if (goal.has(k2)) bestGoal = Math.min(bestGoal, at + goal.get(k2));
            }
          }
        }
      }
      // transbordos a pie desde lo mejorado
      const walked = new Map();
      for (const [k, a] of next) {
        const s = byKey.get(k); if (!s) continue;
        for (const [k2, w] of walkFrom(s)) {
          const at = a + w; if (at >= bestGoal) continue;
          if (!best.has(k2) || at < best.get(k2)) { best.set(k2, at); walked.set(k2, at); label.set(k2, { kind: 'walk', from: k, secs: w }); }
        }
      }
      marked = new Map([...next, ...walked]);
    }
    // mejor llegada al destino
    let end = null, endT = Infinity;
    for (const [k, w] of goal) if (best.has(k) && best.get(k) + w < endT && label.get(k).kind !== 'start') { endT = best.get(k) + w; end = k; }
    if (!end) return null;
    const legs = []; let k = end, guard = 0;
    if (goal.get(end) > 60) legs.unshift({ type: 'walk', secs: goal.get(end), toName: to.name });
    while (k && guard++ < 20) {
      const l = label.get(k); if (!l || l.kind === 'start') { if (l && l.walk > 60) legs.unshift({ type: 'walk', secs: l.walk, toName: byKey.get(k)?.name }); break; }
      if (l.kind === 'walk') { legs.unshift({ type: 'walk', secs: l.secs, toName: byKey.get(k)?.name }); k = l.from; continue; }
      const tr = l.trip;
      legs.unshift({ type: 'ride', fid: l.fid, tid: tr.tid, rid: tr.rid, head: tr.head, stops: tr.st.slice(l.boardPos, l.alightPos + 1), dep: l.dep, arr: l.arr, delay: delayOf(l.fid, tr.tid, tr.st[l.boardPos][0]) });
      k = l.from;
    }
    const rides = legs.filter(x => x.type === 'ride'); if (!rides.length) return null;
    return { legs, dep: rides[0].dep - (legs[0].type === 'walk' ? legs[0].secs : 0), arr: endT, rides: rides.length };
  }
  async function alternatives(from, to) {
    const out = []; let t = nowSec();
    for (let i = 0; i < 4; i++) {
      const it = await route(from, to, t); if (!it) break;
      const sig = it.legs.filter(l => l.type === 'ride').map(l => l.tid).join('>');
      if (!out.some(o => o.sig === sig)) out.push({ ...it, sig });
      const firstRide = it.legs.find(l => l.type === 'ride');
      t = firstRide.dep - (it.legs[0].type === 'walk' ? it.legs[0].secs : 0) + 60;
    }
    return out;
  }

  // ---------- interfaz ----------
  const P = { from: null, to: null, field: null };
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem('tv-trips') || '[]'); } catch { return []; } };
  let SAVED = loadSaved();
  const persist = () => { try { localStorage.setItem('tv-trips', JSON.stringify(SAVED)); } catch {} };
  const placeLabel = p => p ? (p.here ? '📍 Mi ubicación' : p.name) : '';

  function mount() {
    if ($('planner')) return;
    const box = document.createElement('div'); box.id = 'planner';
    box.innerHTML = `
      <div class="pf"><span>🟢</span><input id="plFrom" placeholder="Desde (o Mi ubicación)" autocomplete="off" enterkeyhint="next"></div>
      <div class="pf"><span>🏁</span><input id="plTo" placeholder="¿A dónde vas?" autocomplete="off" enterkeyhint="search"></div>
      <button class="sw2" id="plSwap" aria-label="Intercambiar">⇅</button>
      <div id="plSug"></div>
      <button class="go" id="plGo" disabled>Buscar cómo ir</button>`;
    $('home').insertBefore(box, $('home').firstChild);
    const sug = $('plSug');
    const show = (inp, key) => {
      P.field = key; const q = inp.value.trim();
      const list = q.length >= 2 && !(P[key] && placeLabel(P[key]) === inp.value) ? places(q) : [];
      const items = (key === 'from' && (!q || /mi ub|ubic/i.test(q)) ? [{ here: true, name: 'Mi ubicación' }] : []).concat(list);
      if (!items.length) { sug.style.display = 'none'; return; }
      sug._items = items;
      sug.style.top = (inp.closest('.pf').offsetTop + 52) + 'px';
      sug.innerHTML = items.map((g, i) => g.here ? `<div data-i="${i}">📍 <b>Mi ubicación</b><small>Paradas cercanas a ti</small></div>` : `<div data-i="${i}">🚉 ${esc(g.name)}<small>${esc(nets(g))}</small></div>`).join('');
      sug.style.display = 'block';
    };
    const wire = (inp, key) => {
      inp.addEventListener('focus', () => { document.body.classList.add('planning'); if (SHEET.state !== 'full') SHEET.set('full'); setTimeout(() => inp.select(), 0); show(inp, key); });
      inp.addEventListener('input', () => { P[key] = null; refreshGo(); show(inp, key); });
      inp.addEventListener('blur', () => setTimeout(() => { if (!sug.contains(document.activeElement)) sug.style.display = 'none'; }, 200));
    };
    wire($('plFrom'), 'from'); wire($('plTo'), 'to');
    sug.addEventListener('pointerdown', e => e.preventDefault());
    sug.addEventListener('click', async e => {
      const el = e.target.closest('[data-i]'); if (!el) return;
      const g = sug._items[+el.dataset.i], key = P.field; sug.style.display = 'none';
      if (g.here) {
        $('plFrom').value = 'Buscando tu posición…';
        try { const pos = await new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, ko, { enableHighAccuracy: true, timeout: 10000 })); P.from = { here: true, name: 'Mi ubicación', ll: [pos.coords.latitude, pos.coords.longitude], refs: [] }; }
        catch { $('plFrom').value = ''; $('plFrom').placeholder = 'No he podido saber dónde estás'; return; }
      } else P[key] = { name: g.name, ll: g.ll, refs: g.refs.map(r => ({ fid: r.fid, sid: r.sid, ll: r.ll })) };
      $('plFrom').value = placeLabel(P.from); $('plTo').value = placeLabel(P.to);
      refreshGo();
      if (key === 'from' && !P.to) $('plTo').focus(); else if (P.from && P.to) { document.activeElement.blur(); run(); }
    });
    $('plSwap').onclick = () => { if (P.to && P.to.here) return; [P.from, P.to] = [P.to, P.from]; $('plFrom').value = placeLabel(P.from); $('plTo').value = placeLabel(P.to); refreshGo(); if (P.from && P.to) run(); };
    $('plGo').onclick = run;
    renderSaved();
  }
  function refreshGo() { const b = $('plGo'); if (b) b.disabled = !(P.from && P.to); }

  async function run() {
    if (!P.from || !P.to) return;
    document.body.classList.remove('planning');
    selected = null; selStation = null; follow = false;
    showHome(false); $('body').scrollTop = 0; SHEET.set('full');
    const d = $('detail'), from = P.from, to = P.to;
    const head = `<div class="dh"><h2>${esc(placeLabel(from))} → ${esc(to.name)}</h2><button class="x" id="closeBtn">✕</button></div>`;
    d.innerHTML = head + `<p class="muted">Calculando con los horarios de hoy y los retrasos en directo…</p>`;
    $('closeBtn').onclick = () => select(null);
    let its = [];
    try { its = await alternatives(from, to); } catch (e) { console.error(e); }
    if (P.from !== from || P.to !== to) return;
    const saved = SAVED.some(s => s.key === tripKey(from, to));
    d.innerHTML = head + `<div class="sub">Salidas desde ahora · horarios oficiales de hoy con retrasos en directo</div>
      <div class="row"><button class="btn ${saved ? 'on' : ''}" id="plSave">${saved ? '⭐ Trayecto guardado' : '☆ Guardar este trayecto'}</button></div>` +
      (its.length ? its.map((it, i) => itCard(it, i)).join('') : `<p class="muted" style="margin-top:12px">No encuentro cómo llegar hoy con los horarios publicados (como mucho con 2 transbordos). Prueba con otra estación cercana.</p>`);
    $('closeBtn').onclick = () => select(null);
    $('plSave').onclick = () => {
      const k = tripKey(from, to);
      if (SAVED.some(s => s.key === k)) SAVED = SAVED.filter(s => s.key !== k); else SAVED.unshift({ key: k, from, to });
      persist(); renderSaved(); $('plSave').outerHTML = `<button class="btn ${SAVED.some(s => s.key === k) ? 'on' : ''}" id="plSave">${SAVED.some(s => s.key === k) ? '⭐ Trayecto guardado' : '☆ Guardar este trayecto'}</button>`; run();
    };
    d.querySelectorAll('.it').forEach(el => el.onclick = () => showIt(its[+el.dataset.i], from, to));
    if (its[0]) setTimeout(() => drawIt(its[0]), 50);
  }
  const tripKey = (a, b) => (a.here ? 'here' : fold(a.name)) + '>' + fold(b.name);
  const mins = s => Math.max(1, Math.round(s / 60));
  const durTxt = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  function chipOf(l) { const r = TT.route(l.fid, l.rid); return chip(l.fid, l.rid, (r && (r[0] || r[1])) || '·'); }
  function itCard(it, i) {
    const now = nowSec(), leave = Math.round((it.dep - now) / 60);
    const legs = it.legs.map(l => l.type === 'walk' ? `🚶 ${mins(l.secs)}'` : `${ICON[feeds.get(l.fid).type] || ''}${chipOf(l)}`).join(' <span>›</span> ');
    const late = it.legs.filter(l => l.type === 'ride' && l.delay > 60);
    return `<div class="it" data-i="${i}"><div class="top"><b>${fmtT(it.dep)} → ${fmtT(it.arr)}</b><span class="du">${durTxt(it.arr - it.dep)}</span></div>
      <div class="legs">${legs}</div>
      <div class="meta">${leave <= 0 ? 'Sal ya' : `Sal en ${leave} min`} · ${it.rides - 1 ? (it.rides - 1) + ' transbordo' + (it.rides > 2 ? 's' : '') : 'directo'}${late.length ? ' · ' + late.map(l => delayTxt(l.delay)).join(' ') : ''}</div></div>`;
  }
  function showIt(it, from, to) {
    SHEET.set('half'); setTimeout(() => drawIt(it), 350);
    const d = $('detail'), live = new Map(); for (const v of vehicles.values()) if (v.trip) live.set(v.feed + v.trip, v.id);
    let html = `<div class="dh"><h2>${fmtT(it.dep)} → ${fmtT(it.arr)} · ${durTxt(it.arr - it.dep)}</h2><button class="x" id="backBtn">‹</button></div><div class="sub">${esc(placeLabel(from))} → ${esc(to.name)}</div>`;
    for (const l of it.legs) {
      if (l.type === 'walk') { html += `<div class="step"><div class="ln"><i style="border-color:var(--dim)"></i><u style="background:repeating-linear-gradient(var(--dim) 0 4px,transparent 4px 8px)"></u></div><div class="tx">🚶 Camina ${mins(l.secs)} min${l.toName ? ' hasta <b>' + esc(l.toName) + '</b>' : ''}</div></div>`; continue; }
      const f = feeds.get(l.fid), r = TT.route(l.fid, l.rid), a = l.stops[0], b = l.stops[l.stops.length - 1];
      const col = (() => { const t = document.createElement('div'); t.innerHTML = chipOf(l); return t.firstChild.style.background; })();
      const vid = live.get(l.fid + l.tid);
      html += `<div class="step"><div class="ln"><i style="border-color:${col}"></i><u style="background:${col}"></u></div><div class="tx"><span class="t">${fmtT(l.dep)}</span><b>${esc(TT.stopName(l.fid, a[0]))}</b>
        <small>${ICON[f.type] || ''} ${chipOf(l)} dirección <b>${esc(l.head)}</b> · ${l.stops.length - 1} parada${l.stops.length > 2 ? 's' : ''}${l.delay > 60 ? ' · ' + delayTxt(l.delay) : ''}${vid ? ` · <a href="#" data-v="${vid}" style="color:var(--acc);font-weight:700">ver en el mapa ●</a>` : ''}</small></div></div>
        <div class="step"><div class="ln"><i style="border-color:${col}"></i></div><div class="tx"><span class="t">${fmtT(l.arr)}</span>Baja en <b>${esc(TT.stopName(l.fid, b[0]))}</b></div></div>`;
    }
    html += `<div class="step"><div class="ln"><i style="background:var(--acc);border-color:var(--acc)"></i></div><div class="tx"><span class="t">${fmtT(it.arr)}</span><b>🏁 ${esc(to.name)}</b></div></div>`;
    d.innerHTML = html; $('body').scrollTop = 0;
    $('backBtn').onclick = () => run();
    d.querySelectorAll('[data-v]').forEach(a => a.onclick = e => { e.preventDefault(); select(a.dataset.v); flyVisible(vehicles.get(a.dataset.v).cur, 14); });
  }
  // dibujo del trayecto en el mapa
  const itLayer = L.layerGroup().addTo(map);
  function drawIt(it) {
    itLayer.clearLayers(); const all = [];
    let prev = P.from && P.from.here ? P.from.ll : null;
    for (const l of it.legs) {
      if (l.type !== 'ride') continue;
      const pts = l.stops.map(([sid]) => { const s = TT.stop(l.fid, sid); return s ? [s[1], s[2]] : null; }).filter(Boolean);
      if (prev && pts[0]) L.polyline([prev, pts[0]], { color: '#64748b', weight: 4, dashArray: '2 8', lineCap: 'round' }).addTo(itLayer);
      const t = document.createElement('div'); t.innerHTML = chipOf(l); const col = t.firstChild.style.background;
      L.polyline(pts, { color: '#fff', weight: 10, opacity: .9 }).addTo(itLayer);
      L.polyline(pts, { color: col, weight: 6 }).addTo(itLayer);
      pts.forEach((p, i) => { if (i === 0 || i === pts.length - 1) L.circleMarker(p, { radius: 7, color: col, weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(itLayer); });
      all.push(...pts); prev = pts[pts.length - 1];
    }
    if (all.length) map.fitBounds(L.latLngBounds(all), { paddingTopLeft: [30, 90], paddingBottomRight: [30, SHEET.visible() + 30], maxZoom: 14 });
  }
  function renderSaved() {
    let box = $('savedTrips');
    if (!box) { box = document.createElement('div'); box.id = 'savedTrips'; box.className = 'trips-saved'; $('planner').after(box); }
    if (!SAVED.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sect">Tus trayectos</div>` + SAVED.map((s, i) => `<div class="tr" data-i="${i}">🧭 <b>${esc(placeLabel(s.from))} → ${esc(s.to.name)}</b><span class="muted">›</span></div>`).join('');
    box.querySelectorAll('.tr').forEach(el => el.onclick = async () => {
      const s = SAVED[+el.dataset.i]; P.to = s.to;
      if (s.from.here) { try { const pos = await new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, ko, { enableHighAccuracy: true, timeout: 10000 })); P.from = { ...s.from, ll: [pos.coords.latitude, pos.coords.longitude] }; } catch { P.from = s.from; } }
      else P.from = s.from;
      $('plFrom').value = placeLabel(P.from); $('plTo').value = placeLabel(P.to); refreshGo(); run();
    });
  }
  HOOKS.home = (prev => () => { itLayer.clearLayers(); if (prev) prev(); })(HOOKS.home);
  window.Planner = {
    setFrom(name) { const g = places(name).find(x => fold(x.name) === fold(name)) || places(name)[0]; if (!g) return; P.from = { name: g.name, ll: g.ll, refs: g.refs.map(r => ({ fid: r.fid, sid: r.sid, ll: r.ll })) }; select(null); $('plFrom').value = placeLabel(P.from); refreshGo(); SHEET.set('full'); $('plTo').focus(); },
    setTo(name) { const g = places(name).find(x => fold(x.name) === fold(name)) || places(name)[0]; if (!g) return; P.to = { name: g.name, ll: g.ll, refs: g.refs.map(r => ({ fid: r.fid, sid: r.sid, ll: r.ll })) }; select(null); $('plTo').value = placeLabel(P.to); refreshGo(); if (P.from) run(); else { SHEET.set('full'); $('plFrom').focus(); } },
  };
  mount();
})();
