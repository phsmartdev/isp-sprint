/**
 * Gestão de Contratos → Habilitação: a situação das certidões de cada filial num quadro só
 * (vencida, vence em 7/15/30 dias, válida, não cadastrada), com envio da nova certidão, histórico e download.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Plus, Upload } from 'lucide-react';
import { COMPANY_DOC_KINDS, COMPANY_DOC_LABELS, DOC_STATUS_LABELS, REQUIRED_PUBLIC_DOCS, type CompanyDocKind, type DocStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Doc = { id: string; branchId: string | null; kind: CompanyDocKind; label: string | null; kindLabel: string; number: string | null; issuedOn: string | null; expiresOn: string | null; filename: string; status: DocStatus; days: number | null };
type Cell = { kind: CompanyDocKind; label: string; doc: Doc | null; status: DocStatus; days: number | null };
type Data = { branches: { id: string; name: string }[]; docs: Doc[]; matrix: { branchId: string; branchName: string; publicContracts: number; items: Cell[] }[]; canEdit: boolean };

const TONE: Record<DocStatus, string> = { vencida: 'bg-danger text-white', vence_7: 'bg-danger-soft text-danger', vence_15: 'bg-warning-soft text-[#C2610C]', vence_30: 'bg-[#FFF6D6] text-[#9A6B00]', valida: 'bg-success-soft text-[#15803D]', falta: 'bg-surface-2 text-muted' };
const ORDER: DocStatus[] = ['vencida', 'falta', 'vence_7', 'vence_15', 'vence_30', 'valida'];

export function HabilitationTab() {
  const q = useQuery({ queryKey: ['habilitation'], queryFn: () => api<Data>('/contracts/habilitation') });
  const [upload, setUpload] = useState<{ branchId: string | null; kind: CompanyDocKind; current: Doc | null } | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const problems = d.matrix.flatMap((m) => m.items.filter((i) => i.status !== 'valida').map((i) => ({ ...i, branchName: m.branchName, branchId: m.branchId, publicContracts: m.publicContracts }))).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const others = d.docs.filter((x) => !REQUIRED_PUBLIC_DOCS.includes(x.kind));
  return (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Atenção na habilitação">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-bold text-ink">Habilitação</h2><p className="text-sm text-muted">Certidões exigidas para manter contrato público, por filial. Sem regularidade, o órgão pode reter o pagamento.</p></div>
          {d.canEdit && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setUpload({ branchId: d.branches[0]?.id ?? null, kind: 'cnd_federal', current: null })}>Cadastrar documento</Button>}
        </div>
        {!problems.length ? <p className="bg-success-soft px-3 py-2 text-sm text-[#15803D]">Todas as certidões exigidas estão válidas.</p> : (
          <ul className="space-y-1.5" aria-label="O que precisa de atenção">
            {problems.map((p) => (
              <li key={`${p.branchId}-${p.kind}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className={clsx('px-2 py-0.5 text-xs font-bold', TONE[p.status])}>{DOC_STATUS_LABELS[p.status]}</span>
                <span className="font-semibold text-ink">{p.label}</span><span className="text-muted">· {p.branchName}{p.doc?.expiresOn ? ` · validade ${fmtDate(p.doc.expiresOn)}` : ''}{p.publicContracts ? ` · ${p.publicContracts} contrato(s) público(s)` : ''}</span>
                {d.canEdit && <button type="button" className="ml-auto text-sm font-semibold text-primary hover:underline" onClick={() => setUpload({ branchId: p.branchId, kind: p.kind, current: p.doc })}>Enviar nova</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-x-auto p-5" aria-label="Quadro de certidões por filial">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="px-2 py-2 font-medium">Filial</th>{REQUIRED_PUBLIC_DOCS.map((k) => <th key={k} className="px-2 py-2 font-medium">{COMPANY_DOC_LABELS[k]}</th>)}</tr></thead>
          <tbody>
            {d.matrix.map((m) => (
              <tr key={m.branchId} className="border-t border-line align-top">
                <td className="px-2 py-2"><span className="font-semibold text-ink">{m.branchName}</span><span className="block text-xs text-muted">{m.publicContracts} contrato(s) público(s)</span></td>
                {m.items.map((i) => (
                  <td key={i.kind} className="px-2 py-2">
                    <button type="button" disabled={!d.canEdit && !i.doc} onClick={() => setUpload({ branchId: m.branchId, kind: i.kind, current: i.doc })} aria-label={`${i.label} da ${m.branchName}: ${DOC_STATUS_LABELS[i.status]}`}
                      className={clsx('block w-full px-2 py-1.5 text-left text-xs font-semibold', TONE[i.status])}>
                      {DOC_STATUS_LABELS[i.status]}
                      {i.doc?.expiresOn && <span className="num block font-normal">{fmtDate(i.doc.expiresOn)}{i.doc.branchId === null ? ' · geral' : ''}</span>}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5" aria-label="Outros documentos da empresa">
        <h3 className="mb-2 text-md font-bold text-ink">Outros documentos</h3>
        {!others.length ? <EmptyState title="Nenhum outro documento" description="Alvarás, certidão de falência e demais documentos de habilitação." /> : (
          <ul className="divide-y divide-line">
            {others.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className={clsx('px-2 py-0.5 text-xs font-bold', TONE[o.status === 'falta' ? 'valida' : o.status])}>{o.expiresOn ? DOC_STATUS_LABELS[o.status] : 'Sem validade'}</span>
                <span className="font-semibold text-ink">{o.kindLabel}</span>
                <span className="text-muted">· {o.branchId ? d.branches.find((b) => b.id === o.branchId)?.name : 'Todas as filiais'}{o.expiresOn ? ` · validade ${fmtDate(o.expiresOn)}` : ''}</span>
                <a className="ml-auto p-1 text-ink hover:text-primary" href={`/api/v1/contracts/habilitation/${o.id}/download`} aria-label={`Baixar ${o.kindLabel}`}><Download className="h-4 w-4" /></a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {upload && <UploadDialog data={d} init={upload} onClose={() => setUpload(null)} />}
    </div>
  );
}

function UploadDialog({ data, init, onClose }: { data: Data; init: { branchId: string | null; kind: CompanyDocKind; current: Doc | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [branchId, setBranchId] = useState<string>(init.branchId ?? '');
  const [kind, setKind] = useState<CompanyDocKind>(init.kind);
  const [label, setLabel] = useState('');
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const hist = useQuery({ queryKey: ['habilitation-history', branchId, kind], enabled: kind !== 'outro', queryFn: () => api<{ items: { id: string; number: string | null; expiresOn: string | null; createdAt: string; supersededAt: string | null; by: string | null; filename: string }[] }>(`/contracts/habilitation/history?kind=${kind}${branchId ? `&branchId=${branchId}` : ''}`) });
  const send = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Escolha o arquivo da certidão.');
      const b64 = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('Não foi possível ler o arquivo.')); r.readAsDataURL(file); });
      return api('/contracts/habilitation', { method: 'POST', body: { branchId: branchId || null, kind, label: kind === 'outro' ? label : null, number: number || null, issuedOn: issuedOn || null, expiresOn: expiresOn || null, filename: file.name, data: b64 } });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['habilitation'] }); void qc.invalidateQueries({ queryKey: ['habilitation-history'] }); toast({ tone: 'success', message: 'Documento cadastrado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={init.current ? `${COMPANY_DOC_LABELS[init.kind]}` : 'Cadastrar documento'} size="lg"
      footer={<><Button onClick={onClose}>Fechar</Button>{data.canEdit && <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={send.isPending} disabled={!file || (kind !== 'outro' && !expiresOn)} onClick={() => send.mutate()}>Enviar documento</Button>}</>}>
      <div className="space-y-3">
        {init.current && (
          <p className="flex flex-wrap items-center gap-2 text-sm">Atual: <b>{init.current.number ?? init.current.filename}</b>{init.current.expiresOn && <> · validade <span className="num">{fmtDate(init.current.expiresOn)}</span></>}
            <a className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={`/api/v1/contracts/habilitation/${init.current.id}/download`}><Download className="h-4 w-4" aria-hidden />Baixar</a></p>
        )}
        {data.canEdit && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Filial" htmlFor="hb-b"><Select id="hb-b" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">Todas as filiais</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
            <FormField label="Documento" htmlFor="hb-k"><Select id="hb-k" value={kind} onChange={(e) => setKind(e.target.value as CompanyDocKind)}>{COMPANY_DOC_KINDS.map((k) => <option key={k} value={k}>{COMPANY_DOC_LABELS[k]}</option>)}</Select></FormField>
            {kind === 'outro' && <FormField label="Nome do documento" htmlFor="hb-l"><Input id="hb-l" value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>}
            <FormField label="Número / código de controle" htmlFor="hb-n"><Input id="hb-n" value={number} onChange={(e) => setNumber(e.target.value)} /></FormField>
            <FormField label="Emissão" htmlFor="hb-i"><Input id="hb-i" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></FormField>
            <FormField label="Validade" htmlFor="hb-e"><Input id="hb-e" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></FormField>
            <FormField label="Arquivo (PDF, PNG ou JPG, até 4 MB)" htmlFor="hb-f" className="sm:col-span-2"><input id="hb-f" type="file" accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></FormField>
          </div>
        )}
        {!!hist.data?.items.length && (
          <div>
            <p className="mb-1 text-sm font-semibold text-ink">Histórico</p>
            <ul className="space-y-1 text-sm">
              {hist.data.items.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 text-muted">
                  <span className="num">{fmtDate(h.createdAt)}</span><span>{h.number ?? h.filename}</span>{h.expiresOn && <span>· validade {fmtDate(h.expiresOn)}</span>}{h.by && <span>· {h.by}</span>}{h.supersededAt ? <span>· substituída</span> : <span className="font-semibold text-[#15803D]">· atual</span>}
                  <a className="ml-auto text-primary" href={`/api/v1/contracts/habilitation/${h.id}/download`} aria-label={`Baixar versão de ${fmtDate(h.createdAt)}`}><Download className="h-4 w-4" /></a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
