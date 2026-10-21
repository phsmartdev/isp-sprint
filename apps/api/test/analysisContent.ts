/** Análise completa (fictícia) usada nos testes para liberar o plano de ação. */
import { expect } from 'vitest';
import type { Client } from './helpers';

export const FULL_ANALYSIS = {
  problem: { what: 'Visitas abaixo da meta no mês', where: 'Carteira do Lucas', when: 'Mês fechado', howMuch: '30% da meta' },
  pareto: { title: 'Motivos de visita não realizada', source: 'manual', items: [{ label: 'Agenda de suporte', value: 9 }, { label: 'Cliente remarcou', value: 3 }, { label: 'Deslocamento', value: 1 }] },
  causes: [
    { id: 'c1', category: 'metodo', text: 'Sem bloco fixo de visitas na agenda', selected: true },
    { id: 'c2', category: 'mao_de_obra', text: 'Suporte puxando o consultor', selected: false },
    { id: 'c3', category: 'meio', text: 'Chuvas no período', selected: false },
  ],
  whys: [{ causeId: 'c1', whys: ['Agenda ocupada', 'Chamados de suporte sem triagem', 'Não há plantão de suporte para clientes da carteira'], rootCause: 'Falta de triagem de suporte da carteira', evidence: '9 de 13 visitas canceladas por chamado de suporte', confirmed: true }],
};

export async function completeAnalysis(c: Client, interventionId: string) {
  const g = (await c.get(`/interventions/${interventionId}/analysis`)).json();
  const v = g.analysis?.rowVersion ?? 0;
  const put = await c.put(`/interventions/${interventionId}/analysis`, { rowVersion: v, content: FULL_ANALYSIS });
  expect(put.statusCode, put.body).toBe(200);
  const r = await c.post(`/interventions/${interventionId}/analysis/conclude`, { rowVersion: put.json().rowVersion });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** Inclui uma ação 5W2H (vira tarefa para whoId) e devolve a ação com a tarefa. */
export async function addAction(c: Client, interventionId: string, whoId: string, what = 'Plantão de suporte para a carteira') {
  const r = await c.post(`/interventions/${interventionId}/actions`, { what, why: 'Ataca a falta de triagem de suporte', where: 'Central de suporte', whenDue: inDays(10), whoId, how: 'Escala semanal com dois consultores', howMuchCents: 0 });
  expect(r.statusCode, r.body).toBe(201);
  const d = (await c.get(`/interventions/${interventionId}`)).json();
  return d.actions.find((a: { id: string }) => a.id === r.json().id) as { id: string; activityId: string; status: string };
}
/** Conclui a tarefa como o responsável por ela. */
export async function finishTask(owner: Client, taskId: string) {
  const t = (await owner.get(`/tasks/${taskId}`)).json();
  const r = await owner.patch(`/tasks/${taskId}`, { rowVersion: t.rowVersion ?? t.task?.rowVersion, status: 'concluida' });
  expect(r.statusCode, r.body).toBe(200);
}
