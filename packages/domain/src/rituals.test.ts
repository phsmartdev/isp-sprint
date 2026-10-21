import { describe, expect, it } from 'vitest';
import { durationLabel, impedimentTransition, nextOccurrences, validateRitual } from './rituals';

describe('rituais: próximas datas', () => {
  it('semanal na segunda; diária só dias úteis', () => {
    expect(nextOccurrences({ cadence: 'semanal', weekday: 1, monthDay: 1, anchor: '2026-10-01' }, '2026-10-21', 3)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(nextOccurrences({ cadence: 'diaria', weekday: 1, monthDay: 1, anchor: '2026-10-01' }, '2026-10-23', 3)).toEqual(['2026-10-23', '2026-10-26', '2026-10-27']);
  });
  it('quinzenal alterna a partir da semana de início', () => {
    expect(nextOccurrences({ cadence: 'quinzenal', weekday: 1, monthDay: 1, anchor: '2026-10-05' }, '2026-10-06', 2)).toEqual(['2026-10-19', '2026-11-02']);
  });
  it('mensal respeita meses curtos e não volta antes do início', () => {
    expect(nextOccurrences({ cadence: 'mensal', weekday: 1, monthDay: 31, anchor: '2026-01-01' }, '2027-01-31', 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(nextOccurrences({ cadence: 'mensal', weekday: 1, monthDay: 5, anchor: '2026-12-01' }, '2026-10-21', 1)).toEqual(['2026-12-05']);
  });
  it('validação', () => {
    expect(validateRitual({ name: 'Semanal', cadence: 'semanal', weekday: 1, monthDay: 1, time: '09:00', durationMin: 60, agenda: ['Metas'], participants: ['u'] })).toEqual([]);
    expect(validateRitual({ name: 'x', cadence: 'semanal', weekday: 9, monthDay: 0, time: '9h', durationMin: 1, agenda: [' '], participants: [] }).map((e) => e.path)).toEqual(['name', 'weekday', 'monthDay', 'time', 'durationMin', 'agenda', 'participants']);
    expect(durationLabel(90)).toBe('1h30');
    expect(durationLabel(30)).toBe('30 min');
  });
});

describe('impedimentos', () => {
  it('encerrar exige resolução; reabrir é permitido; saltos inválidos recusados', () => {
    expect(impedimentTransition('aberto', 'em_tratamento', null)).toBeNull();
    expect(impedimentTransition('aberto', 'removido', 'ok')).toMatch(/como o impedimento foi removido/);
    expect(impedimentTransition('aberto', 'removido', 'Acesso liberado pelo TI')).toBeNull();
    expect(impedimentTransition('removido', 'em_tratamento', null)).toMatch(/Não dá/);
    expect(impedimentTransition('aceito', 'aberto', null)).toBeNull();
  });
});
