/**
 * Academia (Fase 1): conteúdo do YouTube (servidor falso), trilha com aprovação, público, inscrição, player (envios),
 * progresso real (parcial, avanço na barra, repetição, envio forjado, duas sessões, retomada), indisponível, atribuição,
 * acompanhamento da liderança, sincronização de playlist e versão fixa de quem já entrou.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
let server: Server, base = '';
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36).slice(-6);
const vid = (n: number) => `ac${st}${String(n).padStart(3, '0')}`.slice(0, 11).padEnd(11, 'x');
const V1 = vid(1), V2 = vid(2), V3 = vid(3), V4 = vid(4), PRIV = vid(8), GONE = vid(9);
const PL = `PLacad${st}0000000000000000`;
const DUR: Record<string, number> = { [V1]: 100, [V2]: 200, [V3]: 300, [V4]: 60 };
let playlist = [V1, V2, V3];
let residencial = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const json = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/oembed') {
      const id = new URL(u.searchParams.get('url')!).searchParams.get('v')!;
      if (id === PRIV) return json(401, {});
      if (id === GONE) return json(404, {});
      return json(200, { title: `Vídeo ${id}`, author_name: 'Canal Fictício', thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
    }
    if (u.searchParams.get('key') !== 'yt-key-ficticia') return json(400, { error: { message: 'bad key', errors: [{ reason: 'keyInvalid' }] } });
    if (u.pathname === '/playlists') return json(200, { items: u.searchParams.get('id') === PL ? [{ snippet: { title: 'Playlist Fictícia', channelTitle: 'Canal Fictício' } }] : [] });
    if (u.pathname === '/playlistItems') {
      // duas páginas, para conferir a paginação; um vídeo removido aparece na lista e não volta em videos.list
      const all = [...playlist, GONE];
      const page = u.searchParams.get('pageToken') === 'p2' ? all.slice(2) : all.slice(0, 2);
      return json(200, { items: page.map((v) => ({ contentDetails: { videoId: v } })), ...(u.searchParams.get('pageToken') ? {} : { nextPageToken: 'p2' }) });
    }
    if (u.pathname === '/videos') {
      const ids = u.searchParams.get('id')!.split(',');
      return json(200, { items: ids.filter((i) => DUR[i]).map((i) => ({ id: i, snippet: { title: `Aula ${i}`, channelTitle: 'Canal Fictício' }, contentDetails: { duration: `PT${Math.floor(DUR[i]! / 60)}M${DUR[i]! % 60}S` }, status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' } })) });
    }
    json(404, {});
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.YOUTUBE_OEMBED_URL = `${base}/oembed`;
  process.env.YOUTUBE_API_BASE = base;
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  residencial = (await ctx.db.execute<{ id: string }>(sql`select id from teams where name = 'Residencial'`)).rows[0]!.id;
});
afterAll(async () => {
  await ctx.db.execute(sql`update integrations set enabled = false where kind = 'youtube'`);
  server.close();
  await ctx.close();
});

const trackBody = (over: Record<string, unknown> = {}) => ({ title: `Onboarding Comercial ${st}`, description: 'Primeiros passos do time.', objectives: ['Conhecer o processo'], competencies: ['Negociação'], ownerTeamId: residencial, visibility: 'compartilhado', teamIds: [residencial], minWatchPct: 90, progressMethod: 'quantidade', ...over });
/** recua o relógio do servidor para a sessão (como se a pessoa tivesse assistido por N segundos) */
const elapse = async (sessionId: string, seconds: number) => {
  await ctx.db.execute(sql`update academy_play_sessions set created_at = now() - make_interval(secs => ${seconds}) where id = ${sessionId}`);
  await ctx.db.execute(sql`update academy_lesson_progress p set last_credit_at = now() - make_interval(secs => ${seconds}) from academy_play_sessions s where s.id = ${sessionId} and p.user_id = s.user_id and p.lesson_id = s.lesson_id and p.last_credit_at is not null`);
};

describe('Academia — Fase 1', () => {
  let trackId = '', lessons: { id: string; title: string }[] = [], contents: Record<string, string> = {}, playlistRow = '';

  it('conteúdo: vídeo avulso sem chave (oEmbed); playlist exige a chave; com a chave importa na ordem, com duração', async () => {
    expect((await lucas.post('/academia/conteudos', { input: V4 })).statusCode).toBe(403);
    const a = ok(await ana.post('/academia/conteudos', { input: `https://youtu.be/${V4}` })).json();
    expect(a.content).toMatchObject({ kind: 'youtube_video', externalId: V4, state: 'disponivel', durationSeconds: null, channel: 'Canal Fictício' });
    contents[V4] = a.content.id;
    expect(ok(await ana.post('/academia/conteudos', { input: PRIV })).json().content.state).toBe('sem_incorporacao');
    expect((await ana.post('/academia/conteudos', { input: GONE })).statusCode).toBe(422);
    const noKey = await ana.post('/academia/conteudos', { input: `https://www.youtube.com/playlist?list=${PL}` });
    expect(noKey.statusCode).toBe(422);
    expect(noKey.json().detail).toContain('chave da YouTube Data API');
    expect((await ana.post('/academia/conteudos', { input: 'javascript:alert(1)', title: 'x' })).statusCode).toBe(422);
    ok(await carlos.put('/admin/integrations/youtube', { enabled: true, config: {}, secrets: { apiKey: 'yt-key-ficticia' } }));
    // a chave não volta para a tela
    expect(JSON.stringify(ok(await carlos.get('/admin/integrations')).json())).not.toContain('yt-key-ficticia');
    const p = ok(await ana.post('/academia/conteudos', { input: `https://www.youtube.com/playlist?list=${PL}` })).json();
    expect(p.playlist).toMatchObject({ title: 'Playlist Fictícia', missing: 1 });
    expect(p.contents.map((c: { externalId: string; durationSeconds: number }) => [c.externalId, c.durationSeconds])).toEqual([[V1, 100], [V2, 200], [V3, 300]]);
    for (const c of p.contents) contents[c.externalId] = c.id;
    playlistRow = p.playlist.id;
    const link = ok(await ana.post('/academia/conteudos', { input: 'https://exemplo.test/manual.pdf', title: 'Manual de apoio' })).json();
    contents.link = link.content.id;
  });

  it('trilha: cria, organiza, envia; quem enviou não aprova; Gerência publica; público respeitado', async () => {
    expect((await lucas.post('/academia/trilhas', trackBody())).statusCode).toBe(403);
    trackId = ok(await ana.post('/academia/trilhas', trackBody()), 201).json().id;
    let ed = ok(await ana.get(`/academia/trilhas/${trackId}/editor`)).json();
    expect(ed.errors).toContain('Inclua ao menos um curso.');
    expect((await ana.post(`/academia/trilhas/${trackId}/enviar`, {})).statusCode).toBe(422);
    const structure = {
      rowVersion: ed.track.rowVersion,
      courses: [{ title: 'Fundamentos', minWatchPct: null, modules: [
        { title: 'Playlist Fictícia', playlistId: playlistRow, lessons: [V1, V2, V3].map((v) => ({ contentId: contents[v], required: true })) },
        { title: 'Extra', lessons: [{ contentId: contents[V4], required: false, minWatchPct: 50 }, { contentId: contents.link, required: false, title: 'Manual de apoio' }] },
      ] }],
    };
    const sv = ok(await ana.put(`/academia/trilhas/${trackId}/estrutura`, structure)).json();
    expect((await ana.put(`/academia/trilhas/${trackId}/estrutura`, structure)).statusCode).toBe(409); // concorrência
    expect((await lucas.put(`/academia/trilhas/${trackId}/estrutura`, { ...structure, rowVersion: sv.rowVersion })).statusCode).toBe(403);
    ed = ok(await ana.get(`/academia/trilhas/${trackId}/editor`)).json();
    expect(ed.errors).toEqual([]);
    expect(ed.minutes).toBe(10); // 100+200+300 s; o avulso veio pelo oEmbed, sem duração (o player informa na 1ª reprodução)
    expect(ed.structure.courses[0].modules[0].lessons.map((l: { title: string }) => l.title)).toEqual([`Aula ${V1}`, `Aula ${V2}`, `Aula ${V3}`]);
    // não publicada: ninguém do público vê
    expect((await lucas.get(`/academia/trilhas/${trackId}`)).statusCode).toBe(403);
    const sub = ok(await ana.post(`/academia/trilhas/${trackId}/enviar`, { note: 'Primeira versão' })).json();
    expect(sub).toMatchObject({ number: 1, status: 'revisao_gerencia' });
    expect((await ana.post(`/academia/trilhas/${trackId}/enviar`, {})).statusCode).toBe(422); // uma por vez
    expect((await ana.post(`/academia/versoes/${sub.id}/decidir`, { decision: 'aprovar' })).statusCode).toBe(403);
    expect((await lucas.post(`/academia/versoes/${sub.id}/decidir`, { decision: 'aprovar' })).statusCode).toBe(403);
    expect((await carlos.post(`/academia/versoes/${sub.id}/decidir`, { decision: 'rejeitar' })).statusCode).toBe(422); // motivo obrigatório
    const g = ok(await carlos.get('/academia/gestao')).json().items.find((x: { id: string }) => x.id === trackId);
    expect(g).toMatchObject({ can: { decide: true }, open: { number: 1 } });
    ok(await carlos.post(`/academia/versoes/${sub.id}/decidir`, { decision: 'aprovar' }));
    // aviso no sino de quem enviou
    const n = (await ctx.db.execute<{ type: string }>(sql`select type from governance_events where entity = 'academia' and entity_id = ${trackId} order by created_at`)).rows.map((r) => r.type);
    expect(n).toEqual(['academia_enviada', 'academia_publicada']);
    expect(ok(await lucas.get('/academia/catalogo')).json().items.some((x: { id: string }) => x.id === trackId)).toBe(true);
    expect(ok(await mariana.get('/academia/catalogo')).json().items.some((x: { id: string }) => x.id === trackId)).toBe(false);
    expect((await mariana.get(`/academia/trilhas/${trackId}`)).statusCode).toBe(403);
    expect((await mariana.post(`/academia/trilhas/${trackId}/inscrever`)).statusCode).toBe(403);
    const page = ok(await lucas.get(`/academia/trilhas/${trackId}`)).json();
    expect(page.me).toBeNull();
    lessons = page.courses[0].modules.flatMap((m: { lessons: { id: string; title: string }[] }) => m.lessons);
    expect(lessons).toHaveLength(5);
    expect(page.courses[0].modules[1].lessons[0]).toMatchObject({ required: false, minPct: 50 });
  });

  it('progresso real: parcial, repetição, envio repetido, avanço na barra, envio forjado, duas sessões, retomada após novo login', async () => {
    const L1 = lessons[0]!.id;
    expect((await lucas.get(`/academia/trilhas/${trackId}/aulas/${L1}`)).statusCode).toBe(403); // sem inscrição
    ok(await lucas.post(`/academia/trilhas/${trackId}/inscrever`));
    const ls = ok(await lucas.get(`/academia/trilhas/${trackId}/aulas/${L1}`)).json();
    expect(ls.lesson).toMatchObject({ videoId: V1, durationSeconds: 100, minPct: 90 });
    expect(ls.progress).toMatchObject({ pct: 0, resumeAt: 0 });
    const s1 = ok(await lucas.post(`/academia/trilhas/${trackId}/aulas/${L1}/sessao`, { clientSessionId: `aba-1-${st}`, device: 'teste' })).json();
    // outra pessoa não usa a sessão
    expect((await ana.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 1, intervals: [[0, 10]], position: 10 })).statusCode).toBe(404);
    await elapse(s1.sessionId, 30);
    let b = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 1, intervals: [[0, 30]], position: 30 })).json();
    expect(b).toMatchObject({ credited: 30, watchedSeconds: 30, pct: 30, done: false });
    // o mesmo envio de novo (rede instável) não soma
    b = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 1, intervals: [[0, 30]], position: 30 })).json();
    expect(b).toMatchObject({ duplicate: true, watchedSeconds: 30 });
    // rever o mesmo trecho não soma
    await elapse(s1.sessionId, 30);
    b = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 2, intervals: [[0, 30]], position: 30 })).json();
    expect(b).toMatchObject({ credited: 0, watchedSeconds: 30 });
    // arrastou de 30 para 80 e assistiu 10 s: só os 10 s contam
    await elapse(s1.sessionId, 10);
    b = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 3, intervals: [[80, 90]], position: 90 })).json();
    expect(b).toMatchObject({ credited: 10, watchedSeconds: 40, pct: 40 });
    // envio forjado: 60 s de vídeo em 5 s de relógio → no máximo 5×2+5
    await elapse(s1.sessionId, 5);
    b = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 4, intervals: [[30, 80]], position: 80 })).json();
    expect(b.credited).toBeLessThanOrEqual(15.5); // + milissegundos reais da requisição
    expect(b.rejected).toBeGreaterThanOrEqual(34.5);
    const afterForge = b.watchedSeconds;
    // segunda aba ao mesmo tempo: o relógio é o mesmo, então não dobra
    const s2 = ok(await lucas.post(`/academia/trilhas/${trackId}/aulas/${L1}/sessao`, { clientSessionId: `aba-2-${st}`, device: 'celular' })).json();
    expect(s2.sessionId).not.toBe(s1.sessionId);
    b = ok(await lucas.post(`/academia/sessoes/${s2.sessionId}/batida`, { seq: 1, intervals: [[90, 100]], position: 100 })).json();
    const c2 = ok(await lucas.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 5, intervals: [[40, 50]], position: 50 })).json();
    expect(b.credited + c2.credited).toBeLessThanOrEqual(10.5); // folga de 5 s por envio, sem relógio novo
    // pausa: retoma de onde parou, mesmo após sair e entrar de novo
    const again = await login(ctx.app, 'lucas@yepnet.test');
    const back = ok(await again.get(`/academia/trilhas/${trackId}/aulas/${L1}`)).json();
    expect(back.progress.resumeAt).toBe(50);
    expect(back.progress.watchedSeconds).toBe(c2.watchedSeconds);
    expect(c2.watchedSeconds).toBeGreaterThanOrEqual(afterForge);
    // terminar de verdade: com relógio suficiente, chega a 100% e conclui (mínimo 90%)
    await elapse(s1.sessionId, 120);
    b = ok(await again.post(`/academia/sessoes/${s1.sessionId}/batida`, { seq: 6, intervals: [[0, 100]], position: 100, ended: true })).json();
    expect(b).toMatchObject({ pct: 100, done: true });
    expect(b.track.pct).toBeCloseTo(33.3, 0); // 1 de 3 obrigatórias (método A)
    expect(ok(await again.get(`/academia/trilhas/${trackId}/aulas/${L1}`)).json().progress).toMatchObject({ done: true, resumeAt: 0 });
    const minha = ok(await again.get('/academia/minha')).json();
    expect(minha.inProgress.map((c: { id: string }) => c.id)).toContain(trackId);
    expect(minha.next).toMatchObject({ trackId, lessonId: lessons[1]!.id });
  });

  it('vídeo que ficou indisponível sai da conta; trilha conclui com as obrigatórias disponíveis', async () => {
    await ctx.db.execute(sql`update academy_contents set state = 'removido' where id = ${contents[V3]}`);
    const L2 = lessons[1]!.id;
    const s = ok(await lucas.post(`/academia/trilhas/${trackId}/aulas/${L2}/sessao`, { clientSessionId: `aba-3-${st}` })).json();
    await elapse(s.sessionId, 200);
    const b = ok(await lucas.post(`/academia/sessoes/${s.sessionId}/batida`, { seq: 1, intervals: [[0, 185]], position: 185 })).json();
    expect(b).toMatchObject({ done: true, track: { complete: true, pct: 100 } }); // 185/200 = 92,5% ≥ 90%
    const page = ok(await lucas.get(`/academia/trilhas/${trackId}`)).json();
    expect(page.progress).toMatchObject({ unavailable: 1, doneRequired: 2, totalRequired: 2 });
    expect(page.me.status).toBe('concluida');
    const L3 = page.courses[0].modules[0].lessons[2];
    expect(L3).toMatchObject({ available: false, state: 'removido' });
    // o envio indisponível não abre sessão de player só por existir — a tela mostra o aviso (aqui conferimos o estado)
    await ctx.db.execute(sql`update academy_contents set state = 'disponivel' where id = ${contents[V3]}`);
  });

  it('atribuição, acompanhamento da liderança e permissões', async () => {
    const mar = (await ctx.db.execute<{ id: string }>(sql`select id from users where email = 'mariana@yepnet.test'`)).rows[0]!.id;
    expect((await lucas.post(`/academia/trilhas/${trackId}/atribuir`, { userIds: [mar] })).statusCode).toBe(403);
    expect((await ana.post(`/academia/trilhas/${trackId}/atribuir`, { userIds: [mar], dueOn: '2000-01-01' })).statusCode).toBe(422);
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect(ok(await ana.post(`/academia/trilhas/${trackId}/atribuir`, { userIds: [mar], dueOn: due })).json()).toEqual({ added: 1, already: 0 });
    expect(ok(await ana.post(`/academia/trilhas/${trackId}/atribuir`, { userIds: [mar] })).json()).toEqual({ added: 0, already: 1 });
    // atribuída: Mariana (fora do público) passa a ver e é avisada
    const m = ok(await mariana.get('/academia/minha')).json();
    expect(m.required.map((c: { id: string }) => c.id)).toContain(trackId);
    expect(ok(await mariana.get(`/academia/trilhas/${trackId}`)).json().me).toMatchObject({ source: 'atribuida', dueOn: due, status: 'nao_iniciada' });
    // acompanhamento: operação não acessa; liderança vê o time que lidera; Gerência vê todos
    expect((await lucas.get('/academia/acompanhamento')).statusCode).toBe(403);
    const a = ok(await ana.get(`/academia/acompanhamento?trilha=${trackId}`)).json();
    const row = a.tracks.find((t: { id: string }) => t.id === trackId);
    expect(row.completed).toBeGreaterThanOrEqual(1);
    expect(a.people.find((p: { name: string }) => p.name === 'Lucas Lima')).toMatchObject({ status: 'concluida', pct: 66.7 }); // concluiu quando o 3º vídeo estava fora; ele voltou: a conclusão fica, o percentual mostra o observado
    expect(a.people.some((p: { name: string }) => p.name === 'Mariana Costa')).toBe(false); // Governo não é time da Ana
    const c = ok(await carlos.get(`/academia/acompanhamento?trilha=${trackId}`)).json();
    expect(c.scope.all).toBe(true);
    expect(c.people.find((p: { name: string }) => p.name === 'Mariana Costa')).toMatchObject({ status: 'nao_iniciada', source: 'atribuida' });
    expect(c.tracks.find((t: { id: string }) => t.id === trackId).hours).toBeGreaterThan(0);
  });

  it('playlist mudou: a sincronização aponta o que entrou e saiu; nova versão não muda a de quem já entrou', async () => {
    playlist = [V1, V2, V4];
    const sy = ok(await ana.post(`/academia/trilhas/${trackId}/sincronizar`)).json();
    expect(sy.playlists[0]).toMatchObject({ module: 'Playlist Fictícia', added: 1, removed: 1 });
    const ed = ok(await ana.get(`/academia/trilhas/${trackId}/editor`)).json();
    const s = ed.structure;
    const structure = { rowVersion: ed.track.rowVersion, courses: s.courses.map((c: any) => ({ id: c.id, title: c.title, minWatchPct: c.minWatchPct, modules: c.modules.map((m: any, i: number) => ({ id: m.id, title: m.title, lessons: m.lessons.filter((l: any) => i !== 0 || l.contentId !== contents[V3]).map((l: any) => ({ id: l.id, contentId: l.contentId, required: l.required, minWatchPct: l.minWatchPct })) })) })) };
    ok(await ana.put(`/academia/trilhas/${trackId}/estrutura`, structure));
    expect(ok(await ana.get(`/academia/trilhas/${trackId}/editor`)).json()).toMatchObject({ changed: true, can: { submit: true } });
    const v2 = ok(await ana.post(`/academia/trilhas/${trackId}/enviar`, {})).json();
    ok(await carlos.post(`/academia/versoes/${v2.id}/decidir`, { decision: 'aprovar' }));
    // Lucas segue na versão 1 (concluída); quem entra agora pega a 2
    const lp = ok(await lucas.get(`/academia/trilhas/${trackId}`)).json();
    expect(lp.track.version).toBe(1);
    expect(lp.newerVersion).toBe(true);
    expect(lp.courses[0].modules[0].lessons).toHaveLength(3);
    // progresso por aula: a aula 1 (mesmo id na versão 2) continua concluída para quem entrar na nova versão
    const anaPage = ok(await ana.post(`/academia/trilhas/${trackId}/inscrever`));
    expect(anaPage.statusCode).toBe(200);
    expect(ok(await ana.get(`/academia/trilhas/${trackId}`)).json().courses[0].modules[0].lessons).toHaveLength(2);
  });
});
