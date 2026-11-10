/** Ocorrências da conta (notificação, elogio, mudança na negociação…) e evolução do relacionamento. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
let lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); lucas = await login(ctx.app, 'lucas@yepnet.test'); });
afterAll(async () => ctx.close());

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const daysAgo = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

describe('ocorrências da conta', () => {
  it('registra, valida, responde, retira e aparece na evolução', async () => {
    // conta com oportunidade; e uma oportunidade de outra conta para o teste de vínculo
    const [acc] = (await ctx.db.execute<{ contact_id: string; opp: string }>(sql`select o.contact_id, o.id opp from opportunities o join users u on u.tenant_id = o.tenant_id
      where u.email = 'carlos@yepnet.test' and o.deleted_at is null order by o.created_at limit 1`)).rows;
    const [other] = (await ctx.db.execute<{ id: string }>(sql`select id from opportunities where contact_id <> ${acc!.contact_id} and tenant_id = (select tenant_id from users where email = 'carlos@yepnet.test') and deleted_at is null limit 1`)).rows;
    const c = acc!.contact_id;

    // validações
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'elogio', occurredOn: today, title: 'X' }), 422);
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'feedback_positivo', occurredOn: '2999-01-01', title: 'Elogio ao suporte' }), 422);
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'feedback_positivo', occurredOn: today, title: 'Elogio', opportunityId: other!.id }), 422);
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'feedback_positivo', occurredOn: today, title: 'Elogio', aspects: ['preco'] }), 422);
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'notificacao', occurredOn: today, title: 'Ofício', responseDueOn: daysAgo(3) }), 422);

    // impacto sugerido pelo tipo
    const elogio = ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'feedback_positivo', occurredOn: daysAgo(10), title: 'Elogio da equipe de TI ao suporte', channel: 'email' })).json().id as string;
    const notif = ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'notificacao', occurredOn: daysAgo(5), title: 'Ofício cobrando prazo de instalação', channel: 'oficio', responseDueOn: daysAgo(1) })).json().id as string;
    ok(await carlos.post(`/accounts/${c}/occurrences`, { kind: 'mudanca_negociacao', occurredOn: daysAgo(2), title: 'Cliente reduziu o escopo para 4 unidades', aspects: ['escopo', 'preco'], opportunityId: acc!.opp }));

    let items = ok(await carlos.get(`/accounts/${c}/occurrences`)).json().items as { id: string; kind: string; impact: string; response: string | null; aspects: string[]; opportunityId: string | null; rowVersion: number; canChange: boolean }[];
    expect(items.find((i) => i.id === elogio)).toMatchObject({ impact: 'positivo', response: null, canChange: true });
    expect(items.find((i) => i.id === notif)).toMatchObject({ impact: 'negativo', response: 'atrasada' });
    expect(items.find((i) => i.kind === 'mudanca_negociacao')).toMatchObject({ aspects: ['escopo', 'preco'], opportunityId: acc!.opp });

    // registrar a resposta; trocar o tipo limpa "o que mudou"
    const n = items.find((i) => i.id === notif)!;
    ok(await carlos.patch(`/account-occurrences/${notif}`, { rowVersion: n.rowVersion, respondedOn: today, responseNote: 'Respondido com cronograma' }));
    ok(await carlos.patch(`/account-occurrences/${notif}`, { rowVersion: n.rowVersion, title: 'conflito' }), 409);
    const mud = items.find((i) => i.kind === 'mudanca_negociacao')!;
    ok(await carlos.patch(`/account-occurrences/${mud.id}`, { rowVersion: mud.rowVersion, kind: 'reuniao_decisao' }));
    items = ok(await carlos.get(`/accounts/${c}/occurrences`)).json().items;
    expect(items.find((i) => i.id === notif)!.response).toBe('respondida');
    expect(items.find((i) => i.id === mud.id)!.aspects).toEqual([]);

    // retirar exige motivo e some da lista
    const e = items.find((i) => i.id === elogio)!;
    ok(await carlos.post(`/account-occurrences/${elogio}/remove`, { rowVersion: e.rowVersion, reason: 'x' }), 422);
    ok(await carlos.post(`/account-occurrences/${elogio}/remove`, { rowVersion: e.rowVersion, reason: 'Registrado na conta errada' }));
    items = ok(await carlos.get(`/accounts/${c}/occurrences`)).json().items;
    expect(items.some((i) => i.id === elogio)).toBe(false);

    // evolução junta o que existe e resume por ano
    const ev = ok(await carlos.get(`/accounts/${c}/evolution`)).json() as { opportunities: { id: string }[]; occurrences: unknown[]; years: { year: number; negative: number; opened: number }[]; interactionsByQuarter: Record<string, number> };
    expect(ev.opportunities.some((o) => o.id === acc!.opp)).toBe(true);
    expect(ev.occurrences.length).toBe(2);
    const y = ev.years.find((r) => r.year === Number(today.slice(0, 4)));
    expect(y?.negative).toBeGreaterThanOrEqual(1);
    expect(ev.years.reduce((s, r) => s + r.opened, 0)).toBe(ev.opportunities.length);
  });

  it('só quem registrou ou a supervisão altera', async () => {
    const [own] = (await ctx.db.execute<{ id: string }>(sql`select c.id from contacts c join users u on u.id = c.owner_id where u.email = 'lucas@yepnet.test' and c.deleted_at is null limit 1`)).rows;
    if (!own) return;
    const id = ok(await carlos.post(`/accounts/${own.id}/occurrences`, { kind: 'marco', occurredOn: today, title: 'Inauguração da nova sede' })).json().id as string;
    const list = ok(await lucas.get(`/accounts/${own.id}/occurrences`)).json().items as { id: string; rowVersion: number; canChange: boolean }[];
    const it = list.find((i) => i.id === id)!;
    expect(it.canChange).toBe(false);
    ok(await lucas.patch(`/account-occurrences/${id}`, { rowVersion: it.rowVersion, title: 'Outro título' }), 403);
  });
});
