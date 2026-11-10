/**
 * Central de Playbooks — análise para aprovação (lado a lado com a vigente, decisão, comentários) e histórico de versões
 * (quem fez, quem aprovou, vigência, comparação entre quaisquer duas versões, restaurar uma antiga como novo rascunho).
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, GitCompare, History, RotateCcw } from 'lucide-react';
import { BLOCK_LABELS, VERSION_STATUS_LABELS, type BlockDiff, type VersionStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { BlockView } from '../../features/playbooks/blocks';
import type { Approval } from './Library';

type Compare = { before: { id: string; number: string; status: VersionStatus } | null; after: { id: string; number: string; status: VersionStatus }; metaChanges: string[]; blocks: BlockDiff[] };
const META_LABELS: Record<string, string> = { title: 'Título', description: 'Descrição', keywords: 'Palavras-chave', type: 'Tipo', criticality: 'Criticidade', ownerTeamId: 'Time dono', costCenterId: 'Centro de custo', maintainerId: 'Responsável', visibility: 'Visibilidade', teamIds: 'Times com acesso', costCenterIds: 'Centros de custo com acesso', profiles: 'Perfis com acesso', userIds: 'Pessoas com acesso', reviewPeriod: 'Periodicidade de revisão', reviewCustomDays: 'Dias de revisão', nextReviewOn: 'Próxima revisão', requiresAck: 'Leitura obrigatória', contexts: 'Onde se aplica' };
const CHANGE_TONE: Record<BlockDiff['change'], string> = { adicionado: 'border-l-[#15803D] bg-[#F0FDF4]', removido: 'border-l-danger bg-danger-soft', alterado: 'border-l-[#B45309] bg-[#FFF7E6]', igual: 'border-l-line' };
const CHANGE_LABEL: Record<BlockDiff['change'], string> = { adicionado: 'Adicionado', removido: 'Removido', alterado: 'Alterado', igual: 'Sem mudança' };

/** Comparação lado a lado: antes à esquerda, depois à direita; palavras novas e retiradas marcadas. */
export function CompareView({ data, onlyChanges }: { data: Compare; onlyChanges: boolean }) {
  const rows = onlyChanges ? data.blocks.filter((b) => b.change !== 'igual') : data.blocks;
  const n = { adicionado: 0, removido: 0, alterado: 0, igual: 0 };
  data.blocks.forEach((b) => { n[b.change] += 1; });
  return (
    <div className="space-y-4">
      <p className="text-sm text-text"><b>{n.alterado}</b> alterado(s) · <b>{n.adicionado}</b> adicionado(s) · <b>{n.removido}</b> removido(s){!!data.metaChanges.length && <> · informações: {data.metaChanges.map((k) => META_LABELS[k] ?? k).join(', ')}</>}</p>
      <div className="hidden grid-cols-2 gap-4 text-xs font-semibold text-muted md:grid"><span>{data.before ? `Versão ${data.before.number} (${VERSION_STATUS_LABELS[data.before.status]})` : 'Sem versão anterior'}</span><span>Versão {data.after.number} ({VERSION_STATUS_LABELS[data.after.status]})</span></div>
      {!rows.length && <p className="text-muted">Nenhuma mudança no conteúdo.</p>}
      {rows.map((b) => (
        <div key={b.id + b.change} className={clsx('border-l-4 p-3', CHANGE_TONE[b.change])} aria-label={`${CHANGE_LABEL[b.change]}: ${BLOCK_LABELS[b.type]}`}>
          <p className="mb-2 text-xs font-semibold text-muted">{CHANGE_LABEL[b.change]} · {BLOCK_LABELS[b.type]}</p>
          {b.words && <p className="mb-3 border border-line bg-surface p-2 text-sm leading-relaxed">{b.words.map((w, i) => <span key={i} className={w.op === 'add' ? 'bg-[#BBF7D0] text-ink' : w.op === 'del' ? 'bg-[#FECACA] text-ink line-through' : ''}>{w.text}</span>)}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 bg-surface/70 p-2">{b.before ? <BlockView b={b.before} /> : <span className="text-xs text-muted">—</span>}</div>
            <div className="min-w-0 bg-surface p-2">{b.after ? <BlockView b={b.after} /> : <span className="text-xs text-muted">—</span>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ aprovação
export function PlaybookApprovePage() {
  const { id = '', versionId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['playbooks', 'approvals'], queryFn: () => api<{ items: Approval[] }>('/playbooks/approvals') });
  const cmp = useQuery({ queryKey: ['playbooks', 'compare', versionId], queryFn: () => api<Compare>(`/playbook-versions/${versionId}/compare`) });
  const [only, setOnly] = useState(true);
  const [note, setNote] = useState('');
  const [eff, setEff] = useState('');
  const [comment, setComment] = useState('');
  const item = list.data?.items.find((x) => x.versionId === versionId);
  const decide = useMutation({
    mutationFn: (decision: 'aprovar' | 'devolver' | 'rejeitar') => api<{ status: string }>(`/playbook-versions/${versionId}/decide`, { method: 'POST', body: { decision, note: note || null, effectiveFrom: eff || null, rowVersion: item?.rowVersion } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: ({ homologacao_diretoria: 'Aprovado e enviado à Diretoria', vigente: 'Homologado e publicado', aprovada: 'Homologado: publica na data de vigência', rascunho: 'Devolvido para ajustes', rejeitada: 'Rejeitado' } as Record<string, string>)[r.status] ?? 'Decisão registrada' }); nav('/playbooks?aba=aprovacoes'); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const addComment = useMutation({ mutationFn: () => api(`/playbook-versions/${versionId}/comments`, { method: 'POST', body: { note: comment } }), onSuccess: () => { setComment(''); void qc.invalidateQueries({ queryKey: ['playbooks', 'approvals'] }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (list.isLoading || cmp.isLoading) return <LoadingRows rows={8} />;
  if (cmp.isError) return <ErrorState error={cmp.error} onRetry={() => cmp.refetch()} />;
  if (!item) return (
    <div className="mx-auto max-w-2xl space-y-3"><Link to="/playbooks?aba=aprovacoes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Aprovações</Link><p className="text-text">Esta versão não está mais aguardando a sua decisão.</p><Link className="font-semibold text-primary" to={`/playbooks/${id}/versoes`}>Ver histórico</Link></div>
  );
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link to="/playbooks?aba=aprovacoes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Aprovações</Link>
      <header className="flex flex-wrap items-end gap-4 border-b border-line pb-4">
        <div className="min-w-0 flex-1"><p className="num text-xs font-semibold text-muted">{item.code} · {item.previous ? `v${item.previous} → ` : ''}v{item.number}{item.relevant && ' · mudança relevante'}</p><h1 className="font-display text-3xl font-bold text-ink">{item.title}</h1>
          <p className="mt-1 text-sm text-text">{VERSION_STATUS_LABELS[item.status]} · enviado por {item.requestedBy ?? '—'}{item.requestedAt && ` em ${fmtDateTime(item.requestedAt)}`}</p></div>
        <Link to={`/playbooks/${id}?versao=${versionId}`} className="text-sm font-semibold text-primary">Ler a versão completa</Link>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="O que mudou" className="space-y-3">
          <div className="flex items-center gap-3"><h2 className="font-display text-xl font-bold text-ink">O que mudou</h2><label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Só mudanças</label></div>
          {item.changeSummary && <p className="border-l-4 border-primary bg-primary-soft px-4 py-3 text-sm"><b>Justificativa:</b> {item.changeSummary}</p>}
          <CompareView data={cmp.data!} onlyChanges={only} />
        </section>
        <aside className="space-y-4">
          {item.canDecide ? (
            <div className="space-y-3 border border-line bg-surface p-4">
              <h2 className="font-semibold text-ink">{item.stage === 'gerencia' ? 'Revisão da Gerência' : 'Homologação da Diretoria'}</h2>
              <FormField label="Parecer" htmlFor="ap-n" hint="Obrigatório para devolver ou rejeitar"><Textarea id="ap-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
              {item.stage === 'diretoria' && <FormField label="Vigência a partir de" htmlFor="ap-e" hint={item.effectiveFrom ? `Sugerida: ${fmtDate(item.effectiveFrom)}` : 'Em branco: hoje'}><Input id="ap-e" type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></FormField>}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={decide.isPending && decide.variables === 'aprovar'} onClick={() => decide.mutate('aprovar')}>{item.stage === 'gerencia' ? 'Aprovar' : 'Homologar'}</Button>
                <Button disabled={note.trim().length < 5} loading={decide.isPending && decide.variables === 'devolver'} onClick={() => decide.mutate('devolver')}>Devolver para ajustes</Button>
                {item.stage === 'diretoria' && <Button variant="ghost" disabled={note.trim().length < 5} loading={decide.isPending && decide.variables === 'rejeitar'} onClick={() => decide.mutate('rejeitar')}>Rejeitar</Button>}
              </div>
            </div>
          ) : <p className="border border-line bg-surface p-4 text-sm text-text">{item.mine ? 'Você enviou esta versão: a decisão é de outra pessoa.' : 'Esta etapa não é sua.'}</p>}
          <div className="space-y-3 border border-line bg-surface p-4">
            <h2 className="font-semibold text-ink">Comentários e decisões</h2>
            {!item.comments.length && <p className="text-sm text-muted">Nada ainda.</p>}
            <ol className="space-y-2 text-sm">{item.comments.map((c, i) => <li key={i} className="border-l-2 border-line pl-3"><p className="text-xs text-muted">{c.by ?? '—'} · {fmtDateTime(c.at)} · {c.decision === 'comentario' ? 'comentou' : c.decision}</p>{c.note && <p className="text-text">{c.note}</p>}</li>)}</ol>
            <Textarea aria-label="Novo comentário" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comente sem decidir" />
            <Button size="sm" disabled={comment.trim().length < 2} loading={addComment.isPending} onClick={() => addComment.mutate()}>Comentar</Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ histórico
type VersionRow = { id: string; number: string; status: VersionStatus; author: string | null; createdAt: string; submittedAt: string | null; publishedAt: string | null; validTo: string | null; effectiveFrom: string | null; changeSummary: string | null; relevant: boolean; manager: string | null; managerAt: string | null; director: string | null; directorAt: string | null; decisions: { stage: string; decision: string; note: string | null; by: string | null; at: string }[] };

export function PlaybookVersionsPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const head = useQuery({ queryKey: ['playbooks', 'one', id, 'head'], queryFn: () => api<{ playbook: { code: string; title: string }; can: { edit: boolean }; openVersion: { id: string } | null }>(`/playbooks/${id}?view=0`) });
  const q = useQuery({ queryKey: ['playbooks', 'versions', id], queryFn: () => api<{ items: VersionRow[]; events: { type: string; note: string | null; at: string; by: string | null }[] }>(`/playbooks/${id}/versions`) });
  const a = sp.get('de') ?? '';
  const b = sp.get('para') ?? '';
  const cmp = useQuery({ queryKey: ['playbooks', 'compare', b, a], enabled: !!a && !!b && a !== b, queryFn: () => api<Compare>(`/playbook-versions/${b}/compare?with=${a}`) });
  const restore = useMutation({ mutationFn: (from: string) => api(`/playbooks/${id}/drafts`, { method: 'POST', body: { fromVersionId: from } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); nav(`/playbooks/${id}/editar`); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading || head.isLoading) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  const canRestore = head.data?.can.edit && !head.data.openVersion;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to={`/playbooks/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />{head.data?.playbook.title}</Link>
      <h1 className="flex items-center gap-3 font-display text-3xl font-bold text-ink"><History className="h-7 w-7 text-primary" aria-hidden />Versões</h1>
      <section aria-label="Comparar versões" className="flex flex-wrap items-end gap-3 border border-line bg-surface p-4">
        <GitCompare className="mb-2 h-5 w-5 text-primary" aria-hidden />
        <FormField label="Antes" htmlFor="vc-a"><Select id="vc-a" value={a} onChange={(e) => setSp({ de: e.target.value, para: b })}><option value="">Escolha</option>{items.map((v) => <option key={v.id} value={v.id}>v{v.number} · {VERSION_STATUS_LABELS[v.status]}</option>)}</Select></FormField>
        <FormField label="Depois" htmlFor="vc-b"><Select id="vc-b" value={b} onChange={(e) => setSp({ de: a, para: e.target.value })}><option value="">Escolha</option>{items.map((v) => <option key={v.id} value={v.id}>v{v.number} · {VERSION_STATUS_LABELS[v.status]}</option>)}</Select></FormField>
        {a && b && a === b && <p className="mb-2 text-sm text-muted">Escolha versões diferentes.</p>}
      </section>
      {cmp.isLoading && <LoadingRows rows={4} />}
      {cmp.data && <CompareView data={cmp.data} onlyChanges />}
      <ol className="space-y-3">
        {items.map((v) => (
          <li key={v.id} className={clsx('border bg-surface p-4', v.status === 'vigente' ? 'border-primary' : 'border-line')}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="num font-display text-xl font-bold text-ink">v{v.number}</span>
              <span className={clsx('px-2 py-0.5 text-xs font-bold', v.status === 'vigente' ? 'bg-lime text-navy' : 'bg-surface-2 text-text')}>{VERSION_STATUS_LABELS[v.status]}</span>
              {v.relevant && <span className="text-xs font-semibold text-[#B45309]">Mudança relevante</span>}
              <span className="ml-auto flex gap-2">
                <Link className="text-sm font-semibold text-primary" to={`/playbooks/${id}?versao=${v.id}`}>Ler</Link>
                {items.length > 1 && <button type="button" className="text-sm font-semibold text-primary" onClick={() => { const prev = items[items.indexOf(v) + 1]; setSp({ de: prev?.id ?? items[0]!.id, para: v.id }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Comparar com a anterior</button>}
                {canRestore && ['vigente', 'encerrada', 'rejeitada', 'descartada'].includes(v.status) && v.status !== 'vigente' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} loading={restore.isPending && restore.variables === v.id} onClick={() => restore.mutate(v.id)}>Restaurar como rascunho</Button>}
              </span>
            </div>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-text sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-muted">Autor</dt><dd>{v.author ?? '—'} · {fmtDate(v.createdAt)}</dd></div>
              <div><dt className="text-xs text-muted">Gerência</dt><dd>{v.manager ? `${v.manager} · ${fmtDate(v.managerAt!)}` : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Diretoria</dt><dd>{v.director ? `${v.director} · ${fmtDate(v.directorAt!)}` : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Vigência</dt><dd>{v.publishedAt ? `${fmtDate(v.publishedAt)}${v.validTo ? ` até ${fmtDate(v.validTo)}` : ''}` : v.effectiveFrom ? `a partir de ${fmtDate(v.effectiveFrom)}` : '—'}</dd></div>
            </dl>
            {v.changeSummary && <p className="mt-2 text-sm text-text"><b>O que mudou:</b> {v.changeSummary}</p>}
            {!!v.decisions.length && <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted">Decisões e comentários ({v.decisions.length})</summary><ol className="mt-2 space-y-1">{v.decisions.map((d, i) => <li key={i} className="border-l-2 border-line pl-3"><span className="text-xs text-muted">{d.by ?? '—'} · {fmtDateTime(d.at)} · {d.stage} · {d.decision}</span>{d.note && <p>{d.note}</p>}</li>)}</ol></details>}
          </li>
        ))}
      </ol>
      {!!q.data!.events.length && <details className="border border-line bg-surface p-4 text-sm"><summary className="cursor-pointer font-semibold text-ink">Trilha de auditoria</summary><ol className="mt-3 space-y-1">{q.data!.events.map((e, i) => <li key={i}><span className="text-xs text-muted">{fmtDateTime(e.at)} · {e.by ?? 'Sistema'}</span> — {e.note ?? e.type}</li>)}</ol></details>}
    </div>
  );
}
