import { describe, expect, it } from 'vitest';
import { bucketOf, checklistProgress, completionBlockers, createsCycle, describeRecurrence, nextOccurrence, parseMinutes, fmtMinutes, validateRecurrence } from './tasks';

describe('tarefas', () => {
  it('recorrência diária, dia útil, semanal com dias e mensal no fim do mês', () => {
    expect(nextOccurrence({ freq: 'diaria', interval: 2 }, '2026-10-21')).toBe('2026-10-23');
    expect(nextOccurrence({ freq: 'diaria', interval: 1, skipWeekends: true }, '2026-10-23')).toBe('2026-10-26'); // sexta → segunda
    expect(nextOccurrence({ freq: 'semanal', interval: 1, weekdays: [1, 3] }, '2026-10-19')).toBe('2026-10-21'); // seg → qua
    expect(nextOccurrence({ freq: 'semanal', interval: 2, weekdays: [1, 3] }, '2026-10-21')).toBe('2026-11-02'); // qua → seg daqui a 2 semanas
    expect(nextOccurrence({ freq: 'semanal', interval: 1 }, '2026-10-21')).toBe('2026-10-28');
    expect(nextOccurrence({ freq: 'mensal', interval: 1 }, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence({ freq: 'mensal', interval: 1, until: '2026-02-15' }, '2026-01-31')).toBeNull();
    expect(validateRecurrence({ freq: 'diaria', interval: 0 })).toHaveLength(1);
    expect(validateRecurrence({ freq: 'diaria', interval: 1, weekdays: [1] })).toHaveLength(1);
    expect(describeRecurrence({ freq: 'semanal', interval: 1, weekdays: [1, 5] })).toBe('Semanal (seg, sex)');
  });
  it('dependências: detecta ciclo direto e indireto', () => {
    const e = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    expect(createsCycle(e, 'c', 'a')).toBe(true);
    expect(createsCycle(e, 'a', 'c')).toBe(false);
    expect(createsCycle(e, 'a', 'a')).toBe(true);
  });
  it('bloqueios para concluir e checklist', () => {
    expect(completionBlockers({ openBlockers: [{ title: 'Vistoria' }], openSubtasks: 2 })).toEqual(['Depende de "Vistoria" ainda em aberto.', '2 subtarefa(s) em aberto.']);
    expect(checklistProgress([{ id: '1', text: 'a', done: true }, { id: '2', text: 'b', done: false }])).toEqual({ done: 1, total: 2, pct: 50 });
  });
  it('grupos de Minhas tarefas', () => {
    const base = { ownerId: 'me', createdBy: 'me', status: 'a_fazer' as const, dueOn: '2026-10-21' };
    expect(bucketOf(base, 'me', '2026-10-21')).toBe('hoje');
    expect(bucketOf({ ...base, dueOn: '2026-10-20' }, 'me', '2026-10-21')).toBe('atrasadas');
    expect(bucketOf({ ...base, status: 'aguardando' }, 'me', '2026-10-21')).toBe('aguardando');
    expect(bucketOf({ ...base, ownerId: 'ana' }, 'me', '2026-10-21')).toBe('delegadas');
    expect(bucketOf({ ...base, ownerId: 'ana', createdBy: 'ana' }, 'me', '2026-10-21')).toBeNull();
  });
  it('tempo', () => {
    expect(parseMinutes('1h30')).toBe(90);
    expect(parseMinutes('1,5h')).toBe(90);
    expect(parseMinutes('45min')).toBe(45);
    expect(parseMinutes('abc')).toBeNull();
    expect(fmtMinutes(125)).toBe('2h05');
  });
});
