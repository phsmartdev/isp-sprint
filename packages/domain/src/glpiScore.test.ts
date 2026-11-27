import { describe, expect, it } from 'vitest';
import { DEFAULT_SLA_SETTINGS, glpiScoreEvents, type GlpiScoreTicket } from './glpiSla';

// horas corridas para as contas ficarem óbvias: assumir 4 h, solucionar 24 h
const s = { ...DEFAULT_SLA_SETTINGS, businessHoursOnly: false, slaSource: 'universal' as const, ownHours: 4, solveHours: 24 };
const open = new Date('2026-11-23T12:00:00Z');
const h = (n: number) => new Date(open.getTime() + n * 3_600_000);
const base: GlpiScoreTicket = { openedAt: open, dueOwnAt: null, dueSolveAt: null, takenAt: null, solvedAt: null, closedAt: null, userIds: ['ana'], mentions: [], approvals: [] };
const types = (t: GlpiScoreTicket, st = s) => glpiScoreEvents(10, t, st, 'UTC').map((e) => `${e.type}:${e.userId}`);

describe('GLPI na gamificação: só pontua dentro do prazo', () => {
  it('assumir e solucionar no prazo pontuam cada pessoa atribuída; fora do prazo não', () => {
    expect(types({ ...base, takenAt: h(3), solvedAt: h(20), userIds: ['ana', 'bia'] })).toEqual(['glpi_chamado_assumido:ana', 'glpi_chamado_assumido:bia', 'glpi_chamado_solucionado:ana', 'glpi_chamado_solucionado:bia']);
    expect(types({ ...base, takenAt: h(5), solvedAt: h(30) })).toEqual([]);
    // fechado (sem solução registrada) conta como encerrar
    expect(types({ ...base, closedAt: h(10) })).toEqual(['glpi_chamado_solucionado:ana']);
  });
  it('prazo do próprio GLPI quando a origem é "glpi"', () => {
    const st = { ...s, slaSource: 'glpi' as const };
    expect(types({ ...base, dueSolveAt: h(48), solvedAt: h(40) }, st)).toEqual(['glpi_chamado_solucionado:ana']);
    expect(types({ ...base, dueSolveAt: h(8), solvedAt: h(10) }, st)).toEqual([]);
  });
  it('menção e aprovação: prazo próprio, ou o de assumir quando vazio; recusar também é responder', () => {
    const t: GlpiScoreTicket = { ...base, mentions: [{ userId: 'caio', at: h(1).toISOString(), answeredAt: h(4).toISOString() }, { userId: 'dani', at: h(1).toISOString(), answeredAt: h(6).toISOString() }],
      approvals: [{ validationId: 7, userId: 'edu', at: h(2).toISOString(), status: 4, decidedAt: h(5).toISOString() }, { validationId: 8, userId: 'fê', at: h(2).toISOString(), status: 2, decidedAt: null }] };
    expect(types(t)).toEqual(['glpi_mencao_respondida:caio', 'glpi_aprovacao_respondida:edu']);
    expect(types(t, { ...s, mentionReplyHours: 8, approvalReplyHours: 1 })).toEqual(['glpi_mencao_respondida:caio', 'glpi_mencao_respondida:dani']);
  });
  it('a chave é estável (a sincronização pode rodar de novo sem duplicar)', () => {
    const t = { ...base, takenAt: h(1) };
    expect(glpiScoreEvents(10, t, s, 'UTC')[0]!.key).toBe(glpiScoreEvents(10, t, s, 'UTC')[0]!.key);
  });
});
