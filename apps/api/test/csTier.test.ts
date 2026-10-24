/** Tier do Sucesso do Cliente pelo valor anual consolidado: ganha sem contrato conta; consumo de medição não. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

async function wonOpp(contactId: string | null, name: string, saleKind: string, items: { description: string; unit: string; qtyMilli: number; unitCents: number }[]) {
  const lk = ok(await carlos.get('/meta/lookups')).json();
  const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
  const o = ok(await carlos.post('/opportunities', { ...(contactId ? { contactId } : { newContact: { name, segment: 'governamental' } }), pipelineId: corp.id, saleKind, branchId: lk.branches[0].id }), 201).json();
  const r = ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items })).json();
  const won = corp.stages.find((st: { kind: string }) => st.kind === 'won');
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: won.key, rowVersion: r.rowVersion, confirm: true }));
  return o as { id: string; contactId: string };
}

describe('Tier pelo valor consolidado das oportunidades', () => {
  it('ganha sem contrato soma pelo valor; consumo de contrato não soma; Tier muda com o total', async () => {
    const a = await wonOpp(null, `Órgão Tier ${Date.now().toString(36)}`, 'licitacao', [{ description: 'Link dedicado anual', unit: 'un', qtyMilli: 1000, unitCents: 30_000_000 }]);
    await wonOpp(a.contactId, '', 'consumo_contrato', [{ description: 'Consumo da ata', unit: 'rs', qtyMilli: 1000, unitCents: 90_000_000 }]);
    ok(await carlos.post('/cs/recompute', { contactId: a.contactId }));
    let acc = ok(await carlos.get(`/cs/accounts/${a.contactId}`)).json();
    const snap = acc.snapshot ?? acc;
    expect(snap.tier).toBe('middle');
    expect(snap.groupAcvCents).toBe(30_000_000);
    expect(snap.acvExcluded).toMatchObject({ count: 1, cents: 90_000_000 });
    await wonOpp(a.contactId, '', 'venda_consultiva', [{ description: 'Expansão', unit: 'un', qtyMilli: 1000, unitCents: 25_000_000 }]);
    ok(await carlos.post('/cs/recompute', { contactId: a.contactId }));
    acc = ok(await carlos.get(`/cs/accounts/${a.contactId}`)).json();
    expect((acc.snapshot ?? acc).tier).toBe('large');
  });
});
