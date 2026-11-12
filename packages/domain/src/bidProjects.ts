/**
 * Projeto de licitação: modelo hierárquico (Etapas → Macrotarefas → Tarefas) versionado, e a montagem do projeto
 * a partir de uma cópia do modelo. Etapa vira marco do projeto (com o entregável como critério de aceite),
 * macrotarefa vira tarefa e tarefa vira subtarefa, no motor de Projetos que já existe.
 */

export const BID_AREAS = ['comercial', 'engenharia', 'operacoes', 'juridico', 'financeiro', 'fiscal', 'compras', 'diretoria'] as const;
export type BidArea = (typeof BID_AREAS)[number];
export const BID_AREA_LABELS: Record<BidArea, string> = {
  comercial: 'Comercial/Licitações', engenharia: 'Engenharia', operacoes: 'Operações', juridico: 'Jurídico', financeiro: 'Financeiro',
  fiscal: 'Fiscal/Contábil', compras: 'Compras', diretoria: 'Diretoria',
};

export const MODEL_STATUSES = ['rascunho', 'em_aprovacao', 'publicado', 'arquivado'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];
export const MODEL_STATUS_LABELS: Record<ModelStatus, string> = { rascunho: 'Rascunho', em_aprovacao: 'Em aprovação', publicado: 'Publicado', arquivado: 'Arquivado' };

export type BidModelTask = { key: string; name: string; required: boolean };
export type BidModelMacro = {
  key: string; name: string; area: BidArea; required: boolean;
  deliverable?: string; acceptance?: string; instructions?: string;
  /** dias a partir do início da etapa e duração */
  offsetDays: number; durationDays: number;
  /** prazo pelo marco oficial do edital: entrega = data do marco + anchorOffsetDays − margem de segurança */
  anchor?: OfficialDateKey | null; anchorOffsetDays?: number;
  tasks: BidModelTask[];
};
export type BidModelPhase = { key: string; name: string; objective?: string; deliverable: string; durationDays: number; macros: BidModelMacro[] };
export type BidModelDef = { phases: BidModelPhase[] };

const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const T = (names: string[], prefix: string): BidModelTask[] => names.map((n, i) => ({ key: `${prefix}_t${i + 1}`, name: n, required: true }));
const M = (phase: string, i: number, name: string, area: BidArea, tasks: string[], o: Partial<BidModelMacro> = {}): BidModelMacro => {
  const key = `${phase}_m${i}`;
  return { key, name, area, required: true, offsetDays: 0, durationDays: 2, tasks: T(tasks, key), ...o };
};

/** Marcos oficiais da licitação (informados e validados pelo analista a partir do edital; nada é presumido). */
export const OFFICIAL_DATES = [
  { key: 'publicacao', label: 'Publicação do edital' },
  { key: 'esclarecimentos', label: 'Limite de esclarecimentos' },
  { key: 'impugnacoes', label: 'Limite de impugnações' },
  { key: 'proposta', label: 'Prazo de envio da proposta', crmField: 'prazo_proposta' },
  { key: 'sessao', label: 'Sessão pública', crmField: 'data_sessao' },
  { key: 'recursos', label: 'Diligências e recursos' },
  { key: 'resultado', label: 'Resultado' },
  { key: 'contratacao', label: 'Contratação' },
] as const;
export type OfficialDateKey = (typeof OFFICIAL_DATES)[number]['key'];
export const OFFICIAL_KEYS = OFFICIAL_DATES.map((d) => d.key) as OfficialDateKey[];
export const OFFICIAL_LABEL = Object.fromEntries(OFFICIAL_DATES.map((d) => [d.key, d.label])) as Record<OfficialDateKey, string>;

/**
 * Rito padrão de licitações (9 etapas), na ordem do processo comercial: cadastro, qualificação e viabilidade,
 * análise do edital e TR pelos setores, reunião do time, lances, documentação, acompanhamento, recurso e resultado.
 */
export const BID_DEFAULT_MODEL: BidModelDef = {
  phases: [
    { key: 'e1', name: 'Cadastrar oportunidade', deliverable: 'Oportunidade cadastrada com edital, TR e datas', durationDays: 1, macros: [
      M('e1', 1, 'Cadastro da oportunidade', 'comercial', ['Identificar órgão contratante', 'Registrar modalidade, processo e objeto', 'Registrar valor estimado e datas do edital', 'Identificar portal de disputa'], { durationDays: 1 }),
      M('e1', 2, 'Organização documental', 'comercial', ['Anexar edital completo', 'Anexar termo de referência (TR)', 'Anexar minuta contratual', 'Anexar planilhas e documentos complementares'], { durationDays: 1 }),
    ] },
    { key: 'e2', name: 'Qualificar e avaliar a viabilidade', objective: 'Decidir se é interessante participar; em caso positivo, avaliar a viabilidade', deliverable: 'Decisão de participar registrada e viabilidade avaliada', durationDays: 5, macros: [
      M('e2', 1, 'Qualificação: é interessante participarmos?', 'comercial', ['Avaliar aderência ao portfólio', 'Identificar restrições evidentes', 'Avaliar relevância estratégica', 'Registrar riscos iniciais'], { durationDays: 1 }),
      M('e2', 2, 'Decisão de participar (Go/No-Go)', 'diretoria', ['Registrar Go, Go condicionado ou No-Go', 'Comunicar a decisão ao time'], { offsetDays: 1, durationDays: 1, instructions: 'Em caso negativo (No-Go), o processo se encerra aqui e o motivo fica registrado.' }),
      M('e2', 3, 'Viabilidade técnica', 'engenharia', ['Cobertura e infraestrutura', 'Capacidade de rede', 'Dimensionamento', 'Recursos necessários'], { offsetDays: 2, durationDays: 3 }),
      M('e2', 4, 'Viabilidade operacional', 'operacoes', ['Equipes', 'Logística', 'Implantação', 'Sustentação e suporte'], { offsetDays: 2, durationDays: 3 }),
      M('e2', 5, 'Viabilidade econômica', 'financeiro', ['Cotações e fornecedores', 'CAPEX e OPEX', 'Tributos', 'Margens e retorno esperado'], { offsetDays: 2, durationDays: 3 }),
    ] },
    { key: 'e3', name: 'Análise do edital e TR pelos setores', objective: 'Cada setor analisa o edital e o TR e aponta a necessidade de esclarecimentos e outros pontos importantes', deliverable: 'Pontos de cada setor registrados e pedidos de esclarecimento definidos', durationDays: 4, macros: [
      M('e3', 1, 'Envio da oportunidade aos setores', 'comercial', ['Enviar edital e TR aos setores', 'Indicar o que cada setor deve analisar', 'Solicitar confirmação de recebimento'], { durationDays: 1 }),
      M('e3', 2, 'Análise administrativa e comercial', 'comercial', ['Condições de participação', 'Habilitação exigida', 'Critérios de julgamento', 'Prazos e procedimentos'], { offsetDays: 1, durationDays: 3 }),
      M('e3', 3, 'Análise técnica', 'engenharia', ['Especificações', 'Quantitativos', 'SLAs', 'Certificações e atestados'], { offsetDays: 1, durationDays: 3 }),
      M('e3', 4, 'Análise jurídica', 'juridico', ['Obrigações contratuais', 'Garantias e penalidades', 'Restrições de participação'], { offsetDays: 1, durationDays: 3 }),
      M('e3', 5, 'Análise financeira e fiscal', 'financeiro', ['Condições de pagamento', 'Reajuste', 'Tributos e exigências contábeis'], { offsetDays: 1, durationDays: 3 }),
      M('e3', 6, 'Pedidos de esclarecimento e impugnação', 'juridico', ['Consolidar dúvidas dos setores', 'Avaliar necessidade de esclarecimento ou impugnação', 'Enviar dentro do prazo do edital'], { offsetDays: 2, durationDays: 2, required: false }),
    ] },
    { key: 'e4', name: 'Reunião com o time comercial', objective: 'Pontuar o que cada um encontrou de importante no edital e no TR (ou só receber as informações e reunir depois um grupo menor)', deliverable: 'Ata com os pontos de cada setor e os encaminhamentos', durationDays: 2, macros: [
      M('e4', 1, 'Consolidar os pontos dos setores', 'comercial', ['Reunir os apontamentos de cada setor', 'Destacar riscos e exigências críticas'], { durationDays: 1 }),
      M('e4', 2, 'Reunião com o time comercial (ou recebimento das informações)', 'comercial', ['Apresentar os pontos de cada setor', 'Registrar decisões e responsáveis'], { offsetDays: 1, durationDays: 1 }),
      M('e4', 3, 'Reunião com grupo menor', 'comercial', ['Definir participantes', 'Aprofundar os pontos críticos', 'Registrar encaminhamentos'], { offsetDays: 1, durationDays: 1, required: false }),
    ] },
    { key: 'e5', name: 'Definir lance inicial e menor lance', deliverable: 'Lance inicial e menor lance aprovados', durationDays: 2, macros: [
      M('e5', 1, 'Composição de custos e preço', 'financeiro', ['Custos diretos e indiretos', 'Tributos', 'Margem mínima aceitável'], { durationDays: 1 }),
      M('e5', 2, 'Definir valor do lance inicial', 'comercial', ['Propor o lance inicial', 'Registrar a referência usada'], { offsetDays: 1, durationDays: 1 }),
      M('e5', 3, 'Definir o menor lance', 'diretoria', ['Definir o limite mínimo da disputa', 'Registrar a aprovação'], { offsetDays: 1, durationDays: 1 }),
    ] },
    { key: 'e6', name: 'Separar as documentações', deliverable: 'Documentação de habilitação e proposta conferidas e enviadas', durationDays: 4, macros: [
      M('e6', 1, 'Habilitação jurídica e fiscal', 'juridico', ['Certidões negativas', 'Atos constitutivos', 'Declarações exigidas'], { durationDays: 3 }),
      M('e6', 2, 'Qualificação técnica', 'engenharia', ['Atestados de capacidade técnica', 'Registros e certificações'], { durationDays: 3 }),
      M('e6', 3, 'Qualificação econômico-financeira', 'financeiro', ['Balanço e índices', 'Garantias exigidas'], { durationDays: 3 }),
      M('e6', 4, 'Proposta e anexos', 'comercial', ['Montar a proposta conforme o edital', 'Conferir todos os anexos'], { offsetDays: 1, durationDays: 2 }),
      M('e6', 5, 'Envio no portal', 'comercial', ['Validar o acesso ao portal', 'Enviar proposta e documentos', 'Arquivar o protocolo'], { offsetDays: 3, durationDays: 1 }),
    ] },
    { key: 'e7', name: 'Acompanhar o processo licitatório', deliverable: 'Histórico da sessão, lances, diligências e habilitação', durationDays: 5, macros: [
      M('e7', 1, 'Sessão pública e lances', 'comercial', ['Acompanhar a disputa', 'Gerir os lances dentro do menor lance aprovado', 'Negociar quando houver'], { durationDays: 1 }),
      M('e7', 2, 'Diligências e ajustes', 'comercial', ['Atender diligências', 'Enviar ajustes permitidos na proposta'], { offsetDays: 1, durationDays: 3, required: false }),
      M('e7', 3, 'Acompanhar habilitação e julgamento', 'comercial', ['Acompanhar a análise dos documentos', 'Registrar ocorrências da sessão'], { offsetDays: 1, durationDays: 4 }),
    ] },
    { key: 'e8', name: 'Enviar recurso ou contrarrazões', deliverable: 'Recurso ou contrarrazões protocolados, quando cabíveis', durationDays: 5, macros: [
      M('e8', 1, 'Avaliar o cabimento', 'juridico', ['Analisar a decisão e os documentos dos concorrentes', 'Registrar intenção de recurso no prazo'], { durationDays: 1, required: false }),
      M('e8', 2, 'Elaborar e enviar recurso ou contrarrazões', 'juridico', ['Redigir a peça', 'Validar com o comercial', 'Protocolar no portal'], { offsetDays: 1, durationDays: 4, required: false }),
    ] },
    { key: 'e9', name: 'Resultado (venceu ou perdeu)', deliverable: 'Resultado registrado e próximos passos definidos', durationDays: 3, macros: [
      M('e9', 1, 'Registrar o resultado', 'comercial', ['Registrar vencedor, valores e classificação', 'Marcar a oportunidade como ganha ou perdida'], { durationDays: 1 }),
      M('e9', 2, 'Venceu: homologação e contratação', 'comercial', ['Acompanhar adjudicação e homologação', 'Cadastrar o contrato no módulo Contratos'], { offsetDays: 1, durationDays: 2, required: false }),
      M('e9', 3, 'Perdeu: motivos e concorrentes', 'comercial', ['Registrar os motivos da perda', 'Registrar preços e concorrentes'], { offsetDays: 1, durationDays: 1, required: false }),
      M('e9', 4, 'Lições aprendidas', 'comercial', ['Registrar o que funcionou e o que mudar'], { offsetDays: 2, durationDays: 1 }),
    ] },
  ],
};

// prazos pelo edital: análise até o limite de esclarecimentos; lances e documentação antes do envio; sessão, recursos e resultado nos seus marcos
const ANCHORS: Record<string, [OfficialDateKey, number]> = {
  e3: ['esclarecimentos', -1], e3_m6: ['esclarecimentos', 0], e4: ['esclarecimentos', 0], e2: ['proposta', -10], e5: ['proposta', -2], e6: ['proposta', -1],
  e6_m5: ['proposta', 0], e7: ['sessao', 0], e8: ['recursos', 0], e9: ['resultado', 0],
};
for (const p of BID_DEFAULT_MODEL.phases) for (const m of p.macros) {
  const a = ANCHORS[m.key] ?? ANCHORS[p.key];
  if (a) { m.anchor = a[0]; m.anchorOffsetDays = a[1]; }
}

/** Vínculo com o edital do rito padrão (vale para modelos salvos antes de existir o campo; null no modelo = sem vínculo). */
const DEFAULT_ANCHORS = new Map(BID_DEFAULT_MODEL.phases.flatMap((p) => p.macros.filter((m) => m.anchor).map((m) => [m.key, [m.anchor!, m.anchorOffsetDays ?? 0] as const])));

/** Preenche o vínculo com o edital do rito padrão onde o modelo ainda não definiu (para o editor mostrar o que vale). */
export function withDefaultAnchors(def: BidModelDef): BidModelDef {
  return { phases: def.phases.map((p) => ({ ...p, macros: p.macros.map((m) => { const d = m.anchor === undefined ? DEFAULT_ANCHORS.get(m.key) : undefined; return d ? { ...m, anchor: d[0], anchorOffsetDays: d[1] } : m; }) })) };
}

/** Problemas do modelo (vazio = válido): nomes, chaves únicas, prazos coerentes. */
export function modelProblems(def: BidModelDef): string[] {
  const out: string[] = [];
  if (!def.phases.length) out.push('O modelo precisa de ao menos uma etapa.');
  const keys = new Set<string>();
  const seen = (k: string) => { if (keys.has(k)) out.push(`Chave repetida: ${k}.`); keys.add(k); };
  def.phases.forEach((p, i) => {
    seen(p.key);
    if (!p.name.trim()) out.push(`Etapa ${i + 1} sem nome.`);
    if (!p.deliverable.trim()) out.push(`Etapa "${p.name || i + 1}" sem entregável.`);
    p.macros.forEach((m) => {
      seen(m.key);
      if (!m.name.trim()) out.push(`Macrotarefa sem nome na etapa "${p.name}".`);
      if (!BID_AREAS.includes(m.area)) out.push(`Área inválida em "${m.name}".`);
      if (m.offsetDays < 0 || m.durationDays < 0) out.push(`Prazo negativo em "${m.name}".`);
      if (m.anchor && !OFFICIAL_KEYS.includes(m.anchor)) out.push(`Marco do edital inválido em "${m.name}".`);
      m.tasks.forEach((t) => { seen(t.key); if (!t.name.trim()) out.push(`Tarefa sem nome em "${m.name}".`); });
    });
  });
  return out;
}

/** Nova chave única para itens criados no editor. */
export function newModelKey(def: BidModelDef, base: string) {
  const all = new Set(def.phases.flatMap((p) => [p.key, ...p.macros.flatMap((m) => [m.key, ...m.tasks.map((t) => t.key)])]));
  const b = slug(base) || 'item';
  let k = b, n = 2;
  while (all.has(k)) k = `${b}_${n++}`;
  return k;
}

const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export type BidInstance = {
  milestones: { key: string; name: string; dueOn: string; position: number; acceptanceCriteria: string }[];
  tasks: { key: string; phaseKey: string; name: string; area: BidArea; required: boolean; deliverable: string | null; acceptance: string | null; instructions: string | null; anchor: OfficialDateKey | null; anchorOffsetDays: number; durationDays: number; startOn: string; dueOn: string; position: number; subtasks: { key: string; name: string; required: boolean }[] }[];
  dueOn: string;
};
/**
 * Datas iniciais a partir do início do projeto: as etapas seguem uma após a outra pela duração de cada uma.
 * O planejamento (L2) recalcula pelas datas do edital; aqui é só o ponto de partida.
 */
export function instantiateBidModel(def: BidModelDef, startOn: string): BidInstance {
  let cursor = startOn;
  const milestones: BidInstance['milestones'] = [];
  const tasks: BidInstance['tasks'] = [];
  def.phases.forEach((p, i) => {
    const end = addDays(cursor, Math.max(0, p.durationDays));
    milestones.push({ key: p.key, name: `Etapa ${i + 1} — ${p.name}`, dueOn: end, position: i, acceptanceCriteria: `Entregável: ${p.deliverable}` });
    p.macros.forEach((m) => {
      const s = addDays(cursor, m.offsetDays);
      const due = addDays(s, m.durationDays);
      const da = m.anchor === undefined ? DEFAULT_ANCHORS.get(m.key) : undefined;
      tasks.push({ key: m.key, phaseKey: p.key, name: m.name, area: m.area, required: m.required, deliverable: m.deliverable ?? null, acceptance: m.acceptance ?? null, instructions: m.instructions ?? null, anchor: m.anchor === undefined ? da?.[0] ?? null : m.anchor, anchorOffsetDays: m.anchor === undefined ? da?.[1] ?? 0 : m.anchorOffsetDays ?? 0, durationDays: m.durationDays, startOn: s, dueOn: due > end ? end : due, position: tasks.length, subtasks: m.tasks.map((t) => ({ ...t })) });
    });
    cursor = end;
  });
  return { milestones, tasks, dueOn: cursor };
}

/** Atributos da tarefa de projeto estruturado (guardados na tarefa; editar o projeto não muda o modelo). */
export type ProjectTaskSpec = {
  phaseKey: string; sourceKey: string | null; area: BidArea; required: boolean; deliverable: string | null; acceptance: string | null; instructions: string | null;
  /** prazo pelo marco oficial (L2) */ anchor?: OfficialDateKey | null; anchorOffsetDays?: number; durationDays?: number;
  /** aprovador (Accountable) e documentos necessários */ approverId?: string | null; docs?: string | null;
  /** a área já indicou o responsável (enquanto não, a tarefa fica com o coordenador) */ assigned?: boolean;
  /** RACI: R = responsável da tarefa, A = approverId (um só); C = consultados, I = informados */ consulted?: string[]; informed?: string[];
};

export type OfficialDate = { date: string | null; validated: boolean; source: string | null; validatedBy?: string | null; validatedAt?: string | null };
export type OfficialDates = Partial<Record<OfficialDateKey, OfficialDate>>;

/** Entrega pelo marco: data do marco + deslocamento − margem; início = entrega − duração. Sem data do marco, não calcula. */
export function anchoredDates(t: { anchor?: OfficialDateKey | null; anchorOffsetDays?: number; durationDays?: number }, dates: OfficialDates, marginDays: number) {
  const d = t.anchor ? dates[t.anchor]?.date : null;
  if (!d) return null;
  const dueOn = addDays(d, (t.anchorOffsetDays ?? 0) - (t.anchorOffsetDays && t.anchorOffsetDays >= 0 ? 0 : Math.max(0, marginDays)));
  return { dueOn, startOn: addDays(dueOn, -Math.max(0, t.durationDays ?? 0)) };
}

export type PlanRow = { id: string; parentId: string | null; title: string; ownerId: string; startOn: string | null; dueOn: string | null; done: boolean; spec: ProjectTaskSpec | null; dependsOn: string[] };
export type PlanIssue = { taskId: string | null; level: 'bloqueio' | 'alerta'; message: string };
/**
 * O que impede liberar o plano (bloqueio) e o que merece atenção (alerta):
 * entregável obrigatório sem responsável da área, sem data ou sem critério de aceite; dependência que começa antes
 * da predecessora terminar; entrega depois do marco oficial; marco usado sem data validada.
 */
export function planIssues(rows: PlanRow[], dates: OfficialDates, coordinatorId: string): PlanIssue[] {
  const out: PlanIssue[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    if (r.parentId || r.done) continue;
    const sp = r.spec;
    if (sp?.required && sp.deliverable) {
      if (sp.area !== 'comercial' && !sp.assigned && r.ownerId === coordinatorId) out.push({ taskId: r.id, level: 'bloqueio', message: `"${r.title}": defina o responsável da área.` });
      if (!r.dueOn) out.push({ taskId: r.id, level: 'bloqueio', message: `"${r.title}": defina a data de entrega.` });
      if (!sp.acceptance?.trim()) out.push({ taskId: r.id, level: 'bloqueio', message: `"${r.title}": defina o critério de aceite.` });
    }
    for (const dep of r.dependsOn) {
      const p = byId.get(dep);
      if (p?.dueOn && r.startOn && r.startOn < p.dueOn) out.push({ taskId: r.id, level: 'alerta', message: `"${r.title}": começa (${r.startOn}) antes de "${p.title}" terminar (${p.dueOn}).` });
    }
    if (sp?.anchor) {
      const a = dates[sp.anchor];
      if (!a?.date) out.push({ taskId: r.id, level: 'alerta', message: `"${r.title}": falta a data "${OFFICIAL_LABEL[sp.anchor]}" do edital.` });
      else {
        if (!a.validated) out.push({ taskId: null, level: 'alerta', message: `Valide a data "${OFFICIAL_LABEL[sp.anchor]}" com o edital.` });
        if (r.dueOn && r.dueOn > a.date) out.push({ taskId: r.id, level: 'alerta', message: `"${r.title}": entrega em ${r.dueOn}, depois de "${OFFICIAL_LABEL[sp.anchor]}" (${a.date}).` });
      }
    }
  }
  // sem repetir o mesmo aviso de data não validada
  return out.filter((x, i) => x.taskId !== null || out.findIndex((y) => y.message === x.message) === i);
}

// ------------------------------------------------------------------ L3: RACI e aprovações
export const BID_AREA_ROLES = ['titular', 'substituto', 'gestor'] as const;
export type BidAreaRole = (typeof BID_AREA_ROLES)[number];
export const BID_AREA_ROLE_LABELS: Record<BidAreaRole, string> = { titular: 'Titular', substituto: 'Substituto', gestor: 'Gestor' };

export const BID_APPROVAL_KINDS = ['plano', 'go_no_go', 'proposta', 'alteracao_critica', 'contratacao'] as const;
export type BidApprovalKind = (typeof BID_APPROVAL_KINDS)[number];
export const BID_APPROVAL_LABELS: Record<BidApprovalKind, string> = {
  plano: 'Planejamento', go_no_go: 'Participação (Go/No-Go)', proposta: 'Proposta comercial', alteracao_critica: 'Alteração crítica', contratacao: 'Contratação',
};
export const BID_APPROVAL_STATUSES = ['em_elaboracao', 'aguardando', 'aprovado', 'devolvido', 'rejeitado', 'cancelado'] as const;
export type BidApprovalStatus = (typeof BID_APPROVAL_STATUSES)[number];
export const BID_APPROVAL_STATUS_LABELS: Record<BidApprovalStatus, string> = {
  em_elaboracao: 'Em elaboração', aguardando: 'Aguardando aprovação', aprovado: 'Aprovado', devolvido: 'Devolvido para ajustes', rejeitado: 'Rejeitado', cancelado: 'Cancelado',
};
export const GO_DECISIONS = ['go', 'go_condicionado', 'no_go'] as const;
export type GoDecision = (typeof GO_DECISIONS)[number];
export const GO_LABELS: Record<GoDecision, string> = { go: 'Go', go_condicionado: 'Go condicionado', no_go: 'No-Go' };

export const BID_PLAN_STATUSES = ['em_elaboracao', 'aguardando', 'aprovado', 'alterado', 'devolvido'] as const;
export type BidPlanStatus = (typeof BID_PLAN_STATUSES)[number];
export const BID_PLAN_STATUS_LABELS: Record<BidPlanStatus, string> = { em_elaboracao: 'Em elaboração', aguardando: 'Aguardando aprovação', aprovado: 'Aprovado', alterado: 'Alterado depois da aprovação', devolvido: 'Devolvido para ajustes' };

/** Mudança crítica em plano aprovado: datas, responsável ou obrigatoriedade de tarefa obrigatória, ou exclusão. */
export function isCriticalChange(patch: Record<string, unknown>, required: boolean, shiftDays?: number) {
  if (shiftDays) return required;
  if (!required) return patch.required === true;
  return ['startOn', 'dueOn', 'ownerId', 'required', 'anchor', 'anchorOffsetDays', 'approverId'].some((k) => patch[k] !== undefined);
}
