/** Topo: o sino (todas as notificações, sem depender de módulo) e as menções (@). Os dois abrem um painel no lugar, sem trocar de tela. */
import { plainText } from './RichText';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AtSign, Bell } from 'lucide-react';
import { api } from '../lib/api';
import { fmtRelative } from '../lib/format';

type Source = 'chat' | 'comentario' | 'tarefa_comentario' | 'tarefa_atribuida' | 'tarefa_aprovacao' | 'tarefa_devolvida' | `intervencao_${string}` | `playbook_${string}` | `academia_${string}`;
type Mention = { kind: 'oportunidade' | 'tarefa' | 'intervencao' | 'gestao' | 'aviso'; opportunityId: string | null; taskId: string | null; code: number | null; contactName: string | null; title: string | null; source: Source; body: string; author: string | null; at: string; unread: boolean };
const TASK_TEXT: Record<string, string> = {
  impedimento_registrado: 'pediu para você remover um impedimento', impedimento_escalado: 'escalou um impedimento', impedimento_reatribuido: 'passou um impedimento para você', impedimento_removido: 'removeu o impedimento', impedimento_aceito: 'aceitou o impedimento', impedimento_em_tratamento: 'começou a tratar o impedimento', impedimento_aberto: 'reabriu o impedimento',
  apoio_pedido: 'pediu seu apoio', apoio_assumido: 'assumiu seu pedido de apoio', apoio_atendido: 'atendeu seu pedido de apoio: confirme', apoio_confirmado: 'confirmou o seu apoio: pontos lançados', apoio_reaberto: 'disse que ainda falta algo no apoio', apoio_devolvido: 'devolveu o pedido de apoio', apoio_cancelado: 'cancelou o pedido de apoio',
  ferias_alerta: 'Férias chegando: revise rotinas e tarefas do período', ferias_programada: 'programou férias para você', ferias_sugerida: 'sugeriu férias para você', ferias_alterada: 'alterou suas férias', ferias_cancelada: 'cancelou férias suas',
  reuniao_ata_encerrada: 'encerrou a ata da reunião', reuniao_cancelada: 'cancelou a reunião', ritual_criado: 'incluiu você num ritual de gestão', decisao_revogada: 'revogou uma decisão sua',
  intervencao_aberta: 'Nova intervenção para você', intervencao_promovida: 'Intervenção virou plano de ação obrigatório', intervencao_reincidencia: 'Meta fora da faixa de novo (reincidência)', intervencao_escalada: 'Intervenção com prazo vencido foi escalonada',
  intervencao_revisada: 'registrou a revisão da intervenção', intervencao_plano_registrado: 'registrou o plano de ação', intervencao_plano_atualizado: 'atualizou o plano de ação', intervencao_concluida: 'concluiu a intervenção', intervencao_dispensada: 'dispensou a intervenção', intervencao_dispensada_retificacao: 'Intervenção dispensada após retificação', intervencao_analise_concluida: 'concluiu a análise de causa da intervenção', intervencao_analise_reaberta: 'reabriu a análise de causa', tarefa_comentario: 'mencionou você na tarefa', tarefa_atribuida: 'pediu uma tarefa para você', tarefa_aprovacao: 'enviou uma entrega para você aprovar', tarefa_devolvida: 'devolveu sua entrega',
  playbook_enviado: 'enviou um playbook para aprovação', playbook_aprovado_gerencia: 'aprovou o playbook na Gerência: falta a Diretoria', playbook_homologado: 'aprovou o playbook', playbook_devolvido: 'devolveu o playbook para ajustes', playbook_rejeitado: 'rejeitou o playbook',
  playbook_revisao: 'Playbook com revisão chegando ou vencida', playbook_ciencia: 'pede a sua ciência num playbook', playbook_sugestao: 'mandou uma sugestão de playbook', playbook_reporte_desatualizado: 'avisou que um playbook está desatualizado', playbook_sugestao_respondida: 'respondeu sua sugestão de playbook', playbook_suspenso: 'suspendeu um playbook', playbook_reativado: 'reativou um playbook',
  academia_enviada: 'enviou uma trilha para aprovação', academia_publicada: 'aprovou e publicou a trilha', academia_ajustes: 'pediu ajustes na trilha', academia_rejeitada: 'rejeitou a trilha', academia_atribuida: 'atribuiu uma trilha a você', academia_obrigatoria: 'publicou uma trilha obrigatória para você' };

/** Para onde a notificação leva: a tela do que foi notificado. Aviso sem tela própria não navega (é marcado como lido no painel). */
export function mentionLink(m: Mention): string | null {
  if (m.kind === 'aviso') return m.contactName || null;
  if (m.kind === 'gestao') {
    if (m.contactName === 'apoio') return `/apoio#apoio-${m.taskId}`;
    if (m.contactName === 'playbook') return m.source === 'playbook_enviado' || m.source === 'playbook_aprovado_gerencia' ? '/playbooks?aba=aprovacoes' : m.source === 'playbook_sugestao' || m.source === 'playbook_reporte_desatualizado' || m.source === 'playbook_revisao' ? '/playbooks?aba=gestao' : `/playbooks/${m.taskId}`;
    if (m.contactName === 'academia') return m.source === 'academia_enviada' ? '/playbooks?aba=academia' : m.source === 'academia_atribuida' || m.source === 'academia_obrigatoria' ? `/playbooks/academia/trilhas/${m.taskId}` : `/playbooks/academia/gestao/${m.taskId}`;
    if (m.contactName === 'ferias') return '/times/ferias';
    if (m.contactName === 'reuniao') return `/times/rituais/reunioes/${m.taskId}`;
    if (m.contactName === 'ritual') return '/times/rituais';
    return `/times/decisoes?tab=${m.contactName === 'impedimento' ? 'impedimentos' : 'decisoes'}&id=${m.taskId}`;
  }
  if (m.kind === 'intervencao') return `/times/intervencoes?id=${m.taskId}`;
  if (m.kind === 'tarefa') return `/tarefas?task=${m.taskId}`;
  return `/opportunities/${m.opportunityId}?aba=${m.source === 'chat' ? 'chat' : 'historico'}`;
}

function ItemBody({ m }: { m: Mention }) {
  return (
    <>
      <p className="flex items-center gap-2 text-xs text-muted">
        {m.unread && <span className="h-2 w-2 shrink-0 rounded-circle bg-[#F5B400]" aria-label="não lida" />}
        {m.kind === 'aviso'
          ? <span><span className="font-semibold text-ink">Pessoas & Gestão</span> · {fmtRelative(m.at)}</span>
          : m.kind === 'gestao'
          ? <span>{m.author && <span className="font-semibold text-ink">{m.author} </span>}{TASK_TEXT[m.source] ?? 'Atualização de gestão'} · {fmtRelative(m.at)}</span>
          : m.kind === 'intervencao'
          ? <span>{m.author && <span className="font-semibold text-ink">{m.author} </span>}{TASK_TEXT[m.source] ?? 'Atualização de intervenção'} · {fmtRelative(m.at)}</span>
          : m.kind === 'tarefa'
          ? <span><span className="font-semibold text-ink">{m.author ?? 'Alguém'}</span> {TASK_TEXT[m.source]} · {fmtRelative(m.at)}</span>
          : <span><span className="font-semibold text-ink">{m.author ?? 'Alguém'}</span> no {m.source === 'chat' ? 'chat' : 'comentário'} · OP-{m.code} · {fmtRelative(m.at)}</span>}
      </p>
      {m.kind === 'aviso' ? <p className="text-sm font-semibold text-ink">{m.title}</p> : <p className="text-xs text-muted">{m.kind === 'oportunidade' ? m.contactName : m.title}</p>}
      {m.body && <p className="mt-0.5 line-clamp-2 text-sm text-text">{plainText(m.body)}</p>}
    </>
  );
}

type Scope = 'sino' | 'mencoes';
const useFeed = (scope: Scope) => useQuery({ queryKey: ['mentions', scope], queryFn: () => api<{ items: Mention[]; unread: number }>(`/me/mentions?scope=${scope}`), refetchInterval: 60_000 });
/** "Limpar": o que está no painel agora some (o que chegar depois aparece). */
function useClear(scope: Scope, refetch: () => unknown) {
  return useMutation({ mutationFn: () => api(`/me/notificacoes/limpar`, { method: 'POST', body: { scope } }), onSuccess: () => refetch() });
}
function PanelHeader({ title, count, clear }: { title: string; count: number; clear: ReturnType<typeof useClear> }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-2">
      <p className="text-sm font-bold text-ink">{title}</p>
      {count > 0 && <button type="button" className="text-sm font-semibold text-primary hover:underline disabled:opacity-50" disabled={clear.isPending} onClick={() => clear.mutate()}>Limpar</button>}
    </div>
  );
}
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  return { open, setOpen, ref };
}

function FeedList({ items, onPick, empty }: { items: Mention[]; onPick: (m: Mention) => void; empty: string }) {
  if (!items.length) return <p className="px-4 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
      {items.map((m, i) => {
        const to = mentionLink(m);
        const cls = clsx('block w-full px-4 py-2.5 text-left hover:bg-surface-2', m.unread && 'bg-[#FFF9E6]');
        return <li key={i}>{to ? <Link to={to} onClick={() => onPick(m)} className={cls}><ItemBody m={m} /></Link> : <button type="button" onClick={() => onPick(m)} className={cls}><ItemBody m={m} /></button>}</li>;
      })}
    </ul>
  );
}

export function MentionsMenu() {
  const q = useFeed('mencoes');
  const clear = useClear('mencoes', q.refetch);
  const { open, setOpen, ref } = usePopover();
  const n = q.data?.unread ?? 0;
  const pick = (m: Mention) => { setOpen(false); if (m.kind === 'aviso' && m.unread) void api(`/me/notificacoes/${m.taskId}/lida`, { method: 'POST' }).then(() => q.refetch()); };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={n ? (n === 1 ? '1 menção não lida' : `${n} menções não lidas`) : 'Menções'} className="relative flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2">
        <AtSign className="h-6 w-6" strokeWidth={1.8} />
        {n > 0 && <span className="num absolute -right-0.5 top-0.5 min-w-[20px] rounded-full border-2 border-surface bg-[#F5B400] px-1 text-center text-2xs font-bold leading-4 text-navy">{n > 9 ? '9+' : n}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Menções" className="absolute right-0 top-full z-40 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-overlay">
          <PanelHeader title="Menções" count={q.data?.items.length ?? 0} clear={clear} />
          <FeedList items={q.data?.items ?? []} onPick={pick} empty="Nada por aqui. Menções (@) em negociações, tarefas e Pessoas & Gestão, tarefas pedidas a você, entregas para aprovar e intervenções da Gestão de Times aparecem aqui." />
        </div>
      )}
    </div>
  );
}

/**
 * Sino: todas as notificações num painel no lugar (sem trocar de tela e sem depender de módulo liberado): trilhas
 * atribuídas, aprovações, tarefas, menções e avisos. Cada uma leva à tela do que foi notificado. As atividades do dia
 * aparecem como uma linha a mais, só para quem tem o módulo de Atividades.
 */
export function NotificationsMenu({ activities }: { activities: { due: number } | null }) {
  const q = useFeed('sino');
  const clear = useClear('sino', q.refetch);
  const { open, setOpen, ref } = usePopover();
  const n = q.data?.unread ?? 0;
  const due = activities?.due ?? 0;
  const pick = (m: Mention) => { setOpen(false); if (m.kind === 'aviso' && m.unread) void api(`/me/notificacoes/${m.taskId}/lida`, { method: 'POST' }).then(() => q.refetch()); };
  const label = n ? (n === 1 ? 'Notificações: 1 não lida' : `Notificações: ${n} não lidas`) : due ? `Notificações: ${due} atividades para hoje ou vencidas` : 'Notificações';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={label} className="relative flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2">
        <Bell className="h-7 w-7" strokeWidth={1.6} />
        {n > 0 ? <span className="num absolute -right-0.5 top-0.5 min-w-[20px] rounded-full border-2 border-surface bg-danger px-1 text-center text-2xs font-bold leading-4 text-white">{n > 9 ? '9+' : n}</span>
          : due > 0 && <span className="absolute right-2 top-1.5 h-3.5 w-3.5 rounded-circle border-2 border-surface bg-danger" aria-hidden />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notificações" className="absolute right-0 top-full z-40 mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-overlay">
          <PanelHeader title="Notificações" count={q.data?.items.length ?? 0} clear={clear} />
          {activities && due > 0 && <Link to="/activities" onClick={() => setOpen(false)} className="block border-b border-line bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-primary-soft">{due === 1 ? '1 atividade para hoje ou vencida' : `${due} atividades para hoje ou vencidas`}</Link>}
          <FeedList items={q.data?.items ?? []} onPick={pick} empty="Nada novo. Trilhas atribuídas a você, aprovações, tarefas, menções e avisos aparecem aqui." />
        </div>
      )}
    </div>
  );
}
