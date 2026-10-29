/** Viabilidade econômica: documentos fiscais por filial, tributo no item, parâmetros, cálculo, fotografia e trava de payback. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ECON = { marginTargetBp: 3500, tmaMonthlyBp: 0, commissionBp: 500, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, validFrom: today };
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas, rafael] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test'), login(ctx.app, 'rafael@yepnet.test')]); });
afterAll(async () => ctx.close());

describe('viabilidade econômica', () => {
  it('documentos fiscais por filial, item com documento, cálculo com tributo ponderado, fotografia e trava de payback', async () => {
    // parâmetros do motor (Configurações → Viabilidade)
    ok(await lucas.post('/admin/viability/econ', {}), 403);
    // vigência no passado não vale (cálculos salvos não mudam de regra)
    ok(await carlos.post('/admin/viability/econ', { ...ECON, validFrom: '2020-01-01' }), 422);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    const adm = ok(await carlos.get('/admin/viability/econ')).json();
    expect(adm.current).toMatchObject({ marginTargetBp: 3500, validFrom: today });

    // documentos fiscais na filial
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const branch = lk.branches[0].id;
    ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [{ id: null, fiscalKind: 'servico', code: 'x', name: 'Duplicado', active: true, taxes: [] }, { id: null, fiscalKind: 'servico', code: 'X', name: 'Duplicado', active: true, taxes: [] }] }), 422);
    const docs = ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [
      { id: null, fiscalKind: 'servico', code: 'nfs-e', name: 'Nota de serviço', active: true, taxes: [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'PIS/COFINS', percentBp: 365, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'servico', code: 'NFCOM', name: 'Nota de comunicação', active: true, taxes: [{ name: 'ICMS', percentBp: 2000, fixedCents: 0, active: true }] },
    ] })).json().items;
    const nfse = docs.find((d: { code: string }) => d.code === 'NFS-E');
    const nfcom = docs.find((d: { code: string }) => d.code === 'NFCOM');
    expect(nfse.rates).toMatchObject({ percentBp: 865, complete: true });

    // oportunidade com 2 itens (50/50) e documentos diferentes
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Viab ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    const items = [
      { description: 'Link dedicado', unit: 'un', qtyMilli: 1000, unitCents: 500_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: nfcom.id },
      { description: 'Gerenciamento', unit: 'un', qtyMilli: 1000, unitCents: 500_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: nfse.id },
    ];
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ ...items[0], fiscalDocTypeId: '00000000-0000-4000-8000-000000000000' }] }), 422);
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items }));

    const g = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(g.saved).toBeNull();
    expect(g.result).toBeNull(); // nada salvo: consultar não inventa resultado

    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 3_000_000 }], extraInitialCents: 0, opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 200_000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, termMonths: 0 }), 422);
    const saved = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    // a = 0,5×20% + 0,5×8,65% = 14,325%
    expect(saved.result.rates.a).toBeCloseTo(0.14325, 8);
    expect(saved.result.withReservations).toBe(false);
    // P = 10.000; MC = 10.000 − 1.432,50 − 500 − 2.000 = 6.067,50; payback = 30.000 ÷ 6.067,50 ≈ 4,9 meses (≤ 6)
    expect(saved.result.kpi.contributionCents).toBe(606_750);
    expect(saved.result.kpi.paybackMonths).toBeCloseTo(3_000_000 / 606_750, 4);
    expect(saved.result.verdict).not.toBe('fora_politica');
    expect(saved.history).toHaveLength(1);

    // investimento maior: payback passa de 6 meses no privado → não vai para aprovação
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, capex: [{ description: 'Obra de rede', qtyMilli: 1000, unitCents: 6_000_000 }] }));
    const ap = await carlos.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: 1_000_000, activationFeeCents: 0, justification: 'Pedido de teste da trava' });
    expect(ap.statusCode, ap.body).toBe(422);
    expect(ap.json().detail).toMatch(/abaixo do preço mínimo/);

    // fotografias são append-only
    await expect(ctx.db.execute(sql`update opportunity_economics_snapshots set reason = 'x' where opportunity_id = ${o.id}`)).rejects.toThrow(/append-only/);
    const h = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().history;
    expect(h.length).toBe(2);

    // Inteligência: fluxo consolidado (em andamento começa neste mês; mês 0 = investimento)
    const intel = ok(await carlos.get('/intelligence/economics?status=andamento')).json();
    const mine = intel.items.find((i: { id: string }) => i.id === o.id);
    expect(mine.investmentCents).toBe(6_000_000);
    expect(mine.months).toBe(24);
    expect(intel.flow.outflow[0]).toBeLessThanOrEqual(-6_000_000);
    expect(intel.totals.investmentCents).toBeGreaterThanOrEqual(6_000_000);
    expect(ok(await carlos.get('/intelligence/economics?status=ganhas')).json().items.some((i: { id: string }) => i.id === o.id)).toBe(false);

    // consultar não recalcula: parâmetro mudou → continua o salvo, marcado como desatualizado, e a aprovação pede para salvar de novo
    const before = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(before.stale).toBe(false);
    ok(await carlos.post('/admin/viability/econ', { ...ECON, tmaMonthlyBp: 300 }), 201);
    const after = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(after.stale).toBe(true);
    expect(after.result).toEqual(before.result);
    expect(after.history).toHaveLength(2); // nada gravado na consulta
    const ap2 = await carlos.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: 1_000_000, activationFeeCents: 0, justification: 'Pedido com viabilidade desatualizada' });
    expect(ap2.statusCode, ap2.body).toBe(422);
    expect(ap2.json().detail).toMatch(/mudou desde que foi salva/);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().stale).toBe(false);

    // sem "ver financeiro": só o veredito; não preenche; consolidado bloqueado
    ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'ver_financeiro', allowed: false }));
    try {
      const hid = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
      expect(hid.financeHidden).toBe(true);
      expect(Object.keys(hid.result).sort()).toEqual(['mode', 'verdict', 'withReservations', 'withinPolicy']);
      expect(hid.input).toBeNull();
      expect(JSON.stringify(hid)).not.toMatch(/cashflow|irr|payback|"rates"|"weight"/i);
      ok(await carlos.put(`/opportunities/${o.id}/economics`, input), 403);
      ok(await carlos.get('/intelligence/economics'), 403);
    } finally {
      ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'ver_financeiro', allowed: true }));
    }
  });

  it('filial emite só os tipos fiscais liberados; tipo de venda da oportunidade não depende da filial', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const all = ok(await carlos.get('/admin/sales-branches')).json().items;
    const br = all[1];
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: { id: string; name: string; active: boolean }) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: b.id === br.id ? ['servico', 'locacao'] : [] })) }));
    expect(ok(await carlos.get('/meta/lookups')).json().branches.find((b: { id: string }) => b.id === br.id).fiscalKinds).toEqual(['servico', 'locacao']);
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    ok(await carlos.post('/opportunities', { newContact: { name: `Filial Tipo OK ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: br.id, saleKind: 'venda_consultiva' }), 201);
    const d = await carlos.put(`/admin/fiscal-docs/${br.id}`, { items: [{ id: null, fiscalKind: 'venda', code: 'NFE', name: 'Nota de venda', active: true, taxes: [] }] });
    expect(d.statusCode).toBe(422);
    expect(d.json().detail).toMatch(/não aceita Venda/);
    const saved = ok(await carlos.put(`/admin/fiscal-docs/${br.id}`, { items: [
      { id: null, fiscalKind: 'servico', code: 'NFSE', name: 'Nota de serviço', active: true, taxes: [{ name: 'ISS', percentBp: 200, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'locacao', code: 'NFSE', name: 'Fatura de locação', active: true, taxes: [] },
    ] })).json();
    expect(saved.items.map((x: { fiscalKind: string }) => x.fiscalKind).sort()).toEqual(['locacao', 'servico']);
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: { id: string; name: string; active: boolean }) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: [] })) }));
  });

  it('item sem documento fiscal: calcula com ressalvas', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Órgão Viab ${Date.now()}`, segment: 'governamental' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: lk.branches[0].id, saleKind: 'venda_consultiva' }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 100_000, discountCents: 0, surchargeCents: 0 }] }));
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null }));
    const r = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(r.result.withReservations).toBe(true);
    expect(r.publicSector).toBe(true);
    expect(r.result.term.Dalvo).toBe(12);
    // decisão 8: só vai para decisão com 100% dos tributos parametrizados na filial
    const sub = await carlos.post(`/opportunities/${o.id}/economics/submit`, {});
    expect(sub.statusCode, sub.body).toBe(422);
    expect(sub.json().detail).toMatch(/documento fiscal com tributos vigentes/);
  });

  it('decisão: o vendedor envia, a gestão aprova ou devolve com motivo; ninguém decide o que enviou; salvar de novo reabre', async () => {
    const lk = ok(await rafael.get('/meta/lookups')).json();
    const branch = lk.branches[0].id;
    const doc = ok(await rafael.get('/fiscal-docs')).json().items.find((d: { branchId: string; code: string }) => d.branchId === branch && d.code === 'NFS-E');
    const o = ok(await rafael.post('/opportunities', { newContact: { name: `Empresa Decisão ${Date.now()}`, segment: 'empresarial' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    ok(await rafael.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link dedicado', unit: 'un', qtyMilli: 1000, unitCents: 500_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: doc.id }] }));
    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 300_000 }], extraInitialCents: 0, opex: [{ description: 'Trânsito', qtyMilli: 1000, unitCents: 50_000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}), 422); // nada salvo
    expect(ok(await rafael.put(`/opportunities/${o.id}/economics`, input)).json().result.verdict).toBe('viavel');
    expect(ok(await rafael.get(`/opportunities/${o.id}/economics`)).json().status).toBe('calculada');
    expect(ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {})).json().status).toBe('em_decisao');
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}), 422);
    // vendedor não aprova; a gestão vê na fila
    ok(await rafael.post(`/opportunities/${o.id}/economics/decision`, { decision: 'aprovar' }), 403);
    expect(ok(await rafael.get('/economics/pending')).json().items).toEqual([]);
    const pend = ok(await carlos.get('/economics/pending')).json().items;
    expect(pend.find((p: { opportunityId: string }) => p.opportunityId === o.id)).toMatchObject({ verdict: 'viavel', submittedByName: 'Rafael Mendes' });
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().canDecide).toBe(true);
    ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'devolver' }), 422); // sem motivo
    expect(ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'devolver', reason: 'Revisar o custo do trânsito' })).json().status).toBe('devolvida');
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}));
    expect(ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'aprovar' })).json().status).toBe('aprovada');
    // salvar de novo gera outra fotografia: volta a "calculada" e a aprovação fica no histórico
    ok(await rafael.put(`/opportunities/${o.id}/economics`, { ...input, termMonths: 36 }));
    const after = ok(await rafael.get(`/opportunities/${o.id}/economics`)).json();
    expect(after.status).toBe('calculada');
    expect(after.decisions.map((d: { action: string }) => d.action)).toEqual(['aprovada', 'enviada', 'devolvida', 'enviada']);
    await expect(ctx.db.execute(sql`update opportunity_econ_decisions set reason = 'x' where opportunity_id = ${o.id}`)).rejects.toThrow(/append-only/);
    // quem envia não decide, nem sendo da gestão
    ok(await carlos.post(`/opportunities/${o.id}/economics/submit`, {}));
    ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'aprovar' }), 403);
  });

  it('emitente na filial, versões dos tributos, catálogo de custos, cálculo assinado e exportação', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const all = ok(await carlos.get('/admin/sales-branches')).json().items;
    const br = all[0];
    const keep = (b: { id: string; name: string; active: boolean; fiscalKinds: string[] }) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: b.fiscalKinds });
    // etapa 2: CNPJ válido, regime e município
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: Parameters<typeof keep>[0]) => ({ ...keep(b), ...(b.id === br.id ? { cnpj: '11.222.333/0001-82' } : {}) })) }), 422);
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: Parameters<typeof keep>[0]) => ({ ...keep(b), ...(b.id === br.id ? { cnpj: '11.222.333/0001-81', taxRegime: 'lucro_presumido', city: 'Aracaju', state: 'se' } : {}) })) }));
    expect(ok(await carlos.get('/admin/sales-branches')).json().items.find((b: { id: string }) => b.id === br.id)).toMatchObject({ cnpj: '11222333000181', taxRegime: 'lucro_presumido', state: 'SE' });
    // versões dos tributos: mudar gera a próxima; salvar igual não
    const docs0 = ok(await carlos.get('/admin/fiscal-docs')).json().items.filter((d: { branchId: string }) => d.branchId === br.id);
    const body = (taxBp: number) => ({ items: docs0.map((d: { id: string; fiscalKind: string; code: string; name: string; active: boolean; taxes: { name: string; percentBp: number }[] }) => ({ id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.code === 'NFS-E' ? d.taxes.map((t, k) => (k === 0 ? { ...t, percentBp: taxBp } : t)) : d.taxes })) });
    const nfse0 = docs0.find((d: { code: string }) => d.code === 'NFS-E');
    ok(await carlos.put(`/admin/fiscal-docs/${br.id}`, body(nfse0.taxes[0].percentBp)));
    expect(ok(await carlos.get('/admin/fiscal-docs')).json().items.find((d: { id: string }) => d.id === nfse0.id).version).toBe(nfse0.version);
    ok(await carlos.put(`/admin/fiscal-docs/${br.id}`, body(300)));
    expect(ok(await carlos.get('/admin/fiscal-docs')).json().items.find((d: { id: string }) => d.id === nfse0.id).version).toBe(nfse0.version + 1);

    // etapa 6: catálogo com preço por vigência
    ok(await lucas.put('/admin/cost-items', { items: [] }), 403);
    const cat = ok(await carlos.put('/admin/cost-items', { items: [{ id: null, name: 'Roteador corporativo', kind: 'investimento', unit: 'un', active: true }, { id: null, name: 'Trânsito IP 1G', kind: 'mensal', unit: 'mes', active: true }] })).json().items;
    const router = cat.find((c: { name: string }) => c.name === 'Roteador corporativo');
    const transit = cat.find((c: { name: string }) => c.name === 'Trânsito IP 1G');
    ok(await carlos.post(`/admin/cost-items/${router.id}/prices`, { unitCents: 200_000, validFrom: '2020-01-01' }), 422);
    ok(await carlos.post(`/admin/cost-items/${router.id}/prices`, { unitCents: 200_000, validFrom: today }), 201);
    ok(await carlos.post(`/admin/cost-items/${transit.id}/prices`, { unitCents: 50_000, validFrom: today }), 201);
    const pub = ok(await lucas.get('/cost-items')).json().items;
    expect(pub.find((c: { id: string }) => c.id === router.id)).toMatchObject({ unitCents: 200_000, kind: 'investimento' });

    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Etapas ${Date.now()}`, segment: 'empresarial' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: br.id, saleKind: 'venda_consultiva' }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link dedicado', unit: 'un', qtyMilli: 1000, unitCents: 600_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: nfse0.id }] }));
    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, extraInitialCents: 0, commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null,
      capex: [{ description: 'Roteador corporativo', qtyMilli: 1000, unitCents: 200_000, costItemId: router.id }, { description: 'Obra', qtyMilli: 1000, unitCents: 150_000, costItemId: transit.id }],
      opex: [{ description: 'Trânsito IP 1G', qtyMilli: 1000, unitCents: 55_000, costItemId: transit.id }] };
    ok(await carlos.put(`/opportunities/${o.id}/economics`, input));
    const g = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(g.emitter).toMatchObject({ cnpj: '11222333000181', taxRegime: 'lucro_presumido', city: 'Aracaju' });
    expect(g.input.capex[0]).toMatchObject({ costItemId: router.id, manual: false });
    expect(g.input.capex[0].priceId).toBeTruthy();
    expect(g.input.capex[1]).toMatchObject({ costItemId: null, manual: true }); // item mensal não serve para investimento
    expect(g.input.opex[0]).toMatchObject({ costItemId: transit.id, manual: true }); // valor diferente do catálogo
    expect(g.result.items[0].docVersion).toBe(nfse0.version + 1);

    // etapa 4: cálculo assinado, lido sem recalcular
    const run = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo`)).json();
    expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.verified).toBe(true);
    expect(run.engineVersion).toBe(g.result.engineVersion);
    expect(run.settings.emitter.cnpj).toBe('11222333000181');
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}`)).json().sha256).toBe(run.sha256);
    expect(g.history[0].sha256).toBe(run.sha256);

    // etapa 7: exportação de um cálculo salvo
    const csv = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}/export?format=csv`));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/Margem de contribuição/);
    expect(csv.body).toMatch(/Lucro Presumido/);
    expect(csv.body).toContain(run.sha256);
    const pdf = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo/export?format=pdf`));
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // sem "exportar" não sai arquivo
    ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'exportar', allowed: false }));
    try { ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}/export?format=csv`), 403); }
    finally { ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'exportar', allowed: true })); }
  });
});
