/**
 * Oportunidade → Projeto de Licitação: progresso, etapa atual, próximo marco, pendências e atrasos, áreas envolvidas,
 * histórico e acesso ao projeto completo. Uma oportunidade pode ter vários projetos (o primeiro nasce sozinho).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, FolderKanban, Plus } from 'lucide-react';
import { BID_AREA_LABELS, type BidArea } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type BidProject = {
  id: string; code: number; name: string; status: string; origin: 'auto' | 'manual'; attention: string | null; coordinatorId: string; coordinator: string;
  templateVersion: number | null; startOn: string; dueOn: string | null; progress: { done: number; total: number };
  currentPhase: { name: string; dueOn: string | null; deliverable: string | null } | null; nextMilestone: { name: string; dueOn: string | null } | null;
  pending: number; lateCount: number; late: { title: string; dueOn: string | null; area: string | null }[]; areas: string[];
  history: { type: string; summary: string; at: string }[];
};
type Resp = { items: BidProject[]; canSeeProjects: boolean };
const STATUS: Record<string, string> = { planejamento: 'Planejamento', em_andamento: 'Em andamento', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Arquivado' };
const areaLabel = (a: string | null) => (a ? BID_AREA_LABELS[a as BidArea] ?? a : '');

const useBidProjects = (oppId: string) => useQuery({ queryKey: ['oportunidade', oppId, 'licitacao-projetos'], queryFn: () => api<Resp>(`/opportunities/${oppId}/licitacao/projetos`) });

/** Aviso quando a oportunidade deixou de ser licitação: continuar ou arquivar o projeto. */
export function BidProjectAttention({ oppId }: { oppId: string }) {
  const q = useBidProjects(oppId);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (v: { id: string; decision: 'continuar' | 'arquivar' }) => api(`/projects/${v.id}/licitacao/decisao`, { method: 'POST', body: { decision: v.decision } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['oportunidade', oppId, 'licitacao-projetos'] }); toast({ tone: 'success', message: v.decision === 'arquivar' ? 'Projeto arquivado' : 'Projeto mantido' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pend = q.data?.items.filter((p) => p.attention === 'modalidade_alterada') ?? [];
  if (!pend.length) return null;
  return (
    <>{pend.map((p) => (
      <div key={p.id} role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-ink">
        <span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden />A oportunidade deixou de ser licitação. O que fazer com o projeto <b>{p.name}</b>? O histórico fica preservado.</span>
        <span className="flex gap-2"><Button size="sm" loading={m.isPending} onClick={() => m.mutate({ id: p.id, decision: 'continuar' })}>Continuar o projeto</Button><Button size="sm" variant="danger" loading={m.isPending} onClick={() => m.mutate({ id: p.id, decision: 'arquivar' })}>Arquivar o projeto</Button></span>
      </div>
    ))}</>
  );
}

export function BidProjectsTab({ oppId }: { oppId: string }) {
  const q = useBidProjects(oppId);
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4" aria-label="Projeto de Licitação">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">O primeiro projeto nasce com a oportunidade, a partir do modelo publicado. Cada lote ou frente pode ter o seu.</p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden />Novo projeto de licitação</Button>
      </div>
      {!d.items.length ? <EmptyState title="Nenhum projeto de licitação" description="Crie o projeto para organizar etapas, áreas e entregáveis desta licitação." /> : d.items.map((p) => <ProjectCard key={p.id} p={p} oppId={oppId} canOpen={d.canSeeProjects} />)}
      {creating && <NewProjectModal oppId={oppId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectCard({ p, oppId, canOpen }: { p: BidProject; oppId: string; canOpen: boolean }) {
  const lk = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const coord = useMutation({
    mutationFn: (coordinatorId: string) => api(`/projects/${p.id}/licitacao/coordenador`, { method: 'PUT', body: { coordinatorId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['oportunidade', oppId, 'licitacao-projetos'] }); toast({ tone: 'success', message: 'Coordenação atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pct = p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  return (
    <article className="rounded-md border border-line p-4" aria-label={`Projeto ${p.name}`}>
      <header className="space-y-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-ink"><FolderKanban className="h-4 w-4 text-primary" aria-hidden />{p.name}<span className="text-xs font-normal text-muted">PRJ-{p.code}</span></h3>
          <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted">
            <Chip tone={p.status === 'cancelado' ? 'neutral' : 'blue'}>{STATUS[p.status] ?? p.status}</Chip>
            <Chip>{p.origin === 'auto' ? 'Criado com a oportunidade' : 'Criado à mão'}</Chip>
            {p.templateVersion && <Chip>Modelo v{p.templateVersion}</Chip>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Coordenador" htmlFor={`bp-c-${p.id}`}><Select id={`bp-c-${p.id}`} className="h-9" value={p.coordinatorId} disabled={coord.isPending} onChange={(e) => coord.mutate(e.target.value)}>{(lk.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}{!lk.data?.users.some((u) => u.id === p.coordinatorId) && <option value={p.coordinatorId}>{p.coordinator}</option>}</Select></FormField>
          {canOpen && <Link to={`/projetos/${p.id}`} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-sm font-semibold text-primary hover:bg-surface-2">Abrir projeto<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link>}
        </div>
      </header>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted"><span>Progresso</span><span className="tabular-nums">{p.progress.done} de {p.progress.total} · {pct}%</span></div>
        <div className="mt-1 h-2 rounded-full bg-surface-2" role="progressbar" aria-label="Progresso do projeto" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted">Etapa atual</dt><dd className="font-semibold text-ink">{p.currentPhase?.name ?? 'Todas concluídas'}</dd>{p.currentPhase?.deliverable && <dd className="text-xs text-muted">{p.currentPhase.deliverable}</dd>}</div>
        <div><dt className="text-xs text-muted">Próximo marco</dt><dd className="font-semibold text-ink">{p.nextMilestone ? `${fmtDate(p.nextMilestone.dueOn)}` : '—'}</dd>{p.nextMilestone && <dd className="text-xs text-muted">{p.nextMilestone.name}</dd>}</div>
        <div><dt className="text-xs text-muted">Entregas pendentes</dt><dd className="font-semibold tabular-nums text-ink">{p.pending}</dd></div>
        <div><dt className="text-xs text-muted">Atrasadas</dt><dd className={p.lateCount ? 'font-semibold tabular-nums text-danger' : 'font-semibold tabular-nums text-ink'}>{p.lateCount}</dd></div>
      </dl>
      {p.areas.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="text-xs text-muted">Áreas envolvidas:</span>{p.areas.map((a) => <Chip key={a}>{areaLabel(a)}</Chip>)}</div>}
      {p.late.length > 0 && (
        <div className="mt-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-danger">Atrasadas</h4>
          <ul className="mt-1 divide-y divide-line text-sm">{p.late.map((t, i) => <li key={i} className="flex justify-between gap-2 py-1"><span className="text-ink">{t.title}{t.area && <span className="text-xs text-muted"> · {areaLabel(t.area)}</span>}</span><span className="tabular-nums text-danger">{fmtDate(t.dueOn)}</span></li>)}</ul>
        </div>
      )}
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-semibold text-muted">Histórico</summary>
        <ul className="mt-1 space-y-1">{p.history.map((h, i) => <li key={i} className="text-xs text-muted"><span className="tabular-nums">{fmtDateTime(h.at)}</span> · <span className="text-ink">{h.summary}</span></li>)}</ul>
      </details>
    </article>
  );
}

function NewProjectModal({ oppId, onClose }: { oppId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/licitacao/projetos`, { method: 'POST', body: { name: name.trim() || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['oportunidade', oppId, 'licitacao-projetos'] }); toast({ tone: 'success', message: 'Projeto de licitação criado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Novo projeto de licitação" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Criar projeto</Button></>}>
      <FormField label="Nome do projeto" htmlFor="bp-name" hint="Ex.: Lote 2 – Telefonia. Vazio: usa o título da oportunidade."><Input id="bp-name" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></FormField>
      <p className="mt-2 text-xs text-muted">Criado a partir da versão publicada do modelo de licitação, com você como coordenador (trocável depois).</p>
    </Modal>
  );
}
