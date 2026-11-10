/** Pessoas & Cultura · Etapa 2: feed, rascunho, edição, exclusão, reações, comentários, salvos, mídias e visibilidade. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, mariana: Client, outro: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

async function upload(c: Client, filename: string, data: Buffer, part = 2_500_000) {
  const id = randomUUID();
  const parts = Math.ceil(data.length / part);
  for (let n = 0; n < parts; n++) ok(await c.put(`/pessoas/midias/envios/${id}/partes/${n}`, { data: data.subarray(n * part, (n + 1) * part).toString('base64') }), 204);
  return c.post(`/pessoas/midias/envios/${id}/concluir`, { filename, parts, sizeBytes: data.length });
}

beforeAll(async () => {
  ctx = await makeApp();
  // piloto: libera o módulo para as pessoas do teste (Mariana fica de fora até o fim)
  for (const e of ['carlos@yepnet.test', 'lucas@yepnet.test', 'ana@yepnet.test', 'vendedor@outro.test']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason)
      select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste do feed' from users where email = ${e}
      on conflict (tenant_id, module, subject_type, subject_id) do update set effect = 'liberar'`);
  }
  [carlos, lucas, ana, mariana, outro] = (await Promise.all(['carlos', 'lucas', 'ana', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)).concat(login(ctx.app, 'vendedor@outro.test')))) as [Client, Client, Client, Client, Client];
});
afterAll(async () => { await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`); await ctx.close(); });

describe('Pessoas & Cultura · feed', () => {
  let postId = '';
  it('publica com menção; colegas veem; outra empresa e quem não foi liberado não', async () => {
    const p = ok(await lucas.post('/pessoas/posts', { body: 'Bati a meta do trimestre! Valeu, **time**.', mentions: [ana.me.user.id, outro.me.user.id] }), 201).json();
    postId = p.id;
    expect(p).toMatchObject({ kind: 'social', status: 'publicado', audienceLabel: 'Toda a empresa', mine: true, reactionCount: 0, commentCount: 0 });
    expect(p.mentions).toEqual([{ id: ana.me.user.id, name: 'Ana Souza' }]); // menção a outra empresa é descartada
    const feed = ok(await ana.get('/pessoas/feed')).json();
    expect(feed.items[0]).toMatchObject({ id: postId, mine: false, author: { name: 'Lucas Lima' } });
    expect(ok(await outro.get('/pessoas/feed')).json().items.map((x: { id: string }) => x.id)).not.toContain(postId);
    expect((await outro.get(`/pessoas/posts/${postId}`)).statusCode).toBe(404);
    expect((await mariana.get('/pessoas/feed')).statusCode).toBe(403);
    expect((await lucas.post('/pessoas/posts', { body: '' })).statusCode).toBe(422);
  });

  it('em nome da empresa só com o papel de Comunicação', async () => {
    expect((await lucas.post('/pessoas/posts', { body: 'Comunicado', kind: 'institucional' })).statusCode).toBe(403);
    ok(await carlos.put('/pessoas/config', { roles: { comunicacao: ['inteligencia_comercial'], pessoasCultura: [], moderacao: [] } }));
    const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
    ok(await carlos.patch(`/admin/users/${users.find((u) => u.email === 'ana@yepnet.test')!.id}`, { sectors: ['inteligencia_comercial'] }));
    ana = await login(ctx.app, 'ana@yepnet.test');
    expect(ok(await ana.post('/pessoas/posts', { body: 'Bem-vindos ao novo espaço!', kind: 'institucional' }), 201).json().kind).toBe('institucional');
  });

  it('rascunho só para o autor; publicar o rascunho; editar e excluir só o próprio', async () => {
    const d = ok(await lucas.post('/pessoas/posts', { body: 'Rascunho em andamento', status: 'rascunho' }), 201).json();
    expect(ok(await lucas.get('/pessoas/rascunhos')).json().items.map((x: { id: string }) => x.id)).toContain(d.id);
    expect((await ana.get(`/pessoas/posts/${d.id}`)).statusCode).toBe(404);
    expect(ok(await ana.get('/pessoas/feed')).json().items.map((x: { id: string }) => x.id)).not.toContain(d.id);
    expect((await ana.put(`/pessoas/posts/${d.id}/reacao`, { kind: 'curtir' })).statusCode).toBe(404);
    const pub = ok(await lucas.patch(`/pessoas/posts/${d.id}`, { body: 'Rascunho publicado', status: 'publicado' })).json();
    expect(pub).toMatchObject({ status: 'publicado', body: 'Rascunho publicado', editedAt: null });
    expect((await ana.patch(`/pessoas/posts/${d.id}`, { body: 'invasão' })).statusCode).toBe(403);
    expect(ok(await lucas.patch(`/pessoas/posts/${d.id}`, { body: 'Corrigido' })).json().editedAt).not.toBeNull();
    expect((await ana.del(`/pessoas/posts/${d.id}`)).statusCode).toBe(403);
    ok(await lucas.del(`/pessoas/posts/${d.id}`), 204);
    expect((await ana.get(`/pessoas/posts/${d.id}`)).statusCode).toBe(404);
  });

  it('reações (uma por pessoa, troca e remove), comentários com resposta, edição e remoção; salvos', async () => {
    let p = ok(await ana.put(`/pessoas/posts/${postId}/reacao`, { kind: 'curtir' })).json();
    expect(p).toMatchObject({ reactionCount: 1, myReaction: 'curtir', reactions: { curtir: 1 } });
    p = ok(await ana.put(`/pessoas/posts/${postId}/reacao`, { kind: 'celebrar' })).json();
    expect(p).toMatchObject({ reactionCount: 1, myReaction: 'celebrar', reactions: { celebrar: 1 } });
    ok(await carlos.put(`/pessoas/posts/${postId}/reacao`, { kind: 'apoiar' }));
    p = ok(await ana.del(`/pessoas/posts/${postId}/reacao`)).json();
    expect(p).toMatchObject({ reactionCount: 1, myReaction: null });
    expect((await ana.put(`/pessoas/posts/${postId}/reacao`, { kind: 'raiva' })).statusCode).toBe(422);

    const c1 = ok(await ana.post(`/pessoas/posts/${postId}/comentarios`, { body: 'Parabéns!' }), 201).json();
    const r1 = ok(await lucas.post(`/pessoas/posts/${postId}/comentarios`, { body: 'Obrigado, @Ana Souza', parentId: c1.id, mentions: [ana.me.user.id] }), 201).json();
    const r2 = ok(await carlos.post(`/pessoas/posts/${postId}/comentarios`, { body: 'Também!', parentId: r1.id }), 201).json();
    expect(r2.parentId).toBe(c1.id); // resposta da resposta fica na mesma conversa
    expect((await lucas.patch(`/pessoas/comentarios/${c1.id}`, { body: 'x' })).statusCode).toBe(403);
    ok(await ana.patch(`/pessoas/comentarios/${c1.id}`, { body: 'Parabéns, Lucas!' }));
    ok(await carlos.del(`/pessoas/comentarios/${r2.id}`), 204);
    const d = ok(await carlos.get(`/pessoas/posts/${postId}`)).json();
    expect(d.post.commentCount).toBe(2);
    expect(d.comments.map((c: { body: string; parentId: string | null }) => [c.body, c.parentId])).toEqual([['Parabéns, Lucas!', null], ['Obrigado, @Ana Souza', c1.id]]);
    expect(d.comments[0].editedAt).not.toBeNull();
    expect(d.comments[1].mentions).toEqual([{ id: ana.me.user.id, name: 'Ana Souza' }]);

    ok(await carlos.put(`/pessoas/posts/${postId}/salvo`), 204);
    expect(ok(await carlos.get('/pessoas/feed?salvos=1')).json().items.map((x: { id: string; saved: boolean }) => [x.id, x.saved])).toEqual([[postId, true]]);
    ok(await carlos.del(`/pessoas/posts/${postId}/salvo`), 204);
    expect(ok(await carlos.get('/pessoas/feed?salvos=1')).json().items).toEqual([]);
  });

  it('mídias: tipo pelos bytes, limite por tipo, só o dono usa; vídeo servido em partes conforme a visibilidade', async () => {
    const img = ok(await upload(lucas, 'foto.png', PNG), 201).json();
    expect(img).toMatchObject({ kind: 'imagem', mime: 'image/png' });
    expect((await upload(lucas, 'virus.png', Buffer.from('MZ\x90\x00 executavel'))).statusCode).toBe(422);
    expect((await upload(lucas, 'pagina.png', Buffer.from('<svg onload=alert(1)></svg>'))).statusCode).toBe(422);
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(6_000_000, 3)]);
    const vid = ok(await upload(lucas, 'apresentacao.mp4', video), 201).json();
    expect(vid).toMatchObject({ kind: 'video', mime: 'video/mp4', sizeBytes: video.length });
    // mídia solta: só o dono vê; ninguém usa a mídia de outro
    expect((await ana.get(`/pessoas/midias/${img.id}`)).statusCode).toBe(404);
    expect((await ana.post('/pessoas/posts', { body: 'roubo', mediaIds: [img.id] })).statusCode).toBe(422);
    const p = ok(await lucas.post('/pessoas/posts', { body: 'Nosso evento', mediaIds: [vid.id, img.id] }), 201).json();
    expect(p.media.map((m: { id: string }) => m.id)).toEqual([vid.id, img.id]);
    // o player pede por intervalos; cada resposta vem com no máximo ~3 MB
    const r = await ana.get(`/pessoas/midias/${vid.id}`);
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes 0-2999999/${video.length}`);
    const tail = await ctx.app.inject({ method: 'GET', url: `/api/v1/pessoas/midias/${vid.id}`, headers: { cookie: ana.cookie, range: `bytes=5999990-` } });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.length).toBe(video.length - 5_999_990);
    expect((await outro.get(`/pessoas/midias/${vid.id}`)).statusCode).toBe(404);
    const imgR = await ana.get(`/pessoas/midias/${img.id}`);
    expect(imgR.headers['content-type']).toBe('image/png');
    expect(imgR.headers['x-content-type-options']).toBe('nosniff');
    // limite configurado (vídeo até 1 MB)
    ok(await carlos.put('/pessoas/config', { roles: { comunicacao: ['inteligencia_comercial'], pessoasCultura: [], moderacao: [] }, limits: { videoMb: 1 } }));
    expect((await upload(lucas, 'grande.mp4', video)).json().detail).toMatch(/Vídeo acima de 1 MB/);
  });

  it('paginação por cursor sem repetir; relevantes prioriza interação recente', async () => {
    for (let i = 0; i < 7; i++) ok(await carlos.post('/pessoas/posts', { body: `Publicação ${i}` }), 201);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; next: string | null } = ok(await ana.get(`/pessoas/feed?limite=4${cursor ? `&cursor=${cursor}` : ''}`)).json();
      seen.push(...page.items.map((x: { id: string }) => x.id));
      cursor = page.next;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(10);
    const rel = ok(await ana.get('/pessoas/feed?ordem=relevantes&limite=30')).json();
    expect(rel.items[0].id).toBe(postId); // a com mais interações sobe
  });
});
