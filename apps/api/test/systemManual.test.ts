import { afterAll, beforeAll, expect, it } from 'vitest';
import { contentErrors } from '@isp/domain';
import { login, makeApp } from './helpers';

const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
import { buildManual, MANUAL_CHAPTERS } from '../src/services/systemManual';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { ctx = await makeApp(); });
afterAll(async () => { await ctx.close(); });

it('manual: todos os capítulos montam, passam na integridade e cabem no editor', () => {
  const built = buildManual();
  expect(built).toHaveLength(MANUAL_CHAPTERS.length);
  for (const b of built) {
    expect(contentErrors(b.content), b.chapter.slug).toEqual([]);
    expect(b.content.blocks.length, b.chapter.slug).toBeLessThanOrEqual(400);
    expect(JSON.stringify(b.content)).not.toMatch(/\[\[[A-Z_]+\]\]/);
  }
  const api = built.find((b) => b.chapter.slug === 'api')!;
  const rows = api.content.blocks.filter((x) => x.type === 'table').reduce((t, x) => t + (x as { rows: string[][] }).rows.length, 0);
  expect(rows).toBeGreaterThan(900); // a lista da API sai do registro real de rotas
});

it('manual: gerência instala, todos leem, atualizar não duplica e não sobrescreve edição', async () => {
  const carlos = await login(ctx.app, 'carlos@yepnet.test');
  const lucas = await login(ctx.app, 'lucas@yepnet.test');
  expect((await lucas.post('/playbooks/manual-sistema')).statusCode).toBe(403);
  const r1 = ok(await carlos.post('/playbooks/manual-sistema')).json();
  expect(r1.created.length + r1.unchanged.length + r1.updated.length + r1.skipped.length).toBe(MANUAL_CHAPTERS.length);
  const r2 = ok(await carlos.post('/playbooks/manual-sistema')).json();
  expect(r2.created).toEqual([]);
  expect(r2.updated).toEqual([]);
  const st = ok(await carlos.get('/playbooks/manual-sistema')).json();
  expect(st.items.every((i: { state: string }) => i.state === 'atualizado')).toBe(true);
  // a operação lê o manual na biblioteca
  const vis = ok(await lucas.get(`/playbooks/${st.items[0].playbookId}`)).json();
  expect(JSON.stringify(vis)).toContain('Manual do RevOps');
  // rascunho aberto pela empresa: a atualização não passa por cima
  ok(await carlos.post(`/playbooks/${st.items[1].playbookId}/drafts`, {}), 201);
  const st2 = ok(await carlos.get('/playbooks/manual-sistema')).json();
  expect(st2.items[1].state).toBe('em_edicao');
});
