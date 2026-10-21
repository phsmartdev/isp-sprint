/** Gestão de Times → Decisões e impedimentos: o que foi decidido (e se está sendo cumprido) e o que trava o time. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Gavel, Plus } from 'lucide-react';
import { IMPEDIMENT_SEVERITY_LABELS, IMPEDIMENT_STATUS_LABELS, impedimentTransition, type ImpedimentStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';

type Decision = { id: string; text: string; rationale: string | null; ownerName: string; effectiveOn: string; status: 'vigente' | 'revogada'; revokedReason: string | null; followUpTaskId: string | null; followUpStatus: string | null; origin: string | null; meetingId: string | null; interventionId: string | null };
type Impediment = { id: string; title: string; description: string | null; severity: 'alta' | 'media' | 'baixa'; status: ImpedimentStatus; ownerName: string; ownerId: string; dueOn: string | null; overdue: boolean; escalations: number; resolution: string | null; scopeName: string | null; rowVersion: number; canEdit: boolean; meetingId: string | null; interventionId: string | null; createdAt: string };
const IMP_TONE: Record<ImpedimentStatus, Tone> = { aberto: 'orange', em_tratamento: 'blue', removido: 'green', aceito: 'neutral' };
const SEV_TONE = { alta: 'red', media: 'orange', baixa: 'neutral' } as const;
const HIST: Record<string, string> = { registrado: 'registrou', em_tratamento: 'passou para em tratamento', aberto: 'reabriu', removido: 'removeu', aceito: 'aceitou', reatribuido: 'trocou o responsável', escalado: 'escalou', registrada: 'registrou', revogada: 'revogou' };

export function DecisionsPage() {
  const [u, setU] = useUrlState({ tab: 'decisoes', status: '', id: '' });
  const tab = u.tab === 'impedimentos' ? 'impedimentos' : 'decisoes';
  return (
    <div>
      <PageHeader icon={<Gavel />} title="Decisões e impedimentos" subtitle="O que foi decidido nas reuniões e intervenções, e o que está travando o time — com dono, prazo e histórico." />
      <Tabs label="Seção" value={tab} onChange={(k) => setU({ tab: k, status: '', id: '' })} tabs={[{ key: 'decisoes', label: 'Decisões' }, { key: 'impedimentos', label: 'Impedimentos' }]} className="mb-4" />
      {tab === 'decisoes' ? <DecisionsTab status={u.status || 'vigente'} onStatus={(s) => setU({ status: s })} /> : <ImpedimentsTab status={u.status || 'abertos'} onStatus={(s) => setU({ status: s })} openId={u.id || null} onOpen={(id) => setU({ id }, { resetPage: false })} />}
    </div>
  );
}

function DecisionsTab({ status, onStatus }: { status: string; onStatus: (s: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['decisions', status], placeholderData: keepPreviousData, queryFn: () => api<{ items: Decision[] }>(`/decisions?status=${status}`) });
  const [revoke, setRevoke] = useState<{ id: string; reason: string } | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/decisions/${revoke!.id}/revoke`, { method: 'POST', body: { reason: revoke!.reason } }),
    onSuccess: () => { setRevoke(null); void qc.invalidateQueries({ queryKey: ['decisions'] }); toast({ tone: 'success', message: 'Decisão revogada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <>
      <FormField label="Situação" htmlFor="dc-st" className="mb-4 w-48"><Select id="dc-st" value={status} onChange={(e) => onStatus(e.target.value)}><option value="vigente">Vigentes</option><option value="revogada">Revogadas</option><option value="todas">Todas</option></Select></FormField>
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <EmptyState title="Nenhuma decisão" description="Decisões registradas nas reuniões dos rituais e nas intervenções aparecem aqui." /> : (
          <ul className="divide-y divide-line">
            {q.data!.items.map((d) => (
              <li key={d.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <p className={clsx('min-w-0 flex-1 font-semibold', d.status === 'revogada' ? 'text-muted line-through' : 'text-ink')}>{d.text}</p>
                  {d.followUpTaskId && <Link to={`/tarefas?task=${d.followUpTaskId}`}><Chip tone={d.followUpStatus === 'concluida' ? 'green' : 'blue'}>{d.followUpStatus === 'concluida' ? 'Acompanhamento feito' : 'Acompanhamento em aberto'}</Chip></Link>}
                </div>
                {d.rationale && <p className="text-muted">{d.rationale}</p>}
                <p className="mt-1 text-xs text-muted">{d.ownerName} · vale desde {fmtDate(d.effectiveOn)}{d.origin && <> · {d.meetingId ? <Link to={`/times/rituais/reunioes/${d.meetingId}`} className="text-primary hover:underline">{d.origin}</Link> : d.interventionId ? <Link to={`/times/intervencoes?id=${d.interventionId}`} className="text-primary hover:underline">{d.origin}</Link> : d.origin}</>}</p>
                {d.revokedReason && <p className="text-xs text-muted">Revogada: {d.revokedReason}</p>}
                {d.status === 'vigente' && (revoke?.id === d.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2"><FormField label="Motivo da revogação" htmlFor={`rv-${d.id}`} className="min-w-[260px] flex-1"><Input id={`rv-${d.id}`} value={revoke.reason} onChange={(e) => setRevoke({ id: d.id, reason: e.target.value })} /></FormField><Button size="sm" variant="secondary" onClick={() => setRevoke(null)}>Voltar</Button><Button size="sm" variant="danger" disabled={revoke.reason.trim().length < 10} loading={m.isPending} onClick={() => m.mutate()}>Revogar</Button></div>
                ) : <button type="button" className="mt-1 text-xs font-semibold text-muted hover:underline" onClick={() => setRevoke({ id: d.id, reason: '' })}>Revogar</button>)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ImpedimentsTab({ status, onStatus, openId, onOpen }: { status: string; onStatus: (s: string) => void; openId: string | null; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['impediments', status], placeholderData: keepPreviousData, queryFn: () => api<{ counts: { abertos: number; atrasados: number; altos: number; comigo: number }; items: Impediment[] }>(`/impediments?status=${status}`) });
  // a ficha continua aberta mesmo quando o impedimento sai do filtro (ex.: encerrado)
  const inList = !!q.data?.items.some((x) => x.id === openId);
  const all = useQuery({ queryKey: ['impediments', 'todos'], enabled: !!openId && !!q.data && !inList, queryFn: () => api<{ items: Impediment[] }>('/impediments?status=todos') });
  const [creating, setCreating] = useState(false);
  const c = q.data?.counts;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Situação" htmlFor="im-st" className="w-48"><Select id="im-st" value={status} onChange={(e) => onStatus(e.target.value)}><option value="abertos">Abertos</option><option value="aberto">Aguardando</option><option value="em_tratamento">Em tratamento</option><option value="removido">Removidos</option><option value="aceito">Aceitos</option><option value="todos">Todos</option></Select></FormField>
        {c && <p className="pb-2 text-sm"><b className="num">{c.abertos}</b> abertos · <span className={clsx(c.atrasados && 'font-semibold text-danger')}><span className="num">{c.atrasados}</span> com prazo vencido</span> · <span className="num">{c.altos}</span> de gravidade alta · <span className="num">{c.comigo}</span> comigo</p>}
        <Button variant="primary" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Registrar impedimento</Button>
      </div>
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <EmptyState title="Nada travando por aqui" description="Registre o que impede o time de avançar, com quem remove e até quando." /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Impedimento', 'Gravidade', 'Quem remove', 'Prazo', 'Situação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{q.data!.items.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(i.id)}>{i.title}</button>{i.scopeName && <span className="block text-xs text-muted">{i.scopeName}</span>}</td>
                  <td className="px-3 py-2.5"><Chip tone={SEV_TONE[i.severity]}>{IMPEDIMENT_SEVERITY_LABELS[i.severity]}</Chip></td>
                  <td className="px-3 py-2.5">{i.ownerName}{i.escalations > 0 && <span className="block text-xs font-semibold text-danger">escalado {i.escalations}×</span>}</td>
                  <td className={clsx('num px-3 py-2.5', i.overdue && 'font-semibold text-danger')}>{i.dueOn ? fmtDate(i.dueOn) : '—'}</td>
                  <td className="px-3 py-2.5"><Chip tone={IMP_TONE[i.status]}>{IMPEDIMENT_STATUS_LABELS[i.status]}</Chip></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <ImpedimentDrawer item={q.data?.items.find((x) => x.id === openId) ?? all.data?.items.find((x) => x.id === openId) ?? null} id={openId} onClose={() => onOpen('')} />
      <NewImpediment open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ImpedimentDrawer({ id, item, onClose }: { id: string | null; item: Impediment | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const h = useQuery({ queryKey: ['governance', id], enabled: !!id, queryFn: () => api<{ items: { id: string; type: string; createdAt: string; actorName: string | null; payload: Record<string, unknown> }[] }>(`/governance/${id}/history`) });
  const [f, setF] = useState({ status: '', resolution: '', ownerId: '', dueOn: '', why: '' });
  useEffect(() => { if (item) setF({ status: item.status, resolution: item.resolution ?? '', ownerId: item.ownerId, dueOn: item.dueOn ?? '', why: '' }); }, [item?.id, item?.rowVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['impediments'] }); void qc.invalidateQueries({ queryKey: ['governance', id] }); toast({ tone: 'success', message: msg }); };
  const save = useMutation({
    mutationFn: () => api(`/impediments/${id}`, { method: 'PATCH', body: { rowVersion: item!.rowVersion, status: f.status, resolution: f.resolution || undefined, ownerId: f.ownerId, dueOn: f.dueOn || null } }),
    onSuccess: () => done('Impedimento atualizado'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const esc = useMutation({
    mutationFn: () => api(`/impediments/${id}/escalate`, { method: 'POST', body: { rowVersion: item!.rowVersion, reason: f.why } }),
    onSuccess: () => done('Impedimento escalado para o nível acima'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const err = item && f.status ? impedimentTransition(item.status, f.status as ImpedimentStatus, f.resolution) : null;
  const changed = item && (f.status !== item.status || f.ownerId !== item.ownerId || (f.dueOn || null) !== item.dueOn);
  const open = item && (item.status === 'aberto' || item.status === 'em_tratamento');
  return (
    <Drawer open={!!id} onClose={onClose} title="Impedimento" width="lg">
      {!item ? <LoadingRows rows={5} /> : (
        <div className="space-y-4">
          <div><h3 className="text-lg font-bold text-ink">{item.title}</h3>{item.description && <p className="text-sm">{item.description}</p>}<div className="mt-1 flex flex-wrap gap-2"><Chip tone={SEV_TONE[item.severity]}>Gravidade {IMPEDIMENT_SEVERITY_LABELS[item.severity].toLowerCase()}</Chip><Chip tone={IMP_TONE[item.status]}>{IMPEDIMENT_STATUS_LABELS[item.status]}</Chip></div></div>
          {item.meetingId && <Link to={`/times/rituais/reunioes/${item.meetingId}`} className="text-sm text-primary hover:underline">Levantado em reunião</Link>}
          {item.canEdit ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Situação" htmlFor="id-st"><Select id="id-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{(Object.keys(IMPEDIMENT_STATUS_LABELS) as ImpedimentStatus[]).map((s) => <option key={s} value={s}>{IMPEDIMENT_STATUS_LABELS[s]}</option>)}</Select></FormField>
                <FormField label="Quem remove" htmlFor="id-o"><Select id="id-o" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
                <FormField label="Prazo" htmlFor="id-d"><Input id="id-d" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
              </div>
              {(f.status === 'removido' || f.status === 'aceito') && <FormField label={f.status === 'removido' ? 'Como foi removido' : 'Por que aceitar e como convivemos'} htmlFor="id-res" required><Textarea id="id-res" rows={2} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} /></FormField>}
              {err && f.status !== item.status && <p className="text-sm text-danger">{err}</p>}
              {changed && <Button variant="primary" disabled={!!err && f.status !== item.status} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}
              {open && (
                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <FormField label="Escalar para o nível acima — motivo" htmlFor="id-why" className="min-w-[240px] flex-1"><Input id="id-why" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} /></FormField>
                  <Button variant="secondary" disabled={f.why.trim().length < 5} loading={esc.isPending} onClick={() => esc.mutate()}>Escalar</Button>
                </div>
              )}
            </section>
          ) : <p className="text-sm text-muted">Responsável: {item.ownerName}{item.dueOn && ` · até ${fmtDate(item.dueOn)}`}</p>}
          {item.resolution && !item.canEdit && <p className="text-sm"><b>Resolução:</b> {item.resolution}</p>}
          <section><h4 className="mb-1 font-bold text-ink">Histórico</h4><ol className="space-y-1 text-sm">{(h.data?.items ?? []).map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName ?? 'Sistema'} {HIST[e.type] ?? e.type}{typeof e.payload.reason === 'string' && `: ${e.payload.reason}`}{typeof e.payload.resolution === 'string' && e.payload.resolution && `: ${e.payload.resolution}`}</li>)}</ol></section>
        </div>
      )}
    </Drawer>
  );
}

function NewImpediment({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const blank = { title: '', description: '', severity: 'media', ownerId: '', dueOn: '' };
  const [f, setF] = useState(blank);
  const m = useMutation({
    mutationFn: () => api('/impediments', { method: 'POST', body: { title: f.title, description: f.description || null, severity: f.severity, ownerId: f.ownerId, dueOn: f.dueOn || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['impediments'] }); setF(blank); onClose(); toast({ tone: 'success', message: 'Impedimento registrado e responsável avisado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Registrar impedimento" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 5 || !f.ownerId} loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button></>}>
      <div className="space-y-3">
        <FormField label="O que está travando" htmlFor="ni-t" required><Input id="ni-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <FormField label="Detalhes" htmlFor="ni-d"><Textarea id="ni-d" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Quem remove" htmlFor="ni-o" required><Select id="ni-o" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Escolha</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
          <FormField label="Gravidade" htmlFor="ni-s"><Select id="ni-s" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></FormField>
          <FormField label="Até" htmlFor="ni-due"><Input id="ni-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
        </div>
      </div>
    </Modal>
  );
}
