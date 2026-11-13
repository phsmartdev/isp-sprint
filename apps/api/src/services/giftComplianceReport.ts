/**
 * Prestação de Contas — Brindes, Apoios e Patrocínios (Gestão Comercial → reunião do CIEI).
 * A4 sobre o timbrado da filial escolhida (sem timbrado cadastrado, o documento diz isso no cabeçalho).
 * Só dados registrados: nada de afirmação de conformidade plena sem evidência; ocorrências desfavoráveis entram sempre.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { CONCESSION_KIND_LABELS, CONCESSION_PURPOSE_LABELS, CONCESSION_STATE_LABELS, OUTCOME_LABELS, type ConcessionKind, type ConcessionPurpose, type ConcessionState, type Evaluation, type Outcome } from '@isp/domain';
import { safeText, wrap } from './proposals';
import { letterheadPainter, type Letterhead } from './economicsExport';
import type { complianceData } from '../routes/giftCompliance';

type Data = Awaited<ReturnType<typeof complianceData>>;
type Row = Data['rows'][number];
type Decision = { requestId: string; decision: string; deciderName: string; level: string; profile: string; reason: string | null; conditions: string | null; createdAt: Date; findings: unknown[]; outcome: string; amountCents: number };
type Doc = { requestId: string; kind: string; name: string; at: Date };

export type ReportInput = {
  code: string; version: number; emittedAt: Date; emitter: string; tenantName: string; from: string; to: string;
  scope: { account: string | null; unit: string | null; kinds: ConcessionKind[] };
  options: { detailed: boolean; justifications: boolean; exceptions: boolean; evidences: boolean };
  analysis: string | null; conclusion: string | null; letterhead: Letterhead | null;
  data: Data; decisions: Decision[]; documents: Doc[]; activeRules: number; segregation: boolean; policyNote: string | null;
};

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const when = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);
const pct = (v: number | null) => (v == null ? 'sem concessões executadas' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const MM = 72 / 25.4;

export async function buildComplianceReport(inp: ReportInput) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Prestação de Contas ${inp.code} v${inp.version}`); doc.setSubject('Brindes, Apoios e Patrocínios'); doc.setAuthor(inp.emitter);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89;
  const navy = rgb(0.176, 0.2, 0.224), blue = rgb(0.184, 0.349, 0.525), ink = rgb(0.18, 0.2, 0.22), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.87, 0.9), soft = rgb(0.955, 0.962, 0.972), red = rgb(0.7, 0.13, 0.13);
  const lh = inp.letterhead;
  const M = lh ? lh.sideMm * MM : 48, TOP = lh ? lh.topMm * MM : 56, BOT = lh ? lh.bottomMm * MM : 52;
  const paint = await letterheadPainter(doc, lh);
  const CW = W - 2 * M;
  const newPage = () => {
    const p = doc.addPage([W, H]);
    paint?.(p);
    if (!lh) { p.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: navy }); p.drawText(safeText(bold, 'Grupo BKT'), { x: M, y: H - 20, size: 10, font: bold, color: rgb(1, 1, 1) }); p.drawText(safeText(font, 'Gestão Comercial'), { x: W - M - font.widthOfTextAtSize('Gestão Comercial', 9), y: H - 20, size: 9, font, color: rgb(1, 1, 1) }); }
    return p;
  };
  let page: PDFPage = newPage();
  let y = H - TOP - 14;
  const need = (h: number) => { if (y - h < BOT + 24) { page = newPage(); y = H - TOP - 14; return true; } return false; };
  const text = (t: string, x: number, size = 9.5, f: PDFFont = font, color = ink) => page.drawText(safeText(f, t), { x, y, size, font: f, color });
  const para = (t: string, size = 9.5, f: PDFFont = font, color = ink, indent = 0) => { for (const l of wrap(f, t, size, CW - indent)) { need(size + 4); text(l, M + indent, size, f, color); y -= size + 4; } };
  const section = (n: number, t: string) => { y -= 10; need(40); text(`${n}. ${t}`, M, 12.5, bold, blue); y -= 7; page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.8, color: blue }); y -= 12; };
  const kv = (k: string, v: string, labW = 150) => { const ls = wrap(font, v, 9.5, CW - labW); need(ls.length * 13); text(k, M, 9, font, muted); ls.forEach((l, i) => { page.drawText(safeText(font, l), { x: M + labW, y: y - i * 13, size: 9.5, font, color: ink }); }); y -= ls.length * 13 + 1; };

  /** Tabela que não quebra linha entre páginas e repete o cabeçalho. */
  const table = (cols: { h: string; w: number; right?: boolean }[], rows: string[][], size = 8) => {
    const total = cols.reduce((t, c) => t + c.w, 0);
    const ws = cols.map((c) => (c.w / total) * CW);
    const head = () => { need(18); page.drawRectangle({ x: M, y: y - 4, width: CW, height: 15, color: soft }); let x = M; cols.forEach((c, i) => { const t = safeText(bold, c.h); page.drawText(t, { x: c.right ? x + ws[i]! - 4 - bold.widthOfTextAtSize(t, size) : x + 3, y, size, font: bold, color: muted }); x += ws[i]!; }); y -= 15; };
    head();
    for (const r of rows) {
      const cells = r.map((v, i) => wrap(font, v, size, ws[i]! - 6));
      const hgt = Math.max(...cells.map((c) => c.length)) * (size + 3) + 4;
      if (need(hgt)) head();
      let x = M;
      cells.forEach((ls, i) => { ls.forEach((l, n) => { const t = safeText(font, l); page.drawText(t, { x: cols[i]!.right ? x + ws[i]! - 4 - font.widthOfTextAtSize(t, size) : x + 3, y: y - n * (size + 3), size, font, color: ink }); }); x += ws[i]!; });
      y -= hgt;
      page.drawLine({ start: { x: M, y: y + size }, end: { x: W - M, y: y + size }, thickness: 0.3, color: line });
    }
    y -= 4;
  };

  const d = inp.data, k = d.kpis;
  const rows = d.rows;
  const executed = rows.filter((r) => r.state === 'executado');
  const approvedOpen = rows.filter((r) => r.state === 'aprovado' || r.state === 'reservado');
  const pending = rows.filter((r) => r.state === 'solicitado' || r.state === 'ajustes');
  const kindLabel = (x: string) => CONCESSION_KIND_LABELS[x as ConcessionKind] ?? x;
  const accTxt = (r: Row) => (r.accounts.length ? r.accounts.map((a) => a.name).join(', ') : `Institucional: ${r.institutionalClass ?? '—'}`);
  const decOf = (id: string) => inp.decisions.filter((x) => x.requestId === id);
  const docsOf = (id: string) => inp.documents.filter((x) => x.requestId === id);

  // 1. Identificação
  text('Relatório de Prestação de Contas', M, 18, bold, navy); y -= 20;
  text('Brindes, Apoios e Patrocínios', M, 13, font, navy); y -= 22;
  kv('Organização', `Grupo BKT${inp.tenantName && inp.tenantName !== 'Grupo BKT' ? ` (${inp.tenantName})` : ''}`);
  kv('Área responsável', 'Gestão Comercial');
  kv('Período de referência', `${br(inp.from)} a ${br(inp.to)}`);
  kv('Emissão', `${when(inp.emittedAt)} por ${inp.emitter}`);
  kv('Documento', `${inp.code} · versão ${inp.version}`);
  kv('Critérios', [inp.scope.account ? `conta ${inp.scope.account}` : 'todas as contas visíveis ao emissor', inp.scope.unit ? `unidade ${inp.scope.unit}` : 'todas as unidades', inp.scope.kinds.length ? `categorias: ${inp.scope.kinds.map(kindLabel).join(', ')}` : 'todas as categorias', 'realizado = concessões executadas no período (data de execução); solicitações pendentes não entram nos indicadores de realização'].join('; '));
  if (!lh) kv('Timbrado', 'Timbrado oficial não cadastrado na filial escolhida: documento emitido com cabeçalho padrão. Cadastre o timbrado em Configuração → Filiais.');

  // 2. Sumário executivo
  section(2, 'Sumário executivo');
  table([{ h: 'Indicador', w: 3 }, { h: 'Valor', w: 2, right: true }], [
    ['Concessões executadas', String(k.executed)], ['Investimento total realizado', brl(k.realizedCents)], ['Contas beneficiadas (distintas)', String(k.accounts)],
    ['Exceções autorizadas', String(k.exceptions)], ['Aprovadas aguardando execução', `${approvedOpen.length} (${brl(approvedOpen.reduce((t, r) => t + (r.approvedCents ?? 0), 0))})`],
    ['Solicitações aguardando decisão', `${pending.length} (${brl(pending.reduce((t, r) => t + r.estimatedCents, 0))})`], ['Pendências de controle', String(k.pendencies)],
  ], 9);
  const cats = Object.entries(d.byKind).filter(([, v]) => v.count);
  if (cats.length) { y -= 4; para('Distribuição por categoria (executadas):', 9.5, bold); table([{ h: 'Categoria', w: 3 }, { h: 'Quantidade', w: 1, right: true }, { h: 'Valor', w: 1.4, right: true }], cats.map(([kk, v]) => [kindLabel(kk), String(v.count), brl(v.cents)])); }
  y -= 2;
  para('Análise da gestão', 10, bold);
  para(inp.analysis?.trim() || 'Análise não preenchida pelo emissor.', 9.5, font, inp.analysis?.trim() ? ink : muted);

  // 3. Demonstrativo de controles
  section(3, 'Demonstrativo de controles');
  para('Mecanismos aplicados pela área Comercial no ISP-SPRINT (registros do próprio sistema):', 9.5);
  for (const t of [
    `Aplicação das diretrizes: ${inp.activeRules} diretriz(es) vigente(s) avaliada(s) automaticamente em cada solicitação, com versão registrada na decisão.${inp.policyNote ? ` Referência: ${inp.policyNote}` : ''}`,
    'Respeito às alçadas: decisão validada no servidor pela alçada exigida (Gestão comercial ou Diretoria); restrições obrigatórias não são afastadas por autorização gerencial.',
    `Segregação de funções: ${inp.segregation ? 'ativa (quem solicita não decide a própria solicitação)' : 'DESATIVADA nos ajustes de compliance no momento da emissão'}.`,
    'Registro das justificativas: toda solicitação exige justificativa; aprovação excepcional exige fundamentação expressa.',
    'Controle das saídas: baixa de estoque só na execução confirmada, uma única vez por concessão; cancelamento gera estorno registrado.',
    'Rastreabilidade por conta: cada concessão executada fica registrada na conta beneficiada, com rateio quando o benefício é compartilhado.',
    'Monitoramento de exceções: exceções e pendências listadas nas seções 5 e 6.',
  ]) para(`- ${t}`, 9, font, ink, 6);
  y -= 2;
  table([{ h: 'Indicador de controle', w: 3 }, { h: 'Resultado', w: 2, right: true }, { h: 'Base', w: 2 }], [
    ['Taxa de conformidade', pct(k.conformityPct), `executadas sem exceção / ${k.executed} executada(s)`],
    ['Taxa de exceções', pct(k.exceptionPct), `executadas com exceção / ${k.executed} executada(s)`],
    ['Índice de rastreabilidade', pct(k.traceabilityPct), 'justificativa + decisão + evidência / executadas'],
    ['Pendências de controle', String(k.pendencies), 'ver seção 6'],
  ], 8.5);

  // 4. Demonstrativo das concessões
  section(4, 'Demonstrativo das concessões');
  if (!rows.length) para('Nenhuma concessão registrada no período e escopo.', 9.5, font, muted);
  else {
    const prevApr = (r: Row) => `${brl(r.estimatedCents)} / ${r.approvedCents == null ? '—' : brl(r.approvedCents)} / ${r.executedCents == null ? '—' : brl(r.executedCents)}`;
    if (inp.options.detailed) {
      table([{ h: 'Data', w: 1.15 }, { h: 'Concessão', w: 1.65 }, { h: 'Conta beneficiada', w: 2.3 }, { h: 'Tipo', w: 1.6 }, { h: 'Finalidade', w: 1.8 }, { h: 'Previsto / aprovado / realizado', w: 2.6, right: true }, { h: 'Responsável', w: 1.5 }, { h: 'Situação', w: 1.9 }],
        rows.map((r) => [br(r.executedOn ?? r.plannedOn), r.code, accTxt(r), `${kindLabel(r.kind)}${r.kitCategory ? ` · cat. ${r.kitCategory}` : ''}`, CONCESSION_PURPOSE_LABELS[r.purpose as ConcessionPurpose] ?? r.purpose, prevApr(r), r.requesterName, `${CONCESSION_STATE_LABELS[r.state as ConcessionState]} · ${r.exception ? 'exceção autorizada' : OUTCOME_LABELS[r.outcome as Outcome]}`]), 7.5);
    }
    // consolidado por conta (executadas, pelo rateio: o total entra uma vez)
    const byAcc = new Map<string, { name: string; n: number; cents: number }>();
    for (const r of executed) for (const a of r.accounts) { const c = byAcc.get(a.contactId) ?? { name: a.name, n: 0, cents: 0 }; c.n++; c.cents += a.shareCents; byAcc.set(a.contactId, c); }
    const inst = executed.filter((r) => !r.accounts.length);
    if (byAcc.size || inst.length) {
      para('Consolidado por conta (executadas; benefício compartilhado pelo rateio):', 9.5, bold);
      table([{ h: 'Conta', w: 4 }, { h: 'Concessões', w: 1, right: true }, { h: 'Valor atribuído', w: 1.6, right: true }], [...[...byAcc.values()].sort((a, b) => b.cents - a.cents).map((a) => [a.name, String(a.n), brl(a.cents)]), ...(inst.length ? [['Ações institucionais sem conta', String(inst.length), brl(inst.reduce((t, r) => t + (r.executedCents ?? 0), 0))]] : [])]);
    }
  }

  // 5. Exceções e justificativas
  section(5, 'Exceções e justificativas');
  const exc = rows.filter((r) => r.exception);
  const unreg = rows.filter((r) => (r.state === 'solicitado' || r.state === 'ajustes') && r.outcome === 'impedido');
  if (!inp.options.exceptions) para('Seção omitida por opção do emissor nesta versão do relatório.', 9.5, font, muted);
  else {
    if (!exc.length) para('Nenhuma exceção formalmente autorizada no período.', 9.5);
    for (const r of exc) {
      const dec = decOf(r.id).filter((x) => x.decision === 'aprovar_excecao').at(-1);
      const findings = ((dec?.findings ?? []) as Evaluation['findings']);
      need(60);
      para(`${r.code} · ${accTxt(r)} · ${kindLabel(r.kind)}`, 9.5, bold);
      kv('Diretriz aplicável', findings.map((f) => `${f.name} (v${f.version})`).join('; ') || '—', 130);
      kv('Limite excedido', findings.map((f) => f.limit == null ? f.name : `${f.unit === 'centavos' ? brl(f.limit) : f.limit} -> ${f.unit === 'centavos' ? brl(f.actual) : f.actual}`).join('; ') || '—', 130);
      if (inp.options.justifications) kv('Justificativa', r.justification || '—', 130);
      kv('Autorizada por', dec ? `${dec.deciderName} (${dec.level === 'diretoria' ? 'Diretoria' : 'Gestão comercial'}) em ${when(dec.createdAt)}` : '—', 130);
      kv('Fundamentação', dec?.reason ?? '—', 130);
      if (dec?.conditions) kv('Condições', dec.conditions, 130);
      kv('Execução', `${CONCESSION_STATE_LABELS[r.state as ConcessionState]}${r.executedOn ? ` em ${br(r.executedOn)}` : ''}`, 130);
      y -= 4;
    }
    y -= 2;
    para('Desconformidades não regularizadas (restrição obrigatória sem tratamento):', 9.5, bold, unreg.length ? red : ink);
    if (!unreg.length) para('Nenhuma no período.', 9.5);
    else table([{ h: 'Concessão', w: 1.3 }, { h: 'Conta', w: 2.5 }, { h: 'Restrição', w: 3 }, { h: 'Situação', w: 1.4 }], unreg.map((r) => [r.code, accTxt(r), ((r.evaluation as unknown as Evaluation).findings ?? []).filter((f) => f.controlType === 'restricao').map((f) => f.name).join('; ') || '—', CONCESSION_STATE_LABELS[r.state as ConcessionState]]));
  }

  // 6. Pendências e medidas
  section(6, 'Pendências e medidas de melhoria');
  if (!d.pendencies.length) para('Nenhuma pendência de controle identificada pelos registros no período.', 9.5);
  else table([{ h: 'Concessão', w: 1.3 }, { h: 'Pendência', w: 3.6 }, { h: 'Desde', w: 1 }, { h: 'Responsável', w: 1.8 }, { h: 'Situação', w: 1.2 }],
    d.pendencies.map((p) => [p.code, p.text, br(p.since), rows.find((r) => r.id === p.requestId)?.requesterName ?? '—', 'Em aberto']), 8);
  para('Fragilidades, providências e prazos de regularização: descrever na conclusão da gestão (seção 7); o sistema registra apenas o que está nos registros.', 8.5, font, muted);

  // 7. Conclusão
  section(7, 'Conclusão da Gestão Comercial');
  para(inp.conclusion?.trim() || 'Conclusão não preenchida pelo emissor. Este relatório não contém declaração de conformidade plena.', 9.5, font, inp.conclusion?.trim() ? ink : muted);

  // 8. Anexos
  if (inp.options.evidences || inp.options.justifications) {
    section(8, 'Anexos');
    if (inp.options.justifications) {
      para('A. Justificativas e decisões por concessão', 10, bold);
      for (const r of rows) {
        need(30);
        para(`${r.code} · ${accTxt(r)}`, 9, bold);
        para(`Justificativa: ${r.justification || '—'}`, 8.5, font, ink, 8);
        if (r.collective) para(`Entrega coletiva: ${r.audience ?? '—'}`, 8.5, font, ink, 8);
        else if (r.recipients.length) para(`Destinatários: ${r.recipients.map((p) => `${p.name}${p.title ? ` (${p.title})` : ''} · ${p.powerClass === 'nao_avaliado' ? 'sem classificação' : p.powerClass.toUpperCase()}`).join('; ')}`, 8.5, font, ink, 8);
        if (r.attention.length) para(`Situações de atenção declaradas: ${r.attention.join(', ')}`, 8.5, font, ink, 8);
        for (const x of decOf(r.id)) para(`${when(x.createdAt)} · ${x.deciderName} · ${({ aprovar: 'aprovou', aprovar_excecao: 'aprovou excepcionalmente', ajustes: 'pediu ajustes', rejeitar: 'rejeitou' } as Record<string, string>)[x.decision] ?? x.decision}${x.reason ? `: ${x.reason}` : ''}${x.conditions ? ` · condições: ${x.conditions}` : ''}`, 8.5, font, muted, 8);
      }
    }
    if (inp.options.evidences) {
      y -= 4;
      para('B. Evidências registradas (os arquivos ficam no sistema)', 10, bold);
      const ev = rows.flatMap((r) => docsOf(r.id).map((x) => [r.code, x.kind, x.name, when(x.at)]));
      if (!ev.length) para('Nenhuma evidência anexada às concessões do período.', 9, font, muted);
      else table([{ h: 'Concessão', w: 1.3 }, { h: 'Tipo', w: 1 }, { h: 'Arquivo', w: 3.2 }, { h: 'Anexado em', w: 1.4 }], ev, 8);
    }
  }

  // rodapé: identificador, versão e página
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = safeText(font, `Prestação de Contas ${inp.code} v${inp.version} · Gestão Comercial · emitido em ${when(inp.emittedAt)} · página ${i + 1} de ${pages.length}`);
    p.drawText(t, { x: M, y: lh ? BOT - 2 : 26, size: 7.5, font, color: muted });
  });
  return doc.save();
}
