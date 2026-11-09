/**
 * Evolução do relacionamento: linha do tempo da conta (contratos, aditivos, reajustes, oportunidades, projetos,
 * pessoas, ocorrências e interações) e o registro de ocorrências (notificação, elogio, mudança na negociação…).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import {
  ACCOUNT_OCCURRENCE_CHANNELS, ACCOUNT_OCCURRENCE_CHANNEL_LABELS, ACCOUNT_OCCURRENCE_IMPACTS, ACCOUNT_OCCURRENCE_IMPACT_LABELS, ACCOUNT_OCCURRENCE_KINDS,
  ACCOUNT_OCCURRENCE_KIND_HINTS, ACCOUNT_OCCURRENCE_KIND_LABELS, ACCOUNT_OCCURRENCE_NEEDS_RESPONSE, AMENDMENT_LABELS, CONTRACT_STAGE_LABELS,
  DEFAULT_ACCOUNT_OCCURRENCE_IMPACT, NEGOTIATION_ASPECTS, NEGOTIATION_ASPECT_LABELS, OCCURRENCE_LABELS, STAGE_LABELS, STANCE_LABELS,
  type AccountOccurrenceChannel, type AccountOccurrenceImpact, type AccountOccurrenceKind, type AmendmentKind, type ContractStage,
  type NegotiationAspect, type OccurrenceKind, type OpportunityStage, type Stance,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, Chip, ChipGroup, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';

type Occurrence = {
  id: string; kind: AccountOccurrenceKind; occurredOn: string; title: string; description: string | null; impact: AccountOccurrenceImpact;
  channel: AccountOccurrenceChannel | null; aspects: NegotiationAspect[];
  stakeholderId: string | null; stakeholderName: string | null; opportunityId: string | null; opportunityCode: number | null; opportunityTitle: string | null;
  contractId: string | null; contractNumber: string | null; responseDueOn: string | null; respondedOn: string | null; responseNote: string | null;
  createdByName: string; response: 'respondida' | 'atrasada' | 'pendente' | null; canChange: boolean; rowVersion: number;
};
type Evolution = {
  today: string;
  visible: { contracts: boolean; opportunities: boolean; projects: boolean };
  contracts: { id: string; number: string; object: string; startAt: string | null; endAt: string | null; monthlyCents: number; stage: string; closedOn: string | null;
    amendments: { on: string; number: string; kind: string; description: string }[]; adjustments: { on: string; indexName: string; inputText: string; mode: string }[];
    occurrences: { on: string; kind: string; title: string }[] }[];
  opportunities: { id: string; code: number; title: string; stage: string; valueCents: number | null; createdOn: string; wonOn: string | null; lostOn: string | null }[];
  projects: { id: string; code: number; name: string; status: string; startOn: string; dueOn: string | null; doneOn: string | null }[];
  people: { stakeholderId: string; name: string; on: string; change: 'entrou' | 'saiu' | 'voltou' | 'posicionamento'; detail: string | null }[];
  interactionsByQuarter: Record<string, number>;
  occurrences: Occurrence[];
  years: { year: number; monthlyCents: number; activeContracts: number; opened: number; won: number; lost: number; interactions: number; positive: number; negative: number }[];
};

const LANES = ['contratos', 'oportunidades', 'projetos', 'pessoas', 'ocorrencias', 'interacoes'] as const;
type Lane = (typeof LANES)[number];
const LANE_LABELS: Record<Lane, string> = { contratos: 'Contratos', oportunidades: 'Oportunidades', projetos: 'Projetos', pessoas: 'Pessoas', ocorrencias: 'Ocorrências', interacoes: 'Interações' };
const IMPACT_TONE: Record<AccountOccurrenceImpact, Tone> = { positivo: 'green', neutro: 'neutral', negativo: 'red' };
const IMPACT_COLOR: Record<AccountOccurrenceImpact, string> = { positivo: '#16A34A', neutro: '#5F6B76', negativo: '#D23434' };
const errMsg = (e: unknown) => (e instanceof ApiError ? (e.problem.errors?.[0]?.message ? `${e.problem.detail ?? e.problem.title} (${e.problem.errors[0].message})` : (e.problem.detail ?? e.problem.title)) : (e as Error).message);
const stanceLabel = (s: string) => STANCE_LABELS[s as Stance] ?? s;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (!e) return; const nw = Math.round(e.contentRect.width); if (nw > 0) setW((o) => (Math.abs(o - nw) > 2 ? nw : o)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function AccountEvolution({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['account-evolution', contactId], queryFn: () => api<Evolution>(`/accounts/${contactId}/evolution`) });
  const [editing, setEditing] = useState<Occurrence | 'new' | null>(null);
  const [removing, setRemoving] = useState<Occurrence | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([...LANES]);
  const [kind, setKind] = useState<'' | AccountOccurrenceKind>('');
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const pending = d.occurrences.filter((o) => o.response === 'atrasada' || o.response === 'pendente');
  const list = d.occurrences.filter((o) => !kind || o.kind === kind);
  const empty = !d.contracts.length && !d.opportunities.length && !d.projects.length && !d.people.length && !d.occurrences.length && !Object.keys(d.interactionsByQuarter).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup legend="Mostrar na linha do tempo" options={LANES} value={lanes} onChange={setLanes} labels={LANE_LABELS} />
        <Button className="ml-auto" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Registrar ocorrência</Button>
      </div>
      {pending.length > 0 && (
        <section className="card border-l-4 border-l-warning p-4" aria-label="Respostas pendentes">
          <h2 className="font-bold text-ink">Resposta ao cliente pendente</h2>
          <ul className="mt-1 space-y-1 text-sm">{pending.map((o) => (
            <li key={o.id}><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setEditing(o)}>{o.title}</button>
              <span className={clsx('ml-1', o.response === 'atrasada' ? 'font-semibold text-danger' : 'text-muted')}> · {o.response === 'atrasada' ? 'atrasada desde' : 'responder até'} {fmtDate(o.responseDueOn)}</span></li>
          ))}</ul>
        </section>
      )}
      {empty ? (
        <div className="card"><EmptyState title="Nada para mostrar ainda" description="A evolução aparece conforme a conta ganha contratos, oportunidades, projetos, pessoas, interações e ocorrências registradas." /></div>
      ) : (
        <section className="card p-4" aria-label="Linha do tempo da conta">
          <h2 className="font-bold text-ink">Evolução do relacionamento</h2>
          <p className="text-xs text-muted">Cada marca abre o registro de origem. No contrato, ● amarelo = aditivo, ● azul-claro = reajuste, ● vermelho = ocorrência do contrato. Na faixa de interações, o número é quantas foram concluídas no trimestre.</p>
          <Timeline d={d} lanes={lanes} onOccurrence={setEditing} />
          {(!d.visible.contracts || !d.visible.opportunities || !d.visible.projects) && <p className="mt-2 text-xs text-muted">Seu perfil não vê {[!d.visible.contracts && 'contratos', !d.visible.opportunities && 'oportunidades', !d.visible.projects && 'projetos'].filter(Boolean).join(', ')}; essas faixas ficam de fora.</p>}
        </section>
      )}

      <section className="card overflow-hidden" aria-label="Ocorrências da conta">
        <div className="flex flex-wrap items-center gap-2 p-4 pb-2">
          <h2 className="font-bold text-ink">Ocorrências</h2>
          <span className="text-xs text-muted">Notificações, elogios, mudanças na negociação e outros fatos que ajudam a analisar a conta.</span>
          <Select aria-label="Filtrar por tipo" className="ml-auto h-8 w-auto text-xs" value={kind} onChange={(e) => setKind(e.target.value as AccountOccurrenceKind | '')}>
            <option value="">Todos os tipos</option>{ACCOUNT_OCCURRENCE_KINDS.map((k) => <option key={k} value={k}>{ACCOUNT_OCCURRENCE_KIND_LABELS[k]}</option>)}
          </Select>
        </div>
        {!list.length ? <div className="border-t border-line"><EmptyState title={d.occurrences.length ? 'Nenhuma ocorrência deste tipo' : 'Nenhuma ocorrência registrada'} description="Registre notificações recebidas, elogios, reclamações, mudanças na negociação, trocas de gestão…" /></div> : (
          <ul className="divide-y divide-line border-t border-line">{list.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
              <span className="num w-20 shrink-0 text-xs text-muted">{fmtDate(o.occurredOn)}</span>
              <div className="min-w-[min(100%,20rem)] flex-1">
                <p className="flex flex-wrap items-center gap-1.5"><Chip tone={IMPACT_TONE[o.impact]}>{ACCOUNT_OCCURRENCE_KIND_LABELS[o.kind]}</Chip><b className="text-ink">{o.title}</b></p>
                {o.description && <p className="mt-0.5 whitespace-pre-line text-text">{o.description}</p>}
                <p className="mt-0.5 text-xs text-muted">
                  {[o.channel && ACCOUNT_OCCURRENCE_CHANNEL_LABELS[o.channel], o.aspects.length ? `Mudou: ${o.aspects.map((a) => NEGOTIATION_ASPECT_LABELS[a]).join(', ')}` : null, o.stakeholderName && `Pessoa: ${o.stakeholderName}`,
                    o.opportunityCode && `OP-${o.opportunityCode}`, o.contractNumber && `Contrato ${o.contractNumber}`, `registrado por ${o.createdByName}`].filter(Boolean).join(' · ')}
                </p>
                {o.response && <p className={clsx('mt-0.5 text-xs', o.response === 'atrasada' ? 'font-semibold text-danger' : o.response === 'respondida' ? 'text-success' : 'text-muted')}>
                  {o.response === 'respondida' ? `Respondida em ${fmtDate(o.respondedOn)}${o.responseNote ? `: ${o.responseNote}` : ''}` : `${o.response === 'atrasada' ? 'Resposta atrasada' : 'Responder até'} ${fmtDate(o.responseDueOn)}`}
                </p>}
              </div>
              {o.canChange && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setEditing(o)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(o)}>Retirar</Button></div>}
            </li>
          ))}</ul>
        )}
      </section>

      {d.years.length > 0 && (
        <section className="card overflow-x-auto" aria-label="Resumo por ano">
          <h2 className="p-4 pb-2 font-bold text-ink">Resumo por ano</h2>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted"><tr>
              <th className="px-4 py-2 font-semibold">Ano</th>{d.visible.contracts && <><th className="px-3 py-2 font-semibold">Mensal contratado</th><th className="px-3 py-2 font-semibold">Contratos ativos</th></>}
              {d.visible.opportunities && <th className="px-3 py-2 font-semibold">Oportunidades abertas · ganhas · perdidas</th>}<th className="px-3 py-2 font-semibold">Interações</th><th className="px-3 py-2 font-semibold">Ocorrências positivas · negativas</th>
            </tr></thead>
            <tbody className="divide-y divide-line">{[...d.years].reverse().map((y) => (
              <tr key={y.year}>
                <td className="num px-4 py-2 font-semibold text-ink">{y.year}{y.year === Number(d.today.slice(0, 4)) && <span className="ml-1 text-xs font-normal text-muted">(até hoje)</span>}</td>
                {d.visible.contracts && <><td className="num px-3 py-2">{y.activeContracts ? fmtBRL(y.monthlyCents) : '—'}</td><td className="num px-3 py-2">{y.activeContracts}</td></>}
                {d.visible.opportunities && <td className="num px-3 py-2">{y.opened} · <span className="text-success">{y.won}</span> · <span className="text-danger">{y.lost}</span></td>}
                <td className="num px-3 py-2">{y.interactions}</td>
                <td className="num px-3 py-2"><span className="text-success">{y.positive}</span> · <span className="text-danger">{y.negative}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="px-4 pb-3 pt-1 text-xs text-muted">Mensal e contratos ativos são a foto do último dia de cada ano (no ano atual, de hoje).</p>
        </section>
      )}

      {editing && <OccurrenceForm contactId={contactId} occurrence={editing === 'new' ? null : editing} evolution={d} onClose={() => setEditing(null)} />}
      {removing && <RemoveOccurrence contactId={contactId} o={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- linha do tempo

type Mark = { at: string; end?: string | null; label: string; color: string; title: string; to?: string; onClick?: () => void; shape?: 'bar' | 'dot' | 'diamond' };
const LABEL_W = 116, LANE_H = 46;

function Timeline({ d, lanes, onOccurrence }: { d: Evolution; lanes: Lane[]; onOccurrence: (o: Occurrence) => void }) {
  const nav = useNavigate();
  const [box, width] = useWidth<HTMLDivElement>(1000);
  const W = Math.max(width, 860);
  const all = useMemo(() => [
    ...d.contracts.flatMap((c) => [c.startAt, c.endAt]), ...d.opportunities.map((o) => o.createdOn), ...d.projects.flatMap((p) => [p.startOn, p.dueOn]),
    ...d.people.map((p) => p.on), ...d.occurrences.map((o) => o.occurredOn), ...Object.keys(d.interactionsByQuarter).map((k) => `${k.slice(0, 4)}-01-01`), d.today,
  ].filter((x): x is string => !!x), [d]);
  const y0 = Number(all.reduce((a, b) => (a < b ? a : b)).slice(0, 4));
  // até o fim do ano de hoje, ou do último fim de contrato/projeto (no máximo 2 anos à frente)
  const y1 = Math.min(Math.max(...all.map((x) => Number(x.slice(0, 4)))), Number(d.today.slice(0, 4)) + 2) + 1;
  const t = (iso: string) => { const [y, m, dd] = iso.split('-').map(Number) as [number, number, number]; return y + (m - 1) / 12 + (dd - 1) / 365; };
  const X = (iso: string) => LABEL_W + Math.max(0, Math.min(1, (t(iso) - y0) / (y1 - y0))) * (W - LABEL_W - 12);
  const shown = LANES.filter((l) => lanes.includes(l) && (l !== 'contratos' || d.visible.contracts) && (l !== 'oportunidades' || d.visible.opportunities) && (l !== 'projetos' || d.visible.projects));

  const marks: Record<Lane, Mark[]> = {
    contratos: d.contracts.filter((c) => c.startAt).flatMap((c) => {
      const end = [c.endAt, c.closedOn].filter((x): x is string => !!x).sort()[0] ?? d.today;
      return [
        { at: c.startAt!, end, label: `${c.number} · ${fmtBRL(c.monthlyCents)}/mês`, color: c.closedOn ? '#7A8792' : '#2F5986', shape: 'bar' as const, to: `/contracts/${c.id}`,
          title: `Contrato ${c.number}: ${c.object}\n${fmtDate(c.startAt)} a ${fmtDate(c.endAt)} · ${CONTRACT_STAGE_LABELS[c.stage as ContractStage] ?? c.stage}` },
        ...c.amendments.map((a) => ({ at: a.on, label: '', color: '#FFD166', shape: 'dot' as const, to: `/contracts/${c.id}`, title: `Aditivo ${a.number} (${AMENDMENT_LABELS[a.kind as AmendmentKind] ?? a.kind}) em ${fmtDate(a.on)}: ${a.description}` })),
        ...c.adjustments.map((a) => ({ at: a.on, label: '', color: '#4FBBFF', shape: 'dot' as const, to: `/contracts/${c.id}`, title: `Reajuste ${a.indexName} ${a.inputText}${a.mode === 'percentual' ? '%' : ''} (data-base ${fmtDate(a.on)})` })),
        ...c.occurrences.map((a) => ({ at: a.on, label: '', color: '#D23434', shape: 'dot' as const, to: `/contracts/${c.id}`, title: `${OCCURRENCE_LABELS[a.kind as OccurrenceKind] ?? a.kind} em ${fmtDate(a.on)}: ${a.title}` })),
      ];
    }),
    oportunidades: d.opportunities.map((o) => {
      const on = o.wonOn ?? o.lostOn ?? o.createdOn;
      const color = o.wonOn ? '#16A34A' : o.lostOn ? '#D23434' : '#2F5986';
      return { at: on, label: o.title, color, shape: 'dot' as const, to: `/opportunities/${o.id}`, title: `OP-${o.code} · ${o.title}\nCriada em ${fmtDate(o.createdOn)}${o.wonOn ? ` · venda fechada em ${fmtDate(o.wonOn)}` : o.lostOn ? ` · perdida em ${fmtDate(o.lostOn)}` : ` · ${STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage}`}${o.valueCents !== null ? ` · ${fmtBRL(o.valueCents)}` : ''}` };
    }),
    projetos: d.projects.map((p) => ({ at: p.startOn, end: p.doneOn ?? p.dueOn ?? d.today, label: p.name, color: '#8EA9C8', shape: 'bar' as const, to: `/projetos/${p.id}`, title: `${p.name}\n${fmtDate(p.startOn)} a ${fmtDate(p.doneOn ?? p.dueOn)}` })),
    pessoas: d.people.map((p) => ({
      at: p.on, shape: 'diamond' as const,
      color: p.change === 'saiu' ? '#D23434' : p.change === 'posicionamento' ? '#EA7A12' : '#16A34A',
      label: p.change === 'posicionamento' ? `${p.name}: ${p.detail?.split(' → ').map(stanceLabel).join(' → ')}` : `${p.change === 'saiu' ? '−' : '+'} ${p.name}`,
      title: `${p.name} ${p.change === 'entrou' ? 'mapeado(a)' : p.change === 'saiu' ? 'desativado(a)' : p.change === 'voltou' ? 'reativado(a)' : `mudou de posicionamento (${p.detail?.split(' → ').map(stanceLabel).join(' → ')})`} em ${fmtDate(p.on)}${p.detail && p.change === 'entrou' ? ` · ${p.detail}` : ''}`,
    })),
    ocorrencias: d.occurrences.map((o) => ({ at: o.occurredOn, label: o.title, color: IMPACT_COLOR[o.impact], shape: 'diamond' as const, onClick: () => onOccurrence(o), title: `${ACCOUNT_OCCURRENCE_KIND_LABELS[o.kind]} em ${fmtDate(o.occurredOn)}: ${o.title}` })),
    interacoes: [],
  };
  const maxQ = Math.max(1, ...Object.values(d.interactionsByQuarter));
  const H = 30 + shown.length * LANE_H + 18;
  const go = (m: Mark) => (m.onClick ? m.onClick() : m.to ? nav(m.to) : undefined);

  return (
    <div ref={box} className="mt-3 overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block select-none" role="group" aria-label="Linha do tempo da conta">
        {Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).map((y) => (
          <g key={y}><line x1={X(`${y}-01-01`)} x2={X(`${y}-01-01`)} y1={22} y2={H - 14} stroke="rgb(var(--line))" />{y < y1 && <text x={X(`${y}-01-01`) + 4} y={16} fontSize={11.5} fontWeight={700} fill="rgb(var(--ink))">{y}</text>}</g>
        ))}
        <line x1={X(d.today)} x2={X(d.today)} y1={22} y2={H - 14} stroke="rgb(var(--primary))" strokeDasharray="3 3" />
        <text x={X(d.today) + 3} y={H - 3} fontSize={10} fontWeight={700} fill="rgb(var(--primary))">hoje</text>
        {shown.map((lane, i) => {
          const top = 26 + i * LANE_H, mid = top + LANE_H / 2;
          return (
            <g key={lane}>
              <rect x={0} y={top} width={W} height={LANE_H} fill={i % 2 ? 'rgb(var(--surface-2))' : 'transparent'} />
              <text x={8} y={mid + 4} fontSize={12} fontWeight={600} fill="rgb(var(--ink))">{LANE_LABELS[lane]}</text>
              {lane === 'interacoes' ? Object.entries(d.interactionsByQuarter).map(([k, n]) => {
                const yr = k.slice(0, 4), qn = Number(k.slice(-1));
                const a = X(`${yr}-${String((qn - 1) * 3 + 1).padStart(2, '0')}-01`), b = qn === 4 ? X(`${Number(yr) + 1}-01-01`) : X(`${yr}-${String(qn * 3 + 1).padStart(2, '0')}-01`);
                const op = 0.15 + 0.85 * (n / maxQ);
                return <g key={k}><title>{`${n} interação(ões) concluída(s) no ${qn}º trimestre de ${yr}`}</title><rect x={a + 1} y={mid - 11} width={Math.max(2, b - a - 2)} height={22} rx={3} fill="rgb(var(--primary))" fillOpacity={op} />{b - a > 16 && <text x={(a + b) / 2} y={mid + 4} textAnchor="middle" fontSize={10} fill={op > 0.55 ? '#fff' : 'rgb(var(--ink))'}>{n}</text>}</g>;
              }) : marks[lane].map((m, j) => {
                const x = X(m.at);
                const common = { role: 'button', tabIndex: 0, className: 'cursor-pointer outline-none focus-visible:opacity-70', onClick: () => go(m), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(m); } }, 'aria-label': m.title.replace(/\n/g, ' · ') };
                if (m.shape === 'bar') {
                  const x2 = Math.max(x + 6, X(m.end ?? d.today));
                  const fits = m.label.length * 6.4 < x2 - x - 10;
                  return <g key={j} {...common}><title>{m.title}</title><rect x={x} y={mid - 12} width={x2 - x} height={24} rx={4} fill={m.color} />{fits ? <text x={x + 7} y={mid + 4} fontSize={11} fontWeight={600} fill="#fff">{m.label}</text> : null}</g>;
                }
                // marcas pontuais alternam acima/abaixo para não se sobreporem tanto
                const dy = m.label && j % 2 ? 9 : m.label ? -6 : 12;
                return (
                  <g key={j} {...common}>
                    <title>{m.title}</title>
                    {m.shape === 'diamond' ? <rect x={x - 5.5} y={mid + (m.label ? dy : 0) - 5.5} width={11} height={11} transform={`rotate(45 ${x} ${mid + (m.label ? dy : 0)})`} fill={m.color} />
                      : <circle cx={x} cy={m.label ? mid + dy : mid + dy} r={m.label ? 6 : 4.5} fill={m.color} stroke="#fff" strokeWidth={1.5} />}
                    {m.label && <text x={x + 9} y={mid + dy + 4} fontSize={10.5} fill="rgb(var(--text))">{m.label.length > 28 ? `${m.label.slice(0, 27)}…` : m.label}</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- registrar / editar / retirar

function OccurrenceForm({ contactId, occurrence: o, evolution, onClose }: { contactId: string; occurrence: Occurrence | null; evolution: Evolution; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const people = useQuery({ queryKey: ['account-stakeholders', contactId], queryFn: () => api<{ items: { id: string; name: string; title: string | null; active: boolean }[] }>(`/accounts/${contactId}/stakeholders`), retry: false });
  const [f, setF] = useState({
    kind: o?.kind ?? ('feedback_positivo' as AccountOccurrenceKind), occurredOn: o?.occurredOn ?? evolution.today, title: o?.title ?? '', description: o?.description ?? '',
    impact: o?.impact ?? DEFAULT_ACCOUNT_OCCURRENCE_IMPACT.feedback_positivo, channel: o?.channel ?? '', aspects: o?.aspects ?? [],
    stakeholderId: o?.stakeholderId ?? '', opportunityId: o?.opportunityId ?? '', contractId: o?.contractId ?? '',
    responseDueOn: o?.responseDueOn ?? '', respondedOn: o?.respondedOn ?? '', responseNote: o?.responseNote ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const showResponse = ACCOUNT_OCCURRENCE_NEEDS_RESPONSE.includes(f.kind) || !!f.responseDueOn || !!f.respondedOn;
  const m = useMutation({
    mutationFn: () => {
      const body = {
        kind: f.kind, occurredOn: f.occurredOn, title: f.title.trim(), description: f.description.trim() || null, impact: f.impact, channel: f.channel || null,
        aspects: f.kind === 'mudanca_negociacao' ? f.aspects : [], stakeholderId: f.stakeholderId || null, opportunityId: f.opportunityId || null, contractId: f.contractId || null,
        responseDueOn: showResponse ? f.responseDueOn || null : null, respondedOn: showResponse ? f.respondedOn || null : null, responseNote: showResponse ? f.responseNote.trim() || null : null,
      };
      return o ? api(`/account-occurrences/${o.id}`, { method: 'PATCH', body: { ...body, rowVersion: o.rowVersion } }) : api(`/accounts/${contactId}/occurrences`, { method: 'POST', body });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['account-evolution', contactId] }); toast({ tone: 'success', message: o ? 'Ocorrência atualizada' : 'Ocorrência registrada' }); onClose(); },
    onError: (e) => setErr(errMsg(e)),
  });
  const ready = f.title.trim().length >= 3 && !!f.occurredOn;
  return (
    <Modal open onClose={onClose} size="lg" title={o ? 'Editar ocorrência' : 'Registrar ocorrência'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ready} loading={m.isPending} onClick={() => { setErr(null); m.mutate(); }}>{o ? 'Salvar' : 'Registrar'}</Button></>}>
      <div className="space-y-3">
        {err && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="oc-k" hint={ACCOUNT_OCCURRENCE_KIND_HINTS[f.kind]}>
            <Select id="oc-k" value={f.kind} onChange={(e) => { const k = e.target.value as AccountOccurrenceKind; setF({ ...f, kind: k, impact: DEFAULT_ACCOUNT_OCCURRENCE_IMPACT[k] }); }}>
              {ACCOUNT_OCCURRENCE_KINDS.map((k) => <option key={k} value={k}>{ACCOUNT_OCCURRENCE_KIND_LABELS[k]}</option>)}
            </Select>
          </FormField>
          <FormField label="Data" htmlFor="oc-d" required><Input id="oc-d" type="date" max={evolution.today} value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} /></FormField>
        </div>
        <FormField label="Título" htmlFor="oc-t" required><Input id="oc-t" maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'feedback_positivo' ? 'Ex.: diretor de TI elogiou o tempo de atendimento' : f.kind === 'notificacao' ? 'Ex.: ofício cobrando prazo de instalação' : f.kind === 'mudanca_negociacao' ? 'Ex.: cliente reduziu o escopo para 4 unidades' : ''} /></FormField>
        <FormField label="Detalhes" htmlFor="oc-ds"><Textarea id="oc-ds" rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        {f.kind === 'mudanca_negociacao' && <ChipGroup legend="O que mudou" options={NEGOTIATION_ASPECTS} value={f.aspects} onChange={(v) => setF({ ...f, aspects: v })} labels={NEGOTIATION_ASPECT_LABELS} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Impacto na conta" htmlFor="oc-i" hint="Sugerido pelo tipo; ajuste se for o caso.">
            <Select id="oc-i" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as AccountOccurrenceImpact })}>{ACCOUNT_OCCURRENCE_IMPACTS.map((k) => <option key={k} value={k}>{ACCOUNT_OCCURRENCE_IMPACT_LABELS[k]}</option>)}</Select>
          </FormField>
          <FormField label="Como chegou" htmlFor="oc-c">
            <Select id="oc-c" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as AccountOccurrenceChannel | '' })}><option value="">Não informado</option>{ACCOUNT_OCCURRENCE_CHANNELS.map((k) => <option key={k} value={k}>{ACCOUNT_OCCURRENCE_CHANNEL_LABELS[k]}</option>)}</Select>
          </FormField>
          <FormField label="Pessoa envolvida" htmlFor="oc-p">
            <Select id="oc-p" value={f.stakeholderId} onChange={(e) => setF({ ...f, stakeholderId: e.target.value })}><option value="">Nenhuma</option>{(people.data?.items ?? []).filter((p) => p.active || p.id === f.stakeholderId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` · ${p.title}` : ''}</option>)}</Select>
          </FormField>
          {evolution.visible.opportunities && <FormField label="Oportunidade" htmlFor="oc-o">
            <Select id="oc-o" value={f.opportunityId} onChange={(e) => setF({ ...f, opportunityId: e.target.value })}><option value="">Nenhuma</option>{[...evolution.opportunities].reverse().map((x) => <option key={x.id} value={x.id}>OP-{x.code} · {x.title}</option>)}</Select>
          </FormField>}
          {evolution.visible.contracts && <FormField label="Contrato" htmlFor="oc-ct">
            <Select id="oc-ct" value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}><option value="">Nenhum</option>{[...evolution.contracts].reverse().map((x) => <option key={x.id} value={x.id}>{x.number}</option>)}</Select>
          </FormField>}
        </div>
        {showResponse ? (
          <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-ink">Resposta ao cliente</legend>
            <FormField label="Responder até" htmlFor="oc-rd"><Input id="oc-rd" type="date" min={f.occurredOn} value={f.responseDueOn} onChange={(e) => setF({ ...f, responseDueOn: e.target.value })} /></FormField>
            <FormField label="Respondida em" htmlFor="oc-ro"><Input id="oc-ro" type="date" min={f.occurredOn} max={evolution.today} value={f.respondedOn} onChange={(e) => setF({ ...f, respondedOn: e.target.value })} /></FormField>
            <FormField label="Como foi respondida" htmlFor="oc-rn" className="sm:col-span-2"><Input id="oc-rn" maxLength={2000} value={f.responseNote} onChange={(e) => setF({ ...f, responseNote: e.target.value })} /></FormField>
          </fieldset>
        ) : <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setF({ ...f, responseDueOn: evolution.today })}>Precisa de resposta ao cliente? Informar prazo</button>}
      </div>
    </Modal>
  );
}

function RemoveOccurrence({ contactId, o, onClose }: { contactId: string; o: Occurrence; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/account-occurrences/${o.id}/remove`, { method: 'POST', body: { reason: reason.trim(), rowVersion: o.rowVersion } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['account-evolution', contactId] }); toast({ tone: 'success', message: 'Ocorrência retirada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} size="sm" title="Retirar ocorrência" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Retirar</Button></>}>
      <p className="mb-3 text-sm text-text">“{o.title}” sai da conta, mas fica na auditoria com o motivo.</p>
      <FormField label="Motivo" htmlFor="oc-rm" required><Input id="oc-rm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: registrada na conta errada" /></FormField>
    </Modal>
  );
}
