/**
 * Relatório mensal do orçamento por e-mail: HTML em tabelas (Gmail e Outlook), CSS inline, marca BKT (grafite e azul,
 * cantos retos), valores e datas no padrão brasileiro e um gráfico de barras feito com tabela (abre em qualquer cliente).
 * Só entra o que o destinatário pode ver (escopo de centros calculado antes).
 */
import type { ClosingSnapshot, Recipient } from './budgetClosing';

const NAVY = '#2D3339', BLUE = '#2F5986', SKY = '#3885D3', ORANGE = '#D4752C', LINE = '#E1E5EA', MUTED = '#5F6B76', BG = '#F2F4F6', RED = '#D23434';
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const brlFull = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase());
const monthShort = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const ROLE_INTRO: Record<Recipient['role'], string> = {
  responsavel: 'dos centros de custos sob sua responsabilidade',
  gestor: 'dos centros de custos sob sua gestão',
  diretoria: 'consolidado da empresa',
  financeiro: 'com a visão financeira (títulos, pagamentos e encargos) de todos os centros',
};

export function budgetReportSubject(month: string) {
  return `ISP Sprint | Fechamento Orçamentário — ${monthName(month).replace(' de ', '/')}`;
}

export function renderBudgetReport(input: {
  company: string; recipient: Recipient; month: string; generatedAt: string; link: string;
  snap: ClosingSnapshot; prev: ClosingSnapshot | null; history: { month: string; realized: number; approved: number }[];
}) {
  const { snap, prev, recipient: r } = input;
  const t = snap.total, p = prev?.total;
  const variation = p && p.realized ? Math.round(((t.realized - p.realized) / p.realized) * 1000) / 10 : null;
  const effPrev = prev?.performance.efficiency ?? null, eff = snap.performance.efficiency;
  const effVar = eff !== null && effPrev ? Math.round(((eff / effPrev) - 1) * 1000) / 10 : null;
  const kpi = (label: string, value: string, hint?: string) => `<td width="50%" valign="top" style="padding:12px 14px;border:1px solid ${LINE};background:#FFFFFF;"><div style="font-size:12px;color:${MUTED};">${esc(label)}</div><div style="font-size:20px;font-weight:700;color:${NAVY};margin-top:4px;">${esc(value)}</div>${hint ? `<div style="font-size:11px;color:${MUTED};margin-top:2px;">${esc(hint)}</div>` : ''}</td>`;
  const max = Math.max(1, ...input.history.map((h) => Math.max(h.realized, h.approved)));
  const bars = input.history.map((h) => {
    const hr = Math.round((h.realized / max) * 100), ha = Math.round((h.approved / max) * 100);
    return `<td valign="bottom" align="center" style="padding:0 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="bottom" style="padding-right:2px;"><div style="width:14px;height:${Math.max(2, ha)}px;background:${BLUE};font-size:0;line-height:0;">&nbsp;</div></td>
      <td valign="bottom"><div style="width:14px;height:${Math.max(2, hr)}px;background:${ORANGE};font-size:0;line-height:0;">&nbsp;</div></td></tr></table>
      <div style="font-size:11px;color:${MUTED};margin-top:4px;">${esc(monthShort(h.month))}</div></td>`;
  }).join('');
  const attention: string[] = [];
  if (t.excess) attention.push(`Excedentes autorizados (Budget Guardião): ${brlFull(t.excess)}.`);
  if (t.overdueCount) attention.push(`${t.overdueCount} pagamento(s) vencido(s) em aberto: ${brlFull(t.overdueCents)}.`);
  if (t.latePayments) attention.push(`${t.latePayments} pagamento(s) feito(s) com atraso${t.charges ? `, com ${brlFull(t.charges)} de juros e multas` : ''}.`);
  if (t.pendingApproval) attention.push(`Solicitações aguardando aprovação: ${brlFull(t.pendingApproval)}.`);
  for (const c of snap.centers) if (c.deviationPct !== null && Math.abs(c.deviationPct) > 15) attention.push(`${c.code}: desvio de ${pct(c.deviationPct)} entre realizado e aprovado.`);
  const rows = snap.centers.map((c) => `<tr><td style="padding:8px;border-top:1px solid ${LINE};font-size:13px;color:${NAVY};"><b>${esc(c.code)}</b> ${esc(c.name)}</td><td align="right" style="padding:8px;border-top:1px solid ${LINE};font-size:13px;">${brlFull(c.approved)}</td><td align="right" style="padding:8px;border-top:1px solid ${LINE};font-size:13px;">${brlFull(c.realized)}</td><td align="right" style="padding:8px;border-top:1px solid ${LINE};font-size:13px;">${brlFull(c.committed)}</td><td align="right" style="padding:8px;border-top:1px solid ${LINE};font-size:13px;color:${c.balance < 0 ? RED : NAVY};">${brlFull(c.balance)}</td></tr>`).join('');
  const finance = r.role === 'financeiro' || r.role === 'diretoria' ? `<tr><td style="padding:0 28px 8px;"><h2 style="font-size:16px;color:${NAVY};margin:16px 0 8px;">Financeiro</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${kpi('Pago no mês', brlFull(t.paid))}${kpi('Juros e multas', brlFull(t.charges))}</tr><tr>${kpi('Vencidos em aberto', brlFull(t.overdueCents), `${t.overdueCount} título(s)`)}${kpi('Pagos com atraso', String(t.latePayments))}</tr></table></td></tr>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(budgetReportSubject(input.month))}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${NAVY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid ${LINE};">
  <tr><td style="background:${NAVY};padding:22px 28px;border-bottom:4px solid ${BLUE};">
    <div style="font-size:12px;letter-spacing:1px;color:#A9B4BF;">${esc(input.company)}</div>
    <div style="font-size:22px;font-weight:700;color:#FFFFFF;margin-top:6px;">Fechamento Orçamentário</div>
    <div style="font-size:14px;color:#D3D8DE;margin-top:4px;">${esc(monthName(input.month))}</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:22px;">
    <p style="margin:0 0 12px;">Olá, ${esc(r.name.split(' ')[0] ?? r.name)}.</p>
    <p style="margin:0;">Concluímos o fechamento orçamentário de ${esc(monthName(input.month).toLowerCase())}. Abaixo, o resumo ${ROLE_INTRO[r.role]}: investimentos realizados, compromissos assumidos e a evolução dos resultados.</p>
  </td></tr>
  <tr><td style="padding:8px 28px;"><h2 style="font-size:16px;color:${NAVY};margin:12px 0 8px;">Resumo do período</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${kpi('Orçamento aprovado', brlFull(t.approved))}${kpi('Valor realizado', brlFull(t.realized), `Desvio ${pct(t.deviationPct as number | null)}`)}</tr>
      <tr>${kpi('Valor comprometido', brlFull(t.committed))}${kpi('Saldo disponível', brlFull(t.balance))}</tr>
      <tr>${kpi('Variação mensal do realizado', pct(variation), prev ? `Mês anterior: ${brlFull(p!.realized)}` : 'Sem mês anterior para comparar')}${kpi('Economia', brlFull(t.economy))}</tr>
    </table></td></tr>
  <tr><td style="padding:8px 28px;"><h2 style="font-size:16px;color:${NAVY};margin:16px 0 8px;">Evolução dos custos</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="height:110px;"><tr>${bars}</tr></table>
    <div style="font-size:11px;color:${MUTED};margin-top:6px;"><span style="display:inline-block;width:10px;height:10px;background:${BLUE};"></span> Aprovado &nbsp; <span style="display:inline-block;width:10px;height:10px;background:${ORANGE};"></span> Realizado</div>
  </td></tr>
  <tr><td style="padding:8px 28px;"><h2 style="font-size:16px;color:${NAVY};margin:16px 0 8px;">Eficiência do investimento</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${kpi('Investimento realizado', brlFull(t.realized))}${kpi('Resultado alcançado', `${brlFull(snap.performance.resultCents)}`, `${snap.performance.wins} venda(s) no mês`)}</tr>
    <tr>${kpi('Resultado por real investido', eff === null ? '—' : `R$ ${eff.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`)}${kpi('Evolução da eficiência', pct(effVar))}</tr></table>
    <div style="font-size:11px;color:${MUTED};margin-top:6px;">Vendas do mês como referência: em centros ligados a times, as vendas do time; no consolidado, correlação (não é causa).</div>
  </td></tr>
  ${finance}
  <tr><td style="padding:8px 28px;"><h2 style="font-size:16px;color:${NAVY};margin:16px 0 8px;">Pontos de atenção</h2>
    ${attention.length ? `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:21px;">${attention.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : `<p style="margin:0;font-size:14px;">Nenhum ponto de atenção no período.</p>`}
  </td></tr>
  <tr><td style="padding:8px 28px;"><h2 style="font-size:16px;color:${NAVY};margin:16px 0 8px;">Por centro de custos</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr style="background:#F6F7F9;"><th align="left" style="padding:8px;font-size:12px;color:${MUTED};font-weight:600;">Centro</th><th align="right" style="padding:8px;font-size:12px;color:${MUTED};font-weight:600;">Aprovado</th><th align="right" style="padding:8px;font-size:12px;color:${MUTED};font-weight:600;">Realizado</th><th align="right" style="padding:8px;font-size:12px;color:${MUTED};font-weight:600;">Comprometido</th><th align="right" style="padding:8px;font-size:12px;color:${MUTED};font-weight:600;">Saldo</th></tr>${rows}</table>
  </td></tr>
  <tr><td style="padding:20px 28px 28px;">
    <p style="margin:0 0 14px;font-size:14px;">Acesse o ISP Sprint para consultar o demonstrativo completo, acompanhar os lançamentos e analisar a evolução dos indicadores.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${BLUE};"><a href="${esc(input.link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">Abrir o orçamento</a></td></tr></table>
    <p style="margin:18px 0 0;font-size:14px;">Atenciosamente,<br><b>Gestão Orçamentária</b><br>ISP Sprint</p>
  </td></tr>
  <tr><td style="background:${BG};padding:14px 28px;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};">${esc(input.company)} · Relatório gerado em ${esc(input.generatedAt)} · Você recebe este e-mail pelo seu papel no orçamento. O link pede login: nenhum dado sai do sistema sem a sua senha.</td></tr>
</table></td></tr></table></body></html>`;
}

export function budgetReportText(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|h2|li|div)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}
