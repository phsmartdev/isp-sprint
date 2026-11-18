/** Viabilidade econômica: documentos fiscais por filial, tributo no item, parâmetros, cálculo, fotografia e trava de payback. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { annuityFactor } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ECON = { marginTargetBp: 3500, marginSuggestedBp: 3500, marginMaxBp: 6000, tmaAnnualBp: 0, inflationAnnualBp: 0, horizonMaxMonths: 120, badDebtBp: 0, commissionBp: 500, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, serviceCostBp: 3500, overheadBp: 0, incomeTaxBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 4100, validFrom: today };
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas, rafael] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test'), login(ctx.app, 'rafael@yepnet.test')]); });
afterAll(async () => ctx.close());

describe('viabilidade econômica', () => {
  it('publica e preserva a inferência de serviço no histórico versionado', async () => {
    const { serviceCostBp: ignored, ...legacy } = ECON;
    ok(await carlos.post('/admin/viability/econ', { ...ECON, serviceCostBp: -1 }), 422);
    const published = ok(await carlos.post('/admin/viability/econ', { ...ECON, serviceCostBp: 2000 }), 201).json();
    expect(published.serviceCostBp).toBe(2000);
    expect(ok(await carlos.get('/admin/viability/econ')).json().current.serviceCostBp).toBe(2000);
    expect(ok(await carlos.post('/admin/viability/econ', legacy), 201).json().serviceCostBp).toBe(2000);
    ok(await carlos.post('/admin/viability/econ', { ...ECON, serviceCostBp: 0 }), 201);
    const versions = ok(await carlos.get('/admin/viability/econ')).json();
    expect(versions.current.serviceCostBp).toBe(0);
    expect(versions.versions.find((v: { id: string }) => v.id === published.id).values.serviceCostBp).toBe(2000);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
  });

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

    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, capex: [{ description: 'Roteador', impact: 'material', qtyMilli: 1000, unitCents: 3_000_000 }], extraInitialCents: 0, opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 200_000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, termMonths: 0 }), 422);
    const saved = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    // lotes (11/2026): os dois produtos são do Lote Serviço, então vale o documento de maior tributo do lote: a = 20%
    expect(saved.result.rates.a).toBeCloseTo(0.2, 8);
    expect(saved.result.lots).toEqual([expect.objectContaining({ lot: 'servico', percentBp: 2000, items: 2 })]);
    expect(saved.result.withReservations).toBe(false);
    // FINANCE-3.1: preço sugerido = (parcela da anuidade de 30.000 pela TMA em 6 meses + 2.000) ÷ (1 − 20% − 35%)
    expect(saved.result.engineVersion).toBe('FINANCE-3.6.0');
    const parc = 4_050_000 / annuityFactor(saved.result.rates.r, 6);
    expect(Math.abs(saved.result.suggestedCents - (4_050_000 / 24 + 200_000) / (1 - 0.2 - 0.2))).toBeLessThanOrEqual(1);
    expect(saved.result.kpi.marginPct).toBeCloseTo(saved.result.rates.m * 100, 4);
    expect(saved.result.recommendation.netTargetPct).toBe(20); // sem margem líquida alvo nos parâmetros
    // decisão no proposto (total dos produtos, 10.000): caixa do mês = 10.000 − 2.000 − 2.000 = 6.000; MC = 6.000 − parcela
    expect(saved.result.decision).toMatchObject({ basis: 'proposto', source: 'itens', priceCents: 1_000_000 });
    expect(saved.result.decision.marginPct).toBeCloseTo(((600_000 - parc) / 1_000_000) * 100, 6);
    expect(saved.result.decision.paybackMonths).toBeCloseTo(4_050_000 / 600_000, 4);
    expect(saved.result.verdict).not.toBe('fora_politica');
    expect(saved.history).toHaveLength(1);

    // investimento maior: payback passa de 6 meses no privado → não vai para aprovação
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, capex: [{ description: 'Obra de rede', impact: 'material', qtyMilli: 1000, unitCents: 10_000_000 }] }));
    const ap = await carlos.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: 1_000_000, activationFeeCents: 0, justification: 'Pedido de teste da trava' });
    expect(ap.statusCode, ap.body).toBe(422);
    expect(ap.json().detail ?? ap.json().message ?? '', ap.body).toMatch(/margem líquida|abaixo da faixa/);

    // fotografias são append-only
    await expect(ctx.db.execute(sql`update opportunity_economics_snapshots set reason = 'x' where opportunity_id = ${o.id}`)).rejects.toThrow(/append-only/);
    const h = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().history;
    expect(h.length).toBe(2);

    // Inteligência: fluxo consolidado (em andamento começa neste mês; mês 0 = investimento)
    const intel = ok(await carlos.get('/intelligence/economics?status=andamento')).json();
    const mine = intel.items.find((i: { id: string }) => i.id === o.id);
    expect(mine.investmentCents).toBe(13_500_000);
    expect(mine.months).toBe(24);
    expect(intel.flow.outflow[0]).toBeLessThanOrEqual(-10_000_000);
    expect(intel.totals.investmentCents).toBeGreaterThanOrEqual(10_000_000);
    expect(ok(await carlos.get('/intelligence/economics?status=ganhas')).json().items.some((i: { id: string }) => i.id === o.id)).toBe(false);

    // consultar não recalcula: parâmetro mudou → continua o salvo, marcado como desatualizado, e a aprovação pede para salvar de novo
    const before = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(before.stale).toBe(false);
    ok(await carlos.post('/admin/viability/econ', { ...ECON, tmaAnnualBp: 4258 }), 201);
    const after = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(after.stale).toBe(true);
    expect(after.result).toEqual(before.result);
    expect(after.history).toHaveLength(2); // nada gravado na consulta
    const ap2 = await carlos.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: 1_000_000, activationFeeCents: 0, justification: 'Pedido com viabilidade desatualizada' });
    expect(ap2.statusCode, ap2.body).toBe(422);
    expect(ap2.json().detail).toMatch(/mudou desde que foi salva/);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().stale).toBe(false);

    // margem líquida alvo publicada em Configurações → Viabilidade → recomendacao_viabilidade (só parâmetros, sem valor fixo)
    ok(await carlos.post('/admin/viability/econ', { ...ECON, netMarginTargetBp: 4000, overheadBp: 2000, lossPrivateBp: 300, badDebtBp: 100, incomeTaxBp: 1500 }), 201);
    const withTarget = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    const rv = withTarget.recomendacao_viabilidade;
    expect(rv['margem_liquida_alvo_%']).toBe(40);
    expect(rv['margem_contrib_recomendada_%']).toBeCloseTo(withTarget.result.kpi.marginPct, 2);
    expect(rv.parametros_utilizados).toMatchObject({ 'taxa_rateio_fixo_%': 20, 'glosa_%': 3, 'inadimplencia_%': 1 });
    // mensalidade: o preço recomendado entrega 40% de margem líquida no contrato inteiro (24 meses), abaixo da regra antiga
    expect(rv['preco_mensal_recomendado_R$']).toBeLessThan(7_000 / (1 - 0.2 - (0.4 / 0.85 + 0.24)));
    const atRec = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, priceCents: Math.round(rv['preco_mensal_recomendado_R$'] * 100) })).json();
    expect(atRec.result.decision.netMarginPct).toBeCloseTo(40, 1);
    ok(await carlos.put(`/opportunities/${o.id}/economics`, input));
    expect(withTarget.result.statement.after.amortization).toBe(0);
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().recomendacao_viabilidade['margem_contrib_recomendada_%']).toBeCloseTo(withTarget.result.kpi.marginPct, 2);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    ok(await carlos.put(`/opportunities/${o.id}/economics`, input));

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
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 100_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: null }] }));
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
    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, capex: [{ description: 'Roteador', impact: 'material', qtyMilli: 1000, unitCents: 100_000 }], extraInitialCents: 0, opex: [{ description: 'Trânsito', qtyMilli: 1000, unitCents: 50_000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: 100_000 };
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}), 422); // nada salvo
    // dentro de todas as regras: aprovação automática no envio
    expect(ok(await rafael.put(`/opportunities/${o.id}/economics`, input)).json().result.verdict).toBe('viavel');
    expect(ok(await rafael.get(`/opportunities/${o.id}/economics`)).json().status).toBe('calculada');
    expect(ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {})).json()).toMatchObject({ status: 'aprovada', autoApproved: true });
    // margem abaixo do piso: vai para a alçada superior
    const input2 = { ...input, opex: [{ description: 'Trânsito', qtyMilli: 1000, unitCents: 90_000 }] };
    expect(ok(await rafael.put(`/opportunities/${o.id}/economics`, input2)).json().result.verdict).toBe('abaixo_faixa'); // 3.0: margem abaixo do piso = abaixo do mínimo
    expect(ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {})).json()).toMatchObject({ status: 'em_decisao', autoApproved: false });
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}), 422);
    // vendedor não aprova; a gestão vê na fila
    ok(await rafael.post(`/opportunities/${o.id}/economics/decision`, { decision: 'aprovar' }), 403);
    expect(ok(await rafael.get('/economics/pending')).json().items).toEqual([]);
    const pend = ok(await carlos.get('/economics/pending')).json().items;
    expect(pend.find((p: { opportunityId: string }) => p.opportunityId === o.id)).toMatchObject({ verdict: 'abaixo_faixa', submittedByName: 'Rafael Mendes' });
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().canDecide).toBe(true);
    ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'devolver' }), 422); // sem motivo
    expect(ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'devolver', reason: 'Revisar o custo do trânsito' })).json().status).toBe('devolvida');
    ok(await rafael.post(`/opportunities/${o.id}/economics/submit`, {}));
    expect(ok(await carlos.post(`/opportunities/${o.id}/economics/decision`, { decision: 'aprovar' })).json().status).toBe('aprovada');
    // salvar de novo gera outra fotografia: volta a "calculada" e a aprovação fica no histórico
    ok(await rafael.put(`/opportunities/${o.id}/economics`, { ...input2, termMonths: 36 }));
    const after = ok(await rafael.get(`/opportunities/${o.id}/economics`)).json();
    expect(after.status).toBe('calculada');
    expect(after.decisions.map((d: { action: string }) => d.action)).toEqual(['aprovada', 'enviada', 'devolvida', 'enviada', 'aprovada', 'enviada']);
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
    const cat = ok(await carlos.put('/admin/cost-items', { items: [{ id: null, name: 'Roteador corporativo', kind: 'investimento', unit: 'un', impact: 'material', active: true }, { id: null, name: 'Trânsito IP 1G', kind: 'mensal', unit: 'mes', active: true }] })).json().items;
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
      capex: [{ description: 'Roteador corporativo', qtyMilli: 1000, unitCents: 200_000, unit: 'un', costItemId: router.id }, { description: 'Obra', impact: 'material', qtyMilli: 1000, unitCents: 150_000, costItemId: transit.id }],
      opex: [{ description: 'Trânsito IP 1G', qtyMilli: 1000, unitCents: 55_000, unit: 'mes', costItemId: transit.id }] };
    ok(await carlos.put(`/opportunities/${o.id}/economics`, input));
    const g = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(g.emitter).toMatchObject({ cnpj: '11222333000181', taxRegime: 'lucro_presumido', city: 'Aracaju' });
    // auto-aprendizado (descrição + unidade): o item conhecido preenche o impacto; o novo entra no catálogo; a cotação nova vira o preço
    expect(g.input.capex[0]).toMatchObject({ costItemId: router.id, manual: false, unit: 'un' });
    expect(g.input.capex[0].priceId).toBeTruthy();
    expect(g.input.capex[1].costItemId).not.toBe(transit.id); // item mensal não serve para investimento: vira item novo
    expect(g.input.opex[0]).toMatchObject({ costItemId: transit.id, manual: false, impact: 'operacional' });
    const learned = ok(await carlos.get('/admin/cost-items')).json().items;
    expect(learned.find((c: { id: string }) => c.id === transit.id).unitCents).toBe(55_000);
    expect(learned.find((c: { name: string; kind: string }) => c.name === 'Obra' && c.kind === 'investimento')).toMatchObject({ impact: 'material', unitCents: 150_000 });
    // mesma descrição em outra unidade é outro item e exige classificar o impacto
    const und = { ...input, capex: [{ description: 'Roteador corporativo', qtyMilli: 1000, unitCents: 210_000, unit: 'cx' }] };
    expect(ok(await carlos.put(`/opportunities/${o.id}/economics`, und), 422).json().detail).toMatch(/Classifique/);
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...und, capex: [{ ...und.capex[0], impact: 'material' }] }));
    expect(ok(await carlos.get('/admin/cost-items')).json().items.filter((c: { name: string }) => c.name === 'Roteador corporativo')).toHaveLength(2);
    ok(await carlos.put(`/opportunities/${o.id}/economics`, input));
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
    expect(pdf.headers['content-disposition']).toMatch(/filename="Viabilidade-OP-\d+-\d{8}\.pdf"/);
    // timbrado da filial: PDF A4 de fundo, margens da área do texto e prévia
    const branchId = ok(await carlos.get(`/opportunities/${o.id}`)).json().branchId as string;
    const art = await PDFDocument.create(); art.addPage([595.28, 841.89]).drawText('TIMBRADO BKT', { x: 40, y: 800, size: 20 });
    const artB64 = Buffer.from(await art.save()).toString('base64');
    ok(await lucas.put(`/admin/letterheads/${branchId}`, { data: artB64, filename: 'timbrado.pdf', topMm: 40, bottomMm: 30, sideMm: 18 }), 403);
    ok(await carlos.put(`/admin/letterheads/${branchId}`, { data: Buffer.from('nao e imagem').toString('base64'), filename: 'x.txt', topMm: 40, bottomMm: 30, sideMm: 18 }), 422);
    ok(await carlos.put(`/admin/letterheads/${branchId}`, { data: artB64, filename: 'timbrado.pdf', topMm: 40, bottomMm: 30, sideMm: 18 }));
    const lhs = ok(await carlos.get('/admin/letterheads')).json().items;
    expect(lhs.find((b: { id: string }) => b.id === branchId).letterhead).toMatchObject({ mime: 'application/pdf', topMm: 40, filename: 'timbrado.pdf' });
    ok(await carlos.put(`/admin/letterheads/${branchId}`, { topMm: 45, bottomMm: 30, sideMm: 18 }));
    expect(ok(await carlos.get(`/admin/letterheads/${branchId}/preview`)).headers['content-type']).toBe('application/pdf');
    const withArt = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo/export?format=pdf`));
    const loaded = await PDFDocument.load(withArt.rawPayload);
    expect(loaded.getTitle()).toMatch(/^Viabilidade-OP-\d+-\d{8}$/);
    expect(withArt.rawPayload.length).toBeGreaterThan(pdf.rawPayload.length);
    ok(await carlos.del(`/admin/letterheads/${branchId}`), 204);
    // sem "exportar" não sai arquivo
    ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'exportar', allowed: false }));
    try { ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}/export?format=csv`), 403); }
    finally { ok(await carlos.put('/admin/actions', { profile: 'gerencia', action: 'exportar', allowed: true })); }
  });

  it('oportunidades: filtro por período de criação na lista e no kanban', async () => {
    const all = ok(await carlos.get('/opportunities?status=todas&pageSize=1')).json().total;
    expect(all).toBeGreaterThan(0);
    expect(ok(await carlos.get('/opportunities?status=todas&pageSize=1&from=2000-01-01&to=2999-12-31')).json().total).toBe(all);
    expect(ok(await carlos.get('/opportunities?status=todas&pageSize=1&from=2999-01-01')).json().total).toBe(0);
    const k = ok(await carlos.get('/pipeline?from=2999-01-01')).json();
    expect(k.stages.every((st: { cards: unknown[] }) => st.cards.length === 0)).toBe(true);
    ok(await carlos.get('/opportunities?from=29-10-2026'), 422);
  });

  it('envelope fiscal por vigência nos documentos fiscais: tributos por ano, DRE e retenções por empresa; retenções fora do cálculo; faixa de margem líquida', async () => {
    ok(await carlos.post('/admin/viability/econ', { ...ECON, overheadBp: 2000, lossPrivateBp: 300, badDebtBp: 100, incomeTaxBp: 3400, netMarginTargetBp: 2000, netMarginMinBp: 1200, netMarginMaxBp: 2500 }), 201);
    const branch = (ok(await carlos.get('/admin/sales-branches')).json().items)[0].id;
    // documento com tributos de 2026 (cadastro atual) e de 2027 (Reforma: CBS/IBS no lugar de PIS/COFINS)
    const put = (year: number, taxes: object[], id: string | null = null) => carlos.put(`/admin/fiscal-docs/${branch}`, { year, items: [{ id, fiscalKind: 'servico', code: 'NFSE-ENV', name: 'Nota de serviço', active: true, taxes }] });
    let docs = ok(await put(2026, [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'PIS', percentBp: 65, fixedCents: 0, active: true }, { name: 'COFINS', percentBp: 300, fixedCents: 0, active: true }, { name: 'IRRF', percentBp: 150, fixedCents: 0, active: true }])).json().items;
    const doc = docs.find((d: { code: string }) => d.code === 'NFSE-ENV');
    expect(doc.rates.percentBp).toBe(865); // IRRF é retenção: fora da carga da nota
    docs = ok(await put(2027, [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'CBS', percentBp: 880, fixedCents: 0, active: true }, { name: 'IBS', percentBp: 10, fixedCents: 0, active: true }], doc.id)).json().items;
    expect(docs.find((d: { id: string }) => d.id === doc.id)).toMatchObject({ taxesYear: 2027, rates: { percentBp: 1390 } });
    const y26 = ok(await carlos.get('/admin/fiscal-docs?year=2026')).json().items.find((d: { id: string }) => d.id === doc.id);
    expect(y26).toMatchObject({ taxesYear: 2026, rates: { percentBp: 865 } });
    expect(ok(await carlos.get('/admin/fiscal-docs?year=2028')).json().items.find((d: { id: string }) => d.id === doc.id).taxesYear).toBe(2027);
    // DRE e retenções da empresa por ano
    ok(await carlos.post(`/admin/fiscal-docs/${branch}/envelope`, { year: 2026, profitTaxBp: 1100, retentions: { irrf: 150, csrf: 465, issRetido: 500 } }), 201);
    ok(await carlos.post(`/admin/fiscal-docs/${branch}/envelope`, { year: 2027, profitTaxBp: 1500, retentions: {} }), 201);
    ok(await carlos.post(`/admin/fiscal-docs/${branch}/envelope`, { year: 2027, profitTaxBp: 10_000 }), 422);
    const e28 = ok(await carlos.get(`/admin/fiscal-docs/${branch}/envelope?year=2028`)).json();
    expect(e28.current).toMatchObject({ year: 2027, inherited: true, values: { profitTaxBp: 1500 } });
    ok(await lucas.get(`/admin/fiscal-docs/${branch}/envelope?year=2027`), 403);

    const lk = ok(await carlos.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Envelope ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 0, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: doc.id }] }));
    const input = { mode: 'recorrente', termMonths: 12, receiveMonth: 0, paybackMonths: 3, capex: [{ description: 'Implantação', impact: 'material', qtyMilli: 1000, unitCents: 1_000_000 }], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    const r26 = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, fiscalYear: 2026 })).json();
    expect(r26.result.fiscal).toMatchObject({ year: 2026, regime: 'tradicional', profitTaxBp: 1100, profitTaxSource: 'envelope', docs: [{ fromYear: 2026, percentBp: 865 }] });
    expect(r26.result.rates.a).toBeCloseTo(0.0865, 8);
    expect(r26.result.fiscal.retentions.map((x: { code: string }) => x.code)).toEqual(['irrf', 'csrf', 'issRetido']);
    const r27 = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, fiscalYear: 2027 })).json();
    expect(r27.result.fiscal).toMatchObject({ year: 2027, regime: 'reforma', profitTaxBp: 1500 });
    expect(r27.result.rates.a).toBeCloseTo(0.139, 8);
    expect(r27.recomendacao_viabilidade['margem_contrib_recomendada_%']).toBeCloseTo(r27.result.kpi.marginPct, 2);
    expect(r27.recomendacao_viabilidade.parametros_utilizados['irpj_csll_%']).toBe(15);
    // faixa: na base da aprovação, sem preço dos produtos a decisão é no sugerido (margem líquida > 12% e < 25%)
    expect(r27.result.recommendation.range.min.priceCents).toBeLessThan(r27.result.recommendation.range.max.priceCents);
    expect(r27.result.decision.netMarginRange).toEqual({ minPct: 12, maxPct: 25 });
    expect(r27.result.kpi.investmentPaybackMonths).toBeCloseTo(3, 2);
    const run = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo`)).json();
    expect(run.settings).toMatchObject({ fiscalYear: 2027, fiscalEnvelope: { year: 2027 } });
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
  });
  it('B2G: perfil de custo no produto, mensalidade pela fórmula do payback e Modo B com lance', async () => {
    ok(await carlos.post('/admin/viability/econ', { ...ECON, netMarginMinBp: 800, overheadBp: 3500 }), 201);
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const branch = lk.branches[0].id;
    ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [
      { id: null, fiscalKind: 'venda', code: 'PERFIL-NFE', name: 'Venda por perfil', active: true, taxes: [{ name: 'Tributo', percentBp: 1000, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'servico', code: 'PERFIL-NFSE', name: 'Serviço por perfil', active: true, taxes: [{ name: 'Tributo', percentBp: 1500, fixedCents: 0, active: true }] },
    ] }));
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Órgão B2G ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    // Documento sugerido pela filial; perfil divergente enviado é normalizado pelo tipo.
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [
      { description: 'Link B2G', unit: 'un', qtyMilli: 1000, unitCents: 300_000, discountCents: 0, surchargeCents: 0, dealKind: 'recorrencia' },
      { description: 'Roteador B2G', unit: 'un', qtyMilli: 2000, unitCents: 50_000, discountCents: 0, surchargeCents: 0, dealKind: 'venda', costProfile: 'implantacao' },
    ] }));
    const its = ok(await carlos.get(`/opportunities/${o.id}/items`)).json().items;
    expect(its.every((i: { fiscalDocTypeId: string | null }) => !!i.fiscalDocTypeId)).toBe(true);
    expect(its.find((i: { description: string }) => i.description === 'Roteador B2G').costProfile).toBe('fornecimento');
    expect(its.find((i: { description: string }) => i.description === 'Link B2G').costProfile).toBe('implantacao');

    const input = { mode: 'recorrente', termMonths: 36, receiveMonth: 0, paybackMonths: 12, variableBp: 0, lossBp: 0, marginTargetBp: 3500, priceCents: null, commissionBp: null, extraInitialCents: 0,
      capex: [{ description: 'Obra', impact: 'servico', kind: 'recorrencia', qtyMilli: 1000, unitCents: 1_000_000 }],
      opex: [{ description: 'Trânsito', qtyMilli: 1000, unitCents: 100_000 }],
      b2g: { mode: 'A' } };
    const calculated = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json().result;
    const r = calculated.b2g;
    expect(r.kinds).toEqual({ unica: true, recorrente: true });
    // O custo da Implantação fica integralmente na recorrência.
    const line = r.recorrente.lines[0];
    const monthlyInvestment = 1_350_000;
    expect(r.recorrente.investmentCents).toBe(monthlyInvestment);
    expect(r.unica.costCents + r.recorrente.investmentCents).toBe(1_350_000);
    expect(line.suggestedCents).toBe(calculated.suggestedCents);
    expect(r.unica.lines[0].profile).toBe('fornecimento');
    expect(line.priceCents).toBe(300000);

    // Modo B: lance abaixo do piso gera alerta, não bloqueia
    const b = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, b2g: { mode: 'B', bids: { 'link b2g': 1_000 } } })).json().result.b2g;
    expect(b.mode).toBe('B');
    expect(b.recorrente.lines[0].netPct).toBeLessThan(8);
    expect(['produto_abaixo', 'produto_negativo', 'abaixo_minimo']).toContain(b.verdict);
    // a entrada B2G fica salva
    expect(ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().input.b2g).toMatchObject({ mode: 'B', bids: { 'link b2g': 1_000 } });
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
  });
  it('separa Fornecimento, Instalação e Implantação e preserva a fotografia', async () => {
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    const lk = ok(await carlos.get('/meta/lookups')).json(), branch = lk.branches[0].id;
    const docs = ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [
      { id: null, fiscalKind: 'venda', code: 'RATEIO-NFE', name: 'Fornecimento', active: true, taxes: [{ name: 'Tributo', percentBp: 1800, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'servico', code: 'RATEIO-NFSE', name: 'Implantação', active: true, taxes: [{ name: 'Tributo', percentBp: 1500, fixedCents: 0, active: true }] },
    ] })).json().items;
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Misto perfil ${Date.now()}`, segment: 'empresarial' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    const items = [['OTDR', 'venda', 'fornecimento', 200000], ['Link único', 'servico', 'instalacao', 121700], ['Link mensal', 'recorrencia', 'implantacao', 130000]].map(([description, dealKind, costProfile, unitCents]) => ({ description, dealKind, costProfile, unitCents, unit: 'un', qtyMilli: 1000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: docs.find((d: { fiscalKind: string }) => d.fiscalKind === (costProfile === 'fornecimento' ? 'venda' : 'servico')).id }));
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items }));
    const originalItems = ok(await carlos.get(`/opportunities/${o.id}/items`)).json().items;
    const input = { mode: 'recorrente', termMonths: 12, receiveMonth: 0, paybackMonths: 6, capex: [{ description: 'Custo de Fornecimento', kind: 'venda', impact: 'material', qtyMilli: 1000, unitCents: 50001 }, { description: 'Custo de Instalação', kind: 'servico', impact: 'servico', qtyMilli: 1000, unitCents: 21710 }, { description: 'Custo de Implantação', kind: 'recorrencia', impact: 'servico', qtyMilli: 1000, unitCents: 278291 }], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null, b2g: { mode: 'A', contributionBp: { fornecimento: 2000, instalacao: 2000, implantacao: 2000 } } };
    const saved = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    expect(saved.result.b2g.costs.unica.fornecimento).toBe(50001);
    expect(saved.result.b2g.costs.unica.instalacao).toBe(21710);
    expect(saved.result.b2g.recorrente.investmentCents).toBe(375693);
    expect(saved.result.b2g.recorrente.monthlyPriceCents).toBeGreaterThan(0);
    expect(saved.result.b2g.global.costCents).toBe(455003);
    expect(ok(await carlos.get(`/opportunities/${o.id}/items`)).json().items).toEqual(originalItems);
    const run = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo`)).json();
    expect(run.verified).toBe(true);
    expect(run.engineVersion).toBe('FINANCE-3.6.0');
    ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}/export?format=csv`));
    ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${run.id}/export?format=pdf`));
  });

  it('valores conhecidos ou todos em branco: perfis fixos, sugerido por item e snapshots preservados', async () => {
    ok(await carlos.post('/admin/viability/econ', { ...ECON, netMarginTargetBp: 2000, netMarginMinBp: 900 }), 201);
    const lk = ok(await carlos.get('/meta/lookups')).json(), branch = lk.branches[0].id;
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Cenários ${Date.now()}`, segment: 'empresarial' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    const kinds = ['venda', 'servico', 'recorrencia', 'locacao'];
    const items = kinds.map((dealKind, n) => ({ description: `Cenário ${dealKind}`, dealKind, costProfile: 'fornecimento', unit: 'un', qtyMilli: 1000, unitCents: 100000 + n * 10000, priceDefined: true }));
    let opp = ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items })).json();
    let savedItems = ok(await carlos.get(`/opportunities/${o.id}/items`)).json().items;
    expect(savedItems.map((i: { costProfile: string }) => i.costProfile)).toEqual(['fornecimento', 'instalacao', 'implantacao', 'implantacao']);
    const docs = ok(await carlos.get('/fiscal-docs')).json().items;
    const serviceDoc = docs.find((d: { branchId: string; fiscalKind: string }) => d.branchId === branch && d.fiscalKind === 'servico').id;
    opp = ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: opp.rowVersion, items: items.map((i) => ({ ...i, fiscalDocTypeId: serviceDoc })) })).json();
    const input = { mode: 'recorrente', termMonths: 12, receiveMonth: 0, paybackMonths: 6, capex: [{ description: 'Equipamento', kind: 'venda', impact: 'material', qtyMilli: 1000, unitCents: 60001 }, { description: 'Serviço avulso', kind: 'servico', impact: 'servico', qtyMilli: 1000, unitCents: 30003 }, { description: 'Ativação mensal', kind: 'recorrencia', impact: 'servico', qtyMilli: 1000, unitCents: 240005 }], extraInitialCents: 0, opex: [{ description: 'Operação', qtyMilli: 1000, unitCents: 10000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    const known = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    const allKnown = [...known.result.b2g.unica.lines, ...known.result.b2g.recorrente.lines];
    expect(allKnown.every((l: { priceBasis: string; suggestedCents: number }) => l.priceBasis === 'informado' && l.suggestedCents > 0)).toBe(true);
    const adjusted = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, marginTargetBp: 9500, b2g: { netTargetBp: 4000, contributionBp: { fornecimento: 9500, instalacao: 9500 } } })).json();
    expect(adjusted.result.suggestedCents).toBe(known.result.suggestedCents);
    expect(adjusted.result.suggestedOneTimeCents).toBe(known.result.suggestedOneTimeCents);
    const old = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/ultimo`)).json();
    const blank = items.map((i) => ({ ...i, fiscalDocTypeId: serviceDoc, unitCents: 0, priceDefined: false }));
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: opp.rowVersion, items: [blank[0], ...items.slice(1)] }), 422);
    opp = ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: opp.rowVersion, items: blank })).json();
    savedItems = ok(await carlos.get(`/opportunities/${o.id}/items`)).json().items;
    expect(savedItems.every((i: { priceDefined: boolean; unitCents: number }) => !i.priceDefined && i.unitCents === 0)).toBe(true);
    const unknown = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    expect(unknown.result.decision.basis).toBe('sugerido');
    const allUnknown = [...unknown.result.b2g.unica.lines, ...unknown.result.b2g.recorrente.lines];
    expect(allUnknown.every((l: { priceBasis: string; priceCents: number; suggestedCents: number }) => l.priceBasis === 'sugerido' && l.priceCents === l.suggestedCents && l.suggestedCents > 0)).toBe(true);
    expect(unknown.result.b2g.baskets.map((b: { costCents: number }) => b.costCents)).toEqual([60001, 40504, 444007]);
    expect(unknown.result.b2g.global.costCents).toBe(544512);
    expect(unknown.result.deal.cells.map((c: { lot: string }) => c.lot)).toEqual(['venda', 'instalacao', 'servico']);
    const snapshot = ok(await carlos.get(`/opportunities/${o.id}/economics/runs/${old.id}`)).json();
    expect(snapshot.verified).toBe(true);
    expect(snapshot.result).toEqual(old.result);
    const catalog = ok(await carlos.get('/product-catalog')).json().items;
    expect(catalog.find((i: { description: string }) => i.description === items[0]!.description).lastPriceDefined).toBe(false);
  });

  it('exige margem líquida esperada e rejeita alvo fora da faixa configurada', async () => {
    ok(await carlos.post('/admin/viability/econ', { ...ECON, netMarginTargetBp: 5000 }), 422);
    ok(await carlos.post('/admin/viability/econ', { ...ECON, netMarginTargetBp: null }), 201);
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Sem alvo ${Date.now()}`, segment: 'empresarial' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: lk.branches[0].id, saleKind: 'venda_consultiva' }), 201).json();
    const r = await carlos.put(`/opportunities/${o.id}/economics`, { mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], opex: [], extraInitialCents: 0, commissionBp: null, lossBp: null, marginTargetBp: 3500, priceCents: null });
    ok(r, 422);
    expect(r.json().detail).toMatch(/Configure a margem líquida esperada/);
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
  });

});
