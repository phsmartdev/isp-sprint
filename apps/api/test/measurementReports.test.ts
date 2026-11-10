/** Relatório de Medição: conta marcada, prévia ao vivo igual ao e-mail, rascunho do mês fechado, ajuste e envio. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
let cid = '', contactId = '', month = '', oppA = '', oppB = '';

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const [o] = (await ctx.db.execute(sql`select o.id, o.contact_id from opportunities o where o.stage = 'ganha' and o.deleted_at is null and not exists (select 1 from contracts c where c.opportunity_id = o.id) limit 1`)).rows as { id: string; contact_id: string }[];
  const c = ok(await carlos.post('/contracts', { opportunityId: o!.id, billingType: 'medicao', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: 'CTR-MED/2026', object: 'Rede óptica fictícia', signedAt: `${year}-01-10`, startAt: `${year}-01-10`, termMonths: 12, monthlyCents: 0, totalCents: 10_000_000, items: [], publicTerms: { agency: 'Órgão Fictício', processNumber: '9/2026', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json();
  cid = c.id; contactId = o!.contact_id;
  const [tz] = (await ctx.db.execute(sql`select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') m`)).rows as { m: string }[];
  month = tz!.m;
  await ctx.db.execute(sql`insert into contract_lines (tenant_id, contract_id, position, item_number, description, unit, qty4, price4) select tenant_id, id, 1, '27', 'Fusão Óptica', 'Und', 10000000, 700000 from contracts where id = ${cid}`);
  const mk = async (title: string, items: [string, string, number, number][], att: boolean) => {
    const [r] = (await ctx.db.execute(sql`insert into opportunities select (jsonb_populate_record(null::opportunities, to_jsonb(o) || jsonb_build_object('id', gen_random_uuid(), 'code', nextval(pg_get_serial_sequence('opportunities', 'code')), 'title', ${title}::text, 'stage', 'proposta', 'measurement_contract_id', ${cid}::uuid, 'proposal_status', 'enviada', 'measurement_cents', 151840, 'created_at', now(), 'updated_at', now()))).* from opportunities o where o.id = ${o!.id} returning id`)).rows as { id: string }[];
    const id = r!.id;
    for (const [i, [d, u, q, p]] of items.entries()) await ctx.db.execute(sql`insert into opportunity_items (tenant_id, opportunity_id, position, description, unit, qty_milli, unit_cents) select tenant_id, ${id}, ${i}, ${d}, ${u}, ${q}, ${p} from opportunities where id = ${id}`);
    if (att) await ctx.db.execute(sql`insert into opportunity_attachments (tenant_id, opportunity_id, kind, filename, mime, size_bytes, sha256, data) select tenant_id, ${id}, 'proposta', ${`Proposta ${title}.pdf`}, 'application/pdf', 4, 'x', '\\x25504446'::bytea from opportunities where id = ${id}`);
    await ctx.db.execute(sql`insert into opportunity_events (tenant_id, opportunity_id, type, payload) select tenant_id, ${id}, 'email_sent', '{"kind":"proposta"}'::jsonb from opportunities where id = ${id}`);
    return id;
  };
  oppA = await mk('Recuperação óptica na unidade fictícia A', [['Fusão óptica', 'un', 60_000, 7_000], ['Hora técnica', 'h', 2_000, 9_690]], true);
  oppB = await mk('Recuperação óptica na unidade fictícia B', [['Fusão Óptica', 'un', 42_000, 7_000]], false);
});
afterAll(async () => ctx.close());

describe('Relatório de Medição', () => {
  it('prévia ao vivo do mês, em qualquer dia, com o mesmo HTML do e-mail', async () => {
    const r = ok(await carlos.get(`/contacts/${contactId}/measurement/preview?month=${month}`)).json();
    const mine = r.data.proposals.filter((p: { opportunityId: string }) => [oppA, oppB].includes(p.opportunityId));
    expect(mine).toHaveLength(2);
    const fusao = r.data.items.find((i: { item: string }) => i.item === '27');
    expect(fusao.qtyMilli).toBe(102_000);
    expect(fusao.totalCents).toBe(714_000);
    expect(r.html).toContain('Recuperação óptica na unidade fictícia A'.toUpperCase());
    expect(r.html).toContain('Fusão óptica');
    expect(r.totals.withoutAttachment).toBeGreaterThanOrEqual(1);
    expect(r.data.partial).toBe(true);
  });
  it('marca a conta, gera o rascunho, desmarca proposta e não envia sem SMTP (fica rascunho)', async () => {
    expect((await carlos.put(`/contacts/${contactId}/measurement/settings`, { enabled: true, dueDay: 5, toAddress: '', ccAddress: '', texts: { greeting: 'Bom dia.', intro: 'Mês de {mes}.', closing: 'Obrigado.' } })).statusCode).toBe(422);
    ok(await carlos.put(`/contacts/${contactId}/measurement/settings`, { enabled: true, dueDay: 5, toAddress: 'medicao@orgao-ficticio.test', ccAddress: '', texts: { greeting: 'Bom dia.', intro: 'Mês de {mes}.', closing: 'Obrigado.' } }));
    const home = ok(await carlos.get(`/contacts/${contactId}/measurement`)).json();
    expect(home.settings.enabled).toBe(true);
    expect(home.official.referenceMonth < month).toBe(true);
    expect(home.reports.some((x: { referenceMonth: string; automatic: boolean }) => x.referenceMonth === home.official.referenceMonth && x.automatic)).toBe(true);
    const g = ok(await carlos.post(`/contacts/${contactId}/measurement/reports`, { month }), 201).json();
    ok(await carlos.put(`/measurement-reports/${g.id}`, { subject: 'Relatório de Medição fictício', texts: { greeting: 'Bom dia.', intro: 'Mês de {mes}.', closing: 'Obrigado.' }, excluded: [oppB] }));
    const r = ok(await carlos.get(`/measurement-reports/${g.id}`)).json();
    expect(r.data.proposals.find((p: { opportunityId: string }) => p.opportunityId === oppB).included).toBe(false);
    expect(r.data.items.find((i: { item: string }) => i.item === '27').qtyMilli).toBe(60_000);
    expect(r.to).toBe('medicao@orgao-ficticio.test');
    const s = await carlos.post(`/measurement-reports/${g.id}/send`, { to: 'medicao@orgao-ficticio.test', cc: '' });
    if (s.statusCode === 200) expect(ok(await carlos.get(`/measurement-reports/${g.id}`)).json().status).toBe('enviado');
    else { expect(s.statusCode).toBe(422); expect(ok(await carlos.get(`/measurement-reports/${g.id}`)).json().status).toBe('rascunho'); }
  });
});

describe('Exemplo e número da proposta', () => {
  it('carrega 1 contrato com 6 medições pelas oportunidades, sem duplicar, com PC AAMMDD', async () => {
    const r = ok(await carlos.post('/admin/demo/measurement-example', {})).json();
    expect(r.created).toBe(true);
    expect(ok(await carlos.post('/admin/demo/measurement-example', {})).json()).toEqual({ contactId: r.contactId, created: false });
    const home = ok(await carlos.get(`/contacts/${r.contactId}/measurement`)).json();
    const rep = home.reports.find((x: { referenceMonth: string }) => x.referenceMonth === home.official.referenceMonth);
    expect(rep.totals.proposals).toBe(6);
    expect(rep.totals.withoutAttachment).toBe(0);
    expect(rep.totals.itemsCents).toBe(rep.totals.proposalsCents);
    const full = ok(await carlos.get(`/measurement-reports/${rep.id}`)).json();
    expect(full.data.proposals.every((p: { number: string }) => /^PC \d{6}(-\d+)?$/.test(p.number))).toBe(true);
    expect(full.data.items.map((i: { item: string }) => i.item)).toEqual(['15', '22', '23', '27', '28', '29', '41', '48', '49']);
    const led = (await ctx.db.execute(sql`select count(*)::int n from contract_ledger l join contracts c on c.id = l.contract_id where c.contact_id = ${r.contactId} and l.kind = 'consumo'`)).rows[0] as { n: number };
    expect(led.n).toBe(6);
    // tabela editada: nova coluna e nova linha de texto ficam no e-mail
    const t = full.tables;
    t.proposals.columns.push({ label: 'Observação', align: 'left' });
    t.proposals.rows = t.proposals.rows.map((x: string[]) => [...x, '']);
    t.proposals.total = [...t.proposals.total, ''];
    t.proposals.rows.push(['—', 'Texto livre de exemplo', '', '', 'Combinado com o fiscal']);
    ok(await carlos.put(`/measurement-reports/${rep.id}`, { subject: full.subject, texts: full.data.texts, excluded: [], tables: t }));
    const after = ok(await carlos.get(`/measurement-reports/${rep.id}`)).json();
    expect(after.edited).toBe(true);
    expect(after.html).toContain('Combinado com o fiscal');
    expect(after.html).toContain('Observação');
    ok(await carlos.put(`/measurement-reports/${rep.id}`, { subject: full.subject, texts: full.data.texts, excluded: [], resetTables: true }));
    expect(ok(await carlos.get(`/measurement-reports/${rep.id}`)).json().edited).toBe(false);
  });
});
