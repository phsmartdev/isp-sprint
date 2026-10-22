import { describe, expect, it } from 'vitest';
import { afterWrongCode, linkRequestErrors, linkState, milestoneChanges, trailStops, MAX_CODE_ATTEMPTS } from './journeyTrail';

const m = (id: string, plannedAt: string | null, doneAt: string | null = null) => ({ id, phase: 'onboarding' as const, title: id, plannedAt, doneAt });

describe('trilha da jornada', () => {
  it('situação das paradas: concluído, atrasado, agora e próximo', () => {
    const t = trailStops([m('a', '2026-10-01', '2026-10-02'), m('b', '2026-10-10'), m('c', '2026-10-30'), m('d', null)], '2026-10-21');
    expect(t.stops.map((s) => s.status)).toEqual(['concluido', 'atrasado', 'proximo', 'proximo']);
    expect(t).toMatchObject({ currentIndex: 1, done: 1, total: 4, late: 1, pct: 25, finished: false });
    const t2 = trailStops([m('a', '2026-10-01', '2026-10-02'), m('b', '2026-10-30')], '2026-10-21');
    expect(t2.stops[1]!.status).toBe('atual');
    expect(trailStops([m('a', null, '2026-10-02')], '2026-10-21')).toMatchObject({ finished: true, currentIndex: null, pct: 100 });
    expect(trailStops([], '2026-10-21')).toMatchObject({ finished: false, pct: 0 });
  });
  it('link: estados, pedido e bloqueio por código errado', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(linkState({ expiresAt: '2026-10-30T00:00:00Z', revokedAt: null, lockedUntil: null }, now)).toBe('ativo');
    expect(linkState({ expiresAt: '2026-10-20T00:00:00Z', revokedAt: null, lockedUntil: null }, now)).toBe('expirado');
    expect(linkState({ expiresAt: '2026-10-30T00:00:00Z', revokedAt: '2026-10-21T10:00:00Z', lockedUntil: null }, now)).toBe('revogado');
    expect(linkState({ expiresAt: '2026-10-30T00:00:00Z', revokedAt: null, lockedUntil: '2026-10-21T12:10:00Z' }, now)).toBe('bloqueado');
    expect(linkRequestErrors({ label: 'x', days: 0 })).toHaveLength(2);
    expect(linkRequestErrors({ label: 'Diretoria do cliente', days: 30 })).toEqual([]);
    expect(afterWrongCode(0, now).lockedUntil).toBeNull();
    expect(afterWrongCode(MAX_CODE_ATTEMPTS - 1, now).lockedUntil!.toISOString()).toBe('2026-10-21T12:15:00.000Z');
  });
  it('histórico: um evento por mudança, com antes e depois', () => {
    const before = { doneAt: null, plannedAt: '2026-10-10', ownerId: 'u1', notes: null };
    expect(milestoneChanges(before, { doneAt: '2026-10-21', notes: 'Feito' }).map((e) => e.type)).toEqual(['concluido', 'observacao']);
    expect(milestoneChanges({ ...before, doneAt: '2026-10-21' }, { doneAt: null })[0]).toMatchObject({ type: 'reaberto' });
    expect(milestoneChanges(before, { plannedAt: '2026-11-01', ownerId: 'u2' })).toEqual([{ type: 'reprogramado', from: '2026-10-10', to: '2026-11-01' }, { type: 'responsavel', from: 'u1', to: 'u2' }]);
    expect(milestoneChanges(before, { plannedAt: '2026-10-10', notes: '' })).toEqual([]);
  });
});
