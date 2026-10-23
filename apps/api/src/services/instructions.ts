/**
 * Modelo de instrução da inteligência do negócio.
 *
 * Fonte da verdade:
 *  - ESTRUTURA (jornadas, etapas, exigências, membros, campos e automações) vive nas tabelas e pode
 *    ser editada em Configurações → Jornadas ou trocada de uma vez ao ativar um modelo enviado;
 *  - ROTEIRO e textos (perguntas, dicas, objeções, insights e e-mails) vivem na versão ativa do modelo.
 * O modelo exportado sempre junta os dois, então reflete exatamente o que está em uso.
 */
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { defaultInstruction, INSTRUCTION_README, parseInstruction, SALE_TYPE_KEYS, saleTypeJourneys, type Automation, type Instruction, type InstructionJourney } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

const KIND = { aberta: 'open', ganha: 'won', perdida: 'lost' } as const;
const TIPO = { open: 'aberta', won: 'ganha', lost: 'perdida' } as const;

export type ActiveInstruction = { id: string; version: number; content: Instruction };

export async function pipelinesOf(db: DbOrTx, tenantId: string, opts: { includeInactive?: boolean } = {}) {
  const pipes = await db
    .select()
    .from(s.pipelines)
    .where(and(eq(s.pipelines.tenantId, tenantId), opts.includeInactive ? undefined : eq(s.pipelines.active, true)))
    .orderBy(asc(s.pipelines.position), asc(s.pipelines.createdAt));
  if (!pipes.length) return [];
  const ids = pipes.map((p) => p.id);
  // sequencial: pode rodar dentro de transação (uma conexão só)
  const stages = await db.select().from(s.pipelineStages).where(and(inArray(s.pipelineStages.pipelineId, ids), eq(s.pipelineStages.active, true))).orderBy(asc(s.pipelineStages.position));
  const members = await db.select({ pipelineId: s.pipelineMembers.pipelineId, userId: s.pipelineMembers.userId, email: s.users.email, name: s.users.name }).from(s.pipelineMembers).innerJoin(s.users, eq(s.users.id, s.pipelineMembers.userId)).where(inArray(s.pipelineMembers.pipelineId, ids));
  const fields = await db.select().from(s.pipelineFields).where(and(inArray(s.pipelineFields.pipelineId, ids), eq(s.pipelineFields.active, true))).orderBy(asc(s.pipelineFields.position));
  const autos = await db.select().from(s.pipelineAutomations).where(inArray(s.pipelineAutomations.pipelineId, ids)).orderBy(asc(s.pipelineAutomations.position), asc(s.pipelineAutomations.createdAt));
  return pipes.map((p) => ({
    ...p,
    stages: stages.filter((st) => st.pipelineId === p.id),
    members: members.filter((m) => m.pipelineId === p.id),
    fields: fields.filter((f) => f.pipelineId === p.id),
    automations: autos.filter((a) => a.pipelineId === p.id),
  }));
}
export type PipelineFull = Awaited<ReturnType<typeof pipelinesOf>>[number];

/** Monta as jornadas do modelo a partir das tabelas, com o roteiro guardado na versão ativa. */
async function journeysFromDb(db: DbOrTx, tenantId: string, stored: Instruction): Promise<InstructionJourney[]> {
  const pipes = await pipelinesOf(db, tenantId);
  const users = await db.select({ id: s.users.id, email: s.users.email }).from(s.users).where(eq(s.users.tenantId, tenantId));
  const email = (v: string) => users.find((u) => u.id === v)?.email ?? v;
  const person = (v: string) => (v === 'dono' || v === 'mesmo' ? v : email(v));
  return pipes.map((p) => {
    const old = stored.jornadas.find((j) => j.chave === p.key);
    return {
      chave: p.key,
      nome: p.name,
      descricao: p.description ?? undefined,
      padrao: p.isDefault,
      segmentos: p.segments as InstructionJourney['segmentos'],
      etapas: p.stages.map((st) => {
        const o = old?.etapas.find((e) => e.chave === st.key);
        return {
          chave: st.key,
          nome: st.name,
          tipo: TIPO[st.kind as keyof typeof TIPO],
          cor: st.color ?? undefined,
          exige: { proposta: false, plano: false, proximaAcao: false, respostasObrigatorias: false, ...(st.requirements ?? {}) },
          perguntas: o?.perguntas ?? [],
          dicas: o?.dicas ?? [],
        };
      }),
      membros: p.members.map((m) => m.email.toLowerCase()),
      campos: p.fields.map((f) => ({ chave: f.key, rotulo: f.label, tipo: f.type as never, opcoes: f.options, obrigatorio: f.required })),
      automacoes: p.automations
        .filter((a) => a.active)
        .map((a) => {
          const auto = { nome: a.name, ativo: a.active, gatilho: a.trigger, acoes: a.actions } as unknown as Automation;
          return {
            ...auto,
            acoes: auto.acoes.map((ac) => ('responsavel' in ac ? { ...ac, responsavel: person(ac.responsavel) } : ac)) as Automation['acoes'],
          };
        }),
    };
  });
}

/** Modelo ativo, com a estrutura atual das tabelas. Empresa sem versão recebe o modelo inicial (versão 1). */
export async function getActiveInstruction(db: DbOrTx, tenantId: string): Promise<ActiveInstruction> {
  const [row] = await db
    .select({ id: s.businessInstructions.id, version: s.businessInstructions.version, content: s.businessInstructions.content })
    .from(s.businessInstructions)
    .where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')))
    .limit(1);
  if (!row) return bootstrapInstruction(db, tenantId);
  const parsed = parseInstruction(row.content);
  const stored = parsed.ok ? parsed.value : defaultInstruction();
  const jornadas = await journeysFromDb(db, tenantId, stored);
  return { id: row.id, version: row.version, content: { ...stored, jornadas: jornadas.length ? jornadas : stored.jornadas } };
}

async function bootstrapInstruction(db: DbOrTx, tenantId: string): Promise<ActiveInstruction> {
  const content = defaultInstruction();
  return (db as unknown as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    // duas requisições simultâneas: a segunda espera a primeira
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    const [again] = await tx
      .select({ id: s.businessInstructions.id, version: s.businessInstructions.version })
      .from(s.businessInstructions)
      .where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')))
      .limit(1);
    if (!again) {
      await applyJourneys(tx, tenantId, content.jornadas);
      await tx.insert(s.businessInstructions).values({ tenantId, version: 1, status: 'ativa', content, changes: ['Modelo inicial do RevOps.'], activatedAt: new Date() });
    }
    const [row] = await tx
      .select({ id: s.businessInstructions.id, version: s.businessInstructions.version })
      .from(s.businessInstructions)
      .where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')))
      .limit(1);
    return { id: row!.id, version: row!.version, content: { ...content, jornadas: await journeysFromDb(tx, tenantId, content) } };
  });
}

/** Etapas ou jornadas que sumiriam mas ainda têm oportunidades abertas: impedem a mudança. */
export async function journeyBlockers(db: DbOrTx, tenantId: string, journeys: { chave: string; nome: string; etapas: { chave: string; tipo: string }[] }[]) {
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
    if (!j) blockers.push(`A jornada “${r.pipelineName}” saiu, mas tem ${r.n} oportunidade(s) aberta(s) na etapa “${r.stageName ?? r.stage}”. Mantenha a jornada ou encerre essas oportunidades.`);
    else if (!j.etapas.some((e) => e.chave === r.stage && e.tipo === 'aberta')) blockers.push(`A etapa “${r.stageName ?? r.stage}” (chave ${r.stage}) da jornada “${j.nome}” saiu, mas tem ${r.n} oportunidade(s) aberta(s). Mantenha a etapa (pode mudar só o nome) ou mova essas oportunidades.`);
  }
  return blockers;
}

/** Usuários por e-mail (membros e responsáveis das automações). */
async function userIdsByEmail(db: DbOrTx, tenantId: string) {
  const users = await db.select({ id: s.users.id, email: s.users.email }).from(s.users).where(eq(s.users.tenantId, tenantId));
  return new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
}

/** Troca e-mail por id nos responsáveis das ações; e-mail desconhecido vira erro com caminho legível. */
export async function resolveAutomationPeople(db: DbOrTx, tenantId: string, a: Automation, where: string) {
  const map = await userIdsByEmail(db, tenantId);
  const ids = new Set(map.values());
  const acoes = a.acoes.map((ac) => {
    if (!('responsavel' in ac) || ac.responsavel === 'dono' || ac.responsavel === 'mesmo') return ac;
    const v = ac.responsavel.toLowerCase();
    const id = ids.has(ac.responsavel) ? ac.responsavel : map.get(v);
    if (!id) throw unprocessable(`Usuário não encontrado: ${ac.responsavel}`, [{ path: where, message: `Responsável ${ac.responsavel} não é usuário desta empresa` }]);
    return { ...ac, responsavel: id };
  });
  return { ...a, acoes } as Automation;
}

export async function setPipelineMembers(tx: DbOrTx, pipelineId: string, userIds: string[]) {
  await tx.delete(s.pipelineMembers).where(eq(s.pipelineMembers.pipelineId, pipelineId));
  if (userIds.length) await tx.insert(s.pipelineMembers).values([...new Set(userIds)].map((userId) => ({ pipelineId, userId })));
}

export async function replaceFields(tx: DbOrTx, tenantId: string, pipelineId: string, fields: { chave: string; rotulo: string; tipo: string; opcoes: string[]; obrigatorio: boolean }[]) {
  for (const [i, f] of fields.entries()) {
    const values = { label: f.rotulo, type: f.tipo, options: f.opcoes, required: f.obrigatorio, position: i, active: true };
    await tx.insert(s.pipelineFields).values({ tenantId, pipelineId, key: f.chave, ...values }).onConflictDoUpdate({ target: [s.pipelineFields.pipelineId, s.pipelineFields.key], set: values });
  }
  await tx.update(s.pipelineFields).set({ active: false }).where(and(eq(s.pipelineFields.pipelineId, pipelineId), fields.length ? notInArray(s.pipelineFields.key, fields.map((f) => f.chave)) : undefined));
}

/** Cria/atualiza pipelines, etapas, membros, campos e automações. Nunca apaga: o que sai fica inativo. */
export async function applyJourneys(tx: DbOrTx, tenantId: string, journeys: InstructionJourney[]) {
  const blockers = await journeyBlockers(tx, tenantId, journeys);
  if (blockers.length) throw unprocessable('O modelo remove etapas que ainda têm oportunidades abertas.', blockers.map((m) => ({ path: 'jornadas', message: m })));
  const emails = await userIdsByEmail(tx, tenantId);
  const keep: string[] = [];
  const ids = new Map<string, string>();
  for (const [ji, j] of journeys.entries()) {
    const [p] = await tx
      .insert(s.pipelines)
      .values({ tenantId, key: j.chave, name: j.nome, description: j.descricao ?? null, segments: j.segmentos, isDefault: j.padrao, position: ji, active: true })
      .onConflictDoUpdate({ target: [s.pipelines.tenantId, s.pipelines.key], set: { name: j.nome, description: j.descricao ?? null, segments: j.segmentos, isDefault: j.padrao, position: ji, active: true } })
      .returning({ id: s.pipelines.id });
    keep.push(p!.id);
    ids.set(j.chave, p!.id);
    for (const [ei, e] of j.etapas.entries()) {
      const values = { name: e.nome, position: ei, kind: KIND[e.tipo], isTerminal: e.tipo !== 'aberta', color: e.cor ?? null, requirements: e.exige, active: true };
      await tx.insert(s.pipelineStages).values({ tenantId, pipelineId: p!.id, key: e.chave, ...values }).onConflictDoUpdate({ target: [s.pipelineStages.pipelineId, s.pipelineStages.key], set: values });
    }
    await tx.update(s.pipelineStages).set({ active: false }).where(and(eq(s.pipelineStages.pipelineId, p!.id), notInArray(s.pipelineStages.key, j.etapas.map((e) => e.chave))));
    const memberIds = j.membros.map((m) => {
      const id = emails.get(m.toLowerCase());
      if (!id) throw unprocessable(`Membro não encontrado: ${m}`, [{ path: `jornadas.${j.chave}.membros`, message: `${m} não é usuário desta empresa` }]);
      return id;
    });
    await setPipelineMembers(tx, p!.id, memberIds);
    await replaceFields(tx, tenantId, p!.id, j.campos);
  }
  // automações depois de todas as jornadas existirem (duplicar referencia outra jornada pela chave)
  for (const j of journeys) {
    const pipelineId = ids.get(j.chave)!;
    const existing = await tx.select().from(s.pipelineAutomations).where(eq(s.pipelineAutomations.pipelineId, pipelineId));
    const seen: string[] = [];
    for (const [ai, a0] of j.automacoes.entries()) {
      const a = await resolveAutomationPeople(tx, tenantId, a0, `jornadas.${j.chave}.automacoes[${ai}]`);
      const cur = existing.find((x) => x.name === a.nome && !seen.includes(x.id));
      const values = { name: a.nome, active: a.ativo, trigger: a.gatilho as Record<string, unknown>, actions: a.acoes as Record<string, unknown>[], position: ai, updatedAt: new Date() };
      if (cur) {
        seen.push(cur.id);
        await tx.update(s.pipelineAutomations).set(values).where(eq(s.pipelineAutomations.id, cur.id));
      } else {
        await tx.insert(s.pipelineAutomations).values({ tenantId, pipelineId, ...values });
      }
    }
    const drop = existing.filter((x) => !seen.includes(x.id)).map((x) => x.id);
    if (drop.length) await tx.update(s.pipelineAutomations).set({ active: false }).where(inArray(s.pipelineAutomations.id, drop));
  }
  await tx.update(s.pipelines).set({ active: false, isDefault: false }).where(and(eq(s.pipelines.tenantId, tenantId), notInArray(s.pipelines.id, keep)));
}

/** Conteúdo para exportar: o modelo com o “leia-me” atualizado e o número da versão. */
export function exportable(content: Instruction, version: number): Instruction {
  return { ...content, _leia_me: INSTRUCTION_README, versao: version };
}

/** Jornadas que o usuário pode usar: sem membros = todos; com membros = só eles (gerência vê todas). */
export function pipelineAllowed(p: { members: { userId: string }[] }, userId: string, total: boolean) {
  return total || !p.members.length || p.members.some((m) => m.userId === userId);
}

/** Jornada para uma nova oportunidade: a informada, a do segmento do cliente ou a padrão. */
export async function resolvePipeline(db: DbOrTx, tenantId: string, opts: { pipelineId?: string | null; segment?: string | null; userId?: string; total?: boolean }) {
  await getActiveInstruction(db, tenantId);
  const all = await pipelinesOf(db, tenantId);
  if (!all.length) throw unprocessable('Nenhuma jornada de venda ativa.');
  if (opts.pipelineId) {
    const p = all.find((x) => x.id === opts.pipelineId);
    if (!p) throw unprocessable('Jornada inválida.', [{ path: 'pipelineId', message: 'Jornada não encontrada ou inativa' }]);
    if (opts.userId && !pipelineAllowed(p, opts.userId, !!opts.total)) throw unprocessable('Você não faz parte desta jornada.', [{ path: 'pipelineId', message: 'Jornada restrita a outros usuários' }]);
    return p;
  }
  const pipes = opts.userId ? all.filter((p) => pipelineAllowed(p, opts.userId!, !!opts.total)) : all;
  const list = pipes.length ? pipes : all;
  return list.find((x) => opts.segment && x.segments.includes(opts.segment)) ?? list.find((x) => x.isDefault) ?? list[0]!;
}

/**
 * Empresas que já existiam antes dos tipos de venda ganham as quatro jornadas (Licitação, Adesão à Ata,
 * Consumo de Contrato e Venda Consultiva) como uma NOVA versão do modelo de instrução: fica no histórico de versões
 * e pode ser desfeita reativando a anterior. Jornadas já existentes não mudam.
 */
export async function ensureSaleTypeJourneys(db: DbOrTx, tenantId: string) {
  const have = await db.select({ key: s.pipelines.key }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.active, true), inArray(s.pipelines.key, [...SALE_TYPE_KEYS])));
  if (have.length === SALE_TYPE_KEYS.length) return false;
  return (db as unknown as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    const active = await getActiveInstruction(tx, tenantId);
    const existing = new Set(active.content.jornadas.map((j) => j.chave));
    const missing = saleTypeJourneys().filter((j) => !existing.has(j.chave));
    const inactive = SALE_TYPE_KEYS.filter((k) => existing.has(k) && !have.some((h) => h.key === k));
    if (!missing.length && !inactive.length) return false;
    const content = { ...active.content, _leia_me: undefined, versao: undefined, jornadas: [...active.content.jornadas, ...missing] };
    await applyJourneys(tx, tenantId, content.jornadas);
    const [m] = await tx.select({ v: sql<number>`max(${s.businessInstructions.version})` }).from(s.businessInstructions).where(eq(s.businessInstructions.tenantId, tenantId));
    await tx.update(s.businessInstructions).set({ status: 'arquivada' }).where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')));
    await tx.insert(s.businessInstructions).values({ tenantId, version: (m?.v ?? 0) + 1, status: 'ativa', content, changes: [`Tipos de venda incluídos: ${missing.map((j) => j.nome).join(', ') || 'reativados'}.`], activatedAt: new Date() });
    return true;
  });
}
