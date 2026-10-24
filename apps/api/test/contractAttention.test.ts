/** Central de atenção dos contratos, painel executivo e resumo diário por e-mail. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays } from '@isp/domain';
import { setTransportFactory } from '../src/services/email';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const sent: { to: string; subject: string; text: string }[] = [];
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => { setTransportFactory(null); await ctx.close(); });

async function contract(name: string, version: object, extra: object = {}, validate = true) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'governamental' }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', kind: 'privado', commercialOwnerId: lucas.me.user.id, ...extra, version: { number: `AT-${name.slice(0, 6)}`, object: 'Link', signedAt: addDays(today, -340), startAt: addDays(today, -335), termMonths: 12, monthlyCents: 200_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 200_000 }], ...version } }), 201).json().id;
  if (validate) ok(await carlos.post(`/contracts/${id}/validate`));
  return id as string;
}

describe('central de atenção', () => {
  it('junta notificações, validação e habilitação numa fila por gravidade; painel executivo; resumo diário uma vez por dia', async () => {
    const pub = await contract('Prefeitura Atenção Fictícia', { publicTerms: { agency: 'Prefeitura', processNumber: '7/2025', modality: 'pregao', commitmentNote: null, budgetLine: null, extensionMaxMonths: 120 } }, { kind: 'publico', legalRegime: 'lei_14133' });
    const priv = await contract('Empresa Atenção Fictícia', { monthlyCents: 50_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 50_000 }] });
    const pending = await contract('Loja Validação Fictícia', {}, {}, false);
    await ctx.db.execute(sql`update contracts set created_at = now() - interval '5 days' where id = ${pending}`);
    ok(await carlos.post('/contracts/alerts/run'));

    const r = ok(await carlos.get('/contracts/attention')).json();
    const keys = r.items.map((x: { source: string; contractId: string | null; kind: string }) => `${x.source}:${x.kind}:${x.contractId ?? ''}`);
    expect(keys).toContain(`notificacao:sem_empenho:${pub}`);
    expect(keys).toContain(`notificacao:renovacao:${priv}`);
    expect(keys).toContain(`validacao:validacao:${pending}`);
    expect(r.items.some((x: { source: string; title: string }) => x.source === 'habilitacao' && /CND|Certidão|FGTS|CNDT/i.test(x.title))).toBe(true);
    // ordenação: todos os críticos antes dos altos, que vêm antes dos de atenção
    const order = r.items.map((x: { level: string }) => ({ critica: 0, alta: 1, media: 2 })[x.level as 'critica']);
    expect([...order].sort()).toEqual(order);
    expect(r.items[0].level).toBe('critica');
    expect(r.summary.critica).toBeGreaterThan(0);
    expect(r.summary.valueAtStakeCents).toBeGreaterThanOrEqual(2_400_000 + 600_000);
    const validation = r.items.find((x: { source: string }) => x.source === 'validacao');
    expect(validation.level).toBe('alta'); // passou do prazo de 2 dias: sobe de "atenção" para "alto"

    // "só os meus": lucas é o comercial dos contratos; habilitação fica com a gestão
    const mine = ok(await lucas.get('/contracts/attention?mine=1')).json();
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((x: { source: string }) => x.source !== 'habilitacao')).toBe(true);

    const dash = ok(await carlos.get('/contracts/dashboard')).json();
    expect(dash.executive.risk.map((x: { days: number }) => x.days)).toEqual([30, 60, 90, 180]);
    expect(dash.executive.risk[3].monthlyCents).toBeGreaterThanOrEqual(250_000);
    expect(dash.executive.backlogCents).toBeGreaterThan(0);
    expect(dash.executive.concentration.hhi).toBeGreaterThan(0);
    expect(dash.executive.contractedAnnualCents).toBeGreaterThanOrEqual(3_000_000);

    // resumo diário
    setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { messageId: `d${sent.length}` }; } }) as never);
    ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
    const first = ok(await carlos.post('/contracts/digest/run')).json();
    expect(first.sent).toBeGreaterThan(0);
    const toLucas = sent.find((m) => m.to === 'lucas@yepnet.test');
    expect(toLucas?.subject).toMatch(/Contratos: .*item\(ns\) pedem ação hoje/);
    expect(toLucas?.text).toContain('Empresa Atenção Fictícia');
    expect(toLucas?.text).toContain('/contracts?t=atencao');
    const second = ok(await carlos.post('/contracts/digest/run')).json();
    expect(second.sent).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect((await lucas.post('/contracts/digest/run')).statusCode).toBe(403);
  });
});
