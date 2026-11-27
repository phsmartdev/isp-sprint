/**
 * Fura-fila no quadro (Etapa 6): solicitar a inclusão extraordinária numa Sprint aberta e a análise de impacto em quatro
 * áreas (nova demanda, capacidade, atividades impactadas, aprovação). A ordem de consumo é a mesma regra do backend
 * (analyzeFuraFila), recalculada enquanto a liderança marca as tarefas; quem decide de fato é o servidor.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Zap } from 'lucide-react';
import { CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, analyzeFuraFila, fmtMinutes, parseMinutes, type BoardKey, type CapacityCategory } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import type { Plan } from './SprintPlanner';

const h = (m: number | null | undefined) => (m == null ? '—' : fmtMinutes(m) || '0h');
const CAT_BAR: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#0F766E]', hipotese: 'bg-[#B45309]' };
type ReqRow = { id: string; activityId: string; title: string; status: string; statusLabel: string; estimateMinutes: number; neededBy: string; requestedByName: string | null; ownerName: string | null; createdAt: string };

function useInvalidate(board: BoardKey) {
  const qc = useQueryClient();
  return () => { for (const k of ['planejamento', 'quadro', 'fura-filas', 'fura-fila']) void qc.invalidateQueries({ queryKey: [k, board] }); };
}

/** Lista das solicitações da Sprint e o botão para pedir uma nova. */
export function FuraFilaListModal({ board, plan, onClose, onOpen }: { board: BoardKey; plan: Plan; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['fura-filas', board, plan.sprint?.id], queryFn: () => api<{ role: string; items: ReqRow[] }>(`/quadros/${board}/fura-filas${qs({ sprintId: plan.sprint!.id })}`), enabled: !!plan.sprint });
  const [asking, setAsking] = useState(false);
  return (
    <Modal open onClose={onClose} size="lg" title="Fura-filas da Sprint" footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={() => setAsking(true)}>Solicitar fura-fila</Button></>}>
      <p className="mb-3 text-sm text-muted">Fura-fila é uma tarefa fora do plano que precisa entrar nesta Sprint. A liderança decide com a análise de impacto: capacidade livre primeiro, depois testes de hipóteses, atividades internas e, só com aprovação da gerência, a estratégia comercial.</p>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <EmptyState title="Nenhuma solicitação nesta Sprint" description="Use Solicitar fura-fila quando algo urgente precisar entrar na semana." /> : (
        <ul className="divide-y divide-line border border-line">{q.data!.items.map((r) => (
          <li key={r.id}><button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2" onClick={() => onOpen(r.id)}>
            <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{r.title}</span><span className="text-xs text-muted">{h(r.estimateMinutes)} · prazo {fmtDate(r.neededBy)} · pedido por {r.requestedByName ?? '—'} · responsável {r.ownerName ?? '—'}</span></span>
            <Chip tone={r.status === 'aprovada' ? 'blue' : r.status === 'aguardando_gerencia' ? 'red' : ['rejeitada', 'cancelada', 'mantida_backlog'].includes(r.status) ? 'neutral' : 'sky'}>{r.statusLabel}</Chip>
          </button></li>
        ))}</ul>
      )}
      {asking && <RequestForm board={board} plan={plan} onClose={() => setAsking(false)} onCreated={(id) => { setAsking(false); void q.refetch(); onOpen(id); }} />}
    </Modal>
  );
}

function RequestForm({ board, plan, onClose, onCreated }: { board: BoardKey; plan: Plan; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const invalidate = useInvalidate(board);
  const candidates = plan.tasks.filter((t) => !t.selected);
  const [f, setF] = useState({ activityId: '', origin: '', justification: '', urgency: '', consequence: '', neededBy: '', estimate: '', ownerId: '' });
  const pick = (id: string) => { const t = candidates.find((x) => x.id === id); setF({ ...f, activityId: id, ownerId: t?.ownerId ?? f.ownerId, estimate: t?.estimateMinutes ? fmtMinutes(t.estimateMinutes) : f.estimate, neededBy: t?.dueDay ?? f.neededBy, origin: f.origin || (t?.opportunity ? `Oportunidade ${t.opportunity.label}` : '') }); };
  const t = candidates.find((x) => x.id === f.activityId);
  const est = parseMinutes(f.estimate);
  const valid = !!t && !!t.category && f.origin.trim().length >= 2 && f.justification.trim().length >= 10 && f.urgency.trim().length >= 5 && f.consequence.trim().length >= 5 && !!f.neededBy && !!est && !!f.ownerId;
  const m = useMutation({
    mutationFn: () => api<{ id: string }>(`/quadros/${board}/sprints/${plan.sprint!.id}/fura-filas`, { method: 'POST', body: { activityId: f.activityId, origin: f.origin.trim(), justification: f.justification.trim(), urgency: f.urgency.trim(), consequence: f.consequence.trim(), neededBy: f.neededBy, estimateMinutes: est, ownerId: f.ownerId } }),
    onSuccess: (r) => { invalidate(); toast({ tone: 'success', message: 'Fura-fila solicitado: a liderança decide com a análise de impacto' }); onCreated(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} size="lg" title="Solicitar fura-fila" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Solicitar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Tarefa" htmlFor="ff-task" className="sm:col-span-2" hint={t && !t.category ? 'Classifique a tarefa (comercial, interna ou hipótese) no detalhe dela antes de pedir.' : 'Crie a tarefa no quadro (Nova tarefa) se ela ainda não existir.'}>
          <Select id="ff-task" value={f.activityId} onChange={(e) => pick(e.target.value)}><option value="">Escolha a tarefa</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.ref}){c.category ? ` · ${CAPACITY_CATEGORY_LABELS[c.category]}` : ' · sem categoria'}</option>)}</Select>
        </FormField>
        <FormField label="Origem" htmlFor="ff-origin" hint="Quem ou o que gerou a demanda"><Input id="ff-origin" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></FormField>
        <FormField label="Responsável" htmlFor="ff-owner"><Select id="ff-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Escolha</option>{plan.capacity.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</Select></FormField>
        <FormField label="Prazo necessário" htmlFor="ff-due"><Input id="ff-due" type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></FormField>
        <FormField label="Esforço estimado" htmlFor="ff-est" hint="Ex.: 4h, 1h30"><Input id="ff-est" value={f.estimate} aria-invalid={!!f.estimate && !est} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></FormField>
        <FormField label="Justificativa" htmlFor="ff-just" className="sm:col-span-2"><Textarea id="ff-just" rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} /></FormField>
        <FormField label="Motivo da urgência" htmlFor="ff-urg"><Textarea id="ff-urg" rows={2} value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })} /></FormField>
        <FormField label="Consequência de não fazer" htmlFor="ff-cons"><Textarea id="ff-cons" rows={2} value={f.consequence} onChange={(e) => setF({ ...f, consequence: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

type LayerTask = { activityId: string; title: string; ownerName: string | null; remainingMinutes: number; dueDay: string | null; link: string | null; furaFila: boolean; selected: boolean; blockedReason: string | null; impact: string };
type Detail = {
  role: 'gestao' | 'lideranca' | 'colaborador'; sprint: { id: string; weekStart: string; status: string };
  request: { id: string; status: string; statusLabel: string; title: string; opportunity: string | null; origin: string; justification: string; urgency: string; consequence: string; neededBy: string; estimateMinutes: number;
    requestedBy: string; requestedByName: string | null; ownerName: string | null; decidedByName: string | null; decidedAt: string | null; decisionReason: string | null; approvedByName: string | null; approvedAt: string | null; approvalReason: string | null };
  stale: boolean; storedSelection: { activityId: string; newDueOn: string | null }[] | null;
  live: null | {
    analysis: { suggestedIds: string[] };
    capacity: { totalNetMinutes: number; committedMinutes: number; freeMinutes: number; neededMinutes: number; toRecoverMinutes: number; remainingByCategory: Record<CapacityCategory, number>; owner: { name: string; netMinutes: number | null; committedMinutes: number } | null };
    layers: { category: CapacityCategory; label: string; recoverableMinutes: number; tasks: LayerTask[] }[];
  };
};

/** Análise de impacto e decisão. */
export function FuraFilaAnalysisModal({ board, rid, meId, onClose }: { board: BoardKey; rid: string; meId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['fura-fila', board, rid], queryFn: () => api<Detail>(`/quadros/${board}/fura-filas/${rid}`) });
  return (
    <Modal open onClose={onClose} size="xl" title="Análise de impacto do fura-fila" footer={q.data ? undefined : <Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Analysis key={JSON.stringify(q.data!.storedSelection) + q.data!.request.status} board={board} d={q.data!} meId={meId} onClose={onClose} />}
    </Modal>
  );
}

function Analysis({ board, d, meId, onClose }: { board: BoardKey; d: Detail; meId: string; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate(board);
  const r = d.request;
  const live = d.live;
  const initial = d.storedSelection ?? (live ? live.analysis.suggestedIds.map((id) => ({ activityId: id, newDueOn: null as string | null })) : []);
  const [sel, setSel] = useState<Record<string, string | null>>(Object.fromEntries(initial.map((x) => [x.activityId, x.newDueOn])));
  const [reason, setReason] = useState('');
  const allTasks = useMemo(() => (live?.layers ?? []).flatMap((l) => l.tasks.map((t) => ({ ...t, category: l.category }))), [live]);
  // mesma regra do servidor, ao vivo
  const a = live ? analyzeFuraFila({
    neededMinutes: live.capacity.neededMinutes, freeMinutes: live.capacity.freeMinutes, selectedIds: Object.keys(sel),
    candidates: allTasks.map((t) => ({ id: t.activityId, category: t.category, remainingMinutes: t.blockedReason?.startsWith('sem esforço') ? 0 : t.remainingMinutes, protectedCommitment: !!t.blockedReason?.startsWith('compromisso'), done: !!t.blockedReason?.startsWith('já concluída') })),
  }) : null;
  const leads = d.role !== 'colaborador';
  const open = ['pendente', 'ajustes', 'aguardando_gerencia'].includes(r.status);
  const withGerencia = r.status === 'aguardando_gerencia';
  const canDecide = open && leads && (!withGerencia || d.role === 'gestao');
  const selection = Object.entries(sel).map(([activityId, newDueOn]) => ({ activityId, newDueOn: newDueOn || null }));
  const commercialMissingDue = allTasks.some((t) => t.category === 'comercial' && t.activityId in sel && !sel[t.activityId]);
  const decide = useMutation({
    mutationFn: (action: string) => api<{ ok: boolean }>(`/quadros/${board}/fura-filas/${r.id}/decisao`, { method: 'POST', body: { action, selection: withGerencia ? undefined : selection, reason: reason.trim() || undefined } }),
    onSuccess: (_d, action) => {
      invalidate();
      toast({ tone: 'success', message: { autorizar: 'Fura-fila incluído na Sprint', aprovar: 'Aprovado: fura-fila incluído na Sprint', solicitar_aprovacao: 'Enviado para aprovação da gerência', ajustes: 'Ajustes solicitados', rejeitar: 'Fura-fila rejeitado', manter_backlog: 'Mantido no backlog', cancelar: 'Solicitação cancelada' }[action] ?? 'Feito' });
      onClose();
    },
    onError: (e) => { invalidate(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const after = live ? Object.fromEntries(CAPACITY_CATEGORIES.map((c) => [c, live.capacity.remainingByCategory[c] - (a?.selected[c] ?? 0)])) as Record<CapacityCategory, number> : null;
  const beforeTotal = live ? CAPACITY_CATEGORIES.reduce((t, c) => t + live.capacity.remainingByCategory[c], 0) : 0;
  const afterTotal = after ? CAPACITY_CATEGORIES.reduce((t, c) => t + after[c], 0) + (live?.capacity.neededMinutes ?? 0) : 0;
  const scale = Math.max(beforeTotal, afterTotal, 1);

  return (
    <div className="space-y-4">
      {/* Área 1 — nova demanda */}
      <section aria-label="Nova demanda" className="border border-line p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold text-ink">{r.title}</h3><Chip tone={r.status === 'aprovada' ? 'blue' : withGerencia ? 'red' : 'sky'}>{r.statusLabel}</Chip></div>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Origem</dt><dd>{r.origin}</dd></div>
          <div><dt className="text-xs text-muted">Oportunidade</dt><dd>{r.opportunity ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted">Pedido por</dt><dd>{r.requestedByName ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted">Prazo necessário</dt><dd>{fmtDate(r.neededBy)}</dd></div>
          <div><dt className="text-xs text-muted">Esforço</dt><dd className="num">{h(r.estimateMinutes)}</dd></div>
          <div><dt className="text-xs text-muted">Responsável</dt><dd>{r.ownerName ?? '—'}</dd></div>
          <div className="sm:col-span-3"><dt className="text-xs text-muted">Justificativa</dt><dd>{r.justification}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted">Urgência</dt><dd>{r.urgency}</dd></div>
          <div><dt className="text-xs text-muted">Se não fizer</dt><dd>{r.consequence}</dd></div>
        </dl>
        {(r.decidedByName || r.approvedByName) && <p className="mt-2 text-xs text-muted">{r.decidedByName ? `Decisão da liderança: ${r.decidedByName}${r.decidedAt ? ` em ${fmtDateTime(r.decidedAt)}` : ''}${r.decisionReason ? ` · ${r.decisionReason}` : ''}` : ''}{r.approvedByName ? ` · Aprovação da gerência: ${r.approvedByName}${r.approvedAt ? ` em ${fmtDateTime(r.approvedAt)}` : ''}${r.approvalReason ? ` · ${r.approvalReason}` : ''}` : ''}</p>}
      </section>

      {!live ? <p className="text-sm text-muted">{open ? 'A Sprint não está em andamento: não há análise a fazer.' : 'Solicitação decidida. O histórico fica na Sprint e na tarefa.'}</p> : (
        <>
          {d.stale && <p role="alert" className="flex gap-2 border-l-4 border-l-[#B45309] bg-[#FFF7E6] px-3 py-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />A capacidade ou as tarefas da Sprint mudaram desde o pedido de aprovação. Aprovar agora devolve a solicitação para a liderança refazer a análise.</p>}
          {/* Área 2 — capacidade */}
          <section aria-label="Capacidade" className="grid gap-3 border border-line p-3 lg:grid-cols-[260px_1fr]">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Capacidade original</dt><dd className="num font-semibold">{h(live.capacity.totalNetMinutes)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Comprometida</dt><dd className="num">{h(live.capacity.committedMinutes)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Livre</dt><dd className="num font-semibold">{h(live.capacity.freeMinutes)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Esforço necessário</dt><dd className="num">{h(live.capacity.neededMinutes)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">A recuperar</dt><dd className="num font-bold text-ink">{h(live.capacity.toRecoverMinutes)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Liberado na seleção</dt><dd className={clsx('num font-bold', a && !a.sufficient ? 'text-danger' : 'text-ink')}>{h(a?.selectedMinutes)}</dd></div>
              {live.capacity.owner && <div className="pt-1 text-xs text-muted">{live.capacity.owner.name}: {h(live.capacity.owner.committedMinutes)} comprometidas de {live.capacity.owner.netMinutes == null ? 'sem jornada' : h(live.capacity.owner.netMinutes)}</div>}
            </dl>
            <div className="space-y-2 text-xs">
              {([['Planejado restante', live.capacity.remainingByCategory, 0], ['Depois da inclusão', after!, live.capacity.neededMinutes]] as const).map(([label, by, extra]) => (
                <div key={label}>
                  <p className="mb-0.5 font-semibold text-muted">{label}</p>
                  <div className="flex h-4 w-full bg-surface-2" aria-hidden>
                    {CAPACITY_CATEGORIES.map((c) => <div key={c} className={CAT_BAR[c]} style={{ width: `${(Math.max(0, by[c]) / scale) * 100}%` }} />)}
                    {extra > 0 && <div className="bg-[repeating-linear-gradient(45deg,#2D3339,#2D3339_4px,#5B6470_4px,#5B6470_8px)]" style={{ width: `${(extra / scale) * 100}%` }} />}
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-muted">{CAPACITY_CATEGORIES.map((c) => <span key={c}><span className={clsx('mr-1 inline-block h-2 w-2', CAT_BAR[c])} />{CAPACITY_CATEGORY_LABELS[c]} {h(Math.max(0, by[c]))}</span>)}{extra > 0 && <span>Fura-fila {h(extra)}</span>}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Área 3 — atividades impactadas, na ordem obrigatória */}
          <section aria-label="Atividades impactadas" className="space-y-3">
            {live.capacity.toRecoverMinutes === 0 && <p className="border-l-4 border-l-primary bg-surface-2 px-3 py-2 text-sm">Há capacidade livre suficiente: nenhuma tarefa precisa sair da Sprint.</p>}
            {live.layers.map((l, n) => (
              <div key={l.category}>
                <h4 className="text-sm font-bold text-ink">{n + 1}. {l.label} <span className="font-normal text-muted">· liberável {h(l.recoverableMinutes)}{a ? ` · selecionado ${h(a.selected[l.category])}` : ''}</span></h4>
                {!l.tasks.length ? <p className="text-xs text-muted">Nenhuma tarefa desta categoria na Sprint.</p> : (
                  <table className="mt-1 w-full border border-line text-sm"><thead className="bg-surface-2 text-left text-xs text-muted"><tr><th className="w-8 px-2 py-1" /><th className="px-2 py-1 font-semibold">Tarefa</th><th className="px-2 py-1 font-semibold">Responsável</th><th className="px-2 py-1 font-semibold">Restante</th><th className="px-2 py-1 font-semibold">Prazo atual</th><th className="px-2 py-1 font-semibold">Novo prazo</th><th className="px-2 py-1 font-semibold">Impacto</th></tr></thead>
                    <tbody>{l.tasks.map((t) => { const on = t.activityId in sel; return (
                      <tr key={t.activityId} className={clsx('border-t border-line', on && 'bg-primary-soft/40')}>
                        <td className="px-2 py-1"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Deslocar ${t.title}`} disabled={!canDecide || withGerencia || !!t.blockedReason} checked={on} onChange={(e) => { const n2 = { ...sel }; if (e.target.checked) n2[t.activityId] = null; else delete n2[t.activityId]; setSel(n2); }} /></td>
                        <td className="px-2 py-1"><span className="font-semibold text-ink">{t.title}</span>{t.furaFila && <Chip tone="sky">fura-fila</Chip>}{t.link && <span className="block text-xs text-muted">{t.link}</span>}{t.blockedReason && <span className="block text-xs text-danger">Não pode sair: {t.blockedReason}</span>}</td>
                        <td className="px-2 py-1">{t.ownerName ?? '—'}</td>
                        <td className="num px-2 py-1">{h(t.remainingMinutes)}</td>
                        <td className="px-2 py-1">{t.dueDay ? fmtDate(t.dueDay) : '—'}</td>
                        <td className="px-2 py-1">{on ? <Input aria-label={`Novo prazo de ${t.title}`} type="date" className="h-8" disabled={!canDecide || withGerencia} value={sel[t.activityId] ?? ''} onChange={(e) => setSel({ ...sel, [t.activityId]: e.target.value || null })} /> : '—'}</td>
                        <td className="px-2 py-1 text-xs text-muted">{on ? t.impact : '—'}</td>
                      </tr>
                    ); })}</tbody>
                  </table>
                )}
              </div>
            ))}
            {a && a.issues.length > 0 && <ul className="space-y-0.5 text-sm text-danger">{a.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
            {a && !a.sufficient && <p className="text-sm font-semibold text-danger">A seleção não libera o esforço necessário. Sem capacidade suficiente, a demanda fica aguardando decisão, renegociação ou outra alternativa.</p>}
          </section>

          {/* Área 4 — aprovação */}
          {a?.requiresManagerApproval && (
            <section aria-label="Aprovação" role="alert" className="border-2 border-danger bg-danger-soft p-3">
              <p className="font-bold text-danger">Aprovação gerencial obrigatória.</p>
              <p className="text-sm text-ink">A inclusão compromete atividades comerciais previamente planejadas e exige renegociação dos compromissos. Proponha o novo prazo de cada atividade comercial; a liderança não efetiva sozinha.</p>
            </section>
          )}
        </>
      )}

      {(canDecide || (open && r.requestedBy === meId)) && (
        <div className="space-y-2 border-t border-line pt-3">
          {canDecide && <FormField label={withGerencia ? 'Justificativa da gerência' : 'Justificativa da decisão'} htmlFor="ff-reason" hint="Obrigatória para aprovar, rejeitar ou pedir ajustes; fica registrada com seu nome, data e hora"><Textarea id="ff-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
          <div className="flex flex-wrap justify-end gap-2">
            {open && r.requestedBy === meId && <Button variant="ghost" loading={decide.isPending} onClick={() => decide.mutate('cancelar')}>Cancelar solicitação</Button>}
            {canDecide && !withGerencia && <Button variant="ghost" loading={decide.isPending} onClick={() => decide.mutate('manter_backlog')}>Manter no backlog</Button>}
            {canDecide && <Button variant="secondary" disabled={reason.trim().length < 10} loading={decide.isPending} onClick={() => decide.mutate('ajustes')}>Solicitar ajustes</Button>}
            {canDecide && <Button variant="secondary" disabled={reason.trim().length < 10} loading={decide.isPending} onClick={() => decide.mutate('rejeitar')}>Rejeitar inclusão</Button>}
            {canDecide && !withGerencia && a?.requiresManagerApproval && d.role === 'lideranca' && <Button variant="primary" disabled={!!a.issues.length || !a.sufficient || commercialMissingDue} loading={decide.isPending} onClick={() => decide.mutate('solicitar_aprovacao')}>Solicitar aprovação gerencial</Button>}
            {canDecide && !withGerencia && a && (!a.requiresManagerApproval || d.role === 'gestao') && <Button variant="primary" disabled={!!a.issues.length || !a.sufficient || (a.requiresManagerApproval && reason.trim().length < 10)} loading={decide.isPending} onClick={() => decide.mutate('autorizar')}>Autorizar e replanejar</Button>}
            {canDecide && withGerencia && <Button variant="primary" disabled={reason.trim().length < 10} loading={decide.isPending} onClick={() => decide.mutate('aprovar')}>Aprovar e replanejar</Button>}
          </div>
        </div>
      )}
      {!(canDecide || (open && r.requestedBy === meId)) && <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Fechar</Button></div>}
    </div>
  );
}
