import { describe, expect, it } from 'vitest';
import { acquisitivePeriods, addYears, suggestVacations, vacationEnd, vacationErrors, vacationNeedsAlert, vacationSettingsErrors, weekday, type Vacation, type VacationSettings } from './vacations';

// valores de teste (na empresa vêm das configurações)
const ST: VacationSettings = { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 14, minBlockDays: 5, alertDaysBefore: 30, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1 };
const teams = { ana: ['t1'], bia: ['t1'], caio: ['t2'], duda: ['t1', 't2'] };
const v = (userId: string, startDate: string, days: number, periodStart: string, extra: Partial<Vacation> = {}): Vacation => ({ id: `${userId}-${startDate}`, userId, startDate, days, periodStart, status: 'programada', ...extra });

describe('férias', () => {
  it('períodos aquisitivo e concessivo; 29/02', () => {
    expect(acquisitivePeriods('2024-03-10', '2026-11-06')).toEqual([
      { start: '2024-03-10', end: '2025-03-09', concessiveEnd: '2026-03-09' },
      { start: '2025-03-10', end: '2026-03-09', concessiveEnd: '2027-03-09' },
      { start: '2026-03-10', end: '2027-03-09', concessiveEnd: '2028-03-09' },
    ]);
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(vacationEnd({ startDate: '2026-12-07', days: 30 })).toBe('2027-01-05');
  });
  it('configurações validadas', () => {
    expect(vacationSettingsErrors(ST)).toEqual([]);
    expect(vacationSettingsErrors({ ...ST, minMainBlockDays: 3 }).join(' ')).toMatch(/principal/);
    expect(vacationSettingsErrors({ ...ST, preferredStartWeekday: 5 }).join(' ')).toMatch(/preferido/);
  });
  it('sem choque no mesmo time; outro time pode', () => {
    const ctx = { others: [v('ana', '2026-12-07', 20, '2025-03-10')], teams, admission: '2024-03-10', settings: ST, today: '2026-11-06', names: { ana: 'Ana' } };
    const r = vacationErrors(v('bia', '2026-12-14', 15, '2025-03-10', { id: 'novo' }), ctx);
    expect(r.errors.join(' ')).toMatch(/Choque de férias no time: Ana \(07\/12\/2026 a 26\/12\/2026\)/);
    expect(r.conflicts).toHaveLength(1);
    expect(vacationErrors(v('caio', '2026-12-14', 15, '2025-03-10', { id: 'novo' }), ctx).errors).toEqual([]);
    // duda está nos dois times: choca com ana (t1)
    expect(vacationErrors(v('duda', '2026-12-21', 15, '2025-03-10', { id: 'novo' }), ctx).conflicts).toHaveLength(1);
    // logo depois do fim da ana: livre
    expect(vacationErrors(v('bia', '2026-12-28', 15, '2025-03-10', { id: 'novo' }), ctx).errors).toEqual([]);
  });
  it('fracionamento, início bloqueado, aquisitivo e concessivo', () => {
    const base = { teams, admission: '2024-03-10', settings: ST, today: '2026-11-06' };
    expect(vacationErrors(v('ana', '2026-12-04', 15, '2025-03-10', { id: 'x' }), { ...base, others: [] }).errors.join(' ')).toMatch(/não podem começar em sexta ou sábado/);
    expect(vacationErrors(v('ana', '2026-12-07', 4, '2025-03-10', { id: 'x' }), { ...base, others: [] }).errors.join(' ')).toMatch(/mínimo 5 dias/);
    const two = [v('ana', '2026-04-06', 10, '2025-03-10'), v('ana', '2026-06-01', 10, '2025-03-10')];
    expect(vacationErrors(v('ana', '2026-12-07', 10, '2025-03-10', { id: 'x' }), { ...base, others: two }).errors.join(' ')).toMatch(/pelo menos 14 dias/);
    expect(vacationErrors(v('ana', '2026-12-07', 11, '2025-03-10', { id: 'x' }), { ...base, others: two }).errors.join(' ')).toMatch(/já há 20 dias/);
    expect(vacationErrors(v('ana', '2027-03-01', 20, '2025-03-10', { id: 'x' }), { ...base, others: [] }).errors.join(' ')).toMatch(/concessivo \(09\/03\/2027\)/);
    expect(vacationErrors(v('ana', '2026-12-07', 20, '2026-03-10', { id: 'x' }), { ...base, others: [] }).errors.join(' ')).toMatch(/ainda não terminou/);
  });
  it('sugestão: urgente primeiro, segunda-feira, sem choque, respeitando o aviso', () => {
    const people = [{ userId: 'ana', admission: '2024-03-10' }, { userId: 'bia', admission: '2023-12-01' }, { userId: 'caio', admission: '2024-03-10' }];
    const s = suggestVacations({ people, existing: [], teams, settings: ST, today: '2026-11-06' });
    // bia: período 2024-12-01 vence em 30/11/2026 e 30 dias não cabem mais → alerta; é o mais urgente (vem primeiro)
    expect(s[0]).toMatchObject({ userId: 'bia', periodStart: '2024-12-01', startDate: null });
    expect((s[0] as { reason: string }).reason).toMatch(/30\/11\/2026/);
    expect(s.find((x) => x.userId === 'ana')).toMatchObject({ startDate: '2026-12-07', days: 30 });
    // o período seguinte de bia vem depois do da ana (mesmo time)
    expect(s.find((x) => x.userId === 'bia' && x.periodStart === '2025-12-01')).toMatchObject({ startDate: '2027-01-11' });
    const all = s.filter((x) => x.startDate) as { userId: string; startDate: string; days: number }[];
    for (const x of all) expect(weekday(x.startDate)).toBe(1);
    // nenhuma sobreposição entre ana e bia (mesmo time)
    const ab = all.filter((x) => x.userId !== 'caio');
    for (const a of ab) for (const b of ab) if (a !== b && a.userId !== b.userId) expect(a.startDate > vacationEnd(b) || b.startDate > vacationEnd(a)).toBe(true);
    // caio (outro time) pode coincidir com ana
    expect(all.find((x) => x.userId === 'caio')!.startDate).toBe(all.find((x) => x.userId === 'ana')!.startDate);
  });
  it('pouco prazo no concessivo: começa o quanto antes, sem esperar o aviso', () => {
    // aquisitivo 2024-12-15..2025-12-14, concessivo até 14/12/2026: a partir de 07/12 (aviso) não cabem 30 dias → começa já
    const s = suggestVacations({ people: [{ userId: 'bia', admission: '2023-12-15' }], existing: [], teams, settings: { ...ST, daysPerPeriod: 20, minMainBlockDays: 10 }, today: '2026-11-06', horizonDays: 30 });
    expect(s.find((x) => x.periodStart === '2024-12-15')).toMatchObject({ startDate: '2026-11-09', days: 20 });
  });
  it('aviso 30 dias antes, uma vez, só programadas', () => {
    expect(vacationNeedsAlert({ startDate: '2026-12-06', status: 'programada', alertedAt: null }, '2026-11-06', ST)).toBe(true);
    expect(vacationNeedsAlert({ startDate: '2026-12-07', status: 'programada', alertedAt: null }, '2026-11-06', ST)).toBe(false);
    expect(vacationNeedsAlert({ startDate: '2026-12-06', status: 'sugerida', alertedAt: null }, '2026-11-06', ST)).toBe(false);
    expect(vacationNeedsAlert({ startDate: '2026-12-06', status: 'programada', alertedAt: '2026-11-05' }, '2026-11-06', ST)).toBe(false);
  });
});
