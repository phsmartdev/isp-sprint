/** Atas de registro de preços: os testes obrigatórios da especificação. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const pdf = Buffer.from('%PDF-1.4 documento ficticio').toString('base64');
let arpId: string, item1: string, item2: string, manager: string, saude: string;

const doc = async (c: Client, category: string, name = `${category}.pdf`) => ok(await c.post(`/arps/${arpId}/documents`, { category, name, mime: 'application/pdf', data: pdf }), 201).json().id as string;
const ata = async (c: Client = carlos) => ok(await c.get(`/arps/${arpId}`)).json();
const itemOf = async (id: string) => (await ata()).items.find((i: { id: string }) => i.id === id);
const ledgerCount = async () => Number(((await ctx.db.execute(sql`select count(*)::int n from arp_ledger where arp_id = ${arpId}`)).rows[0] as { n: number }).n);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
  ok(await carlos.patch(`/admin/users/${users.find((u) => u.email === 'mariana@yepnet.test')!.id}`, { sectors: ['juridico'] }));
  mariana = await login(ctx.app, 'mariana@yepnet.test');
});
afterAll(async () => ctx.close());

describe('cadastro e importação', () => {
  it('cria a ata, importa itens com distribuição e valida total', async () => {
    arpId = ok(await carlos.post('/arps', { number: 'ARP 01/2026', object: 'Serviços de conectividade fictícios', regime: 'federal', supplierName: 'Yepnet Telecom (fictícia)', startAt: '2026-01-01', endAt: '2026-12-31', managerName: 'Secretaria de Administração Fictícia' }), 201).json().id;
    const rows = [
      { lot: '1', itemNumber: '1', description: 'Link dedicado 100 Mbps', unit: 'mês', registeredQty: '100', unitPrice: '1.000,00', totalPrice: '100.000,00' },
      { lot: '1', itemNumber: '1', description: 'Link dedicado 100 Mbps', unit: 'mês', registeredQty: '100', unitPrice: '1.000,00', agency: 'Secretaria de Saúde Fictícia', agencyQty: '30' },
      { lot: '1', itemNumber: '2', description: 'Roteador', unit: 'un', registeredQty: '5', unitPrice: '2.000,00', totalPrice: '10.000,00' },
      { lot: '1', itemNumber: '3', description: 'Item com total errado', unit: 'un', registeredQty: '2', unitPrice: '10,00', totalPrice: '99,00' },
    ];
    const pre = ok(await carlos.post(`/arps/${arpId}/import`, { rows, apply: false })).json();
    expect(pre.issues).toEqual([expect.objectContaining({ row: 5, field: 'totalPrice' })]);
    expect(pre.report.created).toEqual(['1/1', '1/2']);
    expect(pre.report.newAgencies).toEqual(['Secretaria de Saúde Fictícia']);
    expect((await ata()).items).toHaveLength(0); // prévia não grava
    ok(await carlos.post(`/arps/${arpId}/import`, { rows: rows.slice(0, 3), apply: true, fileName: 'itens.xlsx' }));
    const a = await ata();
    expect(a.items).toHaveLength(2);
    [item1, item2] = a.items.map((i: { id: string }) => i.id);
    manager = a.agencies.find((g: { kind: string }) => g.kind === 'gerenciador').id;
    saude = a.agencies.find((g: { kind: string }) => g.kind === 'participante').id;
    const i1 = a.items[0];
    expect(i1.byAgency.find((b: { agencyId: string }) => b.agencyId === saude).quota).toBe(30_000);
    expect(i1.byAgency.find((b: { agencyId: string }) => b.agencyId === manager).quota).toBe(70_000);
    ok(await carlos.patch(`/arps/${arpId}`, { status: 'vigente', rowVersion: a.rowVersion }));
  });

  it('importação não altera silenciosamente preço oficial nem inclui item com a ata vigente', async () => {
    const r = ok(await carlos.post(`/arps/${arpId}/import`, { rows: [{ lot: '1', itemNumber: '1', description: 'Link dedicado 100 Mbps', unit: 'mês', registeredQty: '100', unitPrice: '900,00', specification: 'Fibra' }, { lot: '1', itemNumber: '9', description: 'Novo', unit: 'un', registeredQty: '1', unitPrice: '1' }], apply: true })).json();
    expect(r.report.blocked.map((b: { item: string }) => b.item)).toEqual(['1/1', '1/9']);
    expect((await itemOf(item1)).unitCents).toBe(100_000);
  });
});

describe('oportunidades, reserva e consumo', () => {
  let oppId: string;
  it('reserva não é consumo; oportunidade de ata não gera negócio no Sucesso do Cliente', async () => {
    oppId = ok(await carlos.post(`/arps/${arpId}/opportunities`, { agencyId: manager, lines: [{ itemId: item1, qtyMilli: 10_000 }] }), 201).json().id;
    const i = await itemOf(item1);
    expect(i).toMatchObject({ reservedMilli: 10_000, contractedMilli: 0, availableMilli: 90_000 });
    const opp = ok(await carlos.get(`/opportunities/${oppId}`)).json();
    ok(await carlos.post(`/opportunities/${oppId}/transition`, { toStage: 'ganha', confirm: true, rowVersion: opp.rowVersion }));
    expect(await itemOf(item1)).toMatchObject({ reservedMilli: 10_000, contractedMilli: 0 }); // ganho não consome
    const cs = await ctx.db.execute(sql`select count(*)::int n from opportunities o join pipelines p on p.id = o.pipeline_id where o.contact_id = (select contact_id from opportunities where id = ${oppId}) and p.key = 'sucesso_cliente'`);
    expect((cs.rows[0] as { n: number }).n).toBe(0);
    const tasks = await ctx.db.execute(sql`select title from activities where opportunity_id = ${oppId}`);
    expect(JSON.stringify(tasks.rows)).toContain('Formalizar contratação da ata');
  });

  it('formalização exige documento; consumo atualiza saldo; repetir não duplica; sem permissão não efetiva', async () => {
    ok(await carlos.post(`/arps/${arpId}/formalize`, { opportunityId: oppId, documentId: await doc(carlos, 'outro') }), 422);
    const empenho = await doc(carlos, 'empenho', 'Empenho 123.pdf');
    ok(await lucas.post(`/arps/${arpId}/formalize`, { opportunityId: oppId, documentId: empenho }), 403);
    expect(ok(await carlos.post(`/arps/${arpId}/formalize`, { opportunityId: oppId, documentId: empenho })).json()).toMatchObject({ duplicate: false, consumed: 1 });
    expect(ok(await carlos.post(`/arps/${arpId}/formalize`, { opportunityId: oppId, documentId: empenho })).json()).toMatchObject({ duplicate: true });
    expect(await itemOf(item1)).toMatchObject({ reservedMilli: 0, contractedMilli: 10_000, availableMilli: 90_000, contractedValueCents: 1_000_000 });
  });

  it('contrato decorrente fica vinculado à ata e a validação não passa para o Sucesso do Cliente', async () => {
    const c = ok(await carlos.post('/contracts', { opportunityId: oppId, billingType: 'recorrente', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: 'CT-ATA-1', object: 'Link pela ata', signedAt: '2026-02-01', startAt: '2026-02-01', termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link dedicado 100 Mbps', qty: 10, unitCents: 100_000 }], publicTerms: { agency: 'Secretaria de Administração Fictícia', processNumber: '123/2026', modality: 'Adesão à ARP', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json();
    const [row] = (await ctx.db.execute(sql`select arp_id from contracts where id = ${c.id}`)).rows as { arp_id: string }[];
    expect(row!.arp_id).toBe(arpId);
    ok(await carlos.post(`/contracts/${c.id}/validate`));
    const [o] = (await ctx.db.execute(sql`select handoff_stage from opportunities where id = ${oppId}`)).rows as { handoff_stage: string | null }[];
    expect(o!.handoff_stage).toBeNull();
  });

  it('oportunidades simultâneas não consomem o mesmo saldo', async () => {
    const tries = await Promise.all([1, 2, 3].map(() => carlos.post(`/arps/${arpId}/opportunities`, { agencyId: manager, lines: [{ itemId: item2, qtyMilli: 2_000 }] })));
    const codes = tries.map((t) => t.statusCode).sort();
    expect(codes).toEqual([201, 201, 422]);
    expect(await itemOf(item2)).toMatchObject({ reservedMilli: 4_000, availableMilli: 1_000 });
  });
});

describe('estorno e operações', () => {
  it('correção estorna sem apagar o histórico; quem pede não aprova; sem documento não efetiva', async () => {
    const [consumo] = (await ctx.db.execute(sql`select id from arp_ledger where arp_id = ${arpId} and kind = 'consumo' limit 1`)).rows as { id: string }[];
    const before = await ledgerCount();
    const op = ok(await carlos.post(`/arps/${arpId}/operations`, { input: { kind: 'correcao', correctsEntryId: consumo!.id, correctedQtyMilli: 4_000 }, justification: 'Empenho emitido com quantidade menor.' }), 201).json();
    ok(await carlos.post(`/arp-operations/${op.id}/decide`, { approve: true }), 403);
    ok(await ana.post(`/arp-operations/${op.id}/decide`, { approve: true }), 403); // supervisão não efetiva
    ok(await mariana.post(`/arp-operations/${op.id}/decide`, { approve: true }));
    ok(await mariana.post(`/arp-operations/${op.id}/effect`, {}), 422);
    ok(await mariana.post(`/arp-operations/${op.id}/effect`, { documentId: await doc(mariana, 'outro', 'Ofício de correção.pdf') }));
    expect(await ledgerCount()).toBe(before + 2);
    const rows = (await ctx.db.execute(sql`select kind, qty_milli, reverses_id from arp_ledger where arp_id = ${arpId} and item_id = ${item1} order by occurred_at`)).rows as { kind: string; qty_milli: number; reverses_id: string | null }[];
    expect(rows.map((r) => r.kind)).toEqual(['reserva', 'liberacao', 'consumo', 'estorno', 'consumo']);
    expect(rows[3]!.reverses_id).toBe(consumo!.id);
    expect(await itemOf(item1)).toMatchObject({ contractedMilli: 4_000 });
    await expect(ctx.db.execute(sql`update arp_ledger set qty_milli = 1 where id = ${consumo!.id}`)).rejects.toThrow(/append-only/);
  });

  it('conversão simulada não altera saldo; efetivada exige autorização e admissibilidade', async () => {
    const before = await ata();
    const input = { kind: 'conversao', sources: [{ itemId: item1, agencyId: manager, qtyMilli: 4_000 }], targets: [{ itemId: item2, agencyId: manager, qtyMilli: 1_000 }] };
    const sim = ok(await carlos.post(`/arps/${arpId}/operations/simulate`, input)).json();
    expect(sim.ok).toBe(true);
    expect(sim.warnings.join(' ')).toContain('não prevê conversão');
    expect((await ata()).items).toEqual(before.items);
    const bad = ok(await carlos.post(`/arps/${arpId}/operations/simulate`, { ...input, targets: [{ itemId: item2, agencyId: manager, qtyMilli: 5_000 }] })).json();
    expect(bad.errors.join(' ')).toMatch(/não pode aumentar o valor|insuficiente/);
    ok(await carlos.post(`/arps/${arpId}/operations`, { input: { ...input, targets: [{ itemId: item2, agencyId: manager, qtyMilli: 5_000 }] }, justification: 'Tentativa inadmissível de conversão.' }), 422);
    const op = ok(await carlos.post(`/arps/${arpId}/operations`, { input, justification: 'Troca de links por roteadores autorizada.' }), 201).json();
    ok(await mariana.post(`/arp-operations/${op.id}/effect`, { documentId: await doc(mariana, 'autorizacao_gerenciador') }), 422); // sem aprovação
    ok(await mariana.post(`/arp-operations/${op.id}/decide`, { approve: true }));
    const auth = await doc(mariana, 'autorizacao_gerenciador', 'Autorização conversão.pdf');
    ok(await carlos.post(`/arp-operations/${op.id}/effect`, { documentId: auth }), 422); // regra não prevê conversão: exige exceção
    ok(await carlos.post(`/arp-operations/${op.id}/effect`, { documentId: auth, exception: { basis: 'Parecer jurídico fictício admitindo a conversão.', documentId: await doc(carlos, 'parecer_juridico') } }), 403); // não é Jurídico
    ok(await mariana.post(`/arp-operations/${op.id}/effect`, { documentId: auth, exception: { basis: 'Parecer jurídico fictício admitindo a conversão.', documentId: await doc(mariana, 'parecer_juridico') } }));
    const i2 = await itemOf(item2);
    expect(i2.registeredMilli).toBe(6_000);
  });

  it('remanejamento registra origem e destino', async () => {
    const op = ok(await carlos.post(`/arps/${arpId}/operations`, { input: { kind: 'remanejamento', sources: [{ itemId: item1, agencyId: saude, qtyMilli: 5_000 }], targets: [{ itemId: item1, agencyId: manager, qtyMilli: 5_000 }] }, justification: 'Saúde cedeu parte da cota ao gerenciador.' }), 201).json();
    ok(await mariana.post(`/arp-operations/${op.id}/decide`, { approve: true }));
    ok(await mariana.post(`/arp-operations/${op.id}/effect`, { documentId: await doc(mariana, 'autorizacao_gerenciador') }));
    const rows = (await ctx.db.execute(sql`select agency_id, dir from arp_ledger where operation_id = ${op.id} order by dir`)).rows as { agency_id: string; dir: string }[];
    expect(rows).toEqual([{ agency_id: manager, dir: 'entrada' }, { agency_id: saude, dir: 'saida' }]);
  });
});

describe('adesões, limites e regras versionadas', () => {
  it('adesão respeita 50% por órgão; exceção só com Jurídico; regra nova não reescreve decisão antiga', async () => {
    const big = ok(await carlos.post(`/arps/${arpId}/adhesions`, { newAgency: { name: 'Prefeitura Fictícia de Teste' }, requestedAt: '2026-03-01', justification: 'Necessidade de conectividade nas escolas.', items: [{ itemId: item1, qtyMilli: 60_000 }] }), 201).json();
    expect(big.check.ok).toBe(false);
    ok(await carlos.post(`/arp-adhesions/${big.id}/supplier-accept`, { documentId: await doc(carlos, 'aceite_fornecedor') }));
    const auth = await doc(carlos, 'autorizacao_gerenciador');
    expect(ok(await carlos.post(`/arp-adhesions/${big.id}/authorize`, { managerAuthorizationRef: 'Ofício 10/2026', documentId: auth }), 422).json().detail).toContain('limite por órgão');
    ok(await carlos.post(`/arp-adhesions/${big.id}/authorize`, { managerAuthorizationRef: 'Ofício 10/2026', documentId: auth, exception: { basis: 'Fundamento fictício para teste de exceção.', documentId: await doc(carlos, 'parecer_juridico') } }), 403);
    ok(await carlos.post(`/arp-adhesions/${big.id}/status`, { status: 'recusada', note: 'Fora do limite legal.' }));

    const small = ok(await carlos.post(`/arps/${arpId}/adhesions`, { newAgency: { name: 'Câmara Fictícia' }, requestedAt: '2026-03-02', justification: 'Conectividade da sede administrativa.', items: [{ itemId: item1, qtyMilli: 20_000 }] }), 201).json();
    expect(small.check.ok).toBe(true);
    ok(await carlos.post(`/arp-adhesions/${small.id}/supplier-accept`, {}));
    const r = ok(await carlos.post(`/arp-adhesions/${small.id}/authorize`, { managerAuthorizationRef: 'Ofício 11/2026', documentId: auth })).json();
    expect(r.deadlineAt).toBeTruthy();
    const i = await itemOf(item1);
    expect(i.adhesionAuthorizedMilli).toBe(20_000);
    expect(i.registeredMilli).toBe(96_000); // participantes: 100 − 4 convertidos; adesão não entra na cota deles

    // nova versão da regra (mais restritiva): decisão anterior mantém a versão e o limite da época
    ok(await carlos.post('/arp-rules', { regime: 'federal', rules: { adhesionPerAgencyBp: 6000, adhesionTotalBp: 20000, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Teste' }, note: 'Tentativa acima do teto' }), 422);
    ok(await carlos.post('/arp-rules', { regime: 'federal', rules: { adhesionPerAgencyBp: 1000, adhesionTotalBp: 10000, contractDeadlineDays: 60, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Regulamento fictício mais restritivo.' }, note: 'Regulamento local mais restritivo.' }), 201);
    const [adh] = (await ctx.db.execute(sql`select rule_version, limits_snapshot->'rules'->>'adhesionPerAgencyBp' as per from arp_adhesions where id = ${small.id}`)).rows as { rule_version: number; per: string }[];
    expect(adh).toEqual({ rule_version: 0, per: '5000' });
    const [led] = (await ctx.db.execute(sql`select rule_version from arp_ledger where adhesion_id = ${small.id}`)).rows as { rule_version: number }[];
    expect(led!.rule_version).toBe(0);
  });

  it('órgão não participante contrata só com adesão autorizada, dentro da própria cota', async () => {
    const a = await ata();
    const camara = a.agencies.find((g: { name: string }) => g.name === 'Câmara Fictícia').id;
    const pref = a.agencies.find((g: { name: string }) => g.name === 'Prefeitura Fictícia de Teste').id;
    ok(await carlos.post(`/arps/${arpId}/opportunities`, { agencyId: pref, lines: [{ itemId: item1, qtyMilli: 1_000 }] }), 422);
    ok(await carlos.post(`/arps/${arpId}/opportunities`, { agencyId: camara, lines: [{ itemId: item1, qtyMilli: 21_000 }] }), 422);
    ok(await carlos.post(`/arps/${arpId}/opportunities`, { agencyId: camara, lines: [{ itemId: item1, qtyMilli: 20_000 }] }), 201);
  });
});

describe('relatórios e permissões', () => {
  it('relatórios conciliam com o livro de movimentações', async () => {
    const rep = ok(await carlos.get(`/arp-reports?type=consumo_item&arpId=${arpId}`)).json();
    const [l] = (await ctx.db.execute(sql`select coalesce(sum(case when kind = 'consumo' then amount_cents when kind = 'estorno' then -amount_cents else 0 end), 0)::bigint v from arp_ledger where arp_id = ${arpId}`)).rows as { v: string }[];
    expect(rep.totals.valor_contratado).toBe(Number(l!.v));
    const mov = ok(await carlos.get(`/arp-reports?type=movimentacoes&arpId=${arpId}`)).json();
    expect(mov.rows).toHaveLength(await ledgerCount());
    const csv = await carlos.get(`/arp-reports?type=saldo&arpId=${arpId}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Valor disponível');
    const dash = ok(await carlos.get('/arps/dashboard')).json();
    expect(dash.values.contracted).toBeGreaterThan(0);
    expect(dash.note).toContain('não são receita');
  });

  it('usuários sem permissão não criam nem efetivam', async () => {
    ok(await lucas.post('/arps', { number: 'X-1', object: 'Teste sem permissão', supplierName: 'Fornecedor', managerName: 'Órgão' }), 403);
    ok(await lucas.post(`/arps/${arpId}/ledger/execution`, { kind: 'execucao', itemId: item1, agencyId: manager, qtyMilli: 1, justification: 'Execução de teste', requestId: 'r1' }), 403);
    ok(await ana.post('/arp-rules', { regime: 'municipal', rules: { adhesionPerAgencyBp: 1000, adhesionTotalBp: 1000, contractDeadlineDays: 30, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'x x x x x' }, note: 'teste de permissão' }), 403);
  });
});

describe('ata a partir da oportunidade', () => {
  const newOpp = async (c: Client, name: string) => ok(await c.post('/opportunities', { newContact: { name, segment: 'governamental' }, reasons: ['oferta'], channel: 'Licitação' }), 201).json().id as string;

  it('vendedor atrela a oportunidade à cota do órgão, refaz a reserva e desatrela', async () => {
    const opp = await newOpp(lucas, 'Órgão Fictício Vendedor');
    const atas = ok(await lucas.get(`/opportunities/${opp}/arp/options`)).json().atas;
    expect(atas.map((a: { id: string }) => a.id)).toContain(arpId);
    const opt = ok(await lucas.get(`/opportunities/${opp}/arp/options?arpId=${arpId}`)).json();
    expect(opt.agencies.find((g: { id: string }) => g.id === manager).mode).toBe('cota');
    const before = (await itemOf(item2)).reservedMilli;
    ok(await lucas.post(`/opportunities/${opp}/arp/reserve`, { arpId, agencyId: manager, lines: [{ itemId: item2, qtyMilli: 2_000 }] }));
    ok(await lucas.post(`/opportunities/${opp}/arp/reserve`, { arpId, agencyId: manager, lines: [{ itemId: item2, qtyMilli: 1_000 }] }));
    expect((await itemOf(item2)).reservedMilli).toBe(before + 1_000);
    const linked = ok(await lucas.get(`/opportunities/${opp}/arp`)).json().linked;
    expect(linked.arp.id).toBe(arpId);
    expect(linked.lines.filter((l: { status: string }) => l.status === 'reservada')).toHaveLength(1);
    ok(await lucas.post(`/opportunities/${opp}/arp/unlink`, { reason: 'Órgão desistiu da compra.' }));
    expect((await itemOf(item2)).reservedMilli).toBe(before);
    expect(ok(await lucas.get(`/opportunities/${opp}/arp`)).json().linked).toBeNull();
  });

  it('consumo do que já foi aderido respeita a cota da adesão; órgão sem adesão autorizada não reserva', async () => {
    const opp = await newOpp(lucas, 'Câmara Fictícia (venda)');
    const a = await ata();
    const camara = a.agencies.find((g: { name: string }) => g.name === 'Câmara Fictícia').id;
    const pref = a.agencies.find((g: { name: string }) => g.name === 'Prefeitura Fictícia de Teste').id;
    const opt = ok(await lucas.get(`/opportunities/${opp}/arp/options?arpId=${arpId}`)).json();
    expect(opt.agencies.find((g: { id: string }) => g.id === camara).mode).toBe('adesao_autorizada');
    expect(opt.agencies.find((g: { id: string }) => g.id === pref).mode).toBe('sem_adesao');
    expect(ok(await lucas.post(`/opportunities/${opp}/arp/reserve`, { arpId, agencyId: pref, lines: [{ itemId: item1, qtyMilli: 1_000 }] }), 422).json().detail).toContain('adesão autorizada');
    expect(ok(await lucas.post(`/opportunities/${opp}/arp/reserve`, { arpId, agencyId: camara, lines: [{ itemId: item1, qtyMilli: 1_000 }] }), 422).json().detail).toContain('Saldo insuficiente');
  });

  it('nova adesão pedida pela oportunidade: ao ser autorizada, a quantidade já fica reservada para ela', async () => {
    const opp = await newOpp(lucas, 'Instituto Fictício de Pesquisa');
    const r = ok(await lucas.post(`/opportunities/${opp}/arp/adhesion`, { arpId, newAgency: { name: 'Instituto Fictício de Pesquisa' }, requestedAt: '2026-04-01', justification: 'Conectividade dos laboratórios do instituto.', items: [{ itemId: item1, qtyMilli: 5_000 }] }), 201).json();
    expect(r.check.ok).toBe(true);
    let cur = ok(await lucas.get(`/opportunities/${opp}/arp`)).json();
    expect(cur.linked.arp.id).toBe(arpId);
    expect(cur.linked.lines).toHaveLength(0);
    expect(cur.adhesions[0]).toMatchObject({ status: 'solicitada', agencyName: 'Instituto Fictício de Pesquisa' });
    ok(await carlos.post(`/arp-adhesions/${r.id}/supplier-accept`, {}));
    ok(await carlos.post(`/arp-adhesions/${r.id}/authorize`, { managerAuthorizationRef: 'Ofício 20/2026', documentId: await doc(carlos, 'autorizacao_gerenciador') }));
    cur = ok(await lucas.get(`/opportunities/${opp}/arp`)).json();
    expect(cur.linked.lines).toEqual([expect.objectContaining({ status: 'reservada', qtyMilli: 5_000, agencyName: 'Instituto Fictício de Pesquisa' })]);
    const ev = await ctx.db.execute(sql`select type from opportunity_events where opportunity_id = ${opp} order by occurred_at`);
    expect(ev.rows.map((x) => (x as { type: string }).type)).toEqual(expect.arrayContaining(['ata_adesao_pedida', 'ata_adesao_autorizada']));
  });
});
