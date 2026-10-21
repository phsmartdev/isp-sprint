/** Gestão de Times — Fase 6: jornada de análise (problema, Pareto, Ishikawa, 5 Porquês) ligada à intervenção. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';
import { FULL_ANALYSIS } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let iv: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
  const lucasId = users.find((u) => u.email === 'lucas@yepnet.test')!.id;
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const from = d.toISOString().slice(0, 10); const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0);
  const title = `Meta análise ${Date.now().toString(36)}`;
  const g = ok(await ana.post('/performance/goals', { title, scope: 'individual', userId: lucasId, manualUnit: 'visitas', periodType: 'personalizado', periodStart: from, periodEnd: e.toISOString().slice(0, 10), target: 10 }), 201).json().id;
  ok(await lucas.get(`/performance/goals/${g}`));
  ok(await carlos.post(`/results/closings/${g}/rectify`, { reason: 'Valor conferido no relatório', value: 2, recompute: false }));
  iv = ok(await carlos.get('/interventions?status=todas')).json().items.find((x: { goalTitle: string }) => x.goalTitle === title).id;
});
afterAll(async () => ctx.close());

describe('jornada de análise', () => {
  it('rascunho com versão otimista; pendências por etapa; avaliado não edita', async () => {
    let a = ok(await carlos.get(`/interventions/${iv}/analysis`)).json();
    expect(a.analysis).toBeNull();
    expect(a.gaps.length).toBeGreaterThan(0);
    expect(a.categories).toHaveLength(6);
    const draft = { ...FULL_ANALYSIS, whys: [] };
    expect((await lucas.put(`/interventions/${iv}/analysis`, { rowVersion: 0, content: draft })).statusCode).toBe(403);
    const r = ok(await carlos.put(`/interventions/${iv}/analysis`, { rowVersion: 0, content: draft })).json();
    expect(r.gaps.map((g: { step: string }) => g.step)).toEqual(expect.arrayContaining(['porques', 'conclusao']));
    expect((await carlos.put(`/interventions/${iv}/analysis`, { rowVersion: 0, content: draft })).statusCode).toBe(409);
    expect((await carlos.post(`/interventions/${iv}/analysis/conclude`, { rowVersion: r.rowVersion })).statusCode).toBe(422);
    a = ok(await carlos.get(`/interventions/${iv}/analysis`)).json();
    expect(a.pareto.rows.map((x: { vital: boolean }) => x.vital)).toEqual([true, true, false]);
  });

  it('plano bloqueado sem análise; concluir leva o diagnóstico ao plano; concluída fica travada e pode ser reaberta', async () => {
    let d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect((await carlos.post(`/interventions/${iv}/plan`, { rowVersion: d.rowVersion, diagnosis: 'Diagnóstico qualquer aqui', actionPlan: 'Plano qualquer de ação', planDueOn: new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10) })).statusCode).toBe(422);
    const cur = ok(await carlos.get(`/interventions/${iv}/analysis`)).json();
    const put = ok(await carlos.put(`/interventions/${iv}/analysis`, { rowVersion: cur.analysis.rowVersion, content: FULL_ANALYSIS })).json();
    expect(put.gaps).toEqual([]);
    const c = ok(await carlos.post(`/interventions/${iv}/analysis/conclude`, { rowVersion: put.rowVersion })).json();
    expect(c.diagnosis).toContain('Concentração (Pareto): Agenda de suporte, Cliente remarcou');
    const a = ok(await lucas.get(`/interventions/${iv}/analysis`)).json();
    expect(a).toMatchObject({ canEdit: false, analysis: { status: 'concluida' } });
    expect((await carlos.put(`/interventions/${iv}/analysis`, { rowVersion: a.analysis.rowVersion, content: FULL_ANALYSIS })).statusCode).toBe(422);
    d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.analysisStatus).toBe('concluida');
    expect(d.diagnosis).toContain('Falta de triagem de suporte da carteira');
    ok(await carlos.post(`/interventions/${iv}/plan`, { rowVersion: d.rowVersion, diagnosis: d.diagnosis, actionPlan: 'Plantão de suporte para a carteira e duas manhãs de visita', planDueOn: new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10) }));
    expect((await carlos.post(`/interventions/${iv}/analysis/reopen`, { rowVersion: a.analysis.rowVersion, reason: 'curto' })).statusCode).toBe(422);
    ok(await carlos.post(`/interventions/${iv}/analysis/reopen`, { rowVersion: a.analysis.rowVersion, reason: 'Nova evidência trazida pelo time' }));
    d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['analise_iniciada', 'analise_concluida', 'analise_reaberta', 'plano_registrado']));
  });

  it('Pareto com dados reais: perdas do período por motivo (contagem e valor)', async () => {
    const q = ok(await carlos.get(`/interventions/${iv}/analysis/pareto-data?source=motivos_perda`)).json();
    expect(q).toHaveProperty('sample');
    for (const it of q.items) expect(it.value).toBeGreaterThan(0);
    ok(await carlos.get(`/interventions/${iv}/analysis/pareto-data?source=motivos_perda_valor`));
    expect((await carlos.get(`/interventions/${iv}/analysis/pareto-data?source=outro`)).statusCode).toBe(422);
  });
});
