/** Contratos fase 5: SLA contratado × realizado, ocorrências e penalidades, fiscal/gestor, cláusulas e atestados. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => ctx.close());

describe('execução do contrato', () => {
  it('SLA, ocorrência com penalidade, fiscal, cláusula com prazo e atestado, com reflexo na central de atenção', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Prefeitura Execução Fictícia', segment: 'governamental' }, planId: plan.id }), 201).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: lucas.me.user.id, version: { number: 'EX-1', object: 'Link', signedAt: addDays(today, -200), startAt: addDays(today, -195), termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }], publicTerms: { agency: 'Prefeitura', processNumber: '3/2026', modality: 'pregao', commitmentNote: null, budgetLine: null, extensionMaxMonths: 120 } } }), 201).json().id;
    ok(await carlos.post(`/contracts/${id}/validate`));

    // SLA: só a gestão cadastra; quem cuida do contrato mede
    expect((await lucas.post(`/contracts/${id}/slas`, { metric: 'disponibilidade', target: 99.5 })).statusCode).toBe(403);
    const sla = ok(await carlos.post(`/contracts/${id}/slas`, { metric: 'disponibilidade', target: 99.5, penaltyNote: '1% da fatura por 0,1 p.p.' }), 201).json().id;
    const month = today.slice(0, 7);
    expect(ok(await lucas.post(`/contracts/${id}/slas/${sla}/measurements`, { period: month, value: 99.1 }), 201).json().status).toBe('violado');
    // ocorrência com multa exige valor; atualização muda a situação
    expect((await lucas.post(`/contracts/${id}/occurrences`, { kind: 'multa', occurredOn: today, title: 'Multa por indisponibilidade' })).statusCode).toBe(422);
    const occ = ok(await lucas.post(`/contracts/${id}/occurrences`, { kind: 'multa', occurredOn: today, title: 'Multa por indisponibilidade', amountCents: 50_000, responseDueAt: addDays(today, 2), reference: 'Ofício 12/2026' }), 201).json().id;
    // fiscal e gestor; substituir guarda o anterior
    ok(await lucas.post(`/contracts/${id}/parties`, { role: 'fiscal_tecnico', name: 'Fiscal Fictício Um', email: 'fiscal1@exemplo.test', appointment: 'Portaria 10/2026' }), 201);
    ok(await lucas.post(`/contracts/${id}/parties`, { role: 'fiscal_tecnico', name: 'Fiscal Fictício Dois' }), 201);
    // cláusula com prazo dentro do aviso
    ok(await carlos.post(`/contracts/${id}/clauses`, { kind: 'obrigacao', reference: 'Cláusula 7.2', title: 'Relatório mensal de disponibilidade', deadline: addDays(today, 5), remindDays: 10 }), 201);

    let ex = ok(await carlos.get(`/contracts/${id}/execution`)).json();
    expect(ex.slas[0]).toMatchObject({ target: 99.5, unit: '%', direction: 'maior', last: { status: 'violado' } });
    expect(ex.occurrences[0]).toMatchObject({ status: 'aberta', amountCents: 50_000, open: true });
    expect(ex.summary).toMatchObject({ penaltiesCents: 50_000, openOccurrences: 1, slaViolations: 1 });
    expect(ex.parties.current.find((p: { role: string }) => p.role === 'fiscal_tecnico')).toMatchObject({ person: { name: 'Fiscal Fictício Dois' }, history: 1 });
    expect(ex.certificateDue).toMatchObject({ stage: 'meio', requested: false });

    // linha do tempo única: assuntos, críticos em destaque e próximos prazos
    const tl0 = ok(await lucas.get(`/contracts/${id}/timeline`)).json();
    const crit = tl0.items.filter((x: { critical: boolean }) => x.critical).map((x: { title: string }) => x.title).join(' | ');
    expect(crit).toMatch(/VIOLADO/);
    expect(crit).toMatch(/Multa por indisponibilidade/);
    expect(tl0.items.find((x: { title: string }) => /Fiscal Fictício Dois/.test(x.title))).toMatchObject({ category: 'execucao', critical: false });
    expect(tl0.counts.execucao).toBeGreaterThanOrEqual(5);
    expect(tl0.counts.contrato).toBeGreaterThan(0);
    expect(tl0.upcoming.map((u: { kind: string }) => u.kind)).toEqual(expect.arrayContaining(['ocorrencia', 'clausula']));
    expect(tl0.upcoming.find((u: { kind: string }) => u.kind === 'ocorrencia')).toMatchObject({ days: 2, title: 'Responder ocorrência: Multa por indisponibilidade' });
    expect(tl0.upcoming.some((u: { kind: string }) => u.kind === 'termino')).toBe(false); // termina daqui a ~5 meses, fora do horizonte

    // central de atenção mostra a execução
    const att = ok(await carlos.get('/contracts/attention')).json().items.filter((x: { contractId: string; source: string }) => x.contractId === id && x.source === 'execucao').map((x: { kind: string }) => x.kind).sort();
    expect(att).toEqual(['atestado', 'clausula', 'ocorrencia', 'sla_violado']);

    // defesa revertida: penalidade sai da soma; atestado recebido com arquivo
    ok(await lucas.post(`/contracts/${id}/occurrences/${occ}/updates`, { status: 'revertida', note: 'Defesa aceita pelo órgão' }), 201);
    expect((await lucas.post(`/contracts/${id}/certificates`, { status: 'recebido', issuer: 'Prefeitura' })).statusCode).toBe(422);
    const cert = ok(await lucas.post(`/contracts/${id}/certificates`, { status: 'recebido', issuer: 'Prefeitura Execução Fictícia', issuedOn: today, services: 'Link dedicado 1 Gbps com SLA 99,5%', filename: 'atestado.pdf', data: PDF }), 201).json().id;
    ex = ok(await carlos.get(`/contracts/${id}/execution`)).json();
    expect(ex.summary.penaltiesCents).toBe(0);
    expect(ex.certificateDue).toBeNull();
    const lib = ok(await carlos.get('/contracts/certificates?q=1 Gbps')).json().items;
    expect(lib.map((x: { id: string }) => x.id)).toContain(cert);
    const dl = await carlos.get(`/contracts/certificates/${cert}/download`);
    expect(dl.statusCode).toBe(200);
    const tl = ok(await carlos.get(`/contracts/${id}/timeline`)).json();
    expect(JSON.stringify(tl)).toMatch(/Atestado de capacidade técnica: Recebido/);
    expect(tl.upcoming.some((u: { kind: string }) => u.kind === 'ocorrencia')).toBe(false); // revertida não pede mais resposta
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/contracts/${id}/timeline` })).statusCode).toBe(401);
  });
});
