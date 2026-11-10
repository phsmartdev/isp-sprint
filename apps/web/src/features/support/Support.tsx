/**
 * Pedido de Apoio: botão no topo de todas as telas para pedir ajuda ao time ou a um colega (já ligado ao item aberto),
 * e a tela "Pedidos de apoio" para assumir, atender e confirmar. Pontos só depois da confirmação de quem pediu.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { HandHelping } from 'lucide-react';
import { SUPPORT_STATUS_LABELS, type SupportSettings, type SupportStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtRelative } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export type SupportItem = {
  id: string; title: string; description: string | null; dueOn: string | null; status: SupportStatus;
  requester: { id: string; name: string | null }; helper: { id: string; name: string | null } | null;
  target: { kind: 'time' | 'pessoa'; id: string; name: string | null }; entity: { type: string; id: string | null; label: string | null } | null;
  taskPoints: number | null; doneNote: string | null; createdAt: string; canTake: boolean;
  actions: ('assumir' | 'atendido' | 'desistir' | 'confirmar' | 'reabrir' | 'cancelar')[];
};
export type SupportData = { toMe: SupportItem[]; taken: SupportItem[]; mine: SupportItem[]; helped: SupportItem[]; rule: SupportSettings | null; waiting: number };

export const useSupport = () => useQuery({ queryKey: ['apoio'], queryFn: () => api<SupportData>('/apoio'), refetchInterval: 60_000, staleTime: 30_000 });

type EntityType = 'oportunidade' | 'contrato' | 'conta' | 'tarefa' | 'projeto';
const ENTITY_LABEL: Record<EntityType, string> = { oportunidade: 'Oportunidade', contrato: 'Contrato', conta: 'Conta', tarefa: 'Tarefa', projeto: 'Projeto' };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** O item aberto na tela (para o pedido já ir ligado a ele). */
function entityFromUrl(path: string, search: string): { type: EntityType; id: string } | null {
  const m = (re: string) => new RegExp(re).exec(path)?.[1] ?? null;
  const q = new URLSearchParams(search);
  const opp = m(`^/opportunities/(${UUID})`); if (opp) return { type: 'oportunidade', id: opp };
  const ct = m(`^/contracts/(${UUID})`); if (ct) return { type: 'contrato', id: ct };
  const cu = m(`^/customers/(${UUID})`); if (cu) return { type: 'conta', id: cu };
  const pj = m(`^/projetos/(${UUID})`); if (pj) return { type: 'projeto', id: pj };
  const tk = q.get('task') ?? q.get('tarefa'); if (tk && new RegExp(`^${UUID}$`).test(tk)) return { type: 'tarefa', id: tk };
  return null;
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
export const ruleText = (r: SupportSettings) => `quem apoiar ganha ${pts(r.helperMultiplierBp / 10_000)}x os pontos da tarefa (ou ${pts((r.basePoints * r.helperMultiplierBp) / 10_000)} pts quando não há tarefa com pontos) e você ganha ${pts(r.requesterPoints)} pt${r.requesterPoints === 1 ? '' : 's'}, depois que você confirmar o apoio`;

export function SupportRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loc = useLocation();
  const lookups = useLookups().data;
  const me = useAuth().me;
  const user = me ? { id: me.user.id, teamIds: me.teamIds } : null;
  const sup = useSupport();
  const toast = useToast();
  const qc = useQueryClient();
  const detected = entityFromUrl(loc.pathname, loc.search);
  const blank = { title: '', description: '', to: 'time' as 'time' | 'pessoa', teamId: '', userId: '', dueOn: '', link: true };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF({ ...blank, teamId: user?.teamIds?.[0] ?? '' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api('/apoio', { method: 'POST', body: { title: f.title, description: f.description || null, dueOn: f.dueOn || null, teamId: f.to === 'time' ? f.teamId : null, targetUserId: f.to === 'pessoa' ? f.userId : null, entityType: f.link && detected ? detected.type : null, entityId: f.link && detected ? detected.id : null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['apoio'] }); toast({ tone: 'success', message: f.to === 'time' ? 'Pedido enviado ao time' : 'Pedido enviado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ok = f.title.trim().length >= 3 && (f.to === 'time' ? !!f.teamId : !!f.userId);
  const myTeams = new Set(user?.teamIds ?? []);
  const teams = [...(lookups?.teams ?? [])].sort((a, b) => Number(myTeams.has(b.id)) - Number(myTeams.has(a.id)) || a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <Modal open={open} onClose={onClose} title="Pedir apoio" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>Pedir apoio</Button></>}>
      <div className="space-y-3">
        <FormField label="Do que você precisa?" htmlFor="ap-t" required><Input id="ap-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: revisar a proposta antes de enviar" /></FormField>
        <FormField label="Detalhes" htmlFor="ap-d"><Textarea id="ap-d" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Para quem</legend>
          <div className="mb-2 inline-flex border border-line" role="radiogroup" aria-label="Para quem">
            {(['time', 'pessoa'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={f.to === k} onClick={() => setF({ ...f, to: k })} className={clsx('px-4 py-1.5 text-sm font-semibold', f.to === k ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{k === 'time' ? 'Um time' : 'Uma pessoa'}</button>)}
          </div>
          {f.to === 'time'
            ? <Select aria-label="Time" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">Escolha o time</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}{myTeams.has(t.id) ? ' (meu time)' : ''}</option>)}</Select>
            : <Select aria-label="Pessoa" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Escolha a pessoa</option>{(lookups?.users ?? []).filter((u) => u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
        </fieldset>
        <FormField label="Até quando" htmlFor="ap-due"><Input id="ap-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
        {detected && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.link} onChange={(e) => setF({ ...f, link: e.target.checked })} />Ligar a {ENTITY_LABEL[detected.type].toLowerCase()} aberta nesta tela</label>}
        {sup.data?.rule ? <p className="border-l-4 border-primary bg-surface-2 px-3 py-2 text-sm text-ink">Pontos: {ruleText(sup.data.rule)}.</p>
          : <p className="text-sm text-muted">Os pontos de apoio passam a valer quando a regra da gamificação com o Pedido de Apoio for aprovada.</p>}
      </div>
    </Modal>
  );
}

/** Topo de todas as telas: pedir apoio e ver pedidos (com a contagem do que espera por você). */
export function HeaderSupport() {
  const q = useSupport();
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const n = (q.data?.toMe.length ?? 0) + (q.data?.waiting ?? 0);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={n ? `Apoio: ${n} esperando por você` : 'Apoio'} title="Pedido de apoio"
        className="relative flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <HandHelping className="h-6 w-6" strokeWidth={1.6} aria-hidden />
        {n > 0 && <span className="num absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-circle bg-[#F5B400] px-1 text-[11px] font-bold text-navy">{n}</span>}
      </button>
      {menu && (
        <div className="absolute right-0 top-12 z-40 w-72 border border-line bg-surface shadow-lg" role="menu">
          <button role="menuitem" className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-surface-2" onClick={() => { setMenu(false); setAsking(true); }}><HandHelping className="h-4 w-4 text-primary" aria-hidden />Pedir apoio</button>
          <Link role="menuitem" to="/apoio" onClick={() => setMenu(false)} className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink hover:bg-surface-2">
            <span>Pedidos de apoio</span>
            {n > 0 && <span className="num text-xs font-semibold text-primary">{q.data!.toMe.length ? `${q.data!.toMe.length} para você` : ''}{q.data!.toMe.length && q.data!.waiting ? ' · ' : ''}{q.data!.waiting ? `${q.data!.waiting} para confirmar` : ''}</span>}
          </Link>
        </div>
      )}
      <SupportRequestModal open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}

const ACTION_LABEL: Record<SupportItem['actions'][number], string> = { assumir: 'Assumir', atendido: 'Marcar como atendido', desistir: 'Devolver', confirmar: 'Confirmar apoio', reabrir: 'Ainda falta', cancelar: 'Cancelar pedido' };
const NEEDS_NOTE = new Set(['atendido', 'reabrir', 'cancelar']);

export function SupportCard({ r, highlight }: { r: SupportItem; highlight?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [ask, setAsk] = useState<SupportItem['actions'][number] | null>(null);
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: (x: { a: string; note?: string }) => api(`/apoio/${r.id}/${x.a}`, { method: 'POST', body: { note: x.note || null } }),
    onSuccess: (_d, x) => { void qc.invalidateQueries({ queryKey: ['apoio'] }); void qc.invalidateQueries({ queryKey: ['meus-pontos'] }); setAsk(null); setNote(''); toast({ tone: 'success', message: x.a === 'confirmar' ? 'Apoio confirmado: pontos lançados' : x.a === 'assumir' ? 'Pedido assumido' : 'Pedido atualizado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const entityHref = r.entity?.id ? ({ oportunidade: `/opportunities/${r.entity.id}`, contrato: `/contracts/${r.entity.id}`, conta: `/customers/${r.entity.id}`, projeto: `/projetos/${r.entity.id}`, tarefa: `/tarefas?task=${r.entity.id}` } as Record<string, string>)[r.entity.type] : null;
  return (
    <article id={`apoio-${r.id}`} aria-label={`Pedido de apoio ${r.title}`} className={clsx('border bg-surface p-4', highlight ? 'border-primary' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{r.title}</h3>
          <p className="text-sm text-muted">{r.requester.name} pediu {r.target.kind === 'time' ? `ao time ${r.target.name}` : `a ${r.target.name}`} · {fmtRelative(r.createdAt)}{r.dueOn && <> · até {fmtDate(r.dueOn)}</>}</p>
        </div>
        <span className={clsx('border-l-4 px-2 py-0.5 text-xs font-semibold', r.status === 'confirmado' ? 'border-[#15803D] bg-[#ECFDF3] text-[#166534]' : r.status === 'cancelado' ? 'border-line bg-surface-2 text-muted' : r.status === 'atendido' ? 'border-[#B45309] bg-[#FFF7E6] text-[#92400E]' : 'border-primary bg-surface-2 text-primary')}>{SUPPORT_STATUS_LABELS[r.status]}</span>
      </div>
      {r.description && <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.description}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {r.entity?.label && (entityHref ? <Link to={entityHref} className="font-semibold text-primary hover:underline">{r.entity.label}</Link> : <span>{r.entity.label}</span>)}
        {r.taskPoints != null && <span>tarefa de {pts(r.taskPoints)} pts</span>}
        {r.helper && <span>Quem apoia: <b className="text-ink">{r.helper.name}</b></span>}
      </div>
      {r.doneNote && <p className="mt-2 border-l-2 border-line pl-2 text-sm text-ink">{r.doneNote}</p>}
      {!!r.actions.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.actions.map((a) => <Button key={a} size="sm" variant={a === 'assumir' || a === 'confirmar' || a === 'atendido' ? 'primary' : 'secondary'} loading={act.isPending && act.variables?.a === a} onClick={() => (NEEDS_NOTE.has(a) ? setAsk(a) : act.mutate({ a }))}>{ACTION_LABEL[a]}</Button>)}
        </div>
      )}
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask ? ACTION_LABEL[ask] : ''} footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Voltar</Button><Button variant="primary" disabled={ask !== 'atendido' && note.trim().length < 5} loading={act.isPending} onClick={() => ask && act.mutate({ a: ask, note })}>{ask ? ACTION_LABEL[ask] : ''}</Button></>}>
        <FormField label={ask === 'atendido' ? 'O que foi feito (opcional)' : ask === 'reabrir' ? 'O que ainda falta' : 'Por que cancelar'} htmlFor="ap-note"><Textarea id="ap-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </Modal>
    </article>
  );
}


/** Tela "Pedidos de apoio": o que espera por você, o que você assumiu, o que pediu e o que já apoiou. */
export function SupportPage() {
  const q = useSupport();
  const [asking, setAsking] = useState(false);
  const loc = useLocation();
  const hi = loc.hash.replace('#apoio-', '');
  const d = q.data;
  const sec = (title: string, items: SupportItem[], empty: string) => (
    <section aria-label={title} className="space-y-2">
      <h2 className="font-display text-lg font-bold text-ink">{title} <span className="num text-sm font-normal text-muted">{items.length || ''}</span></h2>
      {!items.length ? <p className="border border-dashed border-line px-4 py-3 text-sm text-muted">{empty}</p> : items.map((r) => <SupportCard key={r.id} r={r} highlight={r.id === hi} />)}
    </section>
  );
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-navy text-lime" aria-hidden><HandHelping className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.65rem] font-bold leading-tight text-ink">Pedidos de apoio</h1>
          <p className="text-sm text-muted">Peça ajuda ao time ou a um colega. Quem apoia ganha pontos{d?.rule ? ` (${pts(d.rule.helperMultiplierBp / 10_000)}x os da tarefa)` : ''} quando quem pediu confirma.</p>
        </div>
        <Button variant="primary" icon={<HandHelping className="h-4 w-4" />} onClick={() => setAsking(true)}>Pedir apoio</Button>
      </header>
      {d?.rule ? <p className="mb-5 border-l-4 border-primary bg-surface px-4 py-2 text-sm text-ink">Regra vigente: {ruleText(d.rule)}.</p>
        : <p className="mb-5 border-l-4 border-warning bg-warning-soft/50 px-4 py-2 text-sm text-ink">Os pontos de apoio passam a valer quando a regra da gamificação com o Pedido de Apoio for aprovada (Gestão de Times → Pessoas → Pontuação e regras).</p>}
      {q.isLoading || !d ? <p className="text-sm text-muted">Carregando…</p> : (
        <div className="grid gap-6 lg:grid-cols-2">
          {sec('Esperando por você', d.toMe, 'Nenhum pedido para você ou para o seu time agora.')}
          {sec('Você está apoiando', d.taken, 'Você não assumiu nenhum pedido.')}
          {sec('Você pediu', d.mine, 'Você não pediu apoio recentemente.')}
          {sec('Você já apoiou', d.helped, 'Os apoios confirmados aparecem aqui.')}
        </div>
      )}
      <SupportRequestModal open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}
