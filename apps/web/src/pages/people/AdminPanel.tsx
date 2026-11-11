/**
 * Painel de Pessoas & Gestão: visão geral agregada do período (sem nomes nem ranking) e gestão de conteúdo
 * com filtros. A moderação pode ocultar, remover ou restaurar com justificativa; comunidade privada de que a pessoa
 * não participa não aparece aqui.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import type { PersonCard } from './shared';

type Panel = { period: { de: string; ate: string }; eligible: number; activeUsers: number; adoptionPct: number; posts: number; activeCommunities: number; recognitions: number; announcements: number; pendingReports: number; decidedReports: number; avgModerationHours: number; caps: { moderate: boolean } };
type ContentRow = { id: string; kind: string; status: string; excerpt: string; author: PersonCard | null; community: { id: string; name: string } | null; publishedAt: string; reactions: number; comments: number; reports: number };
const KIND: Record<string, string> = { social: 'Social', institucional: 'Institucional', conquista: 'Conquista', reconhecimento: 'Reconhecimento' };
const ST: Record<string, { label: string; tone: Tone }> = { publicado: { label: 'No ar', tone: 'green' }, oculto: { label: 'Oculto', tone: 'orange' }, removido: { label: 'Removido', tone: 'red' } };
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function Tile({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = <><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="num mt-1 font-display text-3xl font-bold text-ink">{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</>;
  return to ? <Link to={to} className="card block p-4 hover:border-primary">{body}</Link> : <div className="card p-4">{body}</div>;
}

export function AdminPanelPage() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const q = useQuery({ queryKey: ['pessoas', 'painel', de, ate], queryFn: () => api<Panel>(`/pessoas/admin/painel${qs({ de: de || undefined, ate: ate || undefined })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  return (
    <div className="space-y-5">
      <section aria-label="Visão geral" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-md font-bold text-ink">Visão geral <span className="text-sm font-normal text-muted">{p.period.de.split('-').reverse().join('/')} a {p.period.ate.split('-').reverse().join('/')}</span></h2>
          <label className="text-xs text-muted">De<Input type="date" aria-label="De" className="h-9" value={de || p.period.de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="text-xs text-muted">Até<Input type="date" aria-label="Até" className="h-9" value={ate || p.period.ate} onChange={(e) => setAte(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Colaboradores elegíveis" value={String(p.eligible)} hint="com o módulo liberado" />
          <Tile label="Usuários ativos" value={String(p.activeUsers)} hint="usaram o módulo no período" />
          <Tile label="Taxa de adoção" value={`${n1(p.adoptionPct)}%`} hint="ativos ÷ elegíveis" />
          <Tile label="Publicações" value={String(p.posts)} hint="no período" />
          <Tile label="Comunidades ativas" value={String(p.activeCommunities)} to="/pessoas/comunidades" />
          <Tile label="Reconhecimentos" value={String(p.recognitions)} hint="válidos no período" />
          <Tile label="Comunicados publicados" value={String(p.announcements)} to="/pessoas/admin/comunicados" />
          <Tile label="Denúncias pendentes" value={String(p.pendingReports)} hint={p.decidedReports ? `${p.decidedReports} decididas · média de ${n1(p.avgModerationHours)} h` : 'nenhuma decidida no período'} to={p.caps.moderate ? '/pessoas/admin/moderacao' : undefined} />
        </div>
        <p className="text-xs text-muted">Indicadores sempre agregados: o painel não mostra ranking nem uso individual.</p>
      </section>
      <ContentManager canModerate={p.caps.moderate} />
    </div>
  );
}

function ContentManager({ canModerate }: { canModerate: boolean }) {
  const [f, setF] = useState({ tipo: '', situacao: '', de: '', ate: '' });
  const [act, setAct] = useState<{ row: ContentRow; measure: 'ocultar' | 'remover' | 'manter' } | null>(null);
  const q = useQuery({ queryKey: ['pessoas', 'admin', 'conteudos', f], queryFn: () => api<{ items: ContentRow[]; next: string | null; canModerate: boolean }>(`/pessoas/admin/conteudos${qs({ tipo: f.tipo || undefined, situacao: f.situacao || undefined, de: f.de || undefined, ate: f.ate || undefined })}`) });
  return (
    <section className="card" aria-label="Gestão de conteúdo">
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-4">
        <h2 className="mr-auto text-md font-bold text-ink">Gestão de conteúdo</h2>
        <Select aria-label="Tipo" className="h-9 w-48" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos os tipos</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select aria-label="Situação" className="h-9 w-44" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}><option value="">Toda situação</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Input type="date" aria-label="Publicado desde" className="h-9 w-40" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} />
        <Input type="date" aria-label="Publicado até" className="h-9 w-40" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} />
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <EmptyState title="Nenhuma publicação" description="Ajuste os filtros. Comunidades privadas de que você não participa não aparecem." /> : (
        <ul className="divide-y divide-line">{q.data!.items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Chip tone={ST[r.status]?.tone ?? 'neutral'}>{ST[r.status]?.label ?? r.status}</Chip><Chip>{KIND[r.kind] ?? r.kind}</Chip>
                <span>{r.author?.name}</span>{r.community && <span>· {r.community.name}</span>}<span>· {fmtDateTime(r.publishedAt)}</span>
                <span>· {r.reactions} reações · {r.comments} comentários</span>{r.reports > 0 && <Chip tone="red">{r.reports} denúncia(s)</Chip>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-ink">{r.excerpt || '(só mídia)'}</p>
            </div>
            <div className="flex gap-2">
              {r.status === 'publicado' && <Link to={`/pessoas/publicacao/${r.id}`} className="inline-flex h-8 items-center border border-line px-3 text-sm hover:bg-surface-2">Abrir</Link>}
              {canModerate && r.status === 'publicado' && <><Button size="sm" onClick={() => setAct({ row: r, measure: 'ocultar' })}>Ocultar</Button><Button size="sm" variant="danger" onClick={() => setAct({ row: r, measure: 'remover' })}>Remover</Button></>}
              {canModerate && r.status !== 'publicado' && <Button size="sm" onClick={() => setAct({ row: r, measure: 'manter' })}>Restaurar</Button>}
            </div>
          </li>
        ))}</ul>
      )}
      <DirectAction act={act} onClose={() => setAct(null)} />
    </section>
  );
}

function DirectAction({ act, onClose }: { act: { row: ContentRow; measure: 'ocultar' | 'remover' | 'manter' } | null; onClose: () => void }) {
  const [just, setJust] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api('/pessoas/moderacao/acao', { method: 'POST', body: { targetType: 'publicacao', targetId: act!.row.id, measure: act!.measure, justification: just } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: 'Medida aplicada e registrada' }); setJust(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const title = act?.measure === 'manter' ? 'Restaurar publicação' : act?.measure === 'remover' ? 'Remover publicação' : 'Ocultar publicação';
  return (
    <Modal open={!!act} onClose={onClose} title={title} size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant={act?.measure === 'remover' ? 'danger' : 'primary'} loading={send.isPending} disabled={just.trim().length < 10} onClick={() => send.mutate()}>{title}</Button></>}>
      <label htmlFor="da-just" className="mb-1 block text-sm font-semibold text-ink">Justificativa (o autor recebe)</label>
      <Textarea id="da-just" rows={4} maxLength={2000} value={just} onChange={(e) => setJust(e.target.value)} />
      <p className="mt-1 text-xs text-muted">A ação fica na trilha de auditoria da moderação.</p>
    </Modal>
  );
}
