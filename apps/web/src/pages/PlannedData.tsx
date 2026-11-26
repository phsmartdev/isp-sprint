/** Dados Planejados: chamados do GLPI atribuídos aos grupos e pessoas do Comercial — quem, o quê e até quando. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ExternalLink, RefreshCw, Settings } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../components/ui/primitives';
import { Drawer, useToast } from '../components/ui/overlay';
import { TvArea, TvBar, TvButton, useTvMode } from '../features/TvMode';

type Sit = 'atrasado' | 'a_vencer' | 'no_prazo' | 'sem_prazo';
type Line = { open: number; ok: number; soon: number; late: number; solved: number; serviceLevel: number | null };
type Data = {
  configured: { enabled: boolean; glpi: boolean; people: number; groups: number }; lastSyncAt: string | null; lastError: string | null;
  period: { from: string; to: string }; sla: { source: 'universal' | 'glpi'; solveHours: number; ownHours: number; businessHoursOnly: boolean; goalPct: number };
  kpi: { open: number; ok: number; soon: number; soon4h: number; late: number; unassigned: number; serviceLevel: number | null; solved: number; solvedLate: number; firstResponseMin: number | null; firstResponseCount: number; mentionsOpen: number; mentions: number; approvalsPending: number; oldestLate: { glpiId: number; dueText: string; unassigned: boolean; group: string } | null };
  pending: { id: string; glpiId: number; title: string; client: string | null; groups: string[]; situation: Sit; situationLabel: string; assignees: string[]; unassigned: boolean; statusName: string | null; due: string | null; dueText: string; todo: string; glpiUrl: string | null; lastAlert: { stage: string; channels: string[]; names: string[]; sentAt: string } | null; firstResponse: { at: string; by: string | null } | null }[];
  mentions: { id: string; glpiId: number; title: string; client: string | null; person: string; by: string | null; at: string | null; answeredAt: string | null; statusName: string | null; glpiUrl: string | null }[];
  approvals: { id: string; glpiId: number; title: string; client: string | null; approver: string; isGroup: boolean; requester: string | null; at: string | null; waiting: string | null; statusName: string | null; glpiUrl: string | null }[];
  days: { date: string; opened: number; solved: number; solvedLate: number }[];
  heat: number[][];
  byGroup: ({ groupId: number; name: string; people: ({ userId: string | null; name: string } & Line)[] } & Line)[];
  filters: { groups: { id: number; name: string }[]; people: { id: string; name: string }[] };
  canConfigure: boolean;
};

const TV_KEYS = [['dados-planejados']];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const back = (days: number) => iso(new Date(new Date(`${todayIso()}T12:00:00Z`).getTime() - days * 86_400_000));
const PERIODS = [['hoje', 'Hoje', 0], ['7d', '7 dias', 6], ['30d', '30 dias', 29], ['90d', '90 dias', 89]] as const;
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const mins = (m: number | null) => (m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const STAGE: Record<string, string> = { chegou: 'chegou', sem_dono: 'sem responsável', vence: 'a vencer', venceu: 'venceu', escalado: 'escalado' };
const SIT_CHIP: Record<Sit, string> = { atrasado: 'bg-danger text-white', a_vencer: 'bg-warning-soft text-[#7A4E00] border border-[#E8C27A]', no_prazo: 'bg-success-soft text-[#1F6B44]', sem_prazo: 'bg-bg text-muted' };
const pill = (on: boolean) => clsx('min-h-9 border px-3 text-sm font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-ink hover:border-primary');

export function PlannedDataPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [group, setGroup] = useState<number | null>(null);
  const [person, setPerson] = useState('');
  const [period, setPeriod] = useState<string>('30d');
  const [range, setRange] = useState({ from: back(29), to: todayIso() });
  const [config, setConfig] = useState(false);
  const q = useQuery({
    queryKey: ['dados-planejados', group, person, range],
    queryFn: () => api<Data>(`/dados-planejados${qs({ group: group ?? undefined, userId: person || undefined, from: range.from, to: range.to })}`),
    refetchInterval: 60_000,
  });
  const run = useMutation({
    mutationFn: () => api<{ sync?: { read?: number; error?: string; entities?: { name: string; count: number }[] } }>('/admin/dados-planejados/run', { method: 'POST' }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['dados-planejados'] });
      // o que o GLPI devolveu: se faltar alguma entidade, o perfil da integração no GLPI não a enxerga
      const ents = r.sync?.entities ?? [];
      const detail = r.sync?.read != null ? ` · ${r.sync.read} chamado(s) alterado(s) nos últimos 45 dias${ents.length ? ` em: ${ents.map((e) => `${e.name} (${e.count})`).join('; ')}` : ''}` : '';
      toast({ tone: r.sync?.error ? 'error' : 'success', message: r.sync?.error ? `GLPI: ${r.sync.error}` : `GLPI lido e avisos conferidos${detail}` });
    },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const pickPeriod = (k: string, days: number) => { setPeriod(k); setRange({ from: back(days), to: todayIso() }); };
  const d = q.data;
  const tvRef = useRef<HTMLDivElement>(null);
  const tv = useTvMode(tvRef);
  const groupName = group === null ? 'Todos os grupos' : (d?.filters.groups.find((g) => g.id === group)?.name ?? 'Grupo');
  const fmtDay = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString('pt-BR');
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Chamados do GLPI atribuídos aos grupos do Comercial ou às pessoas deles</p>
          <h1 className="font-display text-2xl font-bold tracking-wide text-ink">Dados Planejados</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d && <span className="num text-xs text-muted">{d.lastSyncAt ? `Lido do GLPI em ${fmtDateTime(d.lastSyncAt)}` : 'Ainda não lido do GLPI'}</span>}
          <TvButton onClick={() => void tv.enter()} />
          {d?.canConfigure && <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={run.isPending} onClick={() => run.mutate()}>Ler GLPI agora</Button>}
          {d?.canConfigure && <Button size="sm" variant="secondary" icon={<Settings className="h-4 w-4" />} onClick={() => setConfig(true)}>Configurar alertas</Button>}
        </div>
      </header>

      <TvArea innerRef={tvRef} active={tv.active} fallback={tv.fallback}>
      {tv.active && <TvBar title="Dados Planejados" period={`${fmtDay(range.from)} a ${fmtDay(range.to)}`} tabs={[{ key: 'painel', label: groupName }]} tab="painel" onTab={() => undefined} onExit={tv.exit} queryKeys={TV_KEYS} />}
      <div className="space-y-5">
      {q.isLoading ? <div className="card"><LoadingRows rows={6} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <>
          {!d.configured.glpi && <Notice tone="warning">A integração com o GLPI não está configurada. {d.canConfigure ? <Link className="font-semibold text-primary hover:underline" to="/settings/integrations">Configurar em Integrações</Link> : 'Peça à administração.'}</Notice>}
          {d.configured.glpi && !d.configured.people && <Notice tone="warning">Ninguém está ligado ao GLPI ainda. Em <Link className="font-semibold text-primary hover:underline" to="/settings/users">Usuários</Link>, informe o usuário e os grupos do GLPI de cada pessoa.</Notice>}
          {d.configured.glpi && !!d.configured.people && !d.configured.enabled && <Notice tone="warning">O monitoramento está desligado: os chamados não são lidos e os avisos não saem. {d.canConfigure ? 'Ligue em Configurar alertas.' : 'Peça à administração.'}</Notice>}
          {d.lastError && <Notice tone="warning">Última leitura do GLPI falhou: {d.lastError}</Notice>}

          <section aria-label="Filtros" className="card flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
            <div role="group" aria-label="Grupo" className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-muted">Grupo</span>
              <button type="button" className={pill(group === null)} aria-pressed={group === null} onClick={() => setGroup(null)}>Todos</button>
              {d.filters.groups.map((g) => <button key={g.id} type="button" className={pill(group === g.id)} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.name}</button>)}
            </div>
            <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-muted">Período</span>
              {PERIODS.map(([k, l, n]) => <button key={k} type="button" className={pill(period === k)} aria-pressed={period === k} onClick={() => pickPeriod(k, n)}>{l}</button>)}
              <label className="flex items-center gap-1 text-xs text-muted"><span className="sr-only">De</span><Input type="date" aria-label="De" value={range.from} onChange={(e) => { setPeriod('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} className="!w-36" /></label>
              <label className="flex items-center gap-1 text-xs text-muted">a<Input type="date" aria-label="Até" value={range.to} onChange={(e) => { setPeriod('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} className="!w-36" /></label>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">Pessoa
              <Select aria-label="Pessoa" value={person} onChange={(e) => setPerson(e.target.value)} className="!w-48"><option value="">Todas as pessoas</option>{d.filters.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </label>
          </section>

          {(d.kpi.late > 0 || d.kpi.soon4h > 0) && (
            <section role="alert" aria-label="Alerta" className="flex flex-wrap items-center gap-4 border border-[#F2B8B8] border-l-4 border-l-danger bg-danger-soft px-4 py-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
              <p className="min-w-0 flex-1 text-[15px] text-[#7A1C1C]">
                {d.kpi.late > 0 && <><b>{d.kpi.late} chamado(s) em atraso</b>{d.kpi.soon4h > 0 ? ' e ' : '. '}</>}
                {d.kpi.soon4h > 0 && <><b>{d.kpi.soon4h} vence(m) nas próximas 4 horas</b>. </>}
                {d.kpi.oldestLate && <>O mais antigo (#{d.kpi.oldestLate.glpiId}) {d.kpi.oldestLate.dueText}{d.kpi.oldestLate.unassigned ? `, sem responsável no grupo ${d.kpi.oldestLate.group}` : ''}.</>}
              </p>
              <a href="#pendencias" className="inline-flex min-h-11 items-center bg-danger px-4 text-sm font-semibold text-white">Ver pendências</a>
            </section>
          )}

          <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Atribuídos em aberto" value={d.kpi.open} hint={d.kpi.unassigned ? `${d.kpi.unassigned} sem responsável` : 'todos com responsável'} />
            <Kpi label="Dentro do prazo" value={d.kpi.ok} hint="abertos com prazo correndo" tone="ok" />
            <Kpi label="A vencer em 24 h" value={d.kpi.soon} hint={`${d.kpi.soon4h} em menos de 4 h`} tone="soon" />
            <Kpi label="Fora do prazo" value={d.kpi.late} hint="abertos com prazo vencido" tone="late" />
            <div className="bg-navy p-4 text-white" data-testid="kpi-sla">
              <p className="text-sm text-white/80">Nível de serviço</p>
              <p className="num mt-1 font-display text-3xl font-bold">{pct(d.kpi.serviceLevel)}</p>
              <div className="relative mt-2 h-1.5 bg-white/20">
                <div className={clsx('absolute inset-y-0 left-0', (d.kpi.serviceLevel ?? 0) >= d.sla.goalPct ? 'bg-lime' : 'bg-[#F0A202]')} style={{ width: `${Math.min(100, d.kpi.serviceLevel ?? 0)}%` }} />
                <div className="absolute -top-1 h-3.5 w-0.5 bg-lime" style={{ left: `${d.sla.goalPct}%` }} title={`Meta ${d.sla.goalPct}%`} />
              </div>
              <p className="mt-1.5 text-xs text-white/80">{d.kpi.solved} resolvido(s) · meta {d.sla.goalPct}%</p>
            </div>
            <Kpi label="1º atendimento (média)" value={mins(d.kpi.firstResponseMin)} hint={d.kpi.firstResponseCount ? `1ª mensagem do Comercial em ${d.kpi.firstResponseCount} chamado(s) · meta ${d.sla.ownHours} h` : `sem mensagem do Comercial ainda · meta ${d.sla.ownHours} h`} />
            <Kpi label="Aprovações pendentes" value={d.kpi.approvalsPending} hint="pedidas a pessoas ou grupos do Comercial" tone={d.kpi.approvalsPending ? 'soon' : undefined} href="#aprovacoes" />
            <Kpi label="Menções sem resposta" value={d.kpi.mentionsOpen} hint={`${d.kpi.mentions} menção(ões) em chamados abertos`} tone={d.kpi.mentionsOpen ? 'soon' : undefined} href="#mencoes" />
          </section>
          <p className="-mt-2 text-xs text-muted">SLA {d.sla.source === 'universal' ? 'universal' : 'do GLPI (sem SLA lá, o universal)'}: {d.sla.solveHours} h {d.sla.businessHoursOnly ? 'úteis' : 'corridas'} para solucionar, {d.sla.ownHours} h para assumir.</p>

          <section id="pendencias" aria-label="Pendências" className="card">
            <div className="flex flex-wrap items-end justify-between gap-2 p-4 pb-2">
              <div><h2 className="text-lg font-bold text-ink">Pendências</h2><p className="text-sm text-muted">Quem precisa agir, em qual chamado e até quando. Atrasados primeiro.</p></div>
              <p className="num text-sm text-muted">{d.pending.length} chamado(s)</p>
            </div>
            {!d.pending.length ? <p className="px-4 pb-6 text-sm text-muted">Nenhum chamado pendente neste filtro.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Chamado</th><th className="px-3 py-2">Quem</th><th className="px-3 py-2">Prazo</th><th className="px-3 py-2">Último aviso</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr></thead>
                  <tbody>{d.pending.map((p) => (
                    <tr key={p.id} className={clsx('border-b border-line align-top', p.situation === 'atrasado' && 'bg-[#FFF7F7]')} data-testid="pending-row">
                      <td className="whitespace-nowrap px-3 py-3"><span className={clsx('inline-block px-2 py-0.5 text-xs font-bold', SIT_CHIP[p.situation])}>{p.situationLabel}</span></td>
                      <td className="min-w-[260px] px-3 py-3"><p className="font-semibold text-ink">#{p.glpiId} · {p.title}</p><p className="text-xs text-muted">{p.client ?? '—'} · {p.groups.join(', ')}</p></td>
                      <td className="min-w-[170px] px-3 py-3">{p.unassigned ? <p className="font-bold text-danger">Sem responsável</p> : <p className="font-semibold text-ink">{p.assignees.join(', ')}</p>}<p className="text-xs text-muted">{p.firstResponse ? `1ª resposta: ${p.firstResponse.by ?? 'Comercial'}, ${fmtDateTime(p.firstResponse.at)}` : 'sem resposta do Comercial'} · falta {p.todo}</p></td>
                      <td className="num min-w-[150px] px-3 py-3"><p className={clsx('font-bold', p.situation === 'atrasado' ? 'text-danger' : p.situation === 'a_vencer' ? 'text-[#8A5A00]' : 'text-ink')}>{p.dueText}</p><p className="text-xs text-muted">{p.due ? fmtDateTime(p.due) : '—'}</p></td>
                      <td className="num min-w-[160px] px-3 py-3 text-xs text-muted">{p.lastAlert ? `${p.lastAlert.channels.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(' e ')} (${STAGE[p.lastAlert.stage] ?? p.lastAlert.stage}) para ${p.lastAlert.names.join(', ')} · ${fmtDateTime(p.lastAlert.sentAt)}` : 'sem aviso ainda'}</td>
                      <td className="whitespace-nowrap px-3 py-3">{p.glpiUrl && <a href={p.glpiUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 border border-primary px-3 text-sm font-semibold text-primary hover:bg-primary-soft">Abrir no GLPI<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <ApprovalsList items={d.approvals} />
          <MentionsList items={d.mentions} />

          <div className="flex flex-wrap gap-5">
            <DaysChart days={d.days} />
            <Heat heat={d.heat} />
          </div>

          <section aria-label="Nível de serviço por grupo e pessoa" className="card">
            <div className="p-4 pb-2"><h2 className="text-lg font-bold text-ink">Nível de serviço por grupo e pessoa</h2><p className="text-sm text-muted">Resolvidos no prazo sobre resolvidos no período. Abaixo da meta fica em destaque.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-xs text-muted"><th className="px-3 py-2 text-left">Grupo / pessoa</th><th className="px-3 py-2 text-right">Em aberto</th><th className="px-3 py-2 text-right">No prazo</th><th className="px-3 py-2 text-right">A vencer 24 h</th><th className="px-3 py-2 text-right">Atrasados</th><th className="px-3 py-2 text-right">Resolvidos</th><th className="min-w-[200px] px-3 py-2 text-left">Nível de serviço</th></tr></thead>
                <tbody>{d.byGroup.flatMap((g) => [<SlaRow key={`g${g.groupId}`} name={g.name} l={g} goal={d.sla.goalPct} group />, ...g.people.map((p) => <SlaRow key={`g${g.groupId}-${p.userId ?? 'x'}`} name={p.name} l={p} goal={d.sla.goalPct} />)])}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
      </div>
      </TvArea>
      {config && <ConfigDrawer onClose={() => setConfig(false)} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone, href }: { label: string; value: number | string; hint: string; tone?: 'ok' | 'soon' | 'late'; href?: string }) {
  const c = tone === 'ok' ? 'border-t-[#1F7A4D] text-[#1F7A4D]' : tone === 'soon' ? 'border-t-[#B7791F] text-[#8A5A00]' : tone === 'late' ? 'border-t-danger text-danger' : 'text-ink';
  const body = <>
    <p className="text-sm text-muted">{label}</p>
    <p className={clsx('num mt-1 font-display text-3xl font-bold', c.split(' ').slice(1).join(' ') || 'text-ink')}>{value}</p>
    <p className="mt-1 text-xs text-muted">{hint}</p>
  </>;
  const cls = clsx('card block p-4', tone && 'border-t-[3px]', c.split(' ')[0]);
  return href ? <a href={href} className={clsx(cls, 'hover:border-primary')} data-testid={`kpi-${href.slice(1)}`}>{body}</a> : <div className={cls}>{body}</div>;
}

const GlpiLink = ({ url }: { url: string | null }) => (url ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 border border-primary px-3 text-sm font-semibold text-primary hover:bg-primary-soft">Abrir no GLPI<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a> : null);

function ApprovalsList({ items }: { items: Data['approvals'] }) {
  return (
    <section id="aprovacoes" aria-label="Aprovações pendentes" className="card">
      <div className="flex flex-wrap items-end justify-between gap-2 p-4 pb-2">
        <div><h2 className="text-lg font-bold text-ink">Aprovações pendentes</h2><p className="text-sm text-muted">Validações pedidas no GLPI a pessoas ou grupos do Comercial que ainda aguardam resposta.</p></div>
        <p className="num text-sm text-muted">{items.length} pedido(s)</p>
      </div>
      {!items.length ? <p className="px-4 pb-6 text-sm text-muted">Nenhuma aprovação aguardando neste filtro.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2">Chamado</th><th className="px-3 py-2">Quem aprova</th><th className="px-3 py-2">Pedido por</th><th className="px-3 py-2">Aguardando</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{items.map((a) => (
              <tr key={a.id} className="border-b border-line align-top" data-testid="approval-row">
                <td className="min-w-[260px] px-3 py-3"><p className="font-semibold text-ink">#{a.glpiId} · {a.title}</p><p className="text-xs text-muted">{a.client ?? '—'}{a.statusName ? ` · ${a.statusName}` : ''}</p></td>
                <td className="min-w-[160px] px-3 py-3"><p className="font-semibold text-ink">{a.approver}</p><p className="text-xs text-muted">{a.isGroup ? 'qualquer pessoa do grupo' : 'pessoa'}</p></td>
                <td className="px-3 py-3 text-ink">{a.requester ?? '—'}</td>
                <td className="num min-w-[150px] px-3 py-3"><p className="font-bold text-[#8A5A00]">{a.waiting ?? '—'}</p><p className="text-xs text-muted">{a.at ? fmtDateTime(a.at) : '—'}</p></td>
                <td className="whitespace-nowrap px-3 py-3"><GlpiLink url={a.glpiUrl} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MentionsList({ items }: { items: Data['mentions'] }) {
  return (
    <section id="mencoes" aria-label="Menções ao Comercial" className="card">
      <div className="flex flex-wrap items-end justify-between gap-2 p-4 pb-2">
        <div><h2 className="text-lg font-bold text-ink">Menções ao Comercial</h2><p className="text-sm text-muted">Chamados abertos em que alguém citou (@) uma pessoa do Comercial. Sem resposta primeiro.</p></div>
        <p className="num text-sm text-muted">{items.length} menção(ões)</p>
      </div>
      {!items.length ? <p className="px-4 pb-6 text-sm text-muted">Nenhuma menção em chamados abertos neste filtro.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Chamado</th><th className="px-3 py-2">Quem foi citado</th><th className="px-3 py-2">Citado por</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{items.map((m) => (
              <tr key={m.id} className={clsx('border-b border-line align-top', !m.answeredAt && 'bg-[#FFFBF2]')} data-testid="mention-row">
                <td className="whitespace-nowrap px-3 py-3"><span className={clsx('inline-block px-2 py-0.5 text-xs font-bold', m.answeredAt ? 'bg-success-soft text-[#1F6B44]' : 'border border-[#E8C27A] bg-warning-soft text-[#7A4E00]')}>{m.answeredAt ? 'Respondida' : 'Sem resposta'}</span></td>
                <td className="min-w-[260px] px-3 py-3"><p className="font-semibold text-ink">#{m.glpiId} · {m.title}</p><p className="text-xs text-muted">{m.client ?? '—'}{m.statusName ? ` · ${m.statusName}` : ''}</p></td>
                <td className="min-w-[150px] px-3 py-3"><p className="font-semibold text-ink">{m.person}</p>{m.answeredAt && <p className="text-xs text-muted">respondeu em {fmtDateTime(m.answeredAt)}</p>}</td>
                <td className="num min-w-[160px] px-3 py-3"><p className="text-ink">{m.by ?? '—'}</p><p className="text-xs text-muted">{m.at ? fmtDateTime(m.at) : '—'}</p></td>
                <td className="whitespace-nowrap px-3 py-3"><GlpiLink url={m.glpiUrl} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SlaRow({ name, l, goal, group }: { name: string; l: Line; goal: number; group?: boolean }) {
  const below = l.serviceLevel !== null && l.serviceLevel < goal;
  return (
    <tr className={clsx('border-b border-line', group && 'bg-bg')}>
      <td className={clsx('px-3 py-2.5', group ? 'font-bold text-ink' : 'pl-7', name === 'Sem responsável' && 'font-semibold text-danger')}>{name}</td>
      <td className="num px-3 py-2.5 text-right">{l.open}</td>
      <td className="num px-3 py-2.5 text-right text-[#1F7A4D]">{l.ok}</td>
      <td className="num px-3 py-2.5 text-right text-[#8A5A00]">{l.soon}</td>
      <td className={clsx('num px-3 py-2.5 text-right', l.late ? 'font-bold text-danger' : 'text-muted')}>{l.late}</td>
      <td className="num px-3 py-2.5 text-right">{l.solved}</td>
      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="relative h-2 flex-1 bg-bg"><div className={clsx('absolute inset-y-0 left-0', below ? 'bg-[#F0A202]' : 'bg-primary')} style={{ width: `${l.serviceLevel ?? 0}%` }} /><div className="absolute -top-0.5 h-3 w-0.5 bg-ink" style={{ left: `${goal}%` }} /></div><span className={clsx('num w-14 text-right font-bold', l.serviceLevel === null ? 'text-muted' : below ? 'text-[#8A5A00]' : 'text-[#1F6B44]')}>{pct(l.serviceLevel)}</span></div></td>
    </tr>
  );
}

function DaysChart({ days }: { days: Data['days'] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.opened, d.solved]));
  const step = Math.max(1, Math.ceil(days.length / 15));
  return (
    <section aria-label="Volume por dia" className="card min-w-0 flex-[1_1_520px] p-4">
      <h2 className="text-lg font-bold text-ink">Volume por dia</h2>
      <p className="mb-3 text-sm text-muted">Chamados recebidos pelos grupos e resolvidos</p>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="h-3 w-3 bg-primary" />Recebidos</span><span className="flex items-center gap-1.5"><span className="h-3 w-3 bg-[#9FD8FF]" />Resolvidos</span><span className="flex items-center gap-1.5"><span className="h-[3px] w-3 bg-danger" />Resolvidos fora do prazo</span></div>
      <div role="img" aria-label={`Recebidos e resolvidos por dia: ${days.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)} ${d.opened} recebidos, ${d.solved} resolvidos`).join('; ')}`} className="flex h-48 items-end gap-1 border-b border-line-strong">
        {days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 items-end justify-center gap-px" title={`${d.date.slice(8)}/${d.date.slice(5, 7)}: ${d.opened} recebidos, ${d.solved} resolvidos (${d.solvedLate} fora do prazo)`}>
            <div className="w-[45%] max-w-4 bg-primary" style={{ height: `${(d.opened / max) * 100}%` }} />
            <div className="relative w-[45%] max-w-4 bg-[#9FD8FF]" style={{ height: `${(d.solved / max) * 100}%` }}>{d.solvedLate > 0 && <div className="absolute inset-x-0 top-0 bg-danger" style={{ height: `${Math.max(8, (d.solvedLate / Math.max(1, d.solved)) * 100)}%` }} />}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">{days.map((d, i) => <span key={d.date} className="num flex-1 text-center text-[11px] text-muted">{i % step === 0 ? `${d.date.slice(8)}/${d.date.slice(5, 7)}` : ''}</span>)}</div>
    </section>
  );
}

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function Heat({ heat }: { heat: number[][] }) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 7);
  const max = Math.max(1, ...heat.flat());
  const shade = (v: number) => (v === 0 ? 'bg-[#EEF3F8] text-muted' : v / max >= 0.66 ? 'bg-primary text-white' : v / max >= 0.33 ? 'bg-[#7FA9D3] text-[#0F2A44]' : 'bg-[#C7DDF2] text-ink');
  const rows = [1, 2, 3, 4, 5, 6, 0].filter((w) => w !== 0 || heat[0]!.some((x) => x > 0));
  return (
    <section aria-label="Volume hora a hora" className="card min-w-0 flex-[1_1_420px] p-4">
      <h2 className="text-lg font-bold text-ink">Volume hora a hora</h2>
      <p className="mb-3 text-sm text-muted">Quando os chamados chegam (dia da semana × hora de abertura)</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] border-separate [border-spacing:3px] text-[11px]">
          <thead><tr><th className="w-10" />{hours.map((h) => <th key={h} className="num font-normal text-muted">{h}h</th>)}</tr></thead>
          <tbody>{rows.map((w) => <tr key={w}><th className="text-left font-normal text-muted">{WD[w]}</th>{hours.map((h) => <td key={h} className={clsx('num h-7 text-center font-semibold', shade(heat[w]![h]!))} title={`${WD[w]} ${h}h: ${heat[w]![h]} chamado(s)`}>{heat[w]![h]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ configuração

type Cfg = {
  enabled: boolean; rootEntityId: number; managerIds: string[]; groupLeaders: Record<string, string[]>;
  settings: { goalPct: number; slaSource: 'universal' | 'glpi'; solveHours: number; ownHours: number; businessHoursOnly: boolean; businessStart: number; businessEnd: number; businessDays: number[]; warnHours: number[]; unassignedMinutes: number; repeatLateHours: number; escalateAfterHours: number; digestHour: number; email: boolean; whatsapp: boolean };
  groups: { id: number; name: string; members: string[] }[]; people: { id: string; name: string; hasPhone: boolean }[];
  lastSyncAt: string | null; lastError: string | null;
  recent: { stage: string; channel: string; ok: boolean; error: string | null; sentAt: string; alertKey: string; userName: string }[];
};

function ConfigDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['dados-planejados', 'config'], queryFn: () => api<Cfg>('/admin/dados-planejados') });
  const [f, setF] = useState<Cfg | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data); }, [q.data, f]);
  const save = useMutation({
    mutationFn: () => api('/admin/dados-planejados', { method: 'PUT', body: { enabled: f!.enabled, rootEntityId: f!.rootEntityId, managerIds: f!.managerIds, groupLeaders: f!.groupLeaders, settings: f!.settings } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['dados-planejados'] }); toast({ tone: 'success', message: 'Configuração salva' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const set = <K extends keyof Cfg['settings']>(k: K, v: Cfg['settings'][K]) => setF((x) => (x ? { ...x, settings: { ...x.settings, [k]: v } } : x));
  const num = (v: string) => Number(v.replace(',', '.')) || 0;
  const noPhone = useMemo(() => (f ? f.people.filter((p) => !p.hasPhone).map((p) => p.name) : []), [f]);
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Drawer open onClose={onClose} title="Configurar alertas" width="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!f} onClick={() => save.mutate()}>Salvar</Button></>}>
      {!f ? <LoadingRows rows={6} /> : (
        <div className="space-y-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Monitorar os chamados do GLPI e mandar os avisos</label>

          <fieldset className="space-y-3 border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">SLA que conta o nível de serviço</legend>
            <div role="radiogroup" aria-label="Origem do SLA" className="space-y-1.5">
              {([['universal', 'SLA universal', 'O mesmo prazo para todos os grupos (abaixo).'], ['glpi', 'SLA de cada chamado no GLPI', 'Usa o prazo do GLPI; chamado sem SLA lá usa o universal.']] as const).map(([k, l, h]) => (
                <label key={k} className={clsx('flex cursor-pointer items-start gap-2 border px-3 py-2 text-sm', f.settings.slaSource === k ? 'border-primary bg-primary-soft' : 'border-line')}>
                  <input type="radio" name="sla-src" className="mt-0.5 h-4 w-4 accent-primary" checked={f.settings.slaSource === k} onChange={() => set('slaSource', k)} /><span><b className="block text-ink">{l}</b><span className="text-xs text-muted">{h}</span></span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="Horas para solucionar" htmlFor="sla-solve"><Input id="sla-solve" inputMode="decimal" value={String(f.settings.solveHours)} onChange={(e) => set('solveHours', num(e.target.value))} /></FormField>
              <FormField label="Horas para assumir" htmlFor="sla-own"><Input id="sla-own" inputMode="decimal" value={String(f.settings.ownHours)} onChange={(e) => set('ownHours', num(e.target.value))} /></FormField>
              <FormField label="Meta do nível de serviço (%)" htmlFor="sla-goal"><Input id="sla-goal" inputMode="decimal" value={String(f.settings.goalPct)} onChange={(e) => set('goalPct', num(e.target.value))} /></FormField>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.settings.businessHoursOnly} onChange={(e) => set('businessHoursOnly', e.target.checked)} />Contar só horas úteis (horário comercial abaixo)</label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormField label="Início do expediente" htmlFor="sla-bs"><Input id="sla-bs" type="number" min={0} max={23} value={f.settings.businessStart} onChange={(e) => set('businessStart', num(e.target.value))} /></FormField>
              <FormField label="Fim do expediente" htmlFor="sla-be"><Input id="sla-be" type="number" min={1} max={24} value={f.settings.businessEnd} onChange={(e) => set('businessEnd', num(e.target.value))} /></FormField>
            </div>
            <div role="group" aria-label="Dias úteis" className="flex flex-wrap gap-1.5">{WD.map((w, i) => <button key={w} type="button" aria-pressed={f.settings.businessDays.includes(i)} className={pill(f.settings.businessDays.includes(i))} onClick={() => set('businessDays', f.settings.businessDays.includes(i) ? f.settings.businessDays.filter((x) => x !== i) : [...f.settings.businessDays, i].sort())}>{w}</button>)}</div>
          </fieldset>

          <fieldset className="space-y-3 border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">Régua de avisos</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Avisar antes do prazo (horas, separadas por vírgula)" htmlFor="sla-warn"><Input id="sla-warn" value={f.settings.warnHours.join(', ')} onChange={(e) => set('warnHours', e.target.value.split(/[;,\s]+/).map(num).filter((x) => x > 0).slice(0, 4))} /></FormField>
              <FormField label="Sem responsável após (minutos)" htmlFor="sla-un"><Input id="sla-un" inputMode="numeric" value={String(f.settings.unassignedMinutes)} onChange={(e) => set('unassignedMinutes', Math.round(num(e.target.value)))} /></FormField>
              <FormField label="Vencido: repetir a cada (horas)" htmlFor="sla-rep"><Input id="sla-rep" inputMode="decimal" value={String(f.settings.repeatLateHours)} onChange={(e) => set('repeatLateHours', num(e.target.value))} /></FormField>
              <FormField label="Escalar para a gestão após vencer (horas)" htmlFor="sla-esc"><Input id="sla-esc" inputMode="decimal" value={String(f.settings.escalateAfterHours)} onChange={(e) => set('escalateAfterHours', num(e.target.value))} /></FormField>
              <FormField label="Resumo diário às (hora)" htmlFor="sla-dig"><Input id="sla-dig" type="number" min={0} max={23} value={f.settings.digestHour} onChange={(e) => set('digestHour', Math.round(num(e.target.value)))} /></FormField>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.settings.email} onChange={(e) => set('email', e.target.checked)} />E-mail (SMTP)</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.settings.whatsapp} onChange={(e) => set('whatsapp', e.target.checked)} />WhatsApp (Z-API)</label>
            </div>
            {f.settings.whatsapp && !!noPhone.length && <Notice tone="warning">Sem WhatsApp no cadastro: {noPhone.join(', ')}. Elas recebem só por e-mail.</Notice>}
            <p className="text-xs text-muted">Quem recebe: chegou e a vencer → responsável (sem responsável, todos do grupo); sem responsável → líder do grupo; vencido → responsável e líder; escalado → gestão. Fora do horário comercial só o escalonamento sai.</p>
          </fieldset>

          <fieldset className="space-y-3 border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">Líderes dos grupos</legend>
            {!f.groups.length ? <p className="text-sm text-muted">Nenhum grupo ainda. Em <Link className="font-semibold text-primary hover:underline" to="/settings/users">Usuários</Link>, informe os grupos do GLPI de cada pessoa.</p> : f.groups.map((g) => (
              <div key={g.id}>
                <p className="text-sm font-semibold text-ink">{g.name} <span className="font-normal text-muted">· {g.members.join(', ')}</span></p>
                <div className="mt-1 flex flex-wrap gap-1.5">{f.people.map((p) => { const on = (f.groupLeaders[String(g.id)] ?? []).includes(p.id); return <label key={p.id} className={clsx('flex cursor-pointer items-center gap-1.5 border px-2 py-1 text-sm', on ? 'border-primary bg-primary-soft' : 'border-line')}><input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={on} onChange={() => setF({ ...f, groupLeaders: { ...f.groupLeaders, [String(g.id)]: toggleIn(f.groupLeaders[String(g.id)] ?? [], p.id) } })} />{p.name}</label>; })}</div>
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-2 border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">Gestão (escalonamento e resumo geral)</legend>
            <ManagerPicker value={f.managerIds} onChange={(v) => setF({ ...f, managerIds: v })} />
          </fieldset>

          <FormField label="Entidade raiz no GLPI (lê ela e as subentidades)" htmlFor="sla-ent" hint="0 = entidade raiz"><Input id="sla-ent" inputMode="numeric" value={String(f.rootEntityId)} onChange={(e) => setF({ ...f, rootEntityId: Math.max(0, Math.round(num(e.target.value))) })} /></FormField>

          {!!q.data?.recent.length && (
            <section aria-label="Últimos avisos">
              <p className="mb-1 text-sm font-bold text-ink">Últimos avisos</p>
              <ul className="divide-y divide-line border border-line text-xs">{q.data.recent.slice(0, 12).map((a, i) => <li key={i} className="flex flex-wrap gap-2 px-2 py-1.5"><span className="num text-muted">{fmtDateTime(a.sentAt)}</span><span className="text-ink">{STAGE[a.stage] ?? a.stage} · {a.alertKey.split(':')[0]}</span><span>{a.channel === 'email' ? 'E-mail' : 'WhatsApp'} para {a.userName}</span>{a.ok ? <span className="text-[#1F6B44]">enviado</span> : <span className="text-danger">falhou{a.error ? `: ${a.error}` : ''}</span>}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ManagerPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const lk = useQuery({ queryKey: ['lookups'], queryFn: () => api<{ users: { id: string; name: string }[] }>('/meta/lookups'), staleTime: 600_000 });
  return <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">{(lk.data?.users ?? []).map((u) => { const on = value.includes(u.id); return <label key={u.id} className={clsx('flex cursor-pointer items-center gap-1.5 border px-2 py-1 text-sm', on ? 'border-primary bg-primary-soft' : 'border-line')}><input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])} />{u.name}</label>; })}</div>;
}
