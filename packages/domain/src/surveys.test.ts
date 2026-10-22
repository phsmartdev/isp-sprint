import { describe, expect, it } from 'vitest';
import { SURVEY_STARTER, answerErrors, inviteStatus, npsOf, updatesFrom, validateSurvey, type SurveyDefinition } from './surveys';

const base: SurveyDefinition = { ...SURVEY_STARTER };
const q = (o: Partial<SurveyDefinition['questions'][number]>): SurveyDefinition['questions'][number] => ({ key: 'x', type: 'escolha', text: 'Pergunta?', required: false, destination: 'nenhum', mode: 'automatica', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], ...o });

describe('pesquisas', () => {
  it('modelo inicial é válido; influência nunca é destino', () => {
    expect(validateSurvey(base)).toEqual([]);
    const bad = validateSurvey({ ...base, questions: [q({ destination: 'stakeholder_influencia' as never })] });
    expect(bad.join(' ')).toMatch(/poder de influência/);
  });
  it('tipo e destino coerentes; posicionamento e contato exigem revisão; destino único', () => {
    expect(validateSurvey({ ...base, questions: [q({ type: 'texto', destination: 'cs_nps' })] }).join(' ')).toMatch(/só aceita/);
    expect(validateSurvey({ ...base, questions: [q({ key: 'p', destination: 'stakeholder_posicionamento', options: [{ key: 'a', label: 'Apoio', maps: 'favoravel' }, { key: 'b', label: 'Contra', maps: 'opositor' }] })] }).join(' ')).toMatch(/revisão/);
    expect(validateSurvey({ ...base, questions: [q({ key: 'i', destination: 'stakeholder_interesse', options: [{ key: 'a', label: 'A', maps: 'altissimo' }, { key: 'b', label: 'B' }] })] }).join(' ')).toMatch(/valor inválido/);
    expect(validateSurvey({ ...base, questions: [...base.questions, q({ key: 'n2', type: 'nps', destination: 'cs_nps' })] }).join(' ')).toMatch(/já usa este destino/);
  });
  it('respostas: obrigatórias e tipos; o que vai para o cadastro', () => {
    expect(answerErrors(base, {})).toEqual({ nps: 'Responda esta pergunta.' });
    expect(answerErrors(base, { nps: 11, csat: 0 })).toEqual({ nps: 'Resposta inválida.', csat: 'Resposta inválida.' });
    expect(answerErrors(base, { nps: 9, csat: 4, comentario: 'Ótimo' })).toEqual({});
    const d: SurveyDefinition = { ...base, questions: [...base.questions, q({ key: 'int', destination: 'stakeholder_interesse', mode: 'automatica', options: [{ key: 'm', label: 'Muito', maps: 'alto' }, { key: 'p', label: 'Pouco', maps: 'baixo' }] }), q({ key: 'tel', type: 'texto', destination: 'pessoa_telefone', mode: 'pendente' })] };
    expect(updatesFrom(d, { nps: 10, comentario: 'x', int: 'm', tel: ' 79 9999-0000 ' })).toEqual([
      { questionKey: 'nps', destination: 'cs_nps', value: 10, mode: 'automatica' },
      { questionKey: 'int', destination: 'stakeholder_interesse', value: 'alto', mode: 'automatica' },
      { questionKey: 'tel', destination: 'pessoa_telefone', value: '79 9999-0000', mode: 'pendente' },
    ]);
  });
  it('NPS e situação do convite', () => {
    expect(npsOf([10, 9, 8, 6])).toBe(25);
    expect(npsOf([])).toBeNull();
    const now = new Date('2026-10-21T12:00:00Z');
    expect(inviteStatus({ respondedAt: null, canceledAt: null, expiresAt: '2026-10-30', openedAt: null }, now)).toBe('enviado');
    expect(inviteStatus({ respondedAt: null, canceledAt: null, expiresAt: '2026-10-20', openedAt: null }, now)).toBe('expirado');
    expect(inviteStatus({ respondedAt: '2026-10-21', canceledAt: null, expiresAt: '2026-10-20', openedAt: 'x' }, now)).toBe('respondido');
  });
});
