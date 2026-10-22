import { describe, expect, it } from 'vitest';
import { evaluateSignals, nextCadence, signalTransition, type SignalFacts } from './abmSignals';

const base: SignalFacts = { priority: 'media', today: '2026-10-22', daysSinceInteraction: 10, accountCreatedOn: '2026-01-01', people: [], lateRuns: [], contracts: [], staleOpps: [], objectives: [], coverage: 80, active: true, detractors: [] };

describe('sinais do ABM', () => {
  it('sem sinais quando está tudo em dia', () => { expect(evaluateSignals(base)).toEqual([]); });
  it('detecta cada situação com chave estável e severidade', () => {
    const s = evaluateSignals({
      ...base, priority: 'critica', daysSinceInteraction: 20,
      people: [{ id: 'p1', name: 'Ana', nextInteractionOn: '2026-10-01', key: true }, { id: 'p2', name: 'Bia', nextInteractionOn: '2026-11-01', key: false }],
      lateRuns: [{ id: 'r1', play: 'Abertura', lateSteps: 2 }],
      contracts: [{ id: 'c1', label: 'CT-1', endAt: '2026-11-10' }, { id: 'c2', label: 'CT-2', endAt: '2027-06-01' }],
      staleOpps: [{ id: 'o1', label: 'OP-9', days: 40 }], objectives: [{ id: 'b1', title: 'Mapear', dueOn: '2026-10-01' }], coverage: 30, detractors: [{ id: 'n1', score: 4, on: '2026-10-10' }],
    });
    expect(s.map((x) => `${x.kind}:${x.key}:${x.severity}`)).toEqual([
      'sem_contato:sem_contato:alta', 'interacao_pessoa_vencida:pessoa:p1:alta', 'play_atrasado:play:r1:media', 'contrato_vencendo:contrato:c1:alta',
      'oportunidade_parada:op:o1:media', 'objetivo_vencido:objetivo:b1:media', 'cobertura_baixa:cobertura:baixa', 'nps_detrator:nps:n1:alta',
    ]);
  });
  it('conta nova sem interação só vira sinal depois do limite da prioridade', () => {
    expect(evaluateSignals({ ...base, daysSinceInteraction: null, accountCreatedOn: '2026-10-01' })).toEqual([]);
    expect(evaluateSignals({ ...base, daysSinceInteraction: null, accountCreatedOn: '2026-08-01' })[0]!.title).toBe('Sem contato há 82 dias');
  });
  it('estados e cadência', () => {
    expect(signalTransition('novo', 'em_analise')).toBeNull();
    expect(signalTransition('em_analise', 'tratado', 'curto')).toMatch(/o que foi feito/);
    expect(signalTransition('novo', 'descartado', 'Situação já conhecida e aceita')).toBeNull();
    expect(signalTransition('tratado', 'em_analise')).toMatch(/encerrado/);
    expect(nextCadence({ startOn: '2026-10-20', everyDays: 30, lastDoneOn: null, hasOpen: false }, '2026-10-22')).toEqual({ dueOn: '2026-10-20', generate: true });
    expect(nextCadence({ startOn: '2026-01-01', everyDays: 30, lastDoneOn: '2026-10-01', hasOpen: false }, '2026-10-22')).toEqual({ dueOn: '2026-10-31', generate: false });
    expect(nextCadence({ startOn: '2026-01-01', everyDays: 30, lastDoneOn: '2026-09-24', hasOpen: false }, '2026-10-22')).toEqual({ dueOn: '2026-10-24', generate: true });
    expect(nextCadence({ startOn: '2026-01-01', everyDays: 30, lastDoneOn: '2026-09-01', hasOpen: true }, '2026-10-22').generate).toBe(false);
  });
});
