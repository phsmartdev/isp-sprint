/** Indicador de menções no topo: onde me chamaram com @ (chat e comentários das negociações). */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AtSign } from 'lucide-react';
import { api } from '../lib/api';
import { fmtRelative } from '../lib/format';

type Source = 'chat' | 'comentario' | 'tarefa_comentario' | 'tarefa_atribuida' | 'tarefa_aprovacao' | 'tarefa_devolvida' | `intervencao_${string}`;
type Mention = { kind: 'oportunidade' | 'tarefa' | 'intervencao' | 'gestao'; opportunityId: string | null; taskId: string | null; code: number | null; contactName: string | null; title: string | null; source: Source; body: string; author: string | null; at: string; unread: boolean };
const TASK_TEXT: Record<string, string> = {
  impedimento_registrado: 'pediu para você remover um impedimento', impedimento_escalado: 'escalou um impedimento', impedimento_reatribuido: 'passou um impedimento para você', impedimento_removido: 'removeu o impedimento', impedimento_aceito: 'aceitou o impedimento', impedimento_em_tratamento: 'começou a tratar o impedimento', impedimento_aberto: 'reabriu o impedimento',
  reuniao_ata_encerrada: 'encerrou a ata da reunião', reuniao_cancelada: 'cancelou a reunião', ritual_criado: 'incluiu você num ritual de gestão', decisao_revogada: 'revogou uma decisão sua',
  intervencao_aberta: 'Nova intervenção para você', intervencao_promovida: 'Intervenção virou plano de ação obrigatório', intervencao_reincidencia: 'Meta fora da faixa de novo (reincidência)', intervencao_escalada: 'Intervenção com prazo vencido foi escalonada',
  intervencao_revisada: 'registrou a revisão da intervenção', intervencao_plano_registrado: 'registrou o plano de ação', intervencao_plano_atualizado: 'atualizou o plano de ação', intervencao_concluida: 'concluiu a intervenção', intervencao_dispensada: 'dispensou a intervenção', intervencao_dispensada_retificacao: 'Intervenção dispensada após retificação', intervencao_analise_concluida: 'concluiu a análise de causa da intervenção', intervencao_analise_reaberta: 'reabriu a análise de causa', tarefa_comentario: 'mencionou você na tarefa', tarefa_atribuida: 'pediu uma tarefa para você', tarefa_aprovacao: 'enviou uma entrega para você aprovar', tarefa_devolvida: 'devolveu sua entrega' };

export function MentionsMenu() {
  const q = useQuery({ queryKey: ['mentions'], queryFn: () => api<{ items: Mention[]; unread: number }>('/me/mentions'), refetchInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const n = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={n ? (n === 1 ? '1 menção não lida' : `${n} menções não lidas`) : 'Menções'} className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-surface-2">
        <AtSign className="h-6 w-6" strokeWidth={1.8} />
        {n > 0 && <span className="num absolute -right-0.5 top-0.5 min-w-[20px] rounded-full border-2 border-surface bg-[#F5B400] px-1 text-center text-2xs font-bold leading-4 text-navy">{n > 9 ? '9+' : n}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Menções" className="absolute right-0 top-full z-40 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-overlay">
          <p className="border-b border-line px-4 py-2.5 text-sm font-bold text-ink">Menções</p>
          {!q.data?.items.length ? <p className="px-4 py-6 text-sm text-muted">Nada por aqui. Menções (@) em negociações e tarefas, tarefas pedidas a você, entregas para aprovar e intervenções da Gestão de Times aparecem aqui.</p> : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {q.data.items.map((m, i) => (
                <li key={i}>
                  <Link to={m.kind === 'gestao' ? (m.contactName === 'reuniao' ? `/times/rituais/reunioes/${m.taskId}` : m.contactName === 'ritual' ? '/times/rituais' : `/times/decisoes?tab=${m.contactName === 'impedimento' ? 'impedimentos' : 'decisoes'}&id=${m.taskId}`) : m.kind === 'intervencao' ? `/times/intervencoes?id=${m.taskId}` : m.kind === 'tarefa' ? `/tarefas?task=${m.taskId}` : `/opportunities/${m.opportunityId}?aba=${m.source === 'chat' ? 'chat' : 'historico'}`} onClick={() => setOpen(false)} className={clsx('block px-4 py-2.5 hover:bg-surface-2', m.unread && 'bg-[#FFF9E6]')}>
                    <p className="flex items-center gap-2 text-xs text-muted">
                      {m.unread && <span className="h-2 w-2 rounded-full bg-[#F5B400]" aria-label="não lida" />}
                      {m.kind === 'gestao'
                        ? <span>{m.author && <span className="font-semibold text-ink">{m.author} </span>}{TASK_TEXT[m.source] ?? 'Atualização de gestão'} · {fmtRelative(m.at)}</span>
                        : m.kind === 'intervencao'
                        ? <span>{m.author && <span className="font-semibold text-ink">{m.author} </span>}{TASK_TEXT[m.source] ?? 'Atualização de intervenção'} · {fmtRelative(m.at)}</span>
                        : m.kind === 'tarefa'
                        ? <span><span className="font-semibold text-ink">{m.author ?? 'Alguém'}</span> {TASK_TEXT[m.source]} · {fmtRelative(m.at)}</span>
                        : <span><span className="font-semibold text-ink">{m.author ?? 'Alguém'}</span> no {m.source === 'chat' ? 'chat' : 'comentário'} · OP-{m.code} · {fmtRelative(m.at)}</span>}
                    </p>
                    <p className="text-xs text-muted">{m.kind === 'oportunidade' ? m.contactName : m.title}</p>
                    {m.body && <p className="mt-0.5 line-clamp-2 text-sm text-text">{m.body}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
