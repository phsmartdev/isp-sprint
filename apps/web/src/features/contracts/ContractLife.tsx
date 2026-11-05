/**
 * Resumo da vida do contrato (gaveta): onde ele está na vigência, os marcos realizados e previstos,
 * como o valor mensal evoluiu, o que está em andamento agora e os próximos prazos.
 * Abre de qualquer lista do Painel e da Lista de contratos; a ficha completa continua em /contracts/:id.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { CONTRACT_STAGE_LABELS, ERP_STATUS_LABELS, PROCESS_LABELS, processSteps, termProgress, type ErpStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, fmtPct } from '../../lib/format';
import { Chip, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { Drawer } from '../../components/ui/overlay';
import { DaysLeft, StageChip, TypeChip, type ContractDetail } from './shared';

type Timeline = { items: { id: string; at: string; title: string; sub: string; critical: boolean }[]; upcoming: { kind: string; on: string; title: string; days: number }[]; today: string };
type Erp = { current: { status: ErpStatus; seq: number } | null };
type Mark = { on: string; label: string; real: boolean; tone?: 'risk' };

const CHANGE_LABEL: Record<string, string> = { cadastro: 'Cadastro', edicao: 'Edição', ativacao: 'Ativação', renovacao: 'Renovação', reajuste: 'Reajuste', encerramento: 'Encerramento', aditivo: 'Aditivo' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Marcos da vida: o que já aconteceu (data real) e o que está previsto, sem inventar datas. */
function marksOf(c: ContractDetail, t: string): Mark[] {
  const v = c.current;
  const first = [...c.versions].sort((a, b) => a.version - b.version)[0] ?? v;
  const m: Mark[] = [];
  const add = (on: string | null | undefined, label: string, real: boolean, tone?: 'risk') => { if (on) m.push({ on: on.slice(0, 10), label, real, tone }); };
  add(first.signedAt, 'Assinatura', true);
  add(first.startAt, 'Início da vigência', first.startAt! <= t);
  add(v.activationAt, 'Ativação técnica', true);
  add(v.billingStartAt, 'Início do faturamento', true);
  for (const x of c.versions) if (['reajuste', 'aditivo', 'renovacao'].includes(x.changeKind)) add(x.effectiveFrom ?? x.createdAt, `${CHANGE_LABEL[x.changeKind]} (versão ${x.version})`, true);
  for (const p of c.processes) if (p.status === 'concluido' && p.closedAt && p.kind !== 'implantacao') add(p.closedAt, `${PROCESS_LABELS[p.kind]}: processo concluído`, true);
  if (c.validatedAt) add(c.validatedAt, 'Cadastro validado', true);
  add(v.endAt, c.closureExpected ? 'Término (encerramento previsto)' : 'Término da vigência', !!v.endAt && v.endAt < t, c.closureExpected || (!!c.daysLeft && c.daysLeft <= 90 && !c.renewed) ? 'risk' : undefined);
  if (v.renewalAt && v.renewalAt !== v.endAt) add(v.renewalAt, 'Renovação prevista', false);
  if (c.legalLimitAt) add(c.legalLimitAt, 'Limite legal da vigência', false);
  if (c.closedAt) add(c.closedAt, 'Encerrado', true);
  return m.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}

/** Degraus do valor mensal ao longo das versões (só quando o valor mudou). */
function valueSteps(c: ContractDetail) {
  const vs = [...c.versions].sort((a, b) => a.version - b.version);
  const out: { on: string; label: string; cents: number; delta: number | null }[] = [];
  for (const x of vs) {
    const prev = out.at(-1);
    if (prev && prev.cents === x.monthlyCents) continue;
    out.push({ on: ((prev ? x.effectiveFrom ?? x.createdAt : x.startAt ?? x.signedAt ?? x.createdAt) ?? '').slice(0, 10), label: `${CHANGE_LABEL[x.changeKind] ?? x.changeKind} · v${x.version}`, cents: x.monthlyCents, delta: prev && prev.cents ? (x.monthlyCents - prev.cents) / prev.cents : null });
  }
  return out;
}

function ValueSpark({ steps }: { steps: { cents: number }[] }) {
  if (steps.length < 2) return null;
  const W = 280, H = 56, max = Math.max(...steps.map((s) => s.cents)), min = Math.min(...steps.map((s) => s.cents));
  const y = (c: number) => (max === min ? H / 2 : H - 6 - ((c - min) / (max - min)) * (H - 12));
  const x = (i: number) => (i / (steps.length - 1)) * (W - 8) + 4;
  const d = steps.map((s, i) => `${i ? `H${x(i)}V${y(s.cents)}` : `M${x(0)} ${y(s.cents)}`}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label="Evolução do valor mensal">
      <path d={d} fill="none" stroke="#2F5986" strokeWidth="2" />
      {steps.map((s, i) => <circle key={i} cx={x(i)} cy={y(s.cents)} r="4" fill="#2F5986" stroke="var(--color-surface, #fff)" strokeWidth="2" />)}
    </svg>
  );
}

export function ContractLifeDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api<ContractDetail>(`/contracts/${id}`), enabled: !!id });
  const tl = useQuery({ queryKey: ['contract-timeline', id, 'life'], queryFn: () => api<Timeline>(`/contracts/${id}/timeline`), enabled: !!id });
  const erp = useQuery({ queryKey: ['contract', id, 'erp'], queryFn: () => api<Erp>(`/contracts/${id}/erp`), enabled: !!id && q.data?.stage !== 'cadastro_validacao' });
  const c = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={c ? `Vida do contrato ${c.current.number}` : 'Vida do contrato'} width="lg"
      footer={c ? <Link to={`/contracts/${c.id}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">Abrir a ficha completa<ArrowUpRight className="h-4 w-4" /></Link> : undefined}>
      {q.isLoading ? <LoadingRows rows={8} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : c ? <Life c={c} tl={tl.data} erp={erp.data} /> : null}
    </Drawer>
  );
}

function Life({ c, tl, erp }: { c: ContractDetail; tl?: Timeline; erp?: Erp }) {
  const t = today();
  const v = c.current;
  const prog = termProgress(v.startAt, v.endAt, t);
  const marks = marksOf(c, t);
  const steps = valueSteps(c);
  const open = c.processes.filter((p) => p.status === 'aberto');
  const alerts = c.alerts.filter((a) => a.status === 'aberto');
  const firstFuture = marks.findIndex((m) => m.on > t);
  return (
    <div className="space-y-5">
      <header>
        <p className="text-lg font-bold text-ink">{c.contact.name}</p>
        <p className="text-sm text-muted">CT-{c.code} · {v.object}</p>
        <div className="mt-2 flex flex-wrap gap-2"><StageChip stage={c.stage} /><TypeChip type={c.billingType} />{c.renewed && <Chip tone="green">Renovado</Chip>}{c.closureExpected && <Chip tone="red">Encerramento previsto</Chip>}</div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Valor mensal', <span key="m" className="num font-bold">{fmtBRL(v.monthlyCents)}</span>],
          ['Valor global', <span key="g" className="num">{fmtBRL(v.totalCents)}</span>],
          ['Responsável', c.commercialOwnerName ?? '—'],
          ['Resp. administrativo', c.adminOwnerName ?? 'Em aberto'],
        ].map(([l, val]) => <div key={l as string} className="min-w-0 border border-line p-2.5"><dt className="text-xs text-muted">{l}</dt><dd className="truncate text-sm text-ink">{val}</dd></div>)}
      </dl>

      {/* vigência: quanto já passou e quanto falta */}
      <section aria-label="Vigência">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-bold text-ink">Vigência</span>
          <span className="text-muted">{fmtDate(v.startAt)} a {fmtDate(v.endAt)} · <DaysLeft days={c.daysLeft} archived={c.stage === 'arquivado'} /></span>
        </div>
        {prog == null ? <p className="text-sm text-muted">Sem datas de vigência.</p> : (
          <>
            <div className="relative h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${fmtPct(prog)} da vigência decorrida`}>
              <div className={clsx('h-full rounded-full', c.daysLeft != null && c.daysLeft <= 90 && !c.renewed ? 'bg-danger' : 'bg-primary')} style={{ width: `${prog * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">{fmtPct(prog)} da vigência decorrida{v.termMonths ? ` · prazo de ${v.termMonths} meses` : ''}</p>
          </>
        )}
      </section>

      {/* linha da vida: realizado (●) e previsto (○), com o hoje no meio */}
      <section aria-label="Linha da vida">
        <h3 className="mb-2 font-bold text-ink">Linha da vida</h3>
        <ol className="relative ml-2 border-l border-line">
          {marks.map((m, i) => (
            <li key={`${m.on}-${m.label}`} className="relative pb-3 pl-5">
              {i === firstFuture && <div className="-ml-5 mb-3 flex items-center gap-2 text-xs font-semibold text-primary"><span className="h-px flex-1 bg-primary" />hoje · {fmtDate(t)}<span className="h-px flex-1 bg-primary" /></div>}
              <span className={clsx('absolute -left-[7px] top-1 h-3.5 w-3.5 rounded-full border-2', m.real ? 'border-primary bg-primary' : m.tone === 'risk' ? 'border-danger bg-surface' : 'border-primary bg-surface')} aria-hidden />
              <p className={clsx('text-sm', m.tone === 'risk' ? 'font-semibold text-danger' : 'text-ink')}>{m.label}</p>
              <p className="text-xs text-muted">{fmtDate(m.on)} · {m.real ? 'realizado' : 'previsto'}</p>
            </li>
          ))}
          {firstFuture === -1 && <li className="pl-5 text-xs font-semibold text-primary">hoje · {fmtDate(t)}</li>}
        </ol>
      </section>

      <section aria-label="Valor mensal">
        <h3 className="mb-1 font-bold text-ink">Evolução do valor mensal</h3>
        <ValueSpark steps={steps} />
        <ul className="divide-y divide-line text-sm">{steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5"><span className="text-text">{fmtDate(s.on)} · {s.label}</span><span className="num font-semibold text-ink">{fmtBRL(s.cents)}{s.delta != null && <span className={clsx('ml-2 text-xs', s.delta >= 0 ? 'text-success' : 'text-danger')}>{s.delta >= 0 ? '+' : ''}{fmtPct(s.delta)}</span>}</span></li>
        ))}</ul>
      </section>

      <section aria-label="Situação agora" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border border-line p-3">
          <h3 className="mb-1 text-sm font-bold text-ink">Em andamento</h3>
          {!open.length ? <p className="text-sm text-muted">Nenhum processo aberto.</p> : <ul className="space-y-1 text-sm">{open.map((p) => { const defs = processSteps(p.kind, c.kind); const done = defs.filter((d) => p.steps[d.key]).length; return <li key={p.id}>{PROCESS_LABELS[p.kind]} <span className="text-muted">· {done}/{defs.length} etapas{p.dueAt ? ` · prazo ${fmtDate(p.dueAt)}` : ''}</span></li>; })}</ul>}
          <p className="mt-2 text-sm">Cadastro ERP: <span className="font-semibold">{erp?.current ? ERP_STATUS_LABELS[erp.current.status] : c.stage === 'cadastro_validacao' ? 'após a validação' : 'não iniciado'}</span></p>
        </div>
        <div className="border border-line p-3">
          <h3 className="mb-1 text-sm font-bold text-ink">Atenção</h3>
          {!alerts.length ? <p className="text-sm text-muted">Nenhuma notificação aberta.</p> : <ul className="space-y-1 text-sm">{alerts.slice(0, 5).map((a) => <li key={a.id} className={clsx(a.dueAt && a.dueAt < t && 'text-danger')}>{a.label}{a.dueAt ? <span className="text-muted"> · {fmtDate(a.dueAt)}</span> : null}</li>)}</ul>}
          {c.nextAction && <p className="mt-2 text-sm">Próxima ação: <span className="font-semibold">{c.nextAction}</span>{c.nextActionAt ? ` · ${fmtDate(c.nextActionAt)}` : ''}</p>}
        </div>
      </section>

      {tl && tl.upcoming.length > 0 && (
        <section aria-label="Próximos prazos">
          <h3 className="mb-1 font-bold text-ink">Próximos prazos</h3>
          <ul className="divide-y divide-line text-sm">{tl.upcoming.slice(0, 6).map((u, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{u.title}</span><span className={clsx('num shrink-0', u.days < 0 ? 'text-danger' : u.days <= 30 ? 'text-[#C2610C]' : 'text-muted')}>{fmtDate(u.on)}</span></li>)}</ul>
        </section>
      )}
      {tl && tl.items.length > 0 && (
        <section aria-label="Últimos acontecimentos">
          <h3 className="mb-1 font-bold text-ink">Últimos acontecimentos</h3>
          <ul className="space-y-2 text-sm">{tl.items.slice(0, 6).map((it) => <li key={it.id}><p className={clsx(it.critical ? 'font-semibold text-danger' : 'text-ink')}>{it.title}</p><p className="text-xs text-muted">{fmtDateTime(it.at)}{it.sub ? ` · ${it.sub}` : ''}</p></li>)}</ul>
        </section>
      )}
      <p className="text-xs text-muted">Etapa atual: {CONTRACT_STAGE_LABELS[c.stage]} desde {fmtDate(c.stageChangedAt ?? null)}.</p>
    </div>
  );
}
