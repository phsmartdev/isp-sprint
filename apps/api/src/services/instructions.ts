/**
 * Modelo de instrução ativo da empresa e aplicação das jornadas no banco.
 * A instrução é a fonte das jornadas/etapas, do roteiro do Sprint, das regras dos insights e dos e-mails.
 */
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { defaultInstruction, INSTRUCTION_README, parseInstruction, type Instruction, type InstructionJourney } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

const KIND = { aberta: 'open', ganha: 'won', perdida: 'lost' } as const;

export type ActiveInstruction = { id: string; version: number; content: Instruction };

/** Instrução ativa. Empresas sem nenhuma versão recebem o modelo inicial como versão 1 (aplicado na hora). */
export async function getActiveInstruction(db: DbOrTx, tenantId: string): Promise<ActiveInstruction> {
  const [row] = await db
    .select({ id: s.businessInstructions.id, version: s.businessInstructions.version, content: s.businessInstructions.content })
    .from(s.businessInstructions)
    .where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')))
    .limit(1);
  if (row) {
    const parsed = parseInstruction(row.content);
    // conteúdo ativo sempre passou pela validação; se o schema evoluir, cai para o padrão sem quebrar a tela
    return { id: row.id, version: row.version, content: parsed.ok ? parsed.value : defaultInstruction() };
  }
  return bootstrapInstruction(db, tenantId);
}

async function bootstrapInstruction(db: DbOrTx, tenantId: string): Promise<ActiveInstruction> {
  const content = defaultInstruction();
  const run = async (tx: DbOrTx) => {
    // corrida entre duas requisições: a segunda espera a primeira pelo índice único de versão
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    const [again] = await tx
      .select({ id: s.businessInstructions.id, version: s.businessInstructions.version })
      .from(s.businessInstructions)
      .where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')))
      .limit(1);
    if (again) return { id: again.id, version: again.version, content };
    await applyJourneys(tx, tenantId, content.jornadas);
    const [row] = await tx
      .insert(s.businessInstructions)
      .values({ tenantId, version: 1, status: 'ativa', content, changes: ['Modelo inicial do ISP Sprint.'], activatedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: s.businessInstructions.id });
    return { id: row?.id ?? '', version: 1, content };
  };
  return 'transaction' in db ? (db as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(run) : run(db);
}

/** Etapas que sumiriam mas ainda têm oportunidades abertas: impedem a ativação. */
export async function journeyBlockers(db: DbOrTx, tenantId: string, journeys: InstructionJourney[]) {
  const rows = await db
    .select({ pipelineKey: s.pipelines.key, pipelineName: s.pipelines.name, stage: s.opportunities.stage, stageName: s.pipelineStages.name, n: sql<number>`count(*)::int` })
    .from(s.opportunities)
    .innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId))
    .leftJoin(s.pipelineStages, and(eq(s.pipelineStages.pipelineId, s.opportunities.pipelineId), eq(s.pipelineStages.key, s.opportunities.stage)))
    .where(and(eq(s.opportunities.tenantId, tenantId), sql`${s.opportunities.deletedAt} is null`, notInArray(s.opportunities.stage, ['ganha', 'perdida'])))
    .groupBy(s.pipelines.key, s.pipelines.name, s.opportunities.stage, s.pipelineStages.name);
  const blockers: string[] = [];
  for (const r of rows) {
    const j = journeys.find((x) => x.chave === r.pipelineKey);
    if (!j) blockers.push(`A jornada “${r.pipelineName}” saiu do modelo, mas tem ${r.n} oportunidade(s) aberta(s) na etapa “${r.stageName ?? r.stage}”. Mantenha a jornada ou encerre essas oportunidades.`);
    else if (!j.etapas.some((e) => e.chave === r.stage && e.tipo === 'aberta')) blockers.push(`A etapa “${r.stageName ?? r.stage}” (chave ${r.stage}) da jornada “${j.nome}” saiu do modelo, mas tem ${r.n} oportunidade(s) aberta(s). Mantenha a chave da etapa (pode mudar só o nome) ou mova essas oportunidades.`);
  }
  return blockers;
}

/** Cria/atualiza pipelines e etapas a partir das jornadas. Nunca apaga: o que sai do modelo fica inativo. */
export async function applyJourneys(tx: DbOrTx, tenantId: string, journeys: InstructionJourney[]) {
  const blockers = await journeyBlockers(tx, tenantId, journeys);
  if (blockers.length) throw unprocessable('O modelo remove etapas que ainda têm oportunidades abertas.', blockers.map((m) => ({ path: 'jornadas', message: m })));
  const keepPipelines: string[] = [];
  for (const [ji, j] of journeys.entries()) {
    const [p] = await tx
      .insert(s.pipelines)
      .values({ tenantId, key: j.chave, name: j.nome, description: j.descricao ?? null, segments: j.segmentos, isDefault: j.padrao, position: ji, active: true })
      .onConflictDoUpdate({ target: [s.pipelines.tenantId, s.pipelines.key], set: { name: j.nome, description: j.descricao ?? null, segments: j.segmentos, isDefault: j.padrao, position: ji, active: true } })
      .returning({ id: s.pipelines.id });
    keepPipelines.push(p!.id);
    const keepStages: string[] = [];
    for (const [ei, e] of j.etapas.entries()) {
      keepStages.push(e.chave);
      const values = { name: e.nome, position: ei, kind: KIND[e.tipo], isTerminal: e.tipo !== 'aberta', color: e.cor ?? null, requirements: e.exige, active: true };
      await tx
        .insert(s.pipelineStages)
        .values({ tenantId, pipelineId: p!.id, key: e.chave, ...values })
        .onConflictDoUpdate({ target: [s.pipelineStages.pipelineId, s.pipelineStages.key], set: values });
    }
    await tx.update(s.pipelineStages).set({ active: false }).where(and(eq(s.pipelineStages.pipelineId, p!.id), notInArray(s.pipelineStages.key, keepStages)));
  }
  await tx.update(s.pipelines).set({ active: false, isDefault: false }).where(and(eq(s.pipelines.tenantId, tenantId), notInArray(s.pipelines.id, keepPipelines)));
}

/** Conteúdo para exportar: o modelo com o “leia-me” atualizado e o número da versão. */
export function exportable(content: Instruction, version: number): Instruction {
  return { ...content, _leia_me: INSTRUCTION_README, versao: version };
}

export async function pipelinesOf(db: DbOrTx, tenantId: string) {
  const pipes = await db.select().from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.active, true))).orderBy(asc(s.pipelines.position));
  const stages = pipes.length
    ? await db.select().from(s.pipelineStages).where(and(inArray(s.pipelineStages.pipelineId, pipes.map((p) => p.id)), eq(s.pipelineStages.active, true))).orderBy(asc(s.pipelineStages.position))
    : [];
  return pipes.map((p) => ({ ...p, stages: stages.filter((st) => st.pipelineId === p.id) }));
}

/** Jornada para uma nova oportunidade: a informada, a do segmento do cliente ou a padrão. */
export async function resolvePipeline(db: DbOrTx, tenantId: string, opts: { pipelineId?: string | null; segment?: string | null }) {
  await getActiveInstruction(db, tenantId);
  const pipes = await pipelinesOf(db, tenantId);
  if (!pipes.length) throw unprocessable('Nenhuma jornada de venda ativa.');
  if (opts.pipelineId) {
    const p = pipes.find((x) => x.id === opts.pipelineId);
    if (!p) throw unprocessable('Jornada inválida.', [{ path: 'pipelineId', message: 'Jornada não encontrada ou inativa' }]);
    return p;
  }
  return pipes.find((x) => opts.segment && x.segments.includes(opts.segment)) ?? pipes.find((x) => x.isDefault) ?? pipes[0]!;
}

export async function defaultPipelineId(db: DbOrTx, tenantId: string) {
  return (await resolvePipeline(db, tenantId, {})).id;
}
