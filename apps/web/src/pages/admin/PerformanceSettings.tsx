/** Configurações → Gestão de desempenho: eventos de negócio (catálogo, atribuição, validação, reprocessar) e exploração dos eventos. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { EVENT_MODULE_LABELS, validatePerformanceConfig, type AttributionRule, type PerformanceConfig } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Tabs } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { EventsExplorer } from '../../features/performance/EventsExplorer';
import { useUrlState } from '../../lib/hooks';

type Catalog = {
  types: { key: string; label: string; module: keyof typeof EVENT_MODULE_LABELS; source: string; owner: string; counts: Record<'valido' | 'pendente' | 'invalidado', number>; rule: AttributionRule; validationRequired: boolean }[];
  unavailable: { key: string; label: string; reason: string }[];
  lastSync: { at: string; stats: { created?: number; invalidated?: number; ms?: number } } | null;
  settingsVersion: number;
};
type Settings = { version: number; config: PerformanceConfig; history: { version: number; note: string | null; createdAt: string; by: string | null }[] };

export function AdminPerformanceSettings() {
  const [u, setU] = useUrlState({ t: 'eventos' });
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Gestão de desempenho</h1><p className="text-sm text-muted">Os resultados são medidos por fatos já registrados no sistema, nunca por cliques ou tempo conectado.</p></div>
      <Tabs label="Gestão de desempenho" value={u.t as 'eventos' | 'explorar'} onChange={(t) => setU({ t })} tabs={[{ key: 'eventos', label: 'Eventos de negócio' }, { key: 'explorar', label: 'Explorar eventos' }]} />
      {u.t === 'eventos' ? <EventsConfig /> : <EventsExplorer />}
    </div>
  );
}

function EventsConfig() {
  const toast = useToast();
  const qc = useQueryClient();
  const cat = useQuery({ queryKey: ['performance', 'catalog'], queryFn: () => api<Catalog>('/performance/catalog') });
  const st = useQuery({ queryKey: ['performance', 'settings'], queryFn: () => api<Settings>('/performance/settings') });
  const [cfg, setCfg] = useState<PerformanceConfig | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (st.data) setCfg(structuredClone(st.data.config)); }, [st.data]);
  const sync = useMutation({
    mutationFn: () => api<{ created: number; invalidated: number; ms: number }>('/performance/sync', { method: 'POST' }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['performance'] }); toast({ tone: 'success', message: `Reprocessado: ${r.created} evento(s) novo(s), ${r.invalidated} invalidado(s).` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: () => api<{ version: number }>('/performance/settings', { method: 'PUT', body: { config: cfg, note } }),
    onSuccess: (r) => { setNote(''); void qc.invalidateQueries({ queryKey: ['performance'] }); toast({ tone: 'success', message: `Versão ${r.version} em vigor para os próximos eventos.` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (cat.isLoading || st.isLoading || !cfg) return <div className="card"><LoadingRows rows={6} /></div>;
  if (cat.isError) return <ErrorState error={cat.error} onRetry={() => cat.refetch()} />;
  const c = cat.data!;
  const rule = (k: string) => cfg.attribution[k] ?? { ownerShareBp: 10_000, participants: true, managers: true };
  const setRule = (k: string, p: Partial<AttributionRule>) => setCfg({ ...cfg, attribution: { ...cfg.attribution, [k]: { ...rule(k), ...p } } });
  const errs = validatePerformanceConfig(cfg);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(st.data!.config);
  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">{c.lastSync ? <>Última atualização: <span className="num font-semibold text-ink">{fmtDateTime(c.lastSync.at)}</span> · regra vigente v{st.data!.version || 'padrão'}.</> : 'Os eventos ainda não foram processados.'} <span className="text-muted">O processamento roda sozinho antes das telas de desempenho e na rotina diária.</span></p>
        <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>Reprocessar histórico</Button>
      </section>
      <section className="card overflow-hidden">
        <div className="p-4"><h2 className="text-lg font-bold text-ink">Eventos e regras de atribuição</h2><p className="text-sm text-muted">Parte do responsável: o restante do resultado é dividido igualmente entre os participantes. Sem participantes, fica 100% com o responsável. Mudanças valem para eventos novos; os já registrados guardam a regra da época.</p></div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Evento', 'Origem e responsável', 'Registrados', 'Parte do responsável', 'Participação', 'Gestão', 'Exige validação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {c.types.map((t) => {
                const r = rule(t.key);
                return (
                  <tr key={t.key} className="border-t border-line align-top">
                    <td className="px-3 py-2.5"><span className="font-semibold text-ink">{t.label}</span><span className="block text-xs text-muted">{EVENT_MODULE_LABELS[t.module]}</span></td>
                    <td className="max-w-[300px] px-3 py-2.5 text-xs">{t.source}<span className="block text-muted">Responsável: {t.owner}</span></td>
                    <td className="num px-3 py-2.5 text-xs">{t.counts.valido} válidos{t.counts.pendente ? ` · ${t.counts.pendente} pendentes` : ''}{t.counts.invalidado ? ` · ${t.counts.invalidado} invalidados` : ''}</td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-1"><Input aria-label={`Parte do responsável em ${t.label}`} className="w-20" inputMode="numeric" value={String(r.ownerShareBp / 100)} onChange={(e) => setRule(t.key, { ownerShareBp: Math.round(Number(e.target.value.replace(',', '.') || 0) * 100) })} />%</span></td>
                    <td className="px-3 py-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Participantes recebem reconhecimento em ${t.label}`} checked={r.participants} onChange={(e) => setRule(t.key, { participants: e.target.checked })} /></td>
                    <td className="px-3 py-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Líderes recebem crédito de gestão em ${t.label}`} checked={r.managers} onChange={(e) => setRule(t.key, { managers: e.target.checked })} /></td>
                    <td className="px-3 py-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${t.label} exige validação`} checked={cfg.validationRequired.includes(t.key)} onChange={(e) => setCfg({ ...cfg, validationRequired: e.target.checked ? [...cfg.validationRequired, t.key] : cfg.validationRequired.filter((x) => x !== t.key) })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!!errs.length && <div className="p-4"><Notice tone="warning">{errs.join(' ')}</Notice></div>}
        {dirty && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
            <FormField label="O que mudou" htmlFor="pf-note" className="min-w-[280px] flex-1"><Input id="pf-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
            <Button variant="secondary" onClick={() => setCfg(structuredClone(st.data!.config))}>Descartar</Button>
            <Button variant="primary" disabled={!!errs.length || note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Salvar nova versão</Button>
          </div>
        )}
      </section>
      <section className="card p-4">
        <h2 className="text-lg font-bold text-ink">Sem fonte confiável hoje</h2>
        <p className="mb-2 text-sm text-muted">Estes fatos foram pedidos, mas o sistema ainda não registra a informação de forma confiável. Ficam indisponíveis; nada é estimado.</p>
        <ul className="space-y-1.5 text-sm">{c.unavailable.map((x) => <li key={x.key} className="flex flex-wrap gap-2"><Chip tone="neutral">Indisponível</Chip><span className="font-semibold text-ink">{x.label}</span><span className="text-muted">{x.reason}</span></li>)}</ul>
      </section>
      {!!st.data!.history.length && (
        <section className="card p-4">
          <h2 className="mb-2 text-lg font-bold text-ink">Versões</h2>
          <ul className="space-y-1 text-sm">{st.data!.history.map((h) => <li key={h.version}><span className="font-semibold text-ink">v{h.version}</span> · {fmtDateTime(h.createdAt)} · {h.by ?? '—'} — {h.note}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
