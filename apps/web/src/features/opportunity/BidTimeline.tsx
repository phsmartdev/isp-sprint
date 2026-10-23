/**
 * Linha do tempo do pregão: cada ação de cada empresa (lance, recurso, impugnação, desclassificação…),
 * em ordem. Só inclui — não edita nem apaga; uma correção é um novo registro.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Plus } from 'lucide-react';
import { BID_ACTION_KINDS, BID_ACTION_LABELS, parseMoney, type BidActionKind } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime, isoToLocalInput, localInputToIso } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Action = { id: string; company: string; document: string | null; isUs: boolean; kind: BidActionKind; lot: string | null; amountCents: number | null; description: string | null; occurredAt: string; createdAt: string; createdByName: string | null };
type Participant = { company: string; document: string | null; isUs: boolean };

const TONE: Partial<Record<BidActionKind, string>> = {
  lance: 'bg-primary-soft text-primary', negociacao: 'bg-primary-soft text-primary',
  recurso: 'bg-warning-soft text-[#C2610C]', impugnacao: 'bg-warning-soft text-[#C2610C]', contrarrazao: 'bg-warning-soft text-[#C2610C]',
  desclassificacao: 'bg-danger-soft text-danger', inabilitacao: 'bg-danger-soft text-danger', desistencia: 'bg-danger-soft text-danger',
  habilitacao: 'bg-success-soft text-[#15803D]', adjudicacao: 'bg-success-soft text-[#15803D]', homologacao: 'bg-success-soft text-[#15803D]',
};

export function BidTimeline({ oppId, editable = true }: { oppId: string; editable?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bid-actions', oppId], queryFn: () => api<{ items: Action[] }>(`/opportunities/${oppId}/bid-actions`) });
  const parts = useQuery({ queryKey: ['bid-participants', oppId], queryFn: () => api<{ items: Participant[] }>(`/opportunities/${oppId}/bid-participants`) });
  const companies = [...new Map((parts.data?.items ?? []).map((p) => [p.document || p.company, p])).values()];
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [other, setOther] = useState({ company: '', document: '' });
  const [kind, setKind] = useState<BidActionKind>('lance');
  const [lot, setLot] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const start = () => { setWho(companies[0] ? String(0) : 'outra'); setOther({ company: '', document: '' }); setKind('lance'); setLot(''); setAmount(''); setDesc(''); setWhen(isoToLocalInput(new Date().toISOString())); setErr(null); setOpen(true); };
  const save = useMutation({
    mutationFn: () => {
      const p = who === 'outra' ? { company: other.company.trim(), document: other.document.trim() || null, isUs: false } : companies[Number(who)]!;
      return api(`/opportunities/${oppId}/bid-actions`, { method: 'POST', body: { company: p.company, document: p.document, isUs: p.isUs, kind, lot: lot.trim() || null, amountCents: amount.trim() ? parseMoney(amount) : null, description: desc.trim() || null, occurredAt: localInputToIso(when) } });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bid-actions', oppId] }); setOpen(false); toast({ tone: 'success', message: 'Ação registrada' }); },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = () => {
    if (who === 'outra' && other.company.trim().length < 2) return setErr('Informe a empresa.');
    if (amount.trim() && parseMoney(amount) === null) return setErr('Valor no formato 1.500,00');
    if (!when) return setErr('Informe quando aconteceu.');
    save.mutate();
  };
  const items = q.data?.items ?? [];

  return (
    <section aria-label="Linha do tempo do pregão">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-md font-bold text-ink"><Gavel className="h-5 w-5 text-primary" aria-hidden />Linha do tempo do pregão</h3>
        {editable && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={start}>Registrar ação</Button>}
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : !items.length ? (
        <EmptyState title="Nenhuma ação registrada" description="Registre lances, recursos, impugnações, desclassificações e desistências de cada empresa, na ordem em que aconteceram." />
      ) : (
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-circle bg-primary" aria-hidden />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 text-xs font-bold ${TONE[a.kind] ?? 'bg-surface-2 text-muted'}`}>{BID_ACTION_LABELS[a.kind]}</span>
                <span className="font-semibold text-ink">{a.company}{a.isUs ? ' (nós)' : ''}</span>
                {a.lot && <span className="text-muted">lote {a.lot}</span>}
                {a.amountCents !== null && <span className="num font-semibold text-text">{fmtBRL(a.amountCents)}</span>}
              </div>
              {a.description && <p className="mt-1 whitespace-pre-line text-sm text-text">{a.description}</p>}
              <p className="mt-0.5 text-xs text-muted">{fmtDateTime(a.occurredAt)}{a.createdByName ? ` · registrado por ${a.createdByName}` : ''}</p>
            </li>
          ))}
        </ol>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Registrar ação do pregão" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Registrar</Button></>}>
        <div className="space-y-3">
          {err && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          <p className="text-sm text-muted">O registro não pode ser editado nem apagado depois. Para corrigir, registre uma nova ação explicando.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Empresa" htmlFor="ba-who">
              <Select id="ba-who" value={who} onChange={(e) => setWho(e.target.value)}>
                {companies.map((c, i) => <option key={i} value={String(i)}>{c.company}{c.isUs ? ' (nós)' : ''}</option>)}
                <option value="outra">Outra empresa</option>
              </Select>
            </FormField>
            <FormField label="Ação" htmlFor="ba-kind">
              <Select id="ba-kind" value={kind} onChange={(e) => setKind(e.target.value as BidActionKind)}>{BID_ACTION_KINDS.map((k) => <option key={k} value={k}>{BID_ACTION_LABELS[k]}</option>)}</Select>
            </FormField>
          </div>
          {who === 'outra' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Nome da empresa" htmlFor="ba-company"><Input id="ba-company" value={other.company} onChange={(e) => setOther({ ...other, company: e.target.value })} /></FormField>
              <FormField label="CNPJ" htmlFor="ba-doc"><Input id="ba-doc" value={other.document} placeholder="00.000.000/0000-00" onChange={(e) => setOther({ ...other, document: e.target.value })} /></FormField>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Quando" htmlFor="ba-when"><Input id="ba-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></FormField>
            <FormField label="Lote" htmlFor="ba-lot"><Input id="ba-lot" value={lot} placeholder="Único" onChange={(e) => setLot(e.target.value)} /></FormField>
            <FormField label="Valor (R$)" htmlFor="ba-amount"><Input id="ba-amount" className="num" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
          </div>
          <FormField label="Descrição" htmlFor="ba-desc"><Textarea id="ba-desc" value={desc} placeholder="O que foi apresentado ou alegado" onChange={(e) => setDesc(e.target.value)} /></FormField>
        </div>
      </Modal>
    </section>
  );
}
