/**
 * ABM Fase 5 — Plays: roteiros de ação para uma conta ou para um stakeholder. Cada etapa vira uma tarefa real
 * (módulo de Tarefas). O sistema SUGERE plays com justificativa a partir dos dados; nunca altera avaliações humanas
 * (influência, posicionamento, interesse) — elas são só lidas para recomendar.
 */
import { addDays } from './contracts';
import { COMMERCIAL_STATUS_LABELS, type CommercialStatus } from './abm';
import {
  DEFAULT_INFLUENCE_LABELS, RELATIONSHIP_LABELS, STAKEHOLDER_ROLE_LABELS, STANCE_LABELS, influenceRank,
  type InfluenceLevel, type RelationshipStrength, type StakeholderRole, type Stance,
} from './stakeholders';

export const PLAY_CATEGORIES = ['abertura', 'mapeamento', 'aproximacao', 'conversao', 'defensores', 'expansao', 'renovacao', 'reativacao', 'institucional', 'outro'] as const;
export type PlayCategory = (typeof PLAY_CATEGORIES)[number];
export const PLAY_CATEGORY_LABELS: Record<PlayCategory, string> = {
  abertura: 'Abertura de conta', mapeamento: 'Mapeamento de decisores', aproximacao: 'Aproximação de decisor', conversao: 'Conversão de resistência', defensores: 'Ativação de defensores',
  expansao: 'Expansão', renovacao: 'Renovação', reativacao: 'Reativação', institucional: 'Relacionamento institucional', outro: 'Outro',
};
export const PLAY_STEP_TYPES = ['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'] as const;
export type PlayStepType = (typeof PLAY_STEP_TYPES)[number];
export const PLAY_STEP_TYPE_LABELS: Record<PlayStepType, string> = { tarefa: 'Tarefa', ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', visita: 'Visita' };
export const PLAY_ASSIGNEES = ['executor', 'responsavel_conta', 'responsavel_relacionamento'] as const;
export type PlayAssignee = (typeof PLAY_ASSIGNEES)[number];
export const PLAY_ASSIGNEE_LABELS: Record<PlayAssignee, string> = { executor: 'Quem conduz o play', responsavel_conta: 'Responsável pela conta no ABM', responsavel_relacionamento: 'Responsável pelo relacionamento com a pessoa' };
export const PLAY_GAPS = ['sem_decisor', 'sem_avaliacao', 'poucos_stakeholders'] as const;
export type PlayGap = (typeof PLAY_GAPS)[number];
export const PLAY_GAP_LABELS: Record<PlayGap, string> = { sem_decisor: 'Sem decisor mapeado', sem_avaliacao: 'Pessoas sem influência avaliada', poucos_stakeholders: 'Menos de 3 pessoas mapeadas' };

export type PlayStep = { key: string; title: string; type: PlayStepType; dayOffset: number; assignee: PlayAssignee; instructions: string };
/** Para quem o play serve. Conta: status comercial, natureza, lacunas do mapeamento, contrato vencendo. Pessoa: papéis, posicionamento, influência mínima (avaliada pela equipe), relacionamento. */
export type PlayAudience = {
  target: 'conta' | 'stakeholder';
  commercial?: CommercialStatus[]; nature?: ('publica' | 'privada')[]; gaps?: PlayGap[]; contractEndingDays?: number | null;
  roles?: StakeholderRole[]; stances?: Stance[]; minInfluence?: InfluenceLevel | null; relationship?: RelationshipStrength[];
};
export type PlayDefinition = { steps: PlayStep[]; successCriteria: string; audience: PlayAudience };
export type PlayTemplate = PlayDefinition & { key: string; name: string; category: PlayCategory; objective: string };

const st = (key: string, title: string, type: PlayStepType, dayOffset: number, instructions: string, assignee: PlayAssignee = 'executor'): PlayStep => ({ key, title, type, dayOffset, assignee, instructions });

/** 9 modelos iniciais — cada empresa recebe uma cópia editável (versionada). */
export const PLAY_TEMPLATES: PlayTemplate[] = [
  {
    key: 'abertura_conta', name: 'Abertura de conta', category: 'abertura', objective: 'Sair do zero: conhecer a organização e conseguir a primeira conversa qualificada.',
    successCriteria: 'Reunião de descoberta realizada e pelo menos um decisor identificado.',
    audience: { target: 'conta', commercial: ['identificada', 'prospeccao'] },
    steps: [
      st('pesquisa', 'Pesquisar a organização e registrar a estrutura', 'tarefa', 0, 'Site, notícias, portal de transparência e LinkedIn. Registre unidades e departamentos na Conta 360.'),
      st('contatos', 'Identificar o primeiro contato e possíveis decisores', 'tarefa', 2, 'Inclua as pessoas como stakeholders. A influência fica "Não avaliado" até alguém avaliar.'),
      st('primeiro', 'Primeiro contato', 'ligacao', 4, 'Apresente-se, entenda o momento da organização e peça uma reunião de descoberta.'),
      st('descoberta', 'Reunião de descoberta', 'reuniao', 10, 'Dores, projetos, orçamento, calendário de compras e quem participa da decisão.'),
      st('registro', 'Registrar aprendizados e próximo passo', 'tarefa', 12, 'Atualize objetivos da conta, stakeholders e o próximo passo no ABM.'),
    ],
  },
  {
    key: 'mapeamento_decisores', name: 'Mapeamento de decisores', category: 'mapeamento', objective: 'Saber quem decide, quem influencia e quem pode bloquear.',
    successCriteria: 'Decisor identificado e influência das pessoas-chave avaliada por alguém da equipe.',
    audience: { target: 'conta', gaps: ['sem_decisor', 'sem_avaliacao', 'poucos_stakeholders'] },
    steps: [
      st('organograma', 'Revisar o organograma da conta', 'tarefa', 0, 'Confira a estrutura organizacional na Conta 360 e complete o que faltar.'),
      st('conversa', 'Perguntar ao contato atual quem participa da decisão', 'ligacao', 2, 'Quem aprova, quem paga, quem avalia tecnicamente, quem usa e quem pode travar.'),
      st('papeis', 'Registrar papéis e relações das pessoas', 'tarefa', 5, 'Marque decisores, influenciadores, bloqueadores e quem reporta a quem.'),
      st('avaliar', 'Avaliar a influência de cada pessoa-chave', 'tarefa', 7, 'Avaliação manual, com justificativa, na ficha de cada stakeholder. O sistema não calcula influência.'),
    ],
  },
  {
    key: 'aproximacao_decisor', name: 'Aproximação de decisor', category: 'aproximacao', objective: 'Criar relacionamento direto com quem decide e ainda está distante.',
    successCriteria: 'Reunião realizada com a pessoa e relacionamento reavaliado pela equipe.',
    audience: { target: 'stakeholder', roles: ['decisor', 'aprovador_financeiro', 'patrocinador', 'gestor_politico'], minInfluence: 'alto', relationship: ['fraco', 'inexistente', 'nao_avaliado'] },
    steps: [
      st('pauta', 'Preparar uma pauta de valor para a pessoa', 'tarefa', 0, 'O que importa para esta pessoa? Resultados, riscos, agenda política ou orçamentária.'),
      st('ponte', 'Pedir apresentação a quem já tem relacionamento', 'whatsapp', 1, 'Use as relações registradas (aliados, quem indicou, quem reporta a ela).', 'responsavel_relacionamento'),
      st('reuniao', 'Reunião com a pessoa', 'reuniao', 7, 'Escute mais do que fale. Confirme o papel dela na decisão.'),
      st('resumo', 'Enviar resumo e próximos passos', 'email', 8, 'Registre na ficha a força do relacionamento depois da reunião.'),
    ],
  },
  {
    key: 'conversao_resistente', name: 'Conversão de resistência', category: 'conversao', objective: 'Entender e tratar a resistência de quem pesa na decisão.',
    successCriteria: 'Objeções registradas e tratadas; posicionamento reavaliado pela equipe.',
    audience: { target: 'stakeholder', stances: ['resistente', 'opositor'], minInfluence: 'medio' },
    steps: [
      st('objecoes', 'Entender as objeções', 'ligacao', 0, 'Pergunte o que preocupa. Não discuta, registre.'),
      st('evidencias', 'Preparar resposta com evidências', 'tarefa', 3, 'Casos, números, referências de órgãos ou empresas parecidas.'),
      st('tratar', 'Reunião para tratar as objeções', 'reuniao', 7, 'Se possível, leve um defensor da própria organização.'),
      st('reavaliar', 'Registrar o novo posicionamento', 'tarefa', 10, 'Atualize o posicionamento na ficha (decisão da equipe, não do sistema).'),
    ],
  },
  {
    key: 'ativacao_defensor', name: 'Ativação de defensores', category: 'defensores', objective: 'Transformar quem já apoia em ponte para outras áreas e decisores.',
    successCriteria: 'Pelo menos uma indicação ou apresentação feita pelo defensor.',
    audience: { target: 'stakeholder', stances: ['defensor', 'favoravel'], minInfluence: 'medio' },
    steps: [
      st('agradecer', 'Manter a pessoa próxima', 'whatsapp', 0, 'Agradeça o apoio e compartilhe novidades relevantes para ela.', 'responsavel_relacionamento'),
      st('indicacao', 'Pedir indicação de outras áreas ou decisores', 'ligacao', 7, 'Registre quem foi indicado como relação "indicou".'),
      st('convite', 'Convidar para um caso de sucesso ou evento', 'email', 14, 'Dê visibilidade ao papel dela dentro da organização.'),
    ],
  },
  {
    key: 'expansao_cliente', name: 'Expansão em cliente ativo', category: 'expansao', objective: 'Levar a solução para novas áreas, unidades ou serviços.',
    successCriteria: 'Nova oportunidade aberta na conta.',
    audience: { target: 'conta', commercial: ['cliente_ativo'] },
    steps: [
      st('revisar', 'Revisar contratos, entregas e satisfação', 'tarefa', 0, 'Use a aba Contratos e o histórico de Sucesso do Cliente.', 'responsavel_conta'),
      st('areas', 'Mapear áreas e unidades ainda não atendidas', 'tarefa', 3, 'Compare a estrutura organizacional com o que já é atendido.'),
      st('reuniao', 'Reunião de expansão', 'reuniao', 10, 'Mostre resultados obtidos e proponha o próximo passo.'),
      st('proposta', 'Abrir a oportunidade e preparar a proposta', 'tarefa', 15, 'Crie a oportunidade na própria conta (sem novo cadastro).'),
    ],
  },
  {
    key: 'preparacao_renovacao', name: 'Preparação de renovação', category: 'renovacao', objective: 'Chegar à renovação com relacionamento, evidências e aprovadores mapeados.',
    successCriteria: 'Proposta de renovação apresentada antes do fim do contrato.',
    audience: { target: 'conta', contractEndingDays: 180 },
    steps: [
      st('entregas', 'Revisar entregas e indicadores do contrato', 'tarefa', 0, 'Reúna evidências de valor entregue.', 'responsavel_conta'),
      st('avaliacao', 'Reunião de avaliação com o fiscal ou gestor do contrato', 'reuniao', 7, 'Pergunte o que precisa melhorar para renovar.'),
      st('aprovadores', 'Confirmar quem aprova a renovação', 'tarefa', 10, 'Atualize papéis e avalie a influência manualmente, se mudou.'),
      st('proposta', 'Preparar a proposta de renovação', 'tarefa', 30, 'Use o processo de renovação de Gestão de Contratos.'),
    ],
  },
  {
    key: 'reativacao_ex_cliente', name: 'Reativação de ex-cliente', category: 'reativacao', objective: 'Retomar o relacionamento com quem já foi cliente.',
    successCriteria: 'Reunião com nova proposta realizada.',
    audience: { target: 'conta', commercial: ['ex_cliente', 'cliente_sem_contrato'] },
    steps: [
      st('motivo', 'Entender por que a conta saiu', 'tarefa', 0, 'Histórico, encerramento do contrato e conversas registradas.'),
      st('contato', 'Contato de reaproximação', 'ligacao', 3, 'O que mudou desde então? Quem decide hoje?'),
      st('proposta', 'Reunião com nova proposta', 'reuniao', 14, 'Mostre o que mudou na oferta e trate o motivo da saída.'),
    ],
  },
  {
    key: 'relacionamento_institucional', name: 'Relacionamento institucional', category: 'institucional', objective: 'Manter presença institucional e acompanhar o calendário de compras públicas.',
    successCriteria: 'Visita institucional realizada e calendário de compras registrado.',
    audience: { target: 'conta', nature: ['publica'] },
    steps: [
      st('agenda', 'Mapear agenda institucional e calendário de compras', 'tarefa', 0, 'PPA, LOA, atas vigentes e editais previstos.'),
      st('visita', 'Visita institucional', 'visita', 10, 'Gestor político-institucional e área técnica.', 'responsavel_conta'),
      st('material', 'Enviar material institucional', 'email', 12, 'Casos com outros órgãos públicos.'),
      st('editais', 'Acompanhar publicações e editais', 'tarefa', 30, 'Diário oficial e portal de compras.'),
    ],
  },
];

/** Erros de um play montado no construtor (vazio = válido). */
export function validatePlay(p: { name: string; steps: PlayStep[]; successCriteria: string; audience: PlayAudience }) {
  const e: string[] = [];
  if (p.name.trim().length < 3) e.push('Dê um nome ao play.');
  if (!p.steps.length) e.push('Inclua pelo menos uma etapa.');
  if (p.steps.length > 30) e.push('Um play tem no máximo 30 etapas.');
  const keys = new Set<string>();
  p.steps.forEach((s, i) => {
    if (s.title.trim().length < 3) e.push(`Etapa ${i + 1}: descreva o que fazer.`);
    if (!Number.isInteger(s.dayOffset) || s.dayOffset < 0 || s.dayOffset > 365) e.push(`Etapa ${i + 1}: o prazo vai de 0 a 365 dias depois do início.`);
    if (keys.has(s.key)) e.push(`Etapa ${i + 1}: identificador repetido.`);
    keys.add(s.key);
    if (s.assignee === 'responsavel_relacionamento' && p.audience.target !== 'stakeholder') e.push(`Etapa ${i + 1}: "responsável pelo relacionamento" só vale em play para uma pessoa.`);
  });
  if (p.successCriteria.trim().length < 5) e.push('Diga como saber que o play deu certo (critério de sucesso).');
  const a = p.audience;
  if (a.target === 'conta' && (a.roles?.length || a.stances?.length || a.minInfluence || a.relationship?.length)) e.push('Critérios de pessoa (papel, posicionamento, influência, relacionamento) só valem em play para uma pessoa.');
  if (a.target === 'stakeholder' && (a.commercial?.length || a.gaps?.length || a.contractEndingDays)) e.push('Critérios de conta (status comercial, lacunas, contrato) só valem em play para a conta.');
  return e;
}

/** Datas das etapas a partir do início (dias corridos). */
export const planSteps = (steps: PlayStep[], startOn: string) => steps.map((s) => ({ ...s, dueOn: addDays(startOn, s.dayOffset) }));

export type RunStepStatus = 'pendente' | 'concluida' | 'cancelada';
export function runProgress(steps: { status: RunStepStatus; dueOn: string }[], today: string) {
  const done = steps.filter((s) => s.status === 'concluida').length;
  const canceled = steps.filter((s) => s.status === 'cancelada').length;
  const open = steps.filter((s) => s.status === 'pendente');
  return { total: steps.length, done, canceled, open: open.length, late: open.filter((s) => s.dueOn < today).length, pct: steps.length - canceled ? Math.round((done / (steps.length - canceled)) * 100) : 0, canConclude: open.length === 0 && done > 0 };
}

// ---------------------------------------------------------------- sugestões justificadas
export type AccountCtx = {
  commercial: CommercialStatus; nature: 'publica' | 'privada' | null; nextContractEndDays: number | null;
  stakeholders: { id: string; name: string; roles: StakeholderRole[]; stance: Stance; influence: InfluenceLevel | null; relationship: RelationshipStrength; active: boolean }[];
  influenceVisible: boolean;
  /** plays em andamento nesta conta: chave = playId + (stakeholderId ou '') */
  running: Set<string>;
};
export type SuggestablePlay = { id: string; name: string; category: PlayCategory; audience: PlayAudience; active: boolean };
export type Suggestion = { playId: string; playName: string; stakeholderId: string | null; stakeholderName: string | null; reasons: string[] };

export function accountGaps(ctx: AccountCtx): PlayGap[] {
  const act = ctx.stakeholders.filter((s) => s.active);
  const g: PlayGap[] = [];
  if (!act.some((s) => s.roles.includes('decisor'))) g.push('sem_decisor');
  if (ctx.influenceVisible && act.some((s) => s.influence === 'nao_avaliado')) g.push('sem_avaliacao');
  if (act.length < 3) g.push('poucos_stakeholders');
  return g;
}

/** Motivos pelos quais a conta atende ao público do play (null = não atende). */
function accountReasons(a: PlayAudience, ctx: AccountCtx): string[] | null {
  const r: string[] = [];
  if (a.commercial?.length) { if (!a.commercial.includes(ctx.commercial)) return null; r.push(`Status comercial: ${COMMERCIAL_STATUS_LABELS[ctx.commercial]}`); }
  if (a.nature?.length) { if (!ctx.nature || !a.nature.includes(ctx.nature)) return null; r.push(ctx.nature === 'publica' ? 'Organização pública' : 'Organização privada'); }
  if (a.contractEndingDays) { if (ctx.nextContractEndDays === null || ctx.nextContractEndDays < 0 || ctx.nextContractEndDays > a.contractEndingDays) return null; r.push(`Contrato vence em ${ctx.nextContractEndDays} dia(s)`); }
  if (a.gaps?.length) {
    const g = accountGaps(ctx).filter((x) => a.gaps!.includes(x));
    if (!g.length) return null;
    const unassessed = ctx.stakeholders.filter((s) => s.active && s.influence === 'nao_avaliado').length;
    r.push(...g.map((x) => (x === 'sem_avaliacao' ? `${unassessed} pessoa(s) sem influência avaliada` : PLAY_GAP_LABELS[x])));
  }
  return r.length ? r : null;
}

/** Motivos pelos quais a pessoa atende ao público do play. A influência é a avaliada pela equipe; "não avaliado" nunca conta como alta. */
function personReasons(a: PlayAudience, p: AccountCtx['stakeholders'][number], influenceVisible: boolean): string[] | null {
  const r: string[] = [];
  if (a.roles?.length) { const m = p.roles.filter((x) => a.roles!.includes(x)); if (!m.length) return null; r.push(`Papel: ${m.map((x) => STAKEHOLDER_ROLE_LABELS[x]).join(', ')}`); }
  if (a.stances?.length) { if (!a.stances.includes(p.stance)) return null; r.push(`Posicionamento: ${STANCE_LABELS[p.stance]}`); }
  if (a.minInfluence) {
    if (!influenceVisible || !p.influence) return null;
    const have = influenceRank(p.influence); const need = influenceRank(a.minInfluence);
    if (have === null || need === null || have < need) return null;
    r.push(`Influência ${DEFAULT_INFLUENCE_LABELS[p.influence].toLowerCase()} (avaliada pela equipe)`);
  }
  if (a.relationship?.length) { if (!a.relationship.includes(p.relationship)) return null; r.push(`Relacionamento: ${RELATIONSHIP_LABELS[p.relationship].toLowerCase()}`); }
  return r.length ? r : null;
}

/** Plays recomendados para a conta e suas pessoas, cada um com os motivos. Não altera nenhum dado. */
export function suggestPlays(plays: SuggestablePlay[], ctx: AccountCtx): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of plays.filter((x) => x.active)) {
    if (p.audience.target === 'conta') {
      if (ctx.running.has(`${p.id}:`)) continue;
      const r = accountReasons(p.audience, ctx);
      if (r) out.push({ playId: p.id, playName: p.name, stakeholderId: null, stakeholderName: null, reasons: r });
    } else {
      for (const s of ctx.stakeholders.filter((x) => x.active)) {
        if (ctx.running.has(`${p.id}:${s.id}`)) continue;
        const r = personReasons(p.audience, s, ctx.influenceVisible);
        if (r) out.push({ playId: p.id, playName: p.name, stakeholderId: s.id, stakeholderName: s.name, reasons: r });
      }
    }
  }
  return out;
}
