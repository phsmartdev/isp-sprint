/** Sucesso do Cliente: tipos das respostas, selos e o visualizador de slides do kickoff. */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { CS_LEVEL_LABELS, TIER_LABELS, type CsLevel, type Tier } from '@isp/domain';
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
export type Slide = { id: string; key: string; title: string; layout: 'capa' | 'texto' | 'duas_colunas' | 'tabela' | 'encerramento'; body: string; table?: string[][]; hidden: boolean; pending: string[] };

const LEVEL_TONE: Record<CsLevel, Tone> = { baixa: 'green', moderada: 'yellow', alta: 'orange', critica: 'red' };
export const LevelChip = ({ level, manual }: { level: CsLevel; manual?: boolean }) => <Chip tone={LEVEL_TONE[level]} title={manual ? 'Prioridade definida manualmente' : undefined}>{CS_LEVEL_LABELS[level]}{manual ? ' · manual' : ''}</Chip>;
export const TierChip = ({ tier }: { tier: Tier | null }) => (tier ? <Chip tone={tier === 'large' ? 'purple' : tier === 'middle' ? 'blue' : 'neutral'}>{TIER_LABELS[tier].split(' ')[0]}</Chip> : <span className="text-muted">—</span>);
export function HealthBadge({ score, label }: { score: number | null; label?: string }) {
  if (score === null) return <span className="text-sm text-muted" title="Dados insuficientes para calcular">Sem dados</span>;
  return <span className={clsx('num inline-flex items-center gap-1.5 text-sm font-semibold', score >= 75 ? 'text-success' : score >= 50 ? 'text-[#C2610C]' : 'text-danger')}><span className={clsx('h-2.5 w-2.5 rounded-circle', score >= 75 ? 'bg-success' : score >= 50 ? 'bg-[#F59E0B]' : 'bg-danger')} aria-hidden />{score}{label ? ` · ${label}` : ''}</span>;
}
export const covText = (c: Coverage | null | undefined, k: 'simple' | 'weighted' = 'simple') => (!c || c[k] === null ? 'Sem cadência prevista' : fmtPct(c[k]));
export const IPC_LEVEL_OPTS = [['baixo', 'Baixo'], ['medio', 'Médio'], ['alto', 'Alto']] as const;

/** Um slide renderizado (usado no editor, na apresentação em tela cheia, no PDF e no link do cliente). */
export function SlideView({ s, client, big }: { s: Slide; client?: string; big?: boolean }) {
  const lines = (t: string) => t.split('\n').filter((l) => l.trim() !== '');
  const Txt = ({ text }: { text: string }) => (
    <div className={clsx('space-y-2', big ? 'text-[1.6vw]' : 'text-sm')}>
      {lines(text).map((l, i) => l.startsWith('- ') ? <p key={i} className="flex gap-2"><span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rotate-45 bg-lime" aria-hidden />{l.slice(2)}</p> : <p key={i} className={clsx(i === 0 && s.layout === 'duas_colunas' && 'font-semibold text-[#4FBBFF]')}>{l}</p>)}
    </div>
  );
  const dark = s.layout === 'capa' || s.layout === 'encerramento';
  return (
    <div className={clsx('relative flex aspect-video w-full flex-col overflow-hidden rounded-md', dark ? 'bg-gradient-to-br from-navy to-primary text-white' : 'border border-line bg-white text-ink')}>
      <svg className="pointer-events-none absolute -right-[8%] -top-[18%] h-[70%] w-auto opacity-30" viewBox="0 0 100 100" aria-hidden><polygon points="50,2 93,26 93,74 50,98 7,74 7,26" fill="none" stroke={dark ? '#4FBBFF' : '#2F5986'} strokeWidth="2" /></svg>
      <div className={clsx('relative flex flex-1 flex-col', big ? 'p-[4vw]' : 'p-5')}>
        {dark ? (
          <div className="my-auto">
            <p className={clsx('font-display font-bold tracking-wide', big ? 'text-[4vw]' : 'text-2xl')}>{s.title}</p>
            <div className={clsx('mt-3 text-white/90', big ? 'text-[1.8vw]' : 'text-sm')}>{lines(s.body).map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</p>)}</div>
          </div>
        ) : (<>
          <p className={clsx('mb-[3%] font-display font-bold tracking-wide text-primary', big ? 'text-[2.6vw]' : 'text-lg')}>{s.title}</p>
          {s.layout === 'tabela' && s.table?.length ? (
            <table className={clsx('w-full text-left', big ? 'text-[1.4vw]' : 'text-xs')}>
              <thead><tr>{s.table[0]!.map((h, i) => <th key={i} className="border-b-2 border-primary px-2 py-1 font-semibold text-primary">{h}</th>)}</tr></thead>
              <tbody>{s.table.slice(1).map((r, i) => <tr key={i} className="border-b border-line">{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>)}</tbody>
            </table>
          ) : s.layout === 'duas_colunas' ? (
            <div className="grid flex-1 grid-cols-2 gap-[4%]">{s.body.split('\n|\n').slice(0, 2).map((col, i) => <Txt key={i} text={col} />)}</div>
          ) : <Txt text={s.body} />}
          {s.layout === 'tabela' && !s.table?.length && <Txt text={s.body} />}
        </>)}
        {client && <p className={clsx('absolute bottom-[3%] right-[4%] opacity-60', big ? 'text-[1vw]' : 'text-[10px]')}>{client}</p>}
      </div>
    </div>
  );
}

/** Apresentação em tela cheia com setas do teclado. */
export function Presenter({ slides, client, onClose }: { slides: Slide[]; client?: string; onClose: () => void }) {
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
      {cur && <div className="w-full max-w-[177.78vh]"><SlideView s={cur} client={client} big /></div>}
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
export function PrintDeck({ slides, client }: { slides: Slide[]; client?: string }) {
  return (
    <div className="hidden print:block">
      <style>{'@page { size: A4 landscape; margin: 8mm } .cs-print-slide { break-after: page; }'}</style>
      {slides.filter((x) => !x.hidden).map((x) => <div key={x.id} className="cs-print-slide"><SlideView s={x} client={client} big /></div>)}
    </div>
  );
}
