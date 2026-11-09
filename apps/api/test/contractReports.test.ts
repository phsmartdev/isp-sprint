/**
 * Relatório mensal do contrato: termos no cadastro, aviso de inclusão na rotina (uma vez por configuração),
 * lembrete X dias antes do prazo (alerta + tarefa + aviso) e modelos escritos pela empresa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays, nextReportDue } from '@isp/domain';
import { setTransportFactory } from '../src/services/email';
import { runContractAlerts } from '../src/services/contractAlerts';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const sent: { to: string; subject: string; text: string }[] = [];
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let contractId = '';
const anaSectors: string[] = [];

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: true }));
  const uj = ok(await carlos.get('/admin/users')).json();
  const me = (Array.isArray(uj) ? uj : uj.items ?? uj.users).find((u: { id: string }) => u.id === ana.me.user.id);
  anaSectors.push(...(me?.sectors ?? []));
  ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { sectors: ['financeiro'] }));
  // contrato vigente que não seja de telecom (telecom exige o cadastro Zenith para salvar nova versão)
  const [row] = (await ctx.db.execute(sql`select c.id from contracts c join contract_versions v on v.contract_id = c.id and v.version = c.current_version where c.stage = 'vigente' and coalesce(v.service_type, '') <> 'telecom' order by c.created_at limit 1`)).rows as { id: string }[];
  contractId = row!.id;
});
afterAll(async () => {
  await carlos.patch(`/admin/users/${ana.me.user.id}`, { sectors: anaSectors });
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.db.execute(sql`update contract_settings set settings = settings - 'reportMessages'`);
  await ctx.close();
});

describe('relatório mensal do contrato', () => {
  it('modelos: só quem administra altera; sem modelo, nada é enviado', async () => {
    expect((await lucas.put('/contract-report-messages', { messages: {} })).statusCode).toBe(403);
    expect(ok(await lucas.get('/contract-report-messages')).json()).toMatchObject({ messages: {}, canManage: false });
  });

  it('exigir relatório pede setor, validador e dia; ao salvar, avisa a inclusão na rotina uma única vez', async () => {
    const reason = 'Inclusão do relatório mensal';
    expect((await carlos.put(`/contracts/${contractId}`, { reason, version: { reportTerms: { required: true, sector: 'financeiro', validatorId: null, dueDay: 10, alertDaysBefore: 3 } } })).statusCode).toBe(422);
    ok(await carlos.put('/contract-report-messages', { messages: {
      inicio_rotina: { channels: ['email', 'glpi'], subject: 'Relatório do contrato {{contrato}} na sua rotina', body: 'Olá, {{destinatario}}. Envio pelo setor {{setor}} até o {{dia_envio}}; valida {{validador}}.', whatsapp: '', glpi: { entityId: null, groupId: null, categoryId: null } },
      lembrete: { channels: ['email'], subject: 'Lembrete: relatório {{contrato}} vence em {{proximo_envio}}', body: 'Faltam {{dias_para_envio}} dia(s).', whatsapp: '', glpi: { entityId: null, groupId: null, categoryId: null } },
    } }));
    sent.length = 0;
    ok(await carlos.put(`/contracts/${contractId}`, { reason, version: { reportTerms: { required: true, sector: 'financeiro', validatorId: carlos.me.user.id, dueDay: 10, alertDaysBefore: 3 } } }));
    const toAna = sent.find((m) => m.to === 'ana@yepnet.test')!;
    expect(toAna.text).toContain('Olá, Ana Souza. Envio pelo setor Financeiro até o dia 10; valida Carlos Silva.');
    expect(sent.some((m) => m.to === 'carlos@yepnet.test')).toBe(true);
    let n = ok(await carlos.get(`/contracts/${contractId}/report-notices`)).json().items as { event: string; channel: string; status: string; recipientName: string }[];
    expect(n.find((x) => x.channel === 'glpi')).toMatchObject({ status: 'nao_configurado', event: 'relatorio_inicio_rotina' });
    // salvar de novo com a mesma configuração não repete o aviso
    sent.length = 0;
    ok(await carlos.put(`/contracts/${contractId}`, { reason, version: { reportTerms: { required: true, sector: 'financeiro', validatorId: carlos.me.user.id, dueDay: 10, alertDaysBefore: 2 } } }));
    expect(sent).toHaveLength(0);
    n = ok(await carlos.get(`/contracts/${contractId}/report-notices`)).json().items;
    expect(n.filter((x) => x.event === 'relatorio_inicio_rotina' && x.channel === 'email').length).toBe(2);
    const d = ok(await carlos.get(`/contracts/${contractId}`)).json();
    expect(JSON.stringify(d)).toContain('"alertDaysBefore":2');
  });

  it('lembrete X dias antes do prazo: alerta, tarefa para o setor e aviso; uma vez por mês', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const due = nextReportDue(10, addDays(today, 40));
    sent.length = 0;
    await runContractAlerts(ctx.app.db, ctx.app.config, { today: addDays(due, -2) });
    const lembrete = sent.filter((m) => m.subject.startsWith('Lembrete: relatório'));
    expect(lembrete.map((m) => m.to).sort()).toEqual(['ana@yepnet.test', 'carlos@yepnet.test']);
    expect(lembrete[0]!.text).toBe('Faltam 2 dia(s).');
    const alerts = (await ctx.db.execute(sql`select kind, cycle_key, status from contract_alerts where contract_id = ${contractId} and kind = 'relatorio_mensal'`)).rows as { cycle_key: string }[];
    expect(alerts.map((a) => a.cycle_key)).toContain(due.slice(0, 7));
    sent.length = 0;
    await runContractAlerts(ctx.app.db, ctx.app.config, { today: addDays(due, -1) });
    expect(sent.filter((m) => m.subject.startsWith('Lembrete: relatório'))).toHaveLength(0);
  });

  it('desmarcar o relatório encerra o alerta aberto', async () => {
    ok(await carlos.put(`/contracts/${contractId}`, { reason: 'Cliente dispensou o relatório', version: { reportTerms: { required: false, sector: null, validatorId: null, dueDay: null, alertDaysBefore: null } } }));
    await runContractAlerts(ctx.app.db, ctx.app.config, {});
    const open = (await ctx.db.execute(sql`select 1 from contract_alerts where contract_id = ${contractId} and kind = 'relatorio_mensal' and status = 'aberto'`)).rows;
    expect(open).toHaveLength(0);
  });
});
