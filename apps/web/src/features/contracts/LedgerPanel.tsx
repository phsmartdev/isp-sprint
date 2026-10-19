/** Extrato do contrato: saldo (medição) ou lançamentos de faturamento (frequente). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { toCents } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtPct } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg, todayIso, type ContractDetail } from './shared';

type Entry = { id: string; kind: 'credito' | 'consumo' | 'estorno' | 'faturamento'; label: string; amountCents: number; occurredOn: string; description: string; opportunityId: string | null; opportunityCode: number | null; createdByName: string | null; balanceAfter: number | null; reversesId: string | null };
type Ledger = { billingType: string; totals: { credited: number; consumed: number; billed: number; available: number; usedShare: number | null }; items: Entry[] };

export function LedgerPanel({ c }: { c: ContractDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contract-ledger', c.id], queryFn: () => api<Ledger>(`/contracts/${c.id}/ledger`) });
  const med = c.billingType === 'medicao';
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Entry['kind']>(med ? 'credito' : 'faturamento');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState('');
  const [rev, setRev] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => {
      const cents = amount.trim() ? toCents(amount) : null;
      if (amount.trim() && cents === null) throw new Error('Valor inválido. Use 1.500,00.');
      return api(`/contracts/${c.id}/ledger`, { method: 'POST', body: { kind, amountCents: cents ?? undefined, occurredOn: date, description: desc, reversesId: kind === 'estorno' ? rev : undefined } });
    },
    onSuccess: () => { for (const k of ['contract-ledger', 'contract', 'contracts']) qc.invalidateQueries({ queryKey: [k] }); setOpen(false); setAmount(''); setDesc(''); toast({ tone: 'success', message: 'Lançamento registrado' }); },
    onError: (e) => setError(errMsg(e)),
  });
  if (q.isLoading || !q.data) return <LoadingRows rows={4} />;
  const t = q.data.totals;
  const consumos = q.data.items.filter((e) => e.kind === 'consumo');
  return (
    <div className="space-y-4">
      {med ? (
        <section aria-label="Saldo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Saldo contratado', fmtBRL(t.credited), ''], ['Consumido', fmtBRL(t.consumed), fmtPct(t.usedShare)], ['Disponível', fmtBRL(t.available), ''], ['Consumos', String(consumos.length), 'lançamentos']].map(([l, v, sub], i) => (
            <div key={l} className="rounded-md border border-line p-3"><p className="text-sm text-muted">{l}</p><p className={clsx('num text-lg font-extrabold', i === 2 && t.credited && t.available / t.credited < 0.2 ? 'text-danger' : 'text-ink')}>{v}</p>{sub && <p className="text-xs text-muted">{sub}</p>}</div>
          ))}
          <div className="col-span-2 lg:col-span-4"><div className="h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Consumido ${fmtPct(t.usedShare)}`}><div className={clsx('h-full rounded-full', (t.usedShare ?? 0) > 0.8 ? 'bg-danger' : 'bg-[#EA7A0C]')} style={{ width: `${Math.min(100, (t.usedShare ?? 0) * 100)}%` }} /></div></div>
        </section>
      ) : (
        <p className="text-sm text-muted">Faturamento lançado neste contrato: <span className="num font-bold text-ink">{fmtBRL(t.billed)}</span>. {c.billingType === 'recorrente' ? 'Contratos recorrentes faturam pela mensalidade; lançamentos aqui são opcionais.' : 'Registre cada cobrança (ocorrência) para compor o faturamento.'}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{med ? 'As oportunidades vinculadas a este contrato consomem o saldo quando a venda fecha; reabrir estorna.' : 'Lançamentos não são apagados: correções entram como novos lançamentos.'}</p>
        {c.stage !== 'arquivado' && c.billingType !== 'recorrente' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setError(null); setOpen(true); }}>Novo lançamento</Button>}
      </div>
      {!q.data.items.length ? <EmptyState title="Sem lançamentos" description={med ? 'Cadastre o saldo contratado para começar.' : 'Nenhuma cobrança lançada ainda.'} /> : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Descrição</th><th className="px-3 py-2 text-right font-medium">Valor</th>{med && <th className="px-3 py-2 text-right font-medium">Saldo após</th>}<th className="px-3 py-2 font-medium">Por</th></tr></thead>
            <tbody>{q.data.items.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="num px-3 py-2">{fmtDate(e.occurredOn)}</td>
                <td className="px-3 py-2">{e.label}</td>
                <td className="px-3 py-2">{e.description}{e.opportunityId && <Link className="link ml-1" to={`/opportunities/${e.opportunityId}`}>OP-{e.opportunityCode}</Link>}</td>
                <td className={clsx('num px-3 py-2 text-right font-semibold', e.kind === 'consumo' ? 'text-danger' : e.kind === 'credito' || e.kind === 'estorno' ? 'text-success' : 'text-ink')}>{e.kind === 'consumo' ? '−' : '+'}{fmtBRL(e.amountCents)}</td>
                {med && <td className="num px-3 py-2 text-right">{e.balanceAfter === null ? '—' : fmtBRL(e.balanceAfter)}</td>}
                <td className="px-3 py-2 text-muted">{e.createdByName ?? 'Sistema'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Novo lançamento" size="sm" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={add.isPending} disabled={desc.trim().length < 3 || (kind === 'estorno' ? !rev : !amount.trim())} onClick={() => { setError(null); add.mutate(); }}>Lançar</Button></>}>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <FormField label="Tipo" htmlFor="lg-kind">
            <Select id="lg-kind" value={kind} onChange={(e) => setKind(e.target.value as Entry['kind'])}>
              {med ? <><option value="credito">Crédito de saldo (aditivo)</option><option value="consumo">Consumo manual</option><option value="estorno">Estorno de consumo</option></> : <option value="faturamento">Lançamento de faturamento</option>}
            </Select>
          </FormField>
          {kind === 'estorno' && <FormField label="Consumo a estornar" htmlFor="lg-rev" required><Select id="lg-rev" value={rev} onChange={(e) => setRev(e.target.value)}><option value="">Escolha</option>{consumos.map((e) => <option key={e.id} value={e.id}>{fmtDate(e.occurredOn)} · {fmtBRL(e.amountCents)} · {e.description}</option>)}</Select></FormField>}
          <FormField label={kind === 'estorno' ? 'Valor (em branco estorna tudo)' : 'Valor (R$)'} htmlFor="lg-amount" required={kind !== 'estorno'}><Input id="lg-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
          <FormField label="Data" htmlFor="lg-date"><Input id="lg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
          <FormField label="Descrição" htmlFor="lg-desc" required><Input id="lg-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={kind === 'credito' ? 'Aditivo nº…' : 'Ordem de serviço, medição de…'} /></FormField>
        </div>
      </Modal>
    </div>
  );
}
