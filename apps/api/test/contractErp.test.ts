/**
 * Playbook (matriz RACI, titulares, SLA, aceite) e Cadastro ERP do contrato contra um IXC SIMULADO só de leitura.
 * Cobre os critérios de aceite: herdar dados, completar, obrigatórios, conferência independente, devolução com
 * justificativa, aprovação, lançamento com código, conferência no IXC, divergência com pendência e histórico.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
let server: Server, url = '';
const seen: { table: string; ixcsoft: string | undefined }[] = [];
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toISOString().slice(0, 10);
const CNPJ = '11.222.333/0001-81';
const IXC: Record<string, Record<string, unknown>[]> = {
  cliente: [{ id: '501', razao: 'CLIENTE ERP FICTICIO LTDA', cnpj_cpf: '11222333000181', filial_id: '2', email: 'erp@cliente.test', cep: '49040-460' }],
  cliente_contrato: [{ id: '9001', id_cliente: '501', id_modelo: '3', id_carteira_cobranca: '7' }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const table = (req.url ?? '').replace('/webservice/v1/', '');
      seen.push({ table, ixcsoft: req.headers.ixcsoft as string | undefined });
      const q = b ? JSON.parse(b) as { query: string } : { query: '' };
      const regs = (IXC[table] ?? []).filter((r) => String(r.id) === q.query);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ page: 1, total: regs.length, registros: regs }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
});
afterAll(async () => { await ctx.db.execute(sql`update integrations set enabled = false where kind = 'ixc'`); await ctx.db.execute(sql`update users set playbook_roles = '{}'`); server.close(); await ctx.close(); });

async function wonContract(name: string) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'empresarial' }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  return ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: 'ERP-001', object: 'Link dedicado fictício', signedAt: addDays(today, -5), startAt: addDays(today, -5), termMonths: 12, monthlyCents: 50_000, items: [{ planId: null, description: 'Link 100 Mbps', qty: 1, unitCents: 50_000 }] } }), 201).json().id as string;
}

const FILL = {
  a_ativo: 'S', a_tipo_pessoa: 'J', a_cnpj_cpf: CNPJ, a_contribuinte_icms: 'N', a_tipo_assinante: '1', a_filial: '1',
  a_cep: '49040-460', a_endereco: 'Av. Fictícia', a_numero: '100', a_bairro: 'Centro', a_cidade: 'Aracaju', a_uf: 'SE',
  a_celular: '(79) 99999-0000', a_email: 'erp@cliente.test', a_login: 'cliente.erp',
  b_modelo: '3', d_vencimento: '10', d_forma_pagamento: 'Boleto', d_periodicidade: 'Mensal', d_primeira_competencia: today.slice(0, 7),
  d_inicio_faturamento: today, d_carteira: '7', e_indice: 'IPCA', e_data_base: today, e_periodicidade: '12',
  f_endereco_instalacao: 'Av. Fictícia, 100', f_servico: 'CIRC-0001', f_tecnologia: 'Fibra', f_resp_implantacao: 'Equipe de implantação',
};
const item = { description: 'Link 100 Mbps', qty: 1, unitCents: 50_000, ixcCode: '55', unit: 'UN', periodicity: 'Mensal', location: null, notes: null };

describe('Playbook: matriz RACI, titulares em aberto e SLA', () => {
  it('mostra a matriz do documento com papéis e SLA em aberto; só a gestão de contratos altera', async () => {
    const p = ok(await lucas.get('/contract-playbook')).json();
    expect(p.matrix).toHaveLength(39);
    expect(p.matrix.find((x: { key: string }) => x.key === 'cadastro_erp')).toMatchObject({ R: ['ASC'], A: 'SC', C: ['FIN'], I: ['GC'], slaHours: null });
    // AC, TC e ANS do documento viraram ANC
    expect(p.matrix.find((x: { key: string }) => x.key === 'validacao_comercial').R).toEqual(['ANC']);
    expect(p.matrix.find((x: { key: string }) => x.key === 'atualizacao_final').A).toBe('ANC');
    expect(p.roles.every((r: { users: unknown[]; actors: unknown[] }) => r.users.length === 0 && r.actors.length === 0)).toBe(true);
    expect(p.canManage).toBe(false);
    expect((await lucas.put('/contract-playbook/sla/cadastro_erp', { slaHours: 48 })).statusCode).toBe(403);
    ok(await carlos.put('/contract-playbook/sla/cadastro_erp', { slaHours: 48 }));
    expect((await carlos.put('/contract-playbook/sla/inexistente', { slaHours: 4 })).statusCode).toBe(404);
    // ator externo: papéis e canais; o canal exige o contato
    expect((await carlos.post('/contract-external-actors', { name: 'Jurídico Fictício', roles: ['JUR'], channels: ['email'] })).statusCode).toBe(422);
    const ext = ok(await carlos.post('/contract-external-actors', { name: 'Jurídico Fictício', organization: 'Escritório Fictício', email: 'juridico@ficticio.test', roles: ['JUR'], channels: ['email'] }), 201).json();
    expect((await lucas.post('/contract-external-actors', { name: 'X Fictício', roles: [] })).statusCode).toBe(403);
    const after = ok(await carlos.get('/contract-playbook')).json();
    expect(after.roles.find((r: { key: string }) => r.key === 'JUR').actors[0]).toMatchObject({ name: 'Jurídico Fictício', channels: ['email'] });
    ok(await carlos.put(`/contract-external-actors/${ext.id}`, { name: 'Jurídico Fictício', roles: ['JUR'], channels: [], active: false }));
    expect(ok(await carlos.get('/contract-playbook')).json().roles.find((r: { key: string }) => r.key === 'JUR').actors).toHaveLength(0);
  });

  it('tarefa transferida exige aceite; devolver volta para quem enviou; SLA da atividade vira prazo; evidência para concluir', async () => {
    const t = ok(await carlos.post('/tasks', { title: 'Cadastrar contrato no ERP', ownerId: lucas.me.user.id, requireAccept: true, raciKey: 'cadastro_erp', evidenceRequired: true }), 201).json();
    let d = ok(await lucas.get(`/tasks/${t.id}`)).json();
    expect(d).toMatchObject({ acceptStatus: 'pendente', raciKey: 'cadastro_erp', evidenceRequired: true });
    expect(d.dueOn).toBe(new Date(Date.now() + 48 * 3_600_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
    expect((await lucas.patch(`/tasks/${t.id}`, { status: 'concluida', rowVersion: d.rowVersion })).statusCode).toBe(422);
    expect((await carlos.post(`/tasks/${t.id}/accept`, { accept: true })).statusCode).toBe(403);
    expect((await lucas.post(`/tasks/${t.id}/accept`, { accept: false, reason: 'x' })).statusCode).toBe(422);
    ok(await lucas.post(`/tasks/${t.id}/accept`, { accept: false, reason: 'Falta o contrato assinado' }));
    d = ok(await carlos.get(`/tasks/${t.id}`)).json();
    expect(d).toMatchObject({ acceptStatus: 'devolvida', ownerId: carlos.me.user.id, returnReason: 'Falta o contrato assinado' });
    ok(await carlos.patch(`/tasks/${t.id}`, { ownerId: lucas.me.user.id, rowVersion: d.rowVersion }));
    d = ok(await lucas.get(`/tasks/${t.id}`)).json();
    expect(d.acceptStatus).toBe('pendente');
    ok(await lucas.post(`/tasks/${t.id}/accept`, { accept: true }));
    d = ok(await lucas.get(`/tasks/${t.id}`)).json();
    expect((await lucas.patch(`/tasks/${t.id}`, { status: 'concluida', rowVersion: d.rowVersion })).json().detail).toMatch(/evidência/);
    ok(await lucas.post(`/tasks/${t.id}/files`, { name: 'evidencia.txt', mime: 'text/plain', data: Buffer.from('ok').toString('base64') }), 201);
    d = ok(await lucas.get(`/tasks/${t.id}`)).json();
    ok(await lucas.patch(`/tasks/${t.id}`, { status: 'concluida', rowVersion: d.rowVersion }));
    // sem SLA configurado, nenhum prazo é inventado
    const t2 = ok(await carlos.post('/tasks', { title: 'Registro no CRM', raciKey: 'registro_crm' }), 201).json();
    expect(ok(await carlos.get(`/tasks/${t2.id}`)).json().dueOn).toBeNull();
    ok(await carlos.put('/contract-playbook/sla/cadastro_erp', { slaHours: null }));
  });
});

describe('Cadastro ERP', () => {
  let id = '', rid = '';
  const cur = async (c: Client = lucas) => ok(await c.get(`/contracts/${id}/erp`)).json().current;
  const act = async (c: Client, action: string, extra: object = {}) => c.post(`/contracts/${id}/erp/${rid}/actions`, { action, rowVersion: (await cur(c)).rowVersion, ...extra });

  it('herda do contrato e da conta, sem copiar; obrigatórios impedem o envio', async () => {
    id = await wonContract('Cliente ERP Fictício Ltda');
    ok(await carlos.post(`/contracts/${id}/validate`));
    const g = ok(await lucas.get(`/contracts/${id}/erp`)).json();
    expect(g).toMatchObject({ current: null, canStart: true });
    rid = ok(await lucas.post(`/contracts/${id}/erp`, { cycle: 'implantacao' }), 201).json().id;
    expect((await lucas.post(`/contracts/${id}/erp`, {})).statusCode).toBe(422);
    const c = await cur();
    const f = (k: string) => c.fields.find((x: { key: string }) => x.key === k);
    expect(c.status).toBe('nao_iniciado');
    expect(f('a_razao')).toMatchObject({ value: 'Cliente ERP Fictício Ltda', origin: 'herdado' });
    expect(f('b_numero')).toMatchObject({ value: 'ERP-001', origin: 'herdado' });
    expect(f('d_recorrente')).toMatchObject({ value: '50000', origin: 'herdado' });
    expect(c.items[0]).toMatchObject({ description: 'Link 100 Mbps', ixcCode: null });
    expect(c.issues.length).toBeGreaterThan(20);
    const r = await act(lucas, 'submit');
    expect(r.statusCode).toBe(422);
    expect(r.json().detail).toMatch(/pendência/);
    // a etapa de ERP da implantação não conclui à mão enquanto o cadastro não estiver conferido
    const proc = ok(await lucas.get(`/contracts/${id}`)).json().processes.find((p: { kind: string }) => p.kind === 'implantacao');
    expect((await carlos.post(`/contracts/${id}/processes/${proc.id}/steps/erp_cadastro`, { value: { ref: '123' } })).json().detail).toMatch(/Cadastro ERP/);
  });

  it('valida formato (CNPJ, tipo de pessoa) e campos fora do catálogo', async () => {
    let c = await cur();
    expect((await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { campo_x: '1' } })).statusCode).toBe(422);
    ok(await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { a_cnpj_cpf: '11.222.333/0001-00', a_tipo_pessoa: 'F' } }));
    c = await cur();
    expect(c.status).toBe('em_preenchimento');
    expect(c.issues.find((i: { key: string }) => i.key === 'a_cnpj_cpf').message).toBe('CNPJ inválido');
    expect(c.fields.find((x: { key: string }) => x.key === 'a_razao').origin).toBe('herdado');
  });

  it('preenche, envia; conferência travada e independente; devolução exige justificativa', async () => {
    let c = await cur();
    ok(await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: FILL, items: [item], secret: 'Senha#Central1' }));
    c = await cur();
    expect(c.issues).toEqual([]);
    expect(c.fields.find((x: { key: string }) => x.key === 'a_senha')).toMatchObject({ value: null, hasValue: true });
    ok(await act(lucas, 'submit'));
    c = await cur();
    expect(c.status).toBe('aguardando_conferencia');
    expect((await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { a_numero: '101' } })).statusCode).toBe(422);
    // o vendedor (nível Próprio) não confere; quem enviou também não
    expect((await act(lucas, 'approve')).statusCode).toBe(403);
    expect((await act(ana, 'return', { note: 'ok' })).statusCode).toBe(422);
    ok(await act(ana, 'return', { note: 'Confira o CEP de instalação' }));
    c = await cur();
    expect(c.status).toBe('devolvido');
    expect(c.events[0]).toMatchObject({ action: 'return', note: 'Confira o CEP de instalação', fromStatus: 'aguardando_conferencia', toStatus: 'devolvido' });
    // a supervisora corrige um campo: vira editora e não pode mais aprovar este ciclo
    ok(await ana.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { a_referencia: 'Próximo ao fórum' } }));
    ok(await act(lucas, 'submit'));
    const blocked = await act(ana, 'approve');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().detail).toMatch(/outra pessoa/);
    ok(await act(carlos, 'approve'));
    c = await cur();
    expect(c).toMatchObject({ status: 'aprovado', approvedByName: 'Carlos Silva' });
    expect(c.approvedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('campo crítico alterado depois da aprovação exige nova conferência; não crítico não', async () => {
    let c = await cur();
    ok(await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { f_banda: '100 Mbps' } }));
    expect((await cur()).status).toBe('aprovado');
    c = await cur();
    const r = ok(await lucas.put(`/contracts/${id}/erp/${rid}`, { rowVersion: c.rowVersion, values: { d_vencimento: '15' } })).json();
    expect(r).toMatchObject({ status: 'em_preenchimento', invalidated: ['d_vencimento'] });
    c = await cur();
    expect(c.events[0].action).toBe('aprovacao_invalidada');
    ok(await act(lucas, 'submit'));
    ok(await act(carlos, 'approve'));
    expect((await cur()).status).toBe('aprovado');
  });

  it('ficha de lançamento em PDF, senha só para quem lança, lançamento com código', async () => {
    const pdf = ok(await lucas.get(`/contracts/${id}/erp/${rid}/sheet.pdf`));
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(ok(await lucas.get(`/contracts/${id}/erp/${rid}/secret`)).json().secret).toBe('Senha#Central1');
    // com Assistente Comercial definido no Playbook, só ele (ou a gestão Total) vê a senha
    ok(await carlos.patch(`/admin/users/${lucas.me.user.id}`, { playbookRoles: ['ASC'] }));
    expect((await ana.get(`/contracts/${id}/erp/${rid}/secret`)).statusCode).toBe(403);
    ok(await carlos.patch(`/admin/users/${lucas.me.user.id}`, { playbookRoles: [] }));
    expect((await cur()).events[0].action).toBe('senha_visualizada');
    ok(await act(lucas, 'release'));
    expect((await act(lucas, 'launch')).statusCode).toBe(422);
    ok(await act(lucas, 'launch', { ixcClientId: '501', ixcContractId: '9001' }));
    const c = await cur();
    expect(c).toMatchObject({ status: 'lancado', ixcClientId: '501', ixcContractId: '9001', launchedByName: 'Lucas Lima' });
    expect(ok(await lucas.get(`/contracts/${id}`)).json().erpRef).toBe('IXC cliente 501 · contrato 9001');
  });

  it('confere no IXC só por leitura: divergência vira pendência; não lidos passam pela pessoa; conferido fecha a etapa', async () => {
    ok(await carlos.put('/admin/integrations/ixc', { enabled: true, config: { baseUrl: url, user: '6' }, secrets: { token: 'token-ixc' } }));
    expect((await act(lucas, 'check')).statusCode).toBe(403); // quem lançou não confere
    seen.length = 0;
    let r = ok(await act(carlos, 'check')).json();
    expect(seen.every((x) => x.ixcsoft === 'listar' && ['cliente', 'cliente_contrato'].includes(x.table))).toBe(true);
    expect(r.status).toBe('divergente');
    const byKey = Object.fromEntries(r.compare.map((x: { key: string }) => [x.key, x]));
    expect(byKey.a_filial).toMatchObject({ status: 'divergente', expected: '1', found: '2' });
    expect(byKey.a_cnpj_cpf.status).toBe('ok');
    expect(byKey.a_razao.status).toBe('ok'); // sem acento e caixa alta contam como iguais
    const tasks = ok(await lucas.get(`/tasks?contractId=${id}&view=todas`)).json().items;
    expect(tasks.some((t: { title: string; ownerId: string }) => /divergência/.test(t.title) && t.ownerId === lucas.me.user.id)).toBe(true);
    // corrigido no IXC: os campos que a leitura não traz ficam para a pessoa conferir
    IXC.cliente![0]!.filial_id = '1';
    r = ok(await act(carlos, 'check')).json();
    expect(r.status).toBe('divergente');
    expect(r.pendingManual.length).toBeGreaterThan(0);
    r = ok(await act(carlos, 'check', { manualOk: r.pendingManual })).json();
    expect(r.status).toBe('conferido_ixc');
    const c = ok(await lucas.get(`/contracts/${id}`)).json();
    const proc = c.processes.find((p: { kind: string }) => p.kind === 'implantacao');
    expect(proc.steps.erp_cadastro).toMatchObject({ value: { ref: '9001' } });
    // histórico só de acréscimo
    await expect(ctx.app.db.execute(sql`update contract_erp_events set note = 'x' where record_id = ${rid}`)).rejects.toThrow(/append-only/);
  });

  it('novo ciclo parte do último aprovado; painel conta por situação', async () => {
    const nr = ok(await lucas.post(`/contracts/${id}/erp`, { cycle: 'aditivo' }), 201).json();
    const g = ok(await lucas.get(`/contracts/${id}/erp`)).json();
    expect(g.cycles).toHaveLength(2);
    expect(g.current).toMatchObject({ id: nr.id, seq: 2, status: 'nao_iniciado', ixcClientId: '501' });
    expect(g.current.fields.find((x: { key: string }) => x.key === 'a_login')).toMatchObject({ value: 'cliente.erp', origin: 'manual' });
    const sm = ok(await carlos.get('/contracts/erp/summary')).json();
    expect(sm.byStatus.nao_iniciado).toBeGreaterThanOrEqual(1);
    expect(sm.firstPassRate).not.toBeNull();
  });

  it('com titulares no Playbook, a conferência é da Supervisão (ou Gerência) definida', async () => {
    ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: ['SC'] }));
    const g = ok(await carlos.get(`/contracts/${id}/erp`)).json();
    expect(g.current.can.review).toBe(false);
    expect(ok(await ana.get(`/contracts/${id}/erp`)).json().current.can.review).toBe(true);
    ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: [] }));
  });

  it('responsável administrativo do contrato fica em aberto até ser designado', async () => {
    expect(ok(await carlos.get(`/contracts/${id}`)).json().adminOwnerName).toBeNull();
    ok(await carlos.put(`/contracts/${id}`, { adminOwnerId: ana.me.user.id }));
    expect(ok(await carlos.get(`/contracts/${id}`)).json().adminOwnerName).toBe('Ana Souza');
  });

  it('painel para decisão: saúde soma o MRR, contratos que pedem ação, vencimentos pela renovação, concentração e responsáveis', async () => {
    const d = ok(await carlos.get('/contracts/dashboard')).json();
    const sum = d.decision.health.reduce((a: number, h: { monthlyCents: number }) => a + h.monthlyCents, 0);
    expect(sum).toBe(d.monthlyCents);
    expect(d.decision.health.map((h: { key: string }) => h.key)).toEqual(['em_dia', 'pendencia', 'divergente', 'em_risco']);
    expect(d.decision.expiringPlan).toHaveLength(12);
    expect(d.decision.actionList.every((r: { health: string }) => r.health !== 'em_dia')).toBe(true);
    expect(d.decision.pareto.items[0].share).toBeGreaterThan(0);
    expect(d.decision.byOwner.reduce((a: number, o: { n: number }) => a + o.n, 0)).toBe(d.active);
  });
});
