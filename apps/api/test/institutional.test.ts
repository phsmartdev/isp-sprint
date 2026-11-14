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

it('link público: só a administração gera; quem tem o link vê sem login; revogar desliga', async () => {
  const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });
  expect((await lucas.post('/institucional/compartilhamento', {})).statusCode).toBe(403);
  const sealId = ok(await carlos.post('/institucional/selos', { name: 'Selo público', data: PNG }), 201).json().id;
  ok(await carlos.put('/institucional/layout/presenca', { layout: { blocks: {}, texts: { title: 'Título público' } } }));
  const first = ok(await carlos.post('/institucional/compartilhamento', {}), 201).json();
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
  const view = ok(await pub(`/public/apresentacao/${first.token}`)).json();
  expect(view.layouts.presenca.texts.title).toBe('Título público');
  expect(view.seals.map((x: { id: string }) => x.id)).toContain(sealId);
  expect(ok(await pub(`/public/apresentacao/${first.token}/selos/${sealId}/imagem`)).headers['content-type']).toBe('image/png');
  expect(ok(await lucas.get('/institucional/compartilhamento')).json().link.accessCount).toBe(1);
  // um novo link desliga o anterior
  const second = ok(await carlos.post('/institucional/compartilhamento', {}), 201).json();
  expect((await pub(`/public/apresentacao/${first.token}`)).statusCode).toBe(404);
  ok(await pub(`/public/apresentacao/${second.token}`));
  expect((await pub('/public/apresentacao/token-que-nao-existe-de-jeito-nenhum')).statusCode).toBe(404);
  // revogar
  expect((await lucas.del('/institucional/compartilhamento')).statusCode).toBe(403);
  ok(await carlos.del('/institucional/compartilhamento'), 204);
  expect((await pub(`/public/apresentacao/${second.token}`)).statusCode).toBe(404);
  expect(ok(await carlos.get('/institucional/compartilhamento')).json().link).toBeNull();
  ok(await carlos.put('/institucional/layout/presenca', { layout: null }));
  ok(await carlos.del(`/institucional/selos/${sealId}`), 204);
});
