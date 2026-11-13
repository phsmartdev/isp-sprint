/**
 * Compliance de brindes, apoios e patrocínios: diretrizes parametrizáveis e avaliação automática.
 * O sistema identifica e informa; a autoridade competente decide. Só restrição obrigatória impede.
 * Nenhum valor ou limite vem pronto: a empresa cadastra as diretrizes da política vigente.
 */
import { POWER_CLASS_LABELS, type PowerClass } from './stakeholders';

export const CONCESSION_KINDS = ['brinde', 'kit', 'material', 'apoio_evento', 'patrocinio_financeiro', 'patrocinio_produto', 'outro'] as const;
export type ConcessionKind = (typeof CONCESSION_KINDS)[number];
export const CONCESSION_KIND_LABELS: Record<ConcessionKind, string> = {
  brinde: 'Brinde individual', kit: 'Kit institucional', material: 'Material promocional', apoio_evento: 'Apoio a evento',
  patrocinio_financeiro: 'Patrocínio financeiro', patrocinio_produto: 'Patrocínio com produtos ou serviços', outro: 'Outra concessão institucional',
};

export const CONCESSION_PURPOSES = ['relacionamento', 'abm', 'oportunidade', 'campanha', 'evento', 'institucional'] as const;
export type ConcessionPurpose = (typeof CONCESSION_PURPOSES)[number];
export const CONCESSION_PURPOSE_LABELS: Record<ConcessionPurpose, string> = {
  relacionamento: 'Relacionamento com a conta', abm: 'Conta estratégica (ABM)', oportunidade: 'Oportunidade em andamento', campanha: 'Campanha', evento: 'Evento', institucional: 'Ação institucional',
};

/** Situação da concessão: solicitado → aprovado → reservado → executado; ou ajustes, rejeitado, cancelado. */
export const CONCESSION_STATES = ['solicitado', 'ajustes', 'aprovado', 'reservado', 'executado', 'rejeitado', 'cancelado'] as const;
export type ConcessionState = (typeof CONCESSION_STATES)[number];
export const CONCESSION_STATE_LABELS: Record<ConcessionState, string> = {
  solicitado: 'Solicitado', ajustes: 'Ajustes pedidos', aprovado: 'Aprovado', reservado: 'Reservado', executado: 'Executado', rejeitado: 'Rejeitado', cancelado: 'Cancelado',
};

export const CONTROL_TYPES = ['orientativa', 'autorizacao', 'restricao'] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];
export const CONTROL_TYPE_LABELS: Record<ControlType, string> = {
  orientativa: 'Orientativa (permite exceção justificada)', autorizacao: 'Sujeita à autorização', restricao: 'Restrição obrigatória (impede)',
};

/** Política (Diretrizes de Relacionamento Institucional): categorias de kit e a matriz por classificação do stakeholder. */
export const KIT_CATEGORIES = ['A', 'B', 'C', 'D'] as const;
export type KitCategory = (typeof KIT_CATEGORIES)[number];
export const KIT_CATEGORY_LABELS: Record<KitCategory, string> = { A: 'A · Relacionamento estratégico', B: 'B · Relacionamento recorrente', C: 'C · Relacionamento específico', D: 'D · Relacionamento geral' };
type ClassifiedPower = Exclude<PowerClass, 'nao_avaliado'>;
/** IA → A, B, C ou D; INA → B, C ou D; NIA → C ou D; NINA → D (item 8 da política). */
export const POLICY_MATRIX: Record<ClassifiedPower, KitCategory[]> = { ia: ['A', 'B', 'C', 'D'], ina: ['B', 'C', 'D'], nia: ['C', 'D'], nina: ['D'] };
/** Situações de atenção (item 10 da política). */
export const ATTENTION_SITUATIONS = ['licitacao', 'contratacao', 'negociacao', 'renovacao', 'decisao_administrativa', 'fiscalizacao', 'medicao', 'aceite', 'pagamento', 'aprovacao_projeto', 'analise_proposta', 'penalidade', 'decisao_de_interesse'] as const;
export type AttentionSituation = (typeof ATTENTION_SITUATIONS)[number];
export const ATTENTION_LABELS: Record<AttentionSituation, string> = {
  licitacao: 'Processo licitatório', contratacao: 'Processo de contratação', negociacao: 'Negociação comercial', renovacao: 'Renovação contratual', decisao_administrativa: 'Decisão administrativa relevante',
  fiscalizacao: 'Fiscalização', medicao: 'Medição', aceite: 'Aceite de entregas', pagamento: 'Pagamento', aprovacao_projeto: 'Aprovação de projeto', analise_proposta: 'Análise de proposta',
  penalidade: 'Aplicação ou discussão de penalidade', decisao_de_interesse: 'Destinatário envolvido em decisão de interesse da empresa',
};

export const RULE_PARAMS = ['valor_por_kit', 'matriz_stakeholder', 'situacao_atencao', 'valor_por_concessao', 'valor_acumulado_conta', 'valor_periodo', 'quantidade_itens', 'composicao_kit', 'frequencia_conta', 'orcamento_disponivel', 'condicao'] as const;
export type RuleParam = (typeof RULE_PARAMS)[number];
export const RULE_PARAM_LABELS: Record<RuleParam, string> = {
  valor_por_kit: 'Valor máximo por kit (por categoria)',
  matriz_stakeholder: 'Categoria compatível com a classificação do stakeholder',
  situacao_atencao: 'Situação de atenção (licitação, negociação, renovação…)',
  valor_por_concessao: 'Limite por concessão (R$)',
  valor_acumulado_conta: 'Limite acumulado por conta no período (R$)',
  valor_periodo: 'Limite total no período (R$)',
  quantidade_itens: 'Quantidade máxima de itens',
  composicao_kit: 'Composição permitida (kits e itens)',
  frequencia_conta: 'Frequência máxima por conta no período',
  orcamento_disponivel: 'Orçamento disponível no lançamento vinculado',
  condicao: 'Condição (vale sempre que o escopo combinar)',
};
/** parâmetros que usam janela de dias */
export const WINDOW_PARAMS: RuleParam[] = ['valor_acumulado_conta', 'valor_periodo', 'frequencia_conta'];

export type ApproverLevel = 'gerencia' | 'diretoria';
export const APPROVER_LEVEL_LABELS: Record<ApproverLevel, string> = { gerencia: 'Gestão comercial', diretoria: 'Diretoria' };

export type ComplianceRule = {
  id: string; key: string; version: number; name: string; description: string | null;
  param: RuleParam; controlType: ControlType; approverLevel: ApproverLevel;
  /** limite em centavos (valores), em unidades (itens) ou em vezes (frequência) */
  limit: number | null; windowDays: number | null;
  /** composição permitida */
  allowedKitIds: string[]; allowedItemIds: string[];
  /** escopo: vazio = vale para todos */
  kinds: ConcessionKind[]; natures: ('publica' | 'privada')[]; segments: string[]; purposes: ConcessionPurpose[];
  /** categorias de kit às quais a diretriz se aplica (vazio = todas) */
  kitCategories: KitCategory[];
  validFrom: string; validTo: string | null; active: boolean;
};

export type RequestForEval = {
  kind: ConcessionKind; purpose: ConcessionPurpose; totalCents: number; itemUnits: number;
  /** kits escolhidos e itens avulsos (fora de kit) */
  kitIds: string[]; itemIds: string[];
  /** contas e a parte de cada uma (centavos) */
  accounts: { id: string; name: string; nature: 'publica' | 'privada' | null; segment: string | null; shareCents: number }[];
  /** saldo do lançamento de orçamento vinculado (null = sem lançamento) */
  budgetAvailableCents: number | null;
  on: string;
  /** categoria do kit escolhida e valor por kit/destinatário */
  kitCategory?: KitCategory | null; unitCents?: number;
  /** destinatários (stakeholders) com a classificação; vazio em entrega coletiva */
  recipients?: { name: string; powerClass: PowerClass }[];
  collective?: boolean;
  /** situações de atenção declaradas e as detectadas (ex.: oportunidade em negociação na conta) */
  attention?: string[];
};
/** Histórico relevante: concessões aprovadas, reservadas ou executadas (não canceladas nem rejeitadas), exceto a avaliada. */
export type HistoryEntry = { on: string; totalCents: number; accounts: { id: string; shareCents: number }[] };

export type Finding = {
  ruleId: string; ruleKey: string; version: number; name: string; param: RuleParam; controlType: ControlType; approverLevel: ApproverLevel;
  limit: number | null; actual: number; unit: 'centavos' | 'itens' | 'vezes' | null; accountName: string | null; history: string | null; message: string;
};
export type Outcome = 'conforme' | 'autorizacao' | 'excecao' | 'impedido';
export const OUTCOME_LABELS: Record<Outcome, string> = {
  conforme: 'Dentro das diretrizes', autorizacao: 'Exige autorização', excecao: 'Fora do recomendado (exceção)', impedido: 'Impedido por restrição obrigatória',
};
export type Evaluation = { outcome: Outcome; level: ApproverLevel | null; findings: Finding[]; rules: { id: string; key: string; version: number }[]; evaluatedOn: string };

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Diretriz vale na data e para o escopo da solicitação (conta = qualquer conta da solicitação). */
export function ruleApplies(r: ComplianceRule, req: RequestForEval) {
  if (!r.active || r.validFrom > req.on || (r.validTo && r.validTo < req.on)) return false;
  if (r.kinds.length && !r.kinds.includes(req.kind)) return false;
  if (r.purposes.length && !r.purposes.includes(req.purpose)) return false;
  if (r.natures.length && !req.accounts.some((a) => a.nature && r.natures.includes(a.nature))) return false;
  if (r.segments.length && !req.accounts.some((a) => a.segment && r.segments.includes(a.segment))) return false;
  if (r.kitCategories?.length && (!req.kitCategory || !r.kitCategories.includes(req.kitCategory))) return false;
  return true;
}

/** Versão vigente de cada diretriz na data (a maior versão ativa com vigência na data). */
export function currentRules(all: ComplianceRule[], on: string) {
  const byKey = new Map<string, ComplianceRule>();
  for (const r of all) {
    if (r.validFrom > on || (r.validTo && r.validTo < on)) continue;
    const cur = byKey.get(r.key);
    if (!cur || r.version > cur.version) byKey.set(r.key, r);
  }
  return [...byKey.values()].filter((r) => r.active);
}

const RANK: Record<Outcome, number> = { conforme: 0, autorizacao: 1, excecao: 2, impedido: 3 };

export function evaluateConcession(rules: ComplianceRule[], req: RequestForEval, history: HistoryEntry[]): Evaluation {
  const findings: Finding[] = [];
  const applied = rules.filter((r) => ruleApplies(r, req));
  const add = (r: ComplianceRule, actual: number, unit: Finding['unit'], extra: { accountName?: string | null; history?: string | null; what: string }) => {
    const limitTxt = r.limit == null ? '' : unit === 'centavos' ? brl(r.limit) : `${r.limit}`;
    const actualTxt = unit === 'centavos' ? brl(actual) : `${actual}`;
    const msg = r.controlType === 'restricao'
      ? `Restrição obrigatória: ${r.name}${extra.accountName ? ` (${extra.accountName})` : ''}. A concessão não pode ser executada sem tratamento formal compatível com as normas aplicáveis.`
      : r.controlType === 'orientativa'
        ? `A solicitação ultrapassa o recomendado em "${r.name}"${extra.accountName ? ` para ${extra.accountName}` : ''}: ${extra.what} ${actualTxt}${limitTxt ? `, limite ${limitTxt}` : ''}. Pode prosseguir com justificativa e autorização da ${APPROVER_LEVEL_LABELS[r.approverLevel]}.`
        : `"${r.name}"${extra.accountName ? ` (${extra.accountName})` : ''} exige autorização da ${APPROVER_LEVEL_LABELS[r.approverLevel]}: ${extra.what} ${actualTxt}${limitTxt ? `, limite ${limitTxt}` : ''}.`;
    findings.push({ ruleId: r.id, ruleKey: r.key, version: r.version, name: r.name, param: r.param, controlType: r.controlType, approverLevel: r.approverLevel, limit: r.limit, actual, unit, accountName: extra.accountName ?? null, history: extra.history ?? null, message: msg });
  };
  for (const r of applied) {
    const from = r.windowDays ? addDays(req.on, -r.windowDays) : null;
    const inWin = history.filter((h) => !from || (h.on >= from && h.on <= req.on));
    switch (r.param) {
      case 'valor_por_concessao':
        if (r.limit != null && req.totalCents > r.limit) add(r, req.totalCents, 'centavos', { what: 'valor' });
        break;
      case 'valor_periodo': {
        const sum = inWin.reduce((t, h) => t + h.totalCents, 0);
        if (r.limit != null && sum + req.totalCents > r.limit) add(r, sum + req.totalCents, 'centavos', { what: 'total no período com esta', history: `${brl(sum)} já concedidos ${r.windowDays ? `nos últimos ${r.windowDays} dias` : 'no histórico'}` });
        break;
      }
      case 'valor_acumulado_conta':
        for (const a of req.accounts) {
          const prev = inWin.reduce((t, h) => t + (h.accounts.find((x) => x.id === a.id)?.shareCents ?? 0), 0);
          if (r.limit != null && prev + a.shareCents > r.limit) add(r, prev + a.shareCents, 'centavos', { accountName: a.name, what: 'acumulado da conta com esta', history: `${brl(prev)} já concedidos à conta ${r.windowDays ? `nos últimos ${r.windowDays} dias` : 'no histórico'}` });
        }
        break;
      case 'frequencia_conta':
        for (const a of req.accounts) {
          const n = inWin.filter((h) => h.accounts.some((x) => x.id === a.id)).length;
          if (r.limit != null && n + 1 > r.limit) add(r, n + 1, 'vezes', { accountName: a.name, what: 'concessões à conta com esta', history: `${n} concessão(ões) à conta ${r.windowDays ? `nos últimos ${r.windowDays} dias` : 'no histórico'}` });
        }
        break;
      case 'quantidade_itens':
        if (r.limit != null && req.itemUnits > r.limit) add(r, req.itemUnits, 'itens', { what: 'itens' });
        break;
      case 'composicao_kit': {
        // kits fora da lista (se houver lista de kits) e itens avulsos fora da lista (se houver lista de itens)
        const badKits = r.allowedKitIds.length ? req.kitIds.filter((k) => !r.allowedKitIds.includes(k)) : [];
        const badItems = r.allowedItemIds.length ? req.itemIds.filter((i) => !r.allowedItemIds.includes(i)) : [];
        if (badKits.length + badItems.length) add(r, badKits.length + badItems.length, 'itens', { what: 'kits ou itens fora da composição permitida:' });
        break;
      }
      case 'orcamento_disponivel':
        if (req.budgetAvailableCents == null) add(r, req.totalCents, 'centavos', { what: 'sem lançamento de orçamento vinculado; valor' });
        else if (req.totalCents > req.budgetAvailableCents) add(r, req.totalCents, 'centavos', { what: 'valor acima do saldo do lançamento', history: `saldo ${brl(req.budgetAvailableCents)}` });
        break;
      case 'condicao':
        add(r, 0, null, { what: 'condição aplicável' });
        break;
      case 'valor_por_kit': {
        const unit = req.unitCents ?? req.totalCents;
        if (r.limit != null && unit > r.limit) add(r, unit, 'centavos', { what: `valor por kit${req.kitCategory ? ` (categoria ${req.kitCategory})` : ''}` });
        break;
      }
      case 'matriz_stakeholder': {
        if (!req.kitCategory || req.collective) break;
        for (const p of req.recipients ?? []) {
          if (p.powerClass === 'nao_avaliado') { add(r, 0, null, { accountName: p.name, what: 'stakeholder sem classificação IA/INA/NIA/NINA; categoria' }); continue; }
          const ok = POLICY_MATRIX[p.powerClass];
          if (!ok.includes(req.kitCategory)) {
            findings.push({ ruleId: r.id, ruleKey: r.key, version: r.version, name: r.name, param: r.param, controlType: r.controlType, approverLevel: r.approverLevel, limit: null, actual: 0, unit: null, accountName: p.name, history: null,
              message: `Categoria ${req.kitCategory} acima da prevista para ${p.name} (${POWER_CLASS_LABELS[p.powerClass]}: categorias ${ok.join(', ')}). ${r.controlType === 'orientativa' ? 'Exceção: exige justificativa e autorização.' : r.controlType === 'restricao' ? 'Impede a execução.' : 'Exige autorização.'}` });
          }
        }
        break;
      }
      case 'situacao_atencao': {
        const at = req.attention ?? [];
        if (at.length) findings.push({ ruleId: r.id, ruleKey: r.key, version: r.version, name: r.name, param: r.param, controlType: r.controlType, approverLevel: r.approverLevel, limit: null, actual: at.length, unit: null, accountName: null, history: null,
          message: `Situação de atenção: ${at.join('; ')}. Pode ser recomendável postergar ou não realizar a entrega; ${r.controlType === 'restricao' ? 'impede a execução' : `exige autorização da ${APPROVER_LEVEL_LABELS[r.approverLevel]}`}.` });
        break;
      }
    }
  }
  const outcomeOf = (f: Finding): Outcome => (f.controlType === 'restricao' ? 'impedido' : f.controlType === 'orientativa' ? 'excecao' : 'autorizacao');
  const outcome = findings.reduce<Outcome>((o, f) => (RANK[outcomeOf(f)] > RANK[o] ? outcomeOf(f) : o), 'conforme');
  const levels = findings.filter((f) => f.controlType !== 'restricao').map((f) => f.approverLevel);
  const level: ApproverLevel | null = outcome === 'impedido' ? null : levels.includes('diretoria') ? 'diretoria' : levels.length ? 'gerencia' : null;
  return { outcome, level, findings, rules: applied.map((r) => ({ id: r.id, key: r.key, version: r.version })), evaluatedOn: req.on };
}

/** Rateio: soma das partes = total (a diferença de arredondamento fica na primeira conta). */
export function splitEvenly(totalCents: number, n: number) {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? totalCents - base * n : 0));
}

export const CONCESSION_DECISIONS = ['aprovar', 'aprovar_excecao', 'ajustes', 'rejeitar'] as const;
export type ConcessionDecision = (typeof CONCESSION_DECISIONS)[number];
export const CONCESSION_DECISION_LABELS: Record<ConcessionDecision, string> = { aprovar: 'Aprovar', aprovar_excecao: 'Aprovar excepcionalmente', ajustes: 'Solicitar ajustes', rejeitar: 'Rejeitar' };

/** Quais decisões cabem a quem tem estas alçadas, dada a avaliação. */
export function allowedDecisions(ev: Pick<Evaluation, 'outcome' | 'level'>, myLevels: ApproverLevel[], conformingLevel: ApproverLevel | null): { decisions: ConcessionDecision[]; reason: string | null } {
  const need = ev.outcome === 'conforme' ? conformingLevel : ev.level;
  const canLevel = need === null || myLevels.includes(need) || (need === 'gerencia' && myLevels.includes('diretoria'));
  if (!myLevels.length) return { decisions: [], reason: 'Só a Gestão comercial e a Diretoria (cargo liderança) decidem.' };
  if (!canLevel) return { decisions: [], reason: `Esta solicitação precisa da alçada ${APPROVER_LEVEL_LABELS[need!]}.` };
  if (ev.outcome === 'impedido') return { decisions: ['ajustes', 'rejeitar'], reason: 'Restrição obrigatória: não pode ser aprovada por autorização gerencial.' };
  if (ev.outcome === 'excecao') return { decisions: ['aprovar_excecao', 'ajustes', 'rejeitar'], reason: null };
  return { decisions: ['aprovar', 'ajustes', 'rejeitar'], reason: null };
}

export type ExecutedForKpi = { totalCents: number; accountIds: string[]; exception: boolean; complete: boolean };
/** Indicadores só sobre concessões executadas (não misturam pendentes). Taxas com o mesmo denominador. */
export function complianceKpis(executed: ExecutedForKpi[], pendencies: number) {
  const n = executed.length;
  const exc = executed.filter((e) => e.exception).length;
  const pct = (x: number) => (n ? Math.round((x / n) * 1000) / 10 : null);
  return {
    realizedCents: executed.reduce((t, e) => t + e.totalCents, 0),
    executed: n,
    accounts: new Set(executed.flatMap((e) => e.accountIds)).size,
    exceptions: exc,
    conformityPct: pct(n - exc),
    exceptionPct: pct(exc),
    traceabilityPct: pct(executed.filter((e) => e.complete).length),
    pendencies,
  };
}
