import { describe, expect, it } from 'vitest';
import { boardStats, dueState, sprintEmail } from './marketingBoard';

describe('quadro do Marketing', () => {
  it('prazo: atrasada, vence hoje, em até 2 dias, no prazo, concluída', () => {
    const t = '2026-11-12';
    expect(dueState({ dueOn: '2026-11-11', column: 'a_fazer' }, t)).toBe('atrasada');
    expect(dueState({ dueOn: '2026-11-12', column: 'a_fazer' }, t)).toBe('vence_hoje');
    expect(dueState({ dueOn: '2026-11-14', column: 'a_fazer' }, t)).toBe('vence_em_breve');
    expect(dueState({ dueOn: '2026-11-20', column: 'a_fazer' }, t)).toBe('no_prazo');
    expect(dueState({ dueOn: '2026-11-01', column: 'concluido' }, t)).toBe('concluida');
    expect(dueState({ dueOn: null, column: 'backlog' }, t)).toBe('sem_prazo');
  });
  it('resumo: andamento, prazos, carga acima do limite e divisão 70/20/10', () => {
    const sp = { id: 's', startOn: '2026-11-01', endOn: '2026-11-15' };
    const c = (o: string, column: string, dueOn: string | null, allocation: string | null, furaFila = false) => ({ ownerId: o, column, dueOn, allocation, furaFila, sprintId: 's' });
    const st = boardStats([
      c('a', 'em_execucao', '2026-11-10', 'comercial'), c('a', 'em_execucao', '2026-11-20', 'comercial'), c('a', 'em_execucao', '2026-11-20', 'comercial'), c('a', 'em_execucao', null, 'testes'),
      c('b', 'concluido', '2026-11-05', 'interdepartamental'), c('b', 'a_fazer', '2026-11-12', 'comercial', true),
    ], sp, '2026-11-12');
    expect(st).toMatchObject({ total: 6, done: 1, donePct: 17, overdue: 1, dueToday: 1, inProgress: 4, furaFila: 1, daysLeft: 3 });
    expect(st.overLimit).toEqual([{ ownerId: 'a', n: 4 }]);
    expect(st.allocation.find((a) => a.key === 'comercial')).toMatchObject({ n: 4, pct: 67, target: 70 });
  });
  it('comunicações oficiais seguem os modelos do Anexo VII', () => {
    const a = sprintEmail('abertura', { startOn: '2026-02-01', endOn: '2026-02-15', objective: 'Lançar a campanha' }, [{ title: 'Peças da campanha', column: 'a_fazer', furaFila: false, dueOn: null }], 'Líder Fictícia');
    expect(a.subject).toBe('Abertura da Sprint de Marketing | Planejamento Quinzenal');
    expect(a.text).toContain('quinzena 01/02 a 15/02');
    expect(a.text).toContain('• Peças da campanha');
    expect(a.text).toContain('regra de fura-fila');
    const e = sprintEmail('encerramento', { startOn: '2026-02-01', endOn: '2026-02-15', objective: null, highlights: 'Leads +20%' }, [{ title: 'Peças', column: 'concluido', furaFila: false, dueOn: null }, { title: 'Vídeo', column: 'a_fazer', furaFila: false, dueOn: null }], 'Líder');
    expect(e.text).toContain('Entregas concluídas\n• Peças');
    expect(e.text).toContain('Reprogramações\n• Vídeo – reprogramada para a próxima Sprint');
  });
});
