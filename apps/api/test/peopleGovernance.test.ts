/** Pessoas & Cultura · Etapa 5: denúncias e moderação, notificações (preferências e entregas) e painel administrativo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, mariana: Client;
let tenantId = '';
const startedAt = new Date();
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const tag = Date.now().toString(36);
const avisos = async (c: Client) => ok(await c.get('/pessoas/notificacoes')).json().items as { id: string; event: string; title: string; body: string | null; link: string; readAt: string | null }[];

beforeAll(async () => {
  ctx = await makeApp();
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  for (const e of ['carlos', 'lucas', 'ana', 'rafael', 'mariana']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste governança' from users where email = ${`${e}@yepnet.test`}`);
  }
  tenantId = ((await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string }).tenant_id;
  // Carlos = Comunicação/Pessoas e Cultura (setor administracao); Mariana = Moderação (setor comercial)
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`insert into people_settings (tenant_id, settings) values (${tenantId}, ${JSON.stringify({ roles: { comunicacao: ['administracao'], pessoasCultura: ['administracao'], moderacao: ['comercial'] } })}::jsonb)`);
  await ctx.db.execute(sql`update users set sectors = '{administracao}' where email = 'carlos@yepnet.test'`);
  await ctx.db.execute(sql`update users set sectors = '{comercial}' where email = 'mariana@yepnet.test'`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email in ('ana@yepnet.test','lucas@yepnet.test','rafael@yepnet.test')`);
  [carlos, lucas, ana, rafael, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client, Client];
});
afterAll(async () => {
  // o que este arquivo criou sai de cena para não mexer nas contagens dos outros testes
  await ctx.db.execute(sql`update people_posts set deleted_at = now() where created_at >= ${startedAt} and deleted_at is null`);
  await ctx.db.execute(sql`update people_announcements set status = 'encerrado', closed_at = now() where created_at >= ${startedAt}`);
  await ctx.db.execute(sql`update people_communities set status = 'arquivada', archived_at = now() where created_at >= ${startedAt}`);
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`delete from user_notification_prefs`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email in ('carlos@yepnet.test', 'mariana@yepnet.test')`);
  await ctx.close();
});

describe('Pessoas & Cultura · denúncias e moderação', () => {
  it('denunciar, decidir com justificativa, avisar, pedir revisão e revisar com outra pessoa', async () => {
    const post = ok(await lucas.post('/pessoas/posts', { body: `Texto polêmico ${tag}` }), 201).json();
    expect((await lucas.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'ofensivo' })).statusCode).toBe(422); // o próprio
    expect((await ana.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'outro' })).statusCode).toBe(422); // "outros" pede detalhe
    const rep = ok(await ana.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'ofensivo', details: 'Tom agressivo' }), 201).json();
    expect((await ana.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'spam' })).statusCode).toBe(409); // uma por pessoa
    ok(await rafael.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'inadequado' }), 201);

    expect((await rafael.get('/pessoas/moderacao/denuncias')).statusCode).toBe(403);
    const queue = ok(await mariana.get('/pessoas/moderacao/denuncias')).json().items.filter((r: { targetId: string }) => r.targetId === post.id);
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ snapshot: { body: `Texto polêmico ${tag}` }, author: { name: 'Lucas Lima' }, sameTarget: 2, contentStatus: 'publicado' });

    ok(await mariana.post(`/pessoas/moderacao/denuncias/${rep.id}/assumir`, {}));
    expect((await mariana.post(`/pessoas/moderacao/denuncias/${rep.id}/decisao`, { measure: 'ocultar', justification: 'curto' })).statusCode).toBe(422);
    expect(ok(await mariana.post(`/pessoas/moderacao/denuncias/${rep.id}/decisao`, { measure: 'ocultar', justification: 'Linguagem fora do código de conduta.' })).json().reports).toBe(2);

    // fora do feed e do acesso direto para os outros; o autor vê o motivo, sem saber quem denunciou
    expect(ok(await ana.get('/pessoas/feed?limite=30')).json().items.map((p: { id: string }) => p.id)).not.toContain(post.id);
    expect((await ana.get(`/pessoas/posts/${post.id}`)).statusCode).toBe(404);
    const own = ok(await lucas.get(`/pessoas/posts/${post.id}`)).json();
    expect(own.post ?? own).toMatchObject({ status: 'oculto', moderation: { measure: 'ocultar', note: 'Linguagem fora do código de conduta.' } });
    const la = (await avisos(lucas)).find((n) => n.event === 'moderacao');
    expect(la).toMatchObject({ body: 'Linguagem fora do código de conduta.', link: '/pessoas/denuncias' });
    expect(JSON.stringify(ok(await lucas.get('/pessoas/denuncias')).json())).not.toMatch(/Ana|Rafael/);
    expect((await avisos(ana)).some((n) => n.event === 'moderacao' && n.title.includes('analisada'))).toBe(true);
    expect((await avisos(rafael)).some((n) => n.event === 'moderacao')).toBe(true);

    // revisão: pedida pelo autor, feita por outra pessoa da moderação
    const mine = ok(await lucas.get('/pessoas/denuncias')).json().aboutMe.find((r: { excerpt: string }) => r.excerpt.includes(tag));
    expect(mine.canRequestReview).toBe(true);
    ok(await lucas.post(`/pessoas/denuncias/${mine.id}/revisao`, { reason: 'Foi ironia entre colegas, posso reformular.' }));
    expect((await lucas.post(`/pessoas/denuncias/${mine.id}/revisao`, { reason: 'De novo, por favor revisar.' })).statusCode).toBe(422);
    const decidedBy = (ok(await mariana.get('/pessoas/moderacao/denuncias')).json().items.find((r: { id: string }) => r.id === mine.id));
    expect(decidedBy.status).toBe('em_revisao');
    expect((await mariana.post(`/pessoas/moderacao/denuncias/${mine.id}/decisao`, { measure: 'manter', justification: 'Revisão pela mesma pessoa.' })).statusCode).toBe(403);
    ok(await carlos.post(`/pessoas/moderacao/denuncias/${mine.id}/decisao`, { measure: 'manter', justification: 'Contexto entendido; conteúdo mantido.' }));
    expect(ok(await ana.get(`/pessoas/posts/${post.id}`)).json()).toBeTruthy();
    const hist = ok(await carlos.get(`/pessoas/moderacao/denuncias/${mine.id}/historico`)).json().items.map((a: { action: string }) => a.action);
    expect(hist).toEqual(expect.arrayContaining(['registro', 'triagem', 'decisao', 'pedido_revisao', 'revisao']));
  });

  it('pedir edição: comentário sai do ar e volta quando o autor edita', async () => {
    const post = ok(await carlos.post('/pessoas/posts', { body: `Base para comentário ${tag}` }), 201).json();
    const c = ok(await rafael.post(`/pessoas/posts/${post.id}/comentarios`, { body: 'Comentário com dado pessoal: CPF 000' }), 201).json();
    const rep = ok(await ana.post('/pessoas/denuncias', { targetType: 'comentario', targetId: c.id, reason: 'exposicao' }), 201).json();
    ok(await mariana.post(`/pessoas/moderacao/denuncias/${rep.id}/decisao`, { measure: 'solicitar_edicao', justification: 'Retire o dado pessoal do comentário.' }));
    const comments = async () => { const r = ok(await ana.get(`/pessoas/posts/${post.id}`)).json(); return JSON.stringify(r); };
    expect(await comments()).not.toContain('CPF 000');
    ok(await rafael.patch(`/pessoas/comentarios/${c.id}`, { body: 'Comentário sem dados pessoais', mentions: [] }));
    expect(await comments()).toContain('Comentário sem dados pessoais');
    const hist = ok(await mariana.get(`/pessoas/moderacao/denuncias/${rep.id}/historico`)).json().items.map((a: { action: string }) => a.action);
    expect(hist).toContain('edicao_autor');
  });

  it('comunidade privada: moderação vê só o item denunciado, não a comunidade', async () => {
    const priv = ok(await ana.post('/pessoas/comunidades', { name: `Privada ${tag}`, kind: 'privada' }), 201).json().id;
    ok(await ana.post(`/pessoas/comunidades/${priv}/convites`, { userIds: [lucas.me.user.id] }));
    const inv = ok(await lucas.get('/pessoas/comunidades-convites')).json().items.find((i: { community: { id: string } }) => i.community.id === priv);
    ok(await lucas.post(`/pessoas/comunidades-pedidos/${inv.id}/decisao`, { approve: true }));
    const post = ok(await ana.post('/pessoas/posts', { body: `Assunto interno ${tag}`, communityId: priv }), 201).json();
    ok(await ana.post('/pessoas/posts', { body: `Outro assunto sigiloso ${tag}`, communityId: priv }), 201);
    const rep = ok(await lucas.post('/pessoas/denuncias', { targetType: 'publicacao', targetId: post.id, reason: 'assedio' }), 201).json();
    const item = ok(await mariana.get('/pessoas/moderacao/denuncias')).json().items.find((r: { id: string }) => r.id === rep.id);
    expect(item.snapshot.body).toBe(`Assunto interno ${tag}`);
    expect((await mariana.get(`/pessoas/posts/${post.id}`)).statusCode).toBe(404);
    expect((await mariana.get(`/pessoas/feed?comunidade=${priv}`)).statusCode).toBe(403);
    expect((await mariana.post('/pessoas/moderacao/acao', { targetType: 'publicacao', targetId: post.id, measure: 'remover', justification: 'Ação sem denúncia em privada.' })).statusCode).toBe(404);
    ok(await mariana.post(`/pessoas/moderacao/denuncias/${rep.id}/decisao`, { measure: 'encaminhar', justification: 'Caso sensível: segue para o canal formal.', forwardedTo: 'Canal de Confiança (CIEI)' }));
    const content = JSON.stringify(ok(await mariana.get('/pessoas/admin/conteudos')).json());
    expect(content).not.toContain(`sigiloso ${tag}`); // o painel também não abre a privada
  });
});

describe('Pessoas & Cultura · notificações', () => {
  it('menção, comentário e resposta; sem duplicar; quem não vê a comunidade não é avisado; preferências', async () => {
    const post = ok(await carlos.post('/pessoas/posts', { body: `Olá @Ana ${tag}`, mentions: [ana.me.user.id] }), 201).json();
    ok(await carlos.patch(`/pessoas/posts/${post.id}`, { body: `Olá @Ana ${tag}!`, mentions: [ana.me.user.id] }));
    expect((await avisos(ana)).filter((n) => n.event === 'mencao' && n.link.endsWith(post.id))).toHaveLength(1);
    const c1 = ok(await lucas.post(`/pessoas/posts/${post.id}/comentarios`, { body: 'Concordo' }), 201).json();
    expect((await avisos(carlos)).some((n) => n.event === 'comentario' && n.link.endsWith(post.id))).toBe(true);
    ok(await rafael.post(`/pessoas/posts/${post.id}/comentarios`, { body: 'Eu também', parentId: c1.id }), 201);
    expect((await avisos(lucas)).some((n) => n.event === 'resposta')).toBe(true);

    // privada: mencionar quem não é membro não avisa
    const priv = ok(await ana.post('/pessoas/comunidades', { name: `Avisos privados ${tag}`, kind: 'privada' }), 201).json().id;
    const pp = ok(await ana.post('/pessoas/posts', { body: 'oi', communityId: priv, mentions: [rafael.me.user.id] }), 201).json();
    expect((await avisos(rafael)).some((n) => n.link.endsWith(pp.id))).toBe(false);

    // preferências: desligar comentários; aviso obrigatório não desliga
    ok(await carlos.put('/pessoas/notificacoes/preferencias', { items: [{ event: 'comentario', channel: 'interna', enabled: false }, { event: 'moderacao', channel: 'interna', enabled: false }] }));
    const prefs = ok(await carlos.get('/pessoas/notificacoes')).json().events;
    expect(prefs.find((e: { key: string }) => e.key === 'comentario').channels[0].enabled).toBe(false);
    expect(prefs.find((e: { key: string }) => e.key === 'moderacao').channels[0].enabled).toBe(true);
    const before = (await avisos(carlos)).filter((n) => n.event === 'comentario').length;
    ok(await mariana.post(`/pessoas/posts/${post.id}/comentarios`, { body: 'Mais um' }), 201);
    expect((await avisos(carlos)).filter((n) => n.event === 'comentario').length).toBe(before);

    // no ícone do topo, com leitura
    const bell = ok(await ana.get('/me/mentions')).json();
    const it0 = bell.items.find((i: { kind: string; source: string }) => i.kind === 'aviso' && i.source === 'pessoas_mencao');
    expect(it0).toMatchObject({ unread: true, contactName: `/pessoas/publicacao/${post.id}` });
    ok(await ana.post(`/me/notificacoes/${it0.taskId}/lida`, {}));
    expect(ok(await ana.get('/me/mentions')).json().items.find((i: { taskId: string }) => i.taskId === it0.taskId).unread).toBe(false);
  });

  it('reconhecimento e comunicado urgente: aviso interno e e-mail rastreado', async () => {
    const cats = ok(await ana.get('/pessoas/reconhecimentos/categorias')).json().items;
    ok(await ana.post('/pessoas/reconhecimentos', { toUserId: lucas.me.user.id, categoryId: cats[0].id, message: `Obrigada pela ajuda ${tag}`, visibility: 'privada' }), 201);
    expect((await avisos(lucas)).some((n) => n.event === 'reconhecimento' && n.title.startsWith('Ana reconheceu você'))).toBe(true);

    const a = ok(await carlos.post('/pessoas/admin/comunicados', { title: `Manutenção urgente ${tag}`, body: 'Sistema fora do ar às 22h.', priority: 'urgente', audience: { all: true }, publish: true }), 201).json();
    const n = (await avisos(rafael)).find((x) => x.title.includes(`Manutenção urgente ${tag}`));
    expect(n).toMatchObject({ event: 'comunicado_urgente' });
    const del = ok(await carlos.get('/pessoas/admin/entregas')).json().items;
    expect(del.some((d: { channel: string; eventLabel: string }) => d.channel === 'email' && d.eventLabel === 'Comunicado oficial urgente')).toBe(true);
    expect((await ana.get('/pessoas/admin/entregas')).statusCode).toBe(403);
    void a;
  });
});

describe('Pessoas & Cultura · painel administrativo', () => {
  it('indicadores agregados e acesso só para os papéis', async () => {
    ok(await ana.get('/pessoas/feed')); // uso do dia
    expect((await rafael.get('/pessoas/admin/painel')).statusCode).toBe(403);
    const p = ok(await carlos.get('/pessoas/admin/painel')).json();
    expect(p.eligible).toBeGreaterThanOrEqual(5);
    expect(p.activeUsers).toBeGreaterThanOrEqual(1);
    expect(p.adoptionPct).toBeGreaterThan(0);
    expect(p.posts).toBeGreaterThan(0);
    expect(p.decidedReports).toBeGreaterThan(0);
    expect(JSON.stringify(p)).not.toMatch(/Ana|Lucas|Rafael/); // sem nomes: só números
    const c = ok(await mariana.get('/pessoas/admin/conteudos?situacao=oculto')).json();
    expect(c.canModerate).toBe(true);
  });
});
