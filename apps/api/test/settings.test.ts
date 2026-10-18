/** Configurações ponta a ponta, com os mesmos corpos que as telas enviam. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
});
afterAll(async () => ctx.close());

const ok = (r: { statusCode: number; body: string }, code = 200) => { if (r.statusCode !== code) throw new Error(`${r.statusCode}: ${r.body.slice(0, 600)}`); };

describe('telas de configuração (gerência)', () => {
  it('todas as leituras respondem', async () => {
    for (const u of ['/admin/overview', '/admin/journeys', '/admin/automation-runs', '/admin/area', '/admin/viability', '/admin/instructions', '/admin/smtp', '/admin/notifications', '/admin/emails', '/admin/plans', '/admin/sources', '/admin/users', '/admin/security', '/admin/branding', '/admin/logs', '/meta/area', '/meta/viability', '/meta/playbook', '/meta/lookups'])
      ok(await carlos.get(u));
    expect((await lucas.get('/admin/viability')).statusCode).toBe(403);
  });

  it('jornada: criar, geral, etapas, campos e automação', async () => {
    const created = await carlos.post('/admin/journeys', { name: 'Upgrade E2E', description: null, segments: [], copyFromId: null });
    ok(created, 201);
    const id = created.json().id;
    const j = (await carlos.get('/admin/journeys')).json().items.find((x: { id: string }) => x.id === id);
    ok(await carlos.patch(`/admin/journeys/${id}`, { name: 'Upgrade E2E', description: 'teste', segments: [], memberIds: [lucas.me.user.id] }));
    const stages = j.stages.map((s: { key: string; name: string; kind: string; color: string | null; requirements: Record<string, boolean> }) => ({ key: s.key, name: s.name, kind: s.kind, color: s.color, requirements: { proposta: !!s.requirements.proposta, plano: !!s.requirements.plano, proximaAcao: !!s.requirements.proximaAcao, respostasObrigatorias: !!s.requirements.respostasObrigatorias } }));
    stages.splice(1, 0, { name: 'Visita técnica', kind: 'open', color: '#123456', requirements: { proposta: false, plano: false, proximaAcao: true, respostasObrigatorias: false } });
    ok(await carlos.put(`/admin/journeys/${id}/stages`, { stages }));
    ok(await carlos.put(`/admin/journeys/${id}/fields`, { fields: [{ rotulo: 'CNPJ', tipo: 'texto', obrigatorio: false, opcoes: [] }, { rotulo: 'Turno', tipo: 'lista', obrigatorio: true, opcoes: ['Manhã', 'Tarde'] }] }));
    const target = (await carlos.get('/admin/journeys')).json().items.find((x: { key: string }) => x.key === 'recuperacao');
    const auto = await carlos.post(`/admin/journeys/${id}/automations`, { nome: 'Perdeu → Recuperação', ativo: true, gatilho: { tipo: 'perdida', etapa: null, dias: null }, acoes: [{ tipo: 'duplicar', jornada: target.key, etapa: null, responsavel: 'mesmo' }, { tipo: 'criar_tarefa', titulo: 'Ligar', tipoAtividade: 'ligacao', prazoDias: 2, responsavel: lucas.me.user.id }] });
    ok(auto, 201);
    const after = (await carlos.get('/admin/journeys')).json().items.find((x: { id: string }) => x.id === id);
    expect(after.stages.map((s: { name: string }) => s.name)).toContain('Visita técnica');
    expect(after.fields).toHaveLength(2);
    expect(after.members.map((m: { userId: string }) => m.userId)).toEqual([lucas.me.user.id]);
    const a = after.automations[0];
    ok(await carlos.put(`/admin/automations/${a.id}`, { nome: a.nome, ativo: false, gatilho: a.gatilho, acoes: a.acoes }));
    // e a jornada aparece no lookup do vendedor membro
    const look = (await lucas.get('/meta/lookups')).json();
    expect(look.pipelines.find((p: { id: string }) => p.id === id).allowed).toBe(true);
  });

  it('área: região e condomínio', async () => {
    const r = await carlos.post('/admin/regions', { name: 'Região E2E' });
    ok(r, 201);
    ok(await carlos.patch(`/admin/regions/${r.json().id}`, { name: 'Região E2E 2' }));
    const c = await carlos.post('/admin/condominiums', { regionId: r.json().id, name: 'Cond E2E', cep: '49000-000', street: 'Rua A', number: '1', district: null, city: 'Aracaju', blocks: ['A', 'B'], units: 40, hasNetwork: true, notes: null, active: true });
    ok(c, 201);
    ok(await carlos.patch(`/admin/condominiums/${c.json().id}`, { regionId: r.json().id, name: 'Cond E2E', cep: '', street: null, number: null, district: null, city: null, blocks: [], units: null, hasNetwork: false, notes: null, active: false }));
  });

  it('viabilidade: salva cada lista com o que a tela envia e a configuração geral', async () => {
    const v = (await carlos.get('/admin/viability')).json();
    ok(await carlos.put('/admin/viability/taxes', { items: [...v.taxes.map(({ id, name, kind, percentBp, amountCents, routeIds, notes }: Record<string, unknown>) => ({ id, name, kind, percentBp, amountCents, routeIds, notes })), { name: 'ISS E2E', kind: 'percent', percentBp: 200, amountCents: 0, routeIds: [], notes: null }] }));
    ok(await carlos.put('/admin/viability/partners', { items: v.partners.map(({ id, name, kind, percentBp, amountCents, routeIds, notes }: Record<string, unknown>) => ({ id, name, kind, percentBp, amountCents, routeIds, notes })) }));
    ok(await carlos.put('/admin/viability/equipments', { items: [...v.equipments.map(({ id, name, costCents }: Record<string, unknown>) => ({ id, name, costCents })), { name: 'Mesh E2E', costCents: 25000 }] }));
    ok(await carlos.put('/admin/viability/routes', { items: v.routes.map(({ id, name, description, cablePerMeterCents, installCostCents, monthlyCostCents, requiresApproval, kit }: Record<string, unknown>) => ({ id, name, description, cablePerMeterCents, installCostCents, monthlyCostCents, requiresApproval, kit })) }));
    ok(await carlos.put('/admin/viability/rules', { items: v.rules.map(({ id, name, minMeters, maxMeters, minMbps, maxMbps, routeId }: Record<string, unknown>) => ({ id, name, minMeters, maxMeters, minMbps, maxMbps, routeId })) }));
    ok(await carlos.put('/admin/viability/commissions', { items: v.commissions.map(({ id, name, saleType, minPriceCents, maxPriceCents, kind, percentBp, multiplierX100, amountCents }: Record<string, unknown>) => ({ id, name, saleType, minPriceCents, maxPriceCents, kind, percentBp, multiplierX100, amountCents })) }));
    ok(await carlos.put('/admin/viability/settings', v.settings));
    const sim = await carlos.post('/viability/simulate', { planId: (await carlos.get('/meta/lookups')).json().plans[0].id, saleType: 'ativa', cableMeters: 80, activationFeeCents: 5000 });
    ok(sim);
    expect(sim.json().cacCents).toBeGreaterThanOrEqual(0);
  });

  it('modelo de instrução: exportar, enviar, prévia, ativar e descartar', async () => {
    const exp = await carlos.get('/admin/instructions/export');
    ok(exp);
    const content = JSON.parse(exp.body);
    content.objecoes = [...content.objecoes, { id: 'teste_e2e', titulo: 'Está caro', resposta: 'Compare o custo por Mbps.', jornadas: [] }].slice(0, 50);
    const up = await carlos.post('/admin/instructions', { content, notes: 'teste' });
    ok(up, 201);
    ok(await carlos.post(`/admin/instructions/${up.json().id}/activate`));
    const again = await carlos.post('/admin/instructions', { content: JSON.parse(exp.body), notes: null });
    ok(again, 201);
    ok(await carlos.del(`/admin/instructions/${again.json().id}`), 204);
    expect((await carlos.post('/admin/instructions', { content: { versao: 1 } })).statusCode).toBe(422);
  });

  it('e-mail: SMTP sem devolver senha, alertas e registro', async () => {
    ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'segredo', fromName: 'Yepnet Vendas', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
    const g = (await carlos.get('/admin/smtp')).json();
    expect(g.hasPassword).toBe(true);
    expect(JSON.stringify(g)).not.toContain('segredo');
    ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet Vendas', fromEmail: 'vendas@yepnet.test', replyTo: '', enabled: false }));
    expect((await carlos.get('/admin/smtp')).json().hasPassword).toBe(true);
    ok(await carlos.put('/admin/notifications', { activityDigest: true, leadAssigned: false, dealWon: true, userAccess: true }));
    ok(await carlos.get('/admin/emails?page=1&pageSize=25'));
  });

  it('plano com velocidade e canal de entrada', async () => {
    const pl = await carlos.post('/admin/plans', { name: 'Plano E2E', line: null, segment: 'residencial', priceCents: 1, speedMbps: 300, invoiceServiceName: 'SCM - Internet 300M', products: [{ name: 'Internet 300M', qty: 1, unitPriceCents: 7990, commissionAtiva: { kind: 'percent', value: 5000 }, commissionReceptiva: { kind: 'fixo', value: 1000 } }, { name: 'Ponto extra', qty: 2, unitPriceCents: 1000, commissionAtiva: null, commissionReceptiva: null }], active: true });
    ok(pl, 201);
    expect(pl.json().priceCents).toBe(9990);
    const sim = (await carlos.post('/viability/simulate', { planId: pl.json().id, saleType: 'receptiva', cableMeters: 50 })).json();
    expect(sim.commission.cents).toBe(1000);
    expect(sim.commission.rule).toBe('Produtos do plano');
    ok(await carlos.post('/admin/sources', { name: 'Instagram E2E' }), 201);
  });
});

describe('autonomia da operação e engenharia', () => {
  it('acima do limite não fecha sem viabilidade aprovada; com aprovação fecha', async () => {
    ok(await carlos.put('/admin/viability/settings', { ...(await carlos.get('/admin/viability')).json().settings, autonomyMaxMeters: 100, autonomyMaxMbps: 500 }));
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const created = await lucas.post('/opportunities', { newContact: { name: 'Cliente Engenharia Fictício', segment: 'residencial' }, planId: plan.id, saleType: 'ativa', cableMeters: 250, installStreet: 'Rua Fictícia' });
    ok(created, 201);
    const o = created.json();
    expect(o.viability.engineering.required).toBe(true);
    expect(o.viability.route.name).toBe('Rua');
    const blocked = await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: o.rowVersion });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().detail).toContain('engenharia');
    const upd = await lucas.patch(`/opportunities/${o.id}`, { engineeringStatus: 'aprovada', engineeringTicket: 'ENG-1', rowVersion: o.rowVersion });
    ok(upd);
    ok(await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: upd.json().rowVersion }));
    const small = (await lucas.post('/opportunities', { newContact: { name: 'Cliente Curto Fictício', segment: 'residencial' }, planId: plan.id, cableMeters: 60, condominiumId: (await lucas.get('/meta/area')).json().condominiums[0].id })).json();
    expect(small.viability.engineering.required).toBe(false);
    expect(small.viability.route.name).toBe('Condomínio');
  });
});
