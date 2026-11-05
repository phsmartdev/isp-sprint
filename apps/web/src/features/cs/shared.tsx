/** Sucesso do Cliente: tipos das respostas, selos e o visualizador de slides do kickoff. */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CS_LEVEL_LABELS, DEFAULT_SLIDE_FRAME, SLIDE_TABLE_SOURCE_LABELS, TIER_LABELS, slideTableFit, type CsLevel, type SlideTableSource, type Tier } from '@isp/domain';
import { Logo } from '../../components/brand';
import { Chip, type Tone } from '../../components/ui/primitives';
import { fmtPct } from '../../lib/format';

export type Coverage = { planned: number; onTime: number; extra: number; simple: number | null; weighted: number | null };
export type Snapshot = {
  computedAt: string; ruleVersion: number; acvCents: number; groupAcvCents: number; groupContacts: number; tier: Tier | null;
  acvParts?: { recorrente: number; medicao: number; frequente: number; semContrato: number }; acvExcluded?: { count: number; cents: number };
  contracts: { id: string; number: string; billingType: string; kind: string; stage: string; acvCents: number; startAt: string | null; endAt: string | null; consumption: null | { credited: number; consumed: number; share: number | null; elapsedShare: number | null; exhaustAt: string | null; lastConsumptionAt: string | null } }[];
  relationshipMonths: number | null; classKey: string | null;
  ipc: { total: number | null; partial: number; pending: string[]; levels: Record<string, 'baixo' | 'medio' | 'alto' | null>; auto: string[]; assessedAt: string | null; reviewDue: boolean };
  satisfaction: { last: number | null; previous: number | null; lastAt: string | null; kind: string | null };
  financial: { available: false; reason: string };
  occurrences: number; highOccurrences: number; deliveries: { due: number; late: number }; churnRisk: 'baixo' | 'medio' | 'alto' | null;
  lastContactAt: string | null; nextContactAt: string | null; overdueFollowUpDays: number; daysToEnd: number | null;
  health: { score: number | null; label: string; coverage: number; parts: { key: string; value: number | null; weight: number }[] };
  criticality: { level: CsLevel; points: number; reasons: { key: string; reason: string; points: number }[] };
  manual: { level: CsLevel; reason: string | null; reviewAt: string | null } | null;
  effective: { level: CsLevel; source: 'calculada' | 'manual' };
  expansion: { openCount: number; openValueCents: number };
  policy: { key: string; name: string; contactDays: number | null; visitDays: number | null; reviewDays: number | null } | null;
};
export type Slide = { id: string; key: string; title: string; layout: 'capa' | 'texto' | 'duas_colunas' | 'tabela' | 'encerramento'; body: string; table?: string[][]; hidden: boolean; pending: string[]; frame?: { x: number; y: number; w: number; h: number } | null; source?: SlideTableSource | null };

const LEVEL_TONE: Record<CsLevel, Tone> = { baixa: 'green', moderada: 'yellow', alta: 'orange', critica: 'red' };
export const LevelChip = ({ level, manual }: { level: CsLevel; manual?: boolean }) => <Chip tone={LEVEL_TONE[level]} title={manual ? 'Prioridade definida manualmente' : undefined}>{CS_LEVEL_LABELS[level]}{manual ? ' · manual' : ''}</Chip>;
export const TierChip = ({ tier }: { tier: Tier | null }) => (tier ? <Chip tone={tier === 'large' ? 'purple' : tier === 'middle' ? 'blue' : 'neutral'}>{TIER_LABELS[tier].split(' ')[0]}</Chip> : <span className="text-muted">—</span>);
export function HealthBadge({ score, label }: { score: number | null; label?: string }) {
  if (score === null) return <span className="text-sm text-muted" title="Dados insuficientes para calcular">Sem dados</span>;
  return <span className={clsx('num inline-flex items-center gap-1.5 text-sm font-semibold', score >= 75 ? 'text-success' : score >= 50 ? 'text-[#C2610C]' : 'text-danger')}><span className={clsx('h-2.5 w-2.5 rounded-circle', score >= 75 ? 'bg-success' : score >= 50 ? 'bg-[#F59E0B]' : 'bg-danger')} aria-hidden />{score}{label ? ` · ${label}` : ''}</span>;
}
export const covText = (c: Coverage | null | undefined, k: 'simple' | 'weighted' = 'simple') => (!c || c[k] === null ? 'Sem cadência prevista' : fmtPct(c[k]));
export const IPC_LEVEL_OPTS = [['baixo', 'Baixo'], ['medio', 'Médio'], ['alto', 'Alto']] as const;

/** Dados extras do slide: tabelas pelas variáveis do CRM e a marca do cliente (opcional). */
export type SlideCtx = { tables?: Record<string, string[][]>; clientLogo?: string | null };
export type Frame = { x: number; y: number; w: number; h: number };

/** Abre a tabela completa numa janela própria para salvar como PDF (quando o slide mostra só parte dos itens). */
export function openTablePdf(title: string, rows: string[][], client?: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const [head = [], ...body] = rows;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm } body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; }
    h1 { font-size: 18px; color: #2F5986; margin: 0 0 4px } p { margin: 0 0 12px; color: #64748B; font-size: 12px }
    table { width: 100%; border-collapse: collapse; font-size: 11px } th { text-align: left; border-bottom: 2px solid #2F5986; color: #2F5986; padding: 6px }
    td { border-bottom: 1px solid #E2E8F0; padding: 5px 6px } tr { break-inside: avoid }
  </style></head><body><h1>${esc(title)}</h1><p>${client ? `${esc(client)} · ` : ''}${body.length} item(ns) · ${new Date().toLocaleDateString('pt-BR')}</p>
  <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <script>setTimeout(() => window.print(), 300)</script></body></html>`);
  w.document.close();
}

/**
 * Um slide renderizado (editor, apresentação em tela cheia, PDF e link do cliente). Tudo é medido em % da largura do
 * próprio slide (cqw): o texto escala junto com o slide e não se sobrepõe em tela cheia.
 * Fora do frame: título, marca da BK (canto superior direito) e marca do cliente (rodapé, opcional).
 * Dentro do frame: o conteúdo (texto, duas colunas ou tabela). Tabela maior que o frame mostra o que cabe e oferece o PDF completo.
 */
export function SlideView({ s, client, ctx, onFrame }: { s: Slide; client?: string; big?: boolean; ctx?: SlideCtx; onFrame?: (f: Frame) => void }) {
  const lines = (t: string) => t.split('\n').filter((l) => l.trim() !== '');
  const Txt = ({ text }: { text: string }) => (
    <div className="space-y-[0.7cqw] text-[1.6cqw] leading-[1.4]">
      {lines(text).map((l, i) => l.startsWith('- ') ? <p key={i} className="flex gap-[0.8cqw]"><span className="mt-[0.6cqw] h-[0.6cqw] w-[0.6cqw] shrink-0 rotate-45 bg-lime" aria-hidden />{l.slice(2)}</p> : <p key={i} className={clsx(i === 0 && s.layout === 'duas_colunas' && 'font-semibold text-[#2F5986]')}>{l}</p>)}
    </div>
  );
  const dark = s.layout === 'capa' || s.layout === 'encerramento';
  const frame: Frame = s.frame ?? (dark ? { x: 6, y: 30, w: 70, h: 50 } : { ...DEFAULT_SLIDE_FRAME });
  const rows = s.layout === 'tabela' ? (s.source ? ctx?.tables?.[s.source] ?? null : s.table ?? null) : null;
  const head = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const fit = slideTableFit(frame.h, body.length);
  const tableTitle = s.source ? SLIDE_TABLE_SOURCE_LABELS[s.source] : s.title;
  return (
    <div className={clsx('relative aspect-video w-full overflow-hidden rounded-md [container-type:inline-size]', dark ? 'bg-gradient-to-br from-navy to-primary text-white' : 'border border-line bg-white text-ink')}>
      <svg className="pointer-events-none absolute -right-[8%] -top-[18%] h-[70%] w-auto opacity-20" viewBox="0 0 100 100" aria-hidden><polygon points="50,2 93,26 93,74 50,98 7,74 7,26" fill="none" stroke={dark ? '#4FBBFF' : '#2F5986'} strokeWidth="2" /></svg>
      {/* marca da BK: canto superior direito, fora do frame */}
      <Logo variant={dark ? 'white' : 'color'} className="absolute right-[3%] top-[4%] !h-[5.5cqw]" />
      {!dark && <p className="absolute left-[5%] right-[20%] top-[6%] truncate font-display text-[2.8cqw] font-bold leading-[1.2] tracking-wide text-primary">{s.title}</p>}
      <div className="absolute overflow-hidden" style={{ left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.w}%`, height: `${frame.h}%` }}>
        {dark ? (
          <div className="flex h-full flex-col justify-center">
            <p className="font-display text-[5.2cqw] font-bold leading-[1.1] tracking-wide">{s.title}</p>
            <div className="mt-[1.4cqw] space-y-[0.4cqw] text-[2cqw] leading-[1.35] text-white/90">{lines(s.body).map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</p>)}</div>
          </div>
        ) : rows && rows.length > 1 ? (
          <div>
            <table className="w-full table-fixed text-left text-[1.25cqw] leading-[1.35]">
              <thead><tr className="h-[3.1cqw]">{head.map((h, i) => <th key={i} className="truncate border-b-2 border-primary px-[0.6cqw] font-semibold text-primary">{h}</th>)}</tr></thead>
              <tbody>{body.slice(0, fit.show).map((r, i) => <tr key={i} className="h-[2.7cqw] border-b border-line">{r.map((c, j) => <td key={j} className="truncate px-[0.6cqw]" title={c}>{c}</td>)}</tr>)}</tbody>
            </table>
            {fit.cut > 0 && (
              <p className="flex h-[2.7cqw] items-center gap-[0.8cqw] text-[1.15cqw] text-muted">
                Mostrando {fit.show} de {body.length} itens.
                <button type="button" className="font-semibold text-primary underline" onClick={(e) => { e.stopPropagation(); openTablePdf(tableTitle, rows, client); }}>Abrir lista completa (PDF)</button>
              </p>
            )}
          </div>
        ) : s.layout === 'tabela' ? (
          <p className="text-[1.4cqw] text-muted">{s.source ? 'Sem dados no CRM para esta tabela.' : 'Tabela vazia.'}</p>
        ) : s.layout === 'duas_colunas' ? (
          <div className="grid h-full grid-cols-2 gap-[4%]">{s.body.split('\n|\n').slice(0, 2).map((col, i) => <Txt key={i} text={col} />)}</div>
        ) : <Txt text={s.body} />}
      </div>
      {/* marca do cliente no rodapé (opcional); sem ela, o nome */}
      {ctx?.clientLogo ? <img src={ctx.clientLogo} alt={client ?? 'Cliente'} className="absolute bottom-[3%] right-[3%] h-[5cqw] max-w-[22%] object-contain" />
        : client && <p className={clsx('absolute bottom-[3%] right-[4%] text-[1cqw]', dark ? 'text-white/70' : 'text-muted')}>{client}</p>}
      {onFrame && <FrameEditor frame={frame} onChange={onFrame} />}
    </div>
  );
}

/** Retângulo tracejado sobre o slide: arrastar move a área das informações; o canto inferior direito muda o tamanho. */
function FrameEditor({ frame, onChange }: { frame: Frame; onChange: (f: Frame) => void }) {
  const start = (e: React.PointerEvent, mode: 'move' | 'size') => {
    e.preventDefault(); e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).closest('[class*="container-type"]')?.getBoundingClientRect();
    if (!box) return;
    const x0 = e.clientX, y0 = e.clientY, f0 = { ...frame };
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10;
    const mv = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / box.width) * 100, dy = ((ev.clientY - y0) / box.height) * 100;
      if (mode === 'move') onChange({ ...f0, x: clamp(f0.x + dx, 0, 100 - f0.w), y: clamp(f0.y + dy, 0, 100 - f0.h) });
      else onChange({ ...f0, w: clamp(f0.w + dx, 10, 100 - f0.x), h: clamp(f0.h + dy, 10, 100 - f0.y) });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div className="absolute cursor-move border-2 border-dashed border-[#4FBBFF] bg-[#4FBBFF]/5" style={{ left: `${frame.x}%`, top: `${frame.y}%`, width: `${frame.w}%`, height: `${frame.h}%` }}
      onPointerDown={(e) => start(e, 'move')} role="group" aria-label="Área das informações (arraste para mover; canto para redimensionar)">
      <span className="absolute -top-6 left-0 rounded-sm bg-[#4FBBFF] px-1.5 py-0.5 text-[11px] font-semibold text-navy">Área das informações</span>
      <span className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-[#4FBBFF]" onPointerDown={(e) => start(e, 'size')} aria-hidden />
    </div>
  );
}

/** Apresentação em tela cheia com setas do teclado. */
export function Presenter({ slides, client, ctx, onClose }: { slides: Slide[]; client?: string; ctx?: SlideCtx; onClose: () => void }) {
  const list = slides.filter((x) => !x.hidden);
  const [i, setI] = useState(0);
  useEffect(() => {
    const el = document.documentElement;
    void el.requestFullscreen?.().catch(() => undefined);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setI((x) => Math.min(list.length - 1, x + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') onClose();
    };
    const fs = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fs); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = list[i];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black" role="dialog" aria-label="Apresentação">
      {cur && <div className="w-full max-w-[177.78vh]"><SlideView s={cur} client={client} ctx={ctx} /></div>}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-white">
        <button aria-label="Slide anterior" onClick={() => setI(Math.max(0, i - 1))}><ChevronLeft className="h-5 w-5" /></button>
        <span className="num text-sm">{i + 1} / {list.length}</span>
        <button aria-label="Próximo slide" onClick={() => setI(Math.min(list.length - 1, i + 1))}><ChevronRight className="h-5 w-5" /></button>
        <button aria-label="Sair da apresentação" className="ml-2" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
    </div>
  );
}

/** Todos os slides, um por página, para imprimir/salvar em PDF pelo navegador. */
export function PrintDeck({ slides, client, ctx }: { slides: Slide[]; client?: string; ctx?: SlideCtx }) {
  return (
    <div className="hidden print:block">
      <style>{'@page { size: A4 landscape; margin: 8mm } .cs-print-slide { break-after: page; }'}</style>
      {slides.filter((x) => !x.hidden).map((x) => <div key={x.id} className="cs-print-slide"><SlideView s={x} client={client} ctx={ctx} /></div>)}
    </div>
  );
}

/** CSMs = usuários com o setor Sucesso do Cliente no cadastro (só eles aparecem nas listas de CSM). */
export const csmsOf = <U extends { sectors?: string[] }>(users: U[] | undefined) => (users ?? []).filter((u) => u.sectors?.includes('sucesso_cliente'));
