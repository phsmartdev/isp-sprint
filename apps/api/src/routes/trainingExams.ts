/**
 * Central de Playbooks (wiki) → provas e certificados dos treinamentos.
 * Quem mantém o playbook monta a prova; quem pode ler faz a prova na versão vigente. Aprovado, recebe o certificado
 * (PDF com código), que entra como curso complementar validado na gamificação quando a prova estiver marcada para isso.
 * As respostas certas nunca saem para quem faz a prova antes da aprovação.
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { certificateCode, examErrors, gradeExam, publicExam, type TrainingExam } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { canEditPb, isDirector, isManager, readerAllows, viewerOf } from '../services/playbooks';
import { todayIn } from '../services/vacations';
import { trainingCertificatePdf } from '../services/trainingCertificate';
import { areasOf } from './certificates';

const A = { tag: 'Playbooks', anyAuthenticated: true as const };

const ExamBody = z.object({
  courseTitle: z.string().trim().max(200).nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(40), text: z.string().trim().max(2000),
    options: z.array(z.object({ id: z.string().trim().min(1).max(40), text: z.string().trim().max(500) })).max(8),
    correct: z.array(z.string().max(40)).max(8), explanation: z.string().trim().max(1000).nullable().optional(),
  })).max(100),
  passPct: z.number().int(), maxAttempts: z.number().int(), hours: z.number().int(), certificate: z.boolean(), countsForGamification: z.boolean(),
  active: z.boolean().default(true),
});

async function loadPb(db: DbOrTx, auth: AuthContext, id: string) {
  const [p] = await db.select().from(s.playbooks).where(and(eq(s.playbooks.id, id), eq(s.playbooks.tenantId, auth.tenantId)));
  if (!p) throw notFound('Playbook não encontrado.');
  return p;
}
async function access(db: DbOrTx, auth: AuthContext, id: string) {
  const p = await loadPb(db, auth, id);
  const editor = await canEditPb(db, auth, p);
  const reader = readerAllows(p, await viewerOf(db, auth));
  if (!reader && !editor && !isDirector(auth) && !isManager(auth)) throw notFound('Playbook não encontrado.');
  return { p, editor, reader };
}
const examOf = async (db: DbOrTx, playbookId: string) => (await db.select().from(s.trainingExams).where(eq(s.trainingExams.playbookId, playbookId)))[0] ?? null;

export const trainingExamRoutes = [
  defineRoute({
    method: 'GET', url: '/playbooks/:id/exam', summary: 'Prova do treinamento: para quem faz, sem as respostas; para quem mantém, completa com resultados. Minhas tentativas e meu certificado', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { p, editor, reader } = await access(app.db, auth, params.id);
      const ex = await examOf(app.db, p.id);
      if (!ex) return { exists: false, canEdit: editor, exam: null };
      const cfg = ex.config as unknown as TrainingExam;
      const attempts = await app.db.select({ id: s.trainingAttempts.id, scoreBp: s.trainingAttempts.scoreBp, passed: s.trainingAttempts.passed, createdAt: s.trainingAttempts.createdAt }).from(s.trainingAttempts)
        .where(and(eq(s.trainingAttempts.examId, ex.id), eq(s.trainingAttempts.userId, auth.userId))).orderBy(desc(s.trainingAttempts.createdAt));
      const [cert] = await app.db.select({ id: s.trainingCertificates.id, code: s.trainingCertificates.code, issuedOn: s.trainingCertificates.issuedOn, scoreBp: s.trainingCertificates.scoreBp, hours: s.trainingCertificates.hours, gamification: s.trainingCertificates.gamificationCertificateId })
        .from(s.trainingCertificates).where(and(eq(s.trainingCertificates.examId, ex.id), eq(s.trainingCertificates.userId, auth.userId)));
      const stats = editor ? (await app.db.execute<{ people: number; attempts: number; passed: number }>(sql`select count(distinct user_id)::int as people, count(*)::int as attempts, count(distinct user_id) filter (where passed)::int as passed from training_attempts where exam_id = ${ex.id}`)).rows[0] : null;
      if (!ex.active && !editor) return { exists: false, canEdit: false, exam: null };
      return {
        exists: true, active: ex.active, version: ex.version, canEdit: editor, canTake: reader && p.status === 'ativo' && !!p.currentVersionId && ex.active,
        exam: editor ? cfg : null, view: publicExam(cfg),
        me: {
          attempts: attempts.map((a) => ({ id: a.id, scorePct: a.scoreBp / 100, passed: a.passed, at: a.createdAt })),
          remaining: cfg.maxAttempts ? Math.max(0, cfg.maxAttempts - attempts.length) : null,
          passed: attempts.some((a) => a.passed),
          certificate: cert ? { id: cert.id, code: cert.code, issuedOn: cert.issuedOn, scorePct: cert.scoreBp / 100, hours: cert.hours, gamification: !!cert.gamification } : null,
        },
        stats,
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/playbooks/:id/exam', summary: 'Cria ou altera a prova do treinamento (quem mantém o playbook). Tentativas e certificados já emitidos não mudam', ...A, params: IdParams, body: ExamBody,
    handler: async ({ app, auth, params, body, req }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden('Só quem mantém este playbook monta a prova.');
      const { active, ...cfg } = body;
      const errs = examErrors(cfg);
      if (errs.length) throw unprocessable(errs.join(' '));
      const cur = await examOf(app.db, p.id);
      const [row] = cur
        ? await app.db.update(s.trainingExams).set({ config: cfg as unknown as Record<string, unknown>, active, version: cur.version + 1, updatedBy: auth.userId, updatedAt: new Date() }).where(eq(s.trainingExams.id, cur.id)).returning()
        : await app.db.insert(s.trainingExams).values({ tenantId: auth.tenantId, playbookId: p.id, config: cfg as unknown as Record<string, unknown>, active, updatedBy: auth.userId }).returning();
      await audit(app.db, req, { action: cur ? 'training_exam.update' : 'training_exam.create', entityType: 'playbook', entityId: p.id, metadata: { questions: cfg.questions.length, version: row!.version, active } });
      return { version: row!.version, active: row!.active };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/exam/attempts', summary: 'Envia as respostas da prova: corrige, registra a tentativa e, aprovado, emite o certificado', ...A, params: IdParams,
    body: z.object({ answers: z.record(z.string().max(40), z.array(z.string().max(40)).max(8)) }),
    handler: async ({ app, auth, params, body, req }) => {
      const { p, reader } = await access(app.db, auth, params.id);
      if (!reader || p.status !== 'ativo' || !p.currentVersionId) throw forbidden('A prova é feita na versão vigente, por quem pode ler o playbook.');
      const ex = await examOf(app.db, p.id);
      if (!ex || !ex.active) throw notFound('Este treinamento não tem prova ativa.');
      const cfg = ex.config as unknown as TrainingExam;
      return app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`exam:${ex.id}:${auth.userId}`}))`);
        const prev = await tx.select({ passed: s.trainingAttempts.passed }).from(s.trainingAttempts).where(and(eq(s.trainingAttempts.examId, ex.id), eq(s.trainingAttempts.userId, auth.userId)));
        if (prev.some((a) => a.passed)) throw unprocessable('Você já foi aprovado nesta prova.');
        if (cfg.maxAttempts && prev.length >= cfg.maxAttempts) throw unprocessable('Você usou todas as tentativas desta prova. Fale com quem mantém o treinamento.');
        const g = gradeExam(cfg, body.answers);
        const [att] = await tx.insert(s.trainingAttempts).values({ tenantId: auth.tenantId, examId: ex.id, userId: auth.userId, examVersion: ex.version, answers: body.answers, scoreBp: Math.round(g.scorePct * 100), passed: g.passed }).returning({ id: s.trainingAttempts.id });
        let certificate: { id: string; code: string; gamification: boolean } | null = null;
        if (g.passed && cfg.certificate) {
          const today = todayIn(auth.timezone);
          const year = Number(today.slice(0, 4));
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trn-cert:${auth.tenantId}:${year}`}))`);
          const [{ n }] = await tx.select({ n: count() }).from(s.trainingCertificates).where(and(eq(s.trainingCertificates.tenantId, auth.tenantId), sql`extract(year from ${s.trainingCertificates.issuedOn}) = ${year}`)) as [{ n: number }];
          const code = certificateCode(year, Number(n) + 1);
          const [u] = await tx.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, auth.userId));
          const [t] = await tx.select({ name: s.tenants.name }).from(s.tenants).where(eq(s.tenants.id, auth.tenantId));
          const course = cfg.courseTitle?.trim() || p.title;
          const pdf = await trainingCertificatePdf({ company: t?.name ?? '', person: u?.name ?? '', course, playbook: p.code, hours: cfg.hours, scorePct: g.scorePct, issuedOn: today, code });
          let gamId: string | null = null;
          if (cfg.countsForGamification) {
            // conta como curso complementar já validado (a prova é a validação); a área é a primeira da pessoa
            const area = (await areasOf(tx, auth.tenantId, auth.userId))[0] ?? 'Treinamento interno';
            const [gc] = await tx.insert(s.gamificationCertificates).values({ tenantId: auth.tenantId, userId: auth.userId, title: course.slice(0, 200), institution: 'Treinamento interno (Central de Playbooks)', area, hours: cfg.hours, completedOn: today, fileName: `${code}.pdf`, mime: 'application/pdf', data: pdf, status: 'aprovado', decidedAt: new Date(), approvedOn: today, decisionNote: `Validado pela aprovação na prova do treinamento ${p.code} (${g.scorePct}%).` }).returning({ id: s.gamificationCertificates.id });
            gamId = gc!.id;
          }
          const [c] = await tx.insert(s.trainingCertificates).values({ tenantId: auth.tenantId, examId: ex.id, playbookId: p.id, userId: auth.userId, attemptId: att!.id, code, title: course, hours: cfg.hours, scoreBp: Math.round(g.scorePct * 100), issuedOn: today, data: pdf, gamificationCertificateId: gamId }).returning({ id: s.trainingCertificates.id });
          certificate = { id: c!.id, code, gamification: !!gamId };
        }
        await audit(tx, req, { action: g.passed ? 'training_exam.passed' : 'training_exam.failed', entityType: 'playbook', entityId: p.id, metadata: { score: g.scorePct, certificate: certificate?.code ?? null } });
        // aprovado: mostra o gabarito para revisão; reprovado: só o que errou
        const review = g.passed ? cfg.questions.map((q) => ({ id: q.id, correct: q.correct, explanation: q.explanation ?? null })) : null;
        const left = cfg.maxAttempts ? Math.max(0, cfg.maxAttempts - prev.length - 1) : null;
        return { ...g, passPct: cfg.passPct, remaining: left, review, certificate };
      });
    },
  }),
  defineRoute({
    method: 'GET', url: '/training-certificates/:id/pdf', summary: 'Baixa o certificado do treinamento (a própria pessoa, quem mantém o playbook ou a gestão)', ...A, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [c] = await app.db.select().from(s.trainingCertificates).where(and(eq(s.trainingCertificates.id, params.id), eq(s.trainingCertificates.tenantId, auth.tenantId)));
      if (!c) throw notFound('Certificado não encontrado.');
      if (c.userId !== auth.userId && !isDirector(auth) && !isManager(auth) && !(await canEditPb(app.db, auth, await loadPb(app.db, auth, c.playbookId)))) throw notFound('Certificado não encontrado.');
      return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${c.code}.pdf"`).header('cache-control', 'private, no-store').send(c.data);
    },
  }),
  defineRoute({
    method: 'GET', url: '/training-certificates/verify/:code', summary: 'Confere um certificado de treinamento pelo código (qualquer pessoa da empresa)', ...A,
    params: z.object({ code: z.string().regex(/^TRN-\d{4}-\d{6}$/) }),
    handler: async ({ app, auth, params }) => {
      const [c] = await app.db.select({ title: s.trainingCertificates.title, hours: s.trainingCertificates.hours, issuedOn: s.trainingCertificates.issuedOn, person: s.users.name }).from(s.trainingCertificates)
        .innerJoin(s.users, eq(s.users.id, s.trainingCertificates.userId)).where(and(eq(s.trainingCertificates.tenantId, auth.tenantId), eq(s.trainingCertificates.code, params.code)));
      if (!c) return { valid: false as const };
      return { valid: true as const, ...c };
    },
  }),
];
