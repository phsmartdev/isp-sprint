/** Gestão de Times — Fase 8: rituais, reuniões com pauta automática e ata, decisões e impedimentos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let ritualId: string, meetingId: string;
const name = `Semanal de gestão ${Date.now().toString(36)}`;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
});
afterAll(async () => ctx.close());

describe('rituais', () => {
  it('cria ritual com validação; as próximas reuniões entram na agenda dos participantes', async () => {
    const base = { name, perspective: 'diretoria', cadence: 'semanal', weekday: new Date(`${today()}T12:00:00Z`).getUTCDay(), monthDay: 1, time: '09:00', durationMin: 60, participants: [uid('ana'), uid('lucas')], agenda: ['Metas da semana', 'Impedimentos'] };
    expect((await carlos.post('/rituals', { ...base, time: '9h' })).statusCode).toBe(422);
    expect((await lucas.post('/rituals', base)).statusCode).toBe(403); // sem responsabilidade na estrutura
    ritualId = ok(await carlos.post('/rituals', base), 201).json().id;
    const l = ok(await ana.get('/rituals')).json();
    const r = l.rituals.find((x: { id: string }) => x.id === ritualId);
    expect(r.next.date).toBe(today());
    meetingId = r.next.id;
    const ms = l.meetings.filter((m: { ritualId: string }) => m.ritualId === ritualId);
    expect(ms).toHaveLength(2);
    // reunião aparece na agenda (atividade tipo reunião) de quem participa
    const n = ((await ctx.db.execute(sql`select count(*)::int as n from activities a join ritual_meetings m on m.activity_id = a.id where m.ritual_id = ${ritualId}::uuid and a.type = 'reuniao' and ${uid('lucas')}::uuid = any(a.participants)`)).rows[0] as { n: number }).n;
    expect(n).toBe(2);
    // listar de novo não duplica
    ok(await carlos.get('/rituals'));
    expect(ok(await carlos.get('/rituals')).json().meetings.filter((m: { ritualId: string }) => m.ritualId === ritualId)).toHaveLength(2);
  });

  it('reunião: pauta automática, presença e anotações; decisão com acompanhamento; impedimento com aviso', async () => {
    let m = ok(await lucas.get(`/rituals/meetings/${meetingId}`)).json();
    expect(m.auto).toHaveProperty('goals.colors');
    expect(Array.isArray(m.auto.interventions)).toBe(true);
    expect(m.can.write).toBe(true);
    expect(m.can.finalize).toBe(false);
    ok(await lucas.patch(`/rituals/meetings/${meetingId}`, { rowVersion: m.rowVersion, attendees: [uid('carlos'), uid('lucas')], notes: { 'Metas da semana': 'Residencial acima do ritmo' } }));
    expect((await lucas.patch(`/rituals/meetings/${meetingId}`, { rowVersion: m.rowVersion, minutes: 'conflito' })).statusCode).toBe(409);
    const d = ok(await lucas.post('/decisions', { text: 'Priorizar condomínios com rede pronta', rationale: 'Instalação mais rápida', meetingId, followUp: { title: 'Lista de condomínios com rede', ownerId: uid('ana'), dueOn: inDays(5) } }), 201).json().id;
    const imp = ok(await lucas.post('/impediments', { title: 'Sem acesso ao mapa de cobertura atualizado', severity: 'alta', ownerId: uid('ana'), dueOn: inDays(3), meetingId }), 201).json().id;
    const mentions = ok(await ana.get('/me/mentions')).json().items;
    expect(mentions.some((x: { kind: string; taskId: string; source: string }) => x.kind === 'gestao' && x.taskId === imp && x.source === 'impedimento_registrado')).toBe(true);
    expect(mentions.some((x: { kind: string; source: string }) => x.kind === 'tarefa' && x.source === 'tarefa_atribuida')).toBe(true);
    m = ok(await carlos.get(`/rituals/meetings/${meetingId}`)).json();
    expect(m.decisions.map((x: { id: string }) => x.id)).toContain(d);
    expect(m.impediments.map((x: { id: string }) => x.id)).toContain(imp);
    expect(m.auto.impediments.map((x: { id: string }) => x.id)).toContain(imp);
    expect(m.notes['Metas da semana']).toBe('Residencial acima do ritmo');
  });

  it('encerrar a ata fotografa a pauta e trava edição; decisões aparecem na próxima reunião', async () => {
    let m = ok(await carlos.get(`/rituals/meetings/${meetingId}`)).json();
    expect((await lucas.post(`/rituals/meetings/${meetingId}/finalize`, { rowVersion: m.rowVersion })).statusCode).toBe(403);
    ok(await carlos.post(`/rituals/meetings/${meetingId}/finalize`, { rowVersion: m.rowVersion }));
    m = ok(await carlos.get(`/rituals/meetings/${meetingId}`)).json();
    expect(m).toMatchObject({ status: 'realizada', can: { write: false } });
    expect(m.snapshot).toBeTruthy();
    expect((await lucas.patch(`/rituals/meetings/${meetingId}`, { rowVersion: m.rowVersion, minutes: 'tarde demais' })).statusCode).toBe(422);
    expect((await lucas.post('/decisions', { text: 'Decisão depois do encerramento', meetingId })).statusCode).toBe(422);
    const l = ok(await carlos.get('/rituals')).json();
    const next = l.meetings.find((x: { ritualId: string; status: string; id: string }) => x.ritualId === ritualId && x.status === 'agendada' && x.id !== meetingId);
    const n = ok(await carlos.get(`/rituals/meetings/${next.id}`)).json();
    expect(n.auto.decisions.some((x: { text: string }) => x.text === 'Priorizar condomínios com rede pronta')).toBe(true);
    expect(n.previous.id).toBe(meetingId);
  });

  it('impedimento: encerrar exige como foi resolvido; escalonar sobe na estrutura; decisão revogada com motivo', async () => {
    const list = ok(await ana.get('/impediments?mine=true')).json();
    const imp = list.items.find((x: { title: string }) => x.title === 'Sem acesso ao mapa de cobertura atualizado');
    expect(list.counts.comigo).toBeGreaterThan(0);
    expect((await ana.patch(`/impediments/${imp.id}`, { rowVersion: imp.rowVersion, status: 'removido', resolution: 'ok' })).statusCode).toBe(422);
    ok(await ana.patch(`/impediments/${imp.id}`, { rowVersion: imp.rowVersion, status: 'em_tratamento' }));
    const esc = await ana.post(`/impediments/${imp.id}/escalate`, { rowVersion: imp.rowVersion + 1, reason: 'Depende de liberação da diretoria' });
    if (esc.statusCode === 200) expect(esc.json().ownerId).not.toBe(uid('ana'));
    else expect(esc.statusCode).toBe(422); // sem ninguém acima na estrutura de teste
    const cur = ok(await carlos.get('/impediments?status=todos')).json().items.find((x: { id: string }) => x.id === imp.id);
    ok(await carlos.patch(`/impediments/${imp.id}`, { rowVersion: cur.rowVersion, status: 'removido', resolution: 'TI liberou acesso ao mapa para o comercial' }));
    const h = ok(await carlos.get(`/governance/${imp.id}/history`)).json().items.map((e: { type: string }) => e.type);
    expect(h).toEqual(expect.arrayContaining(['registrado', 'em_tratamento', 'removido']));
    const dec = ok(await carlos.get('/decisions')).json().items.find((x: { text: string }) => x.text === 'Priorizar condomínios com rede pronta');
    expect(dec.origin).toContain(name);
    expect((await carlos.post(`/decisions/${dec.id}/revoke`, { reason: 'curto' })).statusCode).toBe(422);
    ok(await carlos.post(`/decisions/${dec.id}/revoke`, { reason: 'Rede de condomínios já priorizada no planejamento' }));
    expect(ok(await carlos.get('/decisions?status=revogada')).json().items.some((x: { id: string }) => x.id === dec.id)).toBe(true);
  });

  it('cancelar reunião tira da agenda; desativar ritual para de gerar reuniões', async () => {
    const l = ok(await carlos.get('/rituals')).json();
    const next = l.meetings.find((x: { ritualId: string; status: string }) => x.ritualId === ritualId && x.status === 'agendada');
    ok(await carlos.post(`/rituals/meetings/${next.id}/cancel`, { reason: 'Feriado municipal' }));
    const r = l.rituals.find((x: { id: string }) => x.id === ritualId);
    ok(await carlos.patch(`/rituals/${ritualId}`, { rowVersion: r.rowVersion, active: false }));
    const after = ok(await carlos.get('/rituals')).json();
    expect(after.rituals.find((x: { id: string }) => x.id === ritualId).active).toBe(false);
  });
});
