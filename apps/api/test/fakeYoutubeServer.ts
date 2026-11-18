/** YouTube SIMULADO (só o oEmbed) para o E2E da Academia. Vídeo cujo código começa com "zzpriv" responde 401 (incorporação desligada). Nunca use em produção. */
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_YOUTUBE_PORT ?? 3397);
createServer((req, res) => {
  const u = new URL(req.url!, 'http://x');
  const json = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname === '/__test/health') return json(200, { ok: true });
  if (u.pathname === '/oembed') {
    let id = '';
    try { id = new URL(u.searchParams.get('url') ?? '').searchParams.get('v') ?? ''; } catch { /* inválido */ }
    if (!id) return json(400, {});
    if (id.startsWith('zzpriv')) return json(401, {});
    return json(200, { title: `Aula simulada ${id}`, author_name: 'Canal Fictício', thumbnail_url: `data:image/gif;base64,R0lGODlhAQABAAAAACw=` });
  }
  json(404, {});
}).listen(port, '127.0.0.1', () => console.log(`YouTube simulado em http://127.0.0.1:${port}`));
