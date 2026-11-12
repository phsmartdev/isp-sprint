/** Licitações · L2: marcos do edital (sem duplicar os campos da oportunidade), prazos para trás com margem, edição em linha e em lote, dependências e pendências do plano. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const shift = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type Row = { id: string; parentId: string | null; title: string; startOn: string | null; dueOn: string | null; ownerId: string; spec: { area: string; required: boolean; deliverable: string | null; acceptance: string | null; anchor?: string | null } | null; dependsOn: string[]; rowVersion: number };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]);
});
afterAll(async () => ctx.close());

describe('planejamento do projeto de licitação', () => {
  it('marcos do edital, prazos pelo edital, edição sem tocar o modelo, dependências e pendências', async () => {
    const lk = ok(await lucas.get('/meta/lookups')).json();
    const pipe = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
    const proposta = shift(30), sessao = shift(31);
    const o = ok(await lucas.post('/opportunities', { newContact: { name: `Órgão Plano ${Date.now().toString(36)}`, segment: 'governamental' }, title: 'PE 30/2026', pipelineId: pipe.id, saleKind: 'licitacao', branchId: lk.branches[0].id,
      custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, prazo_proposta: proposta, data_sessao: sessao } }), 201).json();
    const pid = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0].id;
    let pl = ok(await lucas.get(`/projects/${pid}/licitacao/plano`)).json();
    // datas do CRM entram, sem validação; prazos da proposta já calculados para trás (margem 1 dia)
    expect(pl.officialDates.proposta).toMatchObject({ date: proposta, validated: false, source: 'CRM' });
    const rows: Row[] = pl.rows;
    const prop = rows.find((r) => r.title === 'Proposta e anexos')!;
    expect(prop.spec!.anchor).toBe('proposta');
    expect(prop.dueOn).toBe(shift(30 - 1 - 1));
    expect(pl.issues.some((i: { message: string }) => i.message.includes('Valide a data "Prazo de envio da proposta"'))).toBe(true);

    // quem não coordena nem é dono da oportunidade não planeja
    expect((await ana.put(`/projects/${pid}/licitacao/datas`, { dates: {} })).statusCode).toBeGreaterThanOrEqual(403);
    // sessão adiada: grava na oportunidade (sem campo duplicado) e valida; recálculo só com confirmação
    const novaProposta = shift(40);
    pl = ok(await lucas.put(`/projects/${pid}/licitacao/datas`, { dates: { proposta: { date: novaProposta, validated: true, source: 'Edital, item 6.1' }, esclarecimentos: { date: shift(20), validated: true, source: 'Edital, item 4' } }, marginDays: 2 })).json();
    const opp = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    expect(opp.custom.prazo_proposta).toBe(novaProposta);
    expect(pl.officialDates.proposta).toMatchObject({ validated: true, source: 'Edital, item 6.1' });
    expect(pl.rows.find((r: Row) => r.id === prop.id).dueOn).toBe(prop.dueOn); // ainda não aplicado
    const rc = pl.recalc.find((r: { id: string }) => r.id === prop.id);
    expect(rc.to.dueOn).toBe(shift(40 - 1 - 2));
    pl = ok(await lucas.post(`/projects/${pid}/licitacao/recalcular`, { ids: [prop.id] })).json();
    expect(pl.rows.find((r: Row) => r.id === prop.id).dueOn).toBe(shift(37));

    // entregável obrigatório sem responsável da área / critério de aceite bloqueia
    const tec = pl.rows.find((r: Row) => r.title === 'Análise técnica') as Row;
    pl = ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: { deliverable: 'Parecer técnico' }, rowVersions: { [tec.id]: tec.rowVersion } })).json();
    expect(pl.issues.filter((i: { taskId: string; level: string }) => i.taskId === tec.id && i.level === 'bloqueio').map((i: { message: string }) => i.message)).toEqual(['"Análise técnica": defina o responsável da área.', '"Análise técnica": defina o critério de aceite.']);
    expect((await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: { acceptance: 'x' }, rowVersions: { [tec.id]: tec.rowVersion } })).statusCode).toBe(409); // edição simultânea
    pl = ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: [tec.id], patch: { ownerId: carlos.me.user.id, acceptance: 'Parecer assinado cobrindo todos os itens do TR' } })).json();
    expect(pl.issues.some((i: { taskId: string; level: string }) => i.taskId === tec.id && i.level === 'bloqueio')).toBe(false);

    // em lote: desloca 2 dias
    const two = (pl.rows as Row[]).filter((r) => !r.parentId && ['Análise jurídica', 'Análise financeira e fiscal'].includes(r.title));
    pl = ok(await lucas.patch(`/projects/${pid}/licitacao/tarefas`, { ids: two.map((r) => r.id), patch: {}, shiftDays: 2 })).json();
    for (const r of two) expect(pl.rows.find((x: Row) => x.id === r.id).dueOn).toBe(new Date(Date.parse(`${r.dueOn}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10));

    // incluir e excluir só neste projeto; obrigatória não se exclui
    const etapa1 = pl.phases[0].id;
    const nova = ok(await lucas.post(`/projects/${pid}/licitacao/tarefas`, { milestoneId: etapa1, title: 'Reunião de alinhamento exclusiva deste projeto', area: 'engenharia' }), 201).json();
    expect((await lucas.del(`/projects/${pid}/licitacao/tarefas/${tec.id}`)).statusCode).toBe(422);
    // dependências: começa antes da predecessora = alerta; ciclo recusado
    const adm = (pl.rows as Row[]).find((r) => r.title === 'Análise administrativa e comercial')!;
    pl = ok(await lucas.put(`/projects/${pid}/licitacao/tarefas/${adm.id}/dependencias`, { dependsOn: [prop.id] })).json();
    expect(pl.issues.some((i: { taskId: string; message: string }) => i.taskId === adm.id && i.message.includes('antes de "Proposta e anexos" terminar'))).toBe(true);
    expect((await lucas.put(`/projects/${pid}/licitacao/tarefas/${prop.id}/dependencias`, { dependsOn: [adm.id] })).statusCode).toBe(422);
    expect((await lucas.del(`/projects/${pid}/licitacao/tarefas/${prop.id}`)).statusCode).toBe(422);
    ok(await lucas.del(`/projects/${pid}/licitacao/tarefas/${nova.id}`));

    // o modelo publicado não mudou
    const m = ok(await carlos.get('/modelos-projeto/licitacao')).json();
    const pub = m.versions.find((v: { version: number }) => v.version === m.template.publishedVersion);
    expect(JSON.stringify(pub.def)).not.toContain('Reunião de alinhamento exclusiva deste projeto');
    expect(JSON.stringify(pub.def)).not.toContain('Parecer assinado cobrindo');
  });
});
