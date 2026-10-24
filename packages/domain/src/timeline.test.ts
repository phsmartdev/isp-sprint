import { describe, expect, it } from 'vitest';
import { timelineCategory, timelineCritical, upcomingOf } from './timeline';

describe('linha do tempo do contrato', () => {
  it('separa os eventos por assunto', () => {
    expect(timelineCategory('aditivo')).toBe('aditivos');
    expect(timelineCategory('consumo')).toBe('financeiro');
    expect(timelineCategory('etapa_processo')).toBe('processos');
    expect(timelineCategory('sla_medicao')).toBe('execucao');
    expect(timelineCategory('oficio_email')).toBe('emails');
    expect(timelineCategory('versao')).toBe('contrato');
    expect(timelineCategory('tipo_novo')).toBe('contrato');
  });
  it('destaca o que é crítico', () => {
    expect(timelineCritical('alerta', null)).toBe(true);
    expect(timelineCritical('sla_medicao', { status: 'violado' })).toBe(true);
    expect(timelineCritical('sla_medicao', { status: 'cumprido' })).toBe(false);
    expect(timelineCritical('ocorrencia', { kind: 'multa' })).toBe(true);
    expect(timelineCritical('ocorrencia', { kind: 'reclamacao' })).toBe(false);
    expect(timelineCritical('ocorrencia', { status: 'aceita' })).toBe(false);
    expect(timelineCritical('versao', {})).toBe(false);
  });
  it('ordena os próximos prazos e corta o horizonte', () => {
    const u = upcomingOf([
      { kind: 'termino', on: '2027-06-01', title: 'Fim' },
      { kind: 'clausula', on: '2026-11-10', title: 'Garantia' },
      { kind: 'tarefa', on: '2026-10-20', title: 'Ligar' },
    ], '2026-10-24');
    expect(u.map((x) => x.kind)).toEqual(['tarefa', 'clausula']);
    expect(u[0]!.days).toBe(-4);
    expect(u[1]!.days).toBe(17);
  });
});
