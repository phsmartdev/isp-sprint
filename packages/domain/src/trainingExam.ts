/**
 * Provas e certificados dos treinamentos da Central de Playbooks (wiki).
 * Quem mantém o playbook monta a prova (questões de múltipla escolha, nota mínima, tentativas, carga horária).
 * Quem lê faz a prova; aprovado, recebe o certificado (PDF com código de verificação), que pode valer pontos
 * como certificado de curso complementar na gamificação. As respostas certas nunca vão para quem faz a prova.
 */
export type ExamOption = { id: string; text: string };
export type ExamQuestion = { id: string; text: string; options: ExamOption[]; correct: string[]; explanation?: string | null };
export type TrainingExam = {
  /** nome do curso no certificado (padrão: título do playbook) */
  courseTitle?: string | null;
  instructions?: string | null;
  questions: ExamQuestion[];
  /** nota mínima para aprovação, em % (1 a 100) */
  passPct: number;
  /** tentativas por pessoa (0 = sem limite) */
  maxAttempts: number;
  /** carga horária do certificado, em horas */
  hours: number;
  /** emite certificado ao ser aprovado */
  certificate: boolean;
  /** o certificado entra como curso complementar na gamificação (validado pela prova) */
  countsForGamification: boolean;
};

export const DEFAULT_TRAINING_EXAM: TrainingExam = { courseTitle: null, instructions: null, questions: [], passPct: 70, maxAttempts: 3, hours: 2, certificate: true, countsForGamification: true };

export function examErrors(e: TrainingExam): string[] {
  const out: string[] = [];
  if (!e.questions.length) out.push('Cadastre pelo menos uma questão.');
  if (e.questions.length > 100) out.push('No máximo 100 questões.');
  if (!Number.isInteger(e.passPct) || e.passPct < 1 || e.passPct > 100) out.push('Nota mínima entre 1% e 100%.');
  if (!Number.isInteger(e.maxAttempts) || e.maxAttempts < 0 || e.maxAttempts > 20) out.push('Tentativas entre 0 (sem limite) e 20.');
  if (!Number.isInteger(e.hours) || e.hours < 0 || e.hours > 2000) out.push('Carga horária entre 0 e 2000 horas.');
  if (e.certificate && e.hours < 1) out.push('Certificado precisa de carga horária (pelo menos 1 hora).');
  if (e.countsForGamification && !e.certificate) out.push('Para valer na gamificação, a prova precisa emitir certificado.');
  if ((e.courseTitle ?? '').length > 200) out.push('Nome do curso com até 200 letras.');
  const ids = new Set<string>();
  e.questions.forEach((q, i) => {
    const n = `Questão ${i + 1}`;
    if (!q.id || ids.has(q.id)) out.push(`${n}: identificador repetido.`);
    ids.add(q.id);
    if (!q.text.trim() || q.text.length > 2000) out.push(`${n}: escreva o enunciado (até 2000 letras).`);
    if (q.options.length < 2 || q.options.length > 8) out.push(`${n}: de 2 a 8 alternativas.`);
    const oids = new Set(q.options.map((o) => o.id));
    if (oids.size !== q.options.length) out.push(`${n}: alternativas repetidas.`);
    if (q.options.some((o) => !o.text.trim() || o.text.length > 500)) out.push(`${n}: toda alternativa precisa de texto (até 500 letras).`);
    if (!q.correct.length) out.push(`${n}: marque a alternativa correta.`);
    if (q.correct.some((c) => !oids.has(c))) out.push(`${n}: alternativa correta inexistente.`);
    if ((q.explanation ?? '').length > 1000) out.push(`${n}: explicação com até 1000 letras.`);
  });
  return out;
}

/** Versão da prova para quem vai responder: sem as respostas certas nem as explicações. */
export function publicExam(e: TrainingExam) {
  return {
    courseTitle: e.courseTitle ?? null, instructions: e.instructions ?? null, passPct: e.passPct, maxAttempts: e.maxAttempts, hours: e.hours, certificate: e.certificate, countsForGamification: e.countsForGamification,
    questions: e.questions.map((q) => ({ id: q.id, text: q.text, multiple: q.correct.length > 1, options: q.options })),
  };
}

export type ExamAnswers = Record<string, string[]>;
export type ExamGrade = { total: number; correct: number; scorePct: number; passed: boolean; perQuestion: { id: string; correct: boolean }[] };

/** Corrige: a questão vale quando as alternativas marcadas são exatamente as corretas. */
export function gradeExam(e: TrainingExam, answers: ExamAnswers): ExamGrade {
  const perQuestion = e.questions.map((q) => {
    const got = new Set(answers[q.id] ?? []);
    return { id: q.id, correct: got.size === q.correct.length && q.correct.every((c) => got.has(c)) };
  });
  const correct = perQuestion.filter((p) => p.correct).length;
  const total = e.questions.length;
  const scorePct = total ? Math.round((correct / total) * 1000) / 10 : 0;
  return { total, correct, scorePct, passed: total > 0 && scorePct >= e.passPct, perQuestion };
}

/** Código de verificação do certificado: TRN-AAAA-NNNNNN. */
export const certificateCode = (year: number, seq: number) => `TRN-${year}-${String(seq).padStart(6, '0')}`;
