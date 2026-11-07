import { describe, expect, it } from 'vitest';
import { supportCredits, supportSettingsErrors } from './supportRequests';

const st = { helperMultiplierBp: 15_000, basePoints: 4, requesterPoints: 1, monthlyCapPoints: 10 };
describe('pedido de apoio', () => {
  it('quem apoiou ganha 1,5x da tarefa (ou da base); quem pediu ganha os seus; teto mensal', () => {
    const c = supportCredits([
      { id: 'a', requesterId: 'p', helperId: 'h', taskPoints: 4, confirmedOn: '2026-11-02' },
      { id: 'b', requesterId: 'p', helperId: 'h', taskPoints: null, confirmedOn: '2026-11-03' },
      { id: 'c', requesterId: 'p', helperId: 'h', taskPoints: 2, confirmedOn: '2026-11-04' },
      { id: 'd', requesterId: 'h', helperId: 'h', taskPoints: 2, confirmedOn: '2026-11-04' },
    ], st);
    expect(c.filter((x) => x.userId === 'h').map((x) => [x.requestId, x.points, x.capped])).toEqual([['a', 6, false], ['b', 4, true], ['c', 0, true]]);
    expect(c.filter((x) => x.userId === 'p').map((x) => x.points)).toEqual([1, 1, 1]);
  });
  it('sem regra aprovada não pontua; validação', () => {
    expect(supportCredits([{ id: 'a', requesterId: 'p', helperId: 'h', taskPoints: 4, confirmedOn: '2026-11-02' }], undefined)).toEqual([]);
    expect(supportSettingsErrors({ ...st, helperMultiplierBp: 5000 })).toHaveLength(1);
  });
});
