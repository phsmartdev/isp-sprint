/** Indicadores principais (Inteligência): importação da ficha .xlsx, metas por trimestre, lançamentos e farol. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => ctx.close());

/** .xlsx mínimo com uma aba por ficha (rótulo na coluna A, valor na B). */
export function kpiWorkbook(sheets: { name: string; pairs: [string, string | number][] }[]) {
  const zip = new PizZip();
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  sheets.forEach((s, i) => {
    const rows = [['FORMULÁRIO DE CRIAÇÃO DE INDICADORES DE DESEMPENHO (KPI)', ''] as [string, string | number], ...s.pairs].map(([a, b], r) => `<row r="${r + 1}"><c r="B${r + 1}" t="inlineStr"><is><t>${esc(a)}</t></is></c>${b === '' ? '' : typeof b === 'number' ? `<c r="D${r + 1}"><v>${b}</v></c>` : `<c r="D${r + 1}" t="inlineStr"><is><t>${esc(b)}</t></is></c>`}</row>`).join('');
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zip.generate({ type: 'nodebuffer' }).toString('base64');
}
const year = Number(new Date().toISOString().slice(0, 4));
const month = new Date().toISOString().slice(0, 7);
const q = Math.floor((Number(month.slice(5)) - 1) / 3) + 1;

describe('KPIs da Inteligência', () => {
  it('importa a ficha, desdobra a meta por trimestre, recebe lançamentos com histórico e mostra o farol', async () => {
    const data = kpiWorkbook([
      { name: 'Booking', pairs: [['Nome do KPI', 'Booking Fictício'], ['Departamento/Área', 'Comercial'], ['Unidade de Medida', '%'], ['Fonte de Dados', 'ERP fictício'], ['Meta Anual', 0.45], ['Meta Trimestral', '1T e 4T - 35% / 2T - 60% / 3T - 50%'], ['Limite Mínimo Aceitável', '80% da meta'], ['Frequência de Medição', 'Mensal'], ['Data de Início', 46055]] },
      { name: 'Concentração', pairs: [['Nome do KPI', 'Concentração Fictícia'], ['Unidade de Medida', '%'], ['Meta Anual', 0.15], ['Meta Trimestral', 0.15], ['Limite Máximo Desejável', 0.3], ['Frequência de Medição', 'Trimestral']] },
      { name: 'Outro (Pausar)', pairs: [['Nome do KPI', 'KPI Pausado Fictício'], ['Unidade de Medida', '%'], ['Meta Anual', 0.2], ['Frequência de Medição', 'Mensal']] },
      { name: 'Capa', pairs: [['Qualquer coisa', 'sem ficha']] },
    ]);
    expect((await lucas.post('/intelligence/kpis/import/preview', { filename: 'kpi.xlsx', data })).statusCode).toBe(403);
    const pv = ok(await carlos.post('/intelligence/kpis/import/preview', { filename: 'kpi.xlsx', data })).json();
    expect(pv.items).toHaveLength(3);
    const booking = pv.items.find((x: { key: string }) => x.key === 'kpi_booking_ficticio');
    expect(booking).toMatchObject({ action: 'criar', def: { target: 45, unit: 'percentual', period: 'mes', direction: 'maior', sheet: { quarterTargets: [35, 60, 50, 35], minOfTarget: 0.8, startDate: '2026-02-02' } } });
    expect(pv.items.find((x: { key: string }) => x.key === 'kpi_concentracao_ficticia').def.direction).toBe('menor');
    ok(await carlos.post('/intelligence/kpis/import', { items: pv.items.map((x: { key: string; def: unknown }) => ({ key: x.key, def: x.def })) }));
    // reimportar cria nova versão, não duplica
    const again = ok(await carlos.post('/intelligence/kpis/import/preview', { filename: 'kpi.xlsx', data })).json();
    expect(again.items.every((x: { action: string }) => x.action === 'atualizar')).toBe(true);
    expect(ok(await carlos.post('/intelligence/kpis/import', { items: again.items.slice(0, 1).map((x: { key: string; def: unknown }) => ({ key: x.key, def: x.def })) })).json()).toEqual({ created: 0, updated: 1 });

    let b = ok(await carlos.get('/intelligence/kpis')).json();
    const bk = b.items.find((x: { key: string }) => x.key === 'kpi_booking_ficticio');
    expect(bk.quarters.map((x: { target: number }) => x.target)).toEqual([35, 60, 50, 35]);
    expect(bk.current.status).toBe('sem_dado');
    expect(b.summary.total).toBe(2); // o pausado não entra no placar
    expect(b.canEnter).toBe(true);

    // lançamentos: competência no formato da frequência, histórico preservado
    expect((await carlos.post(`/intelligence/kpis/${bk.id}/entries`, { period: `${year}-T${q}`, value: 30 })).statusCode).toBe(422);
    expect((await lucas.post(`/intelligence/kpis/${bk.id}/entries`, { period: month, value: 30 })).statusCode).toBe(403);
    ok(await carlos.post(`/intelligence/kpis/${bk.id}/entries`, { period: month, value: 10, note: 'prévia' }), 201);
    ok(await carlos.post(`/intelligence/kpis/${bk.id}/entries`, { period: month, value: 99 }), 201);
    const hist = ok(await carlos.get(`/intelligence/kpis/${bk.id}/entries`)).json().items;
    expect(hist).toHaveLength(2);
    expect(hist.filter((x: { supersededAt: string | null }) => !x.supersededAt)).toHaveLength(1);
    const cc = b.items.find((x: { key: string }) => x.key === 'kpi_concentracao_ficticia');
    ok(await carlos.post(`/intelligence/kpis/${cc.id}/entries`, { period: `${year}-T${q}`, value: 22 }), 201);
    b = ok(await carlos.get('/intelligence/kpis')).json();
    const bk2 = b.items.find((x: { key: string }) => x.key === 'kpi_booking_ficticio');
    expect(bk2.current).toMatchObject({ value: 99, status: 'atingido' });
    expect(bk2.current.months.find((m: { period: string }) => m.period === month).value).toBe(99);
    const cc2 = b.items.find((x: { key: string }) => x.key === 'kpi_concentracao_ficticia');
    expect(cc2.current).toMatchObject({ value: 22, status: 'atencao' }); // acima da meta de 15%, dentro do máximo de 30%
    expect(b.summary).toMatchObject({ atingido: 1, atencao: 1 });
    // no mesmo cadastro de indicadores da Gestão de Resultados
    const inds = ok(await carlos.get('/performance/indicators')).json().items;
    expect(inds.some((i: { key: string; def: { calc: string } }) => i.key === 'kpi_booking_ficticio' && i.def.calc === 'informado')).toBe(true);
  });
  it('contexto do Booking: contratos fechados no trimestre, negociações em andamento e saúde das contas', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Empresa Booking Fictícia', segment: 'empresarial' }, planId: plan.id }), 201).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    const today = new Date().toISOString().slice(0, 10);
    const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', kind: 'privado', commercialOwnerId: lucas.me.user.id, version: { number: 'BK-1', object: 'Link', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] } }), 201).json().id;
    let c = ok(await carlos.get('/intelligence/kpis/context')).json();
    expect(c.contracts.top.some((x: { id: string }) => x.id === id)).toBe(false); // sem validação não conta
    ok(await carlos.post(`/contracts/${id}/validate`));
    ok(await lucas.post('/opportunities', { newContact: { name: 'Prospect Fictício', segment: 'empresarial' }, planId: plan.id }), 201);
    c = ok(await carlos.get('/intelligence/kpis/context')).json();
    expect(c.contracts.top.find((x: { id: string }) => x.id === id)).toMatchObject({ client: 'Empresa Booking Fictícia', acvCents: 1_200_000 });
    expect(c.contracts.bySegment.find((x: { key: string }) => x.key === 'empresarial').cents).toBeGreaterThanOrEqual(1_200_000);
    expect(c.bookingMonths).toHaveLength(12);
    expect(c.bookingMonths.find((m: { month: string }) => m.month === today.slice(0, 7)).cents).toBeGreaterThanOrEqual(1_200_000);
    expect(c.pipeline.n).toBeGreaterThan(0);
    expect(c.pipeline.stages[0]).toHaveProperty('name');
    expect(c.pipeline.won).toBeGreaterThan(0);
    expect(c.health.bands.map((b: { key: string }) => b.key)).toEqual(['saudavel', 'atencao', 'risco', 'sem_dado']);
  });
  it('dados de demonstração: cria as 9 fichas, lança só onde não há resultado, aparece marcado e sai com um clique', async () => {
    expect((await lucas.post('/intelligence/kpis/demo')).statusCode).toBe(403);
    const r = ok(await carlos.post('/intelligence/kpis/demo')).json();
    expect(r.created).toBe(9);
    expect(r.entries).toBeGreaterThan(9);
    expect(ok(await carlos.post('/intelligence/kpis/demo')).json()).toEqual({ created: 0, entries: 0 }); // idempotente
    let b = ok(await carlos.get('/intelligence/kpis')).json();
    expect(b.demoEntries).toBe(r.entries);
    const bk = b.items.find((i: { key: string }) => i.key === 'kpi_booking_de_contratos');
    expect(bk.def.sheet).toMatchObject({ main: true, owner: null, quarterTargets: [35, 60, 50, 35] });
    expect(bk.current.value).not.toBeNull();
    expect(b.items.filter((i: { def: { sheet: { paused: boolean } } }) => i.def.sheet.paused).map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(['kpi_mix_receita_produto', 'kpi_taxa_de_conversao_sql']));
    // resultado real lançado não é tocado pela limpeza
    ok(await carlos.post(`/intelligence/kpis/${bk.id}/entries`, { period: month, value: 50 }), 201);
    expect(ok(await carlos.post('/intelligence/kpis/demo/clear')).json().cleared).toBe(r.entries - 1);
    b = ok(await carlos.get('/intelligence/kpis')).json();
    expect(b.demoEntries).toBe(0);
    const ent = ok(await carlos.get(`/intelligence/kpis/${bk.id}/entries`)).json().items.filter((e: { supersededAt: string | null }) => !e.supersededAt);
    expect(ent).toHaveLength(1);
    expect(ent[0]).toMatchObject({ period: month, value: 50 });
  });
  it('receita da base de contratos: ano anterior informado separa o reajuste e o Booking passa a ser calculado', async () => {
    const y = Number(new Date().toISOString().slice(0, 4));
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Cliente Antigo Fictício', segment: 'empresarial' }, planId: plan.id }), 201).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', kind: 'privado', commercialOwnerId: lucas.me.user.id, version: { number: 'ANT-1', object: 'Link', signedAt: `${y - 1}-01-01`, startAt: `${y - 1}-01-01`, termMonths: 36, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] } }), 201).json().id;
    ok(await carlos.post(`/contracts/${id}/validate`));
    const before = ok(await carlos.get('/intelligence/revenue')).json();
    expect(before.months).toHaveLength(12);
    expect(before.missingHistory).toBeGreaterThanOrEqual(1); // cadastrado agora, existia no ano anterior e sem valor daquele ano
    expect((await lucas.post(`/contracts/${id}/year-values`, { year: y - 1, monthlyCents: 90_000 })).statusCode).toBe(403);
    ok(await carlos.post(`/contracts/${id}/year-values`, { year: y - 1, monthlyCents: 90_000, onlyAdjustment: true, note: 'Valor antes do reajuste' }), 201);
    const after = ok(await carlos.get('/intelligence/revenue')).json();
    expect(after.prevMonths[0].total - before.prevMonths[0].total).toBe(-10_000);
    expect(after.months[0].reajuste - before.months[0].reajuste).toBe(10_000);
    expect(after.missingHistory).toBe(before.missingHistory - 1);
    expect(after.totals[String(y - 1)]).toBeGreaterThan(0);
    const hist = ok(await carlos.get(`/contracts/${id}/year-values`)).json();
    expect(hist.items[0]).toMatchObject({ year: y - 1, monthlyCents: 90_000, onlyAdjustment: true });
    const k = ok(await carlos.get('/intelligence/kpis')).json().items.find((i: { key: string }) => i.key === 'kpi_booking_de_contratos');
    expect(k.source).toBe('crm');
    expect(k.annual.value).toBeCloseTo(after.ytd.growthComparable, 0);
  });
  it('KPIs calculados do CRM: lead time pelas categorias escolhidas, ativação pela régua ajustável', async () => {
    const all = ok(await carlos.get('/intelligence/kpis')).json().items as { id: string; key: string; source: string; current: { value: number | null } | null }[];
    const lead = all.find((i) => i.key === 'kpi_lead_time_viabilidade')!;
    const abm = all.find((i) => i.key === 'kpi_ativacao_de_contas_alvo')!;
    // conversão e win rate saem do funil
    expect(all.find((i) => i.key === 'kpi_taxa_de_conversao')!.source).toBe('crm');
    // lead time: sem categoria escolhida fica o informado; escolhendo, calcula a média
    let calc = ok(await carlos.get(`/intelligence/kpis/${lead.id}/calc`)).json();
    expect(calc).toMatchObject({ kind: 'lead_time', taskCategories: [] });
    const urow = (await ctx.db.execute<{ tenant_id: string; id: string }>(sql`select tenant_id, id from users where email = 'carlos@yepnet.test'`)).rows[0]!;
    const tid = urow.tenant_id, uid = urow.id;
    await ctx.db.execute(sql`insert into activities (tenant_id, type, title, owner_id, category, created_at, completed_at, status) values
      (${tid}, 'tarefa', 'Viabilidade engenharia fictícia', ${uid}, 'Viabilidade Engenharia', now() - interval '3 days', now(), 'concluida'),
      (${tid}, 'tarefa', 'Viabilidade infra fictícia', ${uid}, 'Viabilidade Infraestrutura', now() - interval '1 days', now(), 'concluida')`);
    expect((await lucas.put(`/intelligence/kpis/${lead.id}/calc`, { taskCategories: ['Viabilidade Engenharia'] })).statusCode).toBe(403);
    ok(await carlos.put(`/intelligence/kpis/${lead.id}/calc`, { taskCategories: ['Viabilidade Engenharia', 'viabilidade infraestrutura'] }));
    const after = (ok(await carlos.get('/intelligence/kpis')).json().items as typeof all).find((i) => i.key === 'kpi_lead_time_viabilidade')!;
    expect(after.source).toBe('crm');
    expect(after.current!.value).toBeCloseTo(2, 0);
    // ativação: régua sugerida, ajustável e validada
    calc = ok(await carlos.get(`/intelligence/kpis/${abm.id}/calc`)).json();
    expect(calc.activation.tiers['1_1']).toEqual({ windowDays: 30, minPoints: 6, minStrong: 1, minPeople: 2 });
    expect((await carlos.put(`/intelligence/kpis/${abm.id}/calc`, { activation: { ...calc.activation, tiers: { ...calc.activation.tiers, '1_1': { windowDays: 2, minPoints: 6, minStrong: 1, minPeople: 2 } } } })).statusCode).toBe(422);
    ok(await carlos.put(`/intelligence/kpis/${abm.id}/calc`, { activation: { ...calc.activation, tiers: { ...calc.activation.tiers, '1_muitos': { windowDays: 120, minPoints: 2, minStrong: 0, minPeople: 1 } } } }));
    expect(ok(await carlos.get(`/intelligence/kpis/${abm.id}/calc`)).json().activation.tiers['1_muitos'].windowDays).toBe(120);
    const acc = ok(await carlos.get('/intelligence/kpis/activation/accounts')).json();
    expect(Array.isArray(acc.items)).toBe(true);
    for (const a of acc.items) expect(['ativada', 'engajada', 'esfriando', 'nao_engajada']).toContain(a.state);
  });
});
