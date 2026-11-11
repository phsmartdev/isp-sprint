/** Comunicados Oficiais (Comunicação Interna): criar, segmentar, publicar, editar (nova versão), encerrar e acompanhar o alcance. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, Loader2, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime, isoToLocalInput, localInputToIso } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { usePeopleMe } from './shared';
import { uploadMedia, type Media } from './feed/api';
import { usePeoplePeople } from './feed/PostEditor';
import { PRIORITY } from './Announcements';

type Audience = { all: boolean; orgUnitIds: string[]; jobTitles: string[]; teamIds: string[]; userIds: string[] };
type Row = { id: string; title: string; body: string; category: string | null; priority: 'informativo' | 'importante' | 'urgente'; audience: Audience; publishAt: string | null; expiresAt: string | null; requireAck: boolean; pinned: boolean; status: 'rascunho' | 'publicado' | 'encerrado'; version: number; createdAt: string; media: Media[]; reach: { eligible: number; viewed: number; acknowledged: number; viewedPct: number | null; ackPct: number | null } };
type Options = { units: { id: string; name: string; kind: string }[]; teams: { id: string; name: string }[]; jobTitles: string[] };
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', encerrado: 'Encerrado' } as const;

export function AdminAnnouncementsPage() {
  const me = usePeopleMe().data;
  const q = useQuery({ queryKey: ['pessoas', 'admin', 'comunicados'], enabled: !!me?.caps.communicate, queryFn: () => api<{ items: Row[] }>('/pessoas/admin/comunicados') });
  const [editing, setEditing] = useState<Row | 'novo' | null>(null);
  const [pending, setPending] = useState<Row | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'publicado' | 'encerrado' }) => api(`/pessoas/admin/comunicados/${id}`, { method: 'PATCH', body: { status: s } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: v.s === 'publicado' ? 'Comunicado publicado' : 'Comunicado encerrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (me && !me.caps.communicate) return <div className="card"><EmptyState title="Sem acesso" description="Comunicados oficiais são publicados pela Comunicação Interna." /></div>;
  if (editing) return <AnnouncementForm initial={editing === 'novo' ? undefined : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('novo')}>Novo comunicado</Button></div>
      {q.isLoading ? <div className="card"><LoadingRows rows={4} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? <div className="card"><EmptyState title="Nenhum comunicado ainda" description="Crie o primeiro comunicado oficial e escolha quem deve receber." /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Comunicado', 'Situação', 'Público elegível', 'Alcance', 'Confirmação', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{q.data.items.map((a) => (
              <tr key={a.id} className="border-t border-line align-top">
                <td className="px-4 py-3"><p className="font-semibold text-ink">{a.title}</p><p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted"><Chip tone={PRIORITY[a.priority].tone}>{PRIORITY[a.priority].label}</Chip>{a.version > 1 && <span>versão {a.version}</span>}{a.publishAt && <span>{fmtDateTime(a.publishAt)}</span>}</p></td>
                <td className="px-4 py-3"><Chip tone={a.status === 'publicado' ? 'green' : 'neutral'}>{STATUS[a.status]}</Chip></td>
                <td className="num px-4 py-3">{a.reach.eligible}</td>
                <td className="num px-4 py-3">{pct(a.reach.viewedPct)} <span className="text-xs text-muted">({a.reach.viewed})</span></td>
                <td className="num px-4 py-3">{a.requireAck ? <>{pct(a.reach.ackPct)} <span className="text-xs text-muted">({a.reach.acknowledged})</span>{a.reach.acknowledged < a.reach.eligible && <button type="button" className="ml-2 text-xs font-semibold text-primary hover:underline" onClick={() => setPending(a)}>pendentes</button>}</> : <span className="text-muted">não pede</span>}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" onClick={() => setEditing(a)} disabled={a.status === 'encerrado'}>Editar</Button>
                  {a.status !== 'publicado' ? <Button size="sm" variant="primary" onClick={() => status.mutate({ id: a.id, s: 'publicado' })}>{a.status === 'encerrado' ? 'Reabrir' : 'Publicar'}</Button> : <Button size="sm" onClick={() => status.mutate({ id: a.id, s: 'encerrado' })}>Encerrar</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pending && <PendingModal a={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

function PendingModal({ a, onClose }: { a: Row; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pessoas', 'admin', 'comunicados', a.id, 'pendentes'], queryFn: () => api<{ items: { id: string; name: string; jobTitle: string | null; viewed: boolean }[] }>(`/pessoas/admin/comunicados/${a.id}/pendentes`) });
  return (
    <Modal open onClose={onClose} title={`Confirmações pendentes · ${a.title}`}>
      {q.isLoading ? <LoadingRows rows={3} /> : !q.data?.items.length ? <p className="text-sm text-muted">Todos confirmaram.</p> : (
        <ul className="divide-y divide-line">{q.data.items.map((p) => <li key={p.id} className="flex items-center justify-between py-2 text-sm"><span className="text-ink">{p.name}{p.jobTitle && <span className="text-muted"> · {p.jobTitle}</span>}</span><span className="text-xs text-muted">{p.viewed ? 'abriu, não confirmou' : 'não abriu'}</span></li>)}</ul>
      )}
    </Modal>
  );
}

function AnnouncementForm({ initial, onDone }: { initial?: Row; onDone: () => void }) {
  const me = usePeopleMe().data;
  const opts = useQuery({ queryKey: ['pessoas', 'admin', 'publicos'], queryFn: () => api<Options>('/pessoas/admin/publicos') });
  const people = usePeoplePeople().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    title: initial?.title ?? '', body: initial?.body ?? '', category: initial?.category ?? '', priority: initial?.priority ?? 'informativo' as Row['priority'],
    audience: initial?.audience ?? { all: true, orgUnitIds: [], jobTitles: [], teamIds: [], userIds: [] } as Audience,
    publishAt: isoToLocalInput(initial?.publishAt ?? null), expiresAt: isoToLocalInput(initial?.expiresAt ?? null), requireAck: initial?.requireAck ?? false, pinned: initial?.pinned ?? true,
  });
  const [media, setMedia] = useState<Media[]>(initial?.media ?? []);
  const [uploading, setUploading] = useState(false);
  const [term, setTerm] = useState('');
  const toggle = (k: 'orgUnitIds' | 'teamIds' | 'jobTitles' | 'userIds', v: string) => setF((x) => ({ ...x, audience: { ...x.audience, [k]: x.audience[k].includes(v) ? x.audience[k].filter((y) => y !== v) : [...x.audience[k], v] } }));
  const body = (publish: boolean) => ({ title: f.title.trim(), body: f.body.trim(), category: f.category.trim() || null, priority: f.priority, audience: f.audience, publishAt: localInputToIso(f.publishAt), expiresAt: localInputToIso(f.expiresAt), requireAck: f.requireAck, pinned: f.pinned, mediaIds: media.map((m) => m.id), ...(initial ? {} : { publish }) });
  const save = useMutation({
    mutationFn: (publish: boolean) => initial ? api(`/pessoas/admin/comunicados/${initial.id}`, { method: 'PATCH', body: body(publish) }) : api('/pessoas/admin/comunicados', { method: 'POST', body: body(publish) }),
    onSuccess: (_r, publish) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: initial ? 'Comunicado atualizado' : publish ? 'Comunicado publicado' : 'Rascunho salvo' }); onDone(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const add = async (files: FileList | null) => {
    if (!files || !me) return;
    setUploading(true);
    try { const up: Media[] = []; for (const file of [...files]) up.push(await uploadMedia(file, me.limits)); setMedia((m) => [...m, ...up]); } catch (e) { toast({ tone: 'error', message: errMsg(e) }); } finally { setUploading(false); }
  };
  const a = f.audience;
  const hits = term.trim().length >= 2 ? people.filter((p) => p.name.toLowerCase().includes(term.trim().toLowerCase()) && !a.userIds.includes(p.id)).slice(0, 6) : [];
  return (
    <form className="card space-y-4 p-5" aria-label={initial ? 'Editar comunicado' : 'Novo comunicado'} onSubmit={(e) => { e.preventDefault(); save.mutate(true); }}>
      <h2 className="text-md font-bold text-ink">{initial ? 'Editar comunicado' : 'Novo comunicado'}</h2>
      {initial?.status === 'publicado' && <p className="text-xs text-muted">Mudar o título ou o texto gera a versão {initial.version + 1}: quem precisa confirmar a leitura confirma de novo.</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <FormField label="Título" htmlFor="an-title" required><Input id="an-title" maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <FormField label="Categoria" htmlFor="an-cat" hint="Ex.: RH, Benefícios, Segurança"><Input id="an-cat" maxLength={60} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></FormField>
        <FormField label="Prioridade" htmlFor="an-pri"><Select id="an-pri" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Row['priority'] })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></FormField>
      </div>
      <FormField label="Conteúdo" htmlFor="an-body" required hint="Aceita **negrito**, _itálico_, listas com - e links"><Textarea id="an-body" rows={6} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>
      <div className="flex flex-wrap items-center gap-2">
        {media.map((m) => <Chip key={m.id}>{m.kind === 'imagem' ? <ImagePlus className="mr-1 inline h-3 w-3" aria-hidden /> : <FileText className="mr-1 inline h-3 w-3" aria-hidden />}{m.filename} <button type="button" aria-label={`Tirar ${m.filename}`} onClick={() => setMedia(media.filter((x) => x.id !== m.id))}><X className="ml-1 inline h-3 w-3" /></button></Chip>)}
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2">{uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}Imagem ou anexo
          <input type="file" multiple className="sr-only" aria-label="Imagem ou anexo do comunicado" accept="image/png,image/jpeg,image/webp,.pdf,.docx,.xlsx,.pptx" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} /></label>
      </div>

      <fieldset className="space-y-3 border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Público</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={a.all} onChange={(e) => setF({ ...f, audience: { ...a, all: e.target.checked } })} />Toda a organização (quem tem o módulo)</label>
        {!a.all && (
          <div className="grid gap-3 lg:grid-cols-3">
            <div><p className="mb-1 text-xs font-semibold text-muted">Unidades e áreas (inclui as de baixo)</p>{opts.data?.units.length ? opts.data.units.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={a.orgUnitIds.includes(u.id)} onChange={() => toggle('orgUnitIds', u.id)} />{u.name} <span className="text-xs text-muted">{u.kind}</span></label>) : <p className="text-xs text-muted">Nenhuma unidade cadastrada.</p>}</div>
            <div><p className="mb-1 text-xs font-semibold text-muted">Times (grupos)</p>{opts.data?.teams.map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={a.teamIds.includes(t.id)} onChange={() => toggle('teamIds', t.id)} />{t.name}</label>)}</div>
            <div><p className="mb-1 text-xs font-semibold text-muted">Cargos</p>{opts.data?.jobTitles.map((j) => <label key={j} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={a.jobTitles.includes(j)} onChange={() => toggle('jobTitles', j)} />{j}</label>)}</div>
            <div className="lg:col-span-3">
              <p className="mb-1 text-xs font-semibold text-muted">Pessoas específicas</p>
              <div className="flex flex-wrap items-center gap-2">
                {a.userIds.map((id) => <Chip key={id}>{people.find((p) => p.id === id)?.name ?? 'Pessoa'} <button type="button" aria-label="Tirar" onClick={() => toggle('userIds', id)}>×</button></Chip>)}
                <div className="relative min-w-[200px] flex-1"><Input aria-label="Adicionar pessoa ao público" className="h-8" placeholder="Nome" value={term} onChange={(e) => setTerm(e.target.value)} />
                  {hits.length > 0 && <ul className="absolute z-20 mt-1 w-full border border-line bg-surface shadow-overlay">{hits.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => { toggle('userIds', p.id); setTerm(''); }}>{p.name}</button></li>)}</ul>}</div>
              </div>
            </div>
          </div>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Publicar em" htmlFor="an-pub" hint="Em branco: agora"><Input id="an-pub" type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} /></FormField>
        <FormField label="Expira em" htmlFor="an-exp" hint="Em branco: sem prazo"><Input id="an-exp" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></FormField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.requireAck} onChange={(e) => setF({ ...f, requireAck: e.target.checked })} />Pedir confirmação de leitura</label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />Fixar no Meu Espaço</label>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancelar</Button>
        {!initial && <Button variant="secondary" loading={save.isPending && save.variables === false} disabled={!f.title.trim() || !f.body.trim()} onClick={() => save.mutate(false)}>Salvar rascunho</Button>}
        <Button type="submit" variant="primary" loading={save.isPending && save.variables === true} disabled={!f.title.trim() || !f.body.trim() || uploading}>{initial ? 'Salvar' : 'Publicar'}</Button>
      </div>
    </form>
  );
}
