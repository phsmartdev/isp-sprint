/**
 * Central de Playbooks — página de leitura: cabeçalho do processo, índice navegável, blocos interativos, jornada guiada,
 * progresso, favoritos, ciência por versão, sugestões e conteúdo relacionado.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, ChevronLeft, FilePenLine, Flag, History, Lightbulb, PauseCircle, PlayCircle } from 'lucide-react';
import { REVIEW_PERIOD_LABELS, VERSION_STATUS_LABELS, VISIBILITY_LABELS, type Block, type ReviewPeriod, type ReviewState, type Visibility, type VersionStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, LoadingRows, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { BlockView } from '../../features/playbooks/blocks';
import { CatIcon, FavButton, ReviewTag } from '../../features/playbooks/shared';
import { TrainingExamSection } from '../../features/playbooks/TrainingExam';

export type ReaderData = {
  playbook: { id: string; code: string; title: string; description: string | null; status: string; suspendedReason: string | null; requiresAck: boolean; category: { id: string; name: string; icon: string } | null; team: string | null; costCenter: string | null; maintainer: string | null; lastReviewOn: string | null; nextReviewOn: string | null; publishedAt: string | null; review: ReviewState; visibility: Visibility };
  version: { id: string; number: string; status: VersionStatus; meta: Record<string, unknown>; rowVersion: number; changeSummary: string | null; live: boolean; effectiveFrom: string | null } | null;
  content: { blocks: Block[] }; sections: { id: string; title: string; start: number; end: number }[];
  openVersion: { id: string; number: string; status: VersionStatus } | null; currentVersionId: string | null;
  me: { favorite: boolean; progress: { section?: string | null; checks?: string[]; done?: string[] }; acked: boolean; ackedAt: string | null };
  related: { id: string; code: string; title: string }[];
  can: { edit: boolean; approve: boolean; suspend: boolean; read: boolean };
};

export function PlaybookReaderPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const versionId = sp.get('versao') ?? undefined;
  const q = useQuery({ queryKey: ['playbooks', 'one', id, versionId ?? ''], queryFn: () => api<ReaderData>(`/playbooks/${id}${versionId ? `?versionId=${versionId}` : ''}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [journey, setJourney] = useState<number | null>(null);
  const [suggest, setSuggest] = useState<'melhoria' | 'desatualizado' | null>(null);
  const [suspend, setSuspend] = useState(false);
  const [checks, setChecks] = useState<string[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const saveTimer = useRef<number>();
  const d = q.data;
  useEffect(() => { if (d) { setChecks(d.me.progress.checks ?? []); setDone(d.me.progress.done ?? []); if ((d.version?.meta?.type as string) === 'jornada' && d.sections.length && journey === null) setJourney(Math.max(0, d.sections.findIndex((s) => s.id === d.me.progress.section))); } }, [d?.version?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = !!d?.version?.live;
  const save = (body: Record<string, unknown>) => {
    if (!live) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void api(`/playbooks/${id}/progress`, { method: 'PUT', body }).catch(() => undefined); }, 500);
  };
  const ack = useMutation({ mutationFn: () => api(`/playbooks/${id}/ack`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: 'Ciência registrada nesta versão' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const newDraft = useMutation({ mutationFn: () => api<{ versionId: string }>(`/playbooks/${id}/drafts`, { method: 'POST', body: {} }), onSuccess: () => nav(`/playbooks/${id}/editar`), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const blocks = d?.content.blocks ?? [];
  const goSection = (sid: string) => { document.getElementById(`s-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); save({ section: sid }); };
  const shown = useMemo(() => (journey !== null && d?.sections[journey] ? blocks.slice(d.sections[journey]!.start, d.sections[journey]!.end) : blocks), [journey, d, blocks]);
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = d.playbook;
  const totalChecks = blocks.filter((b) => b.type === 'checklist').reduce((t, b) => t + (b.type === 'checklist' ? b.items.length : 0), 0);
  const pct = d.sections.length ? Math.round((done.length / d.sections.length) * 100) : totalChecks ? Math.round((checks.length / totalChecks) * 100) : null;
  const onCheck = (k: string, on: boolean) => { const n = on ? [...checks, k] : checks.filter((x) => x !== k); setChecks(n); save({ checks: n }); };
  const markDone = (sid: string) => { const n = done.includes(sid) ? done : [...done, sid]; setDone(n); save({ done: n, section: sid }); };
  const meta: [string, string | null][] = [
    ['Categoria', p.category?.name ?? null], ['Time dono', p.team], ['Centro de custo', p.costCenter], ['Responsável', p.maintainer],
    ['Versão vigente', d.currentVersionId ? (d.version?.live ? `v${d.version.number}` : 'ver abaixo') : 'sem versão publicada'], ['Publicação', p.publishedAt ? fmtDate(p.publishedAt) : null],
    ['Última revisão', p.lastReviewOn ? fmtDate(p.lastReviewOn) : null], ['Próxima revisão', p.nextReviewOn ? fmtDate(p.nextReviewOn) : null],
    ['Público', VISIBILITY_LABELS[p.visibility]], ['Revisão', REVIEW_PERIOD_LABELS[(d.version?.meta?.reviewPeriod as ReviewPeriod) ?? 'anual']],
  ];
  return (
    <div className="mx-auto w-full max-w-7xl">
      <nav aria-label="Caminho" className="mb-4 flex items-center gap-2 text-sm text-muted"><Link to="/playbooks" className="inline-flex items-center gap-1 hover:text-ink"><ChevronLeft className="h-4 w-4" />Playbooks</Link>{p.category && <><span>/</span><Link to={`/playbooks?categoria=${p.category.id}`} className="hover:text-ink">{p.category.name}</Link></>}</nav>

      {p.status === 'suspenso' && <p role="alert" className="mb-4 border-l-4 border-danger bg-danger-soft px-4 py-3 text-sm text-ink"><b>Suspenso administrativamente.</b> {p.suspendedReason}</p>}
      {d.version && !d.version.live && <p className="mb-4 border-l-4 border-primary bg-primary-soft px-4 py-3 text-sm text-ink">Você está vendo a versão <b>{d.version.number}</b> ({VERSION_STATUS_LABELS[d.version.status]}), que não é a vigente.{d.currentVersionId && <> <Link className="font-semibold text-primary hover:underline" to={`/playbooks/${p.id}`}>Ver a vigente</Link></>}</p>}

      <header className="mb-8 border-b border-line pb-6">
        <div className="flex flex-wrap items-start gap-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center bg-navy text-lime"><CatIcon name={p.category?.icon ?? 'book'} className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <p className="num text-sm font-semibold tracking-wide text-muted">{p.code}{d.version && <> · versão {d.version.number}</>} · <ReviewTag s={p.review} /></p>
            <h1 className="font-display text-3xl font-bold leading-tight text-ink">{p.title}</h1>
            {p.description && <p className="mt-2 max-w-3xl text-[15px] text-text">{p.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FavButton id={p.id} on={d.me.favorite} label={p.title} />
            {d.can.edit && (d.openVersion ? <Button icon={<FilePenLine className="h-4 w-4" />} onClick={() => nav(`/playbooks/${p.id}/editar`)}>Continuar v{d.openVersion.number}</Button> : <Button icon={<FilePenLine className="h-4 w-4" />} loading={newDraft.isPending} onClick={() => newDraft.mutate()}>Nova versão</Button>)}
            <Button variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => nav(`/playbooks/${p.id}/versoes`)}>Versões</Button>
            {d.can.suspend && d.currentVersionId && <Button variant="ghost" icon={<PauseCircle className="h-4 w-4" />} onClick={() => setSuspend(true)}>{p.status === 'suspenso' ? 'Reativar' : 'Suspender'}</Button>}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">{meta.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold text-ink">{v ?? '—'}</dd></div>)}</dl>
        {d.version?.live && p.requiresAck && (
          <div className={clsx('mt-5 flex flex-wrap items-center gap-3 border px-4 py-3', d.me.acked ? 'border-[#15803D]/40 bg-[#F0FDF4]' : 'border-[#B45309]/40 bg-[#FFF7E6]')}>
            {d.me.acked ? <p className="flex items-center gap-2 text-sm font-semibold text-[#14532D]"><Check className="h-4 w-4" />Ciência confirmada na versão {d.version.number} em {fmtDateTime(d.me.ackedAt!)}</p>
              : <><p className="flex-1 text-sm text-ink"><b>Leitura obrigatória.</b> Depois de ler, confirme que entendeu esta versão. Abrir a página não conta como ciência.</p><Button variant="primary" icon={<BookOpenCheck className="h-4 w-4" />} loading={ack.isPending} onClick={() => ack.mutate()}>Confirmo que li e entendi</Button></>}
          </div>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Índice">
          {pct !== null && live && <div className="mb-4"><p className="mb-1 text-xs text-muted">Seu progresso <span className="num font-semibold text-ink">{pct}%</span></p><div className="h-1 bg-surface-2"><div className="h-1 bg-primary" style={{ width: `${pct}%` }} /></div></div>}
          {!!d.sections.length && (
            <>
              <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-muted">Índice</p>
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setJourney(journey === null ? Math.max(0, d.sections.findIndex((x) => x.id === d.me.progress.section)) : null)}>{journey === null ? <><PlayCircle className="h-3.5 w-3.5" />Jornada guiada</> : 'Ver tudo'}</button></div>
              <ol className="space-y-0.5 border-l border-line">{d.sections.map((s, i) => (
                <li key={s.id}><button type="button" onClick={() => (journey !== null ? setJourney(i) : goSection(s.id))} className={clsx('-ml-px flex w-full items-start gap-2 border-l-2 px-3 py-1.5 text-left text-sm', (journey === i || (journey === null && d.me.progress.section === s.id)) ? 'border-primary font-semibold text-ink' : 'border-transparent text-text hover:text-ink')}>
                  <span className={clsx('num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[10px]', done.includes(s.id) ? 'bg-[#15803D] text-white' : 'text-muted')}>{done.includes(s.id) ? <Check className="h-3 w-3" /> : i + 1}</span>{s.title}
                </button></li>
              ))}</ol>
              {d.me.progress.section && journey === null && <button type="button" className="mt-3 text-sm font-semibold text-primary hover:underline" onClick={() => goSection(d.me.progress.section!)}>Retomar de onde parei</button>}
            </>
          )}
          <div className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
            <button type="button" className="flex items-center gap-2 font-semibold text-primary hover:underline" onClick={() => setSuggest('melhoria')}><Lightbulb className="h-4 w-4" />Sugerir melhoria</button>
            <button type="button" className="flex items-center gap-2 font-semibold text-primary hover:underline" onClick={() => setSuggest('desatualizado')}><Flag className="h-4 w-4" />Reportar desatualizado</button>
          </div>
          {!!d.related.length && <div className="mt-6 border-t border-line pt-4"><p className="mb-2 text-xs font-semibold text-muted">Relacionados</p><ul className="space-y-1.5 text-sm">{d.related.map((r) => <li key={r.id}><Link className="hover:text-primary" to={`/playbooks/${r.id}`}><span className="num text-xs text-muted">{r.code}</span> {r.title}</Link></li>)}</ul></div>}
        </aside>

        <article className="min-w-0 max-w-3xl space-y-5" aria-label="Conteúdo do playbook">
          {journey !== null && d.sections[journey] && <p className="text-sm font-semibold text-muted">Etapa {journey + 1} de {d.sections.length}</p>}
          {!blocks.length ? <p className="text-muted">Sem conteúdo.</p> : shown.map((b) => <BlockView key={b.id} b={b} checks={checks} onCheck={live ? onCheck : undefined} />)}
          {journey !== null && d.sections[journey] && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} disabled={journey === 0} onClick={() => setJourney(journey - 1)}>Anterior</Button>
              {live && <Button variant={done.includes(d.sections[journey]!.id) ? 'ghost' : 'secondary'} icon={<Check className="h-4 w-4" />} onClick={() => markDone(d.sections[journey]!.id)}>{done.includes(d.sections[journey]!.id) ? 'Etapa concluída' : 'Concluir etapa'}</Button>}
              <Button variant="primary" disabled={journey === d.sections.length - 1} onClick={() => { if (live) markDone(d.sections[journey]!.id); setJourney(journey + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Próxima <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </div>
          )}
          {(live || d.can.edit) && (journey === null || journey === d.sections.length - 1) && <TrainingExamSection playbookId={p.id} title={p.title} />}
        </article>
      </div>
      {suggest && <SuggestModal id={p.id} kind={suggest} onClose={() => setSuggest(null)} />}
      {suspend && <SuspendModal id={p.id} suspended={p.status === 'suspenso'} onClose={() => setSuspend(false)} />}
    </div>
  );
}

function SuggestModal({ id, kind, onClose }: { id: string; kind: 'melhoria' | 'desatualizado'; onClose: () => void }) {
  const [v, setV] = useState({ description: '', excerpt: '', reason: '' });
  const [file, setFile] = useState<File | null>(null);
  const toast = useToast();
  const m = useMutation({
    mutationFn: async () => {
      let fileId: string | null = null;
      if (file) { const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file); }); fileId = (await api<{ id: string }>(`/playbooks/${id}/files`, { method: 'POST', body: { name: file.name, data } })).id; }
      return api(`/playbooks/${id}/suggestions`, { method: 'POST', body: { kind, description: v.description, excerpt: v.excerpt || null, reason: v.reason || null, fileId } });
    },
    onSuccess: () => { toast({ tone: 'success', message: 'Enviado a quem mantém o playbook' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={kind === 'melhoria' ? 'Sugerir melhoria' : 'Reportar conteúdo desatualizado'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.description.trim().length < 10} loading={m.isPending} onClick={() => m.mutate()}>Enviar</Button></>}>
      <p className="mb-3 text-sm text-muted">Vai para quem mantém o playbook. Nada muda no conteúdo vigente até uma nova versão ser aprovada.</p>
      <div className="space-y-3">
        <FormField label={kind === 'melhoria' ? 'O que melhorar' : 'O que está desatualizado'} htmlFor="sg-d" required><Textarea id="sg-d" rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></FormField>
        <FormField label="Trecho relacionado" htmlFor="sg-e"><Textarea id="sg-e" rows={2} value={v.excerpt} onChange={(e) => setV({ ...v, excerpt: e.target.value })} /></FormField>
        <FormField label="Motivo" htmlFor="sg-m"><Textarea id="sg-m" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></FormField>
        <FormField label="Anexo (PDF, PNG, JPG ou Office)" htmlFor="sg-f"><input id="sg-f" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></FormField>
      </div>
    </Modal>
  );
}
function SuspendModal({ id, suspended, onClose }: { id: string; suspended: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/playbooks/${id}/suspend`, { method: 'POST', body: { suspend: !suspended, reason: reason || null } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: suspended ? 'Reativado' : 'Suspenso' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={suspended ? 'Reativar playbook' : 'Suspender playbook'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant={suspended ? 'primary' : 'danger'} disabled={!suspended && reason.trim().length < 10} loading={m.isPending} onClick={() => m.mutate()}>{suspended ? 'Reativar' : 'Suspender'}</Button></>}>
      {suspended ? <p className="text-sm">O playbook volta para quem tem acesso.</p> : <FormField label="Risco que motiva a suspensão (operacional, normativo ou de segurança)" htmlFor="sp-r"><Textarea id="sp-r" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
    </Modal>
  );
}
