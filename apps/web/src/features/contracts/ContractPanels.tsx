/** Ficha do contrato: documentos (com versões e acesso por setor), versões, notificações e linha do tempo. */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, FileUp, Lock, Trash2 } from 'lucide-react';
import { DOC_TYPES, SECTORS, SECTOR_LABELS, documentName, type Sector } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { fileToBase64, fmtBytes } from '../../lib/files';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { CHANGE_LABEL, errMsg, todayIso, type Alert, type ContractDetail, type Version } from './shared';

type Doc = { id: string; groupId: string; version: number; category: string; name: string; docDate: string; summary: string; mime: string; size: number; folder: string; restrictedTo: Sector[]; signed: boolean; processId: string | null; createdAt: string; uploadedBy: string | null; canOpen: boolean; latest: boolean };
const MIMES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function UploadModal({ c, open, onClose, category: cat0, processId, newVersionOf }: { c: ContractDetail; open: boolean; onClose: () => void; category?: string; processId?: string; newVersionOf?: Doc | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(newVersionOf?.category ?? cat0 ?? 'CONTRATO');
  const [docDate, setDocDate] = useState(todayIso());
  const [summary, setSummary] = useState(newVersionOf?.summary ?? c.current.object.slice(0, 80));
  const [signed, setSigned] = useState(['CONTRATO', 'ADITIVO'].includes(cat0 ?? ''));
  const [restricted, setRestricted] = useState<Sector[]>(newVersionOf?.restrictedTo ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = documentName(docDate || todayIso(), category, c.contact.name, summary || '…');
  const up = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Escolha o arquivo.');
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIMES[ext];
      if (!mime) throw new Error('Use PDF, DOCX, PNG ou JPG.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
      return api<{ name: string; version: number }>(`/contracts/${c.id}/documents`, { method: 'POST', body: { category, docDate, summary, mime, data: await fileToBase64(file), signed, restrictedTo: restricted, groupId: newVersionOf?.groupId, processId } });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract-docs', c.id] }); qc.invalidateQueries({ queryKey: ['contract', c.id] }); toast({ tone: 'success', message: `Documento salvo: ${r.name}${r.version > 1 ? ` (v${r.version})` : ''}` }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={newVersionOf ? 'Nova versão do documento' : 'Enviar documento'} size="md" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={up.isPending} disabled={!file || summary.trim().length < 2} onClick={() => { setError(null); up.mutate(); }}>Salvar documento</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Tipo do documento" htmlFor="up-cat"><Select id="up-cat" value={category} disabled={!!newVersionOf} onChange={(e) => setCategory(e.target.value)}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
          <FormField label="Data do documento" htmlFor="up-date"><Input id="up-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></FormField>
          <FormField label="Resumo do objeto" htmlFor="up-sum" className="sm:col-span-2"><Input id="up-sum" maxLength={120} value={summary} onChange={(e) => setSummary(e.target.value)} /></FormField>
        </div>
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm"><span className="text-muted">Nome: </span><span className="font-semibold text-ink">{preview}</span></p>
        <div>
          <input ref={fileRef} type="file" className="sr-only" id="up-file" accept=".pdf,.docx,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>{file ? `${file.name} (${fmtBytes(file.size)})` : 'Escolher arquivo'}</Button>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />Documento assinado (versão final)</label>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Quem pode abrir</legend>
          <p className="mb-2 text-xs text-muted">Sem marcar nada, todos com acesso ao contrato. Marcando, só os setores escolhidos (e a gerência).</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{SECTORS.map((x) => <label key={x} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={restricted.includes(x)} onChange={(e) => setRestricted(e.target.checked ? [...restricted, x] : restricted.filter((y) => y !== x))} />{SECTOR_LABELS[x]}</label>)}</div>
        </fieldset>
      </div>
    </Modal>
  );
}

export function DocumentsPanel({ c, onUpload }: { c: ContractDetail; onUpload: (opts: { newVersionOf?: Doc }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contract-docs', c.id], queryFn: () => api<{ items: Doc[] }>(`/contracts/${c.id}/documents`) });
  const del = useMutation({ mutationFn: (id: string) => api(`/contracts/${c.id}/documents/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-docs', c.id] }); toast({ tone: 'success', message: 'Documento removido da lista' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const folder = useMutation({ mutationFn: (d: Doc) => api(`/contracts/${c.id}/documents/${d.id}`, { method: 'PATCH', body: { folder: d.folder === 'Ativos' ? 'Encerrados' : 'Ativos' } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['contract-docs', c.id] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const groups = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of q.data?.items ?? []) m.set(d.groupId, [...(m.get(d.groupId) ?? []), d]);
    return [...m.values()].map((list) => list.sort((a, b) => b.version - a.version));
  }, [q.data]);
  if (q.isLoading) return <LoadingRows rows={3} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Nome padrão: AAMMDD - TIPO DO DOCUMENTO - CLIENTE - RESUMO DO OBJETO. Nova versão não substitui a anterior.</p>
        <Button variant="primary" icon={<FileUp className="h-4 w-4" />} onClick={() => onUpload({})}>Enviar documento</Button>
      </div>
      {!groups.length ? <EmptyState title="Nenhum documento" description="Envie o contrato assinado, aditivos, ofícios e garantias." /> : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {groups.map((list) => {
            const d = list[0]!;
            return (
              <li key={d.groupId} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink">{d.name}</p>
                    <p className="text-sm text-muted">v{d.version} · {fmtBytes(d.size)} · {d.uploadedBy ?? '—'} em {fmtDateTime(d.createdAt)}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone="blue">{d.category}</Chip>
                      {d.signed && <Chip tone="green">Assinado</Chip>}
                      <Chip tone={d.folder === 'Encerrados' ? 'neutral' : 'purple'}>Pasta {d.folder}</Chip>
                      {d.restrictedTo.length > 0 && <Chip tone="orange"><Lock className="h-3 w-3" aria-hidden />{d.restrictedTo.map((x) => SECTOR_LABELS[x]).join(', ')}</Chip>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {d.canOpen ? <a className="rounded-sm p-2 text-ink hover:bg-surface-2" href={`/api/v1/contracts/${c.id}/documents/${d.id}/download`} aria-label={`Baixar ${d.name}`}><Download className="h-4 w-4" /></a> : <span className="p-2 text-muted" title="Restrito a outro setor"><Lock className="h-4 w-4" /></span>}
                    {d.canOpen && <Button size="sm" onClick={() => onUpload({ newVersionOf: d })}>Nova versão</Button>}
                    <Button size="sm" variant="ghost" onClick={() => folder.mutate(d)}>{d.folder === 'Ativos' ? 'Mover p/ Encerrados' : 'Mover p/ Ativos'}</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remover ${d.name}`} icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => { if (window.confirm('Remover este documento da lista? Ele continua guardado no histórico.')) del.mutate(d.id); }} />
                  </div>
                </div>
                {list.length > 1 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-primary">Versões anteriores ({list.length - 1})</summary>
                    <ul className="mt-1 space-y-1">
                      {list.slice(1).map((o) => <li key={o.id} className="flex items-center gap-2 text-sm text-text">v{o.version} · {fmtDateTime(o.createdAt)} · {o.uploadedBy}{o.canOpen && <a className="link" href={`/api/v1/contracts/${c.id}/documents/${o.id}/download`}>baixar</a>}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const VFIELDS: [keyof Version, string, (v: Version) => string][] = [
  ['number', 'Número', (v) => v.number], ['signedAt', 'Assinatura', (v) => fmtDate(v.signedAt)], ['startAt', 'Início', (v) => fmtDate(v.startAt)], ['endAt', 'Término', (v) => fmtDate(v.endAt)],
  ['activationAt', 'Ativação', (v) => fmtDate(v.activationAt)], ['billingStartAt', 'Faturamento', (v) => fmtDate(v.billingStartAt)], ['monthlyCents', 'Mensal', (v) => fmtBRL(v.monthlyCents)], ['totalCents', 'Global', (v) => fmtBRL(v.totalCents)],
];
export function VersionsPanel({ c }: { c: ContractDetail }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr><th className="px-3 py-2 font-medium">Versão</th><th className="px-3 py-2 font-medium">Mudança</th>{VFIELDS.map(([, l]) => <th key={l} className="px-3 py-2 font-medium">{l}</th>)}<th className="px-3 py-2 font-medium">Registrada em</th></tr>
        </thead>
        <tbody>
          {c.versions.map((v, i) => {
            const prev = c.versions[i + 1];
            return (
              <tr key={v.id} className="border-t border-line align-top">
                <td className="px-3 py-2 font-semibold text-ink">v{v.version}{v.version === c.currentVersion && <span className="ml-1 text-xs font-normal text-success">atual</span>}</td>
                <td className="px-3 py-2"><span className="font-semibold text-ink">{CHANGE_LABEL[v.changeKind] ?? v.changeKind}</span>{v.reason && <span className="block text-xs text-muted">{v.reason}</span>}</td>
                {VFIELDS.map(([k, l, f]) => <td key={l} className={clsx('num px-3 py-2', prev && JSON.stringify(prev[k]) !== JSON.stringify(v[k]) ? 'bg-warning-soft font-semibold text-ink' : 'text-text')}>{f(v)}</td>)}
                <td className="px-3 py-2 text-muted">{fmtDateTime(v.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Células destacadas mudaram em relação à versão anterior. Versões nunca são alteradas nem apagadas.</p>
    </div>
  );
}

export function AlertsPanel({ c }: { c: ContractDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [text, setText] = useState('');
  const res = useMutation({ mutationFn: () => api(`/contracts/alerts/${resolving!.id}/resolve`, { method: 'POST', body: { resolution: text } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); setResolving(null); setText(''); toast({ tone: 'success', message: 'Notificação concluída' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (!c.alerts.length) return <EmptyState title="Nenhuma notificação" description="Alertas de renovação, reajuste, garantia, documentos, assinaturas, provisionamento, implantação e encerramento aparecem aqui." />;
  return (
    <>
      <AlertList alerts={c.alerts} onResolve={setResolving} />
      <Modal open={!!resolving} onClose={() => setResolving(null)} title={`Concluir: ${resolving?.label ?? ''}`} size="sm" footer={<><Button onClick={() => setResolving(null)}>Voltar</Button><Button variant="primary" loading={res.isPending} disabled={text.trim().length < 3} onClick={() => res.mutate()}>Concluir</Button></>}>
        <FormField label="Providência tomada" htmlFor="al-res" required><Textarea id="al-res" value={text} onChange={(e) => setText(e.target.value)} /></FormField>
      </Modal>
    </>
  );
}

export function AlertList({ alerts, onResolve, showContract }: { alerts: Alert[]; onResolve?: (a: Alert) => void; showContract?: boolean }) {
  const today = todayIso();
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {alerts.map((a) => {
        const late = a.status === 'aberto' && a.dueAt && a.dueAt < today;
        return (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{a.label}{showContract && a.number ? <a className="link ml-2 font-normal" href={`/contracts/${a.contractId}`}>{a.number} · {a.clientName}</a> : null}</p>
              <p className="text-sm text-text">{a.detail ?? '—'}</p>
              <p className="text-xs text-muted">Criado {fmtDateTime(a.createdAt)}{a.dueAt ? ` · prazo ${fmtDate(a.dueAt)}` : ''}{a.ownerName ? ` · responsável ${a.ownerName}` : ''}{a.activityIds.length ? ` · ${a.activityIds.length} tarefa(s)` : ''}</p>
              {a.emails.length > 0 && <p className="text-xs text-muted">E-mails: {a.emails.map((e) => `${e.to} (${e.status === 'enviado' ? 'enviado' : e.status === 'nao_configurado' ? 'SMTP não configurado' : 'falhou'})`).join(', ')}</p>}
              {a.resolution && <p className="text-xs text-success">{a.resolution} · {fmtDateTime(a.resolvedAt)}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Chip tone={a.status === 'aberto' ? (late ? 'red' : 'yellow') : a.status === 'concluido' ? 'green' : 'neutral'}>{a.status === 'aberto' ? (late ? 'Atrasado' : 'Aberto') : a.status === 'concluido' ? 'Concluído' : 'Cancelado'}</Chip>
              {a.status === 'aberto' && onResolve && <Button size="sm" onClick={() => onResolve(a)}>Concluir</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Timeline = { events: { id: string; type: string; summary: string; at: string; actor: string | null }[]; emails: { id: string; kind: string; to: string; cc: string | null; subject: string; status: string; error: string | null; at: string }[]; tasks: { id: string; title: string; dueAt: string | null; completedAt: string | null; owner: string | null }[] };
export function TimelinePanel({ c }: { c: ContractDetail }) {
  const q = useQuery({ queryKey: ['contract-timeline', c.id, c.currentVersion, c.stage], queryFn: () => api<Timeline>(`/contracts/${c.id}/timeline`) });
  const [f, setF] = useState<'tudo' | 'emails' | 'tarefas'>('tudo');
  if (q.isLoading || !q.data) return <LoadingRows rows={5} />;
  const items = [
    ...q.data.events.map((e) => ({ id: e.id, at: e.at, kind: 'evento', title: e.summary, sub: e.actor ?? 'Sistema' })),
    ...(f !== 'tarefas' ? q.data.emails.map((e) => ({ id: e.id, at: e.at, kind: 'email', title: `E-mail “${e.subject}” para ${e.to}${e.cc ? ` (cópia ${e.cc})` : ''}`, sub: e.status === 'enviado' ? 'Enviado' : e.status === 'ignorado' ? 'Não enviado: SMTP não configurado' : `Falhou: ${e.error ?? ''}` })) : []),
    ...(f !== 'emails' ? q.data.tasks.map((t) => ({ id: t.id, at: t.dueAt ?? '', kind: 'tarefa', title: `Tarefa: ${t.title}`, sub: `${t.owner ?? ''}${t.dueAt ? ` · prazo ${fmtDate(t.dueAt)}` : ''}${t.completedAt ? ' · concluída' : ' · aberta'}` })) : []),
  ].filter((x) => f === 'tudo' || (f === 'emails' ? x.kind === 'email' : x.kind === 'tarefa')).sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <div>
      <div className="mb-3 flex gap-2" role="group" aria-label="Filtrar linha do tempo">
        {(['tudo', 'emails', 'tarefas'] as const).map((k) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={clsx('rounded-full border px-3 py-1 text-sm font-semibold', f === k ? 'border-primary bg-primary text-white' : 'border-line text-ink')}>{k === 'tudo' ? 'Tudo' : k === 'emails' ? 'E-mails' : 'Tarefas'}</button>)}
      </div>
      <ol className="relative space-y-3 border-l-2 border-line pl-5">
        {items.map((x) => (
          <li key={`${x.kind}-${x.id}`} className="relative">
            <span className={clsx('absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface', x.kind === 'email' ? 'bg-purple' : x.kind === 'tarefa' ? 'bg-warning' : 'bg-primary')} aria-hidden />
            <p className="text-sm text-ink">{x.title}</p>
            <p className="text-xs text-muted">{x.at ? fmtDateTime(x.at) : ''} · {x.sub}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
