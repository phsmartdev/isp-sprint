/** Etapa 1 · Fase 2 — frentes da implantação, homologação de marcos, riscos, impedimentos e painel por marcos homologados. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { finishTask } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const TAG = `Implantação ISP Sprint ${stamp}`;
let fronts: { id: string; name: string }[] = [];
type Item = { id: string; name: string; summary: { progress: { done: number; total: number; basis: string }; current: { name: string } | null; nextAction: { kind: string; text: string }; impediments: { open: number; high: number }; risks: { open: number; high: number }; pendingHomologation: { name: string }[] } };
const portfolio = async () => ok(await carlos.get(`/projects/portfolio?tag=${encodeURIComponent(TAG)}`)).json() as { items: Item[]; tags: string[] };
const front = (n: string) => fronts.find((f) => f.name.endsWith(n))!;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana, rafael] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
});
afterAll(async () => ctx.close());

/** Conclui as tarefas do marco e o marco, como quem o dono indicar. */
async function finishMilestone(owner: Client, projectId: string, name: string) {
  const d = ok(await owner.get(`/projects/${projectId}`)).json();
  const m = d.milestones.find((x: { name: string }) => x.name === name);
  for (const t of d.tasks.filter((x: { milestoneId: string; completedAt: string | null }) => x.milestoneId === m.id && !x.completedAt)) await finishTask(owner, t.id);
  ok(await owner.patch(`/projects/${projectId}/milestones/${m.id}`, { completed: true }));
  return m.id as string;
}

describe('Fase 2: frentes da implantação', () => {
  it('cria as quatro frentes a partir do modelo, com etiqueta, marcos com critério e homologação', async () => {
    expect((await carlos.post('/projects/fronts', { initiative: TAG, startOn: '2026-10-26', fronts: [{ name: 'CRM', ownerId: ana.me.user.id }, { name: 'crm', ownerId: ana.me.user.id }] })).statusCode).toBe(422);
    expect((await lucas.post('/projects/fronts', { initiative: TAG, startOn: '2026-10-26', fronts: [{ name: 'CRM', ownerId: ana.me.user.id }] })).statusCode).toBe(403); // vendedor: nível próprio
    const r = ok(await carlos.post('/projects/fronts', { initiative: TAG, startOn: '2026-10-26', fronts: [
      { name: 'Contratos', ownerId: lucas.me.user.id }, { name: 'CRM', ownerId: ana.me.user.id }, { name: 'Projetos — ajustes e homologação', ownerId: carlos.me.user.id }, { name: 'Relatórios', ownerId: carlos.me.user.id },
    ] }), 201).json();
    expect(r.ids).toHaveLength(4);
    const p = await portfolio();
    fronts = p.items.map((x) => ({ id: x.id, name: x.name }));
    expect(p.tags).toContain(TAG);
    expect(p.items.map((x) => x.name)).toEqual(expect.arrayContaining([`${TAG} — Contratos`, `${TAG} — Relatórios`]));
    const c = p.items.find((x) => x.name.endsWith('Contratos'))!;
    expect(c.summary.progress).toEqual({ done: 0, total: 6, pct: 0, basis: 'homologados' });
    expect(c.summary.current?.name).toBe('Diagnóstico e configuração');
    expect(c.summary.nextAction).toMatchObject({ kind: 'tarefa', text: 'Levantar cadastros, usuários e permissões do módulo' });
    const d = ok(await lucas.get(`/projects/${c.id}`)).json();
    expect(d.milestones.every((m: { requiresHomologation: boolean; acceptanceCriteria: string }) => m.requiresHomologation && m.acceptanceCriteria.length > 10)).toBe(true);
  });

  it('homologação: autor não homologa; quem não gerencia não homologa; homologado avança o progresso real; reprovado reabre', async () => {
    const pid = front('Contratos').id;
    const m1 = await finishMilestone(lucas, pid, 'Diagnóstico e configuração');
    let s = (await portfolio()).items.find((x) => x.id === pid)!.summary;
    expect(s.progress.done).toBe(0); // concluído não é homologado
    expect(s.nextAction).toEqual({ kind: 'homologar', text: 'Homologar "Diagnóstico e configuração"' });
    expect((await lucas.post(`/projects/${pid}/milestones/${m1}/homologation`, { decision: 'homologado', note: 'Checklist conferido' })).json().detail).toMatch(/próprio trabalho/);
    expect((await rafael.post(`/projects/${pid}/milestones/${m1}/homologation`, { decision: 'homologado', note: 'Checklist conferido' })).statusCode).toBe(404);
    ok(await carlos.post(`/projects/${pid}/milestones/${m1}/homologation`, { decision: 'homologado', note: 'Checklist de configuração conferido com o gestor' }));
    s = (await portfolio()).items.find((x) => x.id === pid)!.summary;
    expect(s.progress).toMatchObject({ done: 1, total: 6 });
    expect(s.current?.name).toBe('Ajustes');
    const m2 = await finishMilestone(lucas, pid, 'Ajustes');
    expect((await carlos.post(`/projects/${pid}/milestones/${m2}/homologation`, { decision: 'reprovado', note: 'curto' })).statusCode).toBe(422);
    ok(await carlos.post(`/projects/${pid}/milestones/${m2}/homologation`, { decision: 'reprovado', note: 'Falta a regressão completa verde antes de homologar' }));
    const d = ok(await lucas.get(`/projects/${pid}`)).json();
    expect(d.milestones.find((m: { id: string }) => m.id === m2).completedAt).toBeNull();
    const g = ok(await lucas.get(`/projects/${pid}/governance`)).json();
    expect(g.homologations.map((h: { decision: string; milestoneName: string }) => `${h.decision}:${h.milestoneName}`)).toEqual(['reprovado:Ajustes', 'homologado:Diagnóstico e configuração']);
    await expect(ctx.db.execute(sql`update milestone_homologations set note = 'x' where project_id = ${pid}`)).rejects.toThrow(/append-only/);
  });

  it('riscos: alto exige mitigação; encerrar exige motivo; painel conta os altos abertos', async () => {
    const pid = front('Contratos').id;
    expect((await lucas.post(`/projects/${pid}/risks`, { title: 'ERP sem integração no prazo', probability: 'alta', impact: 'alto', ownerId: lucas.me.user.id })).json().detail).toMatch(/mitigação/);
    const r = ok(await lucas.post(`/projects/${pid}/risks`, { title: 'ERP sem integração no prazo', probability: 'alta', impact: 'alto', mitigation: 'Manter a etapa manual de ERP com responsável do Financeiro', ownerId: lucas.me.user.id }), 201).json();
    let s = (await portfolio()).items.find((x) => x.id === pid)!.summary;
    expect(s.risks).toEqual({ open: 1, high: 1 });
    let g = ok(await lucas.get(`/projects/${pid}/governance`)).json();
    const risk = g.risks.find((x: { id: string }) => x.id === r.id);
    expect(risk.level).toBe('critico');
    expect((await lucas.patch(`/projects/${pid}/risks/${r.id}`, { rowVersion: risk.rowVersion, status: 'encerrado' })).statusCode).toBe(422);
    ok(await lucas.patch(`/projects/${pid}/risks/${r.id}`, { rowVersion: risk.rowVersion, status: 'encerrado', note: 'Credenciais do IXC liberadas' }));
    s = (await portfolio()).items.find((x) => x.id === pid)!.summary;
    expect(s.risks).toEqual({ open: 0, high: 0 });
    g = ok(await lucas.get(`/projects/${pid}/governance`)).json();
    expect(g.risks[0].status).toBe('encerrado');
  });

  it('impedimentos: mesmo registro dos rituais; encerrar exige como foi resolvido; quem não participa não vê', async () => {
    const pid = front('Contratos').id;
    const i = ok(await lucas.post(`/projects/${pid}/impediments`, { title: 'Setores dos usuários não cadastrados', severity: 'alta', ownerId: ana.me.user.id }), 201).json();
    expect((await portfolio()).items.find((x) => x.id === pid)!.summary.impediments).toEqual({ open: 1, high: 1 });
    const rit = ok(await carlos.get('/impediments')).json().items.find((x: { id: string }) => x.id === i.id);
    expect(rit).toMatchObject({ projectId: pid, title: 'Setores dos usuários não cadastrados', ownerId: ana.me.user.id });
    expect((await lucas.patch(`/projects/${pid}/impediments/${i.id}`, { rowVersion: rit.rowVersion, status: 'removido' })).statusCode).toBe(422);
    ok(await lucas.patch(`/projects/${pid}/impediments/${i.id}`, { rowVersion: rit.rowVersion, status: 'removido', resolution: 'Gerência cadastrou os setores na tela de usuários' }));
    expect((await portfolio()).items.find((x) => x.id === pid)!.summary.impediments.open).toBe(0);
    expect((await rafael.get(`/projects/${pid}/governance`)).statusCode).toBe(404);
    expect(ok(await rafael.get(`/projects/portfolio?tag=${encodeURIComponent(TAG)}`)).json().items).toHaveLength(0);
  });
});
