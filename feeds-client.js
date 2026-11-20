// Lector de feeds GTFS-RT en el navegador: JSON o protobuf, con proxy CORS de respaldo.
(function () {
  // directo primero; si el operador bloquea el navegador (CORS), proxies gratuitos sin clave.
  // Se puede añadir uno propio (p. ej. un Cloudflare Worker) en config.json → "proxy": "https://…/?url="
  // 1º nuestro puente propio en Vercel (api/proxy.js de este repositorio), luego directo y proxies públicos de respaldo
  const BRIDGE = 'https://transporte-vivo.vercel.app/api/proxy?url=';
  const PROXIES = [
    u => BRIDGE + encodeURIComponent(u),
    u => u,
    u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  ];
  fetch('config.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(c => { if (c && c.proxy) PROXIES.splice(0, 0, u => c.proxy + encodeURIComponent(u)); }).catch(() => {});

  // ---------- decodificador protobuf mínimo para VehiclePosition ----------
  function Reader(buf) { this.b = buf; this.p = 0; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  Reader.prototype.varint = function () {
    let r = 0, s = 0, b;
    do { b = this.b[this.p++]; if (s < 49) r += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80);
    return r;
  };
  Reader.prototype.bytes = function () { const n = this.varint(); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; };
  Reader.prototype.f32 = function () { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; };
  Reader.prototype.f64 = function () { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; };
  Reader.prototype.skip = function (wt) {
    if (wt === 0) this.varint(); else if (wt === 1) this.p += 8; else if (wt === 2) { const n = this.varint(); this.p += n; } else if (wt === 5) this.p += 4;
    else throw new Error('tipo protobuf ' + wt);
  };
  const td = new TextDecoder();
  function parse(buf, fields) { // fields: {num: [name, kind, sub?, repeated?]}
    const r = new Reader(buf), o = {};
    while (r.p < buf.length) {
      const tag = r.varint(), num = Math.floor(tag / 8), wt = tag & 7, f = fields[num];
      if (!f) { r.skip(wt); continue; }
      const [name, kind, sub, rep] = f; let v;
      if (kind === 'str') v = td.decode(r.bytes());
      else if (kind === 'msg') v = parse(r.bytes(), sub);
      else if (kind === 'f32') v = wt === 5 ? r.f32() : (r.skip(wt), null);
      else if (kind === 'f64') v = wt === 1 ? r.f64() : (r.skip(wt), null);
      else v = r.varint();
      if (rep) (o[name] = o[name] || []).push(v); else o[name] = v;
    }
    return o;
  }
  const TRIP = { 1: ['tripId', 'str'], 5: ['routeId', 'str'], 6: ['directionId', 'int'] };
  const POS = { 1: ['latitude', 'f32'], 2: ['longitude', 'f32'], 3: ['bearing', 'f32'], 4: ['odometer', 'f64'], 5: ['speed', 'f32'] };
  const VDESC = { 1: ['id', 'str'], 2: ['label', 'str'], 3: ['licensePlate', 'str'] };
  const VPOS = { 1: ['trip', 'msg', TRIP], 2: ['position', 'msg', POS], 3: ['currentStopSequence', 'int'], 4: ['currentStatus', 'int'], 5: ['timestamp', 'int'], 7: ['stopId', 'str'], 8: ['vehicle', 'msg', VDESC] };
  const ENTITY = { 1: ['id', 'str'], 4: ['vehicle', 'msg', VPOS] };
  const FEED = { 2: ['entity', 'msg', ENTITY, true] };
  const decodePB = buf => parse(new Uint8Array(buf), FEED).entity || [];
  // TripUpdate (retrasos)
  const STE = { 1: ['delay', 'int'], 2: ['time', 'int'] };
  const STU = { 1: ['stopSequence', 'int'], 2: ['arrival', 'msg', STE], 3: ['departure', 'msg', STE], 4: ['stopId', 'str'] };
  const TU = { 1: ['trip', 'msg', TRIP], 2: ['stopTimeUpdate', 'msg', STU, true], 3: ['vehicle', 'msg', VDESC], 5: ['delay', 'int'] };
  const TUFEED = { 2: ['entity', 'msg', { 1: ['id', 'str'], 3: ['tripUpdate', 'msg', TU] }, true] };
  const i32 = v => (v == null ? null : v > 2147483647 ? v - 18446744073709551616 : v);

  // ---------- normalización ----------
  const pick = (o, ...k) => { for (const x of k) if (o && o[x] != null) return o[x]; return null; };
  function normalize(feed, e) {
    const v = e.vehicle; if (!v) return null;
    const pos = v.position || {}, lat = +pos.latitude, lon = +pos.longitude;
    if (!lat || !lon || Math.abs(lat) > 90) return null;
    const trip = v.trip || {}, veh = v.vehicle || {};
    const label = pick(veh, 'label') || pick(veh, 'id') || e.id;
    let route = pick(trip, 'routeId', 'route_id');
    if (!route && typeof label === 'string') { const m = label.match(/^([A-Z]{1,2}\d{1,2}[a-z]?)/); if (m) route = m[1]; }
    const ts = Number(pick(v, 'timestamp')) || Date.now() / 1000;
    return {
      id: feed.id + ':' + (pick(veh, 'id') || e.id), feed: feed.id, lat, lon,
      bearing: pos.bearing != null ? +pos.bearing : null,
      speed: pos.speed != null ? +pos.speed : null,
      label: String(label), route: route ? String(route) : null,
      trip: pick(trip, 'tripId', 'trip_id'), stop: pick(v, 'stopId', 'stop_id'),
      status: pick(v, 'currentStatus', 'current_status'), ts: ts * 1000,
    };
  }

  // ---------- sondeo ----------
  async function fetchFeed(feed) {
    const order = feed._proxy != null ? [feed._proxy, ...PROXIES.keys()].filter((x, i, a) => a.indexOf(x) === i) : [...PROXIES.keys()];
    let lastStatus = null;
    let lastErr;
    for (const i of order) {
      try {
        const res = await fetch(PROXIES[i](feed.url), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!res.ok) { lastStatus = res.status; throw new Error('HTTP ' + res.status); }
        let ents;
        if (feed.format === 'json') { const j = await res.json(); ents = j.entity || j.entities || []; }
        else ents = decodePB(await res.arrayBuffer());
        feed._proxy = i;
        return { list: ents.map(e => normalize(feed, e)).filter(Boolean), via: i ? 'proxy' : 'directo' };
      } catch (e) { lastErr = e; }
    }
    throw new Error(lastStatus === 401 || lastStatus === 403 ? 'el operador pide clave o bloquea el acceso' : lastStatus === 404 ? 'dirección de datos no encontrada' : 'no responde ahora mismo');
  }

  async function getVia(feed, url) {
    const order = feed._proxy != null ? [feed._proxy, ...PROXIES.keys()].filter((x, i, a) => a.indexOf(x) === i) : [...PROXIES.keys()];
    let err;
    for (const i of order) {
      try { const r = await fetch(PROXIES[i](url), { cache: 'no-store', signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r; }
      catch (e) { err = e; }
    }
    throw err;
  }
  // Devuelve Map(tripId -> {delay, stops:{stopId: delay}, label})
  async function tripUpdates(feed) {
    const res = await getVia(feed, feed.tripUpdates);
    const isJson = /json/i.test(feed.tripUpdates) || /json/.test(res.headers.get('content-type') || '');
    const ents = isJson ? ((await res.json()).entity || []) : parse(new Uint8Array(await res.arrayBuffer()), TUFEED).entity || [];
    const out = new Map();
    for (const e of ents) {
      const tu = e.tripUpdate || e.trip_update; if (!tu) continue;
      const tid = pick(tu.trip || {}, 'tripId', 'trip_id'); if (!tid) continue;
      const stops = {}; let last = tu.delay != null ? i32(+tu.delay) : null;
      for (const u of tu.stopTimeUpdate || tu.stop_time_update || []) {
        const ev = u.departure || u.arrival || {}; const d = ev.delay != null ? i32(+ev.delay) : null;
        if (d != null) { last = d; const sid = pick(u, 'stopId', 'stop_id'); if (sid) stops[sid] = d; }
      }
      out.set(tid, { delay: last, stops, label: pick(tu.vehicle || {}, 'label', 'id') });
    }
    return out;
  }

  async function alerts(feed) {
    const r = await getVia(feed, feed.alerts);
    const j = await r.json();
    const tx = t => { const tr = (t && t.translation) || []; const es = tr.find(x => (x.language || '').startsWith('es')) || tr[0]; return es ? es.text : ''; };
    const seen = new Set(), out = [];
    for (const e of j.entity || []) {
      const a = e.alert; if (!a || seen.has(e.id)) continue; seen.add(e.id);
      const ie = a.informedEntity || a.informed_entity || [];
      out.push({ id: e.id, head: tx(a.headerText || a.header_text), text: tx(a.descriptionText || a.description_text),
        routes: ie.map(x => x.routeId || x.route_id).filter(Boolean), stops: ie.map(x => x.stopId || x.stop_id).filter(Boolean) });
    }
    return out;
  }

  window.FeedsClient = {
    tripUpdates, alerts,
    start(feeds, onData, onError) {
      feeds.filter(f => f.url).forEach((f, k) => {
        const tick = async () => {
          try { const r = await fetchFeed(f); onData(f.id, r.list, r.via); }
          catch (e) { onError(f.id, e.name === 'TimeoutError' ? 'tiempo agotado' : (e.message || 'error de red')); }
          setTimeout(tick, (f.interval || 30) * 1000);
        };
        setTimeout(tick, k * 400);
      });
    },
    decodePB,
  };
})();
