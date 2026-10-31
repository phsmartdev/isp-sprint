/** Viabilidade técnica (Yepnet): mapa da rede por KMZ, traçado com imagem e chamado no GLPI com o arquivo anexado. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// a instância Yepnet é escolhida pela variável de ambiente, lida quando a API carrega
vi.hoisted(() => { process.env.VITE_BRAND = 'yepnet'; });

import { sql } from 'drizzle-orm';
import { deflateSync } from 'node:zlib';
import { distanceM, type LatLng, type NetFeature } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';
import { GLPI_CREDS, startFakeGlpi, type FakeGlpi } from './fakeGlpi';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let glpi: FakeGlpi;
let carlos: Client, lucas: Client;
let oppId = '';
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

/** PNG mínimo válido (1×1) para o anexo. */
function png(): string {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${out.toString('base64')}`;
}

const NET: NetFeature[] = [
  { kind: 'ponto', name: 'CTO-07', folder: 'CTOs', description: '16 portas', at: [-10.9472, -37.0731] },
  { kind: 'ponto', name: 'CTO-08', folder: 'CTOs', description: null, at: [-10.9490, -37.0750] },
  { kind: 'linha', name: 'Cabo 12FO', folder: 'Cabos', description: null, path: [[-10.9472, -37.0731], [-10.9490, -37.0750]] },
  { kind: 'area', name: 'Centro', folder: 'Áreas', description: null, ring: [[-10.94, -37.08], [-10.94, -37.06], [-10.96, -37.06], [-10.96, -37.08]] },
];

beforeAll(async () => {
  ctx = await makeApp();
  glpi = await startFakeGlpi(0, { firstTicketId: 9001 });
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  const list = ok(await lucas.get('/opportunities?scope=minhas&pageSize=5')).json();
  oppId = (list.items.find((o: { customerId: string | null }) => o.customerId) ?? list.items[0]).id;
});
afterAll(async () => {
  // devolve a integração como as outras suítes esperam encontrar (sem configuração)
  await ctx.db.execute(sql`delete from integrations where kind = 'glpi'`);
  await glpi.close(); await ctx.close();
  delete process.env.VITE_BRAND;
});

describe('viabilidade técnica (Yepnet)', () => {
  it('mapa da rede: só a gerência envia; chega em partes; só a versão ativa aparece', async () => {
    ok(await lucas.post('/admin/network-maps', { name: 'Rede', filename: 'rede.kmz', features: NET }), 403);
    const { id } = ok(await carlos.post('/admin/network-maps', { name: 'Rede Centro', filename: 'rede.kmz', features: NET.slice(0, 2) }), 201).json();
    expect(ok(await lucas.get('/network-map')).json().features).toHaveLength(0);
    expect(ok(await carlos.post(`/admin/network-maps/${id}/features`, { features: NET.slice(2) })).json()).toMatchObject({ points: 2, lines: 1, areas: 1 });
    ok(await carlos.post(`/admin/network-maps/${id}/activate`));
    ok(await carlos.post(`/admin/network-maps/${id}/features`, { features: NET }), 422); // ativa não muda
    const m = ok(await lucas.get('/network-map')).json();
    expect(m).toMatchObject({ id, name: 'Rede Centro' });
    expect(m.features).toHaveLength(4);
    // nova versão substitui a ativa
    const v2 = ok(await carlos.post('/admin/network-maps', { name: 'Rede v2', filename: 'v2.kml', features: NET.slice(0, 1) }), 201).json().id;
    ok(await carlos.post(`/admin/network-maps/${v2}/activate`));
    expect(ok(await carlos.get('/admin/network-maps')).json().items.filter((x: { active: boolean }) => x.active).map((x: { id: string }) => x.id)).toEqual([v2]);
    ok(await carlos.post(`/admin/network-maps/${id}/activate`));
  });

  it('recusa coordenada fora do mundo e elemento sem geometria suficiente', async () => {
    ok(await carlos.post('/admin/network-maps', { name: 'Ruim', filename: 'x.kml', features: [{ kind: 'ponto', name: 'X', folder: null, description: null, at: [120, 0] }] }), 422);
    ok(await carlos.post('/admin/network-maps', { name: 'Ruim', filename: 'x.kml', features: [{ kind: 'linha', name: 'X', folder: null, description: null, path: [[0, 0]] }] }), 422);
  });

  it('salva o traçado: metragem calculada no servidor, imagem vira anexo, cada salvar é uma versão', async () => {
    const route: LatLng[] = [[-10.9472, -37.0731], [-10.9478, -37.0731], [-10.9478, -37.0740]];
    const expected = Math.round(distanceM(route[0]!, route[1]!) + distanceM(route[1]!, route[2]!));
    ok(await lucas.post(`/opportunities/${oppId}/route-studies`, { clientAt: route[2], route: [route[0]], image: null }), 422);
    ok(await lucas.post(`/opportunities/${oppId}/route-studies`, { clientAt: route[2], route, image: 'data:image/png;base64,bm90IGEgcG5n' }), 422);
    const s = ok(await lucas.post(`/opportunities/${oppId}/route-studies`, {
      clientAt: route[2], clientAddress: 'Rua A, 10 · Centro · Aracaju', ctoName: 'CTO-07', ctoAt: route[0], port: '5', route, slackM: 20, notes: 'Atravessa a avenida', image: png(),
    }), 201).json();
    expect(s).toMatchObject({ lengthM: expected, slackM: 20, totalM: expected + 20, ctoName: 'CTO-07', port: '5' });
    expect(s.attachmentId).toBeTruthy();
    const att = ok(await lucas.get(`/opportunities/${oppId}/attachments`)).json().items.find((a: { id: string }) => a.id === s.attachmentId);
    expect(att).toMatchObject({ mime: 'image/png', kind: 'outro', filename: expect.stringMatching(/^Viabilidade OP-\d+ .*\.png$/) });
    ok(await lucas.post(`/opportunities/${oppId}/route-studies`, { clientAt: route[2], route: route.slice(0, 2), slackM: 0 }), 201);
    const items = ok(await lucas.get(`/opportunities/${oppId}/route-studies`)).json().items;
    expect(items).toHaveLength(2);
    expect(items[1].id).toBe(s.id);
  });

  it('chamado de viabilidade no GLPI leva a imagem anexada e fica ligado ao traçado', async () => {
    ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: glpi.url, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { clientSecret: GLPI_CREDS.clientSecret, password: GLPI_CREDS.password } }));
    const s = ok(await lucas.get(`/opportunities/${oppId}/route-studies`)).json().items[1];
    const t = ok(await lucas.post(`/opportunities/${oppId}/glpi-tickets`, { entityId: 3, type: 2, urgency: 3, title: 'Viabilidade técnica — teste', content: 'Pedido de viabilidade técnica com o traçado anexo.', attachmentIds: [s.attachmentId] }), 201).json();
    expect(t).toMatchObject({ attached: 1, warning: null });
    expect(glpi.documents).toEqual([expect.objectContaining({ name: expect.stringMatching(/^Viabilidade OP-/), ticketId: t.glpiId, entityId: 3 })]);
    ok(await lucas.post(`/opportunities/${oppId}/route-studies/${s.id}/ticket`, { ticketId: t.id }));
    expect(ok(await lucas.get(`/opportunities/${oppId}/route-studies`)).json().items[1].glpiTicketId).toBe(t.id);
  });

  it('anexo recusado pelo GLPI: o chamado abre do mesmo jeito e o aviso diz o que faltou', async () => {
    ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: glpi.url, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { appToken: 'errado' } }));
    const s = ok(await lucas.get(`/opportunities/${oppId}/route-studies`)).json().items[1];
    const before = glpi.documents.length;
    const r = ok(await lucas.post(`/opportunities/${oppId}/glpi-tickets`, { entityId: 3, type: 2, urgency: 3, title: 'Viabilidade sem anexo', content: 'Pedido de viabilidade técnica com o traçado anexo.', attachmentIds: [s.attachmentId] }), 201).json();
    expect(r.attached).toBe(0);
    expect(r.warning).toMatch(/token da aplicação/);
    expect(glpi.tickets.has(r.glpiId)).toBe(true);
    expect(glpi.documents.length).toBe(before);
    ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: glpi.url, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { appToken: 'app-token-ok' } }));
    expect(ok(await lucas.post(`/opportunities/${oppId}/glpi-tickets`, { entityId: 3, type: 2, urgency: 3, title: 'Viabilidade com token', content: 'Pedido de viabilidade técnica com o traçado anexo.', attachmentIds: [s.attachmentId] }), 201).json()).toMatchObject({ attached: 1, warning: null });
  });
});
