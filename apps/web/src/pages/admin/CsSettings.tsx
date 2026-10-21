/** Configurações → Sucesso do Cliente: gatilho, modelos de jornada, Tier, IPC, saúde, criticidade, cadência, cobertura, alertas e capacidade. Versionado. */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  BILLING_TYPES, BILLING_TYPE_LABELS, CRIT_FACTORS, CRIT_LABELS, CS_ACTIVITY_KINDS, CS_ACTIVITY_LABELS, CS_ALERT_KEYS, CS_LEVELS, CS_LEVEL_LABELS, HEALTH_FACTORS, HEALTH_LABELS, IPC_CRITERIA, IPC_LABELS,
  JOURNEY_PHASES, JOURNEY_PHASE_LABELS, PRECEDENCE, PRECEDENCE_LABELS, TIERS, TIER_LABELS, validateCsConfig, type CsConfig, type CsLevel, type Tier,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Resp = { config: CsConfig; version: number; history: { version: number; note: string; createdAt: string; by: string | null }[]; pipelines: { id: string; key: string; name: string; stages: { key: string; name: string }[] }[]; users: { id: string; name: string }[]; canEdit: boolean };
const Sec = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => <section className="card space-y-3 p-5"><div><h2 className="text-lg font-bold text-ink">{title}</h2>{hint && <p className="text-sm text-muted">{hint}</p>}</div>{children}</section>;
const Num = ({ id, label, value, onChange, step, min }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) => <FormField label={label} htmlFor={id}><Input id={id} type="number" step={step ?? 1} min={min ?? 0} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} /></FormField>;
const opt = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : v);

export function AdminCsSettings() {
  const q = useQuery({ queryKey: ['cs-config'], queryFn: () => api<Resp>('/cs/config') });
  const qc = useQueryClient();
  const toast = useToast();
  const [c, setC] = useState<CsConfig | null>(null);
  const [note, setNote] = useState('');
  const [tpl, setTpl] = useState(0);
  useEffect(() => { if (q.data) setC(structuredClone(q.data.config)); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/cs/config', { method: 'POST', body: { config: c, note } }),
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: ['cs-config'] }); toast({ tone: 'success', message: 'Nova versão das regras em vigor. As contas foram recalculadas.' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !c) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const set = (p: Partial<CsConfig>) => setC({ ...c, ...p });
  const errs = validateCsConfig(c);
  const pipe = d.pipelines.find((p) => p.key === c.trigger.pipelineKey);
  const T = c.journeyTemplates[tpl];
  const setT = (p: Partial<typeof T>) => set({ journeyTemplates: c.journeyTemplates.map((x, i) => (i === tpl ? { ...x, ...p } as typeof x : x)) });
  const reais = (cents: number) => Math.round(cents / 100);
  return (
    <div className="space-y-4">
      <section className="card p-5"><h2 className="text-lg font-bold text-ink">Sucesso do Cliente</h2><p className="text-sm text-muted">Regras versionadas: cada gravação cria a versão {d.version + 1}. Cálculos e apurações antigos guardam a versão usada. Vigente: v{d.version || 'padrão'}.</p></section>

      <Sec title="Gatilho da jornada" hint="Quando uma negociação entrar nesta etapa, a jornada começa (uma vez por contrato).">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormField label="Funil" htmlFor="cs-tr-p"><Select id="cs-tr-p" value={c.trigger.pipelineKey} onChange={(e) => set({ trigger: { ...c.trigger, pipelineKey: e.target.value } })}>{d.pipelines.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}{!pipe && <option value={c.trigger.pipelineKey}>Sucesso do Cliente (criado na primeira validação de contrato)</option>}</Select></FormField>
          <FormField label="Etapa" htmlFor="cs-tr-s"><Select id="cs-tr-s" value={c.trigger.stageKey} onChange={(e) => set({ trigger: { ...c.trigger, stageKey: e.target.value } })}>{(pipe?.stages ?? [{ key: 'planejamento', name: 'Planejamento' }]).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></FormField>
          <FormField label="CSM padrão" htmlFor="cs-tr-csm" hint="Usado quando o contrato não tem CSM e a conta ainda não tem."><Select id="cs-tr-csm" value={c.trigger.defaultCsmId ?? ''} onChange={(e) => set({ trigger: { ...c.trigger, defaultCsmId: opt(e.target.value) as string | null } })}><option value="">Primeiro usuário do setor Sucesso do Cliente</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Tipo de cliente" htmlFor="cs-tr-ct"><Select id="cs-tr-ct" value={c.trigger.customerType} onChange={(e) => set({ trigger: { ...c.trigger, customerType: e.target.value as CsConfig['trigger']['customerType'] } })}><option value="todos">Novos e da base</option><option value="novo">Só clientes novos</option><option value="base">Só clientes da base</option></Select></FormField>
          <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Tipos de contrato (vazio = todos)</legend><div className="flex flex-wrap gap-3">{BILLING_TYPES.map((b) => <label key={b} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={c.trigger.billingTypes.includes(b)} onChange={(e) => set({ trigger: { ...c.trigger, billingTypes: e.target.checked ? [...c.trigger.billingTypes, b] : c.trigger.billingTypes.filter((x) => x !== b) } })} />{BILLING_TYPE_LABELS[b]}</label>)}{(['publico', 'privado'] as const).map((k) => <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={c.trigger.kinds.includes(k)} onChange={(e) => set({ trigger: { ...c.trigger, kinds: e.target.checked ? [...c.trigger.kinds, k] : c.trigger.kinds.filter((x) => x !== k) } })} />{k === 'publico' ? 'Público' : 'Privado'}</label>)}</div></fieldset>
          <div className="space-y-1 pt-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.trigger.createOnContractValidation} onChange={(e) => set({ trigger: { ...c.trigger, createOnContractValidation: e.target.checked } })} />Contrato validado entra no funil (etapa Acionado)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.trigger.notifyEmails} onChange={(e) => set({ trigger: { ...c.trigger, notifyEmails: e.target.checked } })} />Avisar CSM, comercial e implantação por e-mail</label>
          </div>
        </div>
      </Sec>

      <Sec title="Modelos de jornada" hint="O modelo é escolhido pelo tipo e valor do contrato (o mais específico vence). Marcos de renovação usam a data real de fim da vigência.">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Modelo" htmlFor="cs-tpl"><Select id="cs-tpl" value={tpl} onChange={(e) => setTpl(Number(e.target.value))}>{c.journeyTemplates.map((t, i) => <option key={t.key} value={i}>{t.name}</option>)}</Select></FormField>
          <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => { set({ journeyTemplates: [...c.journeyTemplates, { ...structuredClone(c.journeyTemplates[0]!), key: `modelo_${Date.now()}`, name: 'Novo modelo', appliesTo: {} }] }); setTpl(c.journeyTemplates.length); }}>Novo modelo</Button>
        </div>
        {T && (<>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <FormField label="Nome" htmlFor="cs-tpl-name"><Input id="cs-tpl-name" value={T.name} onChange={(e) => setT({ name: e.target.value })} /></FormField>
            <FormField label="Contrato" htmlFor="cs-tpl-kind"><Select id="cs-tpl-kind" value={T.appliesTo.kind ?? ''} onChange={(e) => setT({ appliesTo: { ...T.appliesTo, kind: (opt(e.target.value) as 'publico' | null) } })}><option value="">Qualquer</option><option value="publico">Público</option><option value="privado">Privado</option></Select></FormField>
            <FormField label="Tipo de cobrança" htmlFor="cs-tpl-bt"><Select id="cs-tpl-bt" value={T.appliesTo.billingType ?? ''} onChange={(e) => setT({ appliesTo: { ...T.appliesTo, billingType: opt(e.target.value) as string | null } })}><option value="">Qualquer</option>{BILLING_TYPES.map((b) => <option key={b} value={b}>{BILLING_TYPE_LABELS[b]}</option>)}</Select></FormField>
            <Num id="cs-tpl-acv" label="ACV mínimo (R$)" value={reais(T.appliesTo.minAcvCents ?? 0)} onChange={(v) => setT({ appliesTo: { ...T.appliesTo, minAcvCents: v ? v * 100 : null } })} />
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Marco', 'Fase', 'Contar a partir de', 'Dias', 'Cria tarefa', 'Responsável', ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{T.milestones.map((m, i) => {
              const up = (p: Partial<typeof m>) => setT({ milestones: T.milestones.map((x, k) => (k === i ? { ...x, ...p } : x)) });
              return (
                <tr key={m.key} className="border-t border-line">
                  <td className="px-2 py-1.5"><Input aria-label={`Marco ${i + 1}`} value={m.title} onChange={(e) => up({ title: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Select aria-label={`Fase do marco ${i + 1}`} value={m.phase} onChange={(e) => up({ phase: e.target.value as typeof m.phase })}>{JOURNEY_PHASES.map((p) => <option key={p} value={p}>{JOURNEY_PHASE_LABELS[p]}</option>)}</Select></td>
                  <td className="px-2 py-1.5"><Select aria-label={`Âncora do marco ${i + 1}`} value={m.anchor} onChange={(e) => up({ anchor: e.target.value as typeof m.anchor })}><option value="inicio">Início da jornada</option><option value="fim_contrato">Fim da vigência</option></Select></td>
                  <td className="w-24 px-2 py-1.5"><Input aria-label={`Dias do marco ${i + 1}`} type="number" value={m.offsetDays} onChange={(e) => up({ offsetDays: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`Tarefa do marco ${i + 1}`} checked={m.task} onChange={(e) => up({ task: e.target.checked })} /></td>
                  <td className="px-2 py-1.5"><Select aria-label={`Responsável do marco ${i + 1}`} value={m.owner} onChange={(e) => up({ owner: e.target.value as typeof m.owner })}><option value="csm">CSM</option><option value="comercial">Comercial</option><option value="implantacao">Implantação</option></Select></td>
                  <td className="px-2 py-1.5"><button aria-label={`Remover marco ${i + 1}`} className="text-muted hover:text-danger" onClick={() => setT({ milestones: T.milestones.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="flex gap-2"><Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setT({ milestones: [...T.milestones, { key: `m${Date.now()}`, phase: 'adocao', title: 'Novo marco', anchor: 'inicio', offsetDays: 30, task: true, owner: 'csm' }] })}>Adicionar marco</Button>{c.journeyTemplates.length > 1 && <Button size="sm" variant="ghost" onClick={() => { set({ journeyTemplates: c.journeyTemplates.filter((_, i) => i !== tpl) }); setTpl(0); }}>Excluir modelo</Button>}</div>
        </>)}
      </Sec>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Sec title="Tier (ACV anual consolidado)" hint="Soma dos contratos ativos do mesmo CNPJ raiz e dos cadastros marcados como mesmo cliente, sem dupla contagem.">
          <div className="grid grid-cols-2 gap-3">
            <Num id="cs-tier-m" label="Middle a partir de (R$)" value={reais(c.tierBands.middleFromCents)} onChange={(v) => set({ tierBands: { ...c.tierBands, middleFromCents: v * 100 } })} />
            <Num id="cs-tier-l" label="Large a partir de (R$)" value={reais(c.tierBands.largeFromCents)} onChange={(v) => set({ tierBands: { ...c.tierBands, largeFromCents: v * 100 } })} />
          </div>
        </Sec>
        <Sec title="Score IPC" hint="Sete critérios; pontuação de 20 a 100. Tamanho e tempo de relacionamento são calculados.">
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Critério</th><th className="font-medium">Baixo</th><th className="font-medium">Médio</th><th className="font-medium">Alto</th></tr></thead>
            <tbody>{IPC_CRITERIA.map((k) => <tr key={k} className="border-t border-line"><td className="py-1">{IPC_LABELS[k]}</td>{(['baixo', 'medio', 'alto'] as const).map((l) => <td key={l} className="w-20 px-1 py-1"><Input aria-label={`${IPC_LABELS[k]} ${l}`} type="number" value={c.ipcPoints[k][l]} onChange={(e) => set({ ipcPoints: { ...c.ipcPoints, [k]: { ...c.ipcPoints[k], [l]: Number(e.target.value) } } })} /></td>)}</tr>)}</tbody></table></div>
          <Num id="cs-ipc-rev" label="Revisão a cada (dias)" value={c.ipcRevisionDays} onChange={(v) => set({ ipcRevisionDays: v })} />
        </Sec>
        <Sec title="Saúde da conta" hint="Média ponderada só dos fatores com dado. Sem dado suficiente, a saúde aparece como 'Dados insuficientes'.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{HEALTH_FACTORS.map((k) => <Num key={k} id={`cs-h-${k}`} label={HEALTH_LABELS[k]} value={c.healthWeights[k]} onChange={(v) => set({ healthWeights: { ...c.healthWeights, [k]: v } })} />)}</div>
          <Num id="cs-h-min" label="Mínimo de dados (% dos pesos)" value={Math.round(c.healthMinCoverage * 100)} onChange={(v) => set({ healthMinCoverage: v / 100 })} />
        </Sec>
        <Sec title="Criticidade e prioridade" hint="Pesos dos fatores (0 desliga) e pontos (0–100) para cada nível.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{CRIT_FACTORS.map((k) => <Num key={k} id={`cs-c-${k}`} label={CRIT_LABELS[k]} value={c.critWeights[k]} onChange={(v) => set({ critWeights: { ...c.critWeights, [k]: v } })} />)}</div>
          <div className="grid grid-cols-3 gap-3">{(['moderada', 'alta', 'critica'] as const).map((l) => <Num key={l} id={`cs-ct-${l}`} label={`${CS_LEVEL_LABELS[l]} a partir de`} value={c.critThresholds[l]} onChange={(v) => set({ critThresholds: { ...c.critThresholds, [l]: v } })} />)}</div>
          <FormField label="Classes estratégicas que elevam a criticidade (separe por vírgula)" htmlFor="cs-c-cls"><Input id="cs-c-cls" value={c.critStrategicClasses.join(', ')} onChange={(e) => set({ critStrategicClasses: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></FormField>
          <FormField label="Prioridade manual × calculada" htmlFor="cs-prec"><Select id="cs-prec" value={c.precedence} onChange={(e) => set({ precedence: e.target.value as CsConfig['precedence'] })}>{PRECEDENCE.map((p) => <option key={p} value={p}>{PRECEDENCE_LABELS[p]}</option>)}</Select></FormField>
        </Sec>
      </div>

      <Sec title="Políticas de acompanhamento (cadência)" hint="A política mais específica que combinar com a conta vale. Dias vazios = sem compromisso automático (ex.: visita conforme planejamento).">
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Nome', 'Criticidade', 'Tier', 'Classe', 'Contato (dias)', 'Visita (dias)', 'Revisão (dias)', ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{c.cadence.map((p, i) => {
            const up = (x: Partial<typeof p>) => set({ cadence: c.cadence.map((y, k) => (k === i ? { ...y, ...x } : y)) });
            const days = (v: number | null, k: 'contactDays' | 'visitDays' | 'reviewDays') => <Input aria-label={`${k} ${p.name}`} type="number" min={1} value={v ?? ''} onChange={(e) => up({ [k]: e.target.value ? Number(e.target.value) : null })} />;
            return (
              <tr key={p.key} className="border-t border-line">
                <td className="px-2 py-1.5"><Input aria-label={`Nome da política ${i + 1}`} value={p.name} onChange={(e) => up({ name: e.target.value })} /></td>
                <td className="px-2 py-1.5"><Select aria-label={`Criticidade da política ${i + 1}`} value={p.when.criticality ?? ''} onChange={(e) => up({ when: { ...p.when, criticality: (opt(e.target.value) as CsLevel | null) } })}><option value="">Qualquer</option>{CS_LEVELS.map((l) => <option key={l} value={l}>{CS_LEVEL_LABELS[l]}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Select aria-label={`Tier da política ${i + 1}`} value={p.when.tier ?? ''} onChange={(e) => up({ when: { ...p.when, tier: (opt(e.target.value) as Tier | null) } })}><option value="">Qualquer</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}</Select></td>
                <td className="px-2 py-1.5"><Input aria-label={`Classe da política ${i + 1}`} value={p.when.classKey ?? ''} onChange={(e) => up({ when: { ...p.when, classKey: (opt(e.target.value) as string | null) } })} placeholder="Qualquer" /></td>
                <td className="w-28 px-2 py-1.5">{days(p.contactDays, 'contactDays')}</td><td className="w-28 px-2 py-1.5">{days(p.visitDays, 'visitDays')}</td><td className="w-28 px-2 py-1.5">{days(p.reviewDays, 'reviewDays')}</td>
                <td className="px-2 py-1.5"><button aria-label={`Remover política ${i + 1}`} className="text-muted hover:text-danger" onClick={() => set({ cadence: c.cadence.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="flex flex-wrap items-end gap-3">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => set({ cadence: [...c.cadence, { key: `p${Date.now()}`, name: 'Nova política', when: {}, contactDays: 30, visitDays: null, reviewDays: null }] })}>Adicionar política</Button>
          <Num id="cs-hor" label="Horizonte de geração (dias)" value={c.cadenceHorizonDays} onChange={(v) => set({ cadenceHorizonDays: v })} />
        </div>
      </Sec>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Sec title="Cobertura" hint="Peso de cada acompanhamento pela criticidade da conta (gravado na época) e tolerância de prazo.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{CS_LEVELS.map((l) => <Num key={l} id={`cs-w-${l}`} label={CS_LEVEL_LABELS[l]} value={c.coverageWeights[l]} min={1} onChange={(v) => set({ coverageWeights: { ...c.coverageWeights, [l]: v } })} />)}<Num id="cs-tol" label="Tolerância (dias)" value={c.onTimeToleranceDays} onChange={(v) => set({ onTimeToleranceDays: v })} /></div>
        </Sec>
        <Sec title="Capacidade dos CSMs" hint="Esforço estimado por interação e horas disponíveis por mês, para enxergar sobrecarga.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{CS_ACTIVITY_KINDS.map((k) => <Num key={k} id={`cs-e-${k}`} label={`${CS_ACTIVITY_LABELS[k]} (min)`} value={c.effortMinutes[k]} onChange={(v) => set({ effortMinutes: { ...c.effortMinutes, [k]: v } })} />)}<Num id="cs-cap" label="Horas por CSM/mês" value={c.csmCapacityHoursMonth} onChange={(v) => set({ csmCapacityHoursMonth: v })} /></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['operacional', 'comercial', 'qualidade', 'risco'] as const).map((k) => <Num key={k} id={`cs-sc-${k}`} label={`Scorecard: ${k}`} value={c.scorecard[k]} onChange={(v) => set({ scorecard: { ...c.scorecard, [k]: v } })} />)}</div>
        </Sec>
      </div>

      <Sec title="Alertas preventivos" hint="Limites, tipos ligados e escalonamento. Alertas não usam dado inexistente como confirmado.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Num id="cs-a-nc" label="Sem contato após (dias)" value={c.alerts.noContactDays} onChange={(v) => set({ alerts: { ...c.alerts, noContactDays: v } })} />
          <Num id="cs-a-ren" label="Vencimento próximo (dias)" value={c.alerts.renewalDays} onChange={(v) => set({ alerts: { ...c.alerts, renewalDays: v } })} />
          <Num id="cs-a-hi" label="Consumo alto (%)" value={c.alerts.consumptionHighPct} onChange={(v) => set({ alerts: { ...c.alerts, consumptionHighPct: v } })} />
          <Num id="cs-a-lo" label="Baixo consumo (%)" value={c.alerts.consumptionLowPct} onChange={(v) => set({ alerts: { ...c.alerts, consumptionLowPct: v } })} />
          <Num id="cs-a-sat" label="Queda de satisfação (pontos de 0–10)" value={c.alerts.satisfactionDrop} onChange={(v) => set({ alerts: { ...c.alerts, satisfactionDrop: v } })} />
          <Num id="cs-a-esc" label="Escalonar após (dias)" value={c.alerts.escalateAfterDays} onChange={(v) => set({ alerts: { ...c.alerts, escalateAfterDays: v } })} />
          <Num id="cs-a-st" label="Dado desatualizado após (dias)" value={c.alerts.staleDataDays} onChange={(v) => set({ alerts: { ...c.alerts, staleDataDays: v } })} />
          <FormField label="E-mails de escalonamento (vírgula)" htmlFor="cs-a-mails"><Input id="cs-a-mails" value={c.alerts.escalateEmails.join(', ')} onChange={(e) => set({ alerts: { ...c.alerts, escalateEmails: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} /></FormField>
        </div>
        <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Alertas ligados</legend><div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(CS_ALERT_KEYS).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!c.alerts.disabled.includes(k)} onChange={(e) => set({ alerts: { ...c.alerts, disabled: e.target.checked ? c.alerts.disabled.filter((x) => x !== k) : [...c.alerts.disabled, k] } })} />{l}</label>)}</div></fieldset>
      </Sec>

      <Sec title="Visitas e pesquisas">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Tipos de visita (vírgula)" htmlFor="cs-vt"><Input id="cs-vt" value={c.visitTypes.join(', ')} onChange={(e) => set({ visitTypes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></FormField>
          <FormField label="Pesquisas (vírgula; nps e csat têm escala própria)" htmlFor="cs-sk"><Input id="cs-sk" value={c.surveyKinds.join(', ')} onChange={(e) => set({ surveyKinds: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} /></FormField>
        </div>
      </Sec>

      <section className="card sticky bottom-3 z-10 space-y-3 p-4 shadow-overlay">
        {!!errs.length && <Notice tone="warning">{errs.join(' ')}</Notice>}
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="O que mudou" htmlFor="cs-note" className="min-w-[260px] flex-1"><Textarea id="cs-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <Button variant="secondary" onClick={() => setC(structuredClone(d.config))}>Descartar</Button>
          <Button variant="primary" disabled={!d.canEdit || !!errs.length || note.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Salvar nova versão</Button>
        </div>
      </section>
      {!!d.history.length && <details className="card p-4 text-sm"><summary className="cursor-pointer font-semibold text-ink">Versões anteriores ({d.history.length})</summary><ul className="mt-2 space-y-1">{d.history.map((h) => <li key={h.version}>v{h.version} · {fmtDateTime(h.createdAt)} · {h.by ?? '—'}: {h.note}</li>)}</ul></details>}
    </div>
  );
}
