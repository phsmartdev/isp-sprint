/** Financial Studio: fórmulas reais do motor, simulação de impacto e governança das versões. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { hashPassword } from '../src/auth/password';
import * as s from '../src/db/schema';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, diretora: Client, lucas: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ECON = { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 4500, tmaAnnualBp: 1500, inflationAnnualBp: 450, horizonMaxMonths: 36, badDebtBp: 150, commissionBp: 200, lossPrivateBp: 100, lossPublicBp: 200, contingencyCapexBp: 0, contingencyOpexBp: 0, overheadBp: 500, incomeTaxBp: 3400, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, validFrom: today };
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let oppId = '';

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
  // segunda pessoa da gestão (quem cria não valida nem aprova a própria fórmula)
  const u = ok(await carlos.post('/admin/users', { name: 'Diretora Fictícia', email: 'diretora.studio@yepnet.test', profile: 'gerencia' }), 201).json();
  await ctx.db.update(s.users).set({ passwordHash: await hashPassword('Sprint@2026') }).where(eq(s.users.id, u.id));
  diretora = await login(ctx.app, 'diretora.studio@yepnet.test');
  // dados reais: parâmetros, documento fiscal, oportunidade com produto e planilha de custos salva
  ok(await carlos.post('/admin/viability/econ', ECON), 201);
  const lk = ok(await carlos.get('/meta/lookups')).json();
  const branch = lk.branches[0].id;
  // mantém os documentos que já existem na filial e acrescenta um próprio do teste
  const existing = ok(await carlos.get('/admin/fiscal-docs')).json().items.filter((d: { branchId: string }) => d.branchId === branch)
    .map((d: { id: string; fiscalKind: string; code: string; name: string; active: boolean; taxes: unknown[] }) => ({ id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes }));
  const docs = ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [...existing, { id: null, fiscalKind: 'servico', code: 'NFSTUDIO', name: 'Nota de comunicação (studio)', active: true, taxes: [{ name: 'ICMS e contribuições', percentBp: 3000, fixedCents: 0, active: true }] }] })).json().items;
  const doc = docs.find((d: { code: string }) => d.code === 'NFSTUDIO');
  const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
  const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Studio ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
  ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link dedicado', unit: 'un', qtyMilli: 1000, unitCents: 1_292_500, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: doc.id }] }));
  ok(await carlos.put(`/opportunities/${o.id}/economics`, { mode: 'recorrente', termMonths: 24, receiveMonth: 0, extraInitialCents: 0, commissionBp: null, lossBp: null, marginTargetBp: null, paybackMonths: null, priceCents: null,
    capex: [{ description: 'Cabo fibra', unit: 'm', impact: 'material', qtyMilli: 1_000_000, unitCents: 500 }], opex: [{ description: 'Aluguel de poste', unit: 'un', qtyMilli: 10_000, unitCents: 1_200 }] }));
  oppId = o.id;
});
afterAll(async () => ctx.close());

describe('Financial Studio', () => {
  it('carrega as fórmulas reais do motor com variáveis de origem rastreável; vendedor sem acesso', async () => {
    ok(await lucas.get('/finance-studio/catalog'), 403);
    const c = ok(await carlos.get('/finance-studio/catalog')).json();
    const custo = c.formulas.find((f: { code: string }) => f.code === 'custo_mensal');
    expect(custo).toMatchObject({ expression: 'SE(recorrente; custo_mensal_base * (1 + aliq_contingencia_opex); 0)', version: 0, custom: false });
    expect(custo.dependents).toEqual(expect.arrayContaining(['margem_contribuicao', 'fluxo_caixa', 'vpl', 'tir', 'roi', 'payback_descontado', 'aprovacao_automatica']));
    expect(c.variables.find((v: { code: string }) => v.code === 'aliq_tributos')).toMatchObject({ module: 'Motor Financeiro → Tributação', source: expect.stringContaining('fiscal_doc_types') });
    expect(c.can).toMatchObject({ edit: true, approve: true });
    expect(ok(await carlos.get('/finance-studio/opportunities')).json().items.some((o: { id: string }) => o.id === oppId)).toBe(true);
  });

  it('simula a alteração: anterior × novo, diferença, indicadores impactados e viabilidade; nada é gravado', async () => {
    const r = ok(await carlos.post('/finance-studio/simulate', { opportunityId: oppId, changes: [{ code: 'custo_mensal', expression: 'SE(recorrente; custo_mensal_base * 20; 0)' }], portfolio: true })).json();
    expect(r.issues.filter((i: { level: string }) => i.level === 'erro')).toEqual([]);
    const v = (code: string) => r.result.values.find((x: { code: string }) => x.code === code);
    expect(v('custo_mensal')).toMatchObject({ before: 12_000, after: 240_000, diffAbs: 228_000, edited: true });
    expect(v('custo_mensal').diffPct).toBeCloseTo(1900, 6);
    expect(v('margem_contribuicao')).toMatchObject({ impacted: true, changed: true, diffAbs: -228_000 });
    expect(v('tributos')).toMatchObject({ impacted: false, changed: false });
    expect(v('vpl').after).toBeLessThan(v('vpl').before);
    expect(r.affected).toEqual(expect.arrayContaining(['margem_contribuicao', 'margem_operacional', 'margem_liquida', 'fluxo_caixa', 'vpl', 'tir', 'roi', 'payback_descontado']));
    expect(r.result.trace.before.memory).toBe('SE(VERDADEIRO; 120,00 * (1 + 0%); 0)');
    expect(r.result.variables.find((x: { code: string }) => x.code === 'custo_mensal_base')).toMatchObject({ value: 12_000, used: true });
    expect(r.result.viability.before).toMatchObject({ verdict: 'viavel' });
    expect(r.portfolio.total).toBeGreaterThanOrEqual(1);
    // nada mudou na produção
    const saved = ok(await carlos.get(`/opportunities/${oppId}/economics`)).json();
    expect(saved.stale).toBe(false);
    expect(saved.result.monthlyCostCents).toBe(12_000);
    // erros: referência circular e variável desconhecida
    const cyc = ok(await carlos.post('/finance-studio/simulate', { opportunityId: oppId, changes: [{ code: 'custo_mensal', expression: 'margem_contribuicao * 0.1' }] })).json();
    expect(cyc.issues.some((i: { message: string }) => /circular/.test(i.message))).toBe(true);
    const unk = ok(await carlos.post('/finance-studio/validate', { code: 'custo_mensal', expression: 'custo_xyz * 2' })).json();
    expect(unk).toMatchObject({ ok: false });
    expect(unk.issues[0].message).toMatch(/desconhecida/);
  });

  it('versões: rascunho → simulada → validação → aprovação → publicação; publicada não muda; restaurar gera nova revisão', async () => {
    const v1 = ok(await carlos.post('/finance-studio/formulas/custo_mensal/versions', { expression: 'SE(recorrente; custo_mensal_base * 2; 0)', justification: 'Dobra o custo para refletir a manutenção preventiva' }), 201).json();
    expect(v1).toMatchObject({ version: 1, status: 'rascunho' });
    ok(await carlos.post('/finance-studio/formulas/custo_mensal/versions', {}), 422); // já tem versão em andamento
    ok(await carlos.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'enviar' }), 422); // sem simulação
    const sim = ok(await carlos.post(`/finance-studio/versions/${v1.id}/simulate`, { opportunityId: oppId })).json();
    expect(sim.version.status).toBe('simulada');
    expect(sim.version.simulation).toMatchObject({ before: 12_000, after: 24_000, diffAbs: 12_000 });
    expect(sim.version.simulation.impacted.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['margem_contribuicao', 'vpl']));
    ok(await carlos.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'enviar' }));
    ok(await carlos.patch(`/finance-studio/versions/${v1.id}`, { expression: 'custo_mensal_base' }), 422); // travada depois do envio
    ok(await carlos.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'validar' }), 403); // quem criou não valida
    ok(await diretora.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'validar' }));
    ok(await carlos.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'aprovar' }), 403);
    ok(await diretora.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'aprovar' }));
    ok(await diretora.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'publicar', validFrom: '2020-01-01' }), 422);
    const pub = ok(await diretora.post(`/finance-studio/versions/${v1.id}/transition`, { action: 'publicar', validFrom: today })).json();
    expect(pub).toMatchObject({ status: 'publicada', validFrom: today });
    // o banco não deixa mexer na publicada
    await expect(ctx.db.execute(sql`update financial_formula_versions set expression = 'x' where id = ${v1.id}`)).rejects.toThrow(/publicada/);
    await expect(ctx.db.execute(sql`delete from financial_formula_events where version_id = ${v1.id}`)).rejects.toThrow(/append-only/);

    // a publicação vale para os próximos cálculos: o salvo fica desatualizado (reavaliação explícita) e mantém a versão usada
    let g = ok(await carlos.get(`/opportunities/${oppId}/economics`)).json();
    expect(g.stale).toBe(true);
    expect(g.result.monthlyCostCents).toBe(12_000);
    expect(g.modelOverrides.find((o: { code: string }) => o.code === 'custo_mensal')).toMatchObject({ version: 1 });
    const again = ok(await carlos.put(`/opportunities/${oppId}/economics`, g.input)).json();
    expect(again.result.monthlyCostCents).toBe(24_000);
    expect(again.result.model.versions).toMatchObject({ custo_mensal: 1 });
    const run = ok(await carlos.get(`/opportunities/${oppId}/economics/runs/ultimo`)).json();
    expect(run.settings.formulaModel.versions[0]).toMatchObject({ code: 'custo_mensal', version: 1 });
    expect(run.verified).toBe(true);
    g = ok(await carlos.get('/finance-studio/catalog')).json();
    expect(g.formulas.find((f: { code: string }) => f.code === 'custo_mensal')).toMatchObject({ version: 1, expression: 'SE(recorrente; custo_mensal_base * 2; 0)' });

    // restaurar a padrão: nova revisão (v2), o histórico fica
    const v2 = ok(await carlos.post('/finance-studio/formulas/custo_mensal/versions', { restoreFrom: 'padrao', justification: 'Volta para o custo da planilha' }), 201).json();
    expect(v2).toMatchObject({ version: 2, status: 'rascunho', expression: 'SE(recorrente; custo_mensal_base * (1 + aliq_contingencia_opex); 0)' });
    const hist = ok(await carlos.get('/finance-studio/formulas/custo_mensal/versions')).json();
    expect(hist.versions.map((x: { version: number; status: string }) => `${x.version}:${x.status}`)).toEqual(['2:rascunho', '1:publicada']);
    expect(hist.versions[1].events.map((e: { action: string }) => e.action)).toEqual(['publicada', 'aprovada', 'validada', 'enviada', 'simulada', 'criada']);
    ok(await diretora.post(`/finance-studio/versions/${v2.id}/transition`, { action: 'devolver', note: 'sem motivo' }), 422); // ainda em rascunho
  });

  it('fórmula personalizada usada por uma fórmula do sistema', async () => {
    ok(await carlos.post('/finance-studio/formulas', { code: 'Taxa-Cartão', name: 'x', category: 'despesas', unit: '%', expression: '2%' }), 422);
    const f = ok(await carlos.post('/finance-studio/formulas', { code: 'taxa_cartao', name: 'Taxa do cartão', category: 'despesas', unit: '%', expression: '2%', justification: 'Recebimento por cartão' }), 201).json();
    expect(f).toMatchObject({ code: 'taxa_cartao', version: 1 });
    const r = ok(await carlos.post('/finance-studio/simulate', { opportunityId: oppId, changes: [{ code: 'taxa_cartao', expression: '2%' }, { code: 'comissao', expression: 'receita * (aliq_comissao + taxa_cartao)' }] })).json();
    const com = r.result.values.find((x: { code: string }) => x.code === 'comissao');
    expect(com.after - com.before).toBeCloseTo(1_292_500 * 0.02, 6);
  });
});
