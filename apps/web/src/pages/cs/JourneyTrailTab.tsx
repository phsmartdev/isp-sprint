/** Funcionalidade 01 — aba Trilha (com detalhe e histórico de cada marco), modo Apresentar, links externos e a página pública. */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Copy, KeyRound, Link2, MonitorPlay } from 'lucide-react';
import { LINK_DURATIONS, LINK_STATE_LABELS, MILESTONE_EVENT_LABELS, STOP_STATUS_LABELS, type LinkState, type MilestoneEventType } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { JourneyPresenter, JourneyTrail, TrailLegend, type TrailData, type TrailStop } from '../../features/cs/JourneyTrail';

type Ev = { id: string; milestoneId: string; type: MilestoneEventType; payload: { from?: unknown; to?: unknown; via?: string; reconstituido?: boolean }; actorName: string; fromName?: string | null; toName?: string | null; createdAt: string };
type Link = { id: string; label: string; expiresAt: string; requiresCode: boolean; showNotes: boolean; state: LinkState; accessCount: number; lastAccessAt: string | null; failedAttempts: number; revokedAt: string | null; revokeReason: string | null; createdByName: string | null; createdAt: string; events: { type: string; createdAt: string }[] };
type Trail = TrailData & { canEdit: boolean; client: { id: string; name: string }; journey: { id: string; templateName: string; startedAt: string; status: string }; stops: (TrailStop & { ownerName: string | null; notes: string | null })[]; events: Ev[]; links: Link[] };

const fmtVal = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v) : v ? String(v) : '—');
export function eventText(e: Ev) {
  const base = MILESTONE_EVENT_LABELS[e.type];
  if (e.type === 'reprogramado') return `${base}: ${fmtVal(e.payload.from)} → ${fmtVal(e.payload.to)}`;
  if (e.type === 'responsavel') return `${base}: ${e.fromName ?? '—'} → ${e.toName ?? '—'}`;
  if (e.type === 'concluido') return `${base}${e.payload.via === 'kickoff' ? ' (registro do kickoff)' : e.payload.via === 'acompanhamento' ? ' (registro de acompanhamento)' : ''}${e.payload.reconstituido ? ' · reconstituído a partir da data de conclusão' : ''}`;
  return base;
}
const STATUS_TONE: Record<string, Tone> = { concluido: 'green', atrasado: 'red', atual: 'blue', proximo: 'neutral' };

export function TrailTab({ journeyId, subtitle }: { journeyId: string; subtitle: string }) {
  const q = useQuery({ queryKey: ['cs-trail', journeyId], queryFn: () => api<Trail>(`/cs/journeys/${journeyId}/trail`) });
  const [sel, setSel] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [sharing, setSharing] = useState(false);
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const cur = d.stops.find((s) => s.id === sel) ?? (d.currentIndex !== null ? d.stops[d.currentIndex] : d.stops.at(-1)) ?? null;
  const evs = d.events.filter((e) => e.milestoneId === cur?.id);
  const next = d.currentIndex !== null ? d.stops[d.currentIndex] : null;
  return (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Trilha da jornada">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{d.finished ? 'Jornada concluída' : next ? <>Próximo passo: <b className="text-ink">{next.title}</b>{next.plannedAt && ` · ${fmtDate(next.plannedAt)}`}</> : null}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1"><span className="num font-display text-3xl font-bold text-ink">{d.pct}%</span><span className="text-sm text-muted">{d.done} de {d.total} marcos{d.late ? <> · <b className="text-danger">{d.late} atrasado(s)</b></> : ''}</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => setPresenting(true)}>Apresentar jornada</Button>
            {d.canEdit && <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => setSharing(true)}>Compartilhar trilha</Button>}
          </div>
        </div>
        <JourneyTrail data={d} selectedId={cur?.id ?? null} onSelect={setSel} />
        <div className="mt-2"><TrailLegend /></div>
      </section>
      {cur && (
        <section className="card grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="Marco selecionado">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-primary">{d.phases.find((p) => p.key === cur.phase)?.label}</p>
            <h3 className="text-lg font-bold text-ink">{cur.title}</h3>
            <p><Chip tone={STATUS_TONE[cur.status] ?? 'neutral'}>{STOP_STATUS_LABELS[cur.status]}</Chip></p>
            <p className="text-sm">{cur.doneAt ? `Concluído em ${fmtDate(cur.doneAt)}` : cur.plannedAt ? `Previsto para ${fmtDate(cur.plannedAt)}` : 'Sem data prevista'}{cur.ownerName ? ` · ${cur.ownerName}` : ''}</p>
            {cur.notes && <p className="whitespace-pre-line text-sm text-text">{cur.notes}</p>}
            <p className="text-xs text-muted">Para concluir, reprogramar ou mudar o responsável, use a aba Linha do tempo.</p>
          </div>
          <div className="min-w-0">
            <h4 className="mb-1 font-bold text-ink">Histórico do marco</h4>
            {!evs.length ? <p className="text-sm text-muted">Nenhuma mudança registrada.</p> : <ol className="space-y-1.5 text-sm">{evs.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · <b>{e.actorName}</b> {eventText(e)}</li>)}</ol>}
          </div>
        </section>
      )}
      {!!d.events.length && (
        <details className="card p-4"><summary className="cursor-pointer font-bold text-ink">Histórico de todos os marcos ({d.events.length})</summary>
          <ol className="mt-2 space-y-1.5 text-sm">{d.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · <b>{e.actorName}</b> {eventText(e)} — <button type="button" className="text-primary hover:underline" onClick={() => setSel(e.milestoneId)}>{d.stops.find((s) => s.id === e.milestoneId)?.title}</button></li>)}</ol>
        </details>
      )}
      {presenting && <JourneyPresenter data={d} client={d.client.name} subtitle={subtitle} onClose={() => setPresenting(false)} />}
      {sharing && <NewLinkDialog journeyId={journeyId} onClose={() => setSharing(false)} />}
    </div>
  );
}

function NewLinkDialog({ journeyId, onClose }: { journeyId: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ label: '', days: 30, requireCode: true, showNotes: false });
  const [made, setMade] = useState<{ url: string; code: string | null; expiresAt: string } | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ url: string; code: string | null; expiresAt: string }>(`/cs/journeys/${journeyId}/links`, { method: 'POST', body: f }),
    onSuccess: (r) => { setMade({ ...r, url: `${window.location.origin}${r.url}` }); void qc.invalidateQueries({ queryKey: ['cs-trail', journeyId] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const copy = (t: string, what: string) => void navigator.clipboard.writeText(t).then(() => toast({ tone: 'success', message: `${what} copiado` }));
  return (
    <Modal open onClose={onClose} title={made ? 'Link criado' : 'Compartilhar trilha'} footer={made ? <Button variant="primary" onClick={onClose}>Concluir</Button> : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.label.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Criar link</Button></>}>
      {made ? (
        <div className="space-y-3">
          <FormField label="Link" htmlFor="nl-url"><div className="flex gap-2"><Input id="nl-url" readOnly value={made.url} /><Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copy(made.url, 'Link')}>Copiar</Button></div></FormField>
          {made.code && (
            <div className="rounded-md border border-warning/50 bg-warning-soft p-3">
              <p className="text-sm font-semibold text-ink">Código de acesso</p>
              <p className="num my-1 font-display text-3xl font-bold tracking-[0.3em] text-ink" aria-label={`Código ${made.code.split('').join(' ')}`}>{made.code}</p>
              <p className="text-xs">Anote ou envie agora, por outro canal: <b>o código não será mostrado de novo</b>. Cinco tentativas erradas bloqueiam o link por 15 minutos.</p>
              <Button size="sm" variant="secondary" className="mt-2" icon={<Copy className="h-4 w-4" />} onClick={() => copy(made.code!, 'Código')}>Copiar código</Button>
            </div>
          )}
          <p className="text-sm text-muted">Vale até {fmtDateTime(made.expiresAt)}. Você pode revogar a qualquer momento na aba Links externos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <FormField label="Para quem é o link" htmlFor="nl-l" required hint="Aparece só para a equipe, para saber quem está acessando"><Input id="nl-l" value={f.label} placeholder="Ex.: Diretoria administrativa do cliente" onChange={(e) => setF({ ...f, label: e.target.value })} /></FormField>
          <FormField label="Válido por" htmlFor="nl-d"><Select id="nl-d" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>{LINK_DURATIONS.map((d) => <option key={d} value={d}>{d} dias</option>)}</Select></FormField>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.requireCode} onChange={(e) => setF({ ...f, requireCode: e.target.checked })} /><span><b className="text-ink">Exigir código de acesso</b><span className="block text-xs text-muted">Código de 6 dígitos gerado agora, para enviar separado do link.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.showNotes} onChange={(e) => setF({ ...f, showNotes: e.target.checked })} /><span><b className="text-ink">Mostrar as observações dos marcos</b><span className="block text-xs text-muted">Desligado por padrão: observações costumam ser internas. Responsáveis internos nunca aparecem.</span></span></label>
          {f.showNotes && <Notice tone="warning">Confira as observações dos marcos antes de enviar: o cliente verá o texto como está.</Notice>}
        </div>
      )}
    </Modal>
  );
}

const STATE_TONE: Record<LinkState, Tone> = { ativo: 'green', expirado: 'neutral', revogado: 'neutral', bloqueado: 'red' };
const LINK_EV: Record<string, string> = { criado: 'criado', acesso: 'acesso', codigo_incorreto: 'código incorreto', bloqueado: 'bloqueado por tentativas', revogado: 'revogado' };
export function LinksTab({ journeyId }: { journeyId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cs-trail', journeyId], refetchOnMount: 'always', refetchInterval: 60_000, queryFn: () => api<Trail>(`/cs/journeys/${journeyId}/trail`) });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Link | null>(null);
  const [reason, setReason] = useState('');
  const rv = useMutation({
    mutationFn: () => api(`/cs/journey-links/${revoking!.id}/revoke`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setRevoking(null); setReason(''); void qc.invalidateQueries({ queryKey: ['cs-trail', journeyId] }); toast({ tone: 'success', message: 'Link revogado: o acesso parou agora' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card overflow-hidden" aria-label="Links externos da trilha">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div><h3 className="font-bold text-ink">Links externos da trilha</h3><p className="text-xs text-muted">Cada link tem destinatário, prazo e, se quiser, código de acesso. Todos os acessos ficam registrados.</p></div>
        {d.canEdit && <Button variant="primary" icon={<Link2 className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo link</Button>}
      </div>
      {!d.links.length ? <div className="border-t border-line"><EmptyState title="Nenhum link criado" description="Crie um link para o cliente acompanhar a trilha da jornada sem precisar de login." /></div> : (
        <ul className="divide-y divide-line border-t border-line">{d.links.map((l) => (
          <li key={l.id} className={clsx('flex flex-wrap items-start gap-3 px-4 py-3', l.state !== 'ativo' && l.state !== 'bloqueado' && 'opacity-70')}>
            <div className="min-w-[220px] flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-2"><b className="text-ink">{l.label}</b><Chip tone={STATE_TONE[l.state]}>{LINK_STATE_LABELS[l.state]}</Chip>{l.requiresCode && <span className="inline-flex items-center gap-1 text-xs text-muted"><KeyRound className="h-3.5 w-3.5" />com código</span>}{l.showNotes && <span className="text-xs text-muted">mostra observações</span>}</p>
              <p className="text-xs text-muted">Criado por {l.createdByName ?? '—'} em {fmtDateTime(l.createdAt)} · {l.state === 'expirado' ? 'expirou' : 'vale até'} {fmtDateTime(l.expiresAt)}</p>
              <p className="text-xs text-muted"><span className="num">{l.accessCount}</span> acesso(s){l.lastAccessAt && ` · último em ${fmtDateTime(l.lastAccessAt)}`}{l.failedAttempts > 0 && ` · ${l.failedAttempts} código(s) errado(s) seguidos`}</p>
              {l.revokedAt && <p className="text-xs">Revogado em {fmtDateTime(l.revokedAt)}: {l.revokeReason}</p>}
              {!!l.events.length && <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-primary">Registro de uso</summary><ol className="mt-1 space-y-0.5 text-xs">{l.events.map((e, i) => <li key={i}><span className="num text-muted">{fmtDateTime(e.createdAt)}</span> · {LINK_EV[e.type] ?? e.type}</li>)}</ol></details>}
            </div>
            {d.canEdit && (l.state === 'ativo' || l.state === 'bloqueado') && <Button size="sm" variant="secondary" onClick={() => setRevoking(l)}>Revogar</Button>}
          </li>
        ))}</ul>
      )}
      {creating && <NewLinkDialog journeyId={journeyId} onClose={() => setCreating(false)} />}
      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revogar link" footer={<><Button variant="secondary" onClick={() => setRevoking(null)}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={rv.isPending} onClick={() => rv.mutate()}>Revogar link</Button></>}>
        <p className="mb-3 text-sm">O link “{revoking?.label}” para de funcionar na hora.</p>
        <FormField label="Motivo" htmlFor="rv-r" required><Textarea id="rv-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------- página pública (sem login)
type PublicTrail = TrailData & { client: string; templateName: string; startedAt: string; csmName: string | null; generatedAt: string };
type PublicResp = { needsCode: true; attemptsLeft: number } | { needsCode: false; trail: PublicTrail; expiresAt: string };
export function PublicJourneyPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-journey', token], retry: false, queryFn: () => api<PublicResp>(`/public/journey/${token}`) });
  const [code, setCode] = useState('');
  const [unlocked, setUnlocked] = useState<Extract<PublicResp, { needsCode: false }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const unlock = useMutation({
    mutationFn: () => api<Extract<PublicResp, { needsCode: false }>>(`/public/journey/${token}/unlock`, { method: 'POST', body: { code } }),
    onSuccess: (r) => { setErr(null); setUnlocked(r); },
    onError: (e) => setErr(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Não foi possível validar o código.'),
  });
  const shell = (body: React.ReactNode) => <div className="min-h-screen bg-bg"><header className="bg-navy px-4 py-4 sm:px-8"><p className="font-display text-lg font-bold text-white">BKT</p></header><main className="mx-auto max-w-6xl p-4 sm:p-8">{body}</main></div>;
  if (q.isLoading) return shell(<LoadingRows rows={4} />);
  if (q.isError) return shell(<div className="mx-auto max-w-md"><ErrorState error={q.error} /></div>);
  const r = unlocked ?? (q.data!.needsCode ? null : q.data!);
  if (!r) {
    return shell(
      <form className="card mx-auto max-w-sm space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); unlock.mutate(); }}>
        <h1 className="text-xl font-bold text-ink">Acompanhe a sua jornada</h1>
        <p className="text-sm text-muted">Digite o código de 6 dígitos enviado pelo seu gerente de sucesso.</p>
        <FormField label="Código de acesso" htmlFor="pj-c"><Input id="pj-c" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num text-center text-2xl tracking-[0.4em]" /></FormField>
        {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={code.length !== 6} loading={unlock.isPending}>Ver a trilha</Button>
      </form>,
    );
  }
  const t = r.trail;
  const cur = t.stops.find((s) => s.id === sel) ?? null;
  return shell(
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><h1 className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">{t.client}</h1><p className="text-sm text-muted">{t.templateName} · início {fmtDate(t.startedAt)}{t.csmName && ` · gerente de sucesso: ${t.csmName}`}</p></div>
        <Button variant="primary" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => setPresenting(true)}>Apresentar</Button>
      </div>
      <section className="card p-5" aria-label="Trilha da jornada">
        <p className="mb-2 flex flex-wrap items-baseline gap-x-4"><span className="num font-display text-3xl font-bold text-ink">{t.pct}%</span><span className="text-sm text-muted">{t.done} de {t.total} marcos concluídos</span></p>
        <JourneyTrail data={t} selectedId={sel} onSelect={setSel} />
        <div className="mt-2"><TrailLegend /></div>
        {cur && <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm" aria-live="polite"><b className="text-ink">{cur.title}</b> · {STOP_STATUS_LABELS[cur.status]}{cur.doneAt ? ` em ${fmtDate(cur.doneAt)}` : cur.plannedAt ? ` · previsto para ${fmtDate(cur.plannedAt)}` : ''}{cur.notes && <span className="mt-1 block whitespace-pre-line">{cur.notes}</span>}</div>}
      </section>
      <p className="text-xs text-muted">Atualizado em {fmtDateTime(t.generatedAt)} · link válido até {fmtDateTime(r.expiresAt)}</p>
      {presenting && <JourneyPresenter data={t} client={t.client} subtitle={t.templateName} allowNotes={false} onClose={() => setPresenting(false)} />}
    </div>,
  );
}
