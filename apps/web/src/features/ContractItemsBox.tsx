/** Oportunidade de cliente com Controle de Empenhos: escolher os itens do contrato que a venda vai consumir (reserva o saldo, como a Ata). */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromQ4 } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL } from '../lib/format';
import type { Opportunity } from '../lib/types';
import { Button, FormField, Input, Select } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';

type Line = { id: string; itemNumber: string | null; description: string; unit: string; price4: number; available4: number };
type Ctr = { id: string; code: number; number: string; object: string; lines: Line[] };
type Res = { contracts: Ctr[]; reserved: { contractId: string; lineId: string; qty4: number; status: string }[]; locked: boolean };

const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const parse = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function ContractItemsBox({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['opp-contract-items', opp.id], queryFn: () => api<Res>(`/opportunities/${opp.id}/contract-items`) });
  const [contractId, setContractId] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => {
    if (!q.data) return;
    const r = q.data.reserved;
    setContractId(r[0]?.contractId ?? '');
    setQty(Object.fromEntries(r.map((x) => [x.lineId, num(fromQ4(x.qty4))])));
    setShown(r.map((x) => x.lineId));
  }, [q.data]);
  const ctr = q.data?.contracts.find((c) => c.id === contractId);
  const picked = (ctr?.lines ?? []).filter((l) => shown.includes(l.id));
  const total = useMemo(() => (ctr?.lines ?? []).reduce((a, l) => { const n = parse(qty[l.id] ?? ''); return a + (n > 0 ? Math.round((n * l.price4) / 100) : 0); }, 0), [ctr, qty]);
  const save = useMutation({
    mutationFn: () => {
      const lines = (ctr?.lines ?? []).map((l) => ({ lineId: l.id, qty: parse(qty[l.id] ?? '') })).filter((x) => x.qty > 0);
      if ((ctr?.lines ?? []).some((l) => (qty[l.id] ?? '').trim() && Number.isNaN(parse(qty[l.id]!)))) throw new Error('Quantidade inválida.');
      return api(`/opportunities/${opp.id}/contract-items`, { method: 'PUT', body: { contractId: contractId || null, lines } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['opp-contract-items', opp.id] }); toast({ tone: 'success', message: contractId ? 'Itens reservados: saem do saldo do contrato quando a venda fechar' : 'Reserva liberada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!q.data || (!q.data.contracts.length && !q.data.reserved.length)) return null;
  const locked = q.data.locked;
  return (
    <section className="mt-4 rounded-md border border-[#0E7490]/40 bg-surface-2 p-3" aria-labelledby="ci-h">
      <h3 id="ci-h" className="text-sm font-bold text-ink">Itens do contrato (empenho)</h3>
      <p className="mt-1 text-xs text-muted">{locked ? 'Venda encerrada: os itens abaixo já foram lançados no Controle de Empenhos do contrato.' : 'Este cliente tem contrato com itens e empenhos. Adicione os itens e quanto desta venda sai de cada um: o saldo fica reservado agora e vira medição quando a venda fechar.'}</p>
      <div className="mt-2 space-y-2">
        <FormField label="Contrato" htmlFor="ci-c"><Select id="ci-c" value={contractId} disabled={locked} onChange={(e) => setContractId(e.target.value)}><option value="">Não usar itens de contrato</option>{q.data.contracts.map((c) => <option key={c.id} value={c.id}>{c.number} · {c.object.slice(0, 60)}</option>)}</Select></FormField>
        {ctr && (
          <ul className="space-y-2">
            {picked.map((l) => (
              <li key={l.id} className="border border-line bg-surface p-2">
                <p className="text-sm text-ink">{l.itemNumber ? <span className="text-muted">{l.itemNumber} · </span> : null}{l.description}</p>
                <div className="mt-1 flex items-end gap-2">
                  <p className="flex-1 text-xs text-muted">{fmtBRL(Math.round(l.price4 / 100))} / {l.unit}<br />Disponível: <strong className="text-ink">{num(fromQ4(l.available4))} {l.unit}</strong></p>
                  <Input aria-label={`Quantidade de ${l.description}`} className="w-24 text-right" inputMode="decimal" disabled={locked} value={qty[l.id] ?? ''} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} />
                  {!locked && <Button size="sm" variant="ghost" aria-label={`Tirar ${l.description}`} onClick={() => { setShown((s) => s.filter((x) => x !== l.id)); setQty((s) => { const n = { ...s }; delete n[l.id]; return n; }); }}>Tirar</Button>}
                </div>
              </li>
            ))}
            {!locked && (
              <li><Select aria-label="Adicionar item do contrato" value="" onChange={(e) => { const id = e.target.value; if (id) setShown((s) => [...s, id]); }}>
                <option value="">+ Adicionar item do contrato…</option>
                {ctr.lines.filter((l) => !picked.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id} disabled={l.available4 <= 0}>{l.itemNumber ? `${l.itemNumber} · ` : ''}{l.description.slice(0, 70)} ({num(fromQ4(l.available4))} {l.unit})</option>)}
              </Select></li>
            )}
          </ul>
        )}
        {ctr && <p className="text-sm text-text">Total reservado: <strong>{fmtBRL(total)}</strong> · <Link className="link" to={`/contracts/${ctr.id}`}>abrir contrato</Link></p>}
        {!locked && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar itens</Button>}
      </div>
    </section>
  );
}
