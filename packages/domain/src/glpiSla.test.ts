import { describe, expect, it } from 'vitest';
import { DEFAULT_SLA_SETTINGS as BASE, addSlaHours, slaDueAlerts, dueText, inBusinessHours, serviceLevel, ticketDue, ticketSituation, type SlaTicket } from './glpiSla';

const TZ = 'America/Sao_Paulo';
// quarta-feira 25/11/2026, 14:00 em Brasília (17:00 UTC)
const NOW = new Date('2026-11-25T17:00:00Z');
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
// nos testes da régua, o prazo é o do GLPI em horas corridas (o SLA universal tem o próprio teste)
const S = { ...BASE, slaSource: 'glpi' as const, businessHoursOnly: false };
const t = (p: Partial<SlaTicket>): SlaTicket => ({ status: 2, openedAt: h(-10), dueSolveAt: h(10), dueOwnAt: null, takenAt: null, solvedAt: null, assignedUserIds: [7], ...p });

describe('situação e nível de serviço', () => {
  it('no prazo, a vencer (24 h), atrasado e sem prazo', () => {
    expect(ticketSituation(t({ dueSolveAt: h(30) }), NOW, S)).toBe('no_prazo');
    expect(ticketSituation(t({ dueSolveAt: h(3) }), NOW, S)).toBe('a_vencer');
    expect(ticketSituation(t({ dueSolveAt: h(-1) }), NOW, S)).toBe('atrasado');
  });
  it('SLA universal: o mesmo prazo para todos, em horas úteis; ignora o SLA do GLPI', () => {
    // aberto quarta 25/11 às 14:00; 8 h úteis (8h–18h) = 4 h na quarta + 4 h na quinta → quinta 26/11 às 12:00
    expect(ticketDue({ dueSolveAt: h(100), openedAt: NOW }, { ...BASE, solveHours: 8 }, TZ)).toEqual(new Date('2026-11-26T15:00:00Z'));
    // aberto sexta 18:30: começa a contar segunda 8:00 → 2 h úteis = segunda 10:00
    expect(addSlaHours(new Date('2026-11-27T21:30:00Z'), 2, TZ, BASE)).toEqual(new Date('2026-11-30T13:00:00Z'));
    // em horas corridas
    expect(ticketDue({ dueSolveAt: null, openedAt: h(-30) }, { ...BASE, solveHours: 24, businessHoursOnly: false }, TZ)).toEqual(h(-6));
  });
  it('SLA do GLPI: usa o prazo do chamado; sem SLA lá, vale o universal', () => {
    expect(ticketDue({ dueSolveAt: h(5), openedAt: NOW }, S, TZ)).toEqual(h(5));
    expect(ticketDue({ dueSolveAt: null, openedAt: h(-30) }, { ...S, solveHours: 24 }, TZ)).toEqual(h(-6));
    expect(ticketSituation(t({ dueSolveAt: null }), NOW, { ...S, solveHours: 0 })).toBe('sem_prazo');
  });
  it('resolvido conta no prazo ou fora; nível de serviço ignora os sem prazo', () => {
    expect(ticketSituation(t({ status: 5, solvedAt: h(-2), dueSolveAt: h(-1) }), NOW, S)).toBe('resolvido_no_prazo');
    expect(ticketSituation(t({ status: 6, solvedAt: h(-1), dueSolveAt: h(-2) }), NOW, S)).toBe('resolvido_fora');
    expect(serviceLevel(['resolvido_no_prazo', 'resolvido_no_prazo', 'resolvido_no_prazo', 'resolvido_fora', 'resolvido_sem_prazo', 'atrasado'])).toBe(75);
    expect(serviceLevel(['atrasado'])).toBeNull();
  });
  it('texto do prazo', () => {
    expect(dueText(h(-27), NOW)).toBe('venceu há 1 d 3 h');
    expect(dueText(new Date(NOW.getTime() + 130 * 60_000), NOW)).toBe('vence em 2 h 10');
    expect(dueText(null, NOW)).toBe('sem prazo');
  });
});

describe('régua de avisos', () => {
  it('horário comercial no fuso da empresa', () => {
    expect(inBusinessHours(NOW, TZ, BASE)).toBe(true);
    expect(inBusinessHours(new Date('2026-11-25T23:00:00Z'), TZ, S)).toBe(false); // 20h
    expect(inBusinessHours(new Date('2026-11-28T14:00:00Z'), TZ, S)).toBe(false); // sábado
  });
  it('chegou só para o que é novo; sem responsável depois de 1 h, repetindo por hora', () => {
    expect(slaDueAlerts(t({ openedAt: h(-0.2) }), NOW, S, TZ, true).map((a) => a.key)).toEqual(['chegou']);
    expect(slaDueAlerts(t({ openedAt: h(-0.2) }), NOW, S, TZ, false)).toEqual([]);
    expect(slaDueAlerts(t({ assignedUserIds: [], openedAt: h(-2.5) }), NOW, S, TZ, false).map((a) => a.key)).toEqual(['sem_dono:1']);
  });
  it('a vencer: só o aviso mais perto do prazo; vencido repete a cada 2 h e escala depois de 4 h', () => {
    expect(slaDueAlerts(t({ dueSolveAt: h(3) }), NOW, S, TZ, false)).toEqual([{ stage: 'vence', key: 'vence:4', hours: 4 }]);
    expect(slaDueAlerts(t({ dueSolveAt: h(0.5) }), NOW, S, TZ, false).map((a) => a.key)).toEqual(['vence:1']);
    expect(slaDueAlerts(t({ dueSolveAt: h(-1) }), NOW, S, TZ, false).map((a) => a.key)).toEqual(['venceu:0']);
    expect(slaDueAlerts(t({ dueSolveAt: h(-5) }), NOW, S, TZ, false).map((a) => a.key)).toEqual(['venceu:2', 'escalado']);
  });
  it('fora do horário só o escalonamento sai; resolvido não avisa', () => {
    const night = new Date('2026-11-25T23:30:00Z');
    expect(slaDueAlerts(t({ dueSolveAt: new Date(night.getTime() - 5 * 3_600_000) }), night, S, TZ, true).map((a) => a.key)).toEqual(['escalado']);
    expect(slaDueAlerts(t({ status: 5, dueSolveAt: h(-5) }), NOW, S, TZ, true)).toEqual([]);
  });
});
