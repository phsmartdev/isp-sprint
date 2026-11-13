/** Apresentação institucional: selos em fila (só a administração envia) e layout dos blocos por empresa. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAYAAAA6/NlyAAAAZElEQVR4nO3PAQ3AIADAMI4Q/Eu5q+OCJ6NVsD3vWt+4yPw74DTDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1xnuM5wneE6w3WG6wzXGa4zXGe4znCd4TrDdYbrDNcZrjNctwEZFwJ7kMeKzgAAAABJRU5ErkJggg==';
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); lucas = await login(ctx.app, 'lucas@yepnet.test'); });
afterAll(async () => ctx.close());

it('selos em fila e layout salvo por empresa', async () => {
  expect((await lucas.post('/institucional/selos', { name: 'X', data: PNG })).statusCode).toBe(403);
  const a = ok(await carlos.post('/institucional/selos', { name: 'Selo A', data: PNG }), 201).json().id;
  const b = ok(await carlos.post('/institucional/selos', { name: 'Selo B', data: PNG }), 201).json().id;
  ok(await carlos.put('/institucional/selos/ordem', { ids: [b, a] }));
  const list = ok(await lucas.get('/institucional/selos')).json();
  expect(list.items.filter((x: { id: string }) => [a, b].includes(x.id)).map((x: { id: string }) => x.id)).toEqual([b, a]);
  expect(ok(await lucas.get(`/institucional/selos/${a}/imagem`)).headers['content-type']).toBe('image/png');
  const layout = { blocks: { texto: { x: 90, y: 200, w: 700, h: 300, scale: 1.1 } }, texts: { title: 'Título fictício' } };
  expect((await lucas.put('/institucional/layout/presenca', { layout })).statusCode).toBe(403);
  ok(await carlos.put('/institucional/layout/presenca', { layout }));
  expect(ok(await lucas.get('/institucional/layout/presenca')).json().layout).toEqual(layout);
  ok(await carlos.put('/institucional/layout/presenca', { layout: null }));
  expect(ok(await lucas.get('/institucional/layout/presenca')).json().layout).toBeNull();
  for (const id of [a, b]) ok(await carlos.del(`/institucional/selos/${id}`), 204);
});
