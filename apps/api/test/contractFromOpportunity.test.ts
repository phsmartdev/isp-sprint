/** Da licitação concluída ao cadastro do contrato: tudo o que a negociação sabe vem preenchido; contatos e anexos passam. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

it('licitação vencida vira contrato com objeto, órgão, processo, itens pelo preço final, endereços, contatos e anexos', async () => {
  const lk = ok(await lucas.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const objeto = 'Contratação de link dedicado de 500 Mbps para as unidades do Conselho, conforme termo de referência.';
  const o = ok(await lucas.post('/opportunities', {
    newContact: { name: 'Conselho Regional Fictício', segment: 'governamental' }, title: 'DE Nº 23/2026 - LINK 500MBPS', pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id,
    installStreet: 'Rua da Sede', installNumber: '10', installCity: 'Aracaju', installCep: '49000-000',
    deliveryAddresses: [{ label: 'Delegacia Itabaiana', street: 'Rua B', city: 'Itabaiana', notes: 'Falar com o zelador' }],
    custom: { tipo_disputa: 'Aberta', lance_inicial: 10000, lance_minimo: 8000, objeto, numero_processo: 'PROC 77/2026', numero_edital: '23/2026', orgao_contratante: 'Conselho Regional Fictício — Sede', data_sessao: '2026-11-03' },
  }), 201).json();
  const addrs = ok(await lucas.get(`/opportunities/${o.id}/delivery-addresses`)).json().items;
  let rv = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [
    { description: 'Link 500 Mbps', unit: 'un', qtyMilli: 1000, unitCents: 300_000, bidUnitCents: 250_000, dealKind: 'recorrencia' },
    { description: 'Link 100 Mbps', unit: 'un', qtyMilli: 2000, unitCents: 100_000, dealKind: 'recorrencia', deliveryAddressId: addrs[0].id },
  ] })).json().rowVersion;
  const its = ok(await lucas.get(`/opportunities/${o.id}/items`)).json().items;
  rv = ok(await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: rv, items: [{ id: its[0].id, finalUnitCents: 200_000, winnerIsUs: true, winnerUnitCents: null }, { id: its[1].id, finalUnitCents: 90_000, winnerIsUs: true, winnerUnitCents: null }] })).json().rowVersion;
  ok(await lucas.post(`/opportunities/${o.id}/contacts`, { person: { name: 'Técnica Fictícia', email: 'ti@conselho.test', phone: '79 0000-0001' }, role: 'avaliador_tecnico' }), 201);
  ok(await lucas.post(`/opportunities/${o.id}/contacts`, { person: { name: 'Financeiro Fictício', email: 'fin@conselho.test', phone: null }, role: 'aprovador_financeiro' }), 201);
  ok(await lucas.post(`/opportunities/${o.id}/attachments`, { kind: 'outro', filename: 'edital.pdf', data: Buffer.from('%PDF-1.4\n% edital ficticio\n').toString('base64') }), 201);
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));

  const pre = ok(await lucas.get(`/contracts/prefill?opportunityId=${o.id}`)).json();
  const v = pre.suggestion.version;
  expect(v.object).toBe(objeto);
  expect(v.publicTerms).toMatchObject({ agency: 'Conselho Regional Fictício — Sede', processNumber: 'PROC 77/2026' });
  // preço final do pregão (não o lance nem o valor de tabela)
  expect(v.items.map((i: { description: string; qty: number; unitCents: number }) => [i.description, i.qty, i.unitCents])).toEqual([['Link 500 Mbps', 1, 200_000], ['Link 100 Mbps', 2, 90_000]]);
  expect(v.monthlyCents).toBe(380_000);
  expect(v.totalCents).toBe(380_000 * 12);
  expect(v.deliveryAddresses.rows).toEqual([
    { seq: 1, address: 'Rua da Sede, 10 · Aracaju · CEP 49000-000', service: 'Link 500 Mbps', extra: { Identificação: 'Principal' } },
    { seq: 2, address: 'Rua B · Itabaiana', service: 'Link 100 Mbps', extra: { Identificação: 'Delegacia Itabaiana', Observação: 'Falar com o zelador' } },
  ]);
  expect(v.zenith.techContact).toMatchObject({ name: 'Técnica Fictícia', email: 'ti@conselho.test' });
  expect(v.zenith.adminContact).toMatchObject({ name: 'Financeiro Fictício', email: 'fin@conselho.test' });
  expect(v.zenith.holderCompany).toBeTruthy();
  expect(v.specialConditions).toContain('Origem: OP-');
  expect(v.specialConditions).toMatch(/Data da sessão.*03\/11\/2026/);
  expect(v.specialConditions).toContain('Técnica Fictícia');
  expect(pre.carries).toEqual({ people: 2, documents: 1 });

  const c = ok(await carlos.post('/contracts', { opportunityId: o.id, kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: lucas.me.user.id, version: { ...v, number: '12/2026', zenith: undefined } }), 201).json();
  const docs = (await ctx.db.execute(sql`select category, summary, size, mime from contract_documents where contract_id = ${c.id}`)).rows;
  expect(docs).toEqual([{ category: 'OUTRO', summary: 'edital', size: Buffer.byteLength('%PDF-1.4\n% edital ficticio\n'), mime: 'application/pdf' }]);
  const people = (await ctx.db.execute(sql`select role from stakeholder_links where entity_type = 'contrato' and entity_id = ${c.id} and removed_at is null order by role`)).rows.map((r) => (r as { role: string }).role);
  expect(people).toEqual(['aprovador_financeiro', 'usuario']);
  const d = ok(await carlos.get(`/contracts/${c.id}`)).json();
  expect(d.current.deliveryAddresses.rows).toHaveLength(2);
  expect(d.current.publicTerms.processNumber).toBe('PROC 77/2026');
});
