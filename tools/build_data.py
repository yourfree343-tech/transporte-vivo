#!/usr/bin/env python3
"""Genera los horarios del día (y la lista final de feeds) para Transporte Vivo.

Lee feeds.base.json, descubre los feeds del País Vasco (Open Data Euskadi),
descarga el GTFS estático de cada operador y escribe en <salida>/:
  feeds.json                         lista final que usa la web
  data/<feed>/meta.json              líneas y paradas
  data/<feed>/t/<n>.json             viajes de hoy: paradas y horas (por fragmentos)
  data/<feed>/s/<n>.json             salidas de hoy por parada (por fragmentos)
Uso: python3 tools/build_data.py <carpeta_salida>
"""
import csv, io, json, os, re, sys, zipfile, zlib, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

OUT = sys.argv[1] if len(sys.argv) > 1 else "_site"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo("Europe/Madrid")
UA = {"User-Agent": "TransporteVivo/1.0 (+github pages)"}
MAX_ZIP = 300 * 1024 * 1024
PALETTE = ["#0d9488", "#9333ea", "#c2410c", "#0369a1", "#be123c", "#4d7c0f", "#a16207", "#1d4ed8", "#db2777", "#047857"]

def get(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(MAX_ZIP)

def log(*a): print(*a, flush=True)

# ---------- descubrimiento: Open Data Euskadi ----------
def walk_urls(obj, acc):
    if isinstance(obj, dict):
        for v in obj.values(): walk_urls(v, acc)
    elif isinstance(obj, list):
        for v in obj: walk_urls(v, acc)
    elif isinstance(obj, str) and obj.startswith("http"):
        acc.append(obj)
    return acc

def slug_from(url):
    m = re.search(r"/moveuskadi/([^/]+)/", url)
    return m.group(1).lower() if m else None

def discover_euskadi(existing_urls, base_feeds):
    found = []
    try:
        rt = walk_urls(json.loads(get("https://opendata.euskadi.eus/transport/moveuskadi/data-index-gtfs-rt.json", 60)), [])
    except Exception as e:
        log("Euskadi RT: sin índice:", e); return found
    try:
        full = walk_urls(json.loads(get("https://opendata.euskadi.eus/transport/moveuskadi/data-index.json", 60)), [])
    except Exception as e:
        log("Euskadi GTFS: sin índice:", e); full = []
    zips = {}
    for u in full:
        if u.lower().endswith(".zip") and "gtfs" in u.lower():
            s = slug_from(u)
            if s and s not in zips: zips[s] = u
    norm = lambda x: re.sub(r"[^a-z0-9]", "", x.lower())
    base_by = {norm(f["id"]): f for f in base_feeds}
    seen = {}
    for i, u in enumerate(sorted(set(rt))):
        low = u.lower()
        if not low.endswith(".pb") or "vehicle" not in low or u in existing_urls: continue
        s = slug_from(u) or f"euskadi{i}"
        if norm(s) in base_by:  # ya lo tenemos: solo le añadimos los horarios
            b = base_by[norm(s)]
            if not b.get("gtfs") and zips.get(s): b["gtfs"] = zips[s]
            continue
        seen[s] = seen.get(s, 0) + 1
        fid = f"eus-{s}" if seen[s] == 1 else f"eus-{s}-{seen[s]}"
        name = s.replace("_", " ").replace("-", " ").title()
        if seen[s] > 1:
            extra = re.sub(r"(gtfsrt_|_?vehicle_?positions?|\.pb)", "", u.rsplit("/", 1)[-1], flags=re.I).replace(s, "").strip("_- ")
            name += f" {extra.replace('_', ' ').title() or seen[s]}"
        typ = "tren" if "euskotren" in s or "renfe" in s else "tranvia" if "tran" in s else "metro" if "metro" in s else "bus"
        found.append({"id": fid, "name": f"{name} (Euskadi)", "type": typ, "color": PALETTE[len(found) % len(PALETTE)],
                      "format": "pb", "url": u, "gtfs": zips.get(s) if seen[s] == 1 else None,
                      "shareTimetable": f"eus-{s}" if seen[s] > 1 else None, "interval": 30, "auto": True})
    log(f"Euskadi: {len(found)} feeds nuevos")
    return found

# ---------- descubrimiento: FGC (Opendatasoft) ----------
FGC = "https://dadesobertes.fgc.cat/api/explore/v2.1/catalog/datasets/"
def ods_files(dataset):
    urls = []
    for path in ("/attachments", "/records?limit=20", "/exports/json?limit=20"):
        try: urls += walk_urls(json.loads(get(FGC + dataset + path, 60)), [])
        except Exception as e: log(f"FGC {dataset}{path}: {e}")
    return urls

def discover_fgc(feed):
    urls = ods_files("vehicle-positions-gtfs_realtime")
    pb = [u for u in urls if re.search(r"(\.pb|/files/|download)", u, re.I)]
    if pb: feed["url"] = pb[0]
    g = [u for u in ods_files("gtfs") + ods_files("google_transit") if u.lower().endswith(".zip") or "/files/" in u]
    if g and not feed.get("gtfs"): feed["gtfs"] = g[0]
    log(f"FGC: tiempo real {'sí' if feed.get('url') else 'no'} · horarios {'sí' if feed.get('gtfs') else 'no'}")

# ---------- GTFS ----------
def secs(t):
    try:
        h, m, s = t.strip().split(":"); return int(h) * 3600 + int(m) * 60 + int(s)
    except Exception: return None

def read_csv(z, name):
    names = {n.split("/")[-1].lower(): n for n in z.namelist()}
    if name not in names: return
    with z.open(names[name]) as f:
        for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace")):
            # Renfe rellena los campos con espacios: se limpian claves y valores
            yield {(k or "").strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}

def active_services(z, day):
    ymd, wd = day.strftime("%Y%m%d"), ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][day.weekday()]
    act = set()
    for r in read_csv(z, "calendar.txt"):
        if r.get("start_date", "0") <= ymd <= r.get("end_date", "99999999") and r.get(wd) == "1": act.add(r["service_id"])
    for r in read_csv(z, "calendar_dates.txt"):
        if r.get("date") == ymd:
            (act.add if r.get("exception_type") == "1" else act.discard)(r["service_id"])
    return act

def bucket(key, n): return zlib.crc32(key.encode()) % n

def build_feed(feed, outdir):
    raw = get(feed["gtfs"])
    z = zipfile.ZipFile(io.BytesIO(raw))
    today = datetime.now(TZ).date()
    services = active_services(z, today)
    routes = {}
    for r in read_csv(z, "routes.txt"):
        col = (r.get("route_color") or "").strip()
        routes[r["route_id"]] = [r.get("route_short_name", "").strip(), r.get("route_long_name", "").strip(),
                                 ("#" + col) if re.fullmatch(r"[0-9A-Fa-f]{6}", col) else None, r.get("route_type", "")]
    trips = {}
    for r in read_csv(z, "trips.txt"):
        if r.get("service_id") in services:
            trips[r["trip_id"]] = [r.get("route_id"), r.get("trip_headsign", "").strip(), r.get("trip_short_name", "").strip()]
    stoptimes = {}
    for r in read_csv(z, "stop_times.txt"):
        tid = r.get("trip_id")
        if tid not in trips: continue
        t = secs(r.get("departure_time") or r.get("arrival_time") or "")
        if t is None: continue
        stoptimes.setdefault(tid, []).append((int(r.get("stop_sequence") or 0), r["stop_id"], t))
    used = set()
    for tid, lst in stoptimes.items():
        lst.sort(); used.update(s for _, s, _ in lst)
    stops = {}
    for r in read_csv(z, "stops.txt"):
        if r["stop_id"] in used:
            try: stops[r["stop_id"]] = [r.get("stop_name", "").strip(), round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)]
            except Exception: pass
    total = sum(len(v) for v in stoptimes.values())
    n = max(1, -(-total // 15000))
    tsh = [dict() for _ in range(n)]; ssh = [dict() for _ in range(n)]
    for tid, lst in stoptimes.items():
        rid, head, short = trips[tid]
        if not head and lst: head = stops.get(lst[-1][1], [""])[0]
        rec = [rid, head, short, [[s, t] for _, s, t in lst]]
        tsh[bucket(tid, n)][tid] = rec
        # alias por número de tren (p. ej. "#23526") para cuando el tiempo real usa otro id de viaje
        num = short or (re.findall(r"\d{4,6}", tid) or [None])[0]
        if num: tsh[bucket("#" + num, n)].setdefault("#" + num, tid)
        for i, (_, s, t) in enumerate(lst):
            if i == len(lst) - 1: continue  # última parada: no es una salida
            ssh[bucket(s, n)].setdefault(s, []).append([t, tid, rid, head])
    for d in ssh:
        for v in d.values(): v.sort()
    base = os.path.join(outdir, "data", feed["id"])
    os.makedirs(os.path.join(base, "t"), exist_ok=True)
    os.makedirs(base, exist_ok=True); os.makedirs(os.path.join(base, "s"), exist_ok=True)
    used_routes = {k: v for k, v in routes.items() if any(t[0] == k for t in trips.values())}
    # trazado de cada línea: el viaje con más paradas, con su shape si existe
    best = {}
    for tid, lst in stoptimes.items():
        rid = trips[tid][0]
        if rid not in best or len(lst) > len(stoptimes[best[rid]]): best[rid] = tid
    shape_of = {}
    if best:
        want = set(best.values())
        for r in read_csv(z, "trips.txt"):
            if r.get("trip_id") in want and r.get("shape_id"): shape_of[r["trip_id"]] = r["shape_id"]
    shapes = {}
    if shape_of:
        need = set(shape_of.values())
        for r in read_csv(z, "shapes.txt"):
            sid = r.get("shape_id")
            if sid in need:
                try: shapes.setdefault(sid, []).append((int(float(r.get("shape_pt_sequence") or 0)), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
                except Exception: pass
    lines = {}
    for rid, tid in best.items():
        pts = None
        sh = shapes.get(shape_of.get(tid))
        if sh and len(sh) > 1:
            sh.sort(); step = max(1, len(sh) // 200); pts = [[round(a, 5), round(b, 5)] for _, a, b in sh[::step]] + [[round(sh[-1][1], 5), round(sh[-1][2], 5)]]
        else:
            pts = [stops[sid][1:] for _, sid, _ in stoptimes[tid] if sid in stops]
        if len(pts) > 1: lines[rid] = pts
    os.makedirs(os.path.join(outdir, "data", feed["id"]), exist_ok=True)
    dump(os.path.join(outdir, "data", feed["id"], "lines.json"), lines)
    dump(os.path.join(base, "meta.json"), {"date": today.isoformat(), "buckets": n, "routes": used_routes, "stops": stops})
    for i in range(n):
        dump(os.path.join(base, "t", f"{i}.json"), tsh[i]); dump(os.path.join(base, "s", f"{i}.json"), ssh[i])
    return {"date": today.isoformat(), "trips": len(stoptimes), "stops": len(stops), "buckets": n, "lines": len(lines)}

def dump(path, obj):
    with open(path, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

def main():
    base = json.load(open(os.path.join(ROOT, "feeds.base.json"), encoding="utf-8"))
    feeds = [f for f in base if f.get("enabled", True)]
    for f in feeds:
        if f.get("discover") == "fgc":
            try: discover_fgc(f)
            except Exception as e: log("FGC:", e)
    feeds += discover_euskadi({f.get("url") for f in feeds}, feeds)
    os.makedirs(OUT, exist_ok=True)
    for f in feeds:
        if not f.get("gtfs"): continue
        try:
            info = build_feed(f, OUT); f["timetable"] = info
            log(f"✓ {f['id']}: {info['trips']} viajes hoy, {info['stops']} paradas")
        except Exception as e:
            log(f"✗ {f['id']}: {e}")
    by_id = {f["id"]: f for f in feeds}
    for f in feeds:
        src = by_id.get(f.get("shareTimetable") or "")
        if src and src.get("timetable"): f["timetable"] = dict(src["timetable"], source=src["id"])
        f.pop("shareTimetable", None)
    for f in feeds: f.pop("gtfs", None); f.pop("discover", None)
    feeds = [f for f in feeds if f.get("url") or f.get("timetable")]
    dump(os.path.join(OUT, "feeds.json"), feeds)
    log(f"feeds.json con {len(feeds)} operadores")
    try:
        m = json.load(open(os.path.join(OUT, "data", "renfe-cercanias", "meta.json"), encoding="utf-8"))
        log(f"control: Cercanías tiene {len(m['routes'])} líneas en el horario")
    except Exception: pass

if __name__ == "__main__":
    main()
