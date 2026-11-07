import { describe, expect, it } from 'vitest';
import { componentRef, componentsForStage, journeyCredits, scoreJourneyErrors, slugKey, type ScoreJourney } from './scoreJourneys';

// pesos de teste; na empresa vêm da regra aprovada
const LIC: ScoreJourney = {
  key: 'licitacao', name: 'Licitação', pipelineId: 'p-lic', wonPoints: 40,
  components: [
    { key: 'edital', name: 'Análise do edital', stageKey: 'qualificacao', points: 8, dueDays: 2 },
    { key: 'documentos', name: 'Documentação de habilitação', stageKey: 'proposta', points: 10, dueDays: 3 },
    { key: 'sessao', name: 'Acompanhar a sessão', stageKey: 'disputa', points: 12, dueDays: 0 },
  ],
};

describe('jornadas de pontuação', () => {
  it('validação e chaves', () => {
    expect(scoreJourneyErrors([LIC])).toEqual([]);
    expect(scoreJourneyErrors([LIC, { ...LIC, key: 'outra' }]).join(' ')).toMatch(/já tem outra jornada/);
    expect(scoreJourneyErrors([{ ...LIC, components: [] }]).join(' ')).toMatch(/pelo menos uma tarefa/);
    expect(scoreJourneyErrors([{ ...LIC, components: [LIC.components[0]!, LIC.components[0]!] }]).join(' ')).toMatch(/repetida/);
    expect(slugKey('Análise do Edital!')).toBe('analise_do_edital');
  });
  it('tarefas por etapa', () => {
    expect(componentsForStage(LIC, 'proposta', false).map((c) => c.key)).toEqual(['documentos']);
    expect(componentsForStage(LIC, 'qualificacao', true).map((c) => c.key)).toEqual(['edital']);
  });
  it('tarefa concluída pontua quem concluiu; ganho dividido pelo que cada um fez', () => {
    const tasks = [
      { opportunityId: 'o1', ref: componentRef('licitacao', 'edital'), userId: 'assistente', inPeriod: true },
      { opportunityId: 'o1', ref: componentRef('licitacao', 'documentos'), userId: 'analista', inPeriod: true },
      { opportunityId: 'o1', ref: componentRef('licitacao', 'sessao'), userId: 'analista', inPeriod: false }, // concluída em outro mês: só conta no ganho
      { opportunityId: 'o1', ref: componentRef('licitacao', 'removida'), userId: 'analista', inPeriod: true }, // componente fora da regra: não pontua
    ];
    const c = journeyCredits([LIC], tasks, [{ opportunityId: 'o1', pipelineId: 'p-lic', ownerId: 'diretor' }]);
    const sum = (u: string, src: string) => c.filter((x) => x.userId === u && x.source === src).reduce((t, x) => t + x.points, 0);
    expect(sum('assistente', 'tarefa')).toBe(8);
    expect(sum('analista', 'tarefa')).toBe(10);
    // ganho 40: assistente 8/30, analista 22/30
    expect(sum('assistente', 'ganho')).toBeCloseTo(10.7, 5);
    expect(sum('analista', 'ganho')).toBeCloseTo(29.3, 5);
  });
  it('ganho sem tarefa da jornada concluída não gera pontos individuais; funil sem jornada não pontua', () => {
    const c = journeyCredits([LIC], [], [{ opportunityId: 'o2', pipelineId: 'p-lic', ownerId: 'dono' }, { opportunityId: 'o3', pipelineId: 'outro', ownerId: 'dono' }]);
    expect(c).toEqual([]);
  });
});
