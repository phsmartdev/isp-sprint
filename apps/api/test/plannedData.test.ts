/** Dados Planejados: chamados do GLPI dos grupos e pessoas do Comercial, SLA universal, nível de serviço e avisos. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { GLPI_CREDS, startFakeGlpi, type FakeGlpi } from './fakeGlpi';
import { setTransportFactory } from '../src/services/email';
import { runGlpiSla } from '../src/services/glpiSla';
import * as s from '../src/db/schema';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let glpi: FakeGlpi;
let carlos: Client, lucas: Client, ana: Client, rafael: Client;
let tenantId = '';
const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
// quarta-feira 25/11/2026, 14:00 em Brasília
const NOW = new Date('2026-11-25T17:00:00Z');
const ids: Record<string, number> = {};

beforeAll(async () => {
  // o painel calcula a situação com a hora atual: o relógio fica na data dos chamados de teste (não depende do dia em que roda)
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
  ctx = await makeApp();
  glpi = await startFakeGlpi();
  [carlos, lucas, ana, rafael] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const [u] = await ctx.db.select({ t: s.users.tenantId }).from(s.users).where(eq(s.users.email, 'carlos@yepnet.test')).limit(1);
  tenantId = u!.t;
  setTransportFactory(() => ({ sendMail: async (m: (typeof sent)[number]) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'RevOps', fromEmail: 'avisos@yepnet.test', replyTo: null, enabled: true }));
  ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: glpi.url, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { clientSecret: GLPI_CREDS.clientSecret, password: GLPI_CREDS.password } }));
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'RevOps', fromEmail: 'avisos@yepnet.test', replyTo: null, enabled: false });
  await ctx.db.execute(sql`update integrations set enabled = false where kind = 'glpi'`);
  await ctx.db.execute(sql`update glpi_sla_settings set enabled = false`);
  await ctx.db.execute(sql`update users set glpi_user_id = null, glpi_user_name = null, glpi_group_ids = '{}', glpi_group_names = '{}'`);
  setTransportFactory(null);
  await glpi.close();
  await ctx.close();
  vi.useRealTimers();
});

describe('Dados Planejados', () => {
  it('cadastro: usuário e grupos do GLPI de cada pessoa (busca no GLPI)', async () => {
    const users = ok(await carlos.get('/admin/glpi/users?q=lucas')).json().items;
    expect(users).toEqual([{ id: 31, name: 'Lucas Lima (lucas.lima)' }]);
    expect(ok(await carlos.get('/admin/glpi/groups?q=comer')).json().items).toEqual([{ id: 21, name: 'Comercial' }]);
    expect((await lucas.get('/admin/glpi/users')).statusCode).toBe(403);
    ok(await carlos.patch(`/admin/users/${lucas.me.user.id}`, { glpiUserId: 31, glpiUserName: 'Lucas Lima (lucas.lima)', glpiGroups: [{ id: 21, name: 'Comercial' }] }));
    ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { glpiUserId: 32, glpiUserName: 'Ana Souza (ana.souza)', glpiGroups: [{ id: 21, name: 'Comercial' }] }));
    const list = ok(await carlos.get('/admin/users')).json().users as { id: string; glpiUserId: number | null; glpiGroupIds: number[] }[];
    expect(list.find((u) => u.id === lucas.me.user.id)).toMatchObject({ glpiUserId: 31, glpiGroupIds: [21] });
  });

  it('SLA universal em horas úteis: lê o GLPI, separa atrasado, sem responsável e nível de serviço; avisa por e-mail sem repetir', async () => {
    ok(await carlos.put('/admin/dados-planejados', {
      enabled: true, rootEntityId: 0, managerIds: [carlos.me.user.id], groupLeaders: { '21': [ana.me.user.id] },
      settings: { goalPct: 95, slaSource: 'universal', solveHours: 8, ownHours: 2, businessHoursOnly: true, businessStart: 8, businessEnd: 18, businessDays: [1, 2, 3, 4, 5], warnHours: [4, 1], unassignedMinutes: 60, repeatLateHours: 2, escalateAfterHours: 4, digestHour: 8, email: true, whatsapp: true },
    }));
    // A: do Lucas, aberto ontem 9:00 → 8 h úteis = ontem 17:00 → atrasado há 21 h (escala)
    ids.A = glpi.seed({ name: 'Revisão de proposta: link 200 Mb', date: '2026-11-24 09:00:00', team: [{ type: 'Group', id: 21 }, { type: 'User', id: 31 }] });
    // B: do grupo, sem responsável há 1 h 30
    ids.B = glpi.seed({ name: 'Aditivo de contrato: 3 pontos', date: '2026-11-25 12:30:00', team: [{ type: 'Group', id: 21 }] });
    // C: de outro grupo (NOC): fora do painel
    ids.C = glpi.seed({ name: 'Queda de link', date: '2026-11-25 10:00:00', team: [{ type: 'Group', id: 11 }] });
    // D: resolvido no prazo; E: resolvido fora (aberto sexta 9:00, prazo sexta 17:00, resolvido terça)
    ids.D = glpi.seed({ name: 'Proposta Escola Modelo', date: '2026-11-23 09:00:00', status: 5, date_solve: '2026-11-23 11:00:00', team: [{ type: 'Group', id: 21 }, { type: 'User', id: 31 }] });
    ids.E = glpi.seed({ name: 'Renovação Clínica Modelo', date: '2026-11-20 09:00:00', status: 6, date_solve: '2026-11-24 10:00:00', team: [{ type: 'Group', id: 21 }, { type: 'User', id: 31 }] });

    sent.length = 0;
    const r = await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, now: NOW });
    expect(r).toMatchObject({ sync: { stored: 4 } });
    const d = ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
    expect(d.kpi).toMatchObject({ open: 2, late: 1, unassigned: 1, solved: 2, solvedLate: 1, serviceLevel: 50 });
    expect(d.pending.map((p: { glpiId: number }) => p.glpiId)).toEqual([ids.A, ids.B]);
    expect(d.pending[0]).toMatchObject({ situation: 'atrasado', assignees: ['lucas.lima'], groups: ['Comercial'], todo: 'assumir e solucionar' });
    expect(d.pending[0].glpiUrl).toBe(`${glpi.url}/front/ticket.form.php?id=${ids.A}`);
    expect(d.pending[1]).toMatchObject({ unassigned: true });
    expect(d.byGroup[0]).toMatchObject({ name: 'Comercial', open: 2, late: 1, serviceLevel: 50 });
    expect(d.sla).toMatchObject({ source: 'universal', solveHours: 8, businessHoursOnly: true });

    // quem recebeu o quê (e-mail; WhatsApp sem Z-API não sai)
    const to = (email: string, re: RegExp) => sent.some((m) => m.to === email && re.test(m.subject));
    expect(to('lucas@yepnet.test', new RegExp(`\\[VENCEU\\] #${ids.A}`))).toBe(true);
    expect(to('ana@yepnet.test', new RegExp(`\\[VENCEU\\] #${ids.A}`))).toBe(true); // líder do grupo
    expect(to('ana@yepnet.test', new RegExp(`\\[SEM RESPONSÁVEL\\] #${ids.B}`))).toBe(true);
    expect(to('carlos@yepnet.test', new RegExp(`\\[ESCALADO PARA A GESTÃO\\] #${ids.A}`))).toBe(true);
    expect(to('lucas@yepnet.test', /^Dados Planejados: 1 atrasado/)).toBe(true); // resumo do dia
    expect(sent.some((m) => new RegExp(`#${ids.C}\\b`).test(m.subject))).toBe(false);
    const mail = sent.find((m) => m.to === 'lucas@yepnet.test' && m.subject.includes('VENCEU'))!;
    expect(mail.text).toContain('Responsável: você');
    expect(mail.text).toContain('Falta: assumir e solucionar');
    expect(mail.html).toContain(`ticket.form.php?id=${ids.A}`);
    const n = sent.length;
    await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(sent.length).toBe(n); // nada repete na mesma janela
    expect(ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json().pending[0].lastAlert).toMatchObject({ channels: ['email'] });
  });

  it('cada um vê os seus e os dos seus grupos; reatribuído para fora do Comercial sai do painel', async () => {
    expect(ok(await lucas.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json().kpi.open).toBe(2);
    expect(ok(await rafael.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json().kpi.open).toBe(0);
    expect((await rafael.get('/admin/dados-planejados')).statusCode).toBe(403);
    // a tela chama a rotina: roda e, logo depois, não roda de novo (no máximo a cada 4 minutos)
    ok(await lucas.post('/dados-planejados/tick'));
    expect(ok(await ana.post('/dados-planejados/tick')).json()).toEqual({ ran: false });
    const t = glpi.tickets.get(ids.B!)!;
    t.team = [{ type: 'Group', id: 11, role: 'assigned' }];
    t.date_mod = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(Date.now() + 60_000));
    await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, now: new Date(NOW.getTime() + 20 * 60_000) });
    const d = ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
    expect(d.pending.map((p: { glpiId: number }) => p.glpiId)).toEqual([ids.A]);
    const cfg = ok(await carlos.get('/admin/dados-planejados')).json();
    expect(cfg.groups).toEqual([{ id: 21, name: 'Comercial', members: expect.arrayContaining(['Lucas Lima', 'Ana Souza']) }]);
    expect(cfg.recent.length).toBeGreaterThan(0);
  });

  it('perfil da integração sem direito recursivo: lê também cada subentidade; a releitura completa traz o que ficou de fora', async () => {
    glpi.setRecursion(false);
    try {
      ids.F = glpi.seed({ name: 'Chamado na subentidade', entity: 4, date: '2026-11-25 13:00:00', team: [{ type: 'User', id: 31 }] });
      const r = (await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, full: true, now: new Date(NOW.getTime() + 30 * 60_000) })) as { sync: { entities: { name: string }[] } };
      expect(r.sync.entities.map((e) => e.name)).toContain('Raiz > Clientes > Hospital São Lucas');
      const d = ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
      expect(d.pending.map((p: { glpiId: number }) => p.glpiId)).toContain(ids.F);
      // pela rota do botão "Ler GLPI agora"
      const run = ok(await carlos.post('/admin/dados-planejados/run')).json();
      expect(run.sync.read).toBeGreaterThan(0);
    } finally { glpi.setRecursion(true); }
  });

  it('1º atendimento pela primeira mensagem do Comercial; menções e pedidos de aprovação no painel e nas listas', async () => {
    const at = (h: string) => `2026-11-25 ${h}:00`;
    const mention = (id: number, name: string) => `<p>Olá <span data-user-mention="true" data-user-id="${id}">@${name}</span>, pode ver?</p>`;
    // G: do Comercial, aberto pelo técnico (requerente); a Ana responde 40 min depois citando o Lucas
    ids.G = glpi.seed({ name: 'Proposta com 1ª resposta', date: at('09:00'), team: [{ type: 'Group', id: 21 }, { type: 'User', id: 33, role: 'requester' }], timeline: [
      { type: 'Followup', item: { id: 9001, user: { id: 33, name: 'tecnico.noc' }, content: '<p>complemento do requerente</p>', date: at('09:10') } },
      { type: 'Followup', item: { id: 9002, user: { id: 32, name: 'ana.souza' }, content: mention(31, 'Lucas'), date: at('09:40') } },
    ] });
    // H: do NOC (fora do Comercial): cita a Ana e pede aprovação ao Lucas
    ids.H = glpi.seed({ name: 'Mudança de rota', date: at('10:00'), team: [{ type: 'Group', id: 11 }], timeline: [
      { type: 'Followup', item: { id: 9003, user: { id: 33, name: 'tecnico.noc' }, content: mention(32, 'Ana'), date: at('10:30') } },
      { type: 'Validation', item: { id: 9004, requester: { id: 33, name: 'tecnico.noc' }, requested_approver_type: 'User', requested_approver_id: 31, status: 2, submission_date: at('10:45') } },
    ] });
    // I: do NOC, aprovação do grupo Comercial já decidida (não fica pendente)
    ids.I = glpi.seed({ name: 'Compra de ONU', date: at('10:00'), team: [{ type: 'Group', id: 11 }], timeline: [
      { type: 'Validation', item: { id: 9005, requester: { id: 33, name: 'tecnico.noc' }, requested_approver_type: 'Group', requested_approver_id: 21, status: 3, submission_date: at('10:05'), approval_date: at('11:00') } },
    ] });
    await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, full: true, now: new Date(NOW.getTime() + 40 * 60_000) });
    const d = ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
    const g = d.pending.find((p: { glpiId: number }) => p.glpiId === ids.G);
    expect(g.firstResponse.by).toBe('Ana Souza');
    expect(d.kpi).toMatchObject({ firstResponseCount: 1, firstResponseMin: 40, approvalsPending: 1, mentionsOpen: 2 });
    expect(d.pending.map((p: { glpiId: number }) => p.glpiId)).not.toContain(ids.H); // só citado: fora das pendências de SLA
    expect(d.mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ glpiId: ids.H, person: 'Ana Souza', by: 'tecnico.noc', answeredAt: null }),
      expect.objectContaining({ glpiId: ids.G, person: 'Lucas Lima', by: 'ana.souza', answeredAt: null }),
    ]));
    expect(d.approvals).toEqual([expect.objectContaining({ glpiId: ids.H, approver: 'Lucas Lima', requester: 'tecnico.noc', isGroup: false })]);
    expect(d.approvals[0].waiting).toMatch(/^há /);
    // o Lucas responde no H depois da menção à Ana? não conta; a Ana responde: menção respondida
    glpi.tickets.get(ids.H!)!.timeline.push({ type: 'Followup', item: { id: 9006, user: { id: 32, name: 'ana.souza' }, content: '<p>Vi, ok.</p>', date: at('11:30') } });
    glpi.tickets.get(ids.H!)!.date_mod = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(NOW.getTime() + 45 * 60_000));
    await runGlpiSla(ctx.db, ctx.app.config, tenantId, { force: true, now: new Date(NOW.getTime() + 50 * 60_000) });
    const d2 = ok(await carlos.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
    expect(d2.mentions.find((m: { glpiId: number }) => m.glpiId === ids.H).answeredAt).not.toBeNull();
    expect(d2.kpi.mentionsOpen).toBe(1);
    // filtro por pessoa e escopo: o Lucas vê a aprovação dele; o Rafael (sem grupo) não vê nada
    expect(ok(await carlos.get(`/dados-planejados?from=2026-11-01&to=2026-11-30&userId=${ana.me.user.id}`)).json().approvals).toEqual([]);
    expect(ok(await lucas.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json().approvals).toHaveLength(1);
    const rf = ok(await rafael.get('/dados-planejados?from=2026-11-01&to=2026-11-30')).json();
    expect(rf.mentions).toEqual([]);
    expect(rf.approvals).toEqual([]);
  });
});
