import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, ORIGIN, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
// Yepnet (fictícia): Carlos = gerência; Ana = supervisora que lidera Residencial e Empresarial;
// Lucas (Residencial) e Rafael (Empresarial) = vendedores do time da Ana; Mariana (Governo) = vendedora fora do time da Ana.
let carlos: Client, ana: Client, lucas: Client, rafael: Client, mariana: Client, outro: Client;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, rafael, mariana, outro] = await Promise.all([
    login(ctx.app, 'carlos@yepnet.test'),
    login(ctx.app, 'ana@yepnet.test'),
    login(ctx.app, 'lucas@yepnet.test'),
    login(ctx.app, 'rafael@yepnet.test'),
    login(ctx.app, 'mariana@yepnet.test'),
    login(ctx.app, 'vendedor@outro.test'),
  ]);
});
afterAll(async () => ctx.close());

const P = '?from=2026-01-01&to=2026-12-31';
const newOpp = (c: Client, extra: Record<string, unknown> = {}) =>
  c.post('/opportunities', { newContact: { name: 'Cliente Teste Fictício', phone: '(00) 91234-5678', segment: 'residencial' }, reasons: ['oferta'], channel: 'WhatsApp', ...extra });
const ids = (r: { json: () => { items: { id: string }[] } }) => new Set(r.json().items.map((x) => x.id));

describe('autenticação', () => {
  it('sem sessão responde 401 em problem+json', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.json().requestId).toBeTruthy();
  });

  it('senha errada é 401 genérico; cookie de sessão é httpOnly', async () => {
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'carlos@yepnet.test', password: 'errada' } });
    expect(bad.statusCode).toBe(401);
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'carlos@yepnet.test', password: 'Sprint@2026' } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('logout revoga a sessão no servidor', async () => {
    const c = await login(ctx.app, 'mariana@yepnet.test');
    expect((await c.get('/me')).statusCode).toBe(200);
    expect((await c.post('/auth/logout')).statusCode).toBe(204);
    expect((await c.get('/me')).statusCode).toBe(401);
  });

  it('bloqueia a conta após 5 falhas seguidas', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'rafael@yepnet.test', password: `x${i}` } });
    }
    const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'rafael@yepnet.test', password: 'Sprint@2026' } });
    expect(r.statusCode).toBe(423);
    await ctx.db.execute(sql`update users set failed_logins = 0, locked_until = null where email = 'rafael@yepnet.test'`);
  });

  it('limita tentativas de login por minuto (429)', async () => {
    const strict = await makeApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await strict.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ninguem@yepnet.test', password: 'x' } });
      codes.push(r.statusCode);
    }
    await strict.close();
    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('CSRF: origem não permitida é bloqueada antes da rota', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/opportunities', headers: { cookie: lucas.cookie, origin: 'https://atacante.test' }, payload: {} });
    expect(r.statusCode).toBe(403);
  });

  it('senhas e cookies não aparecem na trilha de auditoria', async () => {
    const rows = await ctx.db.execute(sql`select metadata::text m from audit_logs where action like 'auth.%'`);
    expect(rows.rows.map((r) => String(r.m)).join(' ')).not.toMatch(/Sprint@2026|isp_session/);
  });
});

describe('níveis de acesso por perfil (matriz padrão)', () => {
  it('/me devolve o nível de cada módulo conforme o perfil', async () => {
    expect(lucas.me.access).toMatchObject({ oportunidades: 'proprio', relatorios: 'proprio', inteligencia: 'nenhum', configuracoes: 'nenhum' });
    expect(ana.me.access).toMatchObject({ oportunidades: 'equipe', inteligencia: 'equipe', configuracoes: 'nenhum' });
    expect(carlos.me.access).toMatchObject({ oportunidades: 'total', configuracoes: 'total' });
  });

  it('vendedor (Próprio) só vê a própria carteira de oportunidades, leads, clientes e atividades', async () => {
    for (const url of ['/opportunities?status=todas&pageSize=100', '/leads?pageSize=100', '/activities?status=todas&scope=minhas&pageSize=100']) {
      const r = (await lucas.get(url)).json();
      expect(r.items.length).toBeGreaterThan(0);
      for (const it of r.items) expect(it.ownerId).toBe(lucas.me.user.id);
    }
    const cust = (await lucas.get('/customers?pageSize=100')).json();
    for (const c of cust.items) expect(c.ownerId).toBe(lucas.me.user.id);
  });

  it('vendedor recebe 404 em oportunidade de colega e 403 em módulo sem acesso', async () => {
    const o = (await newOpp(rafael)).json();
    expect((await lucas.get(`/opportunities/${o.id}`)).statusCode).toBe(404);
    expect((await lucas.patch(`/opportunities/${o.id}`, { notes: 'x', rowVersion: 1 })).statusCode).toBe(404);
    expect((await lucas.get(`/intelligence/overview${P}`)).statusCode).toBe(403);
    expect((await lucas.get('/admin/overview')).statusCode).toBe(403);
    expect((await lucas.get('/admin/security')).statusCode).toBe(403);
  });

  it('vendedor não atribui a terceiros nem reatribui em massa', async () => {
    expect((await lucas.post('/leads', { name: 'Lead Fictício', ownerId: rafael.me.user.id })).statusCode).toBe(403);
    const leads = (await lucas.get('/leads?pageSize=1')).json();
    expect((await lucas.post('/leads/bulk-assign', { ids: [leads.items[0].id], ownerId: lucas.me.user.id })).statusCode).toBe(403);
  });

  it('supervisora (Equipe) vê os times que lidera, somados, e nunca outro time', async () => {
    const r = (await ana.get('/opportunities?status=todas&pageSize=100')).json();
    const owners = new Set(r.items.map((o: { ownerId: string }) => o.ownerId));
    expect(owners.has(lucas.me.user.id)).toBe(true);
    expect(owners.has(rafael.me.user.id)).toBe(true);
    expect(owners.has(mariana.me.user.id)).toBe(false);
    const fromMariana = (await newOpp(mariana)).json();
    expect((await ana.get(`/opportunities/${fromMariana.id}`)).statusCode).toBe(404);
    const fromLucas = (await newOpp(lucas)).json();
    expect((await ana.get(`/opportunities/${fromLucas.id}`)).statusCode).toBe(200);
    expect((await ana.post('/leads', { name: 'Lead para fora do time', ownerId: mariana.me.user.id })).statusCode).toBe(403);
  });

  it('gerência vê 100% da empresa', async () => {
    const all = (await carlos.get('/opportunities?status=todas&pageSize=100')).json();
    const team = (await ana.get('/opportunities?status=todas&pageSize=100')).json();
    expect(all.total).toBeGreaterThan(team.total);
    const owners = new Set(all.items.map((o: { ownerId: string }) => o.ownerId));
    expect(owners.has(mariana.me.user.id)).toBe(true);
  });

  it('ranking do time: vendedor vê só os próprios números', async () => {
    const mine = (await lucas.get(`/reports/overview${P}`)).json();
    expect(mine.team.ranking).toBe(false);
    expect(mine.team.items.map((u: { userId: string }) => u.userId)).toEqual([lucas.me.user.id]);
    const sup = (await ana.get(`/reports/overview${P}`)).json();
    expect(sup.team.ranking).toBe(true);
    expect(sup.team.items.map((u: { userId: string }) => u.userId)).not.toContain(mariana.me.user.id);
  });

  it('números por pessoa batem com os registros (subconsulta correlacionada correta)', async () => {
    const rep = (await carlos.get(`/reports/overview${P}`)).json();
    const total = rep.team.items.reduce((a: number, u: { won: number }) => a + u.won, 0);
    const vendas = rep.kpis.find((k: { key: string }) => k.key === 'vendas').value;
    expect(total).toBe(vendas);
    const intel = (await carlos.get(`/intelligence/overview${P}`)).json();
    const { n } = (await ctx.db.execute(sql`select count(*)::int n from activities a join users u on u.id = a.owner_id join tenants t on t.id = u.tenant_id where t.slug = 'yepnet' and a.completed_at >= '2026-01-01' and a.completed_at < '2027-01-01'`)).rows[0] as { n: number };
    expect(intel.team.reduce((a: number, u: { total: number }) => a + u.total, 0)).toBe(n);
  });
});

describe('Configurações → Segurança (matriz editável pela gerência)', () => {
  it('mudança de nível vale na hora para quem tem o perfil e fica no log', async () => {
    const before = (await carlos.get('/admin/security')).json();
    expect(before.matrix.vendedor.inteligencia).toBe('nenhum');
    expect((await carlos.put('/admin/security', { profile: 'vendedor', module: 'inteligencia', level: 'proprio' })).statusCode).toBe(200);
    expect((await lucas.get(`/intelligence/overview${P}`)).statusCode).toBe(200);
    expect((await lucas.get('/me')).json().access.inteligencia).toBe('proprio');
    expect((await carlos.put('/admin/security', { profile: 'vendedor', module: 'inteligencia', level: 'nenhum' })).statusCode).toBe(200);
    expect((await lucas.get(`/intelligence/overview${P}`)).statusCode).toBe(403);
    const logs = (await carlos.get('/admin/logs?pageSize=50')).json();
    expect(logs.items.some((l: { action: string }) => l.action === 'security.update')).toBe(true);
  });

  it('Configurações só aceita Sem acesso ou Total; gerência não perde Configurações', async () => {
    expect((await carlos.put('/admin/security', { profile: 'supervisor', module: 'configuracoes', level: 'equipe' })).statusCode).toBe(422);
    expect((await carlos.put('/admin/security', { profile: 'gerencia', module: 'configuracoes', level: 'nenhum' })).statusCode).toBe(422);
  });

  it('supervisão não altera a matriz nem usuários', async () => {
    expect((await ana.put('/admin/security', { profile: 'vendedor', module: 'leads', level: 'total' })).statusCode).toBe(403);
    expect((await ana.get('/admin/users')).statusCode).toBe(403);
  });

  it('gerência não remove o próprio acesso', async () => {
    const r = await carlos.patch(`/admin/users/${carlos.me.user.id}`, { profile: 'vendedor' });
    expect(r.statusCode).toBe(422);
  });

  it('cadastro de usuário devolve senha temporária uma vez e ela funciona', async () => {
    const teams = (await carlos.get('/admin/users')).json().teams;
    const r = await carlos.post('/admin/users', { name: 'Usuária Teste', email: 'teste.nova@yepnet.test', profile: 'vendedor', teamIds: [teams[0].id], leadTeamIds: [] });
    expect(r.statusCode).toBe(201);
    const pass = r.json().temporaryPassword;
    expect(pass.length).toBeGreaterThanOrEqual(10);
    const c = await login(ctx.app, 'teste.nova@yepnet.test', pass);
    expect(c.me.access.oportunidades).toBe('proprio');
    expect((await carlos.post('/admin/users', { name: 'Dup', email: 'teste.nova@yepnet.test', profile: 'vendedor', teamIds: [] })).statusCode).toBe(422);
  });
});

describe('Personalização (imagens)', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');
  it('aceita PNG, serve a imagem e permite remover', async () => {
    expect((await carlos.put('/admin/branding/mascote_leads', { data: png })).statusCode).toBe(200);
    const img = await lucas.get('/brand/mascote_leads');
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect((await carlos.del('/admin/branding/mascote_leads')).statusCode).toBe(204);
    expect((await lucas.get('/brand/mascote_leads')).statusCode).toBe(404);
  });
  it('recusa SVG e arquivo que não é imagem; só a gerência envia', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect((await carlos.put('/admin/branding/logo_escuro', { data: svg })).statusCode).toBe(422);
    expect((await carlos.put('/admin/branding/nao_existe', { data: png })).statusCode).toBe(422);
    expect((await ana.put('/admin/branding/logo_escuro', { data: png })).statusCode).toBe(403);
  });
  it('a logo pública (tela de login) não vaza imagem de outro espaço', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/brand/mascote_leads' })).statusCode).toBe(404);
  });
});

describe('isolamento entre empresas (tenant)', () => {
  it('usuário de outra empresa recebe 404 ao ler, editar ou mover oportunidade', async () => {
    const created = (await newOpp(lucas)).json();
    expect((await outro.get(`/opportunities/${created.id}`)).statusCode).toBe(404);
    expect((await outro.patch(`/opportunities/${created.id}`, { title: 'invasão', rowVersion: 1 })).statusCode).toBe(404);
    expect((await outro.post(`/opportunities/${created.id}/transition`, { toStage: 'proposta', rowVersion: 1 })).statusCode).toBe(404);
    expect((await outro.get(`/opportunities/${created.id}/timeline`)).statusCode).toBe(404);
    expect(ids(await outro.get('/opportunities?status=todas&pageSize=100')).has(created.id)).toBe(false);
  });

  it('não permite vincular contato, origem, plano ou responsável de outra empresa', async () => {
    const lookupsA = (await carlos.get('/meta/lookups')).json();
    expect((await outro.post('/opportunities', { newContact: { name: 'X Fictício' }, sourceId: lookupsA.sources[0].id })).statusCode).toBe(422);
    expect((await outro.post('/opportunities', { newContact: { name: 'X Fictício' }, planId: lookupsA.plans[0].id })).statusCode).toBe(422);
    expect((await outro.post('/opportunities', { newContact: { name: 'X Fictício' }, ownerId: lucas.me.user.id })).statusCode).toBe(403);
    const contactA = (await carlos.get('/customers?pageSize=1')).json().items[0];
    expect((await outro.post('/opportunities', { contactId: contactA.id })).statusCode).toBe(422);
  });

  it('leads, fichas e busca de contatos não vazam entre empresas', async () => {
    const leadsA = (await carlos.get('/leads?pageSize=5')).json();
    expect((await outro.get(`/leads/${leadsA.items[0].id}`)).statusCode).toBe(404);
    expect((await outro.get(`/contacts/${leadsA.items[0].contactId}`)).statusCode).toBe(404);
    const search = (await outro.get(`/contacts?q=${encodeURIComponent(leadsA.items[0].name.split(' ')[0])}`)).json();
    expect(search.items.every((c: { id: string }) => c.id !== leadsA.items[0].contactId)).toBe(true);
    const adm = (await carlos.get('/admin/users')).json();
    expect(adm.users.every((u: { email: string }) => u.email.endsWith('@yepnet.test'))).toBe(true);
  });
});

describe('oportunidade: criação, plano, edição concorrente e etapas', () => {
  it('cria com contato provisório, dono = usuário, etapa Novo lead e evento', async () => {
    const r = await newOpp(lucas);
    expect(r.statusCode).toBe(201);
    const o = r.json();
    expect(o.ownerId).toBe(lucas.me.user.id);
    expect(o.stage).toBe('novo_lead');
    expect(o.contactProvisional).toBe(true);
    expect(o.rowVersion).toBe(1);
    expect(o.sprintStartedAt).toBeTruthy();
    const tl = (await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(tl.items.some((e: { type: string }) => e.type === 'created')).toBe(true);
  });

  it('valor vem do catálogo do plano; não aceita valor digitado', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = (await newOpp(lucas, { planId: plan.id })).json();
    expect(o.valueCents).toBe(plan.priceCents);
    expect(o.planName).toBe(plan.name);
    const typed = await lucas.patch(`/opportunities/${o.id}`, { valueCents: 1, rowVersion: o.rowVersion });
    expect(typed.statusCode === 422 || typed.json().valueCents === plan.priceCents).toBe(true);
  });

  it('exige contato existente OU novo (422 com campo)', async () => {
    const r = await lucas.post('/opportunities', { reasons: ['oferta'] });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors[0].path).toBe('contactId');
  });

  it('versão desatualizada gera 409 com a versão atual', async () => {
    const o = (await newOpp(lucas)).json();
    expect((await lucas.patch(`/opportunities/${o.id}`, { nextAction: 'Ligar amanhã', rowVersion: 1 })).statusCode).toBe(200);
    const stale = await lucas.patch(`/opportunities/${o.id}`, { nextAction: 'Outra coisa', rowVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentRowVersion).toBe(2);
  });

  it('venda fechada exige plano e confirmação, e NÃO confirma contrato', async () => {
    const bare = (await newOpp(lucas)).json();
    expect((await lucas.post(`/opportunities/${bare.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: 1 })).statusCode).toBe(422);
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = (await newOpp(lucas, { planId: plan.id })).json();
    expect((await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', rowVersion: 1 })).statusCode).toBe(422);
    const won = await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: 1 });
    expect(won.statusCode).toBe(200);
    expect(won.json().stage).toBe('ganha');
    expect(won.json().contractRequestStatus).not.toBe('confirmada');
  });

  it('perdida exige motivo; reabrir só com nível Equipe e justificativa', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = (await newOpp(lucas, { planId: plan.id })).json();
    expect((await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'perdida', confirm: true, rowVersion: 1 })).statusCode).toBe(422);
    const lost = await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'perdida', confirm: true, lossReason: 'preco', rowVersion: 1 });
    expect(lost.json().lossReason).toBe('preco');
    expect((await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'proposta', reason: 'quero', rowVersion: 2 })).statusCode).toBe(422);
    expect((await ana.post(`/opportunities/${o.id}/transition`, { toStage: 'proposta', rowVersion: 2 })).statusCode).toBe(422);
    const reopened = await ana.post(`/opportunities/${o.id}/transition`, { toStage: 'proposta', reason: 'Cliente voltou a ligar', rowVersion: 2 });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().lossReason).toBeNull();
    const tl = (await ana.get(`/opportunities/${o.id}/timeline`)).json();
    expect(tl.items.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['created', 'stage_changed', 'reopened']));
  });

  it('o banco recusa alteração de eventos (append-only)', async () => {
    await expect(ctx.db.execute(sql`delete from opportunity_events`)).rejects.toThrow(/append-only/);
  });

  it('pipeline traz só etapas abertas, com contagem e valor da carteira do usuário', async () => {
    const p = (await lucas.get('/pipeline')).json();
    expect(p.stages.map((s: { key: string }) => s.key)).toEqual(['novo_lead', 'qualificacao', 'cobertura', 'proposta', 'fechamento']);
    for (const st of p.stages) {
      expect(st.count).toBe(st.cards.length);
      expect(st.valueCents).toBe(st.cards.reduce((a: number, c: { valueCents: number | null }) => a + (c.valueCents ?? 0), 0));
      for (const c of st.cards) expect(c.ownerId).toBe(lucas.me.user.id);
    }
  });
});

describe('leads', () => {
  it('cria, busca, atualiza e converte (idempotente)', async () => {
    const created = await lucas.post('/leads', { name: 'Lead Conversão Fictício', phone: '(00) 90000-1111', interests: ['velocidade'] });
    expect(created.statusCode).toBe(201);
    const lead = created.json();
    const found = (await lucas.get('/leads?q=Convers%C3%A3o')).json();
    expect(found.items.some((l: { id: string }) => l.id === lead.id)).toBe(true);
    const upd = await lucas.patch(`/leads/${lead.id}`, { lastContactAt: new Date().toISOString(), status: 'em_contato', rowVersion: 1 });
    expect(upd.json().firstContactAt).toBeTruthy();
    const conv = await lucas.post(`/leads/${lead.id}/convert`, { rowVersion: 2 });
    expect(conv.statusCode).toBe(201);
    const again = await lucas.post(`/leads/${lead.id}/convert`, { rowVersion: 3 });
    expect(again.statusCode).toBe(200);
    expect(again.json().opportunityId).toBe(conv.json().opportunityId);
  });

  it('não aceita "convertido" por PATCH nem filtros inválidos', async () => {
    const lead = (await lucas.post('/leads', { name: 'Outro Lead Fictício' })).json();
    expect((await lucas.patch(`/leads/${lead.id}`, { status: 'convertido', rowVersion: 1 })).statusCode).toBe(422);
    expect((await lucas.get('/leads?sort=senha')).statusCode).toBe(422);
    expect((await lucas.get('/leads/nao-e-uuid')).statusCode).toBe(422);
  });

  it('supervisora reatribui em massa dentro do time, com auditoria', async () => {
    const mine = (await ana.get(`/leads?ownerId=${lucas.me.user.id}&pageSize=2`)).json();
    const r = await ana.post('/leads/bulk-assign', { ids: mine.items.map((l: { id: string }) => l.id), ownerId: rafael.me.user.id });
    expect(r.json().updated).toBe(mine.items.length);
    expect((await ana.post('/leads/bulk-assign', { ids: [mine.items[0].id], ownerId: mariana.me.user.id })).statusCode).toBe(403);
    const logs = (await carlos.get('/admin/logs?pageSize=50')).json();
    expect(logs.items.some((a: { action: string }) => a.action === 'lead.bulk_assign')).toBe(true);
  });
});

describe('atividades', () => {
  it('não duplica lembrete idêntico, conclui e registra reagendamento', async () => {
    const o = (await newOpp(lucas)).json();
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const body = { type: 'ligacao', title: 'Retornar com comparação', dueAt: due, opportunityId: o.id };
    const a1 = await lucas.post('/activities', body);
    expect(a1.statusCode).toBe(201);
    const a2 = await lucas.post('/activities', body);
    expect(a2.statusCode).toBe(200);
    expect(a2.json().deduplicated).toBe(true);
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await lucas.patch(`/activities/${a1.json().id}`, { dueAt: later, rowVersion: 1 })).statusCode).toBe(200);
    const done = await lucas.patch(`/activities/${a1.json().id}`, { completed: true, rowVersion: 2 });
    expect(done.json().completedAt).toBeTruthy();
    const tl = (await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(tl.items.filter((e: { kind: string }) => e.kind === 'activity').map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['created', 'rescheduled', 'completed']));
  });

  it('vendedor não cria atividade em oportunidade alheia nem vê agenda da equipe', async () => {
    const o = (await newOpp(rafael)).json();
    expect((await lucas.post('/activities', { type: 'tarefa', title: 'Tentativa', opportunityId: o.id })).statusCode).toBe(404);
    expect((await lucas.get('/activities?scope=equipe&status=todas&pageSize=100')).statusCode).toBe(403);
  });
});

describe('indicadores e contrato da API', () => {
  it('cada KPI declara fórmula e unidade; sem base comparável o delta é nulo', async () => {
    for (const url of ['/home', `/reports/overview${P}`, `/intelligence/overview${P}`, '/opportunities/summary', '/leads/summary', '/customers/summary']) {
      const d = (await carlos.get(url)).json();
      for (const k of d.kpis) {
        expect(k.formula, `${url} ${k.key}`).toBeTruthy();
        if (k.unit) expect(['count', 'brl_cents', 'ratio', 'days']).toContain(k.unit);
        if (k.delta !== null) expect(Number.isFinite(k.delta)).toBe(true);
      }
    }
  });

  it('exportação CSV respeita o nível e neutraliza fórmulas', async () => {
    const r = await lucas.get(`/reports/export${P}&kind=vendas`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    const rows = r.body.split('\n').filter((l) => l.startsWith('"OP-'));
    expect(rows.length).toBeGreaterThan(0);
    for (const l of rows) expect(l.split(';')[5]).toBe('"Lucas Lima"');
    expect(r.body).toContain('"Venda fechada"');
  });

  it('publica OpenAPI com o nível exigido por rota', async () => {
    const doc = (await ctx.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/api/v1/opportunities/{id}/transition'].post['x-access']).toBe('oportunidades:proprio');
    expect(doc.paths['/api/v1/admin/security'].put['x-access']).toBe('configuracoes:total');
  });
});
