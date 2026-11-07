/** Central de Playbooks — tipos e peças compartilhadas entre biblioteca, leitura, editor e gestão. */
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BookOpen, Briefcase, Building2, FileText, Headset, Megaphone, Network, Shield, Star, Users, Wallet } from 'lucide-react';
import { REVIEW_STATE_LABELS, type ReviewState } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';

export type Card = {
  id: string; code: string; title: string; description: string | null; status: string;
  category: { id: string; name: string; icon: string } | null; team: string | null; costCenter: string | null; maintainer: string | null;
  version: string | null; openVersion: { number: string; status: string } | null; type: string | null; updatedOn: string | null; recent: boolean; unreadUpdate: boolean;
  favorite: boolean; lastReadAt: string | null; review: ReviewState; nextReviewOn: string | null;
};
export type Category = { id: string; name: string; icon: string; description: string | null; prefix: string; approval: { gerencia: boolean; diretoria: boolean }; count: number; active?: boolean };

export const CAT_ICON: Record<string, typeof BookOpen> = { briefcase: Briefcase, megaphone: Megaphone, headset: Headset, network: Network, wallet: Wallet, building: Building2, users: Users, file: FileText, shield: Shield, book: BookOpen };
export const CatIcon = ({ name, className }: { name: string; className?: string }) => { const I = CAT_ICON[name] ?? BookOpen; return <I className={className} aria-hidden />; };
export const ICON_CHOICES = Object.keys(CAT_ICON);

export const REVIEW_TONE: Record<ReviewState, string> = { em_dia: 'text-[#15803D]', proxima: 'text-[#B45309]', vencida: 'text-danger', em_revisao: 'text-primary', aguardando_aprovacao: 'text-primary' };
export const ReviewTag = ({ s }: { s: ReviewState }) => <span className={clsx('text-xs font-semibold', REVIEW_TONE[s])}>{REVIEW_STATE_LABELS[s]}</span>;

export function FavButton({ id, on, label }: { id: string; on: boolean; label: string }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api(`/playbooks/${id}/favorite`, { method: 'POST', body: { on: !on } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['playbooks'] }) });
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Tirar ${label} dos favoritos` : `Favoritar ${label}`} title={on ? 'Tirar dos favoritos' : 'Favoritar'} onClick={(e) => { e.preventDefault(); m.mutate(); }}
      className={clsx('flex h-8 w-8 items-center justify-center hover:bg-surface-2', on ? 'text-[#D4A62A]' : 'text-muted')}>
      <Star className="h-[18px] w-[18px]" fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

/** Cartão do playbook: lombada colorida pela categoria, código, versão, revisão e favorito. */
export function PlaybookCard({ c, compact }: { c: Card; compact?: boolean }) {
  return (
    <article aria-label={c.title} className="group relative flex h-full flex-col border border-line bg-surface transition-colors hover:border-primary/60">
      <span className="absolute inset-y-0 left-0 w-1 bg-primary/70 group-hover:bg-primary" aria-hidden />
      <div className="flex items-start gap-3 px-5 pt-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center bg-navy text-lime"><CatIcon name={c.category?.icon ?? 'book'} className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="num text-[11px] font-semibold tracking-wide text-muted">{c.code}{c.version && <> · v{c.version}</>}</p>
          <Link to={`/playbooks/${c.id}`} className="block font-display text-[17px] font-bold leading-snug text-ink after:absolute after:inset-0 hover:text-primary">{c.title}</Link>
        </div>
        <span className="relative z-10"><FavButton id={c.id} on={c.favorite} label={c.title} /></span>
      </div>
      {!compact && c.description && <p className="line-clamp-2 px-5 pl-[68px] pt-1 text-sm text-text">{c.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-4 pl-[68px] pt-3 text-xs text-muted">
        {c.category && <span>{c.category.name}</span>}
        {c.team && <span>· {c.team}</span>}
        {c.costCenter && <span>· {c.costCenter}</span>}
        {c.updatedOn && <span>· atualizado em {fmtDate(c.updatedOn)}</span>}
        {(c.recent || c.unreadUpdate) && <span className="bg-lime px-1.5 py-0.5 text-[11px] font-bold text-navy">{c.unreadUpdate ? 'Nova versão' : 'Atualizado'}</span>}
        {c.status === 'suspenso' && <span className="bg-danger-soft px-1.5 py-0.5 text-[11px] font-bold text-danger">Suspenso</span>}
        {!c.version && c.openVersion && <span className="bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-text">Em elaboração v{c.openVersion.number}</span>}
      </div>
    </article>
  );
}
