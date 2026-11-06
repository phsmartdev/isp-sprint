/**
 * Esteira de comunicação: templates com versão, esteira desenhada (gatilho → espera → envio → condição → tarefa/fim),
 * validação do desenho, execução pela data do gatilho, aprovação obrigatória e envio com confirmação de recebimento.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays } from '@isp/domain';
import { setTransportFactory } from '../src/services/email';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const sent: { to: string; subject: string; text: string; html?: string; attachments?: { cid?: string; contentType: string }[] }[] = [];
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string; html?: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: true }));
  ok(await carlos.patch(`/admin/users/${ana.me.user.id}`, { playbookRoles: ['SC'] }));
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'contratos@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.db.execute(sql`update users set playbook_roles = '{}'`);
  await ctx.db.execute(sql`update comm_flows set active = false`);
  await ctx.close();
});

async function contractEnding(name: string, email: string, days: number) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'empresarial', email }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: `EST-${days}`, object: 'Link fictício', signedAt: addDays(today, -300), startAt: addDays(today, -300), endAt: addDays(today, days), monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] } }), 201).json().id as string;
  ok(await carlos.post(`/contracts/${id}/validate`));
  return id;
}

describe('esteira de comunicação de contratos', () => {
  let tplId = '', flowId = '', c1 = '', c2 = '';
  it('template: rascunho, variáveis conferidas, pré-visualização e versão publicada', async () => {
    expect((await lucas.post('/comm/templates', { name: 'Teste', channels: ['email'] })).statusCode).toBe(403);
    tplId = ok(await carlos.post('/comm/templates', { name: 'Aviso de renovação', channels: ['email'] }), 201).json().id;
    expect((await carlos.post(`/comm/templates/${tplId}/publish`)).statusCode).toBe(422);
    const t = (await carlos.get('/comm/templates')).json().items.find((x: { id: string }) => x.id === tplId);
    ok(await carlos.put(`/comm/templates/${tplId}`, { rowVersion: t.rowVersion, name: 'Aviso de renovação', channels: ['email'], subject: 'Renovação do contrato {{contrato}}', body: 'Olá, {{destinatario}}.\n\nO contrato **{{contrato}}** vence em {{fim_vigencia}} ({{xpto}}).' }));
    expect((await carlos.post(`/comm/templates/${tplId}/publish`)).json().detail).toMatch(/xpto/);
    const t2 = (await carlos.get('/comm/templates')).json().items.find((x: { id: string }) => x.id === tplId);
    ok(await carlos.put(`/comm/templates/${tplId}`, { rowVersion: t2.rowVersion, name: 'Aviso de renovação', channels: ['email'], subject: 'Renovação do contrato {{contrato}}', body: 'Olá, {{destinatario}}.\n\nO contrato **{{contrato}}** vence em {{fim_vigencia}}.' }));
    const pv = ok(await carlos.post('/comm/templates/preview', { subject: 'Renovação {{contrato}}', body: '**{{cliente}}**', whatsapp: '' })).json();
    expect(pv.html).toContain('<strong>Cliente Exemplo Ltda</strong>');
    expect(ok(await carlos.post(`/comm/templates/${tplId}/publish`)).json().version).toBe(1);
  });

  it('template em HTML: variáveis escapadas, scripts e eventos removidos, moldura opcional', async () => {
    const html = '<div style="color:#123"><h2>{{cliente}}</h2><script>alert(1)</script><a href="javascript:x()" onclick="y()">x</a>{{link_resposta}}</div>';
    const withFrame = ok(await carlos.post('/comm/templates/preview', { subject: 'S', body: html, whatsapp: '', format: 'html', layout: true })).json().html as string;
    expect(withFrame).toContain('<h2>Cliente Exemplo Ltda</h2>');
    expect(withFrame).not.toMatch(/<script|onclick|javascript:/i);
    expect(withFrame).toContain('Responder a esta mensagem');
    expect(withFrame).toContain('#1F3A5F'); // moldura institucional
    const bare = ok(await carlos.post('/comm/templates/preview', { subject: 'S', body: '<html><body><p>{{contrato}}</p></body></html>', whatsapp: '', format: 'html', layout: false })).json().html as string;
    expect(bare).not.toContain('#1F3A5F');
    expect(bare).toContain('<p>045/2026</p>');
  });

  it('modelo com imagens: cabeçalho e rodapé em imagem, assunto = nome com variáveis, corpo na área de altura definida, imagens em linha (cid)', async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAlgAAAAyCAIAAAAP9DKeAAAAtUlEQVR42u3VMQ0AAAgEsXeEHgyhmxUPNKmCWy7VAwBvRQIAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAArgUO6J/WfiOSTgAAAABJRU5ErkJggg==';
    expect((await lucas.post('/comm/assets', { kind: 'cabecalho', filename: 'c.png', data: PNG })).statusCode).toBe(403);
    expect(ok(await carlos.post('/comm/assets', { kind: 'cabecalho', filename: 'x.txt', data: Buffer.from('nao e imagem').toString('base64') }), 422).json().detail).toMatch(/PNG, JPG ou GIF/);
    const h = ok(await carlos.post('/comm/assets', { kind: 'cabecalho', filename: 'cabecalho.png', data: PNG }), 201).json();
    expect(h).toMatchObject({ mime: 'image/png', width: 600, height: 50, warning: null });
    const f = ok(await carlos.post('/comm/assets', { kind: 'rodape', filename: 'rodape.png', data: PNG }), 201).json();
    const img = ok(await carlos.get(`/comm/assets/${h.id}`));
    expect(img.headers['content-type']).toBe('image/png');
    const body = { name: 'Contrato {{contrato}} · {{cliente}}', channels: ['email'], subject: 'ignorado', body: 'Prezado(a) {{destinatario}},\n\nSegue o **aviso**.', format: 'modelo', headerAssetId: h.id, footerAssetId: f.id, frameHeight: 400 };
    const pv = ok(await carlos.post('/comm/templates/preview', body)).json();
    expect(pv.subject).toBe('Contrato 045/2026 · Cliente Exemplo Ltda');
    expect(pv.html).toContain('data:image/png;base64,');
    expect(pv.html).toContain('height:400px');
    const id = ok(await carlos.post('/comm/templates', body), 201).json().id;
    const saved = (await carlos.get('/comm/templates')).json().items.find((x: { id: string }) => x.id === id);
    expect(saved).toMatchObject({ subject: 'Contrato {{contrato}} · {{cliente}}', format: 'modelo', headerAssetId: h.id, footerAssetId: f.id, frameHeight: 400 });
    expect(ok(await carlos.post(`/comm/templates/${id}/publish`)).json().version).toBe(1);
    const n = sent.length;
    ok(await carlos.post(`/comm/templates/${id}/test`));
    const m = sent[n]!;
    expect(m.subject).toBe('[TESTE] Contrato 045/2026 · Cliente Exemplo Ltda');
    expect(m.html).toContain('src="cid:header@modelo"');
    expect(m.html).toContain('src="cid:footer@modelo"');
    expect(m.attachments?.map((a) => a.cid)).toEqual(['header@modelo', 'footer@modelo']);
    expect(m.text).toContain('Segue o **aviso**'.replace(/\*\*/g, '**'));
    // imagem de outra empresa ou inexistente não entra
    expect((await carlos.post('/comm/templates', { ...body, headerAssetId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(422);
  });

  it('esteira: nasce em branco; o desenho é validado; publica e liga', async () => {
    flowId = ok(await carlos.post('/comm/flows', { name: 'Renovação' }), 201).json().id;
    let f = (await carlos.get('/comm/flows')).json().items.find((x: { id: string }) => x.id === flowId);
    expect(f.graph.nodes).toHaveLength(1);
    expect((await carlos.post(`/comm/flows/${flowId}/active`, { active: true })).statusCode).toBe(422);
    const graph = {
      nodes: [
        { id: 'gatilho', type: 'gatilho', x: 0, y: 0, data: { trigger: 'renovacao' } },
        { id: 'e1', type: 'espera', x: 200, y: 0, data: { mode: 'antes', days: 90 } },
        { id: 'm1', type: 'envio', x: 400, y: 0, data: { templateId: tplId, channels: ['email'], recipients: [{ kind: 'cliente', value: '' }, { kind: 'papel', value: 'SC' }], approverRole: 'SC' } },
        { id: 'c1', type: 'condicao', x: 600, y: 0, data: { condition: 'confirmado' } },
        { id: 'f1', type: 'fim', x: 800, y: -100, data: {} },
        { id: 't1', type: 'tarefa', x: 800, y: 100, data: { taskTitle: 'Ligar para o cliente sobre a renovação', taskOwner: 'comercial', taskDays: 2 } },
        { id: 'f2', type: 'fim', x: 1000, y: 100, data: {} },
      ],
      edges: [{ id: 'a', source: 'gatilho', target: 'e1' }, { id: 'b', source: 'e1', target: 'm1' }, { id: 'c', source: 'm1', target: 'c1' }, { id: 'd', source: 'c1', target: 'f1', handle: 'sim' }, { id: 'e', source: 'c1', target: 't1', handle: 'nao' }, { id: 'f', source: 't1', target: 'f2' }],
    };
    // desenho com ciclo (a condição volta para a espera) é recusado na publicação
    const bad = { nodes: graph.nodes, edges: [...graph.edges.filter((e) => e.id !== 'e'), { id: 'x', source: 'c1', target: 'e1', handle: 'nao' }] };
    let r = ok(await carlos.put(`/comm/flows/${flowId}`, { rowVersion: f.rowVersion, name: 'Renovação', graph: bad })).json();
    expect(r.issues.map((i: { message: string }) => i.message).join(' ')).toMatch(/ciclo/);
    expect((await carlos.post(`/comm/flows/${flowId}/publish`)).statusCode).toBe(422);
    f = (await carlos.get('/comm/flows')).json().items.find((x: { id: string }) => x.id === flowId);
    r = ok(await carlos.put(`/comm/flows/${flowId}`, { rowVersion: f.rowVersion, name: 'Renovação', graph })).json();
    expect(r.issues).toEqual([]);
    ok(await carlos.post(`/comm/flows/${flowId}/publish`));
    c1 = await contractEnding('Cliente Esteira Um Fictício', 'cliente1@ficticio.test', 60);
    c2 = await contractEnding('Cliente Esteira Dois Fictício', 'cliente2@ficticio.test', 45);
    ok(await carlos.post(`/comm/flows/${flowId}/active`, { active: true }));
  });

  it('roda pela data do gatilho e para na aprovação; só o papel indicado aprova; envia com o botão de confirmação', async () => {
    const pend = ok(await ana.get('/comm/approvals')).json().pending as { id: string; contractId: string; canDecide: boolean; preview: { subject: string; recipients: { name: string; kind: string }[] } }[];
    const p1 = pend.find((x) => x.contractId === c1)!;
    expect(p1.preview.subject).toBe('Renovação do contrato EST-60');
    expect(p1.preview.recipients.map((x) => x.kind).sort()).toEqual(['cliente', 'papel:SC']);
    expect(p1.canDecide).toBe(true);
    expect(sent.some((m) => m.to === 'cliente1@ficticio.test')).toBe(false); // nada sai antes da aprovação
    expect((await lucas.post(`/comm/steps/${p1.id}/decision`, { approve: true })).statusCode).toBe(403);
    expect((await carlos.post(`/comm/steps/${p1.id}/decision`, { approve: true })).statusCode).toBe(403); // há titular do papel: só ele
    ok(await ana.post(`/comm/steps/${p1.id}/decision`, { approve: true }));
    const m = sent.find((x) => x.to === 'cliente1@ficticio.test')!;
    expect(m.html).toContain('/api/v1/public/open/'); // abertura rastreada
    expect(m.html).toContain('Responder a esta mensagem'); // cliente está fora do sistema
    expect(sent.find((x) => x.to === 'ana@yepnet.test')!.html).not.toContain('Responder a esta mensagem');
    expect(m.html).toContain('<strong>EST-60</strong>');
    // não confirmado → condição "não" → tarefa para o comercial → fim
    const life = ok(await carlos.get(`/contracts/${c1}/comm`)).json().items[0];
    expect(life.status).toBe('concluido');
    expect(life.steps.map((x: { nodeId: string; status: string }) => `${x.nodeId}:${x.status}`)).toEqual(['e1:concluido', 'm1:enviado', 'c1:concluido', 't1:concluido', 'f2:concluido']);
    const tasks = ok(await lucas.get(`/tasks?contractId=${c1}&view=todas`)).json().items;
    expect(tasks.some((t: { title: string }) => t.title === 'Ligar para o cliente sobre a renovação')).toBe(true);
  });

  it('não aprovar exige justificativa e encerra a esteira do contrato no ciclo', async () => {
    const p2 = (ok(await ana.get('/comm/approvals')).json().pending as { id: string; contractId: string }[]).find((x) => x.contractId === c2)!;
    expect((await ana.post(`/comm/steps/${p2.id}/decision`, { approve: false })).statusCode).toBe(422);
    ok(await ana.post(`/comm/steps/${p2.id}/decision`, { approve: false, note: 'Cliente já está em negociação direta' }));
    const life = ok(await carlos.get(`/contracts/${c2}/comm`)).json().items[0];
    expect(life.status).toBe('cancelado');
    expect(sent.some((x) => x.to === 'cliente2@ficticio.test')).toBe(false);
    // rodar de novo não recomeça o mesmo ciclo
    ok(await carlos.post('/comm/run'));
    expect(ok(await carlos.get(`/contracts/${c2}/comm`)).json().items).toHaveLength(1);
  });
});
