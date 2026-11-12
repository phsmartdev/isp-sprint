/**
 * Planejamento do projeto de licitação (conduzido pelo analista): marcos oficiais do edital, prazos calculados
 * para trás com margem, tabela editável (em linha e em lote), cronograma, dependências e as pendências que
 * impedem liberar o plano. Nada aqui altera o modelo.
 */
import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, GitBranch, Link2, Plus, Trash2, XCircle } from 'lucide-react';
import { BID_AREAS, BID_AREA_LABELS, OFFICIAL_DATES, type BidArea, type OfficialDateKey, type OfficialDates, type PlanIssue, type ProjectTaskSpec } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Row = { id: string; parentId: string | null; title: string; ownerId: string; ownerName: string; startOn: string | null; dueOn: string | null; done: boolean; spec: ProjectTaskSpec | null; milestoneId: string | null; dependsOn: string[]; rowVersion: number };
type Plan = {
  project: { id: string; code: number; name: string; status: string; coordinatorId: string; marginDays: number; opportunityId: string; templateVersion: number | null };
  canPlan: boolean; officialDates: OfficialDates; phases: { id: string; name: string; dueOn: string | null; position: number; acceptanceCriteria: string | null }[];
  rows: Row[]; issues: PlanIssue[]; recalc: { id: string; title: string; from: { startOn: string | null; dueOn: string | null }; to: { startOn: string; dueOn: string } }[];
};
type View = 'tabela' | 'cronograma' | 'dependencias';

export function BidPlanningPage() {
  const { id = '' } = useParams();
  const key = ['licitacao-plano', id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Plan>(`/projects/${id}/licitacao/plano`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>('tabela');
  const set = (p: Plan) => qc.setQueryData(key, p);
  const edit = useMutation({
    mutationFn: (b: { ids: string[]; patch: Record<string, unknown>; shiftDays?: number; rowVersions?: Record<string, number> }) => api<Plan>(`/projects/${id}/licitacao/tarefas`, { method: 'PATCH', body: b }),
    onSuccess: set, onError: (e) => { toast({ tone: 'error', message: errMsg(e) }); void q.refetch(); },
  });
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const blocks = d.issues.filter((i) => i.level === 'bloqueio');
  const alerts = d.issues.filter((i) => i.level === 'alerta');
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted"><Link to={`/opportunities/${d.project.opportunityId}?aba=licitacao`} className="link">Oportunidade</Link> › Projeto de Licitação</p>
        <h1 className="text-xl font-bold text-ink">Planejamento · {d.project.name} <span className="text-sm font-normal text-muted">PRJ-{d.project.code}</span></h1>
        <p className="text-sm text-muted">As alterações valem só para este projeto (o modelo v{d.project.templateVersion} não muda) e ficam no histórico.</p>
      </div>
      <OfficialDatesCard d={d} onSaved={set} />
      <section className="card p-4" aria-label="Pendências do plano">
        <div className="flex flex-wrap items-center gap-2">
          {blocks.length ? <Chip tone="red"><XCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden />{blocks.length} pendência(s) impedem liberar o plano</Chip> : <Chip tone="green"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden />Plano sem pendências obrigatórias</Chip>}
          {alerts.length > 0 && <Chip tone="orange">{alerts.length} alerta(s)</Chip>}
        </div>
        {(blocks.length > 0 || alerts.length > 0) && (
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">{[...blocks, ...alerts].map((i, k) => <li key={k} className={i.level === 'bloqueio' ? 'text-danger' : 'text-ink'}>{i.level === 'bloqueio' ? '● ' : '○ '}{i.message}</li>)}</ul>
        )}
        <p className="mt-2 text-xs text-muted">Entregável obrigatório precisa de responsável da área, data e critério de aceite. A aprovação do plano pela matriz RACI vem na próxima fase.</p>
      </section>
      <Tabs<View> label="Visões do planejamento" value={view} onChange={setView} tabs={[{ key: 'tabela', label: 'Tabela' }, { key: 'cronograma', label: 'Cronograma' }, { key: 'dependencias', label: 'Dependências' }]} />
      {view === 'tabela' && <PlanTable d={d} edit={edit.mutate} busy={edit.isPending} />}
      {view === 'cronograma' && <Gantt d={d} />}
      {view === 'dependencias' && <Deps d={d} onPlan={set} />}
    </div>
  );
}

function OfficialDatesCard({ d, onSaved }: { d: Plan; onSaved: (p: Plan) => void }) {
  const [dates, setDates] = useState(() => Object.fromEntries(OFFICIAL_DATES.map((x) => [x.key, { date: d.officialDates[x.key]?.date ?? '', validated: !!d.officialDates[x.key]?.validated, source: d.officialDates[x.key]?.source ?? '' }])) as Record<OfficialDateKey, { date: string; validated: boolean; source: string }>);
  const [margin, setMargin] = useState(d.project.marginDays);
  const [pick, setPick] = useState<string[] | null>(null);
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api<Plan>(`/projects/${d.project.id}/licitacao/datas`, { method: 'PUT', body: { dates: Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, { date: v.date || null, validated: v.validated && !!v.date, source: v.source.trim() || null }])), marginDays: margin } }),
    onSuccess: (p) => { onSaved(p); toast({ tone: 'success', message: 'Marcos do edital salvos' }); if (p.recalc.length) setPick(p.recalc.map((r) => r.id)); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const apply = useMutation({
    mutationFn: () => api<Plan>(`/projects/${d.project.id}/licitacao/recalcular`, { method: 'POST', body: { ids: pick } }),
    onSuccess: (p) => { onSaved(p); setPick(null); toast({ tone: 'success', message: 'Prazos recalculados' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card p-4" aria-label="Marcos do edital">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-sm font-bold text-ink">Marcos do edital</h2><p className="text-xs text-muted">Informe e valide com o edital (nada é presumido). Sessão e envio da proposta são os mesmos campos da oportunidade.</p></div>
        <div className="flex items-end gap-2">
          <FormField label="Margem de segurança (dias)" htmlFor="pl-margin"><Input id="pl-margin" type="number" min={0} max={30} className="h-9 w-24" disabled={!d.canPlan} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} /></FormField>
          {d.canPlan && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar marcos</Button>}
          {d.recalc.length > 0 && d.canPlan && <Button onClick={() => setPick(d.recalc.map((r) => r.id))}>Recalcular prazos ({d.recalc.length})</Button>}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5">Marco</th><th>Data</th><th>Fonte (item do edital, retificação…)</th><th className="text-center">Validada</th></tr></thead>
          <tbody>{OFFICIAL_DATES.map((x) => (
            <tr key={x.key} className="border-b border-line">
              <td className="py-1.5 pr-2 font-medium text-ink">{x.label}{'crmField' in x && <span className="ml-1 text-xs text-muted">(oportunidade)</span>}</td>
              <td className="pr-2"><Input aria-label={`Data: ${x.label}`} type="date" className="h-8" disabled={!d.canPlan} value={dates[x.key].date} onChange={(e) => setDates({ ...dates, [x.key]: { ...dates[x.key], date: e.target.value, validated: false } })} /></td>
              <td className="pr-2"><Input aria-label={`Fonte: ${x.label}`} className="h-8" disabled={!d.canPlan} value={dates[x.key].source} onChange={(e) => setDates({ ...dates, [x.key]: { ...dates[x.key], source: e.target.value } })} /></td>
              <td className="text-center"><input type="checkbox" aria-label={`Validada com o edital: ${x.label}`} className="h-4 w-4 accent-primary" disabled={!d.canPlan || !dates[x.key].date} checked={dates[x.key].validated} onChange={(e) => setDates({ ...dates, [x.key]: { ...dates[x.key], validated: e.target.checked } })} />{d.officialDates[x.key]?.validatedAt && <span className="block text-[10px] text-muted">{fmtDateTime(d.officialDates[x.key]!.validatedAt!)}</span>}</td>
            </tr>
          ))}</tbody></table>
      </div>
      {pick && (
        <Modal open onClose={() => setPick(null)} title="Recalcular prazos pelo edital" size="lg" footer={<><Button onClick={() => setPick(null)}>Agora não</Button><Button variant="primary" loading={apply.isPending} disabled={!pick.length} onClick={() => apply.mutate()}>Aplicar em {pick.length}</Button></>}>
          <p className="mb-2 text-sm text-muted">Estas macrotarefas têm prazo ligado a um marco que mudou. Confira e escolha quais atualizar.</p>
          <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs text-muted"><th className="w-8" /><th className="py-1">Macrotarefa</th><th>Entrega atual</th><th>Nova entrega</th></tr></thead>
            <tbody>{d.recalc.map((r) => <tr key={r.id} className="border-b border-line"><td><input type="checkbox" aria-label={`Recalcular ${r.title}`} className="h-4 w-4 accent-primary" checked={pick.includes(r.id)} onChange={(e) => setPick(e.target.checked ? [...pick, r.id] : pick.filter((x) => x !== r.id))} /></td><td className="py-1 text-ink">{r.title}</td><td className="tabular-nums text-muted">{fmtDate(r.from.dueOn)}</td><td className="font-semibold tabular-nums text-ink">{fmtDate(r.to.dueOn)}</td></tr>)}</tbody></table>
        </Modal>
      )}
    </section>
  );
}

function PlanTable({ d, edit, busy }: { d: Plan; edit: (b: { ids: string[]; patch: Record<string, unknown>; shiftDays?: number; rowVersions?: Record<string, number> }) => void; busy: boolean }) {
  const lk = useLookups();
  const users = lk.data?.users ?? [];
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [shift, setShift] = useState(1);
  const [add, setAdd] = useState<{ milestoneId?: string; parentId?: string } | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (taskId: string) => api(`/projects/${d.project.id}/licitacao/tarefas/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['licitacao-plano', d.project.id] }); toast({ tone: 'success', message: 'Excluída deste projeto' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const macros = d.rows.filter((r) => !r.parentId);
  const subsOf = (id: string) => d.rows.filter((r) => r.parentId === id);
  const one = (r: Row, patch: Record<string, unknown>) => edit({ ids: [r.id], patch, rowVersions: { [r.id]: r.rowVersion } });
  const issueOf = (id: string) => d.issues.filter((i) => i.taskId === id);
  const ro = !d.canPlan;
  const text = (r: Row, k: 'deliverable' | 'acceptance' | 'docs', label: string) => (
    <Input aria-label={`${label}: ${r.title}`} className="h-8 min-w-[10rem]" disabled={ro} defaultValue={(r.spec?.[k] as string | null) ?? ''} key={`${r.id}-${k}-${r.rowVersion}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== ((r.spec?.[k] as string | null) ?? null)) one(r, { [k]: v }); }} />
  );
  return (
    <section className="card p-0" aria-label="Tabela do planejamento">
      {sel.length > 0 && !ro && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-primary-soft px-3 py-2 text-sm" role="toolbar" aria-label="Ações em lote">
          <b className="text-ink">{sel.length} selecionada(s)</b>
          <Select aria-label="Área em lote" className="h-8 w-40" value="" onChange={(e) => e.target.value && edit({ ids: sel, patch: { area: e.target.value } })}><option value="">Área…</option>{BID_AREAS.map((a) => <option key={a} value={a}>{BID_AREA_LABELS[a]}</option>)}</Select>
          <Select aria-label="Responsável em lote" className="h-8 w-44" value="" onChange={(e) => e.target.value && edit({ ids: sel, patch: { ownerId: e.target.value } })}><option value="">Responsável…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select aria-label="Aprovador em lote" className="h-8 w-44" value="" onChange={(e) => e.target.value && edit({ ids: sel, patch: { approverId: e.target.value } })}><option value="">Aprovador…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <span className="inline-flex items-center gap-1">Deslocar<Input aria-label="Dias para deslocar" type="number" className="h-8 w-16" value={shift} onChange={(e) => setShift(Number(e.target.value) || 0)} />dias<Button size="sm" disabled={!shift || busy} onClick={() => edit({ ids: sel, patch: {}, shiftDays: shift })}>Aplicar</Button></span>
          <Button size="sm" onClick={() => edit({ ids: sel, patch: { required: true } })}>Obrigatórias</Button>
          <Button size="sm" onClick={() => edit({ ids: sel, patch: { required: false } })}>Opcionais</Button>
          <button type="button" className="ml-auto text-xs text-muted underline" onClick={() => setSel([])}>Limpar seleção</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-sm">
          <thead><tr className="border-b-2 border-line text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className="w-8 px-2"><input type="checkbox" aria-label="Selecionar todas" className="h-4 w-4 accent-primary" checked={sel.length === macros.length && macros.length > 0} onChange={(e) => setSel(e.target.checked ? macros.map((r) => r.id) : [])} /></th>
            <th className="px-2 py-2">Macrotarefa / tarefa</th><th className="px-2">Área</th><th className="px-2">Responsável</th><th className="px-2">Entregável</th><th className="px-2">Critério de aceite</th><th className="px-2">Início</th><th className="px-2">Entrega</th><th className="px-2">Dep.</th><th className="px-2">Aprovador</th><th className="px-2">Anexos necessários</th><th className="px-2">Notificação</th><th className="px-2">Obr.</th><th />
          </tr></thead>
          <tbody>{d.phases.map((ph) => {
            const ms = macros.filter((r) => r.milestoneId === ph.id);
            return (
              <Fragment key={ph.id}>
                <tr className="bg-surface-2"><td colSpan={14} className="px-3 py-2"><span className="font-bold text-ink">{ph.name}</span> <span className="text-xs text-muted">· {ph.acceptanceCriteria}</span>{!ro && <button type="button" className="ml-3 text-xs text-primary hover:underline" onClick={() => setAdd({ milestoneId: ph.id })}>+ macrotarefa</button>}</td></tr>
                {ms.map((r) => {
                  const iss = issueOf(r.id);
                  const subs = subsOf(r.id);
                  const isOpen = open.includes(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className={`border-b border-line align-top ${r.done ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Selecionar ${r.title}`} className="h-4 w-4 accent-primary" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>
                        <td className="min-w-[16rem] px-2 py-1.5">
                          <div className="flex items-start gap-1">
                            {subs.length > 0 ? <button type="button" aria-label={`${isOpen ? 'Recolher' : 'Abrir'} tarefas de ${r.title}`} className="mt-1 text-muted" onClick={() => setOpen(isOpen ? open.filter((x) => x !== r.id) : [...open, r.id])}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="w-4" />}
                            <div className="flex-1"><Input aria-label={`Nome: ${r.title}`} className="h-8 font-medium" disabled={ro} defaultValue={r.title} key={`${r.id}-t-${r.rowVersion}`} onBlur={(e) => { const v = e.target.value.trim(); if (v.length >= 2 && v !== r.title) one(r, { title: v }); }} />
                              {iss.map((i, k) => <p key={k} className={`mt-0.5 flex items-start gap-1 text-[11px] leading-tight ${i.level === 'bloqueio' ? 'text-danger' : 'text-warning'}`}><AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />{i.message.replace(/^"[^"]+": /, '')}</p>)}
                              {r.spec?.anchor && <p className="mt-0.5 text-[11px] leading-tight text-muted" title="Prazo calculado a partir deste marco do edital">⏱ {OFFICIAL_DATES.find((x) => x.key === r.spec!.anchor)?.label}{(r.spec.anchorOffsetDays ?? 0) !== 0 ? ` ${(r.spec.anchorOffsetDays ?? 0) > 0 ? '+' : ''}${r.spec.anchorOffsetDays}d` : ''}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5"><Select aria-label={`Área: ${r.title}`} className="h-8 w-36" disabled={ro} value={r.spec?.area ?? 'comercial'} onChange={(e) => one(r, { area: e.target.value })}>{BID_AREAS.map((a) => <option key={a} value={a}>{BID_AREA_LABELS[a]}</option>)}</Select></td>
                        <td className="px-2 py-1.5"><Select aria-label={`Responsável: ${r.title}`} className={`h-8 w-40 ${r.spec?.area !== 'comercial' && !r.spec?.assigned ? 'border-warning' : ''}`} disabled={ro} value={r.ownerId} onChange={(e) => one(r, { ownerId: e.target.value })}>{!users.some((u) => u.id === r.ownerId) && <option value={r.ownerId}>{r.ownerName}</option>}{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>{r.spec?.area !== 'comercial' && !r.spec?.assigned && <span className="block text-[10px] text-warning">a definir pela área</span>}</td>
                        <td className="px-2 py-1.5">{text(r, 'deliverable', 'Entregável')}</td>
                        <td className="px-2 py-1.5">{text(r, 'acceptance', 'Critério de aceite')}</td>
                        <td className="px-2 py-1.5"><Input aria-label={`Início: ${r.title}`} type="date" className="h-8 w-36" disabled={ro} value={r.startOn ?? ''} onChange={(e) => one(r, { startOn: e.target.value || null })} /></td>
                        <td className="px-2 py-1.5"><Input aria-label={`Entrega: ${r.title}`} type="date" className="h-8 w-36" disabled={ro} value={r.dueOn ?? ''} onChange={(e) => one(r, { dueOn: e.target.value || null })} /></td>
                        <td className="px-2 py-1.5 text-center tabular-nums text-muted">{r.dependsOn.length || '—'}</td>
                        <td className="px-2 py-1.5"><Select aria-label={`Aprovador: ${r.title}`} className="h-8 w-40" disabled={ro} value={r.spec?.approverId ?? ''} onChange={(e) => one(r, { approverId: e.target.value || null })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></td>
                        <td className="px-2 py-1.5">{text(r, 'docs', 'Anexos necessários')}</td>
                        <td className="px-2 py-1.5 text-xs text-muted" title="Templates por área chegam na fase de comunicação">Modelo da área</td>
                        <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`Obrigatória: ${r.title}`} className="h-4 w-4 accent-primary" disabled={ro} checked={!!r.spec?.required} onChange={(e) => one(r, { required: e.target.checked })} /></td>
                        <td className="px-2 py-1.5">{!ro && !r.spec?.required && <button type="button" className="text-muted hover:text-danger" aria-label={`Excluir ${r.title}`} onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></button>}</td>
                      </tr>
                      {isOpen && subs.map((t) => (
                        <tr key={t.id} className="border-b border-line bg-surface text-xs">
                          <td /><td className="py-1 pl-10 pr-2 text-ink" colSpan={5}>{t.done ? '✓ ' : '• '}{t.title}{t.spec?.required === false && <span className="text-muted"> (opcional)</span>}</td>
                          <td className="px-2 tabular-nums text-muted">{fmtDate(t.startOn)}</td><td className="px-2 tabular-nums text-muted">{fmtDate(t.dueOn)}</td><td colSpan={5} />
                          <td className="px-2">{!ro && !t.spec?.required && <button type="button" className="text-muted hover:text-danger" aria-label={`Excluir ${t.title}`} onClick={() => del.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                        </tr>
                      ))}
                      {isOpen && !ro && <tr className="border-b border-line"><td /><td colSpan={13} className="py-1 pl-10"><button type="button" className="text-xs text-primary hover:underline" onClick={() => setAdd({ parentId: r.id })}>+ tarefa em {r.title}</button></td></tr>}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}</tbody>
        </table>
      </div>
      {add && <AddModal projectId={d.project.id} target={add} onClose={() => setAdd(null)} onDone={() => { setAdd(null); void qc.invalidateQueries({ queryKey: ['licitacao-plano', d.project.id] }); }} />}
    </section>
  );
}

function AddModal({ projectId, target, onClose, onDone }: { projectId: string; target: { milestoneId?: string; parentId?: string }; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<BidArea>('comercial');
  const [required, setRequired] = useState(false);
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/projects/${projectId}/licitacao/tarefas`, { method: 'POST', body: { ...target, title, area, required } }), onSuccess: () => { toast({ tone: 'success', message: 'Incluída neste projeto' }); onDone(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={target.parentId ? 'Nova tarefa' : 'Nova macrotarefa'} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={title.trim().length < 2} onClick={() => m.mutate()}>Incluir</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome" htmlFor="pl-add-t"><Input id="pl-add-t" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        {!target.parentId && <FormField label="Área" htmlFor="pl-add-a"><Select id="pl-add-a" value={area} onChange={(e) => setArea(e.target.value as BidArea)}>{BID_AREAS.map((a) => <option key={a} value={a}>{BID_AREA_LABELS[a]}</option>)}</Select></FormField>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={required} onChange={(e) => setRequired(e.target.checked)} />Obrigatória</label>
        <p className="text-xs text-muted">Vale só para este projeto; o modelo não muda.</p>
      </div>
    </Modal>
  );
}

/** Cronograma: barras por macrotarefa na régua de dias, com as linhas dos marcos do edital. */
function Gantt({ d }: { d: Plan }) {
  const macros = d.rows.filter((r) => !r.parentId && (r.startOn || r.dueOn));
  const today = new Date().toISOString().slice(0, 10);
  const marks = OFFICIAL_DATES.map((x) => ({ ...x, date: d.officialDates[x.key]?.date ?? null })).filter((x) => x.date) as { key: string; label: string; date: string }[];
  const all = [...macros.flatMap((r) => [r.startOn ?? r.dueOn!, r.dueOn ?? r.startOn!]), ...marks.map((m) => m.date)].sort();
  if (!all.length) return <Notice>Sem datas ainda.</Notice>;
  const t0 = Date.parse(`${all[0]}T12:00:00Z`), t1 = Date.parse(`${all.at(-1)}T12:00:00Z`) + 86_400_000;
  const pos = (iso: string) => ((Date.parse(`${iso}T12:00:00Z`) - t0) / (t1 - t0)) * 100;
  return (
    <section className="card p-4" aria-label="Cronograma">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted"><span>{fmtDate(all[0])} → {fmtDate(all.at(-1))}</span>{marks.map((m) => <span key={m.key}><span className="mr-1 inline-block h-3 w-0.5 bg-danger align-middle" />{m.label}: {fmtDate(m.date)}</span>)}</div>
      <div className="space-y-0.5">{d.phases.map((ph) => (
        <div key={ph.id}>
          <p className="mt-2 text-xs font-bold text-ink">{ph.name}</p>
          {macros.filter((r) => r.milestoneId === ph.id).map((r) => {
            const a = r.startOn ?? r.dueOn!, b = r.dueOn ?? r.startOn!;
            const late = !r.done && b < today;
            return (
              <div key={r.id} className="grid grid-cols-[14rem_1fr] items-center gap-2 text-xs">
                <span className="truncate text-ink" title={r.title}>{r.title}</span>
                <div className="relative h-5 rounded bg-surface-2">
                  {marks.map((m) => <span key={m.key} className="absolute top-0 h-5 w-px bg-danger/60" style={{ left: `${pos(m.date)}%` }} aria-hidden />)}
                  <span className={`absolute top-1 h-3 rounded ${r.done ? 'bg-success' : late ? 'bg-danger' : r.spec?.required ? 'bg-primary' : 'bg-primary/50'}`} style={{ left: `${pos(a)}%`, width: `${Math.max(0.8, pos(b) - pos(a) + 100 / ((t1 - t0) / 86_400_000))}%` }} title={`${r.title}: ${fmtDate(a)} a ${fmtDate(b)}`} />
                </div>
              </div>
            );
          })}
        </div>
      ))}</div>
    </section>
  );
}

/** Dependências: predecessoras de cada macrotarefa e os conflitos de datas. */
function Deps({ d, onPlan }: { d: Plan; onPlan: (p: Plan) => void }) {
  const [editing, setEditing] = useState<Row | null>(null);
  const macros = d.rows.filter((r) => !r.parentId);
  const byId = useMemo(() => new Map(d.rows.map((r) => [r.id, r])), [d.rows]);
  return (
    <section className="card p-4" aria-label="Dependências">
      <ul className="divide-y divide-line text-sm">{macros.map((r) => {
        const conflicts = d.issues.filter((i) => i.taskId === r.id && i.message.includes('antes de'));
        return (
          <li key={r.id} className="flex flex-wrap items-start gap-2 py-2">
            <GitBranch className="mt-0.5 h-4 w-4 text-muted" aria-hidden />
            <div className="min-w-0 flex-1"><b className="text-ink">{r.title}</b>
              {r.dependsOn.length ? <p className="text-xs text-muted">depende de: {r.dependsOn.map((x) => byId.get(x)?.title).join(', ')}</p> : <p className="text-xs text-muted">sem predecessoras</p>}
              {conflicts.map((c, k) => <p key={k} className="text-xs text-warning">{c.message}</p>)}
            </div>
            {d.canPlan && <Button size="sm" onClick={() => setEditing(r)}><Link2 className="h-4 w-4" aria-hidden />Predecessoras</Button>}
          </li>
        );
      })}</ul>
      {editing && <DepsModal d={d} row={editing} onClose={() => setEditing(null)} onPlan={(p) => { onPlan(p); setEditing(null); }} />}
    </section>
  );
}

function DepsModal({ d, row, onClose, onPlan }: { d: Plan; row: Row; onClose: () => void; onPlan: (p: Plan) => void }) {
  const [pick, setPick] = useState<string[]>(row.dependsOn);
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api<Plan>(`/projects/${d.project.id}/licitacao/tarefas/${row.id}/dependencias`, { method: 'PUT', body: { dependsOn: pick } }), onSuccess: (p) => { toast({ tone: 'success', message: 'Dependências salvas' }); onPlan(p); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`Predecessoras de "${row.title}"`} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="max-h-[60vh] space-y-3 overflow-auto">{d.phases.map((ph) => {
        const ms = d.rows.filter((r) => !r.parentId && r.milestoneId === ph.id && r.id !== row.id);
        if (!ms.length) return null;
        return <fieldset key={ph.id}><legend className="text-xs font-bold text-ink">{ph.name}</legend>{ms.map((r) => <label key={r.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={pick.includes(r.id)} onChange={(e) => setPick(e.target.checked ? [...pick, r.id] : pick.filter((x) => x !== r.id))} />{r.title}<span className="text-xs text-muted">{fmtDate(r.dueOn)}</span></label>)}</fieldset>;
      })}</div>
    </Modal>
  );
}
