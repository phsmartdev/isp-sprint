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
import { BID_DISPUTE_MODES, defaultInstruction, INSTRUCTION_README, parseInstruction, SALE_TYPE_KEYS, saleTypeFields, type Automation, type Instruction, type InstructionJourney } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

const KIND = { aberta: 'open', ganha: 'won', perdida: 'lost' } as const;
const TIPO = { open: 'aberta', won: 'ganha', lost: 'perdida' } as const;

export type ActiveInstruction = { id: string; version: number; content: Instruction };

type PipeRow = typeof s.pipelines.$inferSelect;
type Bundle = PipeRow & {
  stages: (typeof s.pipelineStages.$inferSelect)[];
  members: { pipelineId: string; userId: string; email: string; name: string }[];
  fields: (typeof s.pipelineFields.$inferSelect)[];
  automations: (typeof s.pipelineAutomations.$inferSelect)[];
};

/**
 * Jornadas com etapas, membros, campos e automações numa única ida ao banco (antes eram cinco, em sequência).
 * Muitas telas passam por aqui: no banco remoto, cada consulta a menos é uma viagem a menos.
 */
export async function pipelinesOf(db: DbOrTx, tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<Bundle[]> {
  const r = await db.execute<{ p: Record<string, unknown> }>(sql`
    select json_build_object(
      'id', p.id, 'tenantId', p.tenant_id, 'key', p.key, 'name', p.name, 'description', p.description, 'segments', p.segments,
      'isDefault', p.is_default, 'position', p.position, 'active', p.active, 'createdAt', p.created_at,
      'stages', coalesce((select json_agg(json_build_object('id', st.id, 'tenantId', st.tenant_id, 'pipelineId', st.pipeline_id, 'key', st.key, 'name', st.name, 'position', st.position,
          'isTerminal', st.is_terminal, 'kind', st.kind, 'color', st.color, 'requirements', st.requirements, 'active', st.active) order by st.position)
        from pipeline_stages st where st.pipeline_id = p.id and st.active), '[]'),
      'members', coalesce((select json_agg(json_build_object('pipelineId', pm.pipeline_id, 'userId', pm.user_id, 'email', u.email, 'name', u.name))
        from pipeline_members pm join users u on u.id = pm.user_id where pm.pipeline_id = p.id), '[]'),
      'fields', coalesce((select json_agg(json_build_object('id', f.id, 'tenantId', f.tenant_id, 'pipelineId', f.pipeline_id, 'key', f.key, 'label', f.label, 'type', f.type, 'options', f.options,
          'required', f.required, 'position', f.position, 'active', f.active, 'saleKinds', f.sale_kinds) order by f.position)
        from pipeline_fields f where f.pipeline_id = p.id and f.active), '[]'),
      'automations', coalesce((select json_agg(json_build_object('id', a.id, 'tenantId', a.tenant_id, 'pipelineId', a.pipeline_id, 'name', a.name, 'active', a.active, 'trigger', a.trigger,
          'actions', a.actions, 'position', a.position, 'createdBy', a.created_by, 'createdAt', a.created_at, 'updatedAt', a.updated_at) order by a.position, a.created_at)
        from pipeline_automations a where a.pipeline_id = p.id), '[]')
    ) as p
    from pipelines p
    where p.tenant_id = ${tenantId} ${opts.includeInactive ? sql`` : sql`and p.active`}
    order by p.position, p.created_at`);
  // datas voltam do JSON como texto: devolve como Date, igual às consultas normais
  return r.rows.map(({ p }) => {
    const b = p as unknown as Bundle;
    return {
      ...b,
      createdAt: new Date(b.createdAt as unknown as string),
      automations: b.automations.map((a) => ({ ...a, createdAt: new Date(a.createdAt as unknown as string), updatedAt: new Date(a.updatedAt as unknown as string) })),
    };
  });
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
      campos: p.fields.map((f) => ({ chave: f.key, rotulo: f.label, tipo: f.type as never, opcoes: f.options, obrigatorio: f.required, tiposVenda: (f.saleKinds ?? []) as never })),
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

export async function replaceFields(tx: DbOrTx, tenantId: string, pipelineId: string, fields: { chave: string; rotulo: string; tipo: string; opcoes: string[]; obrigatorio: boolean; tiposVenda?: string[] }[]) {
  for (const [i, f] of fields.entries()) {
    const values = { label: f.rotulo, type: f.tipo, options: f.opcoes, required: f.obrigatorio, position: i, active: true, saleKinds: f.tiposVenda ?? [] };
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
  // o modelo inicial cria as jornadas: com jornadas no banco, ele já existe (uma consulta em vez de quatro)
  let all = await pipelinesOf(db, tenantId);
  if (!all.length) { await getActiveInstruction(db, tenantId); all = await pipelinesOf(db, tenantId); }
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

/** Etapa equivalente no funil Corporativo para quem estava nas antigas jornadas por tipo de venda. */
const STAGE_MAP: Record<string, string> = {
  captacao: 'novo_lead', analise_edital: 'diagnostico', proposta_documentos: 'proposta', sessao_disputa: 'negociacao', habilitacao_recurso: 'negociacao',
  identificacao: 'novo_lead', pedido_adesao: 'diagnostico', autorizacao: 'negociacao', contratacao: 'negociacao',
  demanda: 'novo_lead', levantamento: 'diagnostico', orcamento: 'proposta', aprovacao_gestor: 'negociacao',
  descoberta: 'novo_lead', solucao_escopo: 'visita_tecnica',
};

/**
 * Tipos de venda são opções de formulário do funil Corporativo (pedido do Paulo, 23/10), não funis.
 * Para empresas que já tinham as quatro jornadas criadas no mesmo dia: as oportunidades delas vão para o Corporativo
 * (com o tipo de venda e a etapa equivalente, registrado no histórico), os campos de cada tipo entram no Corporativo,
 * CNPJ e Nº de colaboradores saem (o CNPJ fica na conta) e as etapas deixam de exigir próxima ação e roteiro.
 * Tudo vira uma NOVA versão do modelo de instrução (reversível). Roda uma vez: depois os campos já existem.
 */
export async function ensureSaleTypeForm(db: DbOrTx, tenantId: string) {
  const [corp] = await db.select({ id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, 'empresarial'), eq(s.pipelines.active, true))).limit(1);
  if (!corp) return false;
  const legacy = await db.select({ id: s.pipelines.id, key: s.pipelines.key }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.active, true), inArray(s.pipelines.key, [...SALE_TYPE_KEYS])));
  const [hasFields] = await db.select({ id: s.pipelineFields.id }).from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, corp.id), eq(s.pipelineFields.active, true), sql`cardinality(${s.pipelineFields.saleKinds}) > 0`)).limit(1);
  if (!legacy.length && hasFields) return false;
  return (db as unknown as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    // oportunidades das antigas jornadas por tipo vão para o Corporativo, guardando o tipo de venda
    for (const l of legacy) {
      const opps = await tx.select({ id: s.opportunities.id, stage: s.opportunities.stage, rowVersion: s.opportunities.rowVersion }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), eq(s.opportunities.pipelineId, l.id)));
      for (const o of opps) {
        const stage = o.stage === 'ganha' || o.stage === 'perdida' ? o.stage : STAGE_MAP[o.stage] ?? 'novo_lead';
        await tx.update(s.opportunities).set({ pipelineId: corp.id, saleKind: l.key, stage, rowVersion: o.rowVersion + 1, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
        await tx.insert(s.opportunityEvents).values({ tenantId, opportunityId: o.id, type: 'updated', actorId: null, rowVersion: o.rowVersion + 1, payload: { changed: { 'tipo de venda': { from: `jornada ${l.key}`, to: `funil Corporativo · ${l.key}` }, ...(stage !== o.stage ? { etapa: { from: o.stage, to: stage } } : {}) } } });
      }
    }
    const active = await getActiveInstruction(tx, tenantId);
    const fields = saleTypeFields();
    const jornadas = active.content.jornadas.filter((j) => !(SALE_TYPE_KEYS as readonly string[]).includes(j.chave)).map((j) => j.chave !== 'empresarial' ? j : {
      ...j,
      campos: [...j.campos.filter((c) => !['cnpj', 'colaboradores'].includes(c.chave) && !fields.some((f) => f.chave === c.chave)), ...fields],
      etapas: j.etapas.map((e) => ({ ...e, exige: { ...e.exige, proximaAcao: false, respostasObrigatorias: false } })),
    });
    const content = { ...active.content, _leia_me: undefined, versao: undefined, jornadas };
    await applyJourneys(tx, tenantId, content.jornadas);
    const [m] = await tx.select({ v: sql<number>`max(${s.businessInstructions.version})` }).from(s.businessInstructions).where(eq(s.businessInstructions.tenantId, tenantId));
    await tx.update(s.businessInstructions).set({ status: 'arquivada' }).where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')));
    await tx.insert(s.businessInstructions).values({ tenantId, version: (m?.v ?? 0) + 1, status: 'ativa', content, changes: ['Tipos de venda viram opções de formulário do funil Corporativo (Licitação, Adesão à Ata, Consumo de Contrato, Venda Consultiva).', 'Corporativo: CNPJ e Nº de colaboradores saem dos campos (CNPJ fica na conta); etapas deixam de exigir próxima ação e roteiro.'], activatedAt: new Date() });
    return true;
  });
}

/**
 * Licitação (05/11/2026): "Tipo de disputa" passa a ser o modo de disputa (Aberta, Fechada, Fechada-Aberta,
 * Aberta-Fechada) e o cadastro pede Lance inicial e Lance mínimo. Ajusta a instrução ativa uma vez (nova versão).
 */
export async function ensureBidFields(db: DbOrTx, tenantId: string) {
  const [corp] = await db.select({ id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, 'empresarial'), eq(s.pipelines.active, true))).limit(1);
  if (!corp) return false;
  const fields = await db.select({ key: s.pipelineFields.key, options: s.pipelineFields.options }).from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, corp.id), eq(s.pipelineFields.active, true)));
  const disputa = fields.find((x) => x.key === 'tipo_disputa');
  const ok = (!disputa || BID_DISPUTE_MODES.every((m) => disputa.options.includes(m))) && fields.some((x) => x.key === 'lance_inicial') && fields.some((x) => x.key === 'lance_minimo');
  if (ok) return false;
  return (db as unknown as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    const active = await getActiveInstruction(tx, tenantId);
    const tpl = saleTypeFields();
    const pick = (k: string) => tpl.find((c) => c.chave === k)!;
    const jornadas = active.content.jornadas.map((j) => {
      if (j.chave !== 'empresarial') return j;
      const campos = j.campos.filter((c) => !['lance_inicial', 'lance_minimo'].includes(c.chave)).map((c) => (c.chave === 'tipo_disputa' ? { ...c, tipo: 'lista' as const, opcoes: [...BID_DISPUTE_MODES], obrigatorio: true } : c));
      const at = campos.findIndex((c) => c.chave === 'tipo_disputa');
      const extra = [pick('lance_inicial'), pick('lance_minimo')];
      return { ...j, campos: at >= 0 ? [...campos.slice(0, at + 1), ...extra, ...campos.slice(at + 1)] : [pick('tipo_disputa'), ...extra, ...campos] };
    });
    const content = { ...active.content, _leia_me: undefined, versao: undefined, jornadas };
    await applyJourneys(tx, tenantId, content.jornadas);
    const [m] = await tx.select({ v: sql<number>`max(${s.businessInstructions.version})` }).from(s.businessInstructions).where(eq(s.businessInstructions.tenantId, tenantId));
    await tx.update(s.businessInstructions).set({ status: 'arquivada' }).where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')));
    await tx.insert(s.businessInstructions).values({ tenantId, version: (m?.v ?? 0) + 1, status: 'ativa', content, changes: ['Licitação: Tipo de disputa passa a ser Aberta, Fechada, Fechada-Aberta ou Aberta-Fechada; o cadastro pede Lance inicial e Lance mínimo.'], activatedAt: new Date() });
    return true;
  });
}

/** Campos que saíram do formulário do tipo de venda (ex.: itens/lotes passaram para Produtos e serviços). Os valores já gravados ficam no histórico. */
const RETIRED_SALE_FIELDS = ['lotes_interesse', 'valor_pregao', 'valor_vitorioso'];

/**
 * Ajustes automáticos da empresa (modelo inicial, formulário por tipo de venda, campos aposentados, campos do
 * pregão e filiais) conferidos numa única consulta; cada ajuste só roda quando de fato falta.
 * Antes eram ~13 consultas em sequência a cada carregamento de tela.
 */
export async function ensureTenantSetup(db: DbOrTx, tenantId: string, ensureBranches: (db: DbOrTx, tenantId: string) => Promise<void>) {
  const modes = sql.join(BID_DISPUTE_MODES.map((m) => sql`${m}`), sql`, `);
  const retired = sql.join(RETIRED_SALE_FIELDS.map((k) => sql`${k}`), sql`, `);
  const legacy = sql.join(SALE_TYPE_KEYS.map((k) => sql`${k}`), sql`, `);
  const r = await db.execute<{ has_instr: boolean; corp: string | null; legacy: boolean; sale_fields: boolean; retired: boolean; bid_ok: boolean; branches: boolean }>(sql`
    with corp as (select id from pipelines where tenant_id = ${tenantId} and key = 'empresarial' and active limit 1),
         f as (select key, options, sale_kinds from pipeline_fields where pipeline_id = (select id from corp) and active)
    select
      exists(select 1 from business_instructions where tenant_id = ${tenantId} and status = 'ativa') as has_instr,
      (select id from corp) as corp,
      exists(select 1 from pipelines where tenant_id = ${tenantId} and active and key in (${legacy})) as legacy,
      exists(select 1 from f where cardinality(sale_kinds) > 0) as sale_fields,
      exists(select 1 from f where key in (${retired})) as retired,
      (not exists(select 1 from f where key = 'tipo_disputa' and not (options @> array[${modes}]::text[]))
        and exists(select 1 from f where key = 'lance_inicial') and exists(select 1 from f where key = 'lance_minimo')) as bid_ok,
      exists(select 1 from sales_branches where tenant_id = ${tenantId}) as branches`);
  const x = r.rows[0]!;
  if (!x.has_instr) await getActiveInstruction(db, tenantId);
  if (!x.has_instr || (x.corp && (x.legacy || !x.sale_fields))) await ensureSaleTypeForm(db, tenantId);
  if (!x.has_instr || (x.corp && x.retired)) await ensureRetiredSaleFields(db, tenantId);
  if (!x.has_instr || (x.corp && !x.bid_ok)) await ensureBidFields(db, tenantId);
  if (!x.branches) await ensureBranches(db, tenantId);
}
export async function ensureRetiredSaleFields(db: DbOrTx, tenantId: string) {
  const [corp] = await db.select({ id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, 'empresarial'), eq(s.pipelines.active, true))).limit(1);
  if (!corp) return false;
  const [hit] = await db.select({ id: s.pipelineFields.id }).from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, corp.id), eq(s.pipelineFields.active, true), inArray(s.pipelineFields.key, RETIRED_SALE_FIELDS))).limit(1);
  if (!hit) return false;
  return (db as unknown as { transaction: <T>(f: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + tenantId}))`);
    const active = await getActiveInstruction(tx, tenantId);
    const jornadas = active.content.jornadas.map((j) => (j.chave !== 'empresarial' ? j : { ...j, campos: j.campos.filter((c) => !RETIRED_SALE_FIELDS.includes(c.chave)) }));
    const content = { ...active.content, _leia_me: undefined, versao: undefined, jornadas };
    await applyJourneys(tx, tenantId, content.jornadas);
    const [m] = await tx.select({ v: sql<number>`max(${s.businessInstructions.version})` }).from(s.businessInstructions).where(eq(s.businessInstructions.tenantId, tenantId));
    await tx.update(s.businessInstructions).set({ status: 'arquivada' }).where(and(eq(s.businessInstructions.tenantId, tenantId), eq(s.businessInstructions.status, 'ativa')));
    await tx.insert(s.businessInstructions).values({ tenantId, version: (m?.v ?? 0) + 1, status: 'ativa', content, changes: ['Licitação: saem do formulário "Itens ou lotes de interesse" (vai para Produtos e serviços), "Valor do pregão" (passa a ser o total dos produtos) e "Valor vitorioso" (sai da lista de participantes).'], activatedAt: new Date() });
    return true;
  });
}
