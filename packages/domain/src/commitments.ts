/**
 * Controle de Empenhos (Gestão de Contratos): itens do contrato, notas de empenho com seus itens, medições e os saldos
 * calculados a partir do histórico (nunca digitados). Regras da especificação "Controle de Contratos com Saldo":
 *   RN00 o consumo é registrado no item de medição e baixa item de empenho → empenho → item contratual → contrato;
 *   RN04 medição não excede o saldo do item contratual (bloqueio);
 *   RN05 acima do saldo de empenho: registra com pendência "aguardando empenho" (bloqueio opcional por contrato);
 *   RN07 quantidades e preços com 4 casas (escala 10.000); faturamento em centavos;
 *   RN09 baixa FIFO (empenho mais antigo primeiro); RN10 empenho só cobre competências do seu exercício;
 *   RN14 medição em elaboração reserva saldo; baixa definitiva quando atestada/faturada.
 * Quantidades: ×10.000 (q4). Preços e valores: R$ ×10.000 (v4 = centavos × 100).
 */

export const Q = 10_000;
export const q4 = (n: number) => Math.round(n * Q);
export const fromQ4 = (n: number) => n / Q;
/** valor de qtd × preço (ambos ×10.000) → R$ ×10.000 */
export const value4 = (qty4: number, price4: number) => Math.round((qty4 * price4) / Q);
/** R$ ×10.000 → centavos (faturamento com 2 casas, RN07) */
export const cents = (v4: number) => Math.round(v4 / 100);

export const LINE_CLASSES = ['demanda', 'fornecimento', 'recorrente'] as const;
export type LineClass = (typeof LINE_CLASSES)[number];
export const LINE_CLASS_LABELS: Record<LineClass, string> = { demanda: 'Sob demanda', fornecimento: 'Fornecimento', recorrente: 'Recorrente (mensal)' };

export const MEASUREMENT_KINDS = ['mensal', 'avulsa', 'evento'] as const;
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];
export const MEASUREMENT_KIND_LABELS: Record<MeasurementKind, string> = { mensal: 'Mensal recorrente', avulsa: 'Avulsa / sob demanda', evento: 'Evento específico' };
export const MEASUREMENT_STATUSES = ['elaboracao', 'enviada', 'atestada', 'faturada', 'cancelada'] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];
export const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = { elaboracao: 'Em elaboração', enviada: 'Enviada ao órgão', atestada: 'Atestada', faturada: 'Faturada', cancelada: 'Cancelada' };
export const REVISION_REASONS = ['erro_empenho', 'nao_autorizada', 'erro_quantidade', 'outro'] as const;
export type RevisionReason = (typeof REVISION_REASONS)[number];
export const REVISION_REASON_LABELS: Record<RevisionReason, string> = { erro_empenho: 'Erro de empenho', nao_autorizada: 'Não autorização do cliente', erro_quantidade: 'Erro de quantidade/valor', outro: 'Outro' };
/** reserva o saldo (compromete) × baixa definitiva */
export const isFinal = (st: MeasurementStatus) => st === 'atestada' || st === 'faturada';
export const isLive = (st: MeasurementStatus) => st !== 'cancelada';

export type CLine = { id: string; itemNumber: string; description: string; unit: string; classification: LineClass; qty4: number; price4: number; monthlyQty4: number | null };
export type CCommitment = { id: string; number: string; fiscalYear: number; issuedOn: string; cancelled: boolean; source: string | null; /** fonte de receita (RN09-a) */ sourceId?: string | null };
export const COMMITMENT_MOVE_KINDS = ['reforco', 'anulacao', 'supressao'] as const;
export type CommitmentMoveKind = (typeof COMMITMENT_MOVE_KINDS)[number];
export const COMMITMENT_MOVE_LABELS: Record<CommitmentMoveKind, string> = { reforco: 'Reforço', anulacao: 'Anulação parcial', supressao: 'Supressão (virada de exercício)' };
export type CCommitmentItem = { id: string; commitmentId: string; lineId: string; code: string | null; itemNumber: string | null; qty4: number; /** reforços − anulações − supressões */ adjust4: number; moves?: { kind: CommitmentMoveKind; qty4: number; occurredOn: string }[] };
export type CAllocation = { commitmentItemId: string; qty4: number };
export type CMeasurementItem = { measurementId: string; lineId: string; qty4: number; price4: number; allocations: CAllocation[]; uncovered4: number };
export type CMeasurement = { id: string; competence: string; status: MeasurementStatus; superseded: boolean; title: string; kind: MeasurementKind; createdAt: string; attestedAt?: string | null; invoicedAt?: string | null };
export type CReservation = { lineId: string; qty4: number; opportunityId: string };

/** Medição que conta no saldo: não cancelada e não substituída por uma revisão. */
const counts = (m: CMeasurement) => isLive(m.status) && !m.superseded;

export type LineBalance = {
  lineId: string;
  contracted4: number; contractedV4: number;
  /** empenhado válido (empenhos não anulados, com reforços e anulações parciais) */
  committed4: number;
  /** baixa definitiva (atestada/faturada) e comprometido (em elaboração/enviada) */
  executed4: number; pending4: number;
  /** reservado pelas oportunidades em andamento na pipeline */
  reserved4: number;
  invoiced4: number;
  /** contratado − executado − comprometido − reservado */
  available4: number;
  /** contratado − empenhado válido */
  toCommit4: number;
  /** empenhado − consumido (baixas nos itens de empenho) */
  commitmentBalance4: number;
  /** executado sem cobertura de empenho */
  uncovered4: number;
};

/** Saldos por item (RN06: sempre recalculados do histórico). */
export function lineBalances(data: { lines: CLine[]; commitments: CCommitment[]; items: CCommitmentItem[]; measurements: CMeasurement[]; mItems: CMeasurementItem[]; reservations: CReservation[] }): LineBalance[] {
  const active = new Set(data.commitments.filter((c) => !c.cancelled).map((c) => c.id));
  const live = new Map(data.measurements.filter(counts).map((m) => [m.id, m]));
  return data.lines.map((l) => {
    const cis = data.items.filter((i) => i.lineId === l.id && active.has(i.commitmentId));
    const committed4 = cis.reduce((s, i) => s + i.qty4 + i.adjust4, 0);
    const mis = data.mItems.filter((x) => x.lineId === l.id && live.has(x.measurementId));
    let executed4 = 0, pending4 = 0, invoiced4 = 0, uncovered4 = 0, allocated4 = 0;
    for (const x of mis) {
      const m = live.get(x.measurementId)!;
      if (isFinal(m.status)) executed4 += x.qty4; else pending4 += x.qty4;
      if (m.status === 'faturada') invoiced4 += x.qty4;
      uncovered4 += x.uncovered4;
      allocated4 += x.allocations.filter((a) => cis.some((c) => c.id === a.commitmentItemId)).reduce((s, a) => s + a.qty4, 0);
    }
    const reserved4 = data.reservations.filter((r) => r.lineId === l.id).reduce((s, r) => s + r.qty4, 0);
    return {
      lineId: l.id, contracted4: l.qty4, contractedV4: value4(l.qty4, l.price4), committed4, executed4, pending4, reserved4, invoiced4,
      available4: l.qty4 - executed4 - pending4 - reserved4, toCommit4: l.qty4 - committed4, commitmentBalance4: committed4 - allocated4, uncovered4,
    };
  });
}

/** Saldo de cada item de empenho (empenhado − baixado nas medições que contam). */
export function commitmentItemBalances(items: CCommitmentItem[], measurements: CMeasurement[], mItems: CMeasurementItem[], exceptMeasurementId?: string) {
  const live = new Set(measurements.filter((m) => counts(m) && m.id !== exceptMeasurementId).map((m) => m.id));
  const used = new Map<string, number>();
  for (const x of mItems) if (live.has(x.measurementId)) for (const a of x.allocations) used.set(a.commitmentItemId, (used.get(a.commitmentItemId) ?? 0) + a.qty4);
  return new Map(items.map((i) => [i.id, i.qty4 + i.adjust4 - (used.get(i.id) ?? 0)]));
}

/**
 * Baixa FIFO (RN09): o empenho mais antigo do exercício da competência primeiro (RN10: empenho só cobre o seu exercício).
 * O que não couber fica descoberto (pendência "aguardando empenho", RN05).
 */
export function allocateFifo(lineId: string, qty4: number, competence: string, ctx: { commitments: CCommitment[]; items: CCommitmentItem[]; balances: Map<string, number> }): { allocations: CAllocation[]; uncovered4: number } {
  const year = Number(competence.slice(0, 4));
  const cands = ctx.items
    .map((i) => ({ i, c: ctx.commitments.find((c) => c.id === i.commitmentId)! }))
    .filter(({ i, c }) => i.lineId === lineId && c && !c.cancelled && c.fiscalYear === year)
    .sort((a, b) => a.c.issuedOn.localeCompare(b.c.issuedOn) || a.c.number.localeCompare(b.c.number));
  let left = qty4;
  const allocations: CAllocation[] = [];
  for (const { i } of cands) {
    if (left <= 0) break;
    const free = Math.max(0, ctx.balances.get(i.id) ?? 0);
    const take = Math.min(free, left);
    if (take > 0) { allocations.push({ commitmentItemId: i.id, qty4: take }); ctx.balances.set(i.id, free - take); left -= take; }
  }
  return { allocations, uncovered4: left };
}

/**
 * Totais do contrato nos quatro saldos (contratado, empenhado, executado, faturado) em R$ ×10.000.
 * Com `actual`, o executado/faturado vale pelo preço gravado em cada medição (reajuste, RN08) e o contratado é
 * o medido + o saldo pelo preço vigente; sem ele, tudo pelo preço do item.
 */
export function contractTotals(lines: CLine[], bal: LineBalance[], actual?: { measurements: CMeasurement[]; mItems: CMeasurementItem[] }) {
  const price = new Map(lines.map((l) => [l.id, l.price4]));
  const v = (k: keyof LineBalance) => bal.reduce((s, b) => s + value4(b[k] as number, price.get(b.lineId) ?? 0), 0);
  const t = { contracted: v('contracted4'), committed: v('committed4'), executed: v('executed4'), pending: v('pending4'), reserved: v('reserved4'), invoiced: v('invoiced4'), available: v('available4'), toCommit: v('toCommit4'), commitmentBalance: v('commitmentBalance4'), uncovered: v('uncovered4') };
  if (actual) {
    const live = new Map(actual.measurements.filter(counts).map((m) => [m.id, m]));
    let executed = 0, pending = 0, invoiced = 0, uncovered = 0;
    const usedV = new Map<string, number>();
    for (const x of actual.mItems) {
      const m = live.get(x.measurementId);
      if (!m) continue;
      const val = value4(x.qty4, x.price4);
      if (isFinal(m.status)) executed += val; else pending += val;
      if (m.status === 'faturada') invoiced += val;
      uncovered += value4(x.uncovered4, x.price4);
      usedV.set(x.lineId, (usedV.get(x.lineId) ?? 0) + val);
    }
    const contracted = bal.reduce((s, b) => s + (usedV.get(b.lineId) ?? 0) + value4(Math.max(0, b.contracted4 - b.executed4 - b.pending4), price.get(b.lineId) ?? 0), 0);
    Object.assign(t, { executed, pending, invoiced, uncovered, contracted });
  }
  return { ...t, executionPct: t.contracted ? ((t.executed + t.pending) / t.contracted) * 100 : null, committedPct: t.contracted ? (t.committed / t.contracted) * 100 : null };
}

/** Marcos de vigência do PF06 (dias até o fim do contrato). */
export const VIGENCIA_MILESTONES = [180, 120, 90, 60] as const;
/** RN16: pendência de faturamento acima deste número de dias gera alerta escalonado (sugestão da especificação). */
export const DEFAULT_AGING_DAYS = 60;

export type CommitmentAlert = { level: 'alto' | 'medio' | 'info'; key: string; text: string };
/** Alertas do MVP (PF06): sem empenho, aguardando empenho, executado sem faturar, virada de exercício, recorrente sem medição. */
export type AlertExtras = {
  /** itens que esgotam antes do fim da vigência (projeção, PF07) */
  exhaustBefore?: { itemNumber: string; competence: string }[];
  /** itens recorrentes cujo saldo de empenho do ano não cobre a próxima parcela projetada */
  nextInstallmentShort?: string[];
  /** retroativo de reajuste ainda sem NF complementar */
  retroPendingV4?: number;
  /** necessidade projetada de empenho no exercício seguinte, quando a vigência continua nele */
  nextYear?: { year: number; needV4: number; hasCommitment: boolean } | null;
};
export function commitmentAlerts(args: { today: string; lines: CLine[]; bal: LineBalance[]; commitments: CCommitment[]; items: CCommitmentItem[]; measurements: CMeasurement[]; mItems: CMeasurementItem[]; endAt?: string | null; agingDays?: number; /** % do contrato sem empenho que vira alerta (configurável por contrato); sem valor, só informa */ toCommitAlertPct?: number | null; extras?: AlertExtras }): CommitmentAlert[] {
  const out: CommitmentAlert[] = [];
  const fmt = (v4: number) => `R$ ${(v4 / Q).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totals = contractTotals(args.lines, args.bal, { measurements: args.measurements, mItems: args.mItems });
  if (totals.uncovered > 0) out.push({ level: 'alto', key: 'aguardando_empenho', text: `${fmt(totals.uncovered)} executados sem cobertura de empenho (aguardando empenho).` });
  const age = args.agingDays ?? DEFAULT_AGING_DAYS;
  const day = (d: string) => Math.floor(new Date(`${d}T12:00:00Z`).getTime() / 86_400_000);
  const notInvoiced = args.measurements.filter((m) => counts(m) && m.status === 'atestada');
  const old = notInvoiced.filter((m) => day(args.today) - day((m.attestedAt ?? m.createdAt).slice(0, 10)) > age);
  if (old.length) out.push({ level: 'alto', key: 'sem_faturar', text: `${old.length} medição(ões) atestada(s) há mais de ${age} dias sem nota fiscal: ${old.slice(0, 3).map((m) => m.title).join(', ')}.` });
  else if (notInvoiced.length) out.push({ level: 'medio', key: 'atestada_sem_nf', text: `${notInvoiced.length} medição(ões) atestada(s) aguardando nota fiscal.` });
  if (totals.contracted > 0 && totals.toCommit > 0) {
    const pct = (totals.toCommit / totals.contracted) * 100;
    const limit = args.toCommitAlertPct;
    const above = limit != null && pct > limit;
    if (limit == null || above) out.push({ level: above ? 'medio' : 'info', key: 'a_empenhar', text: `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do contrato ainda sem empenho (${fmt(totals.toCommit)})${above ? `, acima do limite de ${limit}%` : ''}.` });
  }
  const year = Number(args.today.slice(0, 4)), month = Number(args.today.slice(5, 7));
  const bal = commitmentItemBalances(args.items, args.measurements, args.mItems);
  const left = (c: CCommitment) => args.items.filter((i) => i.commitmentId === c.id).reduce((s, i) => s + value4(Math.max(0, bal.get(i.id) ?? 0), args.lines.find((l) => l.id === i.lineId)?.price4 ?? 0), 0);
  if (month >= 10) {
    const rem = args.commitments.filter((c) => !c.cancelled && c.fiscalYear === year).map((c) => ({ c, v: left(c) })).filter((x) => x.v > 0);
    if (rem.length) out.push({ level: 'medio', key: 'virada', text: `Virada de exercício: ${rem.length} empenho(s) de ${year} com saldo de ${fmt(rem.reduce((s, x) => s + x.v, 0))} a suprimir e reempenhar em ${year + 1}.` });
  }
  const oldYear = args.commitments.filter((c) => !c.cancelled && c.fiscalYear < year && left(c) > 0);
  if (oldYear.length) out.push({ level: 'alto', key: 'ne_exercicio_anterior', text: `${oldYear.length} empenho(s) de exercício anterior com saldo: suprima e vincule a NE do exercício atual (${oldYear.map((c) => c.number).slice(0, 3).join(', ')}).` });
  if (!args.commitments.some((c) => !c.cancelled && c.fiscalYear === year) && args.lines.length) out.push({ level: 'alto', key: 'sem_ne_ano', text: `Nenhum empenho do exercício ${year}: consumos deste ano ficam aguardando empenho.` });
  // recorrente sem medição na competência anterior
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const rec = args.lines.filter((l) => l.classification === 'recorrente');
  const measured = new Set(args.mItems.filter((x) => args.measurements.some((m) => m.id === x.measurementId && counts(m) && m.competence === prev)).map((x) => x.lineId));
  const missing = rec.filter((l) => !measured.has(l.id));
  if (missing.length) out.push({ level: 'alto', key: 'recorrente_sem_medicao', text: `${missing.length} item(ns) recorrente(s) sem medição em ${prev.slice(5)}/${prev.slice(0, 4)} (franquia não lançada).` });
  // saldo de empenho insuficiente para a próxima parcela recorrente projetada (preventivo)
  const ex = args.extras ?? {};
  const short = ex.nextInstallmentShort ?? rec.filter((l) => l.monthlyQty4 && (args.bal.find((b) => b.lineId === l.id)?.commitmentBalance4 ?? 0) < l.monthlyQty4).map((l) => l.itemNumber);
  if (short.length) out.push({ level: 'medio', key: 'parcela_sem_saldo', text: `${short.length} item(ns) recorrente(s) sem saldo de empenho para a próxima parcela projetada (${short.slice(0, 5).join(', ')}).` });
  if (ex.exhaustBefore?.length) out.push({ level: 'alto', key: 'esgotamento', text: `${ex.exhaustBefore.length} item(ns) esgota(m) antes do fim da vigência pelo consumo médio: item ${ex.exhaustBefore.slice(0, 4).map((x) => `${x.itemNumber} em ${x.competence.slice(5)}/${x.competence.slice(0, 4)}`).join(', ')}. Avalie aditivo de quantidade.` });
  if (ex.retroPendingV4 && ex.retroPendingV4 > 0) out.push({ level: 'alto', key: 'retroativo', text: `${fmt(ex.retroPendingV4)} de retroativo de reajuste a faturar (NF complementar).` });
  if (ex.nextYear && month >= 10 && !ex.nextYear.hasCommitment && ex.nextYear.needV4 > 0) out.push({ level: 'medio', key: 'ne_proximo_exercicio', text: `A vigência segue em ${ex.nextYear.year}: prepare a NE de ${ex.nextYear.year} (necessidade projetada de ${fmt(ex.nextYear.needV4)}).` });
  if (args.endAt) {
    const days = day(args.endAt) - day(args.today);
    const mark = [...VIGENCIA_MILESTONES].reverse().find((m) => days <= m);
    if (days >= 0 && mark != null) out.push({ level: days <= 60 ? 'alto' : 'medio', key: 'vigencia', text: `Vigência termina em ${days} dia(s) (marco de ${mark} dias): providencie o aditivo de prorrogação e o novo empenho.` });
  }
  return out;
}

// ------------------------------------------------------------------ importação da planilha (PF11)
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  const n = Number(/,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t);
  return Number.isFinite(n) ? n : null;
};
export type SheetRow = { commitment: string | null; commitmentItem: string | null; code: string | null; itemNumber: string; description: string; unit: string; qty: number; unitPrice: number | null; measured: number[] };
export type SheetMeasurement = { title: string; date: string | null; kind: MeasurementKind };
/**
 * Lê a planilha de controle (relação de itens + bloco de empenho + blocos de medição Qtde/Valor/Saldo).
 * Acha a linha de títulos pelo "Nº do Empenho"/"Item"/"Especificação"; os blocos de medição vêm dos títulos da linha
 * de cima ("Medição 04/08/26 - Mensal"). Sem preço na planilha, o item entra sem valor unitário (avisado).
 */
export function parseCommitmentSheet(rows: unknown[][]): { rows: SheetRow[]; measurements: SheetMeasurement[]; errors: string[] } {
  const errors: string[] = [];
  const hi = rows.findIndex((r) => r.some((c) => /especifica|descri/.test(norm(c))) && r.some((c) => /^(qtde|quantidade|qtd)/.test(norm(c))));
  if (hi < 0) return { rows: [], measurements: [], errors: ['Não achei a linha de títulos (Especificação/Descrição e Qtde).'] };
  const head = rows[hi]!.map(norm);
  const find = (re: RegExp, from = 0) => head.findIndex((h, i) => i >= from && re.test(h));
  const cNe = find(/empenho/), cNeItem = find(/^item do empenho/), cCode = find(/codigo/), cItem = head.findIndex((h) => h === 'item'), cDesc = find(/especifica|descri/), cUnit = find(/unidade/);
  const cQty = find(/^(qtde|quantidade|qtd)/), cPrice = find(/valor unit/);
  // blocos de medição: cada "Qtde" depois do bloco de cadastro, com o título na linha de cima
  const titles = hi > 0 ? rows[hi - 1]! : [];
  const blocks: { col: number; m: SheetMeasurement }[] = [];
  for (let i = Math.max(cQty, cPrice) + 1; i < head.length; i++) {
    if (!/^(qtde|quantidade|qtd)/.test(head[i]!)) continue;
    let t = '';
    for (let k = i; k >= Math.max(0, i - 3) && !t; k--) t = String(titles[k] ?? '').trim();
    if (!/medi/i.test(t)) continue;
    const dm = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
    const date = dm ? `${dm[3]!.length === 2 ? `20${dm[3]}` : dm[3]}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}` : null;
    blocks.push({ col: i, m: { title: t.replace(/\s+/g, ' '), date, kind: /mensal/i.test(t) ? 'mensal' : /evento/i.test(t) ? 'evento' : 'avulsa' } });
  }
  if (cDesc < 0 || cQty < 0) return { rows: [], measurements: [], errors: ['Faltam as colunas Especificação e Qtde.'] };
  const out: SheetRow[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const description = String(row[cDesc] ?? '').replace(/\s+/g, ' ').trim();
    const qty = num(row[cQty]);
    if (!description && qty == null) continue;
    if (/^total/i.test(description) || /^total/i.test(String(row[cItem >= 0 ? cItem : 0] ?? ''))) continue;
    if (!description || qty == null) { errors.push(`Linha ${r + 1}: sem especificação ou quantidade.`); continue; }
    const itemNumber = String(row[cItem >= 0 ? cItem : cNeItem] ?? out.length + 1).replace(/\.0$/, '').trim();
    out.push({
      commitment: cNe >= 0 ? String(row[cNe] ?? '').trim() || null : null,
      commitmentItem: cNeItem >= 0 ? String(row[cNeItem] ?? '').replace(/\.0$/, '').trim() || null : null,
      code: cCode >= 0 ? String(row[cCode] ?? '').trim() || null : null,
      itemNumber, description, unit: cUnit >= 0 ? String(row[cUnit] ?? 'UN').trim() || 'UN' : 'UN', qty,
      unitPrice: cPrice >= 0 ? num(row[cPrice]) : null,
      measured: blocks.map((b) => num(row[b.col]) ?? 0),
    });
  }
  if (out.some((x) => x.unitPrice == null)) errors.push(missingPriceMsg(out));
  return { rows: out, measurements: blocks.map((b) => b.m), errors };
}

const missingPriceMsg = (rows: SheetRow[]) => `${rows.filter((x) => x.unitPrice == null).length} item(ns) sem valor unitário na planilha: informe depois em cada item.`;

/**
 * Planilhas em que a aba de medição não traz o valor unitário (ex.: está na aba "P EMPENHAR"): completa pelo
 * mesmo NE + item do empenho, depois pelo código do item do empenho. Devolve quantos preços vieram de outra aba.
 */
export function fillSheetPrices(target: ReturnType<typeof parseCommitmentSheet>, others: ReturnType<typeof parseCommitmentSheet>[]) {
  const byNe = new Map<string, number>(), byCode = new Map<string, number>();
  for (const o of others) for (const r of o.rows) {
    if (r.unitPrice == null) continue;
    if (r.commitment && r.commitmentItem) byNe.set(`${r.commitment}|${r.commitmentItem}`, r.unitPrice);
    if (r.code) byCode.set(r.code, r.unitPrice);
  }
  let filled = 0;
  const rows = target.rows.map((r) => {
    if (r.unitPrice != null) return r;
    const p = (r.commitment && r.commitmentItem ? byNe.get(`${r.commitment}|${r.commitmentItem}`) : undefined) ?? (r.code ? byCode.get(r.code) : undefined);
    if (p == null) return r;
    filled++;
    return { ...r, unitPrice: p };
  });
  const errors = target.errors.filter((e) => !e.includes('sem valor unitário'));
  if (rows.some((x) => x.unitPrice == null)) errors.push(missingPriceMsg(rows));
  return { ...target, rows, errors, filled };
}
