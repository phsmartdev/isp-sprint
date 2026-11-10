/** Automações das jornadas: exceções (ex.: consumo de contrato não vai para CS), retorno de chamado e leitura de e-mail. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { runAutomations } from '../src/services/automations';
import { drainAutomationQueue, enqueueAutomation, enqueueEmailReply } from '../src/services/automationQueue';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
let opp: { id: string; tenant_id: string; pipeline_id: string };
const task = (title: string) => ({ tipo: 'criar_tarefa', titulo: title, tipoAtividade: 'tarefa', prazoDias: 1, responsavel: 'dono' });
const tasks = async (title: string) => Number(((await ctx.db.execute(sql`select count(*)::int n from activities where opportunity_id = ${opp.id} and title = ${title}`)).rows[0] as { n: number }).n);

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const c = (await carlos.post('/admin/journeys', { name: `Automações ${Date.now()}`, description: null, segments: [], copyFromId: null })).json();
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await carlos.post('/opportunities', { newContact: { name: 'Conta Automação Fictícia', segment: 'empresarial' }, planId: plan.id, pipelineId: c.id })).json();
  opp = (await ctx.db.execute(sql`select id, tenant_id, pipeline_id from opportunities where id = ${o.id}`)).rows[0] as typeof opp;
  await ctx.db.execute(sql`update opportunities set pipeline_id = ${c.id} where id = ${o.id}`);
  opp.pipeline_id = c.id;
});
afterAll(async () => ctx.close());

const addAuto = async (nome: string, gatilho: Record<string, unknown>, title: string) => {
  const r = await carlos.post(`/admin/journeys/${opp.pipeline_id}/automations`, { nome, ativo: true, gatilho, acoes: [task(title)] });
  expect(r.statusCode, r.body).toBe(201);
};

describe('automações', () => {
  it('exceção por tipo de venda: consumo de contrato não roda; registra o motivo', async () => {
    await addAuto('Fechada → CS', { tipo: 'ganha', etapa: null, dias: null, excecoes: [{ campo: 'tipo_venda', valores: ['consumo_contrato'] }] }, 'Tarefa CS');
    await ctx.db.execute(sql`update opportunities set sale_kind = 'consumo_contrato' where id = ${opp.id}`);
    const r1 = await runAutomations(ctx.db, ctx.app.config, opp.tenant_id, null, opp.id, { type: 'ganha' });
    expect(r1.find((x) => x.automation === 'Fechada → CS')?.status).toBe('ignorado');
    expect(await tasks('Tarefa CS')).toBe(0);
    const run = (await ctx.db.execute(sql`select r.detail from automation_runs r join pipeline_automations a on a.id = r.automation_id where a.name = 'Fechada → CS' and r.opportunity_id = ${opp.id} order by r.created_at desc limit 1`)).rows[0] as { detail: { reason: string } };
    expect(run.detail.reason).toMatch(/tipo de venda/);
    await ctx.db.execute(sql`update opportunities set sale_kind = 'venda_consultiva' where id = ${opp.id}`);
    await runAutomations(ctx.db, ctx.app.config, opp.tenant_id, null, opp.id, { type: 'ganha' });
    expect(await tasks('Tarefa CS')).toBe(1);
  });

  it('retorno de chamado por origem, pela fila idempotente', async () => {
    await addAuto('Retorno GLPI', { tipo: 'chamado_retorno', origem: 'glpi', excecoes: [] }, 'Dar retorno GLPI');
    await addAuto('Retorno qualquer', { tipo: 'chamado_retorno', origem: 'qualquer', excecoes: [] }, 'Dar retorno qualquer');
    await enqueueEmailReply(ctx.db, opp.tenant_id, opp.id, 'msg-ficticia-1', 'Re: proposta');
    await enqueueEmailReply(ctx.db, opp.tenant_id, opp.id, 'msg-ficticia-1', 'Re: proposta'); // mesma mensagem: uma vez só
    await enqueueAutomation(ctx.db, opp.tenant_id, opp.id, { type: 'chamado_retorno', origem: 'glpi', detail: 'Chamado GLPI #1: Solucionado' }, 'glpi:teste-1');
    const d = await drainAutomationQueue(ctx.db, ctx.app.config, opp.tenant_id);
    expect(d.processados).toBe(2);
    expect(await tasks('Dar retorno GLPI')).toBe(1); // só o do GLPI
    expect(await tasks('Dar retorno qualquer')).toBe(2); // e-mail + GLPI
    expect((await drainAutomationQueue(ctx.db, ctx.app.config, opp.tenant_id)).lidos).toBe(0);
  });

  it('leitura do e-mail: pixel registra a primeira abertura e dispara uma vez', async () => {
    await addAuto('Leu o e-mail', { tipo: 'email_lido', excecoes: [] }, 'Ligar: cliente leu');
    const token = `tok${Date.now()}abcdefghijklmnopqrstu`;
    await ctx.db.execute(sql`insert into email_messages (tenant_id, kind, to_address, subject, status, opportunity_id, open_token) values (${opp.tenant_id}, 'proposta', 'cliente@ficticio.test', 'Proposta fictícia', 'enviado', ${opp.id}, ${token})`);
    for (let i = 0; i < 3; i++) {
      const r = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/mail-open/${token}` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/gif');
    }
    const m = (await ctx.db.execute(sql`select count(*)::int n from email_opens o join email_messages e on e.id = o.email_message_id where e.open_token = ${token}`)).rows[0] as { n: number };
    expect(m.n).toBe(3);
    expect(await tasks('Ligar: cliente leu')).toBe(1);
  });
});
