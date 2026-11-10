/**
 * Central de Playbooks — página principal: busca de destaque, "Para você", categorias, cartões e filtros,
 * com Aprovações, Gestão e Configurações na mesma página, conforme o perfil.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BookOpen, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { PLAYBOOK_TYPES, PLAYBOOK_TYPE_LABELS, SUGGESTION_STATUS_LABELS, VERSION_STATUS_LABELS, type SuggestionStatus, type VersionStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useDebounced, useUrlState } from '../../lib/hooks';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { CatIcon, ICON_CHOICES, PlaybookCard, ReviewTag, type Card, type Category } from '../../features/playbooks/shared';

type Home = {
  items: Card[]; total: number;
  forYou: { team: Card[]; favorites: Card[]; recent: Card[]; updates: Card[]; ackPending: Card[] };
  categories: Category[];
  can: { create: boolean; manage: boolean; director: boolean; manager: boolean };
};
export type Setup = {
  categories: (Category & { active: boolean })[]; templates: { id: string; name: string; type: string; description: string | null; system: boolean }[];
  settings: { codePattern: string; alertDays: number[] } | null;
  teams: { id: string; name: string }[]; costCenters: { id: string; code: string; name: string; teamId: string | null }[]; users: { id: string; name: string }[];
  can: { categories: boolean; create: boolean };
};
type Tab = 'biblioteca' | 'aprovacoes' | 'gestao' | 'configuracoes';

export const usePbSetup = () => useQuery({ queryKey: ['playbooks', 'setup'], queryFn: () => api<Setup>('/playbooks/setup'), staleTime: 60_000 });

function Shelf({ title, items, hint }: { title: string; items: Card[]; hint?: string }) {
  if (!items.length) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-baseline gap-3"><h2 className="font-display text-lg font-bold text-ink">{title}</h2>{hint && <span className="text-sm text-muted">{hint}</span>}</div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{items.map((c) => <PlaybookCard key={c.id} c={c} />)}</div>
    </section>
  );
}

export function PlaybooksPage() {
  const [u, setU] = useUrlState({ aba: 'biblioteca', q: '', categoria: '', time: '', centro: '', tipo: '', resp: '', desde: '', escopo: 'todos' });
  const tab = u.aba as Tab;
  const [term, setTerm] = useState(u.q);
  const q = useDebounced(term, 300);
  const [filters, setFilters] = useState(false);
  const setup = usePbSetup();
  const params = { q: q || undefined, categoryId: u.categoria || undefined, teamId: u.time || undefined, costCenterId: u.centro || undefined, type: u.tipo || undefined, maintainerId: u.resp || undefined, updatedFrom: u.desde || undefined, scope: u.escopo };
  const home = useQuery({ queryKey: ['playbooks', 'home', params], queryFn: () => api<Home>(`/playbooks${qs(params)}`) });
  const pend = useQuery({ queryKey: ['playbooks', 'approvals'], queryFn: () => api<{ items: Approval[] }>('/playbooks/approvals') });
  const filtered = !!(q || u.categoria || u.time || u.centro || u.tipo || u.resp || u.desde || u.escopo !== 'todos');
  const d = home.data;
  const nav = useNavigate();
  const toDecide = pend.data?.items.filter((x) => x.canDecide).length ?? 0;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'biblioteca', label: 'Biblioteca' },
    ...(d?.can.manage || pend.data?.items.length ? [{ key: 'aprovacoes' as Tab, label: 'Aprovações', count: toDecide || undefined }] : []),
    ...(d?.can.create || d?.can.manage ? [{ key: 'gestao' as Tab, label: 'Gestão' }] : []),
    ...(d?.can.manage ? [{ key: 'configuracoes' as Tab, label: 'Configurações' }] : []),
  ];
  return (
    <div className="w-full">
      {/* cabeçalho da Central: o título e a busca em destaque */}
      <header className="relative -mx-4 -mt-6 mb-6 overflow-hidden bg-navy px-6 pb-8 pt-8 text-white sm:-mx-6 sm:px-10 2xl:-mx-8">
        <BookOpen className="pointer-events-none absolute -right-6 -top-10 h-56 w-56 text-white/[0.04]" aria-hidden />
        <div className="relative max-w-4xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[2rem] font-bold leading-tight tracking-wide">Playbooks</h1>
              <p className="mt-1 text-white/75">O conhecimento da nossa operação, organizado para você.</p>
            </div>
            {d?.can.create && <Button variant="primary" className="bg-lime text-navy hover:bg-lime/90" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/playbooks/novo')}>Novo playbook</Button>}
          </div>
          <label className="mt-6 flex items-center gap-3 border border-white/20 bg-white px-4 text-ink focus-within:outline focus-within:outline-2 focus-within:outline-lime">
            <Search className="h-5 w-5 text-muted" aria-hidden />
            <input value={term} onChange={(e) => { setTerm(e.target.value); setU({ q: e.target.value, aba: 'biblioteca' }); }} placeholder="Qual processo você precisa consultar?" aria-label="Buscar playbooks" className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted" />
            {term && <button type="button" aria-label="Limpar busca" onClick={() => { setTerm(''); setU({ q: '' }); }} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>}
          </label>
        </div>
      </header>

      <Tabs<Tab> label="Central de Playbooks" className="mb-6" value={tab} onChange={(t) => setU({ aba: t })} tabs={tabs} />

      {tab === 'biblioteca' && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(['todos', 'favoritos', ...(d?.can.create || d?.can.manage ? ['meus'] : [])] as const).map((k) => (
              <button key={k} type="button" aria-pressed={u.escopo === k} onClick={() => setU({ escopo: k })} className={clsx('border px-3 py-1.5 text-sm font-semibold', u.escopo === k ? 'border-navy bg-navy text-white' : 'border-line bg-surface text-ink hover:border-primary')}>
                {k === 'todos' ? 'Todos' : k === 'favoritos' ? 'Favoritos' : 'Que eu mantenho'}
              </button>
            ))}
            <button type="button" aria-expanded={filters} onClick={() => setFilters(!filters)} className="ml-auto inline-flex items-center gap-2 border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:border-primary"><SlidersHorizontal className="h-4 w-4" />Filtros</button>
          </div>
          {filters && setup.data && (
            <div className="mb-6 grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtros">
              <FormField label="Categoria" htmlFor="pf-cat"><Select id="pf-cat" value={u.categoria} onChange={(e) => setU({ categoria: e.target.value })}><option value="">Todas</option>{setup.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
              <FormField label="Time" htmlFor="pf-t"><Select id="pf-t" value={u.time} onChange={(e) => setU({ time: e.target.value })}><option value="">Todos</option>{setup.data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
              <FormField label="Centro de custo" htmlFor="pf-cc"><Select id="pf-cc" value={u.centro} onChange={(e) => setU({ centro: e.target.value })}><option value="">Todos</option>{setup.data.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
              <FormField label="Tipo" htmlFor="pf-tp"><Select id="pf-tp" value={u.tipo} onChange={(e) => setU({ tipo: e.target.value })}><option value="">Todos</option>{PLAYBOOK_TYPES.map((t) => <option key={t} value={t}>{PLAYBOOK_TYPE_LABELS[t]}</option>)}</Select></FormField>
              <FormField label="Responsável" htmlFor="pf-r"><Select id="pf-r" value={u.resp} onChange={(e) => setU({ resp: e.target.value })}><option value="">Todos</option>{setup.data.users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
              <FormField label="Atualizado desde" htmlFor="pf-d"><Input id="pf-d" type="date" value={u.desde} onChange={(e) => setU({ desde: e.target.value })} /></FormField>
            </div>
          )}
          {home.isLoading ? <LoadingRows rows={6} /> : home.isError ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> : filtered ? (
            <section aria-label="Resultados" className="space-y-3">
              <p className="text-sm text-muted"><span className="num font-semibold text-ink">{d!.total}</span> playbook(s){q ? <> para “{q}”</> : null}</p>
              {!d!.items.length ? <EmptyState title="Nada encontrado" description="Tente outras palavras ou limpe os filtros. A busca considera título, descrição, palavras-chave, categoria, time, centro de custo e o texto dos playbooks que você pode ver." />
                : <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{d!.items.map((c) => <PlaybookCard key={c.id} c={c} />)}</div>}
            </section>
          ) : (
            <div className="space-y-10">
              <Shelf title="Ciência pendente" hint="leia e confirme" items={d!.forYou.ackPending} />
              <Shelf title="Para você" hint="do seu time e do seu centro de custo" items={d!.forYou.team} />
              <Shelf title="Atualizações" items={d!.forYou.updates} />
              <Shelf title="Continue de onde parou" items={d!.forYou.recent} />
              <Shelf title="Favoritos" items={d!.forYou.favorites} />
              <LibraryCategories categories={d!.categories} manage={d!.can.manage} onPick={(id) => setU({ categoria: id })} />
              {!d!.items.length && !d!.forYou.team.length && <EmptyState title="A biblioteca ainda está vazia" description={d!.can.create ? 'Crie o primeiro playbook a partir de um modelo. Ele passa pela Gerência e pela Diretoria antes de ser publicado.' : 'Os playbooks publicados para você aparecem aqui.'} />}
            </div>
          )}
        </>
      )}
      {tab === 'aprovacoes' && <Approvals />}
      {tab === 'gestao' && <Manage />}
      {tab === 'configuracoes' && <Settings />}
    </div>
  );
}

// ------------------------------------------------------------------ aprovações
export type Approval = { versionId: string; playbookId: string; code: string; title: string; number: string; previous: string | null; status: VersionStatus; stage: 'gerencia' | 'diretoria' | null; requestedBy: string | null; requestedAt: string | null; changeSummary: string | null; relevant: boolean; effectiveFrom: string | null; rowVersion: number; canDecide: boolean; mine: boolean; comments: { stage: string; decision: string; note: string | null; by: string | null; at: string }[] };

function Approvals() {
  const q = useQuery({ queryKey: ['playbooks', 'approvals'], queryFn: () => api<{ items: Approval[] }>('/playbooks/approvals') });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  const mine = items.filter((x) => x.canDecide), sent = items.filter((x) => !x.canDecide);
  return (
    <div className="space-y-8">
      <section aria-label="Aguardando a minha decisão">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Aguardando a sua decisão</h2>
        {!mine.length ? <p className="border border-dashed border-line px-4 py-3 text-sm text-muted">Nada pendente com você.</p> : (
          <ul className="divide-y divide-line border border-line bg-surface">{mine.map((a) => (
            <li key={a.versionId} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="num text-xs font-semibold text-muted">{a.code} · v{a.previous ?? '—'} → v{a.number}{a.relevant && ' · mudança relevante'}</p>
                <p className="font-bold text-ink">{a.title}</p>
                <p className="text-sm text-text">{a.changeSummary}</p>
                <p className="text-xs text-muted">Pedido por {a.requestedBy} em {a.requestedAt ? fmtDateTime(a.requestedAt) : '—'} · {a.stage === 'gerencia' ? 'Revisão da Gerência' : 'Homologação da Diretoria'}</p>
              </div>
              <Link to={`/playbooks/${a.playbookId}/aprovar/${a.versionId}`} className="inline-flex h-10 items-center bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">Analisar</Link>
            </li>
          ))}</ul>
        )}
      </section>
      {!!sent.length && (
        <section aria-label="Que eu enviei">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Que você enviou</h2>
          <ul className="divide-y divide-line border border-line bg-surface">{sent.map((a) => (
            <li key={a.versionId} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="num text-xs font-semibold text-muted">{a.code} v{a.number}</span><span className="flex-1 font-semibold text-ink">{a.title}</span>
              <span className="text-muted">{VERSION_STATUS_LABELS[a.status]}</span>
              <Link to={`/playbooks/${a.playbookId}/aprovar/${a.versionId}`} className="font-semibold text-primary hover:underline">Ver</Link>
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ gestão
type ManageData = {
  items: Card[];
  reviews: Record<'vencida' | 'proxima' | 'em_revisao' | 'aguardando_aprovacao' | 'em_dia', number>;
  indicators: { id: string; code: string; title: string; requiresAck: boolean; recipients: number; viewed: number; views: number; acked: number; pending: number; pendingByTeam: { id: string; name: string; n: number }[]; pendingByCostCenter: { id: string; name: string; n: number }[] }[];
  mostViewed: ManageData['indicators']; leastViewed: ManageData['indicators'];
  suggestions: { id: string; playbookId: string; code: string; kind: string; description: string; excerpt: string | null; reason: string | null; status: SuggestionStatus; author: string | null; at: string }[];
  can: { director: boolean; manager: boolean };
};
function Manage() {
  const q = useQuery({ queryKey: ['playbooks', 'manage'], queryFn: () => api<ManageData>('/playbooks/manage') });
  const [resp, setResp] = useState<{ id: string; status: SuggestionStatus } | null>(null);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const stat = (label: string, n: number, tone?: string) => <div className="bg-surface px-5 py-4"><p className="text-sm text-muted">{label}</p><p className={clsx('num font-display text-3xl font-extrabold', tone ?? 'text-ink')}>{n}</p></div>;
  return (
    <div className="space-y-8">
      <section aria-label="Revisões" className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        {stat('Revisão vencida', d.reviews.vencida, d.reviews.vencida ? 'text-danger' : undefined)}
        {stat('Revisão próxima', d.reviews.proxima, d.reviews.proxima ? 'text-[#B45309]' : undefined)}
        {stat('Em revisão', d.reviews.em_revisao)}
        {stat('Aguardando aprovação', d.reviews.aguardando_aprovacao)}
        {stat('Em dia', d.reviews.em_dia, 'text-[#15803D]')}
      </section>
      <section aria-label="Playbooks que mantenho" className="space-y-2">
        <h2 className="font-display text-lg font-bold text-ink">{d.can.director || d.can.manager ? 'Playbooks da área' : 'Meus playbooks'}</h2>
        {!d.items.length ? <EmptyState title="Nenhum playbook ainda" description="Use “Novo playbook” para criar a partir de um modelo." /> : (
          <div className="overflow-x-auto border border-line bg-surface"><table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Código', 'Playbook', 'Vigente', 'Em andamento', 'Próxima revisão', 'Situação'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="num px-4 py-2.5 text-xs font-semibold text-muted">{c.code}</td>
                <td className="px-4 py-2.5"><Link className="font-semibold text-ink hover:text-primary" to={`/playbooks/${c.id}`}>{c.title}</Link>{c.status === 'suspenso' && <span className="ml-2 text-xs font-bold text-danger">suspenso</span>}</td>
                <td className="num px-4 py-2.5">{c.version ? `v${c.version}` : '—'}</td>
                <td className="px-4 py-2.5">{c.openVersion ? <Link className="text-primary hover:underline" to={`/playbooks/${c.id}/editar`}>v{c.openVersion.number} · {VERSION_STATUS_LABELS[c.openVersion.status as VersionStatus]}</Link> : '—'}</td>
                <td className="num px-4 py-2.5">{c.nextReviewOn ? fmtDate(c.nextReviewOn) : '—'}</td>
                <td className="px-4 py-2.5"><ReviewTag s={c.review} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <section aria-label="Disseminação" className="space-y-2">
        <h2 className="font-display text-lg font-bold text-ink">Disseminação</h2>
        <p className="text-sm text-muted">Quem recebe (público autorizado), quem abriu e quem confirmou ciência da versão vigente. Abrir a página não conta como ciência.</p>
        {!d.indicators.length ? <p className="text-sm text-muted">Sem playbooks publicados.</p> : (
          <div className="overflow-x-auto border border-line bg-surface"><table className="w-full min-w-[900px] text-left text-sm" aria-label="Indicadores de disseminação">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Playbook', 'Receberam', 'Visualizaram', 'Confirmaram ciência', 'Pendências por time', 'Pendências por centro de custo'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.indicators.map((x) => (
              <tr key={x.id} className="border-t border-line align-top">
                <td className="px-4 py-2.5"><span className="num block text-xs text-muted">{x.code}</span><span className="font-semibold text-ink">{x.title}</span></td>
                <td className="num px-4 py-2.5">{x.recipients}</td>
                <td className="num px-4 py-2.5">{x.viewed} <span className="text-xs text-muted">({x.views} acessos)</span></td>
                <td className="num px-4 py-2.5">{x.requiresAck ? <>{x.acked}/{x.recipients}</> : <span className="text-xs text-muted">não exigida</span>}</td>
                <td className="px-4 py-2.5 text-xs">{x.pendingByTeam.map((t) => `${t.name}: ${t.n}`).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{x.pendingByCostCenter.map((t) => `${t.name}: ${t.n}`).join(' · ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Ranking title="Mais consultados" items={d.mostViewed} />
          <Ranking title="Pouco acessados" items={d.leastViewed} />
        </div>
      </section>
      <section aria-label="Sugestões" className="space-y-2">
        <h2 className="font-display text-lg font-bold text-ink">Sugestões e conteúdo desatualizado</h2>
        {!d.suggestions.length ? <p className="border border-dashed border-line px-4 py-3 text-sm text-muted">Nenhuma sugestão aberta.</p> : (
          <ul className="divide-y divide-line border border-line bg-surface">{d.suggestions.map((x) => (
            <li key={x.id} className="space-y-1 px-5 py-4">
              <p className="text-xs text-muted"><Link className="num font-semibold text-primary hover:underline" to={`/playbooks/${x.playbookId}`}>{x.code}</Link> · {x.kind === 'desatualizado' ? 'Conteúdo desatualizado' : 'Sugestão de melhoria'} · {x.author} · {fmtDateTime(x.at)} · <b>{SUGGESTION_STATUS_LABELS[x.status]}</b></p>
              <p className="text-ink">{x.description}</p>
              {x.excerpt && <p className="border-l-2 border-line pl-2 text-sm text-muted">“{x.excerpt}”</p>}
              <div className="flex flex-wrap gap-2 pt-1">{(['em_analise', 'aceita', 'rejeitada', 'incorporada'] as SuggestionStatus[]).filter((s) => s !== x.status).map((s) => <Button key={s} size="sm" variant={s === 'aceita' ? 'primary' : 'secondary'} onClick={() => setResp({ id: x.id, status: s })}>{SUGGESTION_STATUS_LABELS[s]}</Button>)}</div>
            </li>
          ))}</ul>
        )}
      </section>
      {resp && <SuggestionResponse r={resp} onClose={() => setResp(null)} />}
    </div>
  );
}
const Ranking = ({ title, items }: { title: string; items: ManageData['indicators'] }) => (
  <div className="border border-line bg-surface p-4"><p className="mb-2 font-semibold text-ink">{title}</p>
    <ol className="space-y-1 text-sm">{items.map((x) => <li key={x.id} className="flex justify-between gap-2"><span className="truncate">{x.code} · {x.title}</span><span className="num text-muted">{x.views}</span></li>)}</ol></div>
);
function SuggestionResponse({ r, onClose }: { r: { id: string; status: SuggestionStatus }; onClose: () => void }) {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/playbook-suggestions/${r.id}`, { method: 'PATCH', body: { status: r.status, response: text || null } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: 'Resposta registrada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title={`Marcar como “${SUGGESTION_STATUS_LABELS[r.status]}”`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={r.status === 'rejeitada' && text.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Confirmar</Button></>}>
      <FormField label={r.status === 'rejeitada' ? 'Por que não será aplicada' : 'Resposta para quem sugeriu (opcional)'} htmlFor="sg-r"><Textarea id="sg-r" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
    </Modal>
  );
}

// ------------------------------------------------------------------ configurações
function Settings() {
  const s = usePbSetup();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  const [cfg, setCfg] = useState<{ codePattern: string; alertDays: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const saveCfg = useMutation({ mutationFn: () => api('/playbooks/settings', { method: 'PUT', body: { codePattern: cfg!.codePattern, alertDays: cfg!.alertDays.split(/[,\s]+/).filter(Boolean).map(Number) } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: 'Configuração salva' }); setCfg(null); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (s.isLoading) return <LoadingRows rows={4} />;
  if (s.isError) return <ErrorState error={s.error} onRetry={() => s.refetch()} />;
  const d = s.data!;
  const c = cfg ?? { codePattern: d.settings?.codePattern ?? '{CAT}-PB-{NUM}', alertDays: (d.settings?.alertDays ?? [30, 15, 7, 0]).join(', ') };
  return (
    <div className="space-y-8">
      <section aria-label="Categorias" className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold text-ink">Categorias e alçadas</h2><Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ icon: 'book', approval: { gerencia: true, diretoria: true } })}>Nova categoria</Button></div>
        <ul className="divide-y divide-line border border-line bg-surface">{d.categories.map((x) => (
          <li key={x.id} className={clsx('flex flex-wrap items-center gap-3 px-5 py-3', !x.active && 'opacity-50')}>
            <CatIcon name={x.icon} className="h-5 w-5 text-primary" />
            <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{x.name}</span> <span className="num text-xs text-muted">{x.prefix}</span>{x.description && <span className="block text-sm text-muted">{x.description}</span>}</span>
            <span className="text-xs text-muted">Aprovação: {[x.approval.gerencia && 'Gerência', x.approval.diretoria && 'Diretoria'].filter(Boolean).join(' → ') || 'Diretoria'}</span>
            <Button size="sm" variant="ghost" onClick={() => setEdit(x)}>Editar</Button>
            <Button size="sm" variant="ghost" onClick={() => setDel(x)}>Excluir</Button>
          </li>
        ))}</ul>
        <p className="text-xs text-muted">Criticidade alta sempre passa pela Gerência e pela Diretoria. Delegação de aprovação não está habilitada.</p>
      </section>
      <section aria-label="Código e alertas" className="max-w-xl space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Código e alertas de revisão</h2>
        <FormField label="Padrão do código" htmlFor="pc-p" hint="{CAT} = prefixo da categoria, {NUM} = sequência (ex.: COM-PB-001)"><Input id="pc-p" value={c.codePattern} onChange={(e) => setCfg({ ...c, codePattern: e.target.value })} /></FormField>
        <FormField label="Alertas (dias antes do vencimento)" htmlFor="pc-a" hint="0 = no dia do vencimento"><Input id="pc-a" value={c.alertDays} onChange={(e) => setCfg({ ...c, alertDays: e.target.value })} /></FormField>
        <Button variant="primary" disabled={!cfg} loading={saveCfg.isPending} onClick={() => saveCfg.mutate()}>Salvar</Button>
      </section>
      {edit && <CategoryModal c={edit} onClose={() => setEdit(null)} />}
      {del && <DeleteCategory c={del} onClose={() => setDel(null)} />}
    </div>
  );
}

/** Categorias na biblioteca; quem administra (Gerência e Diretoria) cria, edita e exclui ali mesmo. */
function LibraryCategories({ categories, manage, onPick }: { categories: Category[]; manage: boolean; onPick: (id: string) => void }) {
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  return (
    <section aria-label="Categorias" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Categorias</h2>
        {manage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ icon: 'book', approval: { gerencia: true, diretoria: true } })}>Nova categoria</Button>}
      </div>
      {!categories.length ? <EmptyState title="Nenhuma categoria" description={manage ? 'Crie as categorias que a sua operação usa. Cada uma define o prefixo do código e quem aprova os playbooks.' : 'A gestão ainda não criou categorias.'} /> : (
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id} aria-label={c.name} className="group relative flex bg-surface hover:bg-surface-2">
              <button type="button" onClick={() => onPick(c.id)} className="flex flex-1 items-start gap-4 p-5 text-left">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-line text-primary group-hover:border-primary group-hover:bg-primary group-hover:text-white"><CatIcon name={c.icon} className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="font-bold text-ink">{c.name}</span><span className="num text-sm text-muted">{c.count}</span></span>{c.description && <span className="mt-0.5 block text-sm text-muted">{c.description}</span>}</span>
              </button>
              {manage && (
                <span className="flex flex-col border-l border-line">
                  <button type="button" aria-label={`Editar ${c.name}`} title="Editar" onClick={() => setEdit({ ...c, active: true })} className="flex flex-1 items-center justify-center px-3 text-muted hover:bg-primary hover:text-white"><Pencil className="h-4 w-4" /></button>
                  <button type="button" aria-label={`Excluir ${c.name}`} title="Excluir" onClick={() => setDel(c)} className="flex flex-1 items-center justify-center border-t border-line px-3 text-muted hover:bg-danger hover:text-white"><Trash2 className="h-4 w-4" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && <CategoryModal c={edit} onClose={() => setEdit(null)} />}
      {del && <DeleteCategory c={del} onClose={() => setDel(null)} />}
    </section>
  );
}

function DeleteCategory({ c, onClose }: { c: Category; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/playbooks/categories/${c.id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: 'Categoria excluída' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <ConfirmDialog open title={`Excluir “${c.name}”?`} confirmLabel="Excluir" tone="danger" loading={m.isPending} onConfirm={() => m.mutate()} onCancel={onClose}>
      <p>A categoria sai da biblioteca e do editor. Só é possível excluir categorias sem playbooks. Se houver algum, desative a categoria em Editar: os playbooks continuam disponíveis.</p>
    </ConfirmDialog>
  );
}
function CategoryModal({ c, onClose }: { c: Partial<Category>; onClose: () => void }) {
  const [v, setV] = useState({ name: c.name ?? '', prefix: c.prefix ?? '', icon: c.icon ?? 'book', description: c.description ?? '', gerencia: c.approval?.gerencia ?? true, diretoria: c.approval?.diretoria ?? true, active: c.active ?? true });
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api('/playbooks/categories', { method: 'POST', body: { id: c.id, name: v.name, prefix: v.prefix, icon: v.icon, description: v.description || null, approval: { gerencia: v.gerencia, diretoria: v.diretoria }, active: v.active } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: 'Categoria salva' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const box = (k: 'gerencia' | 'diretoria' | 'active', label: ReactNode) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{label}</label>;
  return (
    <Modal open onClose={onClose} title={c.id ? 'Editar categoria' : 'Nova categoria'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 2 || !/^[A-Za-z]{2,5}$/.test(v.prefix)} loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Nome" htmlFor="ct-n" required className="sm:col-span-2"><Input id="ct-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
        <FormField label="Prefixo do código" htmlFor="ct-p" required hint="2 a 5 letras"><Input id="ct-p" value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value.toUpperCase() })} /></FormField>
        <FormField label="Descrição" htmlFor="ct-d" className="sm:col-span-3"><Input id="ct-d" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></FormField>
        <fieldset className="sm:col-span-3"><legend className="mb-1 text-sm font-semibold text-ink">Ícone</legend><div className="flex flex-wrap gap-2">{ICON_CHOICES.map((i) => <button key={i} type="button" aria-label={`Ícone ${i}`} aria-pressed={v.icon === i} onClick={() => setV({ ...v, icon: i })} className={clsx('flex h-10 w-10 items-center justify-center border', v.icon === i ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:border-primary')}><CatIcon name={i} className="h-5 w-5" /></button>)}</div></fieldset>
        <fieldset className="space-y-1 sm:col-span-3"><legend className="mb-1 text-sm font-semibold text-ink">Quem aprova</legend>{box('gerencia', 'Revisão da Gerência')}{box('diretoria', 'Homologação da Diretoria')}{c.id && box('active', 'Ativa')}</fieldset>
      </div>
    </Modal>
  );
}
