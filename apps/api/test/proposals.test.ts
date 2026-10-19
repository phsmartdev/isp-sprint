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
  const file = await lucas.get(`/opportunities/${o.id}/attachments/${att[0].id}/download`);
  expect(file.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
});
