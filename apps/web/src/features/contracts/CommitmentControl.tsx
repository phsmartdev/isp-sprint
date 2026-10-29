/**
 * Gestão de Contratos → Controle de Empenhos: a planilha de controle dentro do sistema, feita para qualquer pessoa ler.
 * Quatro números no topo (contratado, empenhado, executado, faturado), alertas em linguagem simples e, embaixo, itens,
 * empenhos, medições e pendências. Todo saldo é calculado pela API a partir do histórico; nada é digitado.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Plus, Receipt, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { LINE_CLASSES, LINE_CLASS_LABELS, MEASUREMENT_KINDS, MEASUREMENT_KIND_LABELS, REVISION_REASONS, REVISION_REASON_LABELS, fillSheetPrices, parseCommitmentSheet, type LineClass, type MeasurementKind, type SheetMeasurement, type SheetRow } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Bal = { contracted4: number; committed4: number; executed4: number; pending4: number; reserved4: number; invoiced4: number; available4: number; toCommit4: number; commitmentBalance4: number; uncovered4: number };
type Line = { id: string; itemNumber: string; arpItemNumber: string | null; description: string; unit: string; classification: LineClass; qty4: number; price4: number; monthlyQty4: number | null; valueV4: number; balance: Bal; reservations: { opportunityId: string; code: number; title: string; stage: string; qty4: number }[]; measured: { measurementId: string; qty4: number }[] };
type CItem = { id: string; lineId: string; code: string | null; itemNumber: string | null; qty4: number; adjust4: number; balance4: number; valueV4: number; balanceV4: number; moves: { id: string; kind: string; qty4: number; occurredOn: string; reason: string }[] };
type Commitment = { id: string; number: string; fiscalYear: number; issuedOn: string; source: string | null; cancelledAt: string | null; cancelReason: string | null; valueV4: number; balanceV4: number; items: CItem[] };
type MItem = { lineId: string; qty4: number; price4: number; valueV4: number; allocations: { commitmentItemId: string; qty4: number }[]; uncovered4: number };
type Measurement = { id: string; groupId: string; version: number; superseded: boolean; competence: string; kind: MeasurementKind; title: string; status: string; statusLabel: string; opportunityId: string | null; revisionReasonLabel: string | null; revisionNote: string | null; invoiceNumber: string | null; invoiceDate: string | null; invoiceCents: number | null; attestedAt: string | null; createdAt: string; valueV4: number; uncoveredV4: number; items: MItem[] };
type Data = {
  contract: { id: string; code: number; kind: string; number: string | null; object: string | null; startAt: string | null; endAt: string | null; totalCents: number | null; commitmentBlock: boolean };
  lines: Line[]; commitments: Commitment[]; measurements: Measurement[];
  pendencias: { kind: string; label: string; measurementId: string; title: string; competence: string; valueV4: number; since: string }[];
  totals: { contracted: number; committed: number; executed: number; pending: number; reserved: number; invoiced: number; available: number; toCommit: number; commitmentBalance: number; uncovered: number; executionPct: number | null; committedPct: number | null };
  alerts: { level: 'alto' | 'medio' | 'info'; key: string; text: string }[];
  canManage: boolean; today: string; globalCheck: { itemsCents: number; globalCents: number; diffCents: number } | null;
};

const qty = (q4: number) => (q4 / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const money = (v4: number) => (v4 / 10_000).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pctOf = (a: number, b: number) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
const parseNum = (t: string) => { const s = t.trim(); if (!s) return null; const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'yellow' | 'red'> = { elaboracao: 'neutral', enviada: 'blue', atestada: 'yellow', faturada: 'green', cancelada: 'red' };
const monthLabel = (c: string) => new Date(`${c}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

export function CommitmentControl({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['commitment-control', contractId], queryFn: () => api<Data>(`/contracts/${contractId}/commitment-control`) });
  const [tab, setTab] = useState<'itens' | 'empenhos' | 'medicoes' | 'pendencias'>('itens');
  const [view, setView] = useState<'qtd' | 'valor'>('qtd');
  const [modal, setModal] = useState<null | 'import' | 'medicao' | 'empenho' | 'itens'>(null);
  const [line, setLine] = useState<Line | null>(null);
  if (q.isLoading || !q.data) return <div className="card p-5"><LoadingRows /></div>;
  const d = q.data;
  const t = d.totals;
  const notInvoiced = Math.max(0, t.executed - t.invoiced);
  const empty = !d.lines.length;
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Controle de Empenhos</h2>
            <p className="max-w-3xl text-sm text-muted">Itens do contrato, notas de empenho (NE) e medições. O saldo é calculado sozinho: cada medição tira do item do contrato e do empenho mais antigo do ano.</p>
          </div>
          {d.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setModal('import')}>Importar planilha</Button>
              {!empty && <Button size="sm" icon={<Receipt className="h-4 w-4" />} onClick={() => setModal('empenho')}>Registrar empenho</Button>}
              {!empty && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('medicao')}>Nova medição</Button>}
            </div>
          )}
        </div>
        {empty ? (
          <div className="mt-4"><EmptyState title="Ainda sem itens neste contrato" description="Importe a planilha de controle (itens, empenhos e medições) ou inclua os itens um a um." action={d.canManage ? <div className="flex gap-2"><Button variant="primary" onClick={() => setModal('import')}>Importar planilha</Button><Button onClick={() => setModal('itens')}>Incluir itens</Button></div> : undefined} /></div>
        ) : (
          <>
            {/* os quatro números */}
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Big label="Contratado" value={money(t.contracted)} hint="Valor total dos itens do contrato" />
              <Big label="Empenhado" value={money(t.committed)} hint={t.toCommit > 0 ? `Falta empenhar ${money(t.toCommit)}` : 'Todo o contrato tem empenho'} warn={t.toCommit > 0} />
              <Big label="Executado" value={money(t.executed + t.pending)} hint={`${(t.executionPct ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do contrato${t.pending ? ` · ${money(t.pending)} em medição aberta` : ''}`} />
              <Big label="Faturado" value={money(t.invoiced)} hint={notInvoiced > 0 ? `${money(notInvoiced)} medido e ainda sem nota` : 'Tudo o que foi atestado tem nota'} warn={notInvoiced > 0} />
            </dl>
            {/* barra do contrato */}
            <div className="mt-4">
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="bg-success" style={{ width: `${pctOf(t.invoiced, t.contracted)}%` }} />
                <span className="bg-[#F59E0B]" style={{ width: `${pctOf(notInvoiced, t.contracted)}%` }} />
                <span className="bg-primary/60" style={{ width: `${pctOf(t.pending, t.contracted)}%` }} />
                <span className="bg-[#8B5CF6]/60" style={{ width: `${pctOf(t.reserved, t.contracted)}%` }} />
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text">
                <Legend cls="bg-success" label="Faturado" value={money(t.invoiced)} />
                <Legend cls="bg-[#F59E0B]" label="Atestado sem nota" value={money(notInvoiced)} />
                <Legend cls="bg-primary/60" label="Medição aberta" value={money(t.pending)} />
                <Legend cls="bg-[#8B5CF6]/60" label="Reservado na pipeline" value={money(t.reserved)} />
                <Legend cls="bg-surface-2 border border-line" label="Livre" value={money(Math.max(0, t.available))} />
              </p>
            </div>
            {!!d.alerts.length && (
              <ul className="mt-4 space-y-1.5" aria-label="Alertas">
                {d.alerts.map((a) => (
                  <li key={a.key} className={clsx('flex items-start gap-2 rounded-sm px-3 py-2 text-sm', a.level === 'alto' ? 'bg-danger-soft text-ink' : a.level === 'medio' ? 'bg-warning-soft text-ink' : 'bg-surface-2 text-text')}>
                    {a.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> : <AlertTriangle className={clsx('mt-0.5 h-4 w-4 shrink-0', a.level === 'alto' ? 'text-danger' : 'text-[#C2610C]')} aria-hidden />}{a.text}
                  </li>
                ))}
              </ul>
            )}
            {d.globalCheck && Math.abs(d.globalCheck.diffCents) > 100 && <p className="mt-2 text-xs text-[#C2610C]">A soma dos itens ({money(d.globalCheck.itemsCents * 100)}) difere do valor global do contrato ({money(d.globalCheck.globalCents * 100)}).</p>}
          </>
        )}
      </section>

      {!empty && (
        <section className="card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 pt-3">
            <div role="tablist" aria-label="Controle de empenhos" className="flex gap-5">
              {([['itens', 'Itens', d.lines.length], ['empenhos', 'Empenhos', d.commitments.length], ['medicoes', 'Medições', d.measurements.filter((m) => !m.superseded).length], ['pendencias', 'Pendências', d.pendencias.length]] as const).map(([k, l, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 pb-2.5 text-sm font-semibold', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>{l} <span className={clsx('ml-1 rounded-full px-1.5 text-2xs', k === 'pendencias' && n ? 'bg-danger text-white' : 'bg-surface-2 text-muted')}>{n}</span></button>
              ))}
            </div>
            {tab === 'itens' && (
              <div className="mb-2 flex items-center gap-2">
                <div className="flex border border-line text-xs font-semibold" role="group" aria-label="Mostrar">
                  {(['qtd', 'valor'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={clsx('px-2.5 py-1', view === v ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{v === 'qtd' ? 'Quantidade' : 'Valor (R$)'}</button>)}
                </div>
                {d.canManage && <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('itens')}>Incluir itens</Button>}
              </div>
            )}
          </div>
          {tab === 'itens' && <LinesTable d={d} view={view} onOpen={setLine} />}
          {tab === 'empenhos' && <Commitments d={d} contractId={contractId} />}
          {tab === 'medicoes' && <Measurements d={d} contractId={contractId} />}
          {tab === 'pendencias' && <Pendencias d={d} contractId={contractId} />}
        </section>
      )}

      {d.canManage && !empty && (
        <BlockSetting contractId={contractId} value={d.contract.commitmentBlock} />
      )}

      {line && <LineDrawer d={d} line={line} onClose={() => setLine(null)} />}
      {modal === 'import' && <ImportModal contractId={contractId} onClose={() => setModal(null)} />}
      {modal === 'itens' && <LinesModal contractId={contractId} onClose={() => setModal(null)} />}
      {modal === 'empenho' && <CommitmentModal d={d} contractId={contractId} onClose={() => setModal(null)} />}
      {modal === 'medicao' && <MeasurementModal d={d} contractId={contractId} onClose={() => setModal(null)} />}
    </div>
  );
}

function Big({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="border border-line p-3">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className="num mt-0.5 text-xl font-bold text-ink">{value}</dd>
      <dd className={clsx('mt-0.5 text-xs', warn ? 'font-semibold text-[#C2610C]' : 'text-muted')}>{hint}</dd>
    </div>
  );
}
const Legend = ({ cls, label, value }: { cls: string; label: string; value: string }) => <span className="flex items-center gap-1.5"><span className={clsx('h-2.5 w-2.5 rounded-sm', cls)} aria-hidden />{label} <b className="num">{value}</b></span>;

function useRefresh(contractId: string) {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['commitment-control', contractId] }); qc.invalidateQueries({ queryKey: ['contract', contractId] }); };
}

// ------------------------------------------------------------------ itens (a planilha)
function LinesTable({ d, view, onOpen }: { d: Data; view: 'qtd' | 'valor'; onOpen: (l: Line) => void }) {
  const fmt = (l: Line, q4: number) => (view === 'qtd' ? qty(q4) : money(Math.round((q4 * l.price4) / 10_000)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead><tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-muted">
          <th className="px-3 py-2">Item</th><th className="px-3 py-2">Especificação</th><th className="px-3 py-2">Un.</th>
          <th className="px-3 py-2 text-right">Contratado</th><th className="px-3 py-2 text-right">Empenhado</th><th className="px-3 py-2 text-right">Medido</th><th className="px-3 py-2 text-right" title="Reservado pelas oportunidades em andamento">Pipeline</th>
          <th className="px-3 py-2 text-right">Saldo do contrato</th><th className="px-3 py-2 text-right">Saldo do empenho</th><th className="px-3 py-2 text-right">Falta empenhar</th>
        </tr></thead>
        <tbody>{d.lines.map((l) => {
          const b = l.balance;
          const used = b.executed4 + b.pending4;
          return (
            <tr key={l.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => onOpen(l)}>
              <td className="px-3 py-2.5 font-semibold text-ink">{l.itemNumber}{l.arpItemNumber && <span className="block text-2xs font-normal text-muted">ARP {l.arpItemNumber}</span>}</td>
              <td className="max-w-[320px] px-3 py-2.5"><p className="line-clamp-2 text-ink" title={l.description}>{l.description}</p><span className="text-2xs text-muted">{LINE_CLASS_LABELS[l.classification]} · {money(l.price4)} por {l.unit.toLowerCase()}</span></td>
              <td className="px-3 py-2.5 text-text">{l.unit}</td>
              <td className="num px-3 py-2.5 text-right text-ink">{fmt(l, b.contracted4)}</td>
              <td className="num px-3 py-2.5 text-right text-ink">{fmt(l, b.committed4)}</td>
              <td className="num px-3 py-2.5 text-right text-ink">{fmt(l, used)}<span className="block text-2xs text-muted">{pctOf(used, b.contracted4).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span></td>
              <td className={clsx('num px-3 py-2.5 text-right', b.reserved4 ? 'text-[#7C3AED]' : 'text-muted')}>{b.reserved4 ? fmt(l, b.reserved4) : '—'}</td>
              <td className={clsx('num px-3 py-2.5 text-right font-semibold', b.available4 <= 0 ? 'text-danger' : 'text-ink')}>{fmt(l, b.available4)}</td>
              <td className={clsx('num px-3 py-2.5 text-right', b.uncovered4 ? 'font-semibold text-danger' : 'text-ink')}>{fmt(l, b.commitmentBalance4)}{b.uncovered4 > 0 && <span className="block text-2xs">{qty(b.uncovered4)} sem empenho</span>}</td>
              <td className={clsx('num px-3 py-2.5 text-right', b.toCommit4 > 0 ? 'text-[#C2610C]' : 'text-muted')}>{b.toCommit4 > 0 ? fmt(l, b.toCommit4) : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="px-4 py-2 text-xs text-muted">Clique num item para ver o extrato: cada medição, cada empenho e as oportunidades que reservaram saldo.</p>
    </div>
  );
}

function LineDrawer({ d, line, onClose }: { d: Data; line: Line; onClose: () => void }) {
  const ms = d.measurements.filter((m) => m.items.some((x) => x.lineId === line.id)).sort((a, b) => b.competence.localeCompare(a.competence) || b.version - a.version);
  const cis = d.commitments.flatMap((c) => c.items.filter((i) => i.lineId === line.id).map((i) => ({ c, i })));
  return (
    <Drawer open onClose={onClose} title={`Item ${line.itemNumber}`} width="lg">
      <p className="text-sm text-text">{line.description}</p>
      <p className="mt-1 text-xs text-muted">{LINE_CLASS_LABELS[line.classification]} · {qty(line.qty4)} {line.unit} × {money(line.price4)} = {money(line.valueV4)}{line.monthlyQty4 ? ` · mensal ${qty(line.monthlyQty4)}` : ''}</p>
      <h3 className="mt-4 text-sm font-bold text-ink">Empenhos deste item</h3>
      {!cis.length ? <p className="text-sm text-[#C2610C]">Sem empenho: tudo o que for medido fica aguardando NE.</p> : (
        <ul className="mt-1 divide-y divide-line border border-line">{cis.map(({ c, i }) => <li key={i.id} className={clsx('flex items-center justify-between gap-2 px-3 py-2 text-sm', c.cancelledAt && 'opacity-50')}><span><b>{c.number}</b>{i.code ? ` · código ${i.code}` : ''}{c.cancelledAt ? ' · anulado' : ''}</span><span className="num text-right">{qty(i.qty4 + i.adjust4)} empenhado · <b>{qty(i.balance4)}</b> de saldo</span></li>)}</ul>
      )}
      <h3 className="mt-4 text-sm font-bold text-ink">Medições</h3>
      {!ms.length ? <p className="text-sm text-muted">Nenhuma medição ainda.</p> : (
        <table className="mt-1 w-full text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Medição</th><th className="py-1 text-right font-medium">Qtde</th><th className="py-1 text-right font-medium">Valor</th><th className="py-1 text-right font-medium">Situação</th></tr></thead>
          <tbody>{ms.map((m) => { const x = m.items.find((y) => y.lineId === line.id)!; return (
            <tr key={m.id} className={clsx('border-t border-line', (m.superseded || m.status === 'cancelada') && 'text-muted line-through')}>
              <td className="py-1.5">{m.title}<span className="block text-2xs text-muted no-underline">{monthLabel(m.competence)}{m.version > 1 ? ` · versão ${m.version}` : ''}</span></td>
              <td className="num py-1.5 text-right">{qty(x.qty4)}</td><td className="num py-1.5 text-right">{money(x.valueV4)}</td>
              <td className="py-1.5 text-right"><Chip tone={m.superseded ? 'neutral' : STATUS_TONE[m.status]}>{m.superseded ? 'Revisada' : m.statusLabel}</Chip></td>
            </tr>
          ); })}</tbody>
        </table>
      )}
      {!!line.reservations.length && (
        <>
          <h3 className="mt-4 text-sm font-bold text-ink">Reservado na pipeline</h3>
          <ul className="mt-1 space-y-1 text-sm">{line.reservations.map((r) => <li key={r.opportunityId}><Link className="link" to={`/opportunities/${r.opportunityId}`}>OP-{r.code} · {r.title}</Link> — {qty(r.qty4)} {line.unit}</li>)}</ul>
        </>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ empenhos
function Commitments({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const [move, setMove] = useState<{ item: CItem; c: Commitment } | null>(null);
  const lineOf = (id: string) => d.lines.find((l) => l.id === id);
  if (!d.commitments.length) return <div className="p-5"><EmptyState title="Nenhum empenho" description="Registre a NE com os itens que ela cobre. Sem empenho, as medições ficam como pendência." /></div>;
  return (
    <div className="grid grid-cols-1 gap-3 p-4 xl:grid-cols-2">
      {d.commitments.map((c) => (
        <article key={c.id} className={clsx('border border-line p-3', c.cancelledAt && 'opacity-60')}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-bold text-ink">{c.number}</p><p className="text-xs text-muted">Exercício {c.fiscalYear} · emitido em {fmtDate(c.issuedOn)}{c.source ? ` · ${c.source}` : ''}</p></div>
            {c.cancelledAt ? <Chip tone="red">Anulado</Chip> : c.fiscalYear < Number(d.today.slice(0, 4)) ? <Chip tone="yellow">Exercício anterior</Chip> : <Chip tone="green">Ativo</Chip>}
          </div>
          <div className="mt-2 flex items-baseline justify-between text-sm"><span className="text-muted">Empenhado</span><span className="num font-semibold">{money(c.valueV4)}</span></div>
          <div className="flex items-baseline justify-between text-sm"><span className="text-muted">Saldo</span><span className={clsx('num font-bold', c.balanceV4 <= 0 ? 'text-muted' : 'text-ink')}>{money(c.balanceV4)}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-primary" style={{ width: `${pctOf(c.valueV4 - c.balanceV4, c.valueV4)}%` }} /></div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-primary">{c.items.length} item(ns) da nota</summary>
            <ul className="mt-1 divide-y divide-line text-xs">{c.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">Item {lineOf(i.lineId)?.itemNumber}{i.code ? ` · ${i.code}` : ''} · {lineOf(i.lineId)?.description}</span>
                <span className="num">{qty(i.qty4 + i.adjust4)} · saldo <b>{qty(i.balance4)}</b></span>
                {d.canManage && !c.cancelledAt && <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMove({ item: i, c })}>Reforçar / anular</button>}
              </li>
            ))}</ul>
          </details>
        </article>
      ))}
      {move && <MoveModal contractId={contractId} item={move.item} c={move.c} line={lineOf(move.item.lineId)!} onClose={() => setMove(null)} onDone={() => { refresh(); toast({ tone: 'success', message: 'Movimentação registrada' }); setMove(null); }} />}
    </div>
  );
}

function MoveModal({ contractId, item, c, line, onClose, onDone }: { contractId: string; item: CItem; c: Commitment; line: Line; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ kind: 'anulacao' as 'reforco' | 'anulacao', qty: '', occurredOn: new Date().toISOString().slice(0, 10), reason: '' });
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/commitment-items/${item.id}/moves`, { method: 'POST', body: { ...v, qty: parseNum(v.qty) } }), onSuccess: onDone, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`${c.number} · item ${line.itemNumber}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!parseNum(v.qty) || v.reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button></>}>
      <p className="mb-3 text-sm text-muted">Saldo deste item na nota: {qty(item.balance4)} {line.unit}. Use anulação na virada do exercício (o saldo é suprimido e reempenhado na NE do ano novo).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Movimentação" htmlFor="mv-k"><Select id="mv-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}><option value="anulacao">Anulação parcial / supressão</option><option value="reforco">Reforço</option></Select></FormField>
        <FormField label={`Quantidade (${line.unit})`} htmlFor="mv-q"><Input id="mv-q" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></FormField>
        <FormField label="Data" htmlFor="mv-d"><Input id="mv-d" type="date" value={v.occurredOn} onChange={(e) => setV({ ...v, occurredOn: e.target.value })} /></FormField>
        <FormField label="Justificativa" htmlFor="mv-r" className="sm:col-span-2"><Textarea id="mv-r" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ medições
function Measurements({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const [showOld, setShowOld] = useState(false);
  const [invoice, setInvoice] = useState<Measurement | null>(null);
  const [revise, setRevise] = useState<Measurement | null>(null);
  const [edit, setEdit] = useState<Measurement | null>(null);
  const act = useMutation({ mutationFn: (x: { m: Measurement; action: string; reason?: string }) => api(`/contracts/${contractId}/measurements/${x.m.id}/status`, { method: 'POST', body: { action: x.action, reason: x.reason } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Medição atualizada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const list = d.measurements.filter((m) => showOld || !m.superseded).sort((a, b) => b.competence.localeCompare(a.competence) || b.createdAt.localeCompare(a.createdAt));
  const byComp = [...new Set(list.map((m) => m.competence))];
  const revised = d.measurements.filter((m) => m.version > 1 && !m.superseded).length;
  if (!d.measurements.length) return <div className="p-5"><EmptyState title="Nenhuma medição" description="Use “Nova medição” todo mês (franquia) e a cada serviço avulso. Vendas ganhas na pipeline criam a medição sozinhas." /></div>;
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">{revised ? `${revised} medição(ões) revisada(s)` : 'Nenhuma medição revisada'}</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />Mostrar versões anteriores (revisadas)</label>
      </div>
      {byComp.map((comp) => (
        <div key={comp} className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted">{monthLabel(comp)}</h3>
          <ul className="space-y-2">{list.filter((m) => m.competence === comp).map((m) => (
            <li key={m.id} className={clsx('border border-line p-3', (m.superseded || m.status === 'cancelada') && 'opacity-60')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{m.title}{m.version > 1 && <span className="ml-1.5 text-xs font-normal text-muted">versão {m.version}</span>}</p>
                  <p className="text-xs text-muted">{MEASUREMENT_KIND_LABELS[m.kind]} · {m.items.length} item(ns){m.opportunityId ? <> · <Link className="link" to={`/opportunities/${m.opportunityId}`}>da pipeline</Link></> : ''}{m.invoiceNumber ? ` · NF ${m.invoiceNumber} de ${fmtDate(m.invoiceDate)}` : ''}</p>
                  {m.revisionReasonLabel && <p className="text-xs text-[#C2610C]">Revisada: {m.revisionReasonLabel} — {m.revisionNote}</p>}
                </div>
                <div className="text-right">
                  <p className="num font-bold text-ink">{money(m.valueV4)}</p>
                  <div className="mt-0.5 flex flex-wrap justify-end gap-1">{m.superseded ? <Chip>Substituída</Chip> : <Chip tone={STATUS_TONE[m.status]}>{m.statusLabel}</Chip>}{m.uncoveredV4 > 0 && !m.superseded && <Chip tone="red">{money(m.uncoveredV4)} sem empenho</Chip>}</div>
                </div>
              </div>
              {d.canManage && !m.superseded && m.status !== 'cancelada' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.status === 'elaboracao' && <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Editar</Button>}
                  {m.status === 'elaboracao' && <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => act.mutate({ m, action: 'enviar' })}>Enviar ao órgão</Button>}
                  {['elaboracao', 'enviada'].includes(m.status) && <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => act.mutate({ m, action: 'atestar' })}>Atestada</Button>}
                  {m.status === 'atestada' && <Button size="sm" variant="primary" icon={<Receipt className="h-4 w-4" />} onClick={() => setInvoice(m)}>Faturar (NF)</Button>}
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRevise(m)}>Revisar</Button>
                  {['elaboracao', 'enviada'].includes(m.status) && <Button size="sm" variant="ghost" onClick={() => { const r = prompt('Motivo do cancelamento'); if (r && r.trim().length >= 5) act.mutate({ m, action: 'cancelar', reason: r }); }}>Cancelar</Button>}
                </div>
              )}
            </li>
          ))}</ul>
        </div>
      ))}
      {invoice && <InvoiceModal contractId={contractId} m={invoice} onClose={() => setInvoice(null)} />}
      {revise && <MeasurementModal d={d} contractId={contractId} revise={revise} onClose={() => setRevise(null)} />}
      {edit && <MeasurementModal d={d} contractId={contractId} edit={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function InvoiceModal({ contractId, m, onClose }: { contractId: string; m: Measurement; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const [v, setV] = useState({ invoiceNumber: '', invoiceDate: new Date().toISOString().slice(0, 10), value: (m.valueV4 / 10_000).toFixed(2).replace('.', ',') });
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/measurements/${m.id}/status`, { method: 'POST', body: { action: 'faturar', invoiceNumber: v.invoiceNumber, invoiceDate: v.invoiceDate, invoiceCents: Math.round((parseNum(v.value) ?? 0) * 100) } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Faturada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`Faturar · ${m.title}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.invoiceNumber.trim()} loading={save.isPending} onClick={() => save.mutate()}>Registrar nota</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Nº da NF" htmlFor="nf-n"><Input id="nf-n" value={v.invoiceNumber} onChange={(e) => setV({ ...v, invoiceNumber: e.target.value })} /></FormField>
        <FormField label="Data" htmlFor="nf-d"><Input id="nf-d" type="date" value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} /></FormField>
        <FormField label="Valor (R$)" htmlFor="nf-v" hint="2 casas; vem da medição"><Input id="nf-v" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

/** Nova medição, edição (em elaboração) ou revisão (nova versão com motivo). */
function MeasurementModal({ d, contractId, onClose, revise, edit }: { d: Data; contractId: string; onClose: () => void; revise?: Measurement; edit?: Measurement }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const base = revise ?? edit;
  const [v, setV] = useState({ competence: base?.competence ?? d.today.slice(0, 7), kind: (base?.kind ?? 'mensal') as MeasurementKind, title: base?.title ?? `Medição ${monthLabel(d.today.slice(0, 7))}`, reason: 'erro_quantidade', note: '' });
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries((base?.items ?? []).map((x) => [x.lineId, String(x.qty4 / 10_000).replace('.', ',')])));
  const [filter, setFilter] = useState('');
  const fillMonthly = () => setQtys((q) => ({ ...q, ...Object.fromEntries(d.lines.filter((l) => l.classification === 'recorrente' && l.monthlyQty4).map((l) => [l.id, String(l.monthlyQty4! / 10_000).replace('.', ',')])) }));
  const items = Object.entries(qtys).map(([lineId, s]) => ({ lineId, qty: parseNum(s) })).filter((x): x is { lineId: string; qty: number } => !!x.qty && x.qty > 0);
  const total = items.reduce((a, x) => a + Math.round(x.qty * (d.lines.find((l) => l.id === x.lineId)?.price4 ?? 0)), 0);
  const save = useMutation({
    mutationFn: () => (revise ? api(`/contracts/${contractId}/measurements/${revise.id}/revise`, { method: 'POST', body: { reason: v.reason, note: v.note, items } })
      : edit ? api(`/contracts/${contractId}/measurements/${edit.id}`, { method: 'PATCH', body: { title: v.title, items } })
        : api<{ uncoveredV4: number }>(`/contracts/${contractId}/measurements`, { method: 'POST', body: { competence: v.competence, kind: v.kind, title: v.title, items } })),
    onSuccess: (r) => { refresh(); const u = (r as { uncoveredV4?: number; invoiceCorrection?: boolean }); toast({ tone: u.uncoveredV4 ? 'warning' as 'success' : 'success', message: revise ? (u.invoiceCorrection ? 'Revisada. A medição já tinha NF: emita carta de correção ou NF complementar.' : 'Revisada: nova versão registrada') : u.uncoveredV4 ? `Medição registrada com ${money(u.uncoveredV4)} aguardando empenho` : 'Medição registrada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const shown = d.lines.filter((l) => !filter.trim() || `${l.itemNumber} ${l.description}`.toLowerCase().includes(filter.toLowerCase()) || qtys[l.id]);
  return (
    <Modal open onClose={onClose} size="xl" title={revise ? `Revisar · ${revise.title}` : edit ? `Editar · ${edit.title}` : 'Nova medição'}
      footer={<><span className="mr-auto text-sm text-text">Total: <b className="num">{money(total)}</b> · {items.length} item(ns)</span><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!items.length || (!!revise && v.note.trim().length < 10)} loading={save.isPending} onClick={() => save.mutate()}>{revise ? 'Registrar revisão' : 'Salvar medição'}</Button></>}>
      {revise && (
        <div className="mb-3 grid gap-3 border border-warning/40 bg-warning-soft/40 p-3 sm:grid-cols-[220px_1fr]">
          <FormField label="Motivo" htmlFor="rv-r"><Select id="rv-r" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>{REVISION_REASONS.map((r) => <option key={r} value={r}>{REVISION_REASON_LABELS[r]}</option>)}</Select></FormField>
          <FormField label="Justificativa" htmlFor="rv-n" hint="A versão anterior fica no histórico"><Input id="rv-n" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></FormField>
        </div>
      )}
      {!revise && (
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <FormField label="Competência" htmlFor="ms-c"><Input id="ms-c" type="month" disabled={!!edit} value={v.competence} onChange={(e) => setV({ ...v, competence: e.target.value })} /></FormField>
          <FormField label="Tipo" htmlFor="ms-k"><Select id="ms-k" disabled={!!edit} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as MeasurementKind })}>{MEASUREMENT_KINDS.map((k) => <option key={k} value={k}>{MEASUREMENT_KIND_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Descrição" htmlFor="ms-t"><Input id="ms-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Ex.: 1ª migração das escolas" /></FormField>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input aria-label="Filtrar itens" className="h-9 max-w-xs" placeholder="Filtrar item…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {d.lines.some((l) => l.classification === 'recorrente' && l.monthlyQty4) && <Button size="sm" variant="ghost" onClick={fillMonthly}>Preencher a franquia mensal</Button>}
        <span className="text-xs text-muted">Informe só a quantidade medida; o sistema calcula o valor e tira do empenho mais antigo do ano.</span>
      </div>
      <div className="max-h-[50vh] overflow-auto border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Especificação</th><th className="px-2 py-1.5 text-right">Saldo do contrato</th><th className="px-2 py-1.5 text-right">Saldo do empenho</th><th className="w-32 px-2 py-1.5 text-right">Qtde medida</th><th className="px-2 py-1.5 text-right">Valor</th></tr></thead>
          <tbody>{shown.map((l) => {
            const own = base?.items.find((x) => x.lineId === l.id)?.qty4 ?? 0;
            const free = l.balance.available4 + (base && base.status !== 'cancelada' ? own : 0);
            const n = parseNum(qtys[l.id] ?? '');
            const over = n != null && n * 10_000 > free + 0.5;
            const noNe = n != null && n * 10_000 > l.balance.commitmentBalance4 + own;
            return (
              <tr key={l.id} className="border-t border-line">
                <td className="px-2 py-1.5 font-semibold">{l.itemNumber}</td>
                <td className="max-w-[340px] px-2 py-1.5"><span className="line-clamp-1" title={l.description}>{l.description}</span><span className="text-2xs text-muted">{l.unit} · {money(l.price4)}</span></td>
                <td className="num px-2 py-1.5 text-right">{qty(free)}</td>
                <td className="num px-2 py-1.5 text-right">{qty(l.balance.commitmentBalance4 + own)}</td>
                <td className="px-2 py-1.5"><Input aria-label={`Quantidade do item ${l.itemNumber}`} inputMode="decimal" className={clsx('num h-8 text-right', over && 'border-danger')} value={qtys[l.id] ?? ''} onChange={(e) => setQtys({ ...qtys, [l.id]: e.target.value })} />
                  {over ? <span className="block text-2xs text-danger">passa do contrato</span> : noNe ? <span className="block text-2xs text-[#C2610C]">parte sem empenho</span> : null}</td>
                <td className="num px-2 py-1.5 text-right">{n ? money(Math.round(n * l.price4)) : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ pendências
function Pendencias({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const cover = useMutation({ mutationFn: () => api<{ coveredV4: number }>(`/contracts/${contractId}/commitment-control/cover`, { method: 'POST' }), onSuccess: (r) => { refresh(); toast({ tone: 'success', message: r.coveredV4 ? `${money(r.coveredV4)} cobertos pelos empenhos` : 'Nenhum empenho com saldo para cobrir' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (!d.pendencias.length) return <div className="p-5"><EmptyState icon={<CheckCircle2 className="h-8 w-8 text-success" />} title="Sem pendências" description="Tudo o que foi executado tem empenho e nota fiscal." /></div>;
  const total = d.pendencias.reduce((a, p) => a + p.valueV4, 0);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">Em risco: <b className="num">{money(total)}</b></p>
        {d.canManage && d.pendencias.some((p) => p.kind === 'aguardando_empenho') && <Button size="sm" loading={cover.isPending} onClick={() => cover.mutate()}>Cobrir com os empenhos disponíveis</Button>}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="py-1.5">Tipo</th><th className="py-1.5">Medição</th><th className="py-1.5">Competência</th><th className="py-1.5 text-right">Há</th><th className="py-1.5 text-right">Valor</th></tr></thead>
        <tbody>{d.pendencias.sort((a, b) => a.since.localeCompare(b.since)).map((p) => (
          <tr key={p.kind + p.measurementId} className="border-t border-line">
            <td className="py-2"><Chip tone={p.kind === 'aguardando_empenho' ? 'red' : 'yellow'}>{p.label}</Chip></td>
            <td className="py-2">{p.title}</td><td className="py-2">{monthLabel(p.competence)}</td>
            <td className={clsx('num py-2 text-right', days(p.since) > 60 ? 'font-semibold text-danger' : '')}>{days(p.since)} dia(s)</td>
            <td className="num py-2 text-right font-semibold">{money(p.valueV4)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ cadastro e importação
function LinesModal({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const blank = { itemNumber: '', description: '', unit: 'UNIDADE', classification: 'demanda' as LineClass, qty: '', price: '', monthlyQty: '' };
  const [rows, setRows] = useState([blank]);
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/lines`, { method: 'POST', body: { items: rows.filter((r) => r.description.trim()).map((r) => ({ itemNumber: r.itemNumber.trim(), description: r.description.trim(), unit: r.unit.trim(), classification: r.classification, qty: parseNum(r.qty) ?? 0, price: parseNum(r.price) ?? 0, monthlyQty: parseNum(r.monthlyQty) })) } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Itens incluídos' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const set = (i: number, p: Partial<typeof blank>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Modal open onClose={onClose} size="xl" title="Incluir itens do contrato" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!rows.some((r) => r.description.trim() && r.itemNumber.trim())} onClick={() => save.mutate()}>Incluir</Button></>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-1">Item</th><th className="py-1">Especificação</th><th className="py-1">Unidade</th><th className="py-1">Tipo</th><th className="py-1">Qtde</th><th className="py-1">Valor unit. (R$)</th><th className="py-1">Qtde mensal</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-1"><Input aria-label={`Item ${i + 1}`} className="h-9 w-16" value={r.itemNumber} onChange={(e) => set(i, { itemNumber: e.target.value })} /></td>
              <td className="py-1 pr-1"><Input aria-label={`Especificação ${i + 1}`} className="h-9" value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td className="py-1 pr-1"><Input aria-label={`Unidade ${i + 1}`} className="h-9 w-24" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
              <td className="py-1 pr-1"><Select aria-label={`Tipo ${i + 1}`} className="h-9 w-36" value={r.classification} onChange={(e) => set(i, { classification: e.target.value as LineClass })}>{LINE_CLASSES.map((c) => <option key={c} value={c}>{LINE_CLASS_LABELS[c]}</option>)}</Select></td>
              <td className="py-1 pr-1"><Input aria-label={`Quantidade ${i + 1}`} inputMode="decimal" className="h-9 w-24" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
              <td className="py-1 pr-1"><Input aria-label={`Valor ${i + 1}`} inputMode="decimal" className="h-9 w-28" value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
              <td className="py-1"><Input aria-label={`Mensal ${i + 1}`} inputMode="decimal" className="h-9 w-24" disabled={r.classification !== 'recorrente'} value={r.monthlyQty} onChange={(e) => set(i, { monthlyQty: e.target.value })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, blank])}>Outro item</Button>
    </Modal>
  );
}

function CommitmentModal({ d, contractId, onClose }: { d: Data; contractId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const [v, setV] = useState({ number: '', issuedOn: d.today, source: '' });
  const [qtys, setQtys] = useState<Record<string, { qty: string; code: string }>>({});
  const items = Object.entries(qtys).map(([lineId, x]) => ({ lineId, qty: parseNum(x.qty), code: x.code || null })).filter((x): x is { lineId: string; qty: number; code: string | null } => !!x.qty && x.qty > 0);
  const total = items.reduce((a, x) => a + Math.round(x.qty * (d.lines.find((l) => l.id === x.lineId)?.price4 ?? 0)), 0);
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/commitment-control/commitments`, { method: 'POST', body: { number: v.number.trim().toUpperCase(), issuedOn: v.issuedOn, source: v.source || null, items } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Empenho registrado' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const fillAll = () => setQtys(Object.fromEntries(d.lines.filter((l) => l.balance.toCommit4 > 0).map((l) => [l.id, { qty: String(l.balance.toCommit4 / 10_000).replace('.', ','), code: qtys[l.id]?.code ?? '' }])));
  return (
    <Modal open onClose={onClose} size="xl" title="Registrar empenho (NE)" footer={<><span className="mr-auto text-sm">Valor da NE: <b className="num">{money(total)}</b></span><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.number.trim() || !items.length} loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <FormField label="Nº da NE" htmlFor="ne-n" hint="Ex.: 2026NE002244 (o ano vira o exercício)"><Input id="ne-n" value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} /></FormField>
        <FormField label="Data de emissão" htmlFor="ne-d"><Input id="ne-d" type="date" value={v.issuedOn} onChange={(e) => setV({ ...v, issuedOn: e.target.value })} /></FormField>
        <FormField label="Fonte de receita (opcional)" htmlFor="ne-s"><Input id="ne-s" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="Ex.: Educação estadual" /></FormField>
      </div>
      <div className="mb-2 flex items-center gap-2"><Button size="sm" variant="ghost" onClick={fillAll}>Preencher com o que falta empenhar</Button><span className="text-xs text-muted">Informe a quantidade coberta e o código do item na nota.</span></div>
      <div className="max-h-[50vh] overflow-auto border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Especificação</th><th className="px-2 py-1.5 text-right">Falta empenhar</th><th className="w-28 px-2 py-1.5">Qtde na NE</th><th className="w-32 px-2 py-1.5">Código na NE</th></tr></thead>
          <tbody>{d.lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-2 py-1.5 font-semibold">{l.itemNumber}</td>
              <td className="max-w-[340px] px-2 py-1.5"><span className="line-clamp-1" title={l.description}>{l.description}</span></td>
              <td className="num px-2 py-1.5 text-right">{qty(l.balance.toCommit4)} {l.unit}</td>
              <td className="px-2 py-1.5"><Input aria-label={`Qtde NE item ${l.itemNumber}`} inputMode="decimal" className="num h-8 text-right" value={qtys[l.id]?.qty ?? ''} onChange={(e) => setQtys({ ...qtys, [l.id]: { qty: e.target.value, code: qtys[l.id]?.code ?? '' } })} /></td>
              <td className="px-2 py-1.5"><Input aria-label={`Código NE item ${l.itemNumber}`} className="h-8" value={qtys[l.id]?.code ?? ''} onChange={(e) => setQtys({ ...qtys, [l.id]: { qty: qtys[l.id]?.qty ?? '', code: e.target.value } })} placeholder="460233-1" /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function ImportModal({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const input = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[]>([]);
  const [sheet, setSheet] = useState('');
  const [withMeasurements, setWithMeasurements] = useState(true);
  const [status, setStatus] = useState<'atestada' | 'faturada'>('atestada');
  const parsed = useMemo(() => {
    const s = sheets.find((x) => x.name === sheet);
    if (!s) return null;
    // valor unitário em branco nesta aba: completa pelas outras abas da mesma planilha (ex.: "P EMPENHAR")
    return fillSheetPrices(parseCommitmentSheet(s.rows), sheets.filter((x) => x.name !== sheet).map((x) => parseCommitmentSheet(x.rows)));
  }, [sheets, sheet]);
  const onFile = async (f: File) => {
    try {
      const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
      const names = await readSheetNames(f);
      const out: { name: string; rows: unknown[][] }[] = [];
      for (const name of names) out.push({ name, rows: (await readXlsxFile(f, { sheet: name })) as unknown[][] });
      setSheets(out);
      // a aba com blocos de medição primeiro
      const best = out.find((s) => parseCommitmentSheet(s.rows).measurements.length) ?? out.find((s) => parseCommitmentSheet(s.rows).rows.length) ?? out[0];
      setSheet(best?.name ?? '');
    } catch { toast({ tone: 'error', message: 'Não foi possível ler o arquivo. Use a planilha em .xlsx.' }); }
  };
  const save = useMutation({
    mutationFn: () => api<{ createdLines: number; createdCommitments: number; createdItems: number; createdMeasurements: number }>(`/contracts/${contractId}/commitment-control/import`, { method: 'POST', body: { rows: parsed!.rows as SheetRow[], measurements: parsed!.measurements as SheetMeasurement[], importMeasurements: withMeasurements, measurementStatus: status } }),
    onSuccess: (r) => { refresh(); toast({ tone: 'success', message: `Importado: ${r.createdLines} item(ns), ${r.createdCommitments} empenho(s), ${r.createdMeasurements} medição(ões)` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const nes = parsed ? [...new Set(parsed.rows.map((r) => r.commitment).filter(Boolean))] : [];
  return (
    <Modal open onClose={onClose} size="lg" title="Importar planilha de controle" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!parsed?.rows.length} loading={save.isPending} onClick={() => save.mutate()}>Importar</Button></>}>
      <p className="mb-3 text-sm text-muted">Use a planilha do contrato (Nº do Empenho, Item do Empenho, Código, Item, Especificação, Unidade, Qtde, Valor unitário e os blocos de medição Qtde/Valor/Saldo). Os saldos são recalculados pelo sistema; nada é copiado como saldo.</p>
      <input ref={input} type="file" accept=".xlsx" className="sr-only" aria-label="Arquivo da planilha" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => input.current?.click()}>Escolher arquivo .xlsx</Button>
      {sheets.length > 1 && <FormField label="Aba" htmlFor="im-s" className="mt-3"><Select id="im-s" value={sheet} onChange={(e) => setSheet(e.target.value)}>{sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</Select></FormField>}
      {parsed && (
        <div className="mt-3 space-y-2 text-sm">
          {parsed.rows.length ? <Notice tone="info">{parsed.rows.length} linha(s) de item, {nes.length} empenho(s) ({nes.slice(0, 4).join(', ')}{nes.length > 4 ? '…' : ''}) e {parsed.measurements.length} medição(ões) na aba.</Notice> : <Notice tone="warning">Nenhum item encontrado nesta aba.</Notice>}
          {parsed.filled > 0 && <p className="text-xs text-muted">{parsed.filled} valor(es) unitário(s) vieram de outra aba da planilha (mesmo empenho e item).</p>}
          {parsed.errors.map((e) => <p key={e} className="text-xs text-[#C2610C]">{e}</p>)}
          {!!parsed.measurements.length && (
            <div className="border border-line p-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={withMeasurements} onChange={(e) => setWithMeasurements(e.target.checked)} />Importar também as medições ({parsed.measurements.map((m) => m.title).join(' · ')})</label>
              {withMeasurements && <FormField label="Situação das medições importadas" htmlFor="im-st" className="mt-2"><Select id="im-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="atestada">Atestadas (ainda sem NF no sistema)</option><option value="faturada">Faturadas</option></Select></FormField>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function BlockSetting({ contractId, value }: { contractId: string; value: boolean }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const save = useMutation({ mutationFn: (v: boolean) => api(`/contracts/${contractId}/commitment-control/settings`, { method: 'POST', body: { commitmentBlock: v } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Regra salva' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <div><p className="font-semibold text-ink">Medição sem empenho</p><p className="text-xs text-muted">Padrão: registra e abre pendência "aguardando empenho", porque a execução contínua não para. Ative para bloquear.</p></div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />Bloquear medição sem empenho</label>
    </section>
  );
}

