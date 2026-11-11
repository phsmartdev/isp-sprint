/**
 * Feed de Pessoas & Cultura no formato do Instagram web: fileira de fotos de quem publicou há pouco, comunicados
 * oficiais, "compartilhe algo" e o feed numa coluna estreita; à direita, o meu cartão, sugestões de colegas e rodapé.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { Avatar } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { orgLine, usePeopleMe, type PersonCard } from './shared';
import { PostEditor } from './feed/PostEditor';
import { Feed } from './feed/Feed';
import { AnnouncementsBlock } from './Announcements';
import { WelcomeCover } from './MySpace';

/** Anel colorido como o dos stories. */
export function Ring({ children, on = true }: { children: React.ReactNode; on?: boolean }) {
  return <span className={on ? 'rounded-circle bg-gradient-to-tr from-[#F5B400] via-[#E1306C] to-[#833AB4] p-[2.5px]' : 'rounded-circle bg-line p-[1.5px]'}><span className="block rounded-circle bg-surface p-[2px]">{children}</span></span>;
}

function Highlights() {
  const q = useQuery({ queryKey: ['pessoas', 'destaques'], queryFn: () => api<{ items: (PersonCard & { at: string })[] }>('/pessoas/destaques'), staleTime: 60_000 });
  if (!q.data?.items.length) return null;
  return (
    <section aria-label="Publicaram há pouco" className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {q.data.items.map((p) => (
        <Link key={p.id} to={`/pessoas/perfil/${p.id}`} className="flex w-[74px] shrink-0 flex-col items-center gap-1" title={p.name}>
          <Ring><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={58} /></Ring>
          <span className="w-full truncate text-center text-xs text-ink">{p.name.split(' ')[0]}</span>
        </Link>
      ))}
    </section>
  );
}

export function useStartConversation() {
  const nav = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: (userId: string) => api<{ id: string }>('/pessoas/mensagens/conversas', { method: 'POST', body: { userId } }),
    onSuccess: (r) => nav(`/pessoas/mensagens/${r.id}`),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

function RightColumn() {
  const me = usePeopleMe().data?.me;
  const q = useQuery({ queryKey: ['pessoas', 'colaboradores', 'sugestoes'], queryFn: () => api<{ items: PersonCard[] }>(`/pessoas/colaboradores${qs({ limit: 6 })}`), staleTime: 300_000 });
  const talk = useStartConversation();
  const people = (q.data?.items ?? []).filter((p) => p.id !== me?.id).slice(0, 5);
  return (
    <aside className="sticky top-[88px] hidden w-[300px] shrink-0 self-start xl:block" aria-label="Você e sugestões">
      {me && (
        <div className="flex items-center gap-3">
          <Link to="/pessoas/perfil/eu"><Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} size={44} /></Link>
          <div className="min-w-0 flex-1"><Link to="/pessoas/perfil/eu" className="block truncate text-sm font-semibold text-ink hover:underline">{me.name}</Link><p className="truncate text-sm text-muted">{orgLine(me) || 'Colaborador'}</p></div>
          <Link to="/pessoas/meu-espaco" className="text-xs font-semibold text-primary hover:text-ink">Meu Espaço</Link>
        </div>
      )}
      <div className="mb-2 mt-6 flex items-center justify-between"><p className="text-sm font-semibold text-muted">Colegas para conhecer</p><Link to="/pessoas/meu-espaco#colegas" className="text-xs font-semibold text-ink hover:text-muted">Ver tudo</Link></div>
      <ul className="space-y-3">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <Link to={`/pessoas/perfil/${p.id}`}><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={44} /></Link>
            <div className="min-w-0 flex-1"><Link to={`/pessoas/perfil/${p.id}`} className="block truncate text-sm font-semibold text-ink hover:underline">{p.name}</Link><p className="truncate text-xs text-muted">{orgLine(p) || 'Colaborador'}</p></div>
            <button type="button" className="text-xs font-semibold text-primary hover:text-ink" aria-label={`Mandar mensagem para ${p.name}`} onClick={() => talk.mutate(p.id)}>Mensagem</button>
          </li>
        ))}
      </ul>
      <nav aria-label="Links do módulo" className="mt-8 text-xs leading-5 text-muted">
        {[['Meu Espaço', '/pessoas/meu-espaco'], ['Comunidades', '/pessoas/comunidades'], ['Reconhecimento', '/pessoas/reconhecimento'], ['Publicações salvas', '/pessoas/salvos'], ['Minhas denúncias', '/pessoas/denuncias']].map(([l, to], i) => <span key={to}>{i > 0 && ' · '}<Link to={to!} className="hover:underline">{l}</Link></span>)}
      </nav>
      <p className="mt-4 text-xs uppercase text-muted">© {new Date().getFullYear()} BKT Soluções e Tecnologia</p>
    </aside>
  );
}

export function FeedHomePage() {
  return (
    <div className="flex justify-center gap-8 xl:gap-12">
      <div className="w-full min-w-0 max-w-[470px] space-y-4">
        {/* capa na largura do feed */}
        <WelcomeCover />
        <Highlights />
        <AnnouncementsBlock />
        <PostEditor compact />
        <Feed emptyTitle="O feed está começando" emptyText="Seja a primeira pessoa a compartilhar uma conquista, uma ideia ou um aprendizado." />
      </div>
      <RightColumn />
    </div>
  );
}
