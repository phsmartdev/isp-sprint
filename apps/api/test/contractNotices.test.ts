/**
 * Avisos de atividades de contrato por nível de responsabilidade (R/A/C/I + escalonamento), papéis no cadastro do
 * usuário, atores externos com canais, rastreio de abertura do e-mail (pixel) e resposta do ator externo pelo link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setTransportFactory } from '../src/services/email';
import { runContractTaskNotices } from '../src/services/contractNotify';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const tokenIn = (m: { html?: string }) => /\/public\/open\/([A-Za-z0-9_-]+)/.exec(m.html ?? '')?.[1];
let contractId = '', actorId = '';

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string; html?: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: true }));
  contractId = ok(await carlos.get('/contracts?status=ativos')).json().items[0].id;
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.db.execute(sql`update users set playbook_roles = '{}'`);
  await ctx.db.execute(sql`update raci_settings set assignees = '{}'::jsonb`);
  await ctx.db.execute(sql`update contract_external_actors set active = false`);
  await ctx.close();
});

describe('responsabilidades no cadastro do usuário e atores externos', () => {
  it('papéis vêm do usuário; ator externo com canais; só quem administra parametriza', async () => {
    ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: ['SC'] }));
    ok(await carlos.patch(`/admin/users/${carlos.me.user.id}`, { playbookRoles: ['GC'] }));
    expect((await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: ['XYZ'] })).statusCode).toBe(422);
    expect((await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: ['FIN'] })).statusCode).toBe(422); // FIN é ator externo
    expect((await carlos.post('/contract-external-actors', { name: 'Diretor Fictício', roles: ['DIR'], channels: [] })).statusCode).toBe(422); // DIR é interno
    actorId = ok(await carlos.post('/contract-external-actors', { name: 'Financeiro Terceirizado Fictício', organization: 'Contabilidade Fictícia', email: 'fin@terceiro.test', whatsapp: '(79) 99999-1111', roles: ['FIN'], channels: ['email', 'whatsapp'] }), 201).json().id;
    const p = ok(await lucas.get('/contract-playbook')).json();
    expect(p.roles.find((r: { key: string }) => r.key === 'SC').users.map((u: { name: string }) => u.name)).toEqual(['Ana Souza']);
    expect(p.roles.filter((r: { external: boolean }) => r.external).map((r: { key: string }) => r.key)).toEqual(['FIN', 'OP', 'JUR', 'LID_TECNICA', 'LID_FINANCEIRO', 'LID_OP', 'RESP_JURIDICO']);
    expect(p.roles.find((r: { key: string }) => r.key === 'FIN').actors[0]).toMatchObject({ name: 'Financeiro Terceirizado Fictício', channels: ['email', 'whatsapp'] });
    expect(p.actors[0].email).toBeUndefined(); // contato do ator só para quem parametriza
    expect(p.rules).toMatchObject({ events: { criada: ['R'], vencida: ['R', 'A'], concluida: ['A', 'I'] }, dueSoonHours: null, escalation: [] });
    expect((await lucas.put('/contract-playbook/notify-rules', { events: {}, dueSoonHours: null, escalation: [] })).statusCode).toBe(403);
  });
});

describe('avisos por nível de responsabilidade com confirmação de recebimento', () => {
  let taskId = '';
  it('criada: avisa R, A e C conforme a regra; e-mail com botão; ator externo por e-mail e WhatsApp (sem Z-API: registrado)', async () => {
    ok(await carlos.put('/contract-playbook/notify-rules', { events: { criada: ['R', 'A', 'C'], vence_em_breve: ['R'], vencida: ['R', 'A'], devolvida: ['A'], concluida: ['A', 'I'] }, dueSoonHours: 48, escalation: [{ afterHours: 1, role: 'GC' }] }));
    sent.length = 0;
    taskId = ok(await carlos.post('/tasks', { title: 'Cadastrar contrato no ERP (aviso)', ownerId: lucas.me.user.id, contractId, raciKey: 'cadastro_erp', dueOn: '2026-01-05' }), 201).json().id;
    const n = ok(await carlos.get(`/tasks/${taskId}/notices`)).json().items as { recipientName: string; raciLetter: string; channel: string; status: string; event: string }[];
    expect(n.filter((x) => x.event === 'criada').map((x) => `${x.recipientName}|${x.raciLetter}|${x.channel}|${x.status}`).sort()).toEqual([
      'Ana Souza|A|email|enviado', 'Financeiro Terceirizado Fictício|C|email|enviado', 'Financeiro Terceirizado Fictício|C|whatsapp|nao_configurado', 'Lucas Lima|R|email|enviado',
    ]);
    const m = sent.find((x) => x.to === 'fin@terceiro.test')!;
    expect(m.html).not.toContain('Confirmar recebimento');
    expect(m.html).toContain('Responder'); // ator externo responde pelo link
    expect(sent.find((x) => x.to === 'lucas@yepnet.test')!.html).not.toContain('Responder'); // usuário do sistema não
    expect(m.html).toContain('Consultado (C)');
    expect(tokenIn(m)).toBeTruthy();
  });

  it('pixel registra a abertura (primeira, última e contagem); o ator externo responde pelo link', async () => {
    const tokUser = tokenIn(sent.find((x) => x.to === 'lucas@yepnet.test')!)!;
    const tokActor = tokenIn(sent.find((x) => x.to === 'fin@terceiro.test')!)!;
    const anon = (m: 'GET' | 'POST', url: string, payload?: unknown) => ctx.app.inject({ method: m, url: `/api/v1${url}`, payload: payload as never, headers: { origin: 'http://localhost:5173', 'user-agent': 'Cliente de e-mail fictício' } });
    const px = await anon('GET', `/public/open/${tokUser}`);
    expect(px.statusCode).toBe(200);
    expect(px.headers['content-type']).toBe('image/gif');
    expect(px.headers['cache-control']).toMatch(/no-store/);
    await anon('GET', `/public/open/${tokUser}`);
    expect((await anon('GET', '/public/open/token-invalido-xxxxxxxxxxxx')).statusCode).toBe(200); // o pixel nunca quebra o e-mail
    expect((await anon('GET', '/public/notices/token-invalido-xxxxxxxxxxxx')).statusCode).toBe(404);
    expect(ok(await anon('GET', `/public/notices/${tokUser}`)).json()).toMatchObject({ recipientName: 'Lucas Lima', role: 'Responsável pela execução (R)', canRespond: false });
    expect(ok(await anon('GET', `/public/notices/${tokActor}`)).json().canRespond).toBe(true);
    ok(await anon('POST', `/public/notices/${tokActor}/confirm`, { response: 'Recebido. Envio o provisionamento até sexta.' }));
    const n = ok(await carlos.get(`/tasks/${taskId}/notices`)).json().items as { recipientName: string; channel: string; openedAt: string | null; lastOpenedAt: string | null; openCount: number; responseText: string | null }[];
    const lucasN = n.find((x) => x.recipientName === 'Lucas Lima')!;
    expect(lucasN.openedAt).toBeTruthy();
    expect(lucasN.openCount).toBe(3); // 2 pelo pixel + 1 pela página do link
    expect(n.find((x) => x.recipientName === 'Financeiro Terceirizado Fictício' && x.channel === 'email')).toMatchObject({ responseText: 'Recebido. Envio o provisionamento até sexta.' });
    const tl = ok(await carlos.get(`/contracts/${contractId}/timeline`)).json();
    expect(tl.items.some((i: { title: string }) => /respondeu ao aviso/.test(i.title))).toBe(true);
    expect(tl.items.filter((i: { title: string }) => /Lucas Lima abriu/.test(i.title))).toHaveLength(1); // só a primeira abertura vai para o histórico
  });

  it('vencida avisa R e A; escalonamento pelo atraso vai ao papel configurado; rodar de novo não repete', async () => {
    sent.length = 0;
    const r1 = await runContractTaskNotices(ctx.app.db, ctx.app.config, new Date('2026-01-10T12:00:00Z'));
    const n = ok(await carlos.get(`/tasks/${taskId}/notices`)).json().items as { recipientName: string; event: string; channel: string }[];
    expect(n.filter((x) => x.event === 'vencida').map((x) => x.recipientName).sort()).toEqual(['Ana Souza', 'Lucas Lima']);
    expect(n.filter((x) => x.event === 'escalada').map((x) => x.recipientName)).toEqual(['Carlos Silva']);
    const again = await runContractTaskNotices(ctx.app.db, ctx.app.config, new Date('2026-01-10T13:00:00Z'));
    const tenant = Object.keys(r1)[0]!;
    expect(again[tenant]).toMatchObject({ overdue: 0, escalated: 0 });
  });

  it('concluída avisa A e I', async () => {
    const t = ok(await lucas.get(`/tasks/${taskId}`)).json();
    ok(await lucas.patch(`/tasks/${taskId}`, { status: 'concluida', rowVersion: t.rowVersion }));
    const n = ok(await carlos.get(`/tasks/${taskId}/notices`)).json().items as { recipientName: string; event: string; raciLetter: string }[];
    expect(n.filter((x) => x.event === 'concluida').map((x) => `${x.recipientName}|${x.raciLetter}`).sort()).toEqual(['Ana Souza|A', 'Carlos Silva|I']);
  });
});

describe('responsáveis nomeados por ação', () => {
  it('indicar pessoas numa letra substitui o papel da matriz nos avisos; A é uma pessoa só', async () => {
    expect((await lucas.put('/contract-playbook/assignees/cadastro_erp', { assignees: {} })).statusCode).toBe(403);
    expect((await carlos.put('/contract-playbook/assignees/cadastro_erp', { assignees: { A: [{ kind: 'user', id: carlos.me.user.id }, { kind: 'user', id: ana.me.user.id }] } })).statusCode).toBe(422);
    expect((await carlos.put('/contract-playbook/assignees/nao_existe', { assignees: {} })).statusCode).toBe(404);
    expect((await carlos.put('/contract-playbook/assignees/cadastro_erp', { assignees: { C: [{ kind: 'actor', id: '00000000-0000-4000-8000-000000000000' }] } })).statusCode).toBe(422);
    ok(await carlos.put('/contract-playbook/assignees/cadastro_erp', { assignees: { A: [{ kind: 'user', id: carlos.me.user.id }], C: [], I: [{ kind: 'actor', id: actorId }] } }));
    const row = ok(await carlos.get('/contract-playbook')).json().matrix.find((x: { key: string }) => x.key === 'cadastro_erp');
    expect(row.assignees).toMatchObject({ A: [{ name: 'Carlos Silva', kind: 'user' }], I: [{ name: 'Financeiro Terceirizado Fictício', kind: 'actor' }] });
    expect(row.assignees.C).toBeUndefined();
    const id = ok(await carlos.post('/tasks', { title: 'Cadastrar contrato no ERP (responsáveis)', ownerId: lucas.me.user.id, contractId, raciKey: 'cadastro_erp' }), 201).json().id;
    const n = ok(await carlos.get(`/tasks/${id}/notices`)).json().items as { recipientName: string; raciLetter: string; channel: string; event: string }[];
    // criada avisa R, A e C: A agora é Carlos (indicado), não a SC; C segue o papel (FIN = ator externo)
    expect([...new Set(n.filter((x) => x.event === 'criada').map((x) => `${x.recipientName}|${x.raciLetter}`))].sort()).toEqual(['Carlos Silva|A', 'Financeiro Terceirizado Fictício|C', 'Lucas Lima|R']);
  });
});

describe('desempenho da operação de contratos', () => {
  it('o painel traz % renovação no prazo, % reajuste e os demais, sem inventar valor quando não há base', async () => {
    const d = ok(await carlos.get('/contracts/dashboard')).json();
    const keys = d.performance.metrics.map((m: { key: string }) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['renovacao_prazo', 'reajuste', 'antecedencia', 'sla_atividades', 'aceite', 'devolucao', 'erp_primeira']));
    for (const m of d.performance.metrics as { value: number | null; den?: number }[]) if (m.den === 0) expect(m.value).toBeNull();
  });
});
