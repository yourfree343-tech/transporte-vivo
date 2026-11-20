// Intermediario propio para Transporte Vivo (Vercel, plan gratuito).
// Lee los feeds de los operadores desde el servidor y los devuelve con permiso CORS.
const ALLOWED = [/(^|\.)renfe\.com$/, /(^|\.)euskadi\.eus$/, /\.amazonaws\.com$/, /(^|\.)emtmalaga\.es$/,
  /(^|\.)optibus\.co$/, /\.supabase\.co$/, /(^|\.)bilbao\.eus$/, /(^|\.)ctb\.eus$/, /(^|\.)fgc\.cat$/, /(^|\.)opendatasoft\.com$/];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const target = req.query.url;
  let host;
  try { host = new URL(target).hostname; } catch { return res.status(400).send('falta ?url='); }
  if (!ALLOWED.some(r => r.test(host))) return res.status(403).send('host no permitido');
  try {
    const r = await fetch(target, { headers: { 'User-Agent': 'TransporteVivo/1.0' }, signal: AbortSignal.timeout(12000) });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    return res.status(r.status).send(buf);
  } catch (e) {
    return res.status(502).send('el operador no responde');
  }
}
