/** Tarefas: avulsas, delegação, subtarefas, dependências, aprovação, recorrência, comentários, tempo, arquivos e visibilidade. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const task = async (c: Client, id: string) => ok(await c.get(`/tasks/${id}`)).json();
const create = async (c: Client, body: object) => ok(await c.post('/tasks', body), 201).json().id as string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana, rafael] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
});
afterAll(async () => ctx.close());

describe('tarefas', () => {
  it('avulsa, grupos de Minhas tarefas, delegação e aviso para quem recebe', async () => {
    const mine = await create(lucas, { title: 'Revisar tabela de preços', dueOn: today(), tags: ['Comercial', 'comercial'] });
    const t = await task(lucas, mine);
    expect(t).toMatchObject({ status: 'a_fazer', bucket: 'hoje', tags: ['comercial'], links: { contact: null, project: null } });
    const asked = await create(lucas, { title: 'Enviar proposta revisada ao cliente fictício', ownerId: uid('rafael'), dueOn: plus(today(), 3) });
    const l = ok(await lucas.get('/tasks?view=minhas')).json();
    expect(l.items.find((x: { id: string }) => x.id === asked).bucket).toBe('delegadas');
    expect(l.counts.hoje).toBeGreaterThanOrEqual(1);
    expect(ok(await rafael.get('/tasks?view=minhas&bucket=proximas')).json().items.map((x: { id: string }) => x.id)).toContain(asked);
    const m = ok(await rafael.get('/me/mentions')).json();
    expect(m.items.find((x: { taskId: string }) => x.taskId === asked)).toMatchObject({ source: 'tarefa_atribuida', unread: true });
    // fora do escopo não vê
    expect((await mariana.get(`/tasks/${mine}`)).statusCode).toBe(404);
  });

  it('subtarefas e dependências bloqueiam a conclusão; ciclo é recusado; a agenda segue a mesma regra', async () => {
    const parent = await create(lucas, { title: 'Preparar visita técnica', dueOn: plus(today(), 2) });
    const sub = await create(lucas, { title: 'Separar EPI', parentId: parent });
    const before = await create(lucas, { title: 'Confirmar endereço com o cliente' });
    ok(await lucas.post(`/tasks/${parent}/dependencies`, { dependsOnId: before }), 201);
    expect((await lucas.post(`/tasks/${before}/dependencies`, { dependsOnId: parent })).statusCode).toBe(422);
    expect((await lucas.post(`/tasks/${sub}/dependencies`, { dependsOnId: sub })).statusCode).toBe(422);
    let p = await task(lucas, parent);
    expect(p.blockers).toHaveLength(2);
    expect(p.subtasks).toHaveLength(1);
    const r = await lucas.patch(`/tasks/${parent}`, { rowVersion: p.rowVersion, status: 'concluida' });
    expect(r.statusCode).toBe(422);
    expect(r.json().detail).toMatch(/Confirmar endereço/);
    // pela agenda também não conclui
    expect((await lucas.patch(`/activities/${parent}`, { rowVersion: p.rowVersion, completed: true })).statusCode).toBe(422);
    for (const id of [sub, before]) { const x = await task(lucas, id); ok(await lucas.patch(`/tasks/${id}`, { rowVersion: x.rowVersion, status: 'concluida' })); }
    p = await task(lucas, parent);
    expect(p.blockers).toEqual([]);
    ok(await lucas.patch(`/activities/${parent}`, { rowVersion: p.rowVersion, completed: true }));
    expect((await task(lucas, parent)).status).toBe('concluida');
    // subtarefa de subtarefa não existe
    expect((await lucas.post('/tasks', { title: 'Neta', parentId: sub })).statusCode).toBe(422);
  });

  it('aprovação de entrega: vai para o aprovador, só ele decide, devolver exige motivo', async () => {
    expect((await lucas.post('/tasks', { title: 'Relatório sem aprovador', requiresApproval: true })).statusCode).toBe(422);
    expect((await lucas.post('/tasks', { title: 'Aprovador é o próprio', requiresApproval: true, approverId: uid('lucas') })).statusCode).toBe(422);
    const id = await create(lucas, { title: 'Relatório mensal da carteira', requiresApproval: true, approverId: uid('ana'), dueOn: today() });
    let t = await task(lucas, id);
    expect(ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' })).json().status).toBe('em_aprovacao');
    expect(ok(await ana.get('/me/mentions')).json().items.find((x: { taskId: string }) => x.taskId === id).source).toBe('tarefa_aprovacao');
    expect((await carlos.post(`/tasks/${id}/approval`, { approve: true })).statusCode).toBe(403);
    expect((await ana.post(`/tasks/${id}/approval`, { approve: false })).statusCode).toBe(422);
    expect(ok(await ana.post(`/tasks/${id}/approval`, { approve: false, note: 'Faltam os números de outubro.' })).json().status).toBe('em_andamento');
    expect(ok(await lucas.get('/me/mentions')).json().items.find((x: { taskId: string }) => x.taskId === id).source).toBe('tarefa_devolvida');
    t = await task(lucas, id);
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' }));
    expect(ok(await ana.post(`/tasks/${id}/approval`, { approve: true })).json().status).toBe('concluida');
    t = await task(lucas, id);
    expect(t.approvedAt).toBeTruthy();
    expect(t.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['submitted', 'rejected', 'approved', 'completed']));
  });

  it('recorrência: concluir cria a próxima, com checklist zerado e sem duplicar', async () => {
    const due = today();
    const id = await create(lucas, { title: 'Conferir fila de chamados', dueOn: due, recurrence: { freq: 'semanal', interval: 1 }, checklist: [{ text: 'Abrir painel' }, { text: 'Anotar pendências' }] });
    expect((await lucas.post('/tasks', { title: 'Sem prazo', recurrence: { freq: 'diaria', interval: 1 } })).statusCode).toBe(422);
    let t = await task(lucas, id);
    expect(t.recurrenceText).toBe('Semanal');
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, checklist: t.checklist.map((c: object) => ({ ...c, done: true })) }));
    t = await task(lucas, id);
    expect(t.checklistProgress).toMatchObject({ done: 2, total: 2 });
    const r = ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' })).json();
    expect(r.next).toMatchObject({ dueOn: plus(due, 7) });
    const n = await task(lucas, r.next.id);
    expect(n).toMatchObject({ status: 'a_fazer', dueOn: plus(due, 7), checklistProgress: { done: 0, total: 2 } });
    // reabrir e concluir de novo não duplica a próxima
    t = await task(lucas, id);
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'em_andamento' }));
    t = await task(lucas, id);
    expect(ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' })).json().next).toBeNull();
  });

  it('comentário com menção, tempo com estorno, arquivo e vínculos com o CRM', async () => {
    const contact = ok(await lucas.get('/tasks?view=minhas')).json(); // aquece
    expect(contact).toBeTruthy();
    const id = await create(lucas, { title: 'Levantar documentos da licitação', estimateMinutes: 120 });
    ok(await lucas.post(`/tasks/${id}/comments`, { body: '@Mariana Costa pode conferir o edital?', mentions: [uid('mariana')] }), 201);
    // mencionada passa a acompanhar e vê a tarefa
    const seen = await task(mariana, id);
    expect(seen.participants).toContain(uid('mariana'));
    expect(seen.can.edit).toBe(false);
    expect(ok(await mariana.get('/me/mentions')).json().items.find((x: { taskId: string }) => x.taskId === id).source).toBe('tarefa_comentario');
    expect((await mariana.patch(`/tasks/${id}`, { rowVersion: seen.rowVersion, title: 'Outro' })).statusCode).toBe(403);
    ok(await mariana.post(`/tasks/${id}/time`, { minutes: 45, workedOn: today(), note: 'Leitura do edital' }), 201);
    const e = ok(await lucas.post(`/tasks/${id}/time`, { minutes: 30, workedOn: today() }), 201).json();
    expect((await lucas.post(`/tasks/${id}/time`, { minutes: 30, workedOn: plus(today(), 1) })).statusCode).toBe(422);
    ok(await lucas.post(`/tasks/${id}/time/${e.id}/reverse`));
    expect((await lucas.post(`/tasks/${id}/time/${e.id}/reverse`)).statusCode).toBe(422);
    let t = await task(lucas, id);
    expect(t.timeMinutes).toBe(45);
    const f = ok(await lucas.post(`/tasks/${id}/files`, { name: 'edital.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 ficticio').toString('base64') }), 201).json();
    const dl = ok(await lucas.get(`/tasks/${id}/files/${f.id}`));
    expect(dl.body).toContain('%PDF');
    // vincular a uma ata existente e filtrar pelo vínculo
    const arp = ok(await carlos.post('/arps', { number: 'ARP 77/2026', object: 'Conectividade fictícia', regime: 'federal', supplierName: 'Fornecedor Fictício', startAt: '2026-01-01', endAt: '2026-12-31', managerName: 'Órgão Gerenciador Fictício' }), 201).json();
    expect((await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, arpId: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(422);
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, arpId: arp.id }));
    t = await task(lucas, id);
    expect(t.links.arp.name).toBe('Ata ARP 77/2026');
    expect(ok(await carlos.get(`/tasks?view=todas&arpId=${arp.id}`)).json().items.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('checklist item a item sem conflito; situação sempre coerente com a conclusão', async () => {
    const id = await create(lucas, { title: 'Checklist concorrente' });
    const a = ok(await lucas.post(`/tasks/${id}/checklist`, { op: 'add', text: 'Item A' })).json().checklist[0];
    ok(await lucas.post(`/tasks/${id}/checklist`, { op: 'add', text: 'Item B' }));
    // duas marcações seguidas, sem versão: as duas valem
    const [r1, r2] = await Promise.all([lucas.post(`/tasks/${id}/checklist`, { op: 'toggle', itemId: a.id, done: true }), lucas.post(`/tasks/${id}/checklist`, { op: 'rename', itemId: a.id, text: 'Item A revisado' })]);
    ok(r1); ok(r2);
    const t = await task(lucas, id);
    expect(t.checklist).toEqual([expect.objectContaining({ text: 'Item A revisado', done: true, doneBy: uid('lucas') }), expect.objectContaining({ text: 'Item B', done: false })]);
    expect((await mariana.post(`/tasks/${id}/checklist`, { op: 'add', text: 'x' })).statusCode).toBe(404);
    // nenhuma atividade concluída fica com situação aberta (dados antigos e qualquer caminho de gravação)
    const bad = await ctx.db.execute(sql`select count(*)::int n from activities where (completed_at is not null) <> (status = 'concluida')`);
    expect((bad.rows[0] as { n: number }).n).toBe(0);
  });

  it('modelos de tarefa e aguardando terceiros', async () => {
    const tpl = ok(await ana.post('/task-templates', { name: 'Checagem de contrato', title: 'Checar contrato', checklist: [{ text: 'Vigência' }, { text: 'Reajuste' }], tags: ['contratos'], estimateMinutes: 60 }), 201).json();
    const id = await create(ana, { title: 'Checar contrato da escola fictícia', templateId: tpl.id });
    let t = await task(ana, id);
    expect(t).toMatchObject({ tags: ['contratos'], estimateMinutes: 60, checklistProgress: { total: 2 } });
    ok(await ana.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'aguardando', waitingOn: 'Jurídico do cliente' }));
    t = await task(ana, id);
    expect(t).toMatchObject({ status: 'aguardando', waitingOn: 'Jurídico do cliente', bucket: 'aguardando' });
    expect((await ana.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'em_aprovacao' })).statusCode).toBe(422);
    expect((await lucas.del(`/task-templates/${tpl.id}`)).statusCode).toBe(403);
  });
});
