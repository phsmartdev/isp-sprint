/**
 * Licitações · L3: matriz RACI do projeto, aprovações (plano, Go/No-Go, proposta, alteração crítica, contratação)
 * e a configuração da empresa (pessoas por área e quem aprova cada decisão).
 */
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Send, Users } from 'lucide-react';
import { BID_APPROVAL_KINDS, BID_APPROVAL_LABELS, BID_APPROVAL_STATUS_LABELS, BID_AREAS, BID_AREA_LABELS, BID_AREA_ROLES, BID_AREA_ROLE_LABELS, GO_DECISIONS, GO_LABELS, type BidApprovalKind, type BidApprovalStatus, type BidArea, type BidAreaRole, type GoDecision, type ProjectTaskSpec } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Row = { id: string; parentId: string | null; title: string; ownerId: string; ownerName: string; spec: ProjectTaskSpec | null; milestoneId: string | null; rowVersion: number };
type Phase = { id: string; name: string };
type Approval = { id: string; kind: BidApprovalKind; version: number; status: BidApprovalStatus; title: string; justification: string | null; snapshot: Record<string, unknown>; requester: string; approver: string; decider: string | null; decision: GoDecision | null; decisionNote: string | null; createdAt: string; decidedAt: string | null; canDecide: boolean; canCancel: boolean };
type Approvals = { items: Approval[]; resolved: Record<BidApprovalKind, { id: string; name: string; via: 'regra' | 'diretoria' } | null>; planStatus: string; goDecision: GoDecision | null; price: { id: string; version: number; discountBp: number; level: string; createdAt: string; decision: string | null }[] };
const TONE: Record<BidApprovalStatus, 'neutral' | 'orange' | 'green' | 'red' | 'blue'> = { em_elaboracao: 'neutral', aguardando: 'orange', aprovado: 'green', devolvido: 'blue', rejeitado: 'red', cancelado: 'neutral' };

// ------------------------------------------------------------------ RACI
export function RaciMatrix({ projectId, phases, rows, editable, edit }: { projectId: string; phases: Phase[]; rows: Row[]; editable: boolean; edit: (b: { ids: string[]; patch: Record<string, unknown> }) => void }) {
  const lk = useLookups();
  const users = lk.data?.users ?? [];
  const name = (id?: string | null) => users.find((u) => u.id === id)?.name ?? '';
  const [ci, setCi] = useState<{ row: Row; key: 'consulted' | 'informed' } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const assign = useMutation({
    mutationFn: () => api<{ assigned: number; missingAreas: string[] }>(`/projects/${projectId}/licitacao/atribuir-areas`, { method: 'POST' }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['licitacao-plano', projectId] }); toast({ tone: 'success', message: `${r.assigned} macrotarefa(s) atribuídas${r.missingAreas.length ? ` · sem titular: ${r.missingAreas.map((a) => BID_AREA_LABELS[a as BidArea]).join(', ')}` : ''}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const macros = rows.filter((r) => !r.parentId);
  return (
    <section className="card p-0" aria-label="Matriz RACI">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="text-xs text-muted"><b className="text-ink">R</b> executa · <b className="text-ink">A</b> aprova (um só) · <b className="text-ink">C</b> é consultado · <b className="text-ink">I</b> é informado</span>
        <span className="flex-1" />
        {editable && <Button size="sm" loading={assign.isPending} onClick={() => assign.mutate()}><Users className="h-4 w-4" aria-hidden />Atribuir responsáveis pelas áreas</Button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="border-b-2 border-line text-left text-[11px] font-semibold uppercase tracking-wide text-muted"><th className="px-3 py-2">Macrotarefa</th><th className="px-2">Área</th><th className="px-2">R</th><th className="px-2">A</th><th className="px-2">C</th><th className="px-2">I</th></tr></thead>
          <tbody>{phases.map((ph) => (
            <Fragment key={ph.id}>
              <tr className="bg-surface-2"><td colSpan={6} className="px-3 py-1.5 text-xs font-bold text-ink">{ph.name}</td></tr>
              {macros.filter((r) => r.milestoneId === ph.id).map((r) => (
                <tr key={r.id} className="border-b border-line">
                  <td className="px-3 py-1.5 text-ink">{r.title}</td>
                  <td className="px-2 text-xs text-muted">{BID_AREA_LABELS[(r.spec?.area ?? 'comercial') as BidArea]}</td>
                  <td className="px-2 text-xs">{r.ownerName}{r.spec?.area !== 'comercial' && !r.spec?.assigned && <span className="block text-[10px] text-warning">a definir pela área</span>}</td>
                  <td className="px-2"><Select aria-label={`Aprovador (A): ${r.title}`} className="h-8 w-44" disabled={!editable} value={r.spec?.approverId ?? ''} onChange={(e) => edit({ ids: [r.id], patch: { approverId: e.target.value || null } })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></td>
                  {(['consulted', 'informed'] as const).map((k) => (
                    <td key={k} className="px-2"><button type="button" disabled={!editable} className="max-w-[14rem] truncate text-left text-xs text-primary hover:underline disabled:text-muted disabled:no-underline" aria-label={`${k === 'consulted' ? 'Consultados (C)' : 'Informados (I)'}: ${r.title}`} onClick={() => setCi({ row: r, key: k })}>{(r.spec?.[k] ?? []).map(name).join(', ') || (editable ? '+ definir' : '—')}</button></td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
      {ci && <PeopleModal title={`${ci.key === 'consulted' ? 'Consultados (C)' : 'Informados (I)'} — ${ci.row.title}`} value={ci.row.spec?.[ci.key] ?? []} onClose={() => setCi(null)} onSave={(v) => { edit({ ids: [ci.row.id], patch: { [ci.key]: v } }); setCi(null); }} />}
    </section>
  );
}

function PeopleModal({ title, value, onClose, onSave }: { title: string; value: string[]; onClose: () => void; onSave: (v: string[]) => void }) {
  const lk = useLookups();
  const [pick, setPick] = useState(value);
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onSave(pick)}>Salvar</Button></>}>
      <div className="max-h-[50vh] space-y-1 overflow-auto">{(lk.data?.users ?? []).map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={pick.includes(u.id)} onChange={(e) => setPick(e.target.checked ? [...pick, u.id] : pick.filter((x) => x !== u.id))} />{u.name}</label>)}</div>
    </Modal>
  );
}

// ------------------------------------------------------------------ aprovações
export function BidApprovals({ projectId, canRequest }: { projectId: string; canRequest: boolean }) {
  const key = ['licitacao-aprovacoes', projectId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Approvals>(`/projects/${projectId}/licitacao/aprovacoes`) });
  const [req, setReq] = useState<BidApprovalKind | null>(null);
  const [dec, setDec] = useState<Approval | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['licitacao-plano', projectId] }); };
  const cancel = useMutation({ mutationFn: (id: string) => api(`/licitacoes/aprovacoes/${id}/cancelar`, { method: 'POST', body: { note: null } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Pedido cancelado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const last = (k: BidApprovalKind) => d.items.find((a) => a.kind === k);
  return (
    <div className="space-y-4" aria-label="Aprovações">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{BID_APPROVAL_KINDS.map((k) => {
        const a = last(k), r = d.resolved[k];
        return (
          <section key={k} className="card p-4" aria-label={`Aprovação: ${BID_APPROVAL_LABELS[k]}`}>
            <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-bold text-ink">{BID_APPROVAL_LABELS[k]}</h3>{a ? <Chip tone={TONE[a.status]}>{BID_APPROVAL_STATUS_LABELS[a.status]}{a.decision ? ` · ${GO_LABELS[a.decision]}` : ''}</Chip> : <Chip>Em elaboração</Chip>}</div>
            <p className="mt-1 text-xs text-muted">Aprovador (A): <b className="text-ink">{r?.name ?? 'não definido'}</b>{r?.via === 'diretoria' && ' · gestor da Diretoria'}</p>
            {a && <p className="mt-1 text-xs text-muted">v{a.version} · pedido por {a.requester} em {fmtDateTime(a.createdAt)}{a.decidedAt && ` · decidido em ${fmtDateTime(a.decidedAt)}`}</p>}
            {a?.decisionNote && <p className="mt-1 text-xs text-ink">“{a.decisionNote}”</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {a?.canDecide && <Button size="sm" variant="primary" onClick={() => setDec(a)}><CheckCircle2 className="h-4 w-4" aria-hidden />Decidir</Button>}
              {a?.canCancel && <Button size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(a.id)}>Cancelar pedido</Button>}
              {canRequest && a?.status !== 'aguardando' && !(k === 'plano' && ['aprovado', 'alterado'].includes(d.planStatus)) && !(k === 'alteracao_critica' && d.planStatus !== 'alterado') && <Button size="sm" onClick={() => setReq(k)}><Send className="h-4 w-4" aria-hidden />{a ? 'Submeter de novo' : 'Submeter'}</Button>}
              {a?.status === 'aguardando' && !a.canDecide && <span className="inline-flex items-center gap-1 text-xs text-muted"><Clock className="h-3.5 w-3.5" aria-hidden />aguardando {a.approver}</span>}
            </div>
          </section>
        );
      })}
        <section className="card p-4" aria-label="Exceções de preço e margem">
          <h3 className="text-sm font-bold text-ink">Exceções de preço e margem</h3>
          <p className="mt-1 text-xs text-muted">Seguem as alçadas comerciais (botão “Pedir aprovação” na oportunidade).</p>
          {d.price.length ? <ul className="mt-2 space-y-1 text-xs">{d.price.map((p) => <li key={p.id}>v{p.version} · desconto {(p.discountBp / 100).toLocaleString('pt-BR')}% · alçada {p.level} · <b>{p.decision ?? 'aguardando'}</b></li>)}</ul> : <p className="mt-2 text-xs text-muted">Nenhum pedido.</p>}
        </section>
      </div>
      <section className="card p-0" aria-label="Histórico de aprovações">
        <h3 className="border-b border-line px-4 py-2 text-sm font-bold text-ink">Histórico</h3>
        {!d.items.length ? <p className="px-4 py-3 text-sm text-muted">Nenhuma aprovação ainda.</p> : (
          <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2">Decisão</th><th>Versão</th><th>Situação</th><th>Pedido</th><th>Aprovador</th><th>Justificativa / parecer</th></tr></thead>
            <tbody>{d.items.map((a) => <tr key={a.id} className="border-b border-line align-top"><td className="px-4 py-2 text-ink">{BID_APPROVAL_LABELS[a.kind]}</td><td className="tabular-nums">v{a.version}</td><td><Chip tone={TONE[a.status]}>{BID_APPROVAL_STATUS_LABELS[a.status]}{a.decision ? ` · ${GO_LABELS[a.decision]}` : ''}</Chip></td><td className="text-xs text-muted">{a.requester}<br />{fmtDateTime(a.createdAt)}</td><td className="text-xs text-muted">{a.decider ?? a.approver}{a.decidedAt && <><br />{fmtDateTime(a.decidedAt)}</>}</td><td className="max-w-md text-xs"><span className="text-ink">{a.justification}</span>{a.decisionNote && <span className="block text-muted">Parecer: {a.decisionNote}</span>}</td></tr>)}</tbody></table>
        )}
      </section>
      {req && <RequestModal projectId={projectId} kind={req} approver={d.resolved[req]?.name ?? null} onClose={() => setReq(null)} onDone={() => { setReq(null); refresh(); }} />}
      {dec && <DecideModal a={dec} onClose={() => setDec(null)} onDone={() => { setDec(null); refresh(); }} />}
    </div>
  );
}

function RequestModal({ projectId, kind, approver, onClose, onDone }: { projectId: string; kind: BidApprovalKind; approver: string | null; onClose: () => void; onDone: () => void }) {
  const [just, setJust] = useState('');
  const [rec, setRec] = useState<GoDecision | ''>('');
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/projects/${projectId}/licitacao/aprovacoes`, { method: 'POST', body: { kind, justification: just, recommendation: kind === 'go_no_go' ? rec || null : null } }), onSuccess: () => { toast({ tone: 'success', message: 'Enviado para aprovação' }); onDone(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`Submeter: ${BID_APPROVAL_LABELS[kind]}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={just.trim().length < 5 || (kind === 'go_no_go' && !rec)} onClick={() => m.mutate()}>Enviar para {approver ?? 'aprovação'}</Button></>}>
      <div className="space-y-3">
        {!approver && <Notice tone="warning">Ninguém aprova esta decisão ainda. Defina em Configurações → Modelos → Projeto de licitação.</Notice>}
        {kind === 'go_no_go' && <FormField label="Recomendação" htmlFor="ap-rec"><Select id="ap-rec" value={rec} onChange={(e) => setRec(e.target.value as GoDecision)}><option value="">Escolha</option>{GO_DECISIONS.map((g) => <option key={g} value={g}>{GO_LABELS[g]}</option>)}</Select></FormField>}
        <FormField label="Justificativa" htmlFor="ap-just" hint={kind === 'plano' || kind === 'alteracao_critica' ? 'O plano atual (tarefas, responsáveis, datas, critérios) vai congelado junto para conferência.' : undefined}><Textarea id="ap-just" rows={4} value={just} onChange={(e) => setJust(e.target.value)} /></FormField>
        <p className="text-xs text-muted">A decisão acontece aqui no sistema; resposta por e-mail não vale como aprovação. O aprovador recebe uma tarefa.</p>
      </div>
    </Modal>
  );
}

function DecideModal({ a, onClose, onDone }: { a: Approval; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<GoDecision | ''>((a.snapshot.recommendation as GoDecision | undefined) ?? '');
  const toast = useToast();
  const m = useMutation({ mutationFn: (status: 'aprovado' | 'devolvido' | 'rejeitado') => api(`/licitacoes/aprovacoes/${a.id}/decidir`, { method: 'POST', body: { status, decision: a.kind === 'go_no_go' && status === 'aprovado' ? decision || null : null, note: note.trim() || null } }), onSuccess: () => { toast({ tone: 'success', message: 'Decisão registrada' }); onDone(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const rows = (a.snapshot.rows as { title: string; owner: string; dueOn: string | null; area: string }[] | undefined) ?? [];
  return (
    <Modal open onClose={onClose} title={`Decidir: ${a.title}`} size="lg" footer={<><Button onClick={onClose}>Depois</Button><Button loading={m.isPending} disabled={note.trim().length < 5} onClick={() => m.mutate('rejeitado')}>Rejeitar</Button><Button loading={m.isPending} disabled={note.trim().length < 5} onClick={() => m.mutate('devolvido')}>Devolver para ajustes</Button><Button variant="primary" loading={m.isPending} disabled={a.kind === 'go_no_go' && (!decision || (decision === 'go_condicionado' && note.trim().length < 5))} onClick={() => m.mutate('aprovado')}>Aprovar</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Pedido de {a.requester} · v{a.version}</p>
        <p className="text-ink">{a.justification}</p>
        {rows.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold text-muted">Plano submetido ({rows.length} macrotarefas)</summary><ul className="mt-1 max-h-48 overflow-auto text-xs">{rows.map((r, i) => <li key={i}>{r.title} · {r.owner} · {r.dueOn ?? 'sem data'}</li>)}</ul></details>}
        {a.kind === 'go_no_go' && <FormField label="Decisão" htmlFor="dc-go"><Select id="dc-go" value={decision} onChange={(e) => setDecision(e.target.value as GoDecision)}><option value="">Escolha</option>{GO_DECISIONS.map((g) => <option key={g} value={g}>{GO_LABELS[g]}</option>)}</Select></FormField>}
        <FormField label="Parecer" htmlFor="dc-note" hint="Obrigatório para devolver, rejeitar ou Go condicionado (descreva as condições)"><Textarea id="dc-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ configuração da empresa
type Gov = { members: { area: BidArea; userId: string; role: BidAreaRole; name: string }[]; rules: { kind: BidApprovalKind; approverId: string; name: string }[]; canEdit: boolean };
export function BidGovernanceAdmin() {
  const q = useQuery({ queryKey: ['licitacao-governanca'], queryFn: () => api<Gov>('/licitacoes/governanca') });
  const lk = useLookups();
  const users = lk.data?.users ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [area, setArea] = useState<BidArea | null>(null);
  const saveRule = useMutation({ mutationFn: (v: { kind: BidApprovalKind; approverId: string | null }) => api<Gov>(`/licitacoes/governanca/aprovadores/${v.kind}`, { method: 'PUT', body: { approverId: v.approverId } }), onSuccess: (g) => { qc.setQueryData(['licitacao-governanca'], { ...g, canEdit: true }); toast({ tone: 'success', message: 'Aprovador salvo' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4" aria-label="Responsáveis por área">
        <h2 className="text-sm font-bold text-ink">Responsáveis por área</h2>
        <p className="text-xs text-muted">O titular recebe as macrotarefas da área (R). O gestor da Diretoria aprova o que não tiver aprovador definido.</p>
        <ul className="mt-2 divide-y divide-line text-sm">{BID_AREAS.map((a) => {
          const ms = g.members.filter((m) => m.area === a);
          return <li key={a} className="flex items-start gap-2 py-2"><b className="w-36 shrink-0 text-ink">{BID_AREA_LABELS[a]}</b><span className="flex-1 text-xs text-muted">{ms.length ? ms.map((m) => `${m.name} (${BID_AREA_ROLE_LABELS[m.role].toLowerCase()})`).join(' · ') : 'ninguém'}</span>{g.canEdit && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setArea(a)}>Editar</button>}</li>;
        })}</ul>
      </section>
      <section className="card p-4" aria-label="Aprovadores por decisão">
        <h2 className="text-sm font-bold text-ink">Quem aprova (Accountable)</h2>
        <p className="text-xs text-muted">Um aprovador por tipo de decisão. Exceções de preço e margem seguem as alçadas comerciais.</p>
        <div className="mt-2 space-y-2">{BID_APPROVAL_KINDS.map((k) => {
          const r = g.rules.find((x) => x.kind === k);
          return <FormField key={k} label={BID_APPROVAL_LABELS[k]} htmlFor={`gv-${k}`}><Select id={`gv-${k}`} className="h-9" disabled={!g.canEdit || saveRule.isPending} value={r?.approverId ?? ''} onChange={(e) => saveRule.mutate({ kind: k, approverId: e.target.value || null })}><option value="">Gestor da Diretoria</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>;
        })}</div>
      </section>
      {area && <AreaModal area={area} members={g.members.filter((m) => m.area === area)} onClose={() => setArea(null)} onSaved={(n) => { qc.setQueryData(['licitacao-governanca'], { ...n, canEdit: true }); setArea(null); toast({ tone: 'success', message: 'Área salva' }); }} />}
    </div>
  );
}

function AreaModal({ area, members, onClose, onSaved }: { area: BidArea; members: { userId: string; role: BidAreaRole }[]; onClose: () => void; onSaved: (g: Gov) => void }) {
  const lk = useLookups();
  const [rows, setRows] = useState(members.map((m) => ({ userId: m.userId, role: m.role })));
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api<Gov>(`/licitacoes/governanca/areas/${area}`, { method: 'PUT', body: { members: rows.filter((r) => r.userId) } }), onSuccess: onSaved, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`Área: ${BID_AREA_LABELS[area]}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label="Pessoa" className="h-9 flex-1" value={r.userId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))}><option value="">Escolha</option>{(lk.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            <Select aria-label="Papel" className="h-9 w-36" value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value as BidAreaRole } : x)))}>{BID_AREA_ROLES.map((ro) => <option key={ro} value={ro}>{BID_AREA_ROLE_LABELS[ro]}</option>)}</Select>
            <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remover</button>
          </div>
        ))}
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setRows([...rows, { userId: '', role: 'titular' }])}>+ Adicionar pessoa</button>
      </div>
    </Modal>
  );
}
