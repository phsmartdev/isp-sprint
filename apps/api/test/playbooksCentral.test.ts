/** Central de Playbooks: criação pela liderança, aprovação Gerência → Diretoria, publicação, público, busca, leitura, ciência, versões, sugestões, revisão. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client, dir: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36);
let residencial = '', governo = '';
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const email = `dir-pb-${st}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretora Fictícia PB', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
  const t = (await ctx.db.execute<{ id: string; name: string }>(sql`select id, name from teams where name in ('Residencial','Governo')`)).rows;
  residencial = t.find((x) => x.name === 'Residencial')!.id; governo = t.find((x) => x.name === 'Governo')!.id;
});
afterAll(async () => ctx.close());

const meta = (over: Record<string, unknown> = {}) => ({ title: `Venda Consultiva ${st}`, description: 'Como conduzir a venda consultiva do início ao fim.', keywords: ['descoberta'], type: 'comercial', criticality: 'media', ownerTeamId: residencial, costCenterId: null, maintainerId: null, visibility: 'compartilhado', teamIds: [residencial], costCenterIds: [], profiles: [], userIds: [], reviewPeriod: 'trimestral', reviewCustomDays: null, nextReviewOn: null, requiresAck: true, contexts: ['crm:venda_consultiva'], ...over });

describe('Central de Playbooks', () => {
  it('liderança cria e edita; Gerência aprova; Diretoria homologa; só então publica para o público certo', async () => {
    const home = ok(await ana.get('/playbooks')).json();
    expect(home.categories.length).toBeGreaterThanOrEqual(9);
    const cat = home.categories.find((c: { prefix: string }) => c.prefix === 'COM');
    expect((await lucas.post('/playbooks/new', { categoryId: cat.id, meta: meta() })).statusCode).toBe(403); // operação não cria
    const tpl = ok(await ana.get('/playbooks/setup')).json().templates.find((t: { type: string }) => t.type === 'comercial');
    const c = ok(await ana.post('/playbooks/new', { categoryId: cat.id, meta: meta(), templateId: tpl.id }), 201).json();
    expect(c.code).toMatch(/^COM-PB-\d{3}$/);
    let r = ok(await ana.get(`/playbooks/${c.id}?versionId=${c.versionId}`)).json();
    expect(r.version.status).toBe('rascunho');
    // ainda sem vigente: quem é do time não vê; acesso direto também não
    expect((await lucas.get(`/playbooks/${c.id}`)).statusCode).toBe(404);
    // salvar rascunho com conteúdo e concorrência
    const content = { blocks: [
      { id: 'h1', type: 'heading', level: 1, text: 'Descoberta' },
      { id: 't1', type: 'text', text: 'Pergunte sobre o **contexto** do cliente.' },
      { id: 'k1', type: 'checklist', mode: 'aprendizagem', title: 'Confira', items: [{ id: 'i1', text: 'Entendi a dor' }] },
      { id: 'd1', type: 'decision', start: 'q1', nodes: [{ id: 'q1', question: 'Cliente tem orçamento?', options: [{ label: 'Sim', next: null, result: 'Siga para proposta' }, { label: 'Não', next: null, result: 'Qualifique de novo' }] }] },
    ] };
    const saved = ok(await ana.put(`/playbook-versions/${c.versionId}`, { rowVersion: r.version.rowVersion, meta: meta(), content })).json();
    expect((await ana.put(`/playbook-versions/${c.versionId}`, { rowVersion: r.version.rowVersion, meta: meta(), content })).statusCode).toBe(422); // conflito
    expect((await ana.put(`/playbook-versions/${c.versionId}`, { rowVersion: saved.rowVersion, meta: meta(), content: { blocks: [{ id: 'x', type: 'link', url: 'javascript:alert(1)', label: 'x' }] } })).statusCode).toBe(422);
    // envio e alçadas
    expect(ok(await ana.post(`/playbook-versions/${c.versionId}/submit`, { changeSummary: 'Primeira versão' })).json()).toMatchObject({ status: 'revisao_gerencia', stages: ['gerencia', 'diretoria'] });
    expect((await ana.put(`/playbook-versions/${c.versionId}`, { rowVersion: saved.rowVersion, meta: meta(), content })).statusCode).toBe(422); // travado
    expect((await dir.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' })).statusCode).toBe(403); // etapa da Gerência
    const ap = ok(await carlos.get('/playbooks/approvals')).json().items.find((x: { versionId: string }) => x.versionId === c.versionId);
    expect(ap).toMatchObject({ stage: 'gerencia', canDecide: true, changeSummary: 'Primeira versão' });
    ok(await carlos.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' }));
    expect((await lucas.get(`/playbooks/${c.id}`)).statusCode).toBe(404); // ainda não publicado
    expect(ok(await dir.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' })).json()).toMatchObject({ status: 'vigente' });
    // público: Lucas (Residencial) vê; Mariana (Governo) não, nem por URL nem na busca
    r = ok(await lucas.get(`/playbooks/${c.id}`)).json();
    expect(r.version).toMatchObject({ number: '1.0', live: true });
    expect(r.sections.map((x: { title: string }) => x.title)).toEqual(['Descoberta']);
    expect((await mariana.get(`/playbooks/${c.id}`)).statusCode).toBe(404);
    expect(ok(await mariana.get(`/playbooks?q=${encodeURIComponent('Venda Consultiva ' + st)}`)).json().items).toHaveLength(0);
    expect(ok(await lucas.get(`/playbooks?q=${encodeURIComponent('contexto do cliente')}`)).json().items.some((x: { id: string }) => x.id === c.id)).toBe(true);
    const lh = ok(await lucas.get('/playbooks')).json();
    expect(lh.forYou.team.some((x: { id: string }) => x.id === c.id)).toBe(true);
    expect(lh.forYou.ackPending.some((x: { id: string }) => x.id === c.id)).toBe(true);
    // abrir não é ciência; ciência explícita fica na versão
    ok(await lucas.post(`/playbooks/${c.id}/ack`));
    expect(ok(await lucas.get(`/playbooks/${c.id}`)).json().me.acked).toBe(true);
    ok(await lucas.post(`/playbooks/${c.id}/favorite`, { on: true }));
    ok(await lucas.put(`/playbooks/${c.id}/progress`, { section: 'h1', checks: ['k1:i1'] }));
    expect(ok(await lucas.get(`/playbooks/${c.id}`)).json().me).toMatchObject({ favorite: true, progress: { section: 'h1', checks: ['k1:i1'] } });
    // sugestão vai para quem mantém; não muda o conteúdo
    const sg = ok(await lucas.post(`/playbooks/${c.id}/suggestions`, { description: 'Incluir pergunta sobre prazo de decisão' }), 201).json();
    const mg = ok(await ana.get('/playbooks/manage')).json();
    expect(mg.suggestions.some((x: { id: string }) => x.id === sg.id)).toBe(true);
    const ind = mg.indicators.find((x: { id: string }) => x.id === c.id);
    expect(ind.acked).toBe(1);
    expect(ind.recipients).toBeGreaterThanOrEqual(2);
    ok(await ana.patch(`/playbook-suggestions/${sg.id}`, { status: 'aceita', response: 'Entra na próxima versão' }));

    // nova versão relevante: 1.0 → 2.0, comparação e nova ciência
    const d = ok(await ana.post(`/playbooks/${c.id}/drafts`, { relevant: true }), 201).json();
    expect(d.number).toBe('2.0');
    expect((await ana.post(`/playbooks/${c.id}/drafts`, {})).statusCode).toBe(422); // um rascunho por vez
    const dv = ok(await ana.get(`/playbooks/${c.id}?versionId=${d.versionId}`)).json();
    const content2 = { blocks: [content.blocks[0], { id: 't1', type: 'text', text: 'Pergunte sobre o **momento** do cliente.' }, { id: 'n1', type: 'callout', kind: 'atencao', text: 'Confirme o prazo de decisão.' }] };
    ok(await ana.put(`/playbook-versions/${d.versionId}`, { rowVersion: dv.version.rowVersion, meta: meta(), content: content2 }));
    const cmp = ok(await ana.get(`/playbook-versions/${d.versionId}/compare`)).json();
    expect(cmp.blocks.map((b: { id: string; change: string }) => `${b.id}:${b.change}`)).toEqual(['h1:igual', 't1:alterado', 'n1:adicionado', 'k1:removido', 'd1:removido']);
    const tomorrow = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    ok(await ana.post(`/playbook-versions/${d.versionId}/submit`, { changeSummary: 'Ajuste na descoberta', relevant: true }));
    // devolver reinicia; reenviar
    ok(await carlos.post(`/playbook-versions/${d.versionId}/decide`, { decision: 'devolver', note: 'Detalhe o callout' }));
    ok(await ana.post(`/playbook-versions/${d.versionId}/submit`, { changeSummary: 'Ajuste na descoberta', relevant: true }));
    ok(await carlos.post(`/playbook-versions/${d.versionId}/decide`, { decision: 'aprovar' }));
    // Diretoria programa a vigência: a 1.0 continua até a data
    expect(ok(await dir.post(`/playbook-versions/${d.versionId}/decide`, { decision: 'aprovar', effectiveFrom: tomorrow })).json()).toMatchObject({ status: 'aprovada' });
    expect(ok(await lucas.get(`/playbooks/${c.id}`)).json().version.number).toBe('1.0');
    await ctx.db.execute(sql`update playbook_versions set effective_from = (now() at time zone 'America/Sao_Paulo')::date where id = ${d.versionId}`);
    const now2 = ok(await lucas.get(`/playbooks/${c.id}`)).json();
    expect(now2.version.number).toBe('2.0');
    expect(now2.me.acked).toBe(false); // ciência é por versão
    const hist = ok(await ana.get(`/playbooks/${c.id}/versions`)).json().items;
    expect(hist.map((v: { number: string; status: string }) => `${v.number}:${v.status}`)).toEqual(['2.0:vigente', '1.0:encerrada']);
    expect(hist[0]).toMatchObject({ manager: 'Carlos Silva', director: 'Diretora Fictícia PB' });
    // restaurar a 1.0 como rascunho (não entra em vigor sem aprovação)
    const rs = ok(await ana.post(`/playbooks/${c.id}/drafts`, { fromVersionId: hist[1].id }), 201).json();
    expect(rs.number).toBe('2.1');
    expect(ok(await lucas.get(`/playbooks/${c.id}`)).json().version.number).toBe('2.0');
    // operação não vê rascunho por URL
    expect((await lucas.get(`/playbooks/${c.id}?versionId=${rs.versionId}`)).statusCode).toBe(404);
  });

  it('revisão vencida gera alerta (uma vez) e não tira de circulação; suspensão só Gerência/Diretoria', async () => {
    const home = ok(await carlos.get('/playbooks')).json();
    const cat = home.categories.find((c: { prefix: string }) => c.prefix === 'OPR');
    const c = ok(await carlos.post('/playbooks/new', { categoryId: cat.id, meta: meta({ title: `Ativação técnica ${st}`, visibility: 'corporativo', teamIds: [], requiresAck: false, ownerTeamId: governo }) }), 201).json();
    const v = ok(await carlos.get(`/playbooks/${c.id}?versionId=${c.versionId}`)).json();
    ok(await carlos.put(`/playbook-versions/${c.versionId}`, { rowVersion: v.version.rowVersion, meta: meta({ title: `Ativação técnica ${st}`, visibility: 'corporativo', teamIds: [], requiresAck: false, ownerTeamId: governo }), content: { blocks: [{ id: 'a', type: 'steps', items: [{ title: 'Agendar' }, { title: 'Ativar' }] }] } }));
    ok(await carlos.post(`/playbook-versions/${c.versionId}/submit`, { changeSummary: 'Primeira versão' }));
    expect((await carlos.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' })).statusCode).toBe(403); // quem enviou não decide
    ok(await ana.get('/playbooks')); // ana não é gerência
    const anaManager = await ctx.db.execute(sql`select 1`); void anaManager;
    // outra gerência não existe no seed: Diretoria só decide a etapa dela
    expect((await dir.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' })).statusCode).toBe(403);
    await ctx.db.execute(sql`update playbook_versions set status = 'homologacao_diretoria' where id = ${c.versionId}`);
    ok(await dir.post(`/playbook-versions/${c.versionId}/decide`, { decision: 'aprovar' }));
    await ctx.db.execute(sql`update playbooks set next_review_on = (now() at time zone 'America/Sao_Paulo')::date - 1 where id = ${c.id}`);
    ok(await carlos.get('/playbooks/manage'));
    ok(await carlos.get('/playbooks/manage'));
    const alerts = (await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from playbook_alerts where playbook_id = ${c.id}`)).rows[0]!.n;
    expect(alerts).toBe(1);
    const r = ok(await mariana.get(`/playbooks/${c.id}`)).json();
    expect(r.playbook.review).toBe('vencida');
    expect((await lucas.post(`/playbooks/${c.id}/suspend`, { suspend: true, reason: 'Procedimento com risco de segurança' })).statusCode).toBe(403);
    ok(await dir.post(`/playbooks/${c.id}/suspend`, { suspend: true, reason: 'Procedimento com risco de segurança' }));
    expect((await mariana.get(`/playbooks/${c.id}`)).statusCode).toBe(404);
    ok(await dir.post(`/playbooks/${c.id}/suspend`, { suspend: false }));
    ok(await mariana.get(`/playbooks/${c.id}`));
  });
  it('gestão cria, edita e exclui categorias; categoria com playbook não é excluída', async () => {
    const pre = (st.slice(-3).replace(/[^a-z]/g, 'x') + 'zz').slice(0, 3).toUpperCase();
    const c = ok(await dir.post('/playbooks/categories', { name: `Categoria Fictícia ${st}`, prefix: `Q${pre}`, icon: 'book', description: 'Teste', approval: { gerencia: true, diretoria: true } })).json();
    expect((await lucas.del(`/playbooks/categories/${c.id}`)).statusCode).toBe(403);
    ok(await dir.post('/playbooks/categories', { id: c.id, name: `Categoria Renomeada ${st}`, prefix: `Q${pre}`, icon: 'shield', description: null, approval: { gerencia: false, diretoria: true } }));
    let home = ok(await dir.get('/playbooks')).json();
    expect(home.categories.find((x: { id: string }) => x.id === c.id).name).toBe(`Categoria Renomeada ${st}`);
    ok(await dir.del(`/playbooks/categories/${c.id}`));
    home = ok(await dir.get('/playbooks')).json();
    expect(home.categories.some((x: { id: string }) => x.id === c.id)).toBe(false);
    expect((await dir.del(`/playbooks/categories/${c.id}`)).statusCode).toBe(404);
    // a que tem playbook (COM) não sai
    const com = home.categories.find((x: { prefix: string }) => x.prefix === 'COM');
    const r = await dir.del(`/playbooks/categories/${com.id}`);
    expect(r.statusCode).toBe(422);
    expect(r.body).toMatch(/desative a categoria/);
  });
});

describe('Diretriz de Gamificação', () => {
  it('é criada uma vez em Governança e Compliance, com conteúdo válido e blocos interativos', async () => {
    const { contentErrors } = await import('@isp/domain');
    const { guidelineContent } = await import('../src/services/gamificationGuideline');
    expect(contentErrors(guidelineContent())).toEqual([]);
    ok(await lucas.get('/playbooks')); ok(await ana.get('/playbooks'));
    const rows = (await ctx.db.execute<{ id: string; code: string; prefix: string }>(sql`select p.id, p.code, c.prefix from playbooks p join playbook_categories c on c.id = p.category_id join playbook_versions v on v.id = p.current_version_id where v.meta->'contexts' ? 'sistema:diretriz_gamificacao'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prefix).toBe('GOV');
    const r = ok(await lucas.get(`/playbooks/${rows[0]!.id}`)).json();
    expect(r.content.blocks.map((b: { type: string }) => b.type)).toEqual(expect.arrayContaining(['gamification_rule', 'gamification_calc', 'flow', 'decision']));
    const rule = ok(await lucas.get('/playbooks/gamification-rule')).json();
    if (rule.approved) { expect(rule.myLevel.key).toBeTruthy(); expect(rule.levels[0].weights).toBeTruthy(); expect(JSON.stringify(rule)).not.toMatch(/assignments/); }
    else expect(rule).toEqual({ approved: false });
  });
});

describe('Importar playbook de PDF', () => {
  it('cria o primeiro rascunho com o conteúdo estruturado e o PDF original anexado ao fim', async () => {
    const { readFileSync } = await import('node:fs');
    const home = ok(await ana.get('/playbooks')).json();
    const cat = home.categories.find((c: { prefix: string }) => c.prefix === 'COM');
    const content = { blocks: [{ id: 'a', type: 'heading', level: 1, text: 'Objetivo' }, { id: 'b', type: 'text', text: 'Texto importado.' }, { id: 'c', type: 'steps', items: [{ title: 'Atender' }, { title: 'Resumir' }] }] };
    const data = readFileSync(new URL('../../../tests/e2e/fixtures/playbook-ficticio.pdf', import.meta.url)).toString('base64');
    const r = ok(await ana.post('/playbooks/new', { categoryId: cat.id, meta: meta({ title: `Importado ${st}` }), imported: { content, source: { name: 'playbook-ficticio.pdf', data } } }), 201).json();
    const v = (await ctx.db.execute(sql`select content from playbook_versions where id = ${r.versionId}`)).rows[0] as { content: { blocks: { type: string; fileId?: string }[] } };
    expect(v.content.blocks.map((b) => b.type)).toEqual(['heading', 'text', 'steps', 'heading', 'pdf']);
    const f = await ana.get(`/playbook-files/${v.content.blocks[4]!.fileId}`);
    expect(f.statusCode).toBe(200);
    // conteúdo inválido é recusado; arquivo que não é PDF também
    expect((await ana.post('/playbooks/new', { categoryId: cat.id, meta: meta({ title: `Inválido ${st}` }), imported: { content: { blocks: [{ id: 'x', type: 'heading', level: 1, text: '' }] }, source: null } })).statusCode).toBe(422);
    expect((await ana.post('/playbooks/new', { categoryId: cat.id, meta: meta({ title: `Não PDF ${st}` }), imported: { content, source: { name: 'x.pdf', data: Buffer.from('não é pdf').toString('base64') } } })).statusCode).toBe(422);
  });
});
