/** Licitações · L3: responsáveis por área, aprovador por decisão, RACI e aprovações (plano, alteração crítica, Go/No-Go, proposta). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]);
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from bid_approval_rules where tenant_id = (select tenant_id from users where email = 'carlos@yepnet.test')`);
  await ctx.db.execute(sql`delete from bid_area_members where tenant_id = (select tenant_id from users where email = 'carlos@yepnet.test')`);
  await ctx.close();
});

describe('RACI e aprovações do projeto de licitação', () => {
  it('áreas, aprovador pela matriz, plano devolvido e aprovado, alteração crítica, Go/No-Go e proposta', async () => {
    // a empresa define as áreas e quem aprova; quem não administra não define
    expect((await lucas.put('/licitacoes/governanca/areas/engenharia', { members: [{ userId: ana.me.user.id, role: 'titular' }] })).statusCode).toBe(403);
    ok(await carlos.put('/licitacoes/governanca/areas/engenharia', { members: [{ userId: ana.me.user.id, role: 'titular' }] }));
    ok(await carlos.put('/licitacoes/governanca/areas/diretoria', { members: [{ userId: carlos.me.user.id, role: 'gestor' }] }));
    expect((await carlos.put('/licitacoes/governanca/areas/juridico', { members: [{ userId: ana.me.user.id, role: 'gestor' }, { userId: lucas.me.user.id, role: 'gestor' }] })).statusCode).toBe(422); // um gestor só
    ok(await carlos.put('/licitacoes/governanca/aprovadores/plano', { approverId: carlos.me.user.id }));

    const lk = ok(await lucas.get('/meta/lookups')).json();
    const pipe = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
    const o = ok(await lucas.post('/opportunities', { newContact: { name: `Órgão RACI ${Date.now().toString(36)}`, segment: 'governamental' }, title: 'PE 40/2026', pipelineId: pipe.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800 } }), 201).json();
    const pid = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0].id;

    // R pela área: macrotarefas da Engenharia vão para a titular
    const at = ok(await lucas.post(`/projects/${pid}/licitacao/atribuir-areas`)).json();
    expect(at.assigned).toBeGreaterThan(0);
    expect(at.missingAreas).toEqual(expect.arrayContaining(['juridico', 'financeiro']));
    let pl = ok(await lucas.get(`/projects/${pid}/licitacao/plano`)).json();
    expect(pl.rows.find((r: { title: string }) => r.title === 'Análise técnica').ownerId).toBe(ana.me.user.id);
    // C e I na matriz
    const tec = pl.rows.find((r: { title: string }) => r.title === 'Análise técnica');
    ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: { consulted: [carlos.me.user.id], informed: [lucas.me.user.id] } }));

    // plano → aprovador da regra; tarefa de aprovação para ele
    const a1 = ok(await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'plano', justification: 'Plano inicial com áreas e prazos' }), 201).json();
    expect(a1).toMatchObject({ approverId: carlos.me.user.id, version: 1, status: 'aguardando' });
    const task = (await ctx.db.execute(sql`select owner_id, completed_at from activities where id = ${a1.taskId}`)).rows[0] as { owner_id: string; completed_at: string | null };
    expect(task.owner_id).toBe(carlos.me.user.id);
    expect((await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'plano', justification: 'de novo' })).statusCode).toBe(422); // já aguardando
    // em aprovação: mudança crítica bloqueada
    expect((await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: {}, shiftDays: 1 })).statusCode).toBe(422);
    // só o aprovador decide
    expect((await ana.post(`/licitacoes/aprovacoes/${a1.id}/decidir`, { status: 'aprovado' })).statusCode).toBe(403);
    expect((await carlos.post(`/licitacoes/aprovacoes/${a1.id}/decidir`, { status: 'devolvido' })).statusCode).toBe(422); // sem motivo
    ok(await carlos.post(`/licitacoes/aprovacoes/${a1.id}/decidir`, { status: 'devolvido', note: 'Inclua o Jurídico nas análises' }));
    expect(ok(await lucas.get(`/projects/${pid}/licitacao/aprovacoes`)).json().planStatus).toBe('devolvido');
    const a2 = ok(await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'plano', justification: 'Ajustado conforme parecer' }), 201).json();
    expect(a2.version).toBe(2);
    ok(await carlos.post(`/licitacoes/aprovacoes/${a2.id}/decidir`, { status: 'aprovado', note: 'Ok' }));
    const done = (await ctx.db.execute(sql`select completed_at from activities where id = ${a2.taskId}`)).rows[0] as { completed_at: string | null };
    expect(done.completed_at).not.toBeNull();
    let ap = ok(await lucas.get(`/projects/${pid}/licitacao/aprovacoes`)).json();
    expect(ap.planStatus).toBe('aprovado');
    expect(ap.items.find((x: { id: string }) => x.id === a2.id).snapshot.rows.length).toBeGreaterThan(30); // versão aprovada congelada

    // alteração crítica depois de aprovado
    ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: {}, shiftDays: 2 }));
    expect(ok(await lucas.get(`/projects/${pid}/licitacao/aprovacoes`)).json().planStatus).toBe('alterado');
    ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: { informed: [] } })); // não crítico
    expect((await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'plano', justification: 'x'.repeat(10) })).statusCode).toBe(422);
    const a3 = ok(await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'alteracao_critica', justification: 'Análise técnica +2 dias' }), 201).json();
    expect(a3.approverId).toBe(carlos.me.user.id); // sem regra própria: gestor da Diretoria
    ok(await carlos.post(`/licitacoes/aprovacoes/${a3.id}/decidir`, { status: 'aprovado' }));
    expect(ok(await lucas.get(`/projects/${pid}/licitacao/aprovacoes`)).json().planStatus).toBe('aprovado');

    // proposta só depois do Go
    expect((await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'proposta', justification: 'Proposta final' })).statusCode).toBe(422);
    expect((await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'go_no_go', justification: 'Pareceres favoráveis' })).statusCode).toBe(422); // sem recomendação
    const g = ok(await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'go_no_go', justification: 'Pareceres favoráveis', recommendation: 'go' }), 201).json();
    expect((await carlos.post(`/licitacoes/aprovacoes/${g.id}/decidir`, { status: 'aprovado', decision: 'go_condicionado' })).statusCode).toBe(422); // condição obrigatória
    ok(await carlos.post(`/licitacoes/aprovacoes/${g.id}/decidir`, { status: 'aprovado', decision: 'go_condicionado', note: 'Desde que a margem fique acima de 18%' }));
    ap = ok(await lucas.get(`/projects/${pid}/licitacao/aprovacoes`)).json();
    expect(ap.goDecision).toBe('go_condicionado');
    ok(await lucas.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'proposta', justification: 'Proposta final' }), 201);
    // quem é o próprio aprovador não pede
    expect((await carlos.post(`/projects/${pid}/licitacao/aprovacoes`, { kind: 'contratacao', justification: 'Assinatura' })).statusCode).toBe(422);
    const card = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0];
    expect(card).toMatchObject({ planStatus: 'aprovado', goDecision: 'go_condicionado', pendingApprovals: [{ kind: 'proposta' }] });
  });
});
