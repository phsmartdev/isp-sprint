/** Proposta PJ: modelo com a arte, campos com variáveis e PDF anexado à oportunidade. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { normalizeSections } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABQCAIAAADKqIEEAAAAY0lEQVR4nO3OUQkAIBBAMb8tYTH75zCG72CwAFv73HHW94F0mLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0wMj0A7oIvkjy3AeBAAAAAElFTkSuQmCC';

async function priceTemplate(name: string, enabled: boolean) {
  const template = await carlos.post('/admin/proposal-templates', { name, sections: normalizeSections({ enabled }) });
  expect(template.statusCode, template.body).toBe(201);
  const { id } = template.json();
  expect((await carlos.post(`/admin/proposal-templates/${id}/pages`, { data: PNG })).statusCode).toBe(201);
  return id as string;
}

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

it('bloqueia prévia e PDF da composição com preço em branco e aceita zero explícito', async () => {
  const templateId = await priceTemplate('Com composição de teste', true);
  const plainId = await priceTemplate('Sem composição de teste', false);
  const opp = await lucas.post('/opportunities', { newContact: { name: 'Empresa Preços Pendentes', segment: 'empresarial' } });
  expect(opp.statusCode, opp.body).toBe(201);
  const { id, rowVersion } = opp.json();
  const base = '/opportunities/' + id;
  const rows = [
    { description: 'Instalação cortesia', unit: 'un', qtyMilli: 1000, unitCents: 0, priceDefined: false },
    { description: 'Link contratado', unit: 'un', qtyMilli: 2000, unitCents: 0, priceDefined: false },
  ];
  expect((await lucas.post(base + '/proposal/preview', { templateId })).statusCode).toBe(200);
  expect((await lucas.put(base + '/items', { rowVersion, items: rows })).statusCode).toBe(200);
  for (const path of ['/proposal/preview', '/proposal']) {
    const blocked = await lucas.post(base + path, { templateId });
    expect(blocked.statusCode, blocked.body).toBe(422);
    expect(blocked.json()).toMatchObject({ errors: [
      { path: 'items.0.unitCents', message: expect.stringContaining('Instalação cortesia') },
      { path: 'items.1.unitCents', message: expect.stringContaining('Link contratado') },
    ] });
  }
  expect((await ctx.db.execute(sql`select proposal_number from opportunities where id = ${id}`)).rows[0]?.proposal_number).toBeNull();
  expect((await lucas.get(base + '/proposal-draft')).json().draft).toBeNull();
  expect((await lucas.get(base + '/attachments')).json().items).toHaveLength(0);
  expect((await lucas.post(base + '/proposal/preview', { templateId: plainId })).statusCode).toBe(200);
  expect((await lucas.post(base + '/proposal', { templateId: plainId })).statusCode).toBe(201);

  const current = (await lucas.get(base + '/items')).json();
  const items = [{ ...rows[0], priceDefined: true }, { ...rows[1], priceDefined: true, unitCents: 12345 }];
  const save = await lucas.put(base + '/items', { rowVersion: current.rowVersion, items });
  expect(save.statusCode, save.body).toBe(200);
  const preview = await lucas.post(base + '/proposal/preview', { templateId });
  expect(preview.statusCode, preview.body).toBe(200);
  const generated = await lucas.post(base + '/proposal', { templateId });
  expect(generated.statusCode, generated.body).toBe(201);
  const attached = await lucas.get(base + '/attachments/' + generated.json().id + '/download');
  expect(attached.statusCode).toBe(200);
  for (const payload of [preview.rawPayload, attached.rawPayload]) {
    const pdf = await PDFDocument.load(payload);
    const text = pdf.getPages().flatMap((page) => {
      const contents = page.node.Contents();
      const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      return entries.flatMap((entry) => {
        const stream = pdf.context.lookup(entry);
        if (!(stream instanceof PDFRawStream)) return [];
        const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
        return [...operators.matchAll(/<([0-9a-f]+)> Tj/gi)].map((match) => Buffer.from(match[1]!, 'hex').toString('latin1'));
      });
    });
    expect(text).toEqual(expect.arrayContaining(['R$ 0,00', 'R$ 123,45', 'R$ 246,90']));
  }
});

it('preserva a etapa sem preço quando o anexo é exigido e avisa quando é opcional', async () => {
  const templateId = await priceTemplate('Modelo padrão com composição', true);
  const lk = (await carlos.get('/meta/lookups')).json();
  const branchId = lk.branches[0].id;
  const pipelineId = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id;
  const stage = (await ctx.db.execute(sql`select requirements from pipeline_stages where pipeline_id = ${pipelineId} and key = 'proposta'`)).rows[0];
  expect(stage).toBeTruthy();
  expect((await carlos.put('/admin/proposal-templates/' + templateId + '/branches', { branchIds: [branchId] })).statusCode).toBe(200);
  try {
    for (const required of [true, false]) {
      await ctx.db.execute(sql`update pipeline_stages set requirements = ${JSON.stringify({ proposta: required })}::jsonb where pipeline_id = ${pipelineId} and key = 'proposta'`);
      const created = await lucas.post('/opportunities', { newContact: { name: 'Empresa Proposta ' + (required ? 'Obrigatória' : 'Opcional'), segment: 'empresarial' }, pipelineId, branchId });
      expect(created.statusCode, created.body).toBe(201);
      const opp = created.json();
      const base = '/opportunities/' + opp.id;
      const item = { description: 'Link sem preço definido', unit: 'un', qtyMilli: 1000, unitCents: 0, priceDefined: false };
      const saved = await lucas.put(base + '/items', { rowVersion: opp.rowVersion, items: [item] });
      expect(saved.statusCode, saved.body).toBe(200);
      const hint = (await lucas.get(base + '/auto-proposal')).json();
      expect(hint).toMatchObject({ hasProposal: false, priceWarning: expect.stringContaining(item.description) });
      const moved = await lucas.post(base + '/transition', { toStage: 'proposta', rowVersion: saved.json().rowVersion, confirm: true });
      expect(moved.statusCode, moved.body).toBe(required ? 422 : 200);
      expect(moved.json()[required ? 'detail' : 'autoProposalWarning']).toContain(item.description);
      const current = (await lucas.get(base)).json();
      expect(current.stage).toBe(required ? opp.stage : 'proposta');
      expect((await ctx.db.execute(sql`select proposal_number from opportunities where id = ${opp.id}`)).rows[0]?.proposal_number).toBeNull();
      expect((await lucas.get(base + '/attachments')).json().items).toHaveLength(0);
      if (required) {
        const priced = await lucas.put(base + '/items', { rowVersion: current.rowVersion, items: [{ ...item, priceDefined: true }] });
        expect(priced.statusCode, priced.body).toBe(200);
        const accepted = await lucas.post(base + '/transition', { toStage: 'proposta', rowVersion: priced.json().rowVersion, confirm: true });
        expect(accepted.statusCode, accepted.body).toBe(200);
        expect(accepted.json().autoProposal).toHaveProperty('filename');
      }
    }
  } finally {
    await carlos.put('/admin/proposal-templates/' + templateId + '/branches', { branchIds: [] });
    await ctx.db.execute(sql`update pipeline_stages set requirements = ${JSON.stringify(stage!.requirements)}::jsonb where pipeline_id = ${pipelineId} and key = 'proposta'`);
  }
});

it('diz em que modelo a proposta sai ao mover e permite excluir a negociação (não a venda fechada)', async () => {
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Conta Exclusão Fictícia', segment: 'empresarial' }, planId: plan.id })).json();
  const ap = await lucas.get(`/opportunities/${o.id}/auto-proposal`);
  expect(ap.statusCode, ap.body).toBe(200);
  expect(ap.json()).toHaveProperty('template');
  expect(ap.json().hasProposal).toBe(false);
  const cur = (await lucas.get(`/opportunities/${o.id}`)).json();
  expect((await lucas.del(`/opportunities/${o.id}`, { rowVersion: cur.rowVersion, reason: '' })).statusCode).toBe(422); // sem motivo
  const del = await lucas.del(`/opportunities/${o.id}`, { rowVersion: cur.rowVersion, reason: 'Duplicada por engano' });
  expect(del.statusCode, del.body).toBe(200);
  expect((await lucas.get(`/opportunities/${o.id}`)).statusCode).toBe(404);
});
