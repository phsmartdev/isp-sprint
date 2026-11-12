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

/** Rito padrão de licitações (11 etapas). As etapas podem correr em paralelo quando a natureza permite. */
export const BID_DEFAULT_MODEL: BidModelDef = {
  phases: [
    { key: 'e1', name: 'Identificação e abertura', deliverable: 'Ficha da licitação e documentação inicial organizada', durationDays: 2, macros: [
      M('e1', 1, 'Cadastro da oportunidade', 'comercial', ['Identificar órgão contratante', 'Registrar modalidade, processo e objeto', 'Registrar valores e datas', 'Identificar portal de disputa']),
      M('e1', 2, 'Organização documental', 'comercial', ['Anexar edital completo', 'Anexar termo de referência', 'Anexar minuta contratual', 'Anexar planilhas e documentos complementares', 'Registrar versões']),
      M('e1', 3, 'Qualificação preliminar', 'comercial', ['Avaliar aderência ao portfólio', 'Identificar restrições evidentes', 'Avaliar relevância estratégica', 'Registrar riscos iniciais'], { offsetDays: 1 }),
    ] },
    { key: 'e2', name: 'Planejamento e mobilização', deliverable: 'Plano aprovado e notificações enviadas', durationDays: 3, macros: [
      M('e2', 1, 'Identificação das áreas envolvidas', 'comercial', ['Selecionar departamentos participantes', 'Identificar responsáveis e substitutos', 'Definir atribuições RACI']),
      M('e2', 2, 'Definição dos entregáveis', 'comercial', ['Estabelecer entregas por área', 'Descrever critérios de aceite', 'Definir documentos necessários', 'Registrar dependências']),
      M('e2', 3, 'Definição do cronograma', 'comercial', ['Definir datas de início', 'Definir datas de entrega', 'Calcular prazos relativos à sessão', 'Reservar margens de segurança', 'Identificar caminho crítico'], { offsetDays: 1 }),
      M('e2', 4, 'Aprovação do planejamento', 'diretoria', ['Submeter plano ao aprovador RACI', 'Registrar parecer', 'Aplicar ajustes solicitados', 'Obter liberação'], { offsetDays: 2, durationDays: 1 }),
      M('e2', 5, 'Mobilização das áreas', 'comercial', ['Gerar e-mails personalizados', 'Anexar edital e documentos aplicáveis', 'Enviar solicitações', 'Solicitar confirmação de ciência'], { offsetDays: 3, durationDays: 1, instructions: 'Nenhuma notificação formal de execução antes da aprovação do plano (entregáveis, responsáveis e prazos).' }),
    ] },
    { key: 'e3', name: 'Análise do edital', deliverable: 'Matriz de conformidade e pareceres preliminares', durationDays: 5, macros: [
      M('e3', 1, 'Análise administrativa', 'comercial', ['Condições de participação', 'Habilitação', 'Critérios de julgamento', 'Prazos e procedimentos'], { durationDays: 3 }),
      M('e3', 2, 'Análise técnica', 'engenharia', ['Especificações', 'Quantitativos', 'Cobertura', 'SLAs', 'Certificações', 'Requisitos de implantação'], { durationDays: 4 }),
      M('e3', 3, 'Análise jurídica', 'juridico', ['Obrigações contratuais', 'Garantias', 'Penalidades', 'Riscos', 'Restrições de participação'], { durationDays: 4 }),
      M('e3', 4, 'Análise financeira e fiscal', 'financeiro', ['Condições de pagamento', 'Reajuste', 'Garantias financeiras', 'Tributos', 'Exigências contábeis'], { durationDays: 4 }),
      M('e3', 5, 'Matriz de requisitos', 'comercial', ['Registrar requisito', 'Indicar cláusula, página e anexo', 'Atribuir responsável', 'Definir evidência', 'Classificar conformidade'], { offsetDays: 1, durationDays: 4 }),
      M('e3', 6, 'Esclarecimentos e impugnações', 'juridico', ['Consolidar dúvidas', 'Avaliar necessidade de manifestação', 'Controlar prazos', 'Preparar e validar manifestações'], { offsetDays: 2, durationDays: 3, required: false }),
    ] },
    { key: 'e4', name: 'Viabilidade e riscos', deliverable: 'Relatório consolidado de viabilidade', durationDays: 5, macros: [
      M('e4', 1, 'Viabilidade técnica', 'engenharia', ['Cobertura e infraestrutura', 'Capacidade de rede', 'Dimensionamento', 'Recursos necessários'], { durationDays: 4 }),
      M('e4', 2, 'Viabilidade operacional', 'operacoes', ['Equipes', 'Logística', 'Implantação', 'Sustentação e suporte'], { durationDays: 4 }),
      M('e4', 3, 'Custos e fornecedores', 'compras', ['Cotações', 'CAPEX', 'OPEX', 'Prazos de fornecimento'], { durationDays: 4 }),
      M('e4', 4, 'Modelagem econômica', 'financeiro', ['Composição de preços', 'Tributos', 'Margens', 'Fluxo de caixa', 'Retorno esperado'], { offsetDays: 2, durationDays: 3 }),
      M('e4', 5, 'Matriz de riscos', 'comercial', ['Probabilidade', 'Impacto', 'Mitigação', 'Responsável', 'Risco residual'], { offsetDays: 3, durationDays: 2 }),
    ] },
    { key: 'e5', name: 'Decisão Go/No-Go', deliverable: 'Decisão formal registrada', durationDays: 2, macros: [
      M('e5', 1, 'Consolidar pareceres', 'comercial', [], { durationDays: 1 }),
      M('e5', 2, 'Avaliar aderência estratégica', 'diretoria', [], { durationDays: 1 }),
      M('e5', 3, 'Analisar riscos e restrições', 'diretoria', [], { durationDays: 1 }),
      M('e5', 4, 'Submeter decisão à alçada RACI', 'comercial', [], { offsetDays: 1, durationDays: 0 }),
      M('e5', 5, 'Registrar Go, Go condicionado ou No-Go', 'diretoria', [], { offsetDays: 1, durationDays: 1 }),
      M('e5', 6, 'Comunicar decisão às áreas', 'comercial', [], { offsetDays: 2, durationDays: 0 }),
    ] },
    { key: 'e6', name: 'Preparação da proposta', deliverable: 'Pacote de proposta e habilitação conforme o edital', durationDays: 5, macros: [
      M('e6', 1, 'Documentação de habilitação', 'juridico', [], { durationDays: 4 }),
      M('e6', 2, 'Qualificação técnica', 'engenharia', [], { durationDays: 4 }),
      M('e6', 3, 'Proposta técnica', 'engenharia', [], { durationDays: 4 }),
      M('e6', 4, 'Proposta comercial', 'comercial', [], { durationDays: 4 }),
      M('e6', 5, 'Composição de custos', 'financeiro', [], { durationDays: 3 }),
      M('e6', 6, 'Validação de fornecedores', 'compras', [], { durationDays: 3 }),
      M('e6', 7, 'Organização e conferência dos anexos', 'comercial', [], { offsetDays: 4, durationDays: 1 }),
    ] },
    { key: 'e7', name: 'Revisão e submissão', deliverable: 'Proposta protocolada', durationDays: 2, macros: [
      M('e7', 1, 'Revisão documental', 'juridico', [], { durationDays: 1 }),
      M('e7', 2, 'Revisão técnica', 'engenharia', [], { durationDays: 1 }),
      M('e7', 3, 'Revisão financeira', 'financeiro', [], { durationDays: 1 }),
      M('e7', 4, 'Aprovação final RACI', 'diretoria', [], { offsetDays: 1, durationDays: 0 }),
      M('e7', 5, 'Validação de acesso ao portal', 'comercial', [], { durationDays: 1 }),
      M('e7', 6, 'Submissão', 'comercial', [], { offsetDays: 2, durationDays: 0 }),
      M('e7', 7, 'Arquivamento de protocolos', 'comercial', [], { offsetDays: 2, durationDays: 0 }),
    ] },
    { key: 'e8', name: 'Sessão pública', deliverable: 'Histórico da sessão', durationDays: 1, macros: [
      M('e8', 1, 'Preparação da sessão', 'comercial', [], { durationDays: 0 }),
      M('e8', 2, 'Definição de estratégia e limites', 'diretoria', [], { durationDays: 0 }),
      M('e8', 3, 'Acompanhamento da disputa', 'comercial', [], { offsetDays: 1, durationDays: 0 }),
      M('e8', 4, 'Gestão de lances', 'comercial', [], { offsetDays: 1, durationDays: 0 }),
      M('e8', 5, 'Negociação', 'comercial', [], { offsetDays: 1, durationDays: 0, required: false }),
      M('e8', 6, 'Registro de resultados e ocorrências', 'comercial', [], { offsetDays: 1, durationDays: 0 }),
    ] },
    { key: 'e9', name: 'Diligências e resultado', deliverable: 'Resultado administrativo consolidado', durationDays: 10, macros: [
      M('e9', 1, 'Atendimento a diligências', 'comercial', [], { durationDays: 3, required: false }),
      M('e9', 2, 'Ajustes permitidos na proposta', 'comercial', [], { durationDays: 3, required: false }),
      M('e9', 3, 'Análise de recursos', 'juridico', [], { offsetDays: 3, durationDays: 3, required: false }),
      M('e9', 4, 'Recursos e contrarrazões', 'juridico', [], { offsetDays: 3, durationDays: 5, required: false }),
      M('e9', 5, 'Acompanhamento de adjudicação e homologação', 'comercial', [], { offsetDays: 5, durationDays: 5 }),
      M('e9', 6, 'Registro do resultado final', 'comercial', [], { offsetDays: 10, durationDays: 0 }),
    ] },
    { key: 'e10', name: 'Contratação e transição', deliverable: 'Contrato formalizado e transição concluída', durationDays: 10, macros: [
      M('e10', 1, 'Conferência das condições contratuais', 'juridico', [], { durationDays: 2 }),
      M('e10', 2, 'Aprovação da assinatura', 'diretoria', [], { offsetDays: 2, durationDays: 1 }),
      M('e10', 3, 'Formalização contratual', 'juridico', [], { offsetDays: 3, durationDays: 3 }),
      M('e10', 4, 'Cadastro no módulo Contratos', 'comercial', [], { offsetDays: 6, durationDays: 1 }),
      M('e10', 5, 'Reunião de transição', 'operacoes', [], { offsetDays: 7, durationDays: 1 }),
      M('e10', 6, 'Criação ou vinculação do projeto de implantação', 'operacoes', [], { offsetDays: 8, durationDays: 1 }),
      M('e10', 7, 'Transferência de documentos e obrigações', 'comercial', [], { offsetDays: 8, durationDays: 2 }),
    ] },
    { key: 'e11', name: 'Encerramento e inteligência', deliverable: 'Dossiê final e inteligência comercial registrada', durationDays: 5, macros: [
      M('e11', 1, 'Encerramento documental', 'comercial', [], { durationDays: 2 }),
      M('e11', 2, 'Registro de classificação', 'comercial', [], { durationDays: 1 }),
      M('e11', 3, 'Análise de concorrentes', 'comercial', [], { durationDays: 3 }),
      M('e11', 4, 'Análise de preço e margem', 'financeiro', [], { durationDays: 3 }),
      M('e11', 5, 'Registro dos motivos de perda, quando aplicável', 'comercial', [], { durationDays: 1, required: false }),
      M('e11', 6, 'Lições aprendidas', 'comercial', [], { offsetDays: 3, durationDays: 2 }),
      M('e11', 7, 'Atualização dos indicadores comerciais', 'comercial', [], { offsetDays: 4, durationDays: 1 }),
    ] },
  ],
};

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
  tasks: { key: string; phaseKey: string; name: string; area: BidArea; required: boolean; deliverable: string | null; acceptance: string | null; instructions: string | null; startOn: string; dueOn: string; position: number; subtasks: { key: string; name: string; required: boolean }[] }[];
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
      tasks.push({ key: m.key, phaseKey: p.key, name: m.name, area: m.area, required: m.required, deliverable: m.deliverable ?? null, acceptance: m.acceptance ?? null, instructions: m.instructions ?? null, startOn: s, dueOn: due > end ? end : due, position: tasks.length, subtasks: m.tasks.map((t) => ({ ...t })) });
    });
    cursor = end;
  });
  return { milestones, tasks, dueOn: cursor };
}

/** Atributos da tarefa de projeto estruturado (guardados na tarefa; editar o projeto não muda o modelo). */
export type ProjectTaskSpec = { phaseKey: string; sourceKey: string | null; area: BidArea; required: boolean; deliverable: string | null; acceptance: string | null; instructions: string | null };
