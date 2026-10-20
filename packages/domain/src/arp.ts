/**
 * Atas de Registro de Preços (ARP): regras puras.
 * - Quantidades em milésimos (qty × 1000) para aceitar unidades fracionadas; dinheiro em centavos.
 * - Saldo vem SEMPRE do livro de movimentações (ledger imutável): nada é editado, correções são compensatórias.
 * - Reserva ≠ consumo. Consumo só com o evento documental de formalização.
 * - Adesões (órgãos não participantes) não consomem a cota dos participantes; têm limites legais próprios.
 * - Conversão, remanejamento, correção, alteração de preço e cancelamento são operações distintas.
 */

export const QTY = 1000;
export const toMilli = (v: number) => Math.round(v * QTY);
export const fromMilli = (m: number) => m / QTY;
export const fmtQty = (m: number) => (m / QTY).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** valor = quantidade × preço unitário (milésimos × centavos / 1000), arredondado ao centavo */
export const lineValue = (qtyMilli: number, unitCents: number) => Math.round((qtyMilli * unitCents) / QTY);

export const ARP_STATUSES = ['rascunho', 'vigente', 'encerrada', 'cancelada'] as const;
export type ArpStatus = (typeof ARP_STATUSES)[number];
export const ARP_STATUS_LABELS: Record<ArpStatus, string> = { rascunho: 'Em cadastro', vigente: 'Vigente', encerrada: 'Encerrada', cancelada: 'Cancelada' };

export const ARP_REGIMES = ['federal', 'estadual', 'municipal', 'distrital', 'estatal'] as const;
export type ArpRegime = (typeof ARP_REGIMES)[number];
export const ARP_REGIME_LABELS: Record<ArpRegime, string> = {
  federal: 'Federal (Lei 14.133/2021 e Decreto 11.462/2023)',
  estadual: 'Estadual (Lei 14.133/2021 e regulamento estadual)',
  municipal: 'Municipal (Lei 14.133/2021 e regulamento municipal)',
  distrital: 'Distrital (Lei 14.133/2021 e regulamento distrital)',
  estatal: 'Empresa estatal (Lei 13.303/2016 e regulamento próprio)',
};

export const AGENCY_KINDS = ['gerenciador', 'participante', 'nao_participante'] as const;
export type AgencyKind = (typeof AGENCY_KINDS)[number];
export const AGENCY_KIND_LABELS: Record<AgencyKind, string> = { gerenciador: 'Gerenciador', participante: 'Participante', nao_participante: 'Não participante (adesão)' };

/** Livro de movimentações. `dir` só vale para remanejamento e conversão (saída/entrada). */
export const ARP_LEDGER_KINDS = ['reserva', 'liberacao', 'consumo', 'estorno', 'remanejamento', 'conversao_proposta', 'conversao', 'ajuste', 'cancelamento', 'adesao', 'execucao', 'faturamento'] as const;
export type ArpLedgerKind = (typeof ARP_LEDGER_KINDS)[number];
export const ARP_LEDGER_LABELS: Record<ArpLedgerKind, string> = {
  reserva: 'Reserva', liberacao: 'Liberação de reserva', consumo: 'Consumo confirmado', estorno: 'Estorno', remanejamento: 'Remanejamento',
  conversao_proposta: 'Conversão proposta', conversao: 'Conversão autorizada', ajuste: 'Ajuste formal', cancelamento: 'Cancelamento',
  adesao: 'Adesão autorizada', execucao: 'Execução registrada', faturamento: 'Faturamento registrado',
};
export type ArpLedgerEntry = { id?: string; kind: ArpLedgerKind; itemId: string; agencyId: string; qtyMilli: number; dir?: 'saida' | 'entrada' | null; amountCents?: number; reversesId?: string | null };

export type ItemBase = { id: string; registeredMilli: number; unitCents: number };
export type AgencyBase = { id: string; kind: AgencyKind };
/** Distribuição inicial: cota de cada participante por item. O que não foi distribuído é do gerenciador. */
export type Allocation = { itemId: string; agencyId: string; qtyMilli: number };

export type Bucket = {
  /** cota oficial (participantes/gerenciador) ou quantidade autorizada em adesão (não participantes) */
  quota: number; reserved: number; contracted: number; executed: number; billed: number; available: number;
};
const empty = (): Bucket => ({ quota: 0, reserved: 0, contracted: 0, executed: 0, billed: 0, available: 0 });

export type Balances = {
  byItemAgency: Map<string, Bucket>;
  byItem: Map<string, Bucket & { registered: number; adhesionAuthorized: number; adhesionAvailable: number }>;
};
export const key = (itemId: string, agencyId: string) => `${itemId}|${agencyId}`;

/** Saldos a partir do registro original + distribuição + ledger. Função pura: mesma entrada, mesmo saldo. */
export function computeBalances(items: ItemBase[], agencies: AgencyBase[], allocations: Allocation[], ledger: ArpLedgerEntry[]): Balances {
  const kindOf = new Map(agencies.map((a) => [a.id, a.kind]));
  const manager = agencies.find((a) => a.kind === 'gerenciador')?.id ?? null;
  const ia = new Map<string, Bucket>();
  const get = (itemId: string, agencyId: string) => { const k = key(itemId, agencyId); if (!ia.has(k)) ia.set(k, empty()); return ia.get(k)!; };
  for (const it of items) {
    const distributed = allocations.filter((a) => a.itemId === it.id && a.agencyId !== manager).reduce((s, a) => s + a.qtyMilli, 0);
    for (const a of allocations.filter((x) => x.itemId === it.id && x.agencyId !== manager)) get(it.id, a.agencyId).quota += a.qtyMilli;
    if (manager) get(it.id, manager).quota += it.registeredMilli - distributed;
  }
  for (const e of ledger) {
    const b = get(e.itemId, e.agencyId);
    const sgn = e.dir === 'saida' ? -1 : 1;
    switch (e.kind) {
      case 'reserva': b.reserved += e.qtyMilli; break;
      case 'liberacao': b.reserved -= e.qtyMilli; break;
      case 'consumo': b.contracted += e.qtyMilli; break;
      case 'estorno': b.contracted -= e.qtyMilli; break;
      case 'execucao': b.executed += e.qtyMilli; break;
      case 'faturamento': b.billed += e.qtyMilli; break;
      case 'remanejamento': case 'conversao': b.quota += sgn * e.qtyMilli; break;
      case 'ajuste': b.quota += e.qtyMilli; break; // ajuste é com sinal
      case 'cancelamento': b.quota -= e.qtyMilli; break;
      case 'adesao': b.quota += e.qtyMilli; break; // cota do não participante
      case 'conversao_proposta': break; // só registro
    }
  }
  const byItem: Balances['byItem'] = new Map();
  for (const it of items) byItem.set(it.id, { ...empty(), registered: 0, adhesionAuthorized: 0, adhesionAvailable: 0 });
  for (const [k, b] of ia) {
    b.available = b.quota - b.reserved - b.contracted;
    const [itemId, agencyId] = k.split('|') as [string, string];
    const t = byItem.get(itemId);
    if (!t) continue;
    if (kindOf.get(agencyId) === 'nao_participante') { t.adhesionAuthorized += b.quota; t.adhesionAvailable += b.available; }
    else { t.registered += b.quota; t.available += b.available; t.quota += b.quota; }
    t.reserved += b.reserved; t.contracted += b.contracted; t.executed += b.executed; t.billed += b.billed;
  }
  return { byItemAgency: ia, byItem };
}

// ------------------------------------------------------------------ limites legais (adesão)

export type ArpRules = {
  /** limite por órgão não participante, por item, sobre o quantitativo registrado (pontos-base: 5000 = 50%) */
  adhesionPerAgencyBp: number;
  /** limite total das adesões por item, sobre o quantitativo registrado (20000 = 200%, o dobro) */
  adhesionTotalBp: number;
  /** prazo para contratar depois da autorização da adesão (dias) */
  contractDeadlineDays: number;
  /** adesão de não participantes permitida pelo regulamento do ente */
  allowAdhesion: boolean;
  /** remanejamento entre participantes exige autorização do gerenciador */
  remanejamentoNeedsManager: boolean;
  /** conversão entre itens admitida pelo regulamento (sempre sem aumentar valor nem criar objeto) */
  allowConversion: boolean;
  legalBasis: string;
};

/** Tetos legais obrigatórios (Lei 14.133/2021, art. 86, §§ 4º e 5º): a configuração só pode ser mais restritiva. */
export const LEGAL_CAPS: Record<ArpRegime, Pick<ArpRules, 'adhesionPerAgencyBp' | 'adhesionTotalBp'>> = {
  federal: { adhesionPerAgencyBp: 5000, adhesionTotalBp: 20000 },
  estadual: { adhesionPerAgencyBp: 5000, adhesionTotalBp: 20000 },
  municipal: { adhesionPerAgencyBp: 5000, adhesionTotalBp: 20000 },
  distrital: { adhesionPerAgencyBp: 5000, adhesionTotalBp: 20000 },
  estatal: { adhesionPerAgencyBp: 5000, adhesionTotalBp: 20000 },
};

export const DEFAULT_RULES: Record<ArpRegime, ArpRules> = {
  federal: { ...LEGAL_CAPS.federal, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Lei 14.133/2021, art. 86, §§ 2º a 5º; Decreto 11.462/2023, arts. 30 a 32.' },
  estadual: { ...LEGAL_CAPS.estadual, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Lei 14.133/2021, art. 86, §§ 2º a 5º; regulamento estadual.' },
  municipal: { ...LEGAL_CAPS.municipal, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Lei 14.133/2021, art. 86, §§ 2º a 5º; regulamento municipal.' },
  distrital: { ...LEGAL_CAPS.distrital, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Lei 14.133/2021, art. 86, §§ 2º a 5º; regulamento distrital.' },
  estatal: { ...LEGAL_CAPS.estatal, contractDeadlineDays: 90, allowAdhesion: true, remanejamentoNeedsManager: true, allowConversion: false, legalBasis: 'Lei 13.303/2016 e regulamento de licitações da estatal.' },
};

/** Valida uma configuração: nunca acima do teto legal. */
export function validateRules(regime: ArpRegime, r: ArpRules): string[] {
  const cap = LEGAL_CAPS[regime];
  const errs: string[] = [];
  if (r.adhesionPerAgencyBp > cap.adhesionPerAgencyBp) errs.push(`Limite por órgão acima do teto legal (${cap.adhesionPerAgencyBp / 100}%).`);
  if (r.adhesionTotalBp > cap.adhesionTotalBp) errs.push(`Limite total de adesões acima do teto legal (${cap.adhesionTotalBp / 100}%).`);
  if (r.adhesionPerAgencyBp < 0 || r.adhesionTotalBp < 0) errs.push('Limites não podem ser negativos.');
  if (r.contractDeadlineDays < 1 || r.contractDeadlineDays > 365) errs.push('Prazo de contratação deve ficar entre 1 e 365 dias.');
  return errs;
}

export type AdhesionCheck = { ok: boolean; lines: { itemId: string; requested: number; perAgencyLimit: number; perAgencyUsed: number; totalLimit: number; totalUsed: number; violations: string[] }[] };

/**
 * Limites da adesão por item: por órgão (já autorizado a ele + pedido ≤ X% do registrado) e total (todas as adesões ≤ Y%).
 * `registered` = quantitativo registrado do item (soma das cotas oficiais).
 */
export function checkAdhesion(rules: ArpRules, req: { itemId: string; qtyMilli: number }[], ctx: { registered: Map<string, number>; agencyAuthorized: Map<string, number>; totalAuthorized: Map<string, number> }): AdhesionCheck {
  const lines = req.map((r) => {
    const reg = ctx.registered.get(r.itemId) ?? 0;
    const perLimit = Math.floor((reg * rules.adhesionPerAgencyBp) / 10_000);
    const totLimit = Math.floor((reg * rules.adhesionTotalBp) / 10_000);
    const perUsed = ctx.agencyAuthorized.get(r.itemId) ?? 0;
    const totUsed = ctx.totalAuthorized.get(r.itemId) ?? 0;
    const v: string[] = [];
    if (!rules.allowAdhesion) v.push('O regulamento aplicado não admite adesão.');
    if (r.qtyMilli <= 0) v.push('Quantidade deve ser maior que zero.');
    if (perUsed + r.qtyMilli > perLimit) v.push(`Ultrapassa o limite por órgão: ${fmtQty(perUsed + r.qtyMilli)} de ${fmtQty(perLimit)} (${rules.adhesionPerAgencyBp / 100}% do registrado).`);
    if (totUsed + r.qtyMilli > totLimit) v.push(`Ultrapassa o limite total de adesões: ${fmtQty(totUsed + r.qtyMilli)} de ${fmtQty(totLimit)} (${rules.adhesionTotalBp / 100}% do registrado).`);
    return { itemId: r.itemId, requested: r.qtyMilli, perAgencyLimit: perLimit, perAgencyUsed: perUsed, totalLimit: totLimit, totalUsed: totUsed, violations: v };
  });
  return { ok: lines.every((l) => !l.violations.length), lines };
}

// ------------------------------------------------------------------ motor de operações

export const OPERATION_KINDS = ['conversao', 'remanejamento', 'correcao', 'alteracao_preco', 'cancelamento'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];
export const OPERATION_LABELS: Record<OperationKind, string> = {
  conversao: 'Conversão entre itens',
  remanejamento: 'Remanejamento entre órgãos',
  correcao: 'Correção de lançamento',
  alteracao_preco: 'Alteração de preço',
  cancelamento: 'Cancelamento de quantitativo',
};
export const OPERATION_HINTS: Record<OperationKind, string> = {
  conversao: 'Troca saldo de um item por outro item já registrado, sem aumentar o valor total nem criar objeto novo.',
  remanejamento: 'Mesmo item: passa cota de um órgão para outro. Exige autorização do gerenciador.',
  correcao: 'Desfaz um lançamento errado com estorno e registra o lançamento correto. O original continua no histórico.',
  alteracao_preco: 'Revisão de preço registrado (ex.: reequilíbrio). Vale para consumos futuros; os já registrados mantêm o preço da época.',
  cancelamento: 'Retira quantitativo do saldo registrado de um órgão (ex.: cancelamento parcial do registro).',
};

export type OpLine = { itemId: string; agencyId: string; qtyMilli: number };
export type OperationInput = {
  kind: OperationKind;
  sources: OpLine[];
  targets: OpLine[];
  /** alteração de preço */
  newUnitCents?: number | null;
  /** correção: lançamento corrigido */
  correctsEntry?: { id: string; kind: ArpLedgerKind; itemId: string; agencyId: string; qtyMilli: number; reversed: boolean } | null;
  correctedQtyMilli?: number | null;
};

export type Simulation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  sourceValueCents: number;
  targetValueCents: number;
  /** antes → depois por item/órgão afetado */
  impact: { itemId: string; agencyId: string; before: Bucket; after: Bucket }[];
  /** lançamentos que a efetivação gravaria */
  entries: ArpLedgerEntry[];
};

/** Simula a operação contra os saldos atuais. Não grava nada: a efetivação usa exatamente estes lançamentos. */
export function simulateOperation(op: OperationInput, ctx: { items: Map<string, ItemBase & { label: string }>; agencies: Map<string, AgencyBase & { name: string }>; balances: Balances; rules: ArpRules; status: ArpStatus }): Simulation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entries: ArpLedgerEntry[] = [];
  const price = (id: string) => ctx.items.get(id)?.unitCents ?? 0;
  const label = (id: string) => ctx.items.get(id)?.label ?? 'item';
  const bal = (l: OpLine) => ctx.balances.byItemAgency.get(key(l.itemId, l.agencyId)) ?? empty();
  if (ctx.status !== 'vigente') errors.push('Operações só em ata vigente.');
  const all = [...op.sources, ...op.targets];
  for (const l of all) {
    if (!ctx.items.has(l.itemId)) errors.push('Item fora da ata: conversão não cria objeto novo.');
    if (!ctx.agencies.has(l.agencyId)) errors.push('Órgão não cadastrado na ata.');
    if (!(l.qtyMilli > 0) && op.kind !== 'alteracao_preco' && op.kind !== 'correcao') errors.push('Quantidades devem ser maiores que zero.');
  }
  // saída nunca maior que o disponível (somando linhas repetidas)
  const out = new Map<string, number>();
  for (const s of op.sources) out.set(key(s.itemId, s.agencyId), (out.get(key(s.itemId, s.agencyId)) ?? 0) + s.qtyMilli);
  const checkAvailable = () => {
    for (const [k, q] of out) {
      const b = ctx.balances.byItemAgency.get(k) ?? empty();
      const [itemId] = k.split('|') as [string];
      if (q > b.available) errors.push(`Saldo insuficiente em ${label(itemId)}: disponível ${fmtQty(Math.max(0, b.available))}, pedido ${fmtQty(q)}.`);
    }
  };
  let srcValue = op.sources.reduce((s, l) => s + lineValue(l.qtyMilli, price(l.itemId)), 0);
  let dstValue = op.targets.reduce((s, l) => s + lineValue(l.qtyMilli, price(l.itemId)), 0);

  switch (op.kind) {
    case 'conversao': {
      if (!ctx.rules.allowConversion) warnings.push('O regulamento configurado não prevê conversão: a efetivação exige exceção validada pelo Jurídico.');
      if (!op.sources.length || !op.targets.length) errors.push('Escolha itens de origem e de destino.');
      if (op.sources.some((s) => op.targets.some((t) => t.itemId === s.itemId))) errors.push('Origem e destino devem ser itens diferentes.');
      for (const l of all) if (ctx.agencies.get(l.agencyId)?.kind === 'nao_participante') errors.push('Conversão não se aplica a quantidades de adesão.');
      checkAvailable();
      if (dstValue > srcValue) errors.push(`O valor de destino (${(dstValue / 100).toFixed(2)}) é maior que o de origem (${(srcValue / 100).toFixed(2)}): conversão não pode aumentar o valor registrado.`);
      if (dstValue < srcValue) warnings.push(`Sobra de ${((srcValue - dstValue) / 100).toFixed(2)} em valor, que deixa de existir no registro.`);
      for (const s of op.sources) entries.push({ kind: 'conversao', itemId: s.itemId, agencyId: s.agencyId, qtyMilli: s.qtyMilli, dir: 'saida', amountCents: lineValue(s.qtyMilli, price(s.itemId)) });
      for (const t of op.targets) entries.push({ kind: 'conversao', itemId: t.itemId, agencyId: t.agencyId, qtyMilli: t.qtyMilli, dir: 'entrada', amountCents: lineValue(t.qtyMilli, price(t.itemId)) });
      break;
    }
    case 'remanejamento': {
      if (!op.sources.length || !op.targets.length) errors.push('Escolha órgão de origem e de destino.');
      const items = new Set(all.map((l) => l.itemId));
      if (items.size > 1) errors.push('Remanejamento é do mesmo item entre órgãos. Para trocar de item, use conversão.');
      const sum = (ls: OpLine[]) => ls.reduce((s, l) => s + l.qtyMilli, 0);
      if (sum(op.sources) !== sum(op.targets)) errors.push('Quantidade remanejada deve ser igual na origem e no destino.');
      if (op.sources.some((s) => op.targets.some((t) => t.agencyId === s.agencyId))) errors.push('Origem e destino devem ser órgãos diferentes.');
      for (const l of all) if (ctx.agencies.get(l.agencyId)?.kind === 'nao_participante') errors.push('Quantidade de adesão não é remanejável; registre nova adesão.');
      checkAvailable();
      if (ctx.rules.remanejamentoNeedsManager) warnings.push('Exige autorização do órgão gerenciador anexada.');
      for (const s of op.sources) entries.push({ kind: 'remanejamento', itemId: s.itemId, agencyId: s.agencyId, qtyMilli: s.qtyMilli, dir: 'saida', amountCents: lineValue(s.qtyMilli, price(s.itemId)) });
      for (const t of op.targets) entries.push({ kind: 'remanejamento', itemId: t.itemId, agencyId: t.agencyId, qtyMilli: t.qtyMilli, dir: 'entrada', amountCents: lineValue(t.qtyMilli, price(t.itemId)) });
      srcValue = op.sources.reduce((s, l) => s + lineValue(l.qtyMilli, price(l.itemId)), 0);
      dstValue = op.targets.reduce((s, l) => s + lineValue(l.qtyMilli, price(l.itemId)), 0);
      break;
    }
    case 'cancelamento': {
      if (!op.sources.length) errors.push('Escolha o item e o órgão do quantitativo cancelado.');
      if (op.targets.length) errors.push('Cancelamento não tem destino.');
      checkAvailable();
      for (const s of op.sources) entries.push({ kind: 'cancelamento', itemId: s.itemId, agencyId: s.agencyId, qtyMilli: s.qtyMilli, amountCents: lineValue(s.qtyMilli, price(s.itemId)) });
      dstValue = 0;
      break;
    }
    case 'alteracao_preco': {
      const ids = new Set(all.map((l) => l.itemId));
      if (ids.size !== 1) errors.push('Escolha um item para alterar o preço.');
      if (!op.newUnitCents || op.newUnitCents <= 0) errors.push('Informe o novo preço unitário.');
      const it = [...ids][0];
      if (it && op.newUnitCents) {
        const b = ctx.balances.byItem.get(it);
        const remaining = b ? b.available + b.reserved : 0;
        srcValue = lineValue(remaining, price(it));
        dstValue = lineValue(remaining, op.newUnitCents);
        if (op.newUnitCents > price(it)) warnings.push('Aumento de preço registrado: confirme o fundamento (reequilíbrio econômico-financeiro) no documento anexado.');
      }
      break;
    }
    case 'correcao': {
      const c = op.correctsEntry;
      if (!c) { errors.push('Escolha o lançamento a corrigir.'); break; }
      if (c.reversed) errors.push('Este lançamento já foi corrigido.');
      if (!['consumo', 'reserva', 'execucao', 'faturamento', 'ajuste'].includes(c.kind)) errors.push('Esse tipo de lançamento não se corrige por aqui; use a operação específica.');
      const fixed = op.correctedQtyMilli ?? 0;
      if (fixed < 0) errors.push('Quantidade corrigida não pode ser negativa.');
      const reverseKind: ArpLedgerKind | null = c.kind === 'consumo' ? 'estorno' : c.kind === 'reserva' ? 'liberacao' : null;
      if (c.kind === 'consumo' || c.kind === 'reserva') {
        entries.push({ kind: reverseKind!, itemId: c.itemId, agencyId: c.agencyId, qtyMilli: c.qtyMilli, reversesId: c.id, amountCents: lineValue(c.qtyMilli, price(c.itemId)) });
        if (fixed > 0) entries.push({ kind: c.kind, itemId: c.itemId, agencyId: c.agencyId, qtyMilli: fixed, amountCents: lineValue(fixed, price(c.itemId)) });
        const b = bal({ itemId: c.itemId, agencyId: c.agencyId, qtyMilli: 0 });
        if (b.available + c.qtyMilli - fixed < 0) errors.push('A correção deixaria o saldo negativo.');
      } else {
        // execução, faturamento e ajuste: lançamento compensatório com sinal contrário
        entries.push({ kind: c.kind, itemId: c.itemId, agencyId: c.agencyId, qtyMilli: -c.qtyMilli, reversesId: c.id });
        if (fixed !== 0) entries.push({ kind: c.kind, itemId: c.itemId, agencyId: c.agencyId, qtyMilli: fixed });
      }
      srcValue = lineValue(c.qtyMilli, price(c.itemId));
      dstValue = lineValue(fixed, price(c.itemId));
      break;
    }
  }

  // impacto antes → depois
  const affected = new Set(entries.map((e) => key(e.itemId, e.agencyId)));
  const impact = [...affected].map((k) => {
    const [itemId, agencyId] = k.split('|') as [string, string];
    const before = { ...(ctx.balances.byItemAgency.get(k) ?? empty()) };
    const after = { ...before };
    for (const e of entries.filter((x) => key(x.itemId, x.agencyId) === k)) {
      const sg = e.dir === 'saida' ? -1 : 1;
      if (e.kind === 'conversao' || e.kind === 'remanejamento') after.quota += sg * e.qtyMilli;
      else if (e.kind === 'cancelamento') after.quota -= e.qtyMilli;
      else if (e.kind === 'ajuste') after.quota += e.qtyMilli;
      else if (e.kind === 'consumo') after.contracted += e.qtyMilli;
      else if (e.kind === 'estorno') after.contracted -= e.qtyMilli;
      else if (e.kind === 'reserva') after.reserved += e.qtyMilli;
      else if (e.kind === 'liberacao') after.reserved -= e.qtyMilli;
      else if (e.kind === 'execucao') after.executed += e.qtyMilli;
      else if (e.kind === 'faturamento') after.billed += e.qtyMilli;
    }
    after.available = after.quota - after.reserved - after.contracted;
    if (after.available < 0) errors.push(`O saldo de ${label(itemId)} ficaria negativo.`);
    return { itemId, agencyId, before, after };
  });
  return { ok: !errors.length, errors: [...new Set(errors)], warnings: [...new Set(warnings)], sourceValueCents: srcValue, targetValueCents: dstValue, impact, entries };
}

// ------------------------------------------------------------------ importação de itens

export const IMPORT_FIELDS = ['itemNumber', 'lot', 'code', 'description', 'specification', 'unit', 'registeredQty', 'unitPrice', 'totalPrice', 'agency', 'agencyQty', 'brandModel', 'notes'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  itemNumber: 'Número do item', lot: 'Número do lote', code: 'Código', description: 'Descrição', specification: 'Especificação', unit: 'Unidade de medida',
  registeredQty: 'Quantidade registrada', unitPrice: 'Valor unitário', totalPrice: 'Valor total', agency: 'Órgão participante', agencyQty: 'Quantitativo destinado ao órgão',
  brandModel: 'Marca/modelo', notes: 'Observações',
};
/** Sinônimos para o mapeamento automático (comparação sem acento e minúscula). */
export const IMPORT_SYNONYMS: Record<ImportField, string[]> = {
  itemNumber: ['item', 'n item', 'no item', 'numero do item', 'nº item', 'n. item', 'num item'],
  lot: ['lote', 'grupo', 'numero do lote'],
  code: ['codigo', 'cod', 'catmat', 'catser', 'codigo catmat', 'codigo catser', 'sku'],
  description: ['descricao', 'descricao do item', 'descricao do objeto', 'objeto', 'item descricao'],
  specification: ['especificacao', 'especificacao tecnica', 'detalhamento'],
  unit: ['unidade', 'un', 'und', 'unid', 'unidade de medida', 'u.m.', 'um'],
  registeredQty: ['quantidade', 'qtd', 'qtd.', 'quant', 'quantidade registrada', 'qtde', 'qtd registrada', 'quantitativo'],
  unitPrice: ['valor unitario', 'preco unitario', 'preco unit.', 'vl unitario', 'vlr unit', 'preco', 'valor unit.'],
  totalPrice: ['valor total', 'preco total', 'vl total', 'total'],
  agency: ['orgao', 'orgao participante', 'participante', 'uasg'],
  agencyQty: ['qtd orgao', 'quantidade do orgao', 'quantitativo do orgao', 'qtd participante', 'cota'],
  brandModel: ['marca', 'modelo', 'marca/modelo', 'fabricante'],
  notes: ['observacoes', 'obs', 'observacao'],
};
export const normHeader = (h: string) => h.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[º°]/g, '').replace(/\s+/g, ' ').trim();

/** Sugere o campo para cada coluna do arquivo. */
export function autoMap(headers: string[]): Record<string, ImportField | ''> {
  const used = new Set<ImportField>();
  const out: Record<string, ImportField | ''> = {};
  for (const h of headers) {
    const n = normHeader(h);
    const hit = IMPORT_FIELDS.find((f) => !used.has(f) && (IMPORT_SYNONYMS[f].includes(n) || normHeader(IMPORT_FIELD_LABELS[f]) === n));
    out[h] = hit ?? '';
    if (hit) used.add(hit);
  }
  return out;
}

/** Número em formato brasileiro ou internacional ("1.234,56", "1234.56", "R$ 10,00"). */
export function parseNumberBR(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type ImportRow = Partial<Record<ImportField, string | number | null>> & { extra?: Record<string, unknown> };
export type ParsedItem = { row: number; itemNumber: string; lot: string | null; code: string | null; description: string; specification: string | null; unit: string; registeredMilli: number; unitCents: number; totalCents: number; agency: string | null; agencyMilli: number | null; brandModel: string | null; notes: string | null; extra: Record<string, unknown> };
export type RowIssue = { row: number; field?: ImportField; message: string; level: 'erro' | 'aviso' };

/** Valida e normaliza as linhas. Valor total diferente de qtd × unitário (mais de 1 centavo por linha) vira erro. */
export function parseImportRows(rows: ImportRow[]): { items: ParsedItem[]; issues: RowIssue[] } {
  const items: ParsedItem[] = [];
  const issues: RowIssue[] = [];
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  rows.forEach((r, i) => {
    const row = i + 2; // linha 1 = cabeçalho
    if (Object.values(r).every((v) => v === null || v === undefined || String(v).trim() === '' || typeof v === 'object')) return;
    const err = (field: ImportField | undefined, message: string) => issues.push({ row, field, message, level: 'erro' });
    const itemNumber = str(r.itemNumber);
    const description = str(r.description);
    const unit = str(r.unit);
    const qty = parseNumberBR(r.registeredQty);
    const unitPrice = parseNumberBR(r.unitPrice);
    const total = parseNumberBR(r.totalPrice);
    if (!itemNumber) err('itemNumber', 'Número do item vazio.');
    if (!description) err('description', 'Descrição vazia.');
    if (!unit) err('unit', 'Unidade de medida vazia.');
    if (qty === null || qty <= 0) err('registeredQty', 'Quantidade registrada inválida.');
    let unitCents = unitPrice === null ? null : Math.round(unitPrice * 100);
    const totalCents = total === null ? null : Math.round(total * 100);
    if (unitCents === null && totalCents !== null && qty) unitCents = Math.round(totalCents / qty);
    if (unitCents === null || unitCents <= 0) err('unitPrice', 'Valor unitário inválido.');
    const registeredMilli = qty === null ? 0 : toMilli(qty);
    const computed = unitCents && qty ? lineValue(registeredMilli, unitCents) : 0;
    if (totalCents !== null && unitCents && qty && Math.abs(totalCents - computed) > Math.max(1, Math.ceil(qty / 100))) err('totalPrice', `Valor total (${(totalCents / 100).toFixed(2)}) não confere com quantidade × unitário (${(computed / 100).toFixed(2)}).`);
    const agencyQty = parseNumberBR(r.agencyQty);
    const agency = str(r.agency) || null;
    if (agency && (agencyQty === null || agencyQty <= 0)) err('agencyQty', 'Órgão informado sem quantitativo.');
    if (!agency && agencyQty !== null) err('agency', 'Quantitativo do órgão sem o nome do órgão.');
    if (agencyQty !== null && qty !== null && agencyQty > qty) err('agencyQty', 'Quantitativo do órgão maior que a quantidade registrada.');
    if (issues.some((x) => x.row === row && x.level === 'erro')) return;
    items.push({ row, itemNumber, lot: str(r.lot) || null, code: str(r.code) || null, description, specification: str(r.specification) || null, unit, registeredMilli, unitCents: unitCents!, totalCents: totalCents ?? computed, agency, agencyMilli: agencyQty === null ? null : toMilli(agencyQty), brandModel: str(r.brandModel) || null, notes: str(r.notes) || null, extra: r.extra ?? {} });
  });
  // a mesma chave (lote + item) pode repetir só para distribuir entre órgãos, com os mesmos dados oficiais
  const seen = new Map<string, ParsedItem>();
  for (const it of items) {
    const k = `${it.lot ?? ''}|${it.itemNumber}`;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, it); continue; }
    if (prev.registeredMilli !== it.registeredMilli || prev.unitCents !== it.unitCents || prev.description !== it.description) issues.push({ row: it.row, field: 'itemNumber', message: `Item ${it.lot ? `${it.lot}/` : ''}${it.itemNumber} repetido com dados diferentes da linha ${prev.row}.`, level: 'erro' });
    else if (!it.agency) issues.push({ row: it.row, field: 'itemNumber', message: `Item ${it.itemNumber} duplicado (linha ${prev.row}).`, level: 'aviso' });
  }
  return { items, issues };
}

export const itemKey = (lot: string | null, itemNumber: string) => `${(lot ?? '').trim().toLowerCase()}|${itemNumber.trim().toLowerCase()}`;
