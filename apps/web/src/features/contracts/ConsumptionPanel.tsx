/**
 * Consumo do contrato (medição) e empenhos (público): o ritmo do consumo contra o tempo da vigência,
 * a projeção de esgotamento, o consumo mês a mês e o saldo de cada nota de empenho.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { PACE_LABELS, toCents, type ConsumptionIndicator } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg, todayIso, type ContractDetail } from './shared';

type Commitment = { id: string; number: string; issuedOn: string; fiscalYear: number; amountCents: number; notes: string | null; cancelledAt: string | null; cancelReason: string | null; used: number; available: number; share: number | null };
type Data = { indicator: ConsumptionIndicator | null; monthly: { month: string; cents: number }[]; commitments: Commitment[] | null; billed: number; kind: string; billingType: string; startAt: string | null; endAt: string | null; canManage: boolean };

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const PACE_TONE: Record<string, string> = { acelerado: 'bg-danger-soft text-danger', lento: 'bg-warning-soft text-[#C2610C]', esgotado: 'bg-danger-soft text-danger', no_ritmo: 'bg-success-soft text-[#15803D]', sem_dados: 'bg-surface-2 text-muted' };
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');

export function ConsumptionPanel({ c }: { c: ContractDetail }) {
  const q = useQuery({ queryKey: ['contract-consumption', c.id], queryFn: () => api<Data>(`/contracts/${c.id}/consumption`) });
  if (q.isLoading || !q.data) return <LoadingRows rows={5} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      {d.billingType === 'medicao' && <Indicator d={d} />}
      {d.kind === 'publico' && <Commitments c={c} d={d} />}
      {d.billingType !== 'medicao' && d.kind !== 'publico' && <EmptyState title="Sem consumo a acompanhar" description="O indicador de consumo é dos contratos por medição; os empenhos, dos contratos públicos." />}
    </div>
  );
}

function Indicator({ d }: { d: Data }) {
  const k = d.indicator;
  if (!k) return <EmptyState title="Sem saldo lançado" description="Lance o crédito de saldo do contrato no extrato para acompanhar o consumo." />;
  const max = Math.max(1, ...d.monthly.map((m) => m.cents));
  const last = d.monthly.slice(-12);
  return (
    <section aria-label="Indicador de consumo" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-md font-bold text-ink">Consumo do contrato</h3>
        <span className={clsx('px-2.5 py-1 text-sm font-bold', PACE_TONE[k.pace])}>{PACE_LABELS[k.pace]}{k.gapPp !== null && k.pace !== 'sem_dados' ? ` (${k.gapPp > 0 ? '+' : ''}${k.gapPp.toLocaleString('pt-BR')} p.p.)` : ''}</span>
      </div>
      {/* duas barras: quanto do saldo foi consumido e quanto da vigência passou */}
      <div className="space-y-2" aria-label="Consumo contra o tempo">
        {[['Saldo consumido', k.share, k.pace === 'acelerado' || k.pace === 'esgotado' ? 'bg-danger' : 'bg-primary'], ['Vigência decorrida', k.elapsedShare, 'bg-navy']].map(([label, v, tone]) => (
          <div key={label as string}>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted">{label as string}</span><span className="num font-semibold text-ink">{pct(v as number | null)}</span></div>
            <div className="h-3 bg-surface-2"><div className={clsx('h-3', tone as string)} style={{ width: `${Math.min(100, Math.round(((v as number | null) ?? 0) * 100))}%` }} /></div>
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        {[['Saldo contratado', fmtBRL(k.credited)], ['Consumido', fmtBRL(k.consumed)], ['Saldo restante', fmtBRL(k.remaining)], ['Média mensal (3 meses)', k.avgMonthlyCents ? fmtBRL(k.avgMonthlyCents) : '—'],
          ['Esgota em', k.exhaustAt ? fmtDate(k.exhaustAt) : '—'], ['Fim da vigência', d.endAt ? fmtDate(d.endAt) : '—'], ['Sobra prevista no fim', k.unusedAtEndCents !== null ? fmtBRL(k.unusedAtEndCents) : '—']].map(([l, v]) => (
          <div key={l} className="border border-line p-3"><dt className="text-xs text-muted">{l}</dt><dd className="num whitespace-nowrap font-bold text-ink">{v}</dd></div>
        ))}
      </dl>
      {k.exhaustBeforeEnd && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">Pelo ritmo atual, o saldo acaba em {fmtDate(k.exhaustAt)}, antes do fim da vigência. Avalie aditivo de acréscimo ou novo contrato.</p>}
      {k.pace === 'lento' && <p className="bg-warning-soft px-3 py-2 text-sm text-[#9A4B00]">Consumo abaixo do ritmo: pode sobrar saldo no fim da vigência (receita contratada que não vira faturamento).</p>}
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Consumo mês a mês</p>
        {!last.length ? <p className="text-sm text-muted">Nenhum consumo ainda.</p> : (
          <ol className="flex h-36 items-end gap-1.5" aria-label="Consumo por mês">
            {last.map((m) => (
              <li key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)}: ${fmtBRL(m.cents)}`}>
                <span className="num text-2xs text-muted">{Math.round(m.cents / 100).toLocaleString('pt-BR', { notation: 'compact' })}</span>
                <span className="w-full bg-primary" style={{ height: `${Math.max(2, Math.round((m.cents / max) * 96))}px` }} aria-hidden />
                <span className="text-2xs text-muted">{monthLabel(m.month)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Commitments({ c, d }: { c: ContractDetail; d: Data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [cancel, setCancel] = useState<Commitment | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => { for (const k of ['contract-consumption', 'contract', 'contract-ledger']) void qc.invalidateQueries({ queryKey: [k] }); };
  const add = useMutation({
    mutationFn: () => { const cents = toCents(amount); if (!cents) throw new Error('Valor no formato 1.500,00'); return api(`/contracts/${c.id}/commitments`, { method: 'POST', body: { number: number.trim(), issuedOn, amountCents: cents } }); },
    onSuccess: () => { refresh(); setOpen(false); setNumber(''); setAmount(''); toast({ tone: 'success', message: 'Empenho registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const cancelM = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/commitments/${cancel!.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => { refresh(); setCancel(null); setReason(''); toast({ tone: 'success', message: 'Empenho anulado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const list = d.commitments ?? [];
  const active = list.filter((x) => !x.cancelledAt);
  const total = active.reduce((t, x) => t + x.available, 0);
  return (
    <section aria-label="Empenhos" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-md font-bold text-ink">Empenhos</h3><p className="text-sm text-muted">O faturamento sai do empenho mais antigo com saldo. Sem empenho, o órgão não paga.</p></div>
        {d.canManage && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Registrar empenho</Button>}
      </div>
      {!list.length ? <EmptyState title="Nenhum empenho registrado" description="Registre a nota de empenho do órgão para acompanhar o saldo disponível para faturar." /> : (
        <>
          <p className="text-sm text-text">Saldo empenhado disponível: <b className="num">{fmtBRL(total)}</b></p>
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.id} className={clsx('border border-line p-3', x.cancelledAt && 'opacity-60')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">{x.number}<span className="ml-2 text-xs font-normal text-muted">{fmtDate(x.issuedOn)} · exercício {x.fiscalYear}</span></span>
                  <span className="num text-sm">{x.cancelledAt ? <span className="font-semibold text-danger">Anulado</span> : <>{fmtBRL(x.available)} de {fmtBRL(x.amountCents)}</>}</span>
                </div>
                {!x.cancelledAt && <div className="mt-2 h-2 bg-surface-2"><div className={clsx('h-2', (x.share ?? 0) >= 0.8 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, Math.round((x.share ?? 0) * 100))}%` }} /></div>}
                <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>{x.cancelledAt ? `Motivo: ${x.cancelReason}` : `Usado ${pct(x.share)} (${fmtBRL(x.used)})`}</span>
                  {d.canManage && !x.cancelledAt && <button type="button" className="font-semibold text-danger hover:underline" onClick={() => setCancel(x)}>Anular</button>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar empenho" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={add.isPending} disabled={number.trim().length < 3 || !amount.trim()} onClick={() => add.mutate()}>Registrar</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Número da nota de empenho" htmlFor="ne-n"><Input id="ne-n" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="2026NE000123" /></FormField>
          <FormField label="Data" htmlFor="ne-d"><Input id="ne-d" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></FormField>
          <FormField label="Valor (R$)" htmlFor="ne-v"><Input id="ne-v" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></FormField>
        </div>
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`Anular empenho ${cancel?.number ?? ''}`} size="sm" footer={<><Button onClick={() => setCancel(null)}>Voltar</Button><Button variant="danger" loading={cancelM.isPending} disabled={reason.trim().length < 5} onClick={() => cancelM.mutate()}>Anular empenho</Button></>}>
        <FormField label="Motivo" htmlFor="ne-r"><Input id="ne-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: anulado pelo órgão" /></FormField>
        <p className="mt-2 text-xs text-muted">O empenho continua no histórico, sem saldo.</p>
      </Modal>
    </section>
  );
}
