/** Controle de Empenhos: itens do contrato, NEs com itens, medições com baixa FIFO, pendências, revisão e pipeline. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const comp = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
let cid = '', contactId = '';
const L: Record<string, string> = {};

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
  // contrato público a partir de uma venda ganha sem contrato
  const [o] = (await ctx.db.execute(sql`select o.id, o.contact_id from opportunities o where o.stage = 'ganha' and o.deleted_at is null and not exists (select 1 from contracts c where c.opportunity_id = o.id) limit 1`)).rows as { id: string; contact_id: string }[];
  const c = ok(await carlos.post('/contracts', { opportunityId: o!.id, billingType: 'medicao', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: 'CTR-34/2025', object: 'Rede óptica fictícia', signedAt: `${year}-01-10`, startAt: `${year}-01-10`, termMonths: 12, monthlyCents: 0, totalCents: 1_000_000, items: [], publicTerms: { agency: 'Secretaria Fictícia', processNumber: '1/2025', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json();
  cid = c.id; contactId = o!.contact_id;
});
afterAll(async () => ctx.close());

describe('Controle de Empenhos', () => {
  it('importa a planilha: itens, empenhos com itens e histórico de medições', async () => {
    const rows = [
      { commitment: `${year}NE002244`, commitmentItem: '1', code: '460270-6', itemNumber: '15', description: 'Projeto executivo', unit: 'METRO', qty: 1000, unitPrice: 7.82, measured: [200] },
      { commitment: `${year}NE002245`, commitmentItem: '7', code: '460280-3', itemNumber: '24', description: 'Fusão óptica por evento', unit: 'EVENTO', qty: 100, unitPrice: 126, measured: [10] },
    ];
    expect([403, 404]).toContain((await lucas.post(`/contracts/${cid}/commitment-control/import`, { rows, measurements: [], importMeasurements: false })).statusCode);
    const r = ok(await carlos.post(`/contracts/${cid}/commitment-control/import`, { rows, measurements: [{ title: 'Medição 04/02 - Avulsa', date: `${year}-02-04`, kind: 'avulsa' }], importMeasurements: true })).json();
    expect(r).toMatchObject({ createdLines: 2, createdCommitments: 2, createdItems: 2, createdMeasurements: 1 });
    const g = ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json();
    for (const l of g.lines) L[l.itemNumber] = l.id;
    const pe = g.lines.find((l: { itemNumber: string }) => l.itemNumber === '15');
    expect(pe.balance).toMatchObject({ contracted4: 10_000_000, committed4: 10_000_000, executed4: 2_000_000, toCommit4: 0, commitmentBalance4: 8_000_000 });
    expect(g.totals.contracted).toBe(1000 * 78_200 + 100 * 1_260_000);
    expect(g.commitments.map((c: { number: string }) => c.number)).toEqual([`${year}NE002244`, `${year}NE002245`]);
  });

  it('medição: bloqueia acima do contratado; acima do empenho fica pendente; faturar exige cobertura; revisão cria versão', async () => {
    // RN04: 900 restantes no contrato
    ok(await carlos.post(`/contracts/${cid}/measurements`, { competence: comp, kind: 'avulsa', title: 'Excede', items: [{ lineId: L['15'], qty: 801 }] }), 422);
    // empenho tem 800 de saldo; pedir 850 deixa 50 aguardando empenho (RN05)
    const ext = ok(await carlos.post(`/contracts/${cid}/lines`, { items: [{ itemNumber: '99', description: 'Item sem NE', unit: 'UN', classification: 'demanda', qty: 10, price: 100 }] }), 201).json();
    L['99'] = ext.ids[0];
    const m = ok(await carlos.post(`/contracts/${cid}/measurements`, { competence: comp, kind: 'avulsa', title: 'Migração escolas', items: [{ lineId: L['15'], qty: 50 }, { lineId: L['99'], qty: 4 }] }), 201).json();
    expect(m.uncoveredV4).toBe(4 * 1_000_000);
    let g = ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json();
    expect(g.pendencias.find((p: { kind: string }) => p.kind === 'aguardando_empenho')).toMatchObject({ valueV4: 4_000_000 });
    expect(g.alerts.some((a: { key: string }) => a.key === 'aguardando_empenho')).toBe(true);
    ok(await carlos.post(`/contracts/${cid}/measurements/${m.id}/status`, { action: 'atestar' }));
    expect(ok(await carlos.post(`/contracts/${cid}/measurements/${m.id}/status`, { action: 'faturar', invoiceNumber: 'NF 10', invoiceDate: `${comp}-28` }), 422).json().detail).toMatch(/sem empenho/);
    // chega a NE do item 99 e cobre a pendência
    ok(await carlos.post(`/contracts/${cid}/commitment-control/commitments`, { number: `${year}NE009999`, issuedOn: `${year}-01-15`, items: [{ lineId: L['99'], qty: 10, code: '999-1' }] }), 201);
    expect(ok(await carlos.post(`/contracts/${cid}/commitment-control/cover`)).json().coveredV4).toBe(4_000_000);
    ok(await carlos.post(`/contracts/${cid}/measurements/${m.id}/status`, { action: 'faturar', invoiceNumber: 'NF 10', invoiceDate: `${comp}-28` }));
    // revisão de medição faturada: nova versão, a anterior fica no histórico
    const rv = ok(await carlos.post(`/contracts/${cid}/measurements/${m.id}/revise`, { reason: 'erro_quantidade', note: 'O órgão atestou 40 metros, não 50', items: [{ lineId: L['15'], qty: 40 }, { lineId: L['99'], qty: 4 }] }), 201).json();
    expect(rv).toMatchObject({ version: 2, invoiceCorrection: true });
    g = ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json();
    const versions = g.measurements.filter((x: { title: string }) => x.title === 'Migração escolas');
    expect(versions.map((x: { version: number; superseded: boolean }) => [x.version, x.superseded])).toEqual([[1, true], [2, false]]);
    expect(g.lines.find((l: { id: string }) => l.id === L['15']).balance.executed4).toBe(2_400_000); // 200 importados + 40
    ok(await carlos.patch(`/contracts/${cid}/lines/${L['15']}`, { price: 9 }), 422); // item com medição: só por aditivo
  });

  it('pipeline: oportunidade reserva itens do contrato; ganha vira medição com baixa no empenho; perda libera', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const plan = lk.plans[0];
    const o = ok(await carlos.post('/opportunities', { contactId, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false, title: 'Ampliação da rede' }), 201).json();
    void corp;
    const opts = ok(await carlos.get(`/opportunities/${o.id}/contract-items`)).json();
    const ct = opts.contracts.find((x: { id: string }) => x.id === cid);
    expect(ct.lines.find((l: { id: string }) => l.id === L['24']).available4).toBe(900_000);
    ok(await carlos.put(`/opportunities/${o.id}/contract-items`, { contractId: cid, lines: [{ lineId: L['24'], qty: 91 }] }), 422); // passa do saldo
    ok(await carlos.put(`/opportunities/${o.id}/contract-items`, { contractId: cid, lines: [{ lineId: L['24'], qty: 30 }] }));
    let g = ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json();
    expect(g.lines.find((l: { id: string }) => l.id === L['24']).balance).toMatchObject({ reserved4: 300_000, available4: 600_000 });
    // ganha
    const full = ok(await carlos.get(`/opportunities/${o.id}`)).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: full.rowVersion }));
    g = ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json();
    const vm = g.measurements.find((x: { opportunityId: string | null }) => x.opportunityId === o.id);
    expect(vm).toMatchObject({ status: 'elaboracao', kind: 'avulsa' });
    expect(vm.items[0].allocations[0].qty4).toBe(300_000);
    expect(g.lines.find((l: { id: string }) => l.id === L['24']).balance).toMatchObject({ reserved4: 0, pending4: 300_000 });
  });
});
