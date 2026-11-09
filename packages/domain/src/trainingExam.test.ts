import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_EXAM, certificateCode, examErrors, gradeExam, publicExam, type TrainingExam } from './trainingExam';

const exam: TrainingExam = {
  ...DEFAULT_TRAINING_EXAM, passPct: 60,
  questions: [
    { id: 'q1', text: 'Qual canal registra o chamado?', options: [{ id: 'a', text: 'Telefone' }, { id: 'b', text: 'Sistema' }], correct: ['b'], explanation: 'Sempre no sistema.' },
    { id: 'q2', text: 'Marque as etapas obrigatórias', options: [{ id: 'a', text: 'Abrir' }, { id: 'b', text: 'Registrar' }, { id: 'c', text: 'Ignorar' }], correct: ['a', 'b'] },
    { id: 'q3', text: 'Prazo de retorno?', options: [{ id: 'a', text: '24 h' }, { id: 'b', text: '7 dias' }], correct: ['a'] },
  ],
};

describe('prova de treinamento', () => {
  it('valida a prova', () => {
    expect(examErrors(exam)).toEqual([]);
    expect(examErrors({ ...exam, questions: [] }).join(' ')).toMatch(/pelo menos uma questão/);
    expect(examErrors({ ...exam, questions: [{ ...exam.questions[0]!, correct: ['z'] }] }).join(' ')).toMatch(/inexistente/);
    expect(examErrors({ ...exam, certificate: false }).join(' ')).toMatch(/gamificação/);
  });
  it('não entrega as respostas certas para quem faz a prova', () => {
    const p = publicExam(exam);
    expect(JSON.stringify(p)).not.toMatch(/correct|explanation|Sempre no sistema/);
    expect(p.questions[1]!.multiple).toBe(true);
  });
  it('corrige: questão de várias respostas só vale com todas e só as certas', () => {
    const g = gradeExam(exam, { q1: ['b'], q2: ['a'], q3: ['a'] });
    expect(g).toMatchObject({ total: 3, correct: 2, scorePct: 66.7, passed: true });
    expect(g.perQuestion[1]).toEqual({ id: 'q2', correct: false });
    expect(gradeExam(exam, { q1: ['b'], q2: ['a', 'b', 'c'] }).passed).toBe(false);
    expect(certificateCode(2026, 12)).toBe('TRN-2026-000012');
  });
});
