/** Linha do tempo única do contrato: próximos prazos, tudo o que aconteceu por assunto e o que é crítico em destaque. */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Search } from 'lucide-react';
import { TIMELINE_CATEGORIES, TIMELINE_CATEGORY_LABELS, type TimelineCategory, type UpcomingKind } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { EmptyState, LoadingRows } from '../../components/ui/primitives';
import type { ContractDetail } from './shared';

type Item = { id: string; at: string; category: TimelineCategory; type: string; title: string; sub: string; critical: boolean };
type Up = { kind: UpcomingKind; on: string; title: string; days: number };
type Timeline = { items: Item[]; counts: Record<TimelineCategory, number>; upcoming: Up[]; today: string };

const UP_LABELS: Record<UpcomingKind, string> = { termino: 'Vigência', renovacao: 'Renovação', alerta: 'Alerta', processo: 'Processo', clausula: 'Cláusula', ocorrencia: 'Ocorrência', tarefa: 'Tarefa' };
/** Cor do marcador por assunto: azuis e grafites da marca; vermelho só para o que é crítico. */
const DOT: Record<TimelineCategory, string> = {
  contrato: 'bg-primary', aditivos: 'bg-primary', financeiro: 'bg-sky', processos: 'bg-sky',
  execucao: 'bg-ink', documentos: 'bg-purple', alertas: 'bg-warning', emails: 'bg-purple', tarefas: 'bg-line-strong',
};
const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const daysText = (d: number) => (d < 0 ? `vencido há ${-d} dia${d === -1 ? '' : 's'}` : d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d} dias`);

export function TimelinePanel({ c }: { c: ContractDetail }) {
  const q = useQuery({ queryKey: ['contract-timeline', c.id, c.currentVersion, c.stage], queryFn: () => api<Timeline>(`/contracts/${c.id}/timeline`) });
  const [cats, setCats] = useState<TimelineCategory[]>([]);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [text, setText] = useState('');
  const items = useMemo(() => {
    const t = text.trim().toLocaleLowerCase('pt-BR');
    return (q.data?.items ?? []).filter((x) => (!cats.length || cats.includes(x.category)) && (!onlyCritical || x.critical) && (!t || `${x.title} ${x.sub}`.toLocaleLowerCase('pt-BR').includes(t)));
  }, [q.data, cats, onlyCritical, text]);
  const groups = useMemo(() => {
    const g: { key: string; label: string; items: Item[] }[] = [];
    for (const x of items) {
      const key = x.at.slice(0, 7);
      if (g[g.length - 1]?.key !== key) g.push({ key, label: monthLabel(`${key}-15T12:00:00Z`), items: [] });
      g[g.length - 1]!.items.push(x);
    }
    return g;
  }, [items]);
  if (q.isLoading || !q.data) return <LoadingRows rows={5} />;
  const d = q.data;
  const criticalCount = d.items.filter((x) => x.critical).length;
  const toggle = (k: TimelineCategory) => setCats((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));

  return (
    <div className="space-y-5">
      <section aria-label="Próximos prazos" className="border border-line bg-surface">
        <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink">Próximos prazos</h3>
          <span className="text-xs text-muted">próximos 120 dias e vencidos</span>
        </header>
        {d.upcoming.length ? (
          <ul className="divide-y divide-line">
            {d.upcoming.map((u, i) => (
              <li key={`${u.kind}-${i}`} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 px-4 py-2 text-sm">
                <span className="text-xs font-semibold text-muted">{UP_LABELS[u.kind]}</span>
                <span className="truncate text-ink" title={u.title}>{u.title}</span>
                <span className={clsx('whitespace-nowrap text-xs font-semibold tabular-nums', u.days < 0 ? 'text-danger' : u.days <= 7 ? 'text-[#C2610C]' : 'text-muted')}>
                  {fmtDate(u.on)} · {daysText(u.days)}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-3 text-sm text-muted">Nenhum prazo nos próximos 120 dias.</p>}
      </section>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar linha do tempo por assunto">
          <button aria-pressed={!cats.length} onClick={() => setCats([])} className={chip(!cats.length)}>Tudo <span className="tabular-nums opacity-70">{d.items.length}</span></button>
          {TIMELINE_CATEGORIES.filter((k) => d.counts[k]).map((k) => (
            <button key={k} aria-pressed={cats.includes(k)} onClick={() => toggle(k)} className={chip(cats.includes(k))}>
              {TIMELINE_CATEGORY_LABELS[k]} <span className="tabular-nums opacity-70">{d.counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Buscar na linha do tempo</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar por número, nome, valor..." className="h-9 w-full border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none" />
          </label>
          <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-sm', criticalCount ? 'text-ink' : 'text-muted')}>
            <input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} disabled={!criticalCount} className="h-4 w-4 accent-[rgb(var(--primary))]" />
            Só críticos <span className="tabular-nums text-muted">({criticalCount})</span>
          </label>
        </div>
      </div>

      {!groups.length ? <EmptyState title="Nada encontrado" description="Mude o filtro ou a busca para ver outros registros." /> : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h4 className="mb-2 text-xs font-semibold text-muted first-letter:uppercase">{g.label} <span className="font-normal">· {g.items.length}</span></h4>
              <ol className="relative space-y-1 border-l-2 border-line pl-5">
                {g.items.map((x) => (
                  <li key={x.id} data-critical={x.critical || undefined} className={clsx('relative py-1.5', x.critical && '-ml-5 border-l-2 border-danger bg-danger-soft/60 pl-5 pr-3')}>
                    <span className={clsx('absolute top-3 h-2.5 w-2.5 rounded-circle border-2 border-surface', x.critical ? 'left-[-6px] bg-danger' : '-left-[26px] ' + DOT[x.category])} aria-hidden />
                    <p className="text-sm text-ink">
                      {x.critical && <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-danger" aria-label="Crítico" />}
                      {x.title}
                    </p>
                    <p className="text-xs text-muted">{fmtDateTime(x.at)} · {TIMELINE_CATEGORY_LABELS[x.category]} · {x.sub}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const chip = (on: boolean) => clsx('border px-3 py-1 text-sm font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:border-primary');
