import { describe, expect, it } from 'vitest';
import {
  creditIntervals, emptyTracker, enrollmentStatus, freshParts, isoDurationSeconds, lessonDone, lockedLessons, mergeIntervals, parseYoutube,
  structureErrors, trackProgress, trackSample, watchPct, gradeQuiz, quizErrors, quizForLearner, quizStatus, parseQuizText, type LessonState, type PlayerSample, type TrackQuiz,
} from './academy';

describe('YouTube: links e códigos', () => {
  it('reconhece vídeo e playlist nas formas comuns', () => {
    const v = { kind: 'video', id: 'dQw4w9WgXcQ' };
    for (const s of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ?t=10', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG']) expect(parseYoutube(s)).toEqual(v);
    const p = { kind: 'playlist', id: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' };
    for (const s of ['PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', 'https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG']) expect(parseYoutube(s)).toEqual(p);
    for (const s of ['', 'https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'abc']) expect(parseYoutube(s)).toBeNull();
    expect(isoDurationSeconds('PT1H2M3S')).toBe(3723);
    expect(isoDurationSeconds('PT45S')).toBe(45);
    expect(isoDurationSeconds('bad')).toBeNull();
  });
});

describe('motor de progresso', () => {
  const play = (st: ReturnType<typeof emptyTracker>, xs: PlayerSample[]) => xs.reduce(trackSample, st);
  it('reprodução contínua conta; arrastar a barra até o fim não conta o pulado', () => {
    const s = play(emptyTracker(), [0, 1, 2, 3, 4, 5].map((t) => ({ t, pos: t, playing: true, rate: 1 })));
    expect(s.pending).toEqual([[0, 5]]);
    // arrasta de 5 para 95 em 1 s: o salto não conta, e volta a contar dali em diante
    const s2 = play(s, [{ t: 6, pos: 95, playing: true, rate: 1 }, { t: 7, pos: 96, playing: true, rate: 1 }, { t: 8, pos: 97, playing: true, rate: 1 }]);
    expect(s2.pending).toEqual([[0, 5], [95, 97]]);
    // pausado não conta
    const s3 = play(s2, [{ t: 9, pos: 97, playing: false, rate: 1 }, { t: 30, pos: 97, playing: false, rate: 1 }]);
    expect(s3.pending).toEqual(s2.pending);
    // 2x anda o dobro e conta
    const s4 = play(emptyTracker(), [{ t: 0, pos: 10, playing: true, rate: 2 }, { t: 1, pos: 12, playing: true, rate: 2 }]);
    expect(s4.pending).toEqual([[10, 12]]);
  });

  it('rever um trecho não soma de novo; o crédito respeita o relógio e a duração', () => {
    const a = creditIntervals({ existing: [[0, 30]], incoming: [[10, 40]], durationSeconds: 100, elapsedSeconds: 10 });
    expect(a.credited).toBe(10);
    expect(a.merged).toEqual([[0, 40]]);
    // repetição pura: nada novo
    expect(creditIntervals({ existing: [[0, 40]], incoming: [[5, 35]], durationSeconds: 100, elapsedSeconds: 30 }).credited).toBe(0);
    // envio forjado de 90 s em 10 s de relógio: credita no máximo 10 × 2 + 5
    const f = creditIntervals({ existing: [], incoming: [[0, 90]], durationSeconds: 100, elapsedSeconds: 10 });
    expect(f.credited).toBe(25);
    expect(f.rejected).toBe(65);
    // além da duração é cortado
    expect(creditIntervals({ existing: [], incoming: [[95, 130]], durationSeconds: 100, elapsedSeconds: 60 }).merged).toEqual([[95, 100]]);
    expect(freshParts([[0, 10], [20, 30]], [[5, 25]])).toEqual([[10, 20]]);
    expect(mergeIntervals([[3, 4], [0, 1], [1.1, 2]])).toEqual([[0, 2], [3, 4]]);
  });

  it('duas sessões ao mesmo tempo não dobram o progresso (crédito acumulado pelo mesmo relógio)', () => {
    // duas abas mandam trechos diferentes no mesmo intervalo de 10 s: o segundo envio já não tem tempo de relógio
    const first = creditIntervals({ existing: [], incoming: [[0, 10]], durationSeconds: 600, elapsedSeconds: 10, slackSeconds: 0 });
    const second = creditIntervals({ existing: first.merged, incoming: [[300, 310]], durationSeconds: 600, elapsedSeconds: 0, slackSeconds: 0 });
    expect(first.credited + second.credited).toBe(10);
  });

  it('conclusão da aula pelo mínimo e trilha por quantidade (A) ou por duração (B)', () => {
    expect(watchPct(45, 100)).toBe(45);
    expect(lessonDone(90, 100, 90)).toBe(true);
    expect(lessonDone(89, 100, 90)).toBe(false);
    expect(lessonDone(99.2, 100, 100)).toBe(true);
    expect(lessonDone(50, null, 50)).toBe(false);
    const L = (id: string, dur: number, watched: number, done: boolean, extra: Partial<LessonState> = {}): LessonState => ({ lessonId: id, required: true, available: true, durationSeconds: dur, watchedSeconds: watched, done, ...extra });
    // 10 vídeos, 5 concluídos = 50% no método A
    const ten = Array.from({ length: 10 }, (_, i) => L(`l${i}`, 60, i < 5 ? 60 : 0, i < 5));
    expect(trackProgress(ten, 'quantidade').pct).toBe(50);
    // B: um vídeo longo pesa mais que um curto
    const mixed = [L('curto', 60, 60, true), L('longo', 540, 0, false)];
    expect(trackProgress(mixed, 'quantidade').pct).toBe(50);
    expect(trackProgress(mixed, 'duracao').pct).toBe(10);
    // opcionais e indisponíveis saem da conta
    const p = trackProgress([L('a', 60, 60, true), L('b', 60, 0, false, { required: false }), L('c', 60, 0, false, { available: false })], 'quantidade');
    expect(p).toMatchObject({ pct: 100, videoComplete: true, unavailable: 1, totalRequired: 1 });
    // sequência: bloqueia depois da primeira obrigatória pendente
    expect([...lockedLessons([L('a', 60, 60, true), L('b', 60, 0, false), L('c', 60, 0, false)], true)]).toEqual(['c']);
    expect(lockedLessons([L('a', 60, 0, false), L('b', 60, 0, false)], false).size).toBe(0);
  });

  it('situação da inscrição e estrutura mínima', () => {
    expect(enrollmentStatus({ complete: false, started: true, dueOn: '2026-11-01', today: '2026-11-18' })).toBe('atrasada');
    expect(enrollmentStatus({ complete: true, started: true, dueOn: '2026-11-01', today: '2026-11-18' })).toBe('concluida');
    expect(enrollmentStatus({ complete: false, started: false, dueOn: null, today: '2026-11-18' })).toBe('nao_iniciada');
    expect(structureErrors({ courses: [] })).toContain('Inclua ao menos um curso.');
    expect(structureErrors({ courses: [{ id: 'c', title: 'C', description: null, minWatchPct: null, modules: [{ id: 'm', title: 'M', lessons: [] }] }] })).toContain('Cada módulo precisa de ao menos uma aula.');
  });
});

describe('certificado e anotações', () => {
  it('carga horária soma só as aulas concluídas; tempo da anotação', async () => {
    const { certificateWorkload, fmtWorkload, fmtTimecode, academyCertificateCode } = await import('./academy');
    const w = certificateWorkload([
      { kind: 'youtube_video', durationSeconds: 3600, done: true },
      { kind: 'youtube_video', durationSeconds: 900, done: true }, // opcional concluída também conta
      { kind: 'youtube_video', durationSeconds: 600, done: false },
      { kind: 'link', durationSeconds: null, done: true },
    ]);
    expect(w).toEqual({ seconds: 4500, lessons: 2 });
    expect(fmtWorkload(4500)).toBe('1 h 15 min');
    expect(fmtWorkload(3600)).toBe('1 h');
    expect(fmtWorkload(20)).toBe('1 min');
    expect(fmtTimecode(187)).toBe('3:07');
    expect(fmtTimecode(3725)).toBe('1:02:05');
    expect(academyCertificateCode(2026, 7)).toBe('ACD-2026-000007');
  });
});

describe('prova da trilha', () => {
  const q: TrackQuiz = { passPct: 70, maxAttempts: 2, questions: [
    { id: 'a', text: 'Um?', options: ['x', 'y'], correct: 0, explanation: null },
    { id: 'b', text: 'Dois?', options: ['x', 'y', 'z'], correct: 2, explanation: 'Porque sim.' },
    { id: 'c', text: 'Três?', options: ['x', 'y'], correct: 1, explanation: null },
  ] };
  it('corrige: sem resposta ou fora das alternativas conta como errada; aprova sem arredondar a favor', () => {
    expect(gradeQuiz(q, { a: 0, b: 2, c: 1 })).toMatchObject({ correct: 3, pct: 100, passed: true });
    const two = gradeQuiz(q, { a: 0, b: 2, c: 0 });
    expect(two).toMatchObject({ correct: 2, pct: 67, passed: false }); // 66,7% < 70%
    expect(gradeQuiz({ ...q, passPct: 66 }, { a: 0, b: 2 })).toMatchObject({ correct: 2, passed: true });
    expect(gradeQuiz(q, { a: 9, b: 2 }).results.map((r) => r.chosen)).toEqual([null, 2, null]);
  });
  it('confere a prova antes do envio', () => {
    expect(quizErrors(q)).toEqual([]);
    expect(quizErrors({ ...q, questions: [] })).toContain('A prova precisa de ao menos uma pergunta.');
    const bad = quizErrors({ ...q, questions: [{ id: 'a', text: ' ', options: ['x', 'X'], correct: 5, explanation: null }] });
    expect(bad).toEqual(['Pergunta 1: escreva o enunciado.', 'Pergunta 1: há alternativas repetidas.', 'Pergunta 1: marque a alternativa certa.']);
  });
  it('tentativas: conta usadas e restantes, para depois de aprovado ou sem tentativas', () => {
    expect(quizStatus(q, [])).toEqual({ used: 0, left: 2, best: null, passed: false, canTry: true });
    expect(quizStatus(q, [{ pct: 33, passed: false }, { pct: 67, passed: false }])).toMatchObject({ left: 0, best: 67, canTry: false });
    expect(quizStatus(q, [{ pct: 100, passed: true }])).toMatchObject({ passed: true, canTry: false });
    expect(quizStatus({ ...q, maxAttempts: null }, Array(9).fill({ pct: 0, passed: false }))).toMatchObject({ left: null, canTry: true });
  });
  it('a versão de quem responde não leva o gabarito', () => {
    expect(JSON.stringify(quizForLearner(q))).not.toMatch(/correct|explanation/);
  });
});

describe('perguntas coladas em texto', () => {
  it('lê enunciado, alternativas, a certa (* ou Resposta:) e a explicação', () => {
    let i = 0;
    const r = parseQuizText(`1. Quem deve seguir o Código
de Ética?
a) Só a diretoria
*b) Todos os colaboradores
c) Só o comercial
Explicação: vale para todos.

2) Presente acima do limite:
a) Aceitar
b) Recusar e comunicar
Resposta: B
solto aqui`, () => `q${++i}`);
    expect(r.questions).toEqual([
      { id: 'q1', text: 'Quem deve seguir o Código de Ética?', options: ['Só a diretoria', 'Todos os colaboradores', 'Só o comercial'], correct: 1, explanation: 'vale para todos.' },
      { id: 'q2', text: 'Presente acima do limite:', options: ['Aceitar', 'Recusar e comunicar'], correct: 1, explanation: null },
    ]);
    expect(r.warnings).toHaveLength(1);
  });
});
