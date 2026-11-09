/** Provas e certificados dos treinamentos (Central de Playbooks): montar, responder sem ver o gabarito, tentativas, certificado e gamificação. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

const exam = {
  courseTitle: 'Atendimento de chamados (fictício)', instructions: 'Leia o playbook antes.', passPct: 70, maxAttempts: 2, hours: 4, certificate: true, countsForGamification: true, active: true,
  questions: [
    { id: 'q1', text: 'Onde se registra o chamado?', options: [{ id: 'a', text: 'Na planilha' }, { id: 'b', text: 'No sistema' }], correct: ['b'], explanation: 'Sempre no sistema.' },
    { id: 'q2', text: 'Quais etapas são obrigatórias?', options: [{ id: 'a', text: 'Abrir' }, { id: 'b', text: 'Registrar' }, { id: 'c', text: 'Ignorar' }], correct: ['a', 'b'] },
  ],
};

it('monta a prova, corrige sem revelar o gabarito, limita tentativas e emite o certificado', async () => {
  expect((await lucas.get('/playbooks')).statusCode).toBe(200);
  const pb = (await ctx.db.execute<{ id: string }>(sql`select p.id from playbooks p join playbook_versions v on v.id = p.current_version_id join users u on u.tenant_id = p.tenant_id where u.email = 'lucas@yepnet.test' and v.meta->'contexts' ? 'sistema:diretriz_gamificacao'`)).rows[0]!.id;
  await ctx.db.execute(sql`delete from training_certificates where playbook_id = ${pb}`);
  await ctx.db.execute(sql`delete from training_attempts where exam_id in (select id from training_exams where playbook_id = ${pb})`);
  await ctx.db.execute(sql`delete from training_exams where playbook_id = ${pb}`);
  expect((await lucas.get(`/playbooks/${pb}/exam`)).json()).toMatchObject({ exists: false, canEdit: false });
  expect((await lucas.put(`/playbooks/${pb}/exam`, exam)).statusCode).toBe(403); // só quem mantém
  expect((await carlos.put(`/playbooks/${pb}/exam`, { ...exam, questions: [{ ...exam.questions[0], correct: [] }] })).statusCode).toBe(422);
  const put = await carlos.put(`/playbooks/${pb}/exam`, exam);
  expect(put.statusCode, put.body).toBe(200);

  const view = await lucas.get(`/playbooks/${pb}/exam`);
  expect(view.statusCode, view.body).toBe(200);
  expect(view.json()).toMatchObject({ exists: true, canTake: true, exam: null, me: { remaining: 2, certificate: null } });
  expect(view.body).not.toMatch(/correct|Sempre no sistema/);

  const fail = (await lucas.post(`/playbooks/${pb}/exam/attempts`, { answers: { q1: ['b'], q2: ['a'] } })).json();
  expect(fail).toMatchObject({ scorePct: 50, passed: false, remaining: 1, review: null, certificate: null });
  const pass = await lucas.post(`/playbooks/${pb}/exam/attempts`, { answers: { q1: ['b'], q2: ['b', 'a'] } });
  expect(pass.statusCode, pass.body).toBe(200);
  const p = pass.json();
  expect(p).toMatchObject({ scorePct: 100, passed: true });
  expect(p.review[0].explanation).toBe('Sempre no sistema.');
  expect(p.certificate.code).toMatch(/^TRN-\d{4}-\d{6}$/);
  expect(p.certificate.gamification).toBe(true);
  expect((await lucas.post(`/playbooks/${pb}/exam/attempts`, { answers: {} })).statusCode).toBe(422); // já aprovado

  const pdf = await lucas.get(`/training-certificates/${p.certificate.id}/pdf`);
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  expect((await lucas.get(`/training-certificates/verify/${p.certificate.code}`)).json()).toMatchObject({ valid: true, hours: 4, title: 'Atendimento de chamados (fictício)' });

  // entra como curso complementar já validado
  const mine = (await lucas.get('/times/certificados')).json().mine;
  expect(mine.find((c: { title: string }) => c.title === 'Atendimento de chamados (fictício)')).toMatchObject({ status: 'aprovado', hours: 4 });
  // quem mantém vê os resultados
  expect((await carlos.get(`/playbooks/${pb}/exam`)).json().stats).toMatchObject({ people: 1, attempts: 2, passed: 1 });
});
