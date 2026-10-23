/** "Itens ou lotes de interesse" saiu do formulário de Licitação: bases que ainda têm o campo são atualizadas sozinhas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client;
beforeAll(async () => { ctx = await makeApp(); lucas = await login(ctx.app, 'lucas@yepnet.test'); });
afterAll(async () => ctx.close());

describe('campos retirados do tipo de venda', () => {
  it('lotes de interesse some do Corporativo, com nova versão da instrução', async () => {
    const lk = (await lucas.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const [pipe] = await ctx.app.db.select({ tenantId: s.pipelines.tenantId }).from(s.pipelines).where(eq(s.pipelines.id, corp.id));
    // simula base antiga com o campo ativo
    await ctx.app.db.insert(s.pipelineFields).values({ tenantId: pipe!.tenantId, pipelineId: corp.id, key: 'lotes_interesse', label: 'Itens ou lotes de interesse', type: 'texto_longo', options: [], required: false, position: 99, active: true, saleKinds: ['licitacao'] })
      .onConflictDoUpdate({ target: [s.pipelineFields.pipelineId, s.pipelineFields.key], set: { active: true } });
    const after = (await lucas.get('/meta/lookups')).json().pipelines.find((p: { key: string }) => p.key === 'empresarial');
    expect(after.fields.map((f: { key: string }) => f.key)).not.toContain('lotes_interesse');
    const [row] = await ctx.app.db.select({ active: s.pipelineFields.active }).from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, corp.id), eq(s.pipelineFields.key, 'lotes_interesse')));
    expect(row!.active).toBe(false);
  });
});
