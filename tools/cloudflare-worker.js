// Proxy propio y gratuito para Transporte Vivo (Cloudflare Workers, plan gratis).
// 1) dash.cloudflare.com → Workers → Create → pega este código → Deploy
// 2) crea config.json en el repo con: { "proxy": "https://TU-WORKER.workers.dev/?url=" }
const ALLOWED = [/renfe\.com$/, /euskadi\.eus$/, /amazonaws\.com$/, /emtmalaga\.es$/, /optibus\.co$/, /supabase\.co$/, /bilbao\.eus$/];
export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get('url');
    if (!target) return new Response('falta ?url=', { status: 400 });
    const host = new URL(target).hostname;
    if (!ALLOWED.some(r => r.test(host))) return new Response('host no permitido', { status: 403 });
    const r = await fetch(target, { cf: { cacheTtl: 10 } });
    const h = new Headers(r.headers);
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(r.body, { status: r.status, headers: h });
  },
};
