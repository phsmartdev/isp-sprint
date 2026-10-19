/** Oportunidade de cliente com contrato por medição: escolher de qual saldo sai o consumo quando a venda fechar. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toCents } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL } from '../lib/format';
import type { Opportunity } from '../lib/types';
import { Button, FormField, Input, Select } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { dec, errMsg } from './contracts/shared';

type Opt = { id: string; code: number; number: string; object: string; credited: number; consumed: number; available: number };

export function MeasurementBox({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['measurement-options', opp.id], queryFn: () => api<{ items: Opt[] }>(`/opportunities/${opp.id}/measurement-options`) });
  const [contractId, setContractId] = useState(opp.measurementContractId ?? '');
  const [amount, setAmount] = useState(dec(opp.measurementCents ?? opp.valueCents));
  useEffect(() => { setContractId(opp.measurementContractId ?? ''); setAmount(dec(opp.measurementCents ?? opp.valueCents)); }, [opp.measurementContractId, opp.measurementCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => { const c = amount.trim() ? toCents(amount) : null; if (contractId && amount.trim() && c === null) throw new Error('Valor inválido.'); return api(`/opportunities/${opp.id}/measurement`, { method: 'PUT', body: { contractId: contractId || null, amountCents: contractId ? c : null } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['opportunity', opp.id] }); qc.invalidateQueries({ queryKey: ['measurement-options', opp.id] }); toast({ tone: 'success', message: contractId ? 'Consumo vinculado: sai do saldo quando a venda fechar' : 'Vínculo removido' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  if (!items.length && !opp.measurementContractId) return null;
  const closed = opp.stage === 'ganha' || opp.stage === 'perdida';
  const cur = items.find((x) => x.id === (opp.measurementContractId ?? contractId));
  return (
    <section className="mt-4 rounded-md border border-[#EA7A0C]/40 bg-warning-soft/40 p-3" aria-labelledby="mb-h">
      <h3 id="mb-h" className="text-sm font-bold text-ink">Contrato por medição</h3>
      {closed ? (
        <p className="mt-1 text-sm text-text">{opp.measurementContractId ? <>Consumo de <strong>{fmtBRL(opp.measurementCents ?? opp.valueCents)}</strong> do contrato <Link className="link" to={`/contracts/${opp.measurementContractId}`}>{cur?.number ?? 'vinculado'}</Link>{opp.stage === 'ganha' ? ' (lançado no saldo).' : '.'}</> : 'Sem consumo vinculado.'}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">Este cliente tem saldo contratado. Escolha de onde sai o valor desta negociação; o consumo é lançado quando a venda fechar.</p>
          <FormField label="Contrato" htmlFor="mb-c"><Select id="mb-c" value={contractId} onChange={(e) => setContractId(e.target.value)}><option value="">Não consumir saldo</option>{items.map((x) => <option key={x.id} value={x.id}>{x.number} · disponível {fmtBRL(x.available)}</option>)}</Select></FormField>
          {contractId && <FormField label="Valor a consumir (R$)" htmlFor="mb-v" hint={`Disponível: ${fmtBRL(items.find((x) => x.id === contractId)?.available)}`}><Input id="mb-v" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>}
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar consumo</Button>
        </div>
      )}
    </section>
  );
}
