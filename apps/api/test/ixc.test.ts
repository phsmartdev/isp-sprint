/**
 * IXC somente leitura contra um IXC SIMULADO com o formato da documentação oficial:
 * POST /webservice/v1/<tabela>, Basic usuário:token, cabeçalho ixcsoft: listar → { page, total, registros }.
 * O simulado registra TODA requisição: nenhuma pode sair sem `listar` ou para tabela fora da lista.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
let server: Server, url = '';
const seen: { path: string; ixcsoft: string | undefined; method: string; auth: string | undefined; body: Record<string, string> }[] = [];
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const DOC = '12.345.678/0001-90';
const TABLES: Record<string, Record<string, unknown>[]> = {
  cliente: [{ id: '77', razao: 'Órgão IXC Fictício', cnpj_cpf: DOC }],
  fn_areceber: [
    { id: '1', id_cliente: '77', status: 'A', valor: '1500.00', data_vencimento: '2026-01-10', documento: 'B-1' },
    { id: '2', id_cliente: '77', status: 'R', valor: '1500.00', valor_recebido: '1500.00', data_vencimento: '2025-12-10', pagamento_data: '2025-12-09' },
    { id: '3', id_cliente: '77', status: 'A', valor: '1500.00', data_vencimento: '2099-01-10' },
  ],
  su_oss_chamado: [{ id: '9', id_cliente: '77', status: 'AG', prioridade: 'A', id_assunto: '4', data_abertura: '2026-10-01 08:00:00', protocolo: '2026100001' }],
  su_oss_assunto: [{ id: '4', assunto: 'Sem conexão' }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = b ? JSON.parse(b) as Record<string, string> : {};
      seen.push({ path: req.url ?? '', ixcsoft: req.headers.ixcsoft as string | undefined, method: req.method ?? '', auth: req.headers.authorization, body });
      if (req.headers.authorization !== `Basic ${Buffer.from('6:token-ixc').toString('base64')}`) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Acesso restrito"' }); return res.end(); }
      const table = (req.url ?? '').replace('/webservice/v1/', '');
      const field = (body.qtype ?? '').split('.')[1]!;
      const rows = (TABLES[table] ?? []).filter((r) => (body.oper === '>' ? Number(r[field]) > Number(body.query) : String(r[field]) === body.query));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ page: body.page, total: String(rows.length), registros: rows }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/app/login`;
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
});
afterAll(async () => { await ctx.db.execute(sql`update integrations set enabled = false where kind = 'ixc'`); server.close(); await ctx.close(); });

describe('IXC somente leitura', () => {
  it('teste de conexão, faturas e OS da conta pelo CNPJ; nada além de listar', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: `Órgão IXC ${Date.now()}`, segment: 'governamental', document: '12345678000190' }, planId: plan.id }), 201).json();
    // desligada: a ficha diz que não há integração (sem chamar o IXC)
    expect(ok(await carlos.get(`/contacts/${o.contactId}/ixc/financeiro`)).json()).toEqual({ enabled: false });

    ok(await carlos.put('/admin/integrations/ixc', { enabled: true, config: { baseUrl: url, user: '6' }, secrets: { token: 'errado' } }));
    expect(ok(await carlos.post('/admin/integrations/ixc/test')).json()).toMatchObject({ ok: false, message: expect.stringMatching(/401/) });
    ok(await carlos.put('/admin/integrations/ixc', { enabled: true, config: { baseUrl: url, user: '6' }, secrets: { token: 'token-ixc' } }));
    expect(ok(await carlos.post('/admin/integrations/ixc/test')).json()).toMatchObject({ ok: true, message: expect.stringMatching(/1 cliente/) });

    const fin = ok(await carlos.get(`/contacts/${o.contactId}/ixc/financeiro`)).json();
    expect(fin.client).toMatchObject({ id: '77', via: 'documento' });
    expect(fin.invoices).toHaveLength(3);
    expect(fin.summary).toMatchObject({ abertas: 2, vencidas: 1, vencidoCents: 150_000, recebidoCents: 150_000 });

    const os = ok(await carlos.get(`/contacts/${o.contactId}/ixc/atendimentos`)).json();
    expect(os.orders[0]).toMatchObject({ statusLabel: 'Agendada', prioridade: 'Alta', assunto: 'Sem conexão', aberta: true });

    // trava: toda requisição foi POST com ixcsoft: listar, só em tabelas liberadas
    expect(seen.length).toBeGreaterThan(4);
    for (const r of seen) {
      expect(r.method).toBe('POST');
      expect(r.ixcsoft).toBe('listar');
      expect(['cliente', 'fn_areceber', 'su_oss_chamado', 'su_oss_assunto']).toContain(r.path.replace('/webservice/v1/', ''));
    }
  });

  it('conta sem CPF/CNPJ no cadastro usa o campo personalizado "CPF/CNPJ"', async () => {
    ok(await carlos.put('/admin/customer-fields', { fields: [{ rotulo: 'CPF/CNPJ', tipo: 'texto' }] }));
    const c = ok(await carlos.post('/contacts', { name: 'Conta Sem Documento Fictícia', phone: '79 98888-2222', segment: 'governamental' }), 201).json();
    expect(ok(await carlos.get(`/contacts/${c.id}/ixc/financeiro`)).json()).toMatchObject({ enabled: true, client: null });
    ok(await carlos.patch(`/contacts/${c.id}/custom`, { custom: { cpf_cnpj: '12345678000190' } }));
    const fin = ok(await carlos.get(`/contacts/${c.id}/ixc/financeiro`)).json();
    expect(fin.client).toMatchObject({ id: '77', via: 'documento' });
    expect(fin.invoices).toHaveLength(3);
    ok(await carlos.put('/admin/customer-fields', { fields: [] }));
  });

  it('faturas exigem ver valores financeiros; conta fora da carteira não aparece', async () => {
    const other = (await ctx.db.execute<{ id: string }>(sql`select id from contacts where owner_id <> ${lucas.me.user.id} and deleted_at is null limit 1`)).rows[0]!.id;
    expect((await lucas.get(`/contacts/${other}/ixc/financeiro`)).statusCode).toBe(404);
  });
});
