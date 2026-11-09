/** Proposta PJ: modelo com a arte, campos com variáveis e PDF anexado à oportunidade. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABQCAIAAADKqIEEAAAAY0lEQVR4nO3OUQkAIBBAMb8tYTH75zCG72CwAFv73HHW94F0mLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0wMj0A7oIvkjy3AeBAAAAAElFTkSuQmCC';

it('modelo Yepempresa: arte, variáveis criadas pela empresa e PDF anexado', async () => {
  const t = await carlos.post('/admin/proposal-templates', {
    name: 'Yepempresa', segments: ['empresarial'],
    variables: [{ key: 'vigencia', label: 'Vigência contratual', type: 'texto', default: '36 meses' }, { key: 'preco_de', label: 'Preço De', type: 'moeda', default: '2.100,00' }],
    fields: [
      { id: 'f1', page: 0, x: 10, y: 20, w: 60, size: 12, color: '#FFFFFF', align: 'left', bold: false, text: '{{plano.nome}}' },
      { id: 'f2', page: 0, x: 10, y: 40, w: 60, size: 12, color: '#FFFFFF', align: 'left', bold: true, text: 'Vigência: {{vigencia}}' },
      { id: 'f3', page: 0, x: 10, y: 80, w: 80, size: 10, color: '#FFFFFF', align: 'center', bold: false, text: '{{cliente.documento}} - {{cliente.nome}}' },
    ],
  });
  expect(t.statusCode).toBe(201);
  const id = t.json().id;
  expect((await carlos.post(`/admin/proposal-templates/${id}/pages`, { data: PNG })).statusCode).toBe(201);
  expect((await lucas.post('/admin/proposal-templates', { name: 'X' })).statusCode).toBe(403);
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Empresa Fictícia LTDA', segment: 'empresarial' }, planId: plan.id })).json();
  const list = (await lucas.get(`/opportunities/${o.id}/proposal-templates`)).json();
  expect(list.items[0].name).toBe('Yepempresa');
  expect(list.items[0].matches).toBe(true);
  const gen = await lucas.post(`/opportunities/${o.id}/proposal`, { templateId: id, values: { vigencia: '24 meses' } });
  expect(gen.statusCode).toBe(201);
  const att = (await lucas.get(`/opportunities/${o.id}/attachments`)).json().items;
  expect(att[0].kind).toBe('proposta');
  expect(att[0].mime).toBe('application/pdf');
  expect(gen.json().filename).toMatch(/^PC \d{6}(-\d+)? - .+\.pdf$/); // PC AAMMDD - Nome da conta
  const again = await lucas.post(`/opportunities/${o.id}/proposal`, { templateId: id, values: {} });
  expect(again.json().filename.split(' - ')[0]).toBe(gen.json().filename.split(' - ')[0]); // número fica na oportunidade
  const file = await lucas.get(`/opportunities/${o.id}/attachments/${att[0].id}/download`);
  expect(file.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  const wa = await lucas.post(`/opportunities/${o.id}/attachments/${att[0].id}/whatsapp`, { phone: '(79) 99999-0000', message: 'Olá! Segue a proposta.', mode: 'link' });
  expect(wa.statusCode).toBe(200);
  expect(wa.json().waUrl).toMatch(/^https:\/\/wa\.me\/5579999990000\?text=/);
  const token = new URL(wa.json().link).pathname.split('/').pop()!;
  const pub = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/files/${token}` });
  expect(pub.statusCode).toBe(200);
  expect(pub.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/public/files/${token.slice(0, -2)}xx` })).statusCode).toBe(404);
  expect((await lucas.get(`/opportunities/${o.id}`)).json().proposalStatus).toBe('enviada');
});

it('seções automáticas: serviços com fotos, composição do investimento (aba Produto) e condição; prévia exata', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const { sql } = await import('drizzle-orm');
  const t = (await carlos.post('/admin/proposal-templates', { name: `Com seções ${Date.now()}`, segments: [], variables: [], fields: [{ id: 'h', page: 1, x: 8, y: 4, w: 80, size: 12, color: '#000000', align: 'left', bold: true, text: '{{proposta.titulo}}' }] })).json();
  for (let i = 0; i < 3; i++) expect((await carlos.post(`/admin/proposal-templates/${t.id}/pages`, { data: PNG })).statusCode).toBe(201);
  const full = (await carlos.get('/admin/proposal-templates')).json().items.find((x: { id: string }) => x.id === t.id);
  const sections = { enabled: true, backgroundPage: 1, insertAfter: 0, margins: { top: 14, bottom: 10, left: 8, right: 8 }, color: '#2F5986', titles: { services: 'SERVIÇOS PROPOSTOS', investment: 'COMPOSIÇÃO DO INVESTIMENTO', condition: 'CONDIÇÃO DA PROPOSTA' }, validityDays: 10, conditionText: 'Válida por {{proposta.validade_dias}} dias, até {{proposta.validade_data}}.' };
  expect((await carlos.put(`/admin/proposal-templates/${t.id}`, { name: full.name, segments: [], variables: [], fields: full.fields, sections })).statusCode).toBe(200);
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Empresa Seções Fictícia LTDA', segment: 'empresarial' }, planId: plan.id })).json();
  for (let i = 0; i < 40; i++) await ctx.db.execute(sql`insert into opportunity_items (tenant_id, opportunity_id, position, description, unit, qty_milli, unit_cents) select tenant_id, id, ${i}, ${`Item fictício ${i + 1} com descrição longa para quebrar a linha na tabela de investimento`}, 'un', 2000, 12345 from opportunities where id = ${o.id}`);
  const photo = PNG.split(',')[1]!;
  const body = { templateId: t.id, values: {}, services: { text: 'Recuperação da rede óptica com troca de cabos.\n\n- Fusões\n- Testes', photos: [1, 2, 3, 4, 5].map(() => ({ data: photo, mime: 'image/png' })) }, validityDays: 20 };
  const prev = await lucas.post(`/opportunities/${o.id}/proposal/preview`, body);
  expect(prev.statusCode, prev.body).toBe(200);
  const doc = await PDFDocument.load(prev.rawPayload);
  // 3 páginas da arte: capa + (fundo vira páginas geradas) + 1 final; 40 itens + 5 fotos quebram em mais de uma página
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
  expect((await lucas.get(`/opportunities/${o.id}`)).json().proposalNumber ?? null).toBeNull(); // prévia não numera
  const gen = await lucas.post(`/opportunities/${o.id}/proposal`, body);
  expect(gen.statusCode, gen.body).toBe(201);
  expect(gen.json().filename).toMatch(/^PC \d{6}(-\d+)? - Empresa Seções Fictícia LTDA\.pdf$/);
  const bad = await lucas.post(`/opportunities/${o.id}/proposal/preview`, { ...body, services: { text: '', photos: [{ data: Buffer.from('not an image').toString('base64'), mime: 'image/jpeg' }] } });
  expect(bad.statusCode).toBe(422);
});

it('entrar na etapa Proposta gera a proposta no modelo padrão da filial; editar regera com o mesmo número', async () => {
  const { sql } = await import('drizzle-orm');
  const t = (await carlos.post('/admin/proposal-templates', { name: `Padrão filial ${Date.now()}`, segments: [], variables: [{ key: 'obs', label: 'Observação', type: 'texto', default: 'Padrão' }], fields: [{ id: 'h', page: 0, x: 8, y: 4, w: 80, size: 12, color: '#000000', align: 'left', bold: true, text: '{{proposta.titulo}} {{obs}}' }] })).json();
  expect((await carlos.post(`/admin/proposal-templates/${t.id}/pages`, { data: PNG })).statusCode).toBe(201);
  const list = (await carlos.get('/admin/proposal-templates')).json();
  const branch = list.branches[0];
  expect(branch).toBeTruthy();
  expect((await carlos.put(`/admin/proposal-templates/${t.id}/branches`, { branchIds: [branch.id] })).statusCode).toBe(200);
  expect((await carlos.get('/admin/proposal-templates')).json().items.find((x: { id: string }) => x.id === t.id).defaultBranchIds).toEqual([branch.id]);
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Conta Proposta Automática Fictícia', segment: 'empresarial' }, planId: plan.id, branchId: branch.id })).json();
  // etapa Proposta da jornada da oportunidade
  const st = (await ctx.db.execute(sql`select st.key, st.name from pipeline_stages st join opportunities o on o.pipeline_id = st.pipeline_id where o.id = ${o.id} and (st.key = 'proposta' or lower(st.name) = 'proposta') limit 1`)).rows[0] as { key: string } | undefined;
  if (!st) { console.warn('jornada sem etapa Proposta: teste da geração automática pulado'); return; }
  const cur = (await lucas.get(`/opportunities/${o.id}`)).json();
  const mv = await lucas.post(`/opportunities/${o.id}/transition`, { toStage: st.key, rowVersion: cur.rowVersion, confirm: true, reason: 'avanço' });
  expect(mv.statusCode, mv.body).toBe(200);
  expect(mv.json().autoProposal.filename).toMatch(/^PC \d{6}(-\d+)? - Conta Proposta Automática Fictícia\.pdf$/);
  const d = (await lucas.get(`/opportunities/${o.id}/proposal-draft`)).json();
  expect(d.draft.templateId).toBe(t.id);
  expect(d.branchDefaultTemplateId).toBe(t.id);
  // editar: nova versão com outro valor, mesmo número
  const again = await lucas.post(`/opportunities/${o.id}/proposal`, { templateId: t.id, values: { obs: 'Editada' } });
  expect(again.statusCode, again.body).toBe(201);
  expect(again.json().filename).toBe(mv.json().autoProposal.filename);
  expect((await lucas.get(`/opportunities/${o.id}/proposal-draft`)).json().draft.values).toEqual({ obs: 'Editada' });
  await carlos.put(`/admin/proposal-templates/${t.id}/branches`, { branchIds: [] });
});
