/**
 * Emitir ofício a partir do contrato: modelo, filial, destinatário e os valores das variáveis (já preenchidos com os
 * dados do contrato, todos ajustáveis), texto e posição editáveis só para este ofício, prévia exata e emissão com o
 * número sequencial da filial. Ofícios emitidos ficam listados para baixar.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { OfficeEditor, type OfficeBlock, type VarDef } from './OfficeEditor';

type Tpl = { id: string; name: string; description: string | null; blocks: OfficeBlock[]; usedVars: string[] };
type Data = { branchId: string | null; branches: { id: string; name: string }[]; vars: Record<string, string>; varDefs: VarDef[]; recipients: { personId: string; name: string; title: string | null; role: string }[]; recipientPersonId: string | null; issued: { id: string; label: string; subject: string | null; createdAt: string; by: string | null }[]; templates: Tpl[] };

export function OfficesList({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['contrato', contractId, 'oficios'], queryFn: () => api<Data>(`/contracts/${contractId}/oficios`) });
  if (!q.data?.issued.length) return null;
  return (
    <section className="card p-4" aria-label="Ofícios emitidos">
      <h2 className="mb-2 text-sm font-bold text-ink">Ofícios emitidos</h2>
      <ul className="divide-y divide-line text-sm">{q.data.issued.map((l) => (
        <li key={l.id} className="flex items-center gap-3 py-2"><FileText className="h-4 w-4 text-primary" aria-hidden /><span className="flex-1"><b className="text-ink">Ofício nº {l.label}</b>{l.subject && ` · ${l.subject}`}<span className="block text-xs text-muted">{fmtDateTime(l.createdAt)}{l.by && ` · ${l.by}`}</span></span>
          <a href={`/api/v1/oficios/${l.id}/pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="h-4 w-4" aria-hidden />PDF</a></li>
      ))}</ul>
    </section>
  );
}

export function IssueOfficeModal({ contractId, open, onClose }: { contractId: string; open: boolean; onClose: () => void }) {
  const [recipient, setRecipient] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const q = useQuery({ queryKey: ['contrato', contractId, 'oficios', recipient, branch], enabled: open, queryFn: () => api<Data>(`/contracts/${contractId}/oficios${qs({ destinatario: recipient || undefined, filial: branch || undefined })}`), placeholderData: (p) => p });
  const [tplId, setTplId] = useState('');
  const [blocks, setBlocks] = useState<OfficeBlock[] | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const d = q.data;
  const tpl = d?.templates.find((t) => t.id === tplId) ?? null;
  // escolhe o primeiro modelo; ao trocar de modelo, o texto volta ao do modelo
  useEffect(() => { if (d && !tplId && d.templates[0]) setTplId(d.templates[0].id); }, [d, tplId]);
  useEffect(() => { if (tpl) { setBlocks(tpl.blocks); setSubject(tpl.name); } }, [tpl]);
  // valores do contrato (refeitos ao trocar destinatário ou filial), sem apagar o que a pessoa já ajustou à mão
  useEffect(() => { if (d) { setVars((v) => ({ ...d.vars, ...Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('destinatario.nome') && !k.startsWith('destinatario.cargo') && !k.startsWith('filial.') && !k.startsWith('assinante.') && k !== 'oficio.numero')) })); if (!branch && d.branchId) setBranch(d.branchId); if (!recipient && d.recipientPersonId) setRecipient(d.recipientPersonId); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (b: OfficeBlock[]) => api<{ pdf: string; boxes: { id: string; page: number; x: number; y: number; w: number; h: number }[]; pages: number }>(`/contracts/${contractId}/oficios/previa`, { method: 'POST', body: { blocks: b, vars, branchId: branch || null } }), [contractId, vars, branch]);
  const issue = useMutation({
    mutationFn: () => api<{ id: string; label: string }>(`/contracts/${contractId}/oficios`, { method: 'POST', body: { templateId: tpl?.id ?? null, blocks, vars, subject: subject || null, branchId: branch || null } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['contrato', contractId, 'oficios'] }); toast({ tone: 'success', message: `Ofício nº ${r.label} emitido` }); window.open(`/api/v1/oficios/${r.id}/pdf`, '_blank'); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const shown = (d?.varDefs ?? []).filter((v) => v.key !== 'oficio.numero' && (!tpl || tpl.usedVars.includes(v.key)));
  return (
    <Modal open={open} onClose={onClose} title="Emitir ofício" size="xl"
      footer={d?.templates.length ? <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={issue.isPending} disabled={!blocks || !branch} onClick={() => issue.mutate()}>Emitir ofício nº {d.vars['oficio.numero']}</Button></> : undefined}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d!.templates.length ? (
        <EmptyState title="Nenhum modelo de ofício para esta filial" description="Crie os modelos em Configurações → Modelos → Ofícios." action={<Link to="/settings/modelos?aba=oficios" className="link">Abrir modelos de ofício</Link>} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Modelo" htmlFor="io-tpl"><Select id="io-tpl" value={tplId} onChange={(e) => setTplId(e.target.value)}>{d!.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
            <FormField label="Filial que emite" htmlFor="io-br" hint="Timbrado e numeração dela"><Select id="io-br" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">Escolha</option>{d!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
            <FormField label="Pessoa ligada ao contrato" htmlFor="io-rec" hint="Preenche destinatário e cargo"><Select id="io-rec" value={recipient} onChange={(e) => setRecipient(e.target.value)}><option value="">Digitar abaixo</option>{d!.recipients.map((r) => <option key={r.personId} value={r.personId}>{r.name}{r.title ? ` · ${r.title}` : ''}</option>)}</Select></FormField>
            <FormField label="Assunto (para a lista)" htmlFor="io-subj"><Input id="io-subj" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
          </div>
          <details className="border border-line p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-ink">Dados do ofício (vindos do contrato, ajustáveis)</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{shown.map((v) => (
              <FormField key={v.key} label={v.label} htmlFor={`io-v-${v.key}`}><Input id={`io-v-${v.key}`} className="h-9" value={vars[v.key] ?? ''} onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })} placeholder={v.sample} /></FormField>
            ))}</div>
          </details>
          {blocks && <OfficeEditor blocks={blocks} onChange={setBlocks} preview={preview} varDefs={d!.varDefs} previewWidth={480} />}
          <p className="text-xs text-muted">O texto e a posição ajustados aqui valem só para este ofício. O número é reservado na emissão; o ofício emitido fica guardado como saiu.</p>
        </div>
      )}
    </Modal>
  );
}
