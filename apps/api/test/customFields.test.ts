/** Campos personalizados: cliente (definição, valores, importação) e cópia de campos entre jornadas. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

it('campos de cliente: define, valida, grava na ficha e entra no modelo de importação', async () => {
  const put = await carlos.put('/admin/customer-fields', { fields: [
    { rotulo: 'Melhor horário', tipo: 'lista', opcoes: ['Manhã', 'Tarde'] },
    { rotulo: 'Qtd. de pontos', tipo: 'numero' },
    { rotulo: 'Aniversário', tipo: 'data' },
  ] });
  expect(put.statusCode).toBe(200);
  expect(put.json().items.map((f: { key: string }) => f.key)).toEqual(['melhor_horario', 'qtd_de_pontos', 'aniversario']);
  expect((await lucas.put('/admin/customer-fields', { fields: [] })).statusCode).toBe(403);
  expect((await lucas.get('/customer-fields')).json().items).toHaveLength(3);

  const c = (await carlos.post('/contacts', { name: 'Cliente Campos Fictício', phone: '79 98888-1111', segment: 'residencial' })).json();
  expect((await carlos.patch(`/contacts/${c.id}/custom`, { custom: { melhor_horario: 'Noite' } })).statusCode).toBe(422);
  expect((await carlos.patch(`/contacts/${c.id}/custom`, { custom: { inexistente: 'x' } })).statusCode).toBe(422);
  const ok = await carlos.patch(`/contacts/${c.id}/custom`, { custom: { melhor_horario: 'Tarde', qtd_de_pontos: 3 } });
  expect(ok.statusCode).toBe(200);
  expect((await carlos.get(`/contacts/${c.id}`)).json().custom).toEqual({ melhor_horario: 'Tarde', qtd_de_pontos: 3 });

  const tpl = await carlos.get('/admin/customers/template');
  expect(tpl.body.split('\r\n')[0]).toContain('campo_melhor_horario');
  const csv = ['codigo_cliente;nome;campo_melhor_horario;campo_qtd_de_pontos', 'CF-1;Importado Campos;manhã;2', 'CF-2;Com Erro;Madrugada;'].join('\n');
  const r = (await carlos.post('/admin/customers/import', { csv, dryRun: false })).json();
  expect(r.valid).toBe(1);
  expect(r.errors[0].message).toContain('Melhor horário');
});

it('negociações: copia os campos de uma jornada para as outras sem apagar os que já existem lá', async () => {
  const js = (await carlos.get('/admin/journeys')).json().items as { id: string; fields: { chave: string }[] }[];
  expect(js.length).toBeGreaterThan(1);
  const [a, b] = js as [typeof js[0], typeof js[0]];
  ok(await carlos.put(`/admin/journeys/${b.id}/fields`, { fields: [{ chave: 'so_no_destino', rotulo: 'Só no destino', tipo: 'texto' }] }));
  ok(await carlos.put(`/admin/journeys/${a.id}/fields`, { fields: [{ rotulo: 'Concorrente atual', tipo: 'texto' }] }));
  const cp = await carlos.post(`/admin/journeys/${a.id}/fields/copy`, {});
  expect(cp.statusCode).toBe(200);
  const after = (await carlos.get('/admin/journeys')).json().items.find((j: { id: string }) => j.id === b.id);
  expect(after.fields.map((f: { chave: string }) => f.chave)).toEqual(['concorrente_atual', 'so_no_destino']);
});

function ok(r: { statusCode: number; body: string }) { expect(r.statusCode, r.body).toBe(200); }
