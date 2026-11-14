/**
 * Visualização da jornada do cliente em montanha (só consulta): carrega os dados REAIS da conta (visão 360° e
 * /cs/accounts/:id/jornada-3d) e mostra a montanha para o cliente; logo abaixo, um painel só para o CSM (não vai para
 * a apresentação em tela cheia). A página de teste usa dados fictícios e nunca grava nada.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { DEFAULT_CS_CONFIG } from '@isp/domain';
import { api } from '../../../lib/api';
import { fmtDate } from '../../../lib/format';
import { ErrorState, LoadingRows } from '../../../components/ui/primitives';
import { JourneyMountain } from './Mountain';
import { DEMO_SCENARIOS, adapt, demoModel, healthState, HEALTH_TEXT, type JModel } from './model';

const NA = 'Dado não disponível';
const TONE = { saudavel: 'text-success', atencao: 'text-warning', risco: 'text-danger', sem_dados: 'text-muted' } as const;

function Item({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return <div className="min-w-0 border-l border-line px-4 py-2.5 first:border-l-0"><p className="truncate text-xs text-muted">{k}</p><p className={clsx('mt-0.5 truncate text-sm font-semibold', tone ?? 'text-ink')}>{v}</p></div>;
}

/** Painel interno do CSM: saúde, riscos e pendências (fica fora da apresentação ao cliente). */
export function CsmPanel({ model }: { model: JModel }) {
  const hs = healthState(model.health.score);
  const late = model.tasks.filter((t) => t.late);
  const renewalNear = model.account.daysToEnd !== null && model.account.daysToEnd >= 0 && model.account.daysToEnd <= DEFAULT_CS_CONFIG.alerts.renewalDays;
  return (
    <section className="border border-line bg-white" aria-label="Painel do CSM">
      <p className="border-b border-line bg-surface-2 px-4 py-2 text-xs text-muted">Para o CSM · não aparece na apresentação</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
        <Item k="Health Score" v={model.health.score !== null ? `${model.health.score} · ${HEALTH_TEXT[hs]}` : NA} tone={TONE[hs]} />
        <Item k="NPS" v={model.nps ? `${model.nps.score}/${model.nps.scale}` : NA} tone={model.nps ? undefined : 'text-muted'} />
        <Item k="Riscos abertos" v={model.risks.length} tone={model.risks.length ? 'text-danger' : undefined} />
        <Item k="Tarefas pendentes" v={`${model.tasks.length}${late.length ? ` · ${late.length} atrasada${late.length > 1 ? 's' : ''}` : ''}`} tone={late.length ? 'text-warning' : undefined} />
        <Item k="Próxima interação" v={model.nextInteraction ? `${fmtDate(model.nextInteraction.at)} · ${model.nextInteraction.title}` : NA} />
        <Item k="Fim da vigência" v={model.account.renewalAt ? `${fmtDate(model.account.renewalAt)}${model.account.daysToEnd !== null ? ` · ${model.account.daysToEnd} dias` : ''}` : NA} tone={renewalNear ? 'text-warning' : model.account.renewalAt ? undefined : 'text-muted'} />
        <Item k="CSM" v={model.account.csm ?? NA} tone={model.account.csm ? undefined : 'text-muted'} />
      </div>
      {(model.risks.length > 0 || late.length > 0) && (
        <div className="grid gap-4 border-t border-line px-4 py-3 text-sm md:grid-cols-2">
          {model.risks.length > 0 && <div><p className="font-semibold text-ink">Riscos</p><ul className="mt-1 space-y-0.5">{model.risks.map((r, i) => <li key={i} className={r.level === 'risco' ? 'text-danger' : 'text-warning'}>{r.title} <span className="text-muted">· {r.source}</span></li>)}</ul></div>}
          {late.length > 0 && <div><p className="font-semibold text-ink">Atrasadas</p><ul className="mt-1 space-y-0.5 text-text">{late.slice(0, 5).map((t, i) => <li key={i}>{t.title}{t.at ? ` · ${fmtDate(t.at)}` : ''}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}

export function JourneyViewAccount({ contactId }: { contactId: string }) {
  const a = useQuery({ queryKey: ['cs-account', contactId], queryFn: () => api<Parameters<typeof adapt>[0]>(`/cs/accounts/${contactId}`) });
  const j = useQuery({ queryKey: ['cs-journey-view', contactId], queryFn: () => api<Parameters<typeof adapt>[1]>(`/cs/accounts/${contactId}/jornada-3d`) });
  if (a.isLoading || j.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (a.isError || j.isError) return <ErrorState error={a.error ?? j.error} onRetry={() => { void a.refetch(); void j.refetch(); }} />;
  const m = adapt(a.data!, j.data!);
  return <div className="space-y-4"><div className="border border-line"><JourneyMountain model={m} /></div><CsmPanel model={m} /></div>;
}

/** Página de teste: conta fictícia com três situações (nada é gravado). */
export function JourneyViewDemoPage() {
  const [k, setK] = useState<(typeof DEMO_SCENARIOS)[number]['key']>('ongoing_risco');
  const m = demoModel(k);
  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-muted"><Link className="text-primary hover:underline" to="/sucesso">Sucesso do Cliente</Link> / Jornada do cliente (teste)</p><h1 className="text-2xl font-bold text-ink">Jornada do cliente · demonstração</h1></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Situação de demonstração">
          {DEMO_SCENARIOS.map((s) => <button key={s.key} type="button" aria-pressed={k === s.key} onClick={() => setK(s.key)} className={clsx('border px-3 py-1.5 text-sm font-semibold', k === s.key ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink hover:bg-surface-2')}>{s.label}</button>)}
        </div>
      </div>
      <p className="border border-line bg-surface-2 px-4 py-2 text-sm text-muted">Ambiente demonstrativo — dados fictícios. Nada aqui é gravado.</p>
      <div className="border border-line"><JourneyMountain key={k} model={m} /></div>
      <CsmPanel model={m} />
    </div>
  );
}
