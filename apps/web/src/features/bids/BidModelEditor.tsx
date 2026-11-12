/**
 * Configurações → Modelos → Projeto de licitação: o rito em Etapas → Macrotarefas → Tarefas, com área, obrigatoriedade,
 * entregáveis, critério de aceite e prazos. Versões: rascunho → em aprovação → publicado → arquivado. Publicar não
 * muda os projetos já criados (cada projeto guarda a própria cópia).
 */
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import { BID_AREAS, BID_AREA_LABELS, MODEL_STATUS_LABELS, OFFICIAL_DATES, modelProblems, newModelKey, withDefaultAnchors, type BidModelDef, type BidModelMacro, type BidModelPhase, type ModelStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Version = { id: string; version: number; status: ModelStatus; def: BidModelDef; notes: string | null; author: string | null; createdAt: string; publishedAt: string | null; submittedAt: string | null; reviewNote: string | null; rowVersion: number; problems: string[] };
type Data = { template: { id: string; name: string; description: string | null; publishedVersion: number | null }; canEdit: boolean; canPublish: boolean; versions: Version[] };
const TONE: Record<ModelStatus, 'neutral' | 'orange' | 'green' | 'blue'> = { rascunho: 'blue', em_aprovacao: 'orange', publicado: 'green', arquivado: 'neutral' };

const move = <T,>(arr: T[], from: number, to: number) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(Math.max(0, Math.min(a.length, to)), 0, x!); return a; };

export function BidModelEditor() {
  const q = useQuery({ queryKey: ['modelo-licitacao'], queryFn: () => api<Data>('/modelos-projeto/licitacao') });
  const [sel, setSel] = useState<number | null>(null);
  const [def, setDef] = useState<BidModelDef | null>(null);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [decide, setDecide] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const d = q.data;
  const v = d?.versions.find((x) => x.version === sel) ?? d?.versions.find((x) => x.status === 'rascunho' || x.status === 'em_aprovacao') ?? d?.versions.find((x) => x.version === d.template.publishedVersion) ?? d?.versions[0];
  useEffect(() => { if (v) { setDef(withDefaultAnchors(structuredClone(v.def))); setNotes(v.notes ?? ''); setDirty(false); } }, [v?.id, v?.rowVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = !!d?.canEdit && v?.status === 'rascunho';
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['modelo-licitacao'] }); toast({ tone: 'success', message: msg }); };
  const fail = (e: unknown) => toast({ tone: 'error', message: errMsg(e) });
  const create = useMutation({ mutationFn: () => api<Version>('/modelos-projeto/licitacao/versoes', { method: 'POST', body: { fromVersion: v!.version } }), onSuccess: (r) => { setSel(r.version); done(`Versão ${r.version} criada em rascunho`); }, onError: fail });
  const save = useMutation({ mutationFn: () => api(`/modelos-projeto/licitacao/versoes/${v!.version}`, { method: 'PUT', body: { def, notes: notes || null, rowVersion: v!.rowVersion } }), onSuccess: () => { setDirty(false); done('Rascunho salvo'); }, onError: fail });
  const submit = useMutation({ mutationFn: async () => { if (dirty) await save.mutateAsync(); await qc.refetchQueries({ queryKey: ['modelo-licitacao'] }); return api(`/modelos-projeto/licitacao/versoes/${v!.version}/enviar`, { method: 'POST' }); }, onSuccess: () => done('Enviado para aprovação'), onError: fail });
  const discard = useMutation({ mutationFn: () => api(`/modelos-projeto/licitacao/versoes/${v!.version}/descartar`, { method: 'POST' }), onSuccess: () => { setSel(null); done('Rascunho descartado'); }, onError: fail });
  const problems = useMemo(() => (def ? modelProblems(def) : []), [def]);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d || !v || !def) return null;
  const up = (f: (x: BidModelDef) => BidModelDef) => { setDef((x) => (x ? f(structuredClone(x)) : x)); setDirty(true); };
  const totals = { phases: def.phases.length, macros: def.phases.reduce((a, p) => a + p.macros.length, 0), tasks: def.phases.reduce((a, p) => a + p.macros.reduce((b, m) => b + m.tasks.length, 0), 0), days: def.phases.reduce((a, p) => a + p.durationDays, 0) };
  const byArea = BID_AREAS.map((a) => ({ a, n: def.phases.reduce((t, p) => t + p.macros.filter((m) => m.area === a).length, 0) })).filter((x) => x.n);
  const open = d.versions.some((x) => x.status === 'rascunho' || x.status === 'em_aprovacao');
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-bold text-ink">{d.template.name}</h2><p className="text-sm text-muted">Novos projetos de licitação usam a versão publicada (v{d.template.publishedVersion}). Publicar uma nova versão não altera os projetos já criados.</p></div>
          <FormField label="Versão" htmlFor="bm-ver"><Select id="bm-ver" className="h-9" value={v.version} onChange={(e) => setSel(Number(e.target.value))}>{d.versions.map((x) => <option key={x.id} value={x.version}>v{x.version} · {MODEL_STATUS_LABELS[x.status]}</option>)}</Select></FormField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Chip tone={TONE[v.status]}>{MODEL_STATUS_LABELS[v.status]}</Chip>
          <span className="text-xs text-muted">v{v.version} · {v.author ?? 'Sistema'} · {fmtDateTime(v.createdAt)}{v.publishedAt && ` · publicada em ${fmtDateTime(v.publishedAt)}`}</span>
          <span className="flex-1" />
          {d.canEdit && !open && <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}><Plus className="h-4 w-4" aria-hidden />Nova versão a partir desta</Button>}
          {editable && <><Button size="sm" onClick={() => discard.mutate()} loading={discard.isPending}>Descartar rascunho</Button><Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Salvar rascunho</Button><Button size="sm" variant="primary" loading={submit.isPending} disabled={problems.length > 0} onClick={() => submit.mutate()}>Enviar para aprovação</Button></>}
          {v.status === 'em_aprovacao' && d.canPublish && <Button size="sm" variant="primary" onClick={() => setDecide(true)}>Aprovar ou devolver</Button>}
          {v.status === 'em_aprovacao' && !d.canPublish && <span className="text-xs text-muted">Aguardando a administração aprovar.</span>}
        </div>
        {v.reviewNote && v.status === 'rascunho' && <div className="mt-2"><Notice tone="warning">Devolvido para ajustes: {v.reviewNote}</Notice></div>}
        {editable && <FormField label="O que muda nesta versão" htmlFor="bm-notes" className="mt-3"><Input id="bm-notes" maxLength={1000} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} /></FormField>}
      </div>

      <section className="card p-4" aria-label="Prévia do projeto">
        <h3 className="text-sm font-bold text-ink">Prévia do projeto</h3>
        <p className="text-sm text-muted">{totals.phases} etapas · {totals.macros} macrotarefas · {totals.tasks} tarefas · cerca de {totals.days} dias do início ao encerramento (as datas são recalculadas pelo edital no planejamento).</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{byArea.map((x) => <Chip key={x.a}>{BID_AREA_LABELS[x.a]}: {x.n}</Chip>)}</div>
        {problems.length > 0 && <div className="mt-2"><Notice tone="warning">{problems.join(' ')}</Notice></div>}
      </section>

      <ol className="space-y-3" aria-label="Etapas do modelo">
        {def.phases.map((p, i) => <PhaseEditor key={p.key} p={p} i={i} n={def.phases.length} editable={editable} def={def} up={up} />)}
      </ol>
      {editable && <Button onClick={() => up((x) => { x.phases.push({ key: newModelKey(x, 'etapa'), name: 'Nova etapa', deliverable: 'Entregável da etapa', durationDays: 2, macros: [] }); return x; })}><Plus className="h-4 w-4" aria-hidden />Adicionar etapa</Button>}
      {decide && <DecideModal version={v.version} onClose={() => setDecide(false)} onDone={(m) => { setDecide(false); done(m); }} />}
    </div>
  );
}

function PhaseEditor({ p, i, n, editable, def, up }: { p: BidModelPhase; i: number; n: number; editable: boolean; def: BidModelDef; up: (f: (x: BidModelDef) => BidModelDef) => void }) {
  const [open, setOpen] = useState(i === 0);
  const [drag, setDrag] = useState<number | null>(null);
  const ph = (f: (x: BidModelPhase) => void) => up((x) => { f(x.phases[i]!); return x; });
  const onDrop = (e: DragEvent, to: number) => { e.preventDefault(); if (drag !== null && drag !== to) ph((x) => { x.macros = move(x.macros, drag, to); }); setDrag(null); };
  return (
    <li className="card p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" className="text-muted" aria-expanded={open} aria-label={`${open ? 'Recolher' : 'Abrir'} etapa ${i + 1}`} onClick={() => setOpen(!open)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <span className="text-xs font-semibold text-muted">Etapa {i + 1}</span>
        {editable ? <Input aria-label={`Nome da etapa ${i + 1}`} className="h-8 max-w-sm flex-1 font-semibold" value={p.name} onChange={(e) => ph((x) => { x.name = e.target.value; })} /> : <b className="text-ink">{p.name}</b>}
        <span className="text-xs text-muted">{p.macros.length} macrotarefas</span>
        <span className="flex-1" />
        {editable && <>
          <button type="button" className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} aria-label={`Subir etapa ${i + 1}`} onClick={() => up((x) => { x.phases = move(x.phases, i, i - 1); return x; })}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === n - 1} aria-label={`Descer etapa ${i + 1}`} onClick={() => up((x) => { x.phases = move(x.phases, i, i + 1); return x; })}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Excluir etapa ${i + 1}`} onClick={() => up((x) => { x.phases.splice(i, 1); return x; })}><Trash2 className="h-4 w-4" /></button>
        </>}
      </div>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Entregável da etapa" htmlFor={`ph-d-${p.key}`} className="sm:col-span-2"><Input id={`ph-d-${p.key}`} disabled={!editable} value={p.deliverable} onChange={(e) => ph((x) => { x.deliverable = e.target.value; })} /></FormField>
            <FormField label="Duração (dias)" htmlFor={`ph-n-${p.key}`}><Input id={`ph-n-${p.key}`} type="number" min={0} disabled={!editable} value={p.durationDays} onChange={(e) => ph((x) => { x.durationDays = Math.max(0, Number(e.target.value) || 0); })} /></FormField>
          </div>
          <ul className="space-y-2" aria-label={`Macrotarefas da etapa ${i + 1}`}>
            {p.macros.map((m, k) => (
              <li key={m.key} draggable={editable} onDragStart={() => setDrag(k)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, k)} className={`rounded-md border p-3 ${drag === k ? 'border-primary' : 'border-line'}`}>
                <MacroEditor m={m} editable={editable} def={def} set={(f) => ph((x) => f(x.macros[k]!))} remove={() => ph((x) => { x.macros.splice(k, 1); })} moveBy={(dlt) => ph((x) => { x.macros = move(x.macros, k, k + dlt); })} first={k === 0} last={k === p.macros.length - 1} />
              </li>
            ))}
          </ul>
          {editable && <Button size="sm" onClick={() => ph((x) => { x.macros.push({ key: newModelKey(def, `${p.key}_macro`), name: 'Nova macrotarefa', area: 'comercial', required: true, offsetDays: 0, durationDays: 1, tasks: [] }); })}><Plus className="h-4 w-4" aria-hidden />Adicionar macrotarefa</Button>}
        </div>
      )}
    </li>
  );
}

function MacroEditor({ m, editable, def, set, remove, moveBy, first, last }: { m: BidModelMacro; editable: boolean; def: BidModelDef; set: (f: (x: BidModelMacro) => void) => void; remove: () => void; moveBy: (d: number) => void; first: boolean; last: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {editable && <GripVertical className="h-4 w-4 cursor-grab text-muted" aria-hidden />}
        <Input aria-label="Nome da macrotarefa" disabled={!editable} className="h-8 min-w-[12rem] flex-1 font-medium" value={m.name} onChange={(e) => set((x) => { x.name = e.target.value; })} />
        <Select aria-label={`Área de ${m.name}`} disabled={!editable} className="h-8 w-44" value={m.area} onChange={(e) => set((x) => { x.area = e.target.value as BidModelMacro['area']; })}>{BID_AREAS.map((a) => <option key={a} value={a}>{BID_AREA_LABELS[a]}</option>)}</Select>
        <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!editable} checked={m.required} onChange={(e) => set((x) => { x.required = e.target.checked; })} />Obrigatória</label>
        <label className="inline-flex items-center gap-1 text-xs">Início +<Input aria-label={`Início (dias) de ${m.name}`} type="number" min={0} disabled={!editable} className="h-8 w-16" value={m.offsetDays} onChange={(e) => set((x) => { x.offsetDays = Math.max(0, Number(e.target.value) || 0); })} />d</label>
        <label className="inline-flex items-center gap-1 text-xs">Duração<Input aria-label={`Duração (dias) de ${m.name}`} type="number" min={0} disabled={!editable} className="h-8 w-16" value={m.durationDays} onChange={(e) => set((x) => { x.durationDays = Math.max(0, Number(e.target.value) || 0); })} />d</label>
        {editable && <>
          <button type="button" disabled={first} className="rounded p-1 text-muted disabled:opacity-30" aria-label={`Subir ${m.name}`} onClick={() => moveBy(-1)}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" disabled={last} className="rounded p-1 text-muted disabled:opacity-30" aria-label={`Descer ${m.name}`} onClick={() => moveBy(1)}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Excluir ${m.name}`} onClick={remove}><Trash2 className="h-4 w-4" /></button>
        </>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Prazo pelo edital:</span>
        <Select aria-label={`Marco do edital de ${m.name}`} disabled={!editable} className="h-8 w-56" value={m.anchor ?? ''} onChange={(e) => set((x) => { x.anchor = (e.target.value || null) as BidModelMacro['anchor']; })}><option value="">Sem vínculo (dias da etapa)</option>{OFFICIAL_DATES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select>
        {m.anchor && <label className="inline-flex items-center gap-1">entrega<Input aria-label={`Dias em relação ao marco de ${m.name}`} type="number" disabled={!editable} className="h-8 w-16" value={m.anchorOffsetDays ?? 0} onChange={(e) => set((x) => { x.anchorOffsetDays = Number(e.target.value) || 0; })} />dias do marco (negativo = antes)</label>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label={`Entregável de ${m.name}`} placeholder="Entregável" disabled={!editable} className="h-8" value={m.deliverable ?? ''} onChange={(e) => set((x) => { x.deliverable = e.target.value || undefined; })} />
        <Input aria-label={`Critério de aceite de ${m.name}`} placeholder="Critério de aceite" disabled={!editable} className="h-8" value={m.acceptance ?? ''} onChange={(e) => set((x) => { x.acceptance = e.target.value || undefined; })} />
      </div>
      {(m.tasks.length > 0 || editable) && (
        <ul className="ml-6 space-y-1" aria-label={`Tarefas de ${m.name}`}>
          {m.tasks.map((t, j) => (
            <li key={t.key} className="flex items-center gap-2">
              <Input aria-label="Nome da tarefa" disabled={!editable} className="h-7 flex-1 text-sm" value={t.name} onChange={(e) => set((x) => { x.tasks[j]!.name = e.target.value; })} />
              <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" className="h-3.5 w-3.5 accent-primary" disabled={!editable} checked={t.required} onChange={(e) => set((x) => { x.tasks[j]!.required = e.target.checked; })} />Obrigatória</label>
              {editable && <button type="button" className="text-muted hover:text-danger" aria-label={`Excluir tarefa ${t.name}`} onClick={() => set((x) => { x.tasks.splice(j, 1); })}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
          {editable && <li><button type="button" className="text-xs text-primary hover:underline" onClick={() => set((x) => { x.tasks.push({ key: newModelKey(def, `${m.key}_t`), name: 'Nova tarefa', required: true }); })}>+ Adicionar tarefa</button></li>}
        </ul>
      )}
    </div>
  );
}

function DecideModal({ version, onClose, onDone }: { version: number; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState('');
  const toast = useToast();
  const m = useMutation({
    mutationFn: (approve: boolean) => api(`/modelos-projeto/licitacao/versoes/${version}/decidir`, { method: 'POST', body: { approve, note: note.trim() || null } }),
    onSuccess: (_r, approve) => onDone(approve ? `Versão ${version} publicada` : 'Devolvida para ajustes'),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Aprovar a versão ${version}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button loading={m.isPending} disabled={note.trim().length < 5} onClick={() => m.mutate(false)}>Devolver para ajustes</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(true)}>Aprovar e publicar</Button></>}>
      <p className="text-sm text-muted">Publicada, vale para os novos projetos de licitação. Os projetos já criados continuam com a versão deles.</p>
      <FormField label="Parecer" htmlFor="bm-note" className="mt-3" hint="Obrigatório para devolver"><Textarea id="bm-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
    </Modal>
  );
}
