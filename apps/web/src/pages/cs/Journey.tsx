/** Jornada do cliente (linha do tempo visual) e apresentação de kickoff (editor, versões, tela cheia, PDF e link). */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, Check, Copy, Eye, EyeOff, FileDown, Link2, MonitorPlay, Plus, RefreshCw, Route as RouteIcon, Save } from 'lucide-react';
import { JOURNEY_PHASES, JOURNEY_PHASE_LABELS, type JourneyPhase } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, isoToLocalInput } from '../../lib/format';
import { Breadcrumb, Button, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { Presenter, SlideView, type Slide } from '../../features/cs/shared';
import { LinksTab, TrailTab } from './JourneyTrailTab';

type Milestone = { id: string; phase: JourneyPhase; key: string; title: string; plannedAt: string | null; doneAt: string | null; ownerId: string | null; ownerName: string | null; notes: string | null; activityId: string | null };
type Data = {
  journey: { id: string; contactId: string; contractId: string | null; templateName: string; status: string; startedAt: string; isNewCustomer: boolean; kickoffAt: string | null; kickoffNotes: string | null; shared: boolean; shareExpiresAt: string | null };
  client: { id: string; name: string }; contract: { id: string; number: string; endAt: string | null } | null; csmName: string | null; canEdit: boolean;
  milestones: Milestone[]; presentation: { id: string; version: number; slides: Slide[]; note: string | null; createdAt: string } | null;
  versions: { id: string; version: number; note: string | null; createdAt: string; by: string | null }[]; users: { id: string; name: string }[];
};

function Timeline({ d, onChanged }: { d: Data; onChanged: () => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [edit, setEdit] = useState<Milestone | null>(null);
  const [f, setF] = useState({ plannedAt: '', ownerId: '', notes: '' });
  const m = useMutation({
    mutationFn: (x: { id: string; body: Record<string, unknown> }) => api(`/cs/milestones/${x.id}`, { method: 'PATCH', body: x.body }),
    onSuccess: () => { onChanged(); setEdit(null); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const done = d.milestones.filter((x) => x.doneAt).length;
  const pct = d.milestones.length ? Math.round((done / d.milestones.length) * 100) : 0;
  return (
    <section className="card p-5" aria-labelledby="jt-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="jt-title" className="text-lg font-bold text-ink">Linha do tempo</h2>
        <div className="flex items-center gap-3"><div className="h-2.5 w-40 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da jornada"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div><span className="num text-sm font-semibold">{pct}% · {done} de {d.milestones.length}</span></div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {JOURNEY_PHASES.map((ph) => {
          const ms = d.milestones.filter((x) => x.phase === ph);
          const phDone = ms.filter((x) => x.doneAt).length;
          return (
            <div key={ph} className="rounded-lg bg-surface-2/60 p-3">
              <p className="mb-3 flex items-center justify-between font-display text-sm font-bold tracking-wide text-primary">{JOURNEY_PHASE_LABELS[ph]}<span className="num font-sans text-xs font-semibold text-muted">{phDone}/{ms.length}</span></p>
              <ol className="relative space-y-2 border-l-2 border-line pl-4">
                {ms.map((x) => {
                  const late = !x.doneAt && x.plannedAt && x.plannedAt < today;
                  return (
                    <li key={x.id} className="relative">
                      <span className={clsx('absolute -left-[23px] top-3 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2', x.doneAt ? 'border-success bg-success' : late ? 'border-danger bg-white' : 'border-primary bg-white')} aria-hidden>{x.doneAt && <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />}</span>
                      <div className={clsx('rounded-md border bg-white p-2.5', late ? 'border-danger/40' : 'border-line')}>
                        <p className={clsx('text-sm font-semibold', x.doneAt ? 'text-muted line-through decoration-1' : 'text-ink')}>{x.title}</p>
                        <p className="text-xs text-muted">{x.doneAt ? `Realizado em ${fmtDate(x.doneAt)}` : x.plannedAt ? `Previsto ${fmtDate(x.plannedAt)}` : 'Sem data (contrato sem fim de vigência)'}{late && <span className="font-semibold text-danger"> · atrasado</span>}{x.ownerName ? ` · ${x.ownerName}` : ''}</p>
                        {x.notes && <p className="mt-1 line-clamp-2 text-xs text-text">{x.notes}</p>}
                        {d.canEdit && (
                          <div className="mt-1.5 flex gap-3 text-xs font-semibold">
                            {!x.doneAt ? <button className="text-primary hover:underline" onClick={() => m.mutate({ id: x.id, body: { done: true } })}>Concluir</button> : <button className="text-muted hover:underline" onClick={() => m.mutate({ id: x.id, body: { done: false } })}>Reabrir</button>}
                            <button className="text-muted hover:underline" onClick={() => { setEdit(x); setF({ plannedAt: x.plannedAt ?? '', ownerId: x.ownerId ?? '', notes: x.notes ?? '' }); }}>Editar</button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.title ?? ''} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate({ id: edit!.id, body: { plannedAt: f.plannedAt || null, ownerId: f.ownerId || null, notes: f.notes || null } })}>Salvar</Button></>}>
        <div className="space-y-4">
          <FormField label="Data prevista" htmlFor="ms-date"><Input id="ms-date" type="date" value={f.plannedAt} onChange={(e) => setF({ ...f, plannedAt: e.target.value })} /></FormField>
          <FormField label="Responsável" htmlFor="ms-owner"><Select id="ms-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">—</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Observações e pendências" htmlFor="ms-notes"><Textarea id="ms-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
        </div>
      </Modal>
    </section>
  );
}

function Editor({ d, onChanged }: { d: Data; onChanged: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [slides, setSlides] = useState<Slide[]>(d.presentation?.slides ?? []);
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [note, setNote] = useState('');
  const [tplName, setTplName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  useEffect(() => { setSlides(d.presentation?.slides ?? []); setDirty(false); }, [d.presentation?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const templates = useQuery({ queryKey: ['cs-slide-templates'], queryFn: () => api<{ items: { id: string; name: string; slides: Slide[] }[] }>('/cs/slide-templates') });
  const cur = slides[sel];
  const pending = useMemo(() => slides.filter((x) => !x.hidden).flatMap((x) => x.pending.map((p) => `${x.title}: ${p}`)), [slides]);
  const upd = (p: Partial<Slide>) => { setSlides(slides.map((x, i) => (i === sel ? { ...x, ...p } : x))); setDirty(true); };
  const move = (dir: -1 | 1) => { const j = sel + dir; if (j < 0 || j >= slides.length) return; const n = [...slides]; [n[sel], n[j]] = [n[j]!, n[sel]!]; setSlides(n); setSel(j); setDirty(true); };
  const save = useMutation({
    mutationFn: (regenerate: boolean) => api(`/cs/journeys/${d.journey.id}/presentation`, { method: 'POST', body: { slides, note, regenerate } }),
    onSuccess: (_, regen) => { setNote(''); setDirty(false); onChanged(); toast({ tone: 'success', message: regen ? 'Apresentação regerada com os dados atuais do CRM (nova versão)' : 'Nova versão salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveTpl = useMutation({
    mutationFn: () => api('/cs/slide-templates', { method: 'POST', body: { name: tplName, slides: slides.map((x) => ({ ...x, body: x.layout === 'capa' ? '[Cliente]\n[Contrato]' : x.body })) } }),
    onSuccess: () => { setTplName(''); void qc.invalidateQueries({ queryKey: ['cs-slide-templates'] }); toast({ tone: 'success', message: 'Modelo salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const share = useMutation({
    mutationFn: (revoke: boolean) => api<{ url: string | null; expiresAt?: string }>(`/cs/journeys/${d.journey.id}/share`, { method: 'POST', body: { revoke } }),
    onSuccess: (r) => { setShareUrl(r.url ? `${window.location.origin}${r.url}` : null); onChanged(); toast({ tone: 'success', message: r.url ? 'Link gerado (vale 30 dias)' : 'Link revogado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!d.presentation) return <Notice>Apresentação ainda não gerada.</Notice>;
  return (
    <section className="space-y-4">
      {!!pending.length && <Notice tone="warning"><span className="font-semibold">Revise antes de apresentar:</span> {pending.length} campo(s) sem dado no CRM ({pending.slice(0, 4).join('; ')}{pending.length > 4 ? '…' : ''}). Nada foi inventado; complete nos slides.</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => setPresenting(true)}>Apresentar</Button>
        <a className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2" href={`/kickoff/${d.journey.id}/pdf`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" />Exportar PDF</a>
        {d.canEdit && <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} loading={share.isPending} onClick={() => share.mutate(false)}>{d.journey.shared ? 'Novo link' : 'Compartilhar link'}</Button>}
        {d.canEdit && d.journey.shared && <Button variant="ghost" onClick={() => share.mutate(true)}>Revogar link</Button>}
        <span className="ml-auto text-sm text-muted">Versão {d.presentation.version} · {fmtDateTime(d.presentation.createdAt)}</span>
      </div>
      {shareUrl && <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{shareUrl}</span><button className="inline-flex items-center gap-1 font-semibold text-primary" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => toast({ tone: 'success', message: 'Link copiado' }))}><Copy className="h-4 w-4" />Copiar</button></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <ol className="card max-h-[640px] space-y-1 overflow-y-auto p-2" aria-label="Slides">
          {slides.map((x, i) => (
            <li key={x.id}><button className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === sel ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-surface-2', x.hidden && 'opacity-50')} onClick={() => setSel(i)} aria-current={i === sel}>
              <span className="num w-5 text-xs text-muted">{i + 1}</span><span className="min-w-0 flex-1 truncate">{x.title}</span>{x.pending.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-[#C2610C]" aria-label="Com pendências" />}{x.hidden && <EyeOff className="h-3.5 w-3.5" aria-label="Oculto" />}
            </button></li>
          ))}
          {d.canEdit && <li><button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-primary hover:bg-surface-2" onClick={() => { setSlides([...slides, { id: `s${Date.now()}`, key: 'livre', title: 'Novo slide', layout: 'texto', body: '- ', hidden: false, pending: [] }]); setSel(slides.length); setDirty(true); }}><Plus className="h-4 w-4" />Adicionar slide</button></li>}
        </ol>
        {cur && (
          <div className="space-y-4">
            <SlideView s={cur} client={d.client.name} />
            {d.canEdit && (
              <div className="card space-y-3 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <FormField label="Título" htmlFor="sl-title" className="min-w-[220px] flex-1"><Input id="sl-title" value={cur.title} onChange={(e) => upd({ title: e.target.value })} /></FormField>
                  <FormField label="Layout" htmlFor="sl-layout"><Select id="sl-layout" value={cur.layout} onChange={(e) => upd({ layout: e.target.value as Slide['layout'] })}><option value="capa">Capa</option><option value="texto">Texto e tópicos</option><option value="duas_colunas">Duas colunas</option><option value="tabela">Tabela</option><option value="encerramento">Encerramento</option></Select></FormField>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Mover para cima" onClick={() => move(-1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" aria-label="Mover para baixo" onClick={() => move(1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" icon={cur.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} onClick={() => upd({ hidden: !cur.hidden })}>{cur.hidden ? 'Mostrar' : 'Ocultar'}</Button>
                  </div>
                </div>
                {cur.layout === 'tabela' ? (
                  <FormField label="Tabela (uma linha por registro; colunas separadas por ;)" htmlFor="sl-table"><Textarea id="sl-table" rows={8} value={(cur.table ?? []).map((r) => r.join(' ; ')).join('\n')} onChange={(e) => upd({ table: e.target.value.split('\n').map((l) => l.split(';').map((c) => c.trim())) })} /></FormField>
                ) : (
                  <FormField label={cur.layout === 'duas_colunas' ? 'Conteúdo (separe as colunas com uma linha só com |; tópicos começam com "- ")' : 'Conteúdo (tópicos começam com "- ")'} htmlFor="sl-body"><Textarea id="sl-body" rows={8} value={cur.body} onChange={(e) => upd({ body: e.target.value })} /></FormField>
                )}
                {cur.pending.length > 0 && <p className="flex flex-wrap items-center gap-2 text-sm text-[#9A5B00]"><AlertTriangle className="h-4 w-4" aria-hidden />Pendente: {cur.pending.join(', ')}<button className="font-semibold text-primary hover:underline" onClick={() => upd({ pending: [] })}>Marcar como revisado</button></p>}
              </div>
            )}
          </div>
        )}
      </div>
      {d.canEdit && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <FormField label="Descrição da versão" htmlFor="sl-note" className="min-w-[240px] flex-1"><Input id="sl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: ajustes após revisão com o comercial" /></FormField>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Salvar nova versão</Button>
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Regerar com dados do CRM</Button>
          {!!templates.data?.items.length && <Select aria-label="Aplicar modelo" className="w-auto" defaultValue="" onChange={(e) => { const t = templates.data!.items.find((x) => x.id === e.target.value); if (t) { setSlides(t.slides.map((x, i) => (i === 0 ? { ...x, body: slides[0]?.body ?? x.body } : x))); setSel(0); setDirty(true); } }}><option value="">Aplicar modelo…</option>{templates.data.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
          <div className="flex items-end gap-2"><FormField label="Salvar como modelo" htmlFor="sl-tpl"><Input id="sl-tpl" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Nome do modelo" /></FormField><Button variant="ghost" disabled={tplName.trim().length < 2} loading={saveTpl.isPending} onClick={() => saveTpl.mutate()}>Salvar modelo</Button></div>
          <p className="w-full text-xs text-muted">Alterações na apresentação não mudam os dados oficiais do contrato. Cada salvamento cria uma versão; as anteriores ficam no histórico.</p>
        </div>
      )}
      {d.versions.length > 1 && <details className="card p-4 text-sm"><summary className="cursor-pointer font-semibold text-ink">Versões ({d.versions.length})</summary><ul className="mt-2 space-y-1">{d.versions.map((v) => <li key={v.id}>v{v.version} · {fmtDateTime(v.createdAt)} · {v.by ?? 'Sistema'}{v.note ? ` · ${v.note}` : ''}</li>)}</ul></details>}
      {presenting && <Presenter slides={slides} client={d.client.name} onClose={() => setPresenting(false)} />}
    </section>
  );
}

function KickoffDialog({ d, open, onClose, onDone }: { d: Data; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ at: isoToLocalInput(new Date().toISOString()), participants: '', notes: '' });
  const m = useMutation({
    mutationFn: () => api(`/cs/journeys/${d.journey.id}/kickoff`, { method: 'POST', body: { at: new Date(f.at).toISOString(), participants: f.participants, notes: f.notes } }),
    onSuccess: () => { onDone(); onClose(); toast({ tone: 'success', message: 'Kickoff registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Registrar reunião de kickoff" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.participants.trim().length < 3 || f.notes.trim().length < 10} loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button></>}>
      <div className="space-y-4">
        <FormField label="Data e hora" htmlFor="ko-at" required><Input id="ko-at" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></FormField>
        <FormField label="Participantes" htmlFor="ko-part" required><Input id="ko-part" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} /></FormField>
        <FormField label="O que foi combinado" htmlFor="ko-notes" required><Textarea id="ko-notes" rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

export function JourneyPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cs-journey', id], queryFn: () => api<Data>(`/cs/journeys/${id}`) });
  const [tab, setTab] = useState<'trilha' | 'jornada' | 'kickoff' | 'links'>('trilha');
  const [ko, setKo] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['cs-journey', id] }); void qc.invalidateQueries({ queryKey: ['cs-trail', id] }); };
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Sucesso do Cliente', to: '/sucesso?t=jornadas' }, { label: d.client.name, to: `/customers/${d.client.id}?t=sucesso` }, { label: 'Jornada' }]} />
      <PageHeader icon={<RouteIcon className="h-9 w-9" strokeWidth={2.2} />} title={`Jornada · ${d.client.name}`} subtitle={`${d.journey.templateName} · ${d.journey.isNewCustomer ? 'cliente novo' : 'cliente da base'} · início ${fmtDate(d.journey.startedAt)}${d.contract ? ` · contrato ${d.contract.number}` : ''}${d.csmName ? ` · CSM ${d.csmName}` : ''}`}
        actions={d.canEdit && !d.journey.kickoffAt ? <Button variant="primary" icon={<CalendarCheck className="h-5 w-5" />} onClick={() => setKo(true)}>Registrar kickoff</Button> : d.journey.kickoffAt ? <span className="text-sm text-muted">Kickoff em {fmtDateTime(d.journey.kickoffAt)}</span> : undefined} />
      {d.contract && <p className="mb-4 text-sm text-muted">Contrato: <Link className="font-semibold text-primary hover:underline" to={`/contracts/${d.contract.id}`}>{d.contract.number}</Link>{d.contract.endAt ? ` · vigência até ${fmtDate(d.contract.endAt)} (os marcos de renovação usam esta data)` : ''}</p>}
      <Tabs label="Jornada" className="mb-5" value={tab} onChange={setTab} tabs={[{ key: 'trilha', label: 'Trilha' }, { key: 'jornada', label: 'Linha do tempo' }, { key: 'kickoff', label: 'Apresentação de kickoff' }, { key: 'links', label: 'Links externos' }]} />
      {tab === 'trilha' ? <TrailTab journeyId={d.journey.id} subtitle={`${d.journey.templateName}${d.contract ? ` · contrato ${d.contract.number}` : ''}`} /> : tab === 'jornada' ? <Timeline d={d} onChanged={refresh} /> : tab === 'kickoff' ? <Editor d={d} onChanged={refresh} /> : <LinksTab journeyId={d.journey.id} />}
      <KickoffDialog d={d} open={ko} onClose={() => setKo(false)} onDone={refresh} />
    </div>
  );
}

/** Página de impressão (PDF pelo navegador): um slide por página. */
export function KickoffPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['cs-journey', id], queryFn: () => api<Data>(`/cs/journeys/${id}`) });
  useEffect(() => { if (q.data) setTimeout(() => window.print(), 400); }, [q.data]);
  if (!q.data) return <p className="p-6 text-sm">Preparando…</p>;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 bg-white p-4 print:p-0">
      <style>{'@page { size: A4 landscape; margin: 8mm } .cs-slide { break-after: page; }'}</style>
      {(q.data.presentation?.slides ?? []).filter((x) => !x.hidden).map((x) => <div key={x.id} className="cs-slide"><SlideView s={x} client={q.data!.client.name} /></div>)}
    </div>
  );
}

/** Link autorizado para o cliente (sem login). */
export function PublicKickoffPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-kickoff', token], retry: false, queryFn: () => api<{ client: string; slides: Slide[] }>(`/public/kickoff/${token}`) });
  const [i, setI] = useState(0);
  if (q.isLoading) return <p className="p-6 text-sm">Carregando…</p>;
  if (q.isError) return <div className="mx-auto max-w-md p-8"><ErrorState error={q.error} /></div>;
  const s = q.data!.slides;
  return (
    <div className="min-h-screen bg-navy p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        {s[i] && <SlideView s={s[i]!} client={q.data!.client} />}
        <div className="flex items-center justify-center gap-4 text-white">
          <Button variant="secondary" size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>Anterior</Button>
          <span className="num text-sm">{i + 1} / {s.length}</span>
          <Button variant="secondary" size="sm" disabled={i >= s.length - 1} onClick={() => setI(i + 1)}>Próximo</Button>
        </div>
      </div>
    </div>
  );
}
