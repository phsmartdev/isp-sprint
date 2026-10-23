/** Participantes da licitação: ranking por lote, vencedores, histórico e restrição ao tipo Licitação. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, rafael: Client, carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  rafael = await login(ctx.app, 'rafael@yepnet.test');
  carlos = await login(ctx.app, 'carlos@yepnet.test');
});
afterAll(async () => ctx.close());

async function newOpp(saleKind: string) {
  const lk = ok(await lucas.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  return ok(await lucas.post('/opportunities', { newContact: { name: `Conta Pregão ${Date.now().toString(36)}`, segment: 'governamental' }, pipelineId: p.id, saleKind, branchId: lk.branches[0].id }), 201).json();
}

describe('Participantes da licitação', () => {
  it('ranking por lote, um vencedor por lote, histórico, conflito de versão', async () => {
    const o = await newOpp('licitacao');
    const two = await lucas.put(`/opportunities/${o.id}/bid-participants`, { rowVersion: o.rowVersion, items: [{ company: 'Rede Alfa', bidCents: 100, winner: true }, { company: 'Rede Beta', bidCents: 90, winner: true }] });
    expect(two.statusCode).toBe(422);
    expect(two.json().detail).toMatch(/Lote único/);
    const r = ok(await lucas.put(`/opportunities/${o.id}/bid-participants`, { rowVersion: o.rowVersion, items: [
      { company: 'Nossa empresa', isUs: true, lot: '1', bidCents: 250000, winner: true },
      { company: 'Rede Alfa', document: '11.222.333/0001-81', lot: '1', bidCents: 260000 },
      { company: 'Rede Alfa', document: '11222333000181', lot: '2', bidCents: 120000, winner: true },
      { company: 'Rede Beta', lot: '2', bidCents: 110000, status: 'desclassificado' },
    ] })).json();
    expect(r.items.map((x: { rank: number | null }) => x.rank)).toEqual([1, 2, 1, null]);
    expect(r.items[1].document).toBe('11222333000181');
    const got = ok(await lucas.get(`/opportunities/${o.id}/bid-participants`)).json();
    expect(got.items.filter((x: { winner: boolean }) => x.winner)).toHaveLength(2);
    expect((await lucas.put(`/opportunities/${o.id}/bid-participants`, { rowVersion: o.rowVersion, items: [] })).statusCode).toBe(409);
    const tl = ok(await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(JSON.stringify(tl.items)).toMatch(/Rede Alfa \(lote 2: 1200\.00, vencedora\)/);
    expect((await rafael.get(`/opportunities/${o.id}/bid-participants`)).statusCode).toBe(404);
  });
  it('só em licitação', async () => {
    const o = await newOpp('venda_consultiva');
    const r = await lucas.put(`/opportunities/${o.id}/bid-participants`, { rowVersion: o.rowVersion, items: [{ company: 'Rede Alfa', bidCents: 1 }] });
    expect(r.statusCode).toBe(422);
  });
  it('linha do tempo do pregão (append-only) e inteligência por concorrente', async () => {
    const doc = '44555666000172';
    const a = await newOpp('licitacao');
    const b = await newOpp('licitacao');
    ok(await lucas.put(`/opportunities/${a.id}/bid-participants`, { rowVersion: a.rowVersion, items: [{ company: 'Nós', isUs: true, bidCents: 100000, winner: true }, { company: 'Rede Ômega', document: doc, bidCents: 110000 }] }));
    ok(await lucas.put(`/opportunities/${b.id}/bid-participants`, { rowVersion: b.rowVersion, items: [{ company: 'Nós', isUs: true, bidCents: 210000 }, { company: 'Rede Omega Telecom', document: doc, bidCents: 200000, winner: true }] }));
    const when = new Date(Date.now() - 3600_000).toISOString();
    ok(await lucas.post(`/opportunities/${b.id}/bid-actions`, { company: 'Rede Omega Telecom', document: doc, kind: 'lance', amountCents: 205000, occurredAt: when }), 201);
    ok(await lucas.post(`/opportunities/${b.id}/bid-actions`, { company: 'Rede Omega Telecom', document: doc, kind: 'recurso', description: 'Recurso contra nossa habilitação', occurredAt: new Date().toISOString() }), 201);
    expect((await lucas.post(`/opportunities/${b.id}/bid-actions`, { company: 'X Ltda', kind: 'lance', occurredAt: new Date(Date.now() + 86400_000).toISOString() })).statusCode).toBe(422);
    const tl = ok(await lucas.get(`/opportunities/${b.id}/bid-actions`)).json();
    expect(tl.items.map((x: { kind: string }) => x.kind)).toEqual(['lance', 'recurso']);
    const list = ok(await carlos.get('/intelligence/competitors?q=omega')).json();
    const c = list.items.find((x: { document: string }) => x.document === doc);
    expect(c).toMatchObject({ bids: 2, wins: 1, ourWinsAgainst: 1, theirWinsAgainstUs: 1, avgBidCents: 155000, name: expect.stringMatching(/Omega|Ômega/) });
    const det = ok(await carlos.get(`/intelligence/competitors/${encodeURIComponent(c.key)}`)).json();
    expect(det.pregoes).toHaveLength(2);
    const pb = det.pregoes.find((p: { opportunityId: string }) => p.opportunityId === b.id);
    expect(pb.lots[0]).toMatchObject({ them: { rank: 1, winner: true }, us: { rank: 2, winner: false }, winner: { isUs: false } });
    expect(det.actionsByKind).toMatchObject({ lance: 1, recurso: 1 });
  });
});
