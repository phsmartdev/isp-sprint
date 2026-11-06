/**
 * Análise de stakeholders da conta: todos os envolvidos (contatos do CRM, pessoas mapeadas e agentes ocultos), por setor,
 * com a classificação IA/INA/NIA/NINA, e o organograma montado pelo "reporta a" de cada pessoa.
 */
import { useMemo } from 'react';
import clsx from 'clsx';
import { EyeOff, Link2 } from 'lucide-react';
import {
  buildOrgChart, INNOVATION_LABELS, POWER_CLASS_DESC, POWER_CLASS_LABELS, PROFILE_SOURCE_LABELS, STAKEHOLDER_ROLE_LABELS, STANCE_LABELS,
  type InnovationOpenness, type OrgNode, type PowerClass, type ProfileSource, type StakeholderRole, type Stance,
} from '@isp/domain';
import { Chip, EmptyState, type Tone } from '../../components/ui/primitives';

export type AnalysisRow = {
  id: string; name: string; title: string | null; unitId: string | null; unitName: string | null; roles: StakeholderRole[]; stance: Stance; active: boolean;
  powerClass: PowerClass; powerClassSuggestion: PowerClass | null; hiddenAgent: boolean; reportsToId: string | null; innovationOpenness: InnovationOpenness;
  institutionalHistory: string | null; resistancePoints: string | null; sources: ProfileSource[]; origins: { type: string; count: number }[]; email: string | null; phone: string | null;
};
type Relation = { id: string; fromId: string; toId: string; kind: string };

export const POWER_TONE: Record<PowerClass, Tone> = { ia: 'blue', ina: 'orange', nia: 'sky', nina: 'neutral', nao_avaliado: 'neutral' };
export const PowerChip = ({ c }: { c: PowerClass }) => <Chip tone={POWER_TONE[c]} title={POWER_CLASS_DESC[c]}>{c === 'nao_avaliado' ? 'Sem classificação' : `${POWER_CLASS_LABELS[c]} · ${POWER_CLASS_DESC[c].toLowerCase()}`}</Chip>;
const ORIGIN_LABELS: Record<string, string> = { oportunidade: 'Contato de negociação', contrato: 'Contato de contrato', lead: 'Contato de lead', projeto: 'Projeto' };
export const OriginChips = ({ o }: { o: AnalysisRow['origins'] }) => o.length ? <>{o.map((x) => <Chip key={x.type} tone="neutral" title={`${x.count} vínculo(s)`}>{ORIGIN_LABELS[x.type] ?? x.type}</Chip>)}</> : null;

/** Números da análise: quantos envolvidos, por classificação, ocultos e quantos vieram dos contatos do CRM. */
export function AnalysisSummary({ items }: { items: AnalysisRow[] }) {
  const a = items.filter((i) => i.active);
  const cells: [string, number, string?][] = [
    ['Envolvidos', a.length], ['IA', a.filter((i) => i.powerClass === 'ia').length, POWER_CLASS_DESC.ia], ['INA', a.filter((i) => i.powerClass === 'ina').length, POWER_CLASS_DESC.ina],
    ['NIA', a.filter((i) => i.powerClass === 'nia').length, POWER_CLASS_DESC.nia], ['NINA', a.filter((i) => i.powerClass === 'nina').length, POWER_CLASS_DESC.nina],
    ['Agentes ocultos', a.filter((i) => i.hiddenAgent).length], ['Sem classificação', a.filter((i) => i.powerClass === 'nao_avaliado').length], ['Vindos dos contatos do CRM', a.filter((i) => i.origins.length).length],
  ];
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2" aria-label="Resumo da análise de stakeholders">
      {cells.map(([l, v, hint]) => <div key={l} className="border-l-2 border-primary/60 bg-surface-2 px-3 py-2" title={hint}><dt className="text-xs text-muted">{l}</dt><dd className="num text-xl font-bold text-ink">{v}</dd>{hint && <dd className="text-2xs text-muted">{hint}</dd>}</div>)}
    </dl>
  );
}

/** Lista dos nomes e cargos por setor, com papel, classificação, abertura à inovação, resistência e fontes. */
export function BySector({ items, onOpen }: { items: AnalysisRow[]; onOpen: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, AnalysisRow[]>();
    for (const i of items.filter((x) => x.active)) { const k = i.unitName ?? 'Setor não informado'; m.set(k, [...(m.get(k) ?? []), i]); }
    return [...m.entries()].sort(([a], [b]) => (a === 'Setor não informado' ? 1 : b === 'Setor não informado' ? -1 : a.localeCompare(b, 'pt-BR')));
  }, [items]);
  if (!groups.length) return <EmptyState title="Nenhum envolvido mapeado" description="Adicione as pessoas da conta, inclusive agentes ocultos. Quem já foi cadastrado como contato numa negociação aparece aqui sozinho." />;
  return (
    <div className="space-y-4">
      {groups.map(([sector, rows]) => (
        <section key={sector} aria-label={`Setor ${sector}`} className="border border-line">
          <h4 className="flex items-center justify-between bg-surface-2 px-3 py-2 text-sm font-bold text-ink">{sector}<span className="text-xs font-normal text-muted">{rows.length} pessoa(s)</span></h4>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-2 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                <div className="min-w-0">
                  <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(r.id)}>{r.name}</button>
                  {r.hiddenAgent && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-warning"><EyeOff className="h-3.5 w-3.5" aria-hidden />Agente oculto</span>}
                  <span className="block text-xs text-muted">{r.title ?? 'Cargo não informado'}</span>
                  <span className="mt-1 flex flex-wrap gap-1"><OriginChips o={r.origins} /></span>
                </div>
                <div className="flex min-w-0 flex-wrap content-start gap-1">
                  <PowerChip c={r.powerClass} />
                  {r.roles.map((x) => <Chip key={x} tone={x === 'bloqueador' ? 'red' : x === 'decisor' ? 'blue' : 'neutral'}>{STAKEHOLDER_ROLE_LABELS[x]}</Chip>)}
                </div>
                <div className="min-w-0 text-xs text-muted">
                  <p>Abertura à inovação: <b className="text-ink">{INNOVATION_LABELS[r.innovationOpenness]}</b> · Posicionamento: <b className="text-ink">{STANCE_LABELS[r.stance]}</b></p>
                  {r.resistancePoints && <p className="mt-0.5"><b className="text-ink">Resistência:</b> {r.resistancePoints}</p>}
                  {r.institutionalHistory && <p className="mt-0.5 line-clamp-2"><b className="text-ink">Histórico:</b> {r.institutionalHistory}</p>}
                  {!!r.sources.length && <p className="mt-0.5 flex flex-wrap gap-x-2">{r.sources.map((s, k) => s.url ? <a key={k} href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-primary hover:underline"><Link2 className="h-3 w-3" aria-hidden />{PROFILE_SOURCE_LABELS[s.kind]}</a> : <span key={k}>{PROFILE_SOURCE_LABELS[s.kind]}{s.note ? `: ${s.note}` : ''}</span>)}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const NODE_BORDER: Record<PowerClass, string> = { ia: 'border-primary', ina: 'border-[#C2610C]', nia: 'border-sky', nina: 'border-line-strong', nao_avaliado: 'border-line-strong border-dashed' };
function Node({ r, onOpen }: { r: AnalysisRow; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(r.id)} aria-label={`${r.name}, ${r.title ?? 'cargo não informado'}`}
      className={clsx('w-[176px] border-2 border-t-4 bg-surface p-2 text-left shadow-card transition-colors hover:bg-surface-2', NODE_BORDER[r.powerClass])}>
      <span className="block truncate text-sm font-bold text-ink" title={r.name}>{r.name}</span>
      <span className="block truncate text-xs text-text" title={r.title ?? ''}>{r.title ?? 'Cargo não informado'}</span>
      <span className="block truncate text-2xs text-muted">{r.unitName ?? 'Setor não informado'}</span>
      <span className="mt-1 flex items-center gap-1"><span className="bg-surface-2 px-1 text-2xs font-bold text-ink">{r.powerClass === 'nao_avaliado' ? '—' : POWER_CLASS_LABELS[r.powerClass]}</span>{r.roles.includes('decisor') && <span className="text-2xs font-semibold text-primary">decisor</span>}{r.roles.includes('bloqueador') && <span className="text-2xs font-semibold text-danger">bloqueador</span>}</span>
    </button>
  );
}
function Branch({ n, onOpen }: { n: OrgNode<AnalysisRow>; onOpen: (id: string) => void }) {
  return (
    <li>
      <Node r={n.item} onOpen={onOpen} />
      {!!n.children.length && <ul>{n.children.map((c) => <Branch key={c.item.id} n={c} onOpen={onOpen} />)}</ul>}
    </li>
  );
}

/** Organograma pelo "reporta a"; agentes ocultos ao lado, com quem eles influenciam (relações registradas). */
export function OrgChart({ items, relations, onOpen }: { items: AnalysisRow[]; relations: Relation[]; onOpen: (id: string) => void }) {
  const o = useMemo(() => buildOrgChart(items), [items]);
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? '—';
  const withBoss = items.filter((i) => i.active && !i.hiddenAgent && i.reportsToId).length;
  if (!o.roots.length && !o.hidden.length) return <EmptyState title="Organograma vazio" description="Adicione as pessoas da conta e, em cada uma, informe a quem ela reporta." />;
  return (
    <div className="space-y-3">
      {withBoss === 0 && o.roots.length > 1 && <p className="text-xs text-warning">Ninguém tem "reporta a" preenchido ainda: abra cada pessoa e informe a quem ela reporta para montar a hierarquia.</p>}
      {!!o.cyclic.length && <p className="text-xs text-danger">Há um ciclo no "reporta a" ({o.cyclic.map(name).join(', ')}): corrija para a hierarquia ficar certa.</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted" aria-label="Legenda">
        {(['ia', 'ina', 'nia', 'nina', 'nao_avaliado'] as PowerClass[]).map((c) => <span key={c} className="inline-flex items-center gap-1"><span className={clsx('inline-block h-3 w-4 border-2 border-t-4', NODE_BORDER[c])} />{c === 'nao_avaliado' ? 'sem classificação' : `${POWER_CLASS_LABELS[c]} (${POWER_CLASS_DESC[c].toLowerCase()})`}</span>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="orgchart scroll-thin overflow-x-auto border border-line bg-surface-2/40 p-4" role="tree" aria-label="Organograma da conta">
          {o.roots.length ? <ul>{o.roots.map((r) => <Branch key={r.item.id} n={r} onOpen={onOpen} />)}</ul> : <p className="text-sm text-muted">Só há agentes ocultos mapeados.</p>}
        </div>
        <aside className="border border-dashed border-warning/70 p-3" aria-label="Agentes ocultos">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink"><EyeOff className="h-4 w-4 text-warning" aria-hidden />Agentes ocultos ({o.hidden.length})</h4>
          {!o.hidden.length ? <p className="text-xs text-muted">Nenhum. Marque "agente oculto" em quem influencia sem aparecer no processo formal.</p> : (
            <ul className="space-y-2">{o.hidden.map((h) => {
              const infl = relations.filter((r) => r.fromId === h.id && (r.kind === 'influencia' || r.kind === 'aliado' || r.kind === 'indicou')).map((r) => name(r.toId));
              return <li key={h.id}><Node r={h} onOpen={onOpen} />{!!infl.length && <p className="mt-1 text-2xs text-muted">Influencia: {infl.join(', ')}</p>}</li>;
            })}</ul>
          )}
        </aside>
      </div>
    </div>
  );
}
