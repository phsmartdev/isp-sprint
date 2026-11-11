/** Pessoas & Cultura · Etapa 4: conquistas (venda e badges), reconhecimentos e comunicados oficiais. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { checkBadges } from '../src/services/people/achievements';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, mariana: Client;
let tenantId = '';
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  for (const e of ['carlos', 'lucas', 'ana', 'rafael', 'mariana']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste cultura' from users where email = ${`${e}@yepnet.test`}`);
  }
  tenantId = ((await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string }).tenant_id;
  // Comunicação Interna = setor "administracao" (Carlos)
  await ctx.db.execute(sql`delete from people_settings`);
  // outros testes fecham vendas (e geram conquistas): começa do zero para medir só as deste arquivo
  await ctx.db.execute(sql`delete from people_posts where kind = 'conquista'`);
  await ctx.db.execute(sql`delete from people_badge_awards`);
  await ctx.db.execute(sql`insert into people_settings (tenant_id, settings) values (${tenantId}, ${JSON.stringify({ roles: { comunicacao: ['administracao'], pessoasCultura: ['administracao'], moderacao: [] } })}::jsonb)`);
  await ctx.db.execute(sql`update users set sectors = '{administracao}' where email = 'carlos@yepnet.test'`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email in ('ana@yepnet.test','lucas@yepnet.test','rafael@yepnet.test','mariana@yepnet.test')`);
  [carlos, lucas, ana, rafael, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client, Client];
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`delete from gamification_settings where note = 'teste pessoas'`);
  await ctx.close();
});

async function winDeal(name: string) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'empresarial' }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  return o;
}
const conquests = async (c: Client) => ok(await c.get('/pessoas/feed?limite=30')).json().items.filter((p: { kind: string }) => p.kind === 'conquista');

describe('Pessoas & Cultura · conquistas', () => {
  it('venda fechada vira conquista no feed: pontos e badges, nunca valores; uma vez só', async () => {
    // regra de gamificação aprovada com o badge Crescimento alcançável por venda ganha
    const cfg = { journeys: [], points: { negociacao_ganha: 20, oportunidade_criada: 1 }, badges: [{ key: 'crescimento', name: 'Crescimento', description: 'Fazer o negócio crescer.', sources: ['evento:negociacao_ganha'], tiers: [{ name: 'Faixa mínima', minPoints: 15 }, { name: 'Faixa média', minPoints: 100000 }] }] };
    const approve = (c: unknown) => ctx.db.execute(sql`insert into gamification_settings (tenant_id, version, config, note, status, created_by) values (${tenantId}, (select coalesce(max(version),0)+1 from gamification_settings where tenant_id = ${tenantId}), ${JSON.stringify(c)}::jsonb, 'teste pessoas', 'aprovada', ${carlos.me.user.id})`);
    // implantação (faixa ainda fora de alcance): o que já existia fica registrado sem publicar
    await approve({ ...cfg, badges: [{ ...cfg.badges[0], tiers: [{ name: 'Faixa mínima', minPoints: 99999 }, { name: 'Faixa média', minPoints: 100000 }] }] });
    await checkBadges(ctx.db, tenantId, [lucas.me.user.id]);
    await approve(cfg);
    expect(await conquests(ana)).toEqual([]);
    const settings = (await ctx.db.execute(sql`select settings from people_settings where tenant_id = ${tenantId}`)).rows[0] as { settings: { badgeBaselineAt: string | null } };
    expect(settings.settings.badgeBaselineAt).toBeTruthy();

    const o = await winDeal('Cliente Conquista Fictícia');
    const posts = await conquests(ana);
    const venda = posts.find((p: { meta?: unknown; body: string }) => p.body.includes('Venda fechada'));
    expect(venda).toBeTruthy();
    expect(venda.author.id).toBe(lucas.me.user.id);
    expect(venda.body).toContain('Cliente Conquista Fictícia');
    expect(venda.meta).toMatchObject({ type: 'venda', client: 'Cliente Conquista Fictícia' });
    expect(venda.meta.points).toBeGreaterThan(0);
    expect(venda.meta.badges.map((b: { key: string }) => b.key)).toEqual(['crescimento']);
    expect(JSON.stringify(venda)).not.toMatch(/valueCents|priceCents|R\$/);
    // e a celebração do badge, com o texto próprio dele
    const badge = posts.find((p: { meta: { type: string } }) => p.meta?.type === 'badge');
    expect(badge.body).toMatch(/Lucas conquistou o badge Crescimento!/);
    expect(badge.meta.badge).toMatchObject({ key: 'crescimento', tier: 'Faixa mínima' });
    // reabrir e ganhar de novo não repete a conquista
    const cur = (await carlos.get(`/opportunities/${o.id}`)).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'novo_lead', confirm: true, reason: 'Ajuste no contrato', rowVersion: cur.rowVersion }));
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    expect((await conquests(ana)).filter((p: { meta: { opportunityId?: string } }) => p.meta?.opportunityId === o.id)).toHaveLength(1);
  });

  it('sem o nome do cliente quando a empresa desliga; sem conquista quando desliga a celebração', async () => {
    ok(await carlos.put('/pessoas/config', { roles: { comunicacao: ['administracao'], pessoasCultura: ['administracao'], moderacao: [] }, celebrations: { dealWon: true, showClient: false, badges: true } }));
    await winDeal('Cliente Discreto Fictício');
    const p = (await conquests(ana)).find((x: { meta: { type: string; client: string | null } }) => x.meta?.type === 'venda' && x.meta.client === null);
    expect(p.body).not.toContain('Cliente Discreto');
    ok(await carlos.put('/pessoas/config', { roles: { comunicacao: ['administracao'], pessoasCultura: ['administracao'], moderacao: [] }, celebrations: { dealWon: false, showClient: true, badges: true } }));
    const before = (await conquests(ana)).length;
    await winDeal('Cliente Sem Post Fictício');
    expect((await conquests(ana)).length).toBe(before);
    // a tela não apaga a marca de implantação
    expect(((await ctx.db.execute(sql`select settings from people_settings where tenant_id = ${tenantId}`)).rows[0] as { settings: { badgeBaselineAt: string | null } }).settings.badgeBaselineAt).toBeTruthy();
  });
});

describe('Pessoas & Cultura · reconhecimentos', () => {
  it('reconhecer colega: categoria, mensagem, feed público ou privado; sem auto-reconhecimento nem duplicado', async () => {
    const cats = ok(await lucas.get('/pessoas/reconhecimentos/categorias')).json();
    expect(cats.items.map((c: { name: string }) => c.name)).toEqual(['Colaboração', 'Iniciativa', 'Excelência no atendimento', 'Inovação', 'Compartilhamento de conhecimento', 'Compromisso com resultados']);
    expect(cats.canManage).toBe(false);
    const colab = cats.items[0].id;
    expect((await lucas.post('/pessoas/reconhecimentos', { toUserId: lucas.me.user.id, categoryId: colab, message: 'Eu mesmo mereço muito' })).statusCode).toBe(422);
    expect((await lucas.post('/pessoas/reconhecimentos', { toUserId: ana.me.user.id, categoryId: colab, message: 'curto' })).statusCode).toBe(422);
    const r = ok(await lucas.post('/pessoas/reconhecimentos', { toUserId: ana.me.user.id, categoryId: colab, message: 'Me ajudou a fechar a proposta da prefeitura no prazo.' }), 201).json();
    expect(r.postId).toBeTruthy();
    expect((await lucas.post('/pessoas/reconhecimentos', { toUserId: ana.me.user.id, categoryId: colab, message: 'Me ajudou a fechar a proposta da prefeitura no prazo.' })).statusCode).toBe(422);
    const post = ok(await rafael.get(`/pessoas/posts/${r.postId}`)).json().post;
    expect(post).toMatchObject({ kind: 'reconhecimento', meta: { type: 'reconhecimento', to: { name: 'Ana Souza' }, category: { name: 'Colaboração', emoji: '🤝' } } });
    // privado: só quem envia e quem recebe
    const priv = ok(await mariana.post('/pessoas/reconhecimentos', { toUserId: ana.me.user.id, categoryId: cats.items[1].id, message: 'Obrigada pela paciência com a minha integração.', visibility: 'privada' }), 201).json();
    expect(priv.postId).toBeNull();
    const seenByAna = ok(await ana.get('/pessoas/reconhecimentos')).json().items.map((x: { id: string }) => x.id);
    expect(seenByAna).toEqual(expect.arrayContaining([r.id, priv.id]));
    const seenByRafael = ok(await rafael.get(`/pessoas/reconhecimentos?pessoa=${ana.me.user.id}`)).json().items.map((x: { id: string }) => x.id);
    expect(seenByRafael).toContain(r.id);
    expect(seenByRafael).not.toContain(priv.id);
  });

  it('categorias: só Pessoas e Cultura cria, edita e desativa', async () => {
    expect((await lucas.post('/pessoas/reconhecimentos/categorias', { name: 'Alegria' })).statusCode).toBe(403);
    const c = ok(await carlos.post('/pessoas/reconhecimentos/categorias', { name: 'Alegria no time', emoji: '😄' }), 201).json();
    ok(await carlos.patch(`/pessoas/reconhecimentos/categorias/${c.id}`, { active: false }));
    expect(ok(await lucas.get('/pessoas/reconhecimentos/categorias')).json().items.map((x: { id: string }) => x.id)).not.toContain(c.id);
    expect((await lucas.post('/pessoas/reconhecimentos', { toUserId: ana.me.user.id, categoryId: c.id, message: 'Sempre animada nas reuniões.' })).statusCode).toBe(422);
  });
});

describe('Pessoas & Cultura · comunicados oficiais', () => {
  it('segmentado, com confirmação por versão; só Comunicação publica; alcance e pendentes', async () => {
    const teams = (await carlos.get('/meta/lookups')).json().teams as { id: string; name: string }[];
    const resid = teams.find((t) => t.name === 'Residencial')!.id; // Ana e Lucas
    expect((await lucas.post('/pessoas/admin/comunicados', { title: 'Teste', body: 'Corpo do teste', audience: { all: true } })).statusCode).toBe(403);
    expect((await carlos.post('/pessoas/admin/comunicados', { title: 'Sem público', body: 'Corpo', audience: {} })).statusCode).toBe(422);
    const a = ok(await carlos.post('/pessoas/admin/comunicados', { title: 'Nova política de home office', body: 'A partir de dezembro, dois dias por semana.', priority: 'importante', audience: { teamIds: [resid] }, requireAck: true, publish: true }), 201).json();
    let mine = ok(await lucas.get('/pessoas/comunicados')).json();
    expect(mine).toMatchObject({ unread: 1, pendingAck: 1 });
    expect(mine.items[0]).toMatchObject({ id: a.id, priority: 'importante', requireAck: true, acknowledged: false });
    expect(ok(await rafael.get('/pessoas/comunicados')).json().items.map((x: { id: string }) => x.id)).not.toContain(a.id); // fora do público
    expect((await rafael.post(`/pessoas/comunicados/${a.id}/confirmar`)).statusCode).toBe(404);
    ok(await lucas.post(`/pessoas/comunicados/${a.id}/visto`), 204);
    ok(await lucas.post(`/pessoas/comunicados/${a.id}/confirmar`));
    mine = ok(await lucas.get('/pessoas/comunicados')).json();
    expect(mine).toMatchObject({ unread: 0, pendingAck: 0 });
    let adm = ok(await carlos.get('/pessoas/admin/comunicados')).json().items.find((x: { id: string }) => x.id === a.id);
    expect(adm.reach).toMatchObject({ eligible: 2, viewed: 1, acknowledged: 1 });
    expect(ok(await carlos.get(`/pessoas/admin/comunicados/${a.id}/pendentes`)).json().items.map((x: { name: string }) => x.name)).toEqual(['Ana Souza']);
    // mudou o texto: nova versão, a confirmação antiga não vale mais
    expect(ok(await carlos.patch(`/pessoas/admin/comunicados/${a.id}`, { body: 'A partir de janeiro, dois dias por semana.' })).json().version).toBe(2);
    expect(ok(await lucas.get('/pessoas/comunicados')).json().pendingAck).toBe(1);
    // encerrado sai da tela de quem recebe
    ok(await carlos.patch(`/pessoas/admin/comunicados/${a.id}`, { status: 'encerrado' }));
    expect(ok(await lucas.get('/pessoas/comunicados')).json().items).toEqual([]);
    adm = ok(await carlos.get('/pessoas/admin/comunicados')).json().items.find((x: { id: string }) => x.id === a.id);
    expect(adm.status).toBe('encerrado');
  });

  it('agendado e expirado não aparecem; rascunho só para a Comunicação', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const sched = ok(await carlos.post('/pessoas/admin/comunicados', { title: 'Agendado', body: 'Amanhã', audience: { all: true }, publishAt: future, publish: true }), 201).json();
    const exp = ok(await carlos.post('/pessoas/admin/comunicados', { title: 'Expirado', body: 'Ontem', audience: { all: true }, publishAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), expiresAt: past, publish: true }), 201).json();
    const draft = ok(await carlos.post('/pessoas/admin/comunicados', { title: 'Rascunho', body: 'Ainda não', audience: { all: true } }), 201).json();
    const seen = ok(await mariana.get('/pessoas/comunicados')).json().items.map((x: { id: string }) => x.id);
    for (const id of [sched.id, exp.id, draft.id]) expect(seen).not.toContain(id);
    expect((await mariana.post(`/pessoas/comunicados/${draft.id}/visto`)).statusCode).toBe(404);
  });
});
