/**
 * "Como é calculado": de onde o CRM tira o indicador e os parâmetros ajustáveis (categorias de tarefa do
 * Lead Time; régua de ativação das contas-alvo). Cada ajuste vira uma nova versão da ficha.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ACTIVATION_SIGNALS, ACTIVATION_SIGNAL_LABELS, ACTIVATION_STATE_LABELS, ACTIVATION_TIERS, ABM_TIER_NAMES, DEFAULT_ACTIVATION, SIGNAL_STRENGTHS, SIGNAL_STRENGTH_LABELS,
  type ActivationConfig, type ActivationSignal, type ActivationState, type SignalStrength,
} from '@isp/domain';
import { api } from '../../lib/api';
import { Button, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Calc = {
  kind: 'booking' | 'win_rate' | 'conversao' | 'health' | 'lead_time' | 'abm' | null; taskCategories: string[]; activation: ActivationConfig | null; canEdit: boolean;
  options: { categories: { category: string; n: number }[]; surveys: { id: string; name: string; questions: { key: string; type: string; text: string }[] }[] };
};
const HOW: Record<NonNullable<Calc['kind']>, string> = {
  booking: 'Crescimento da receita da base de contratos (recorrente + consumos de medição + faturamentos frequentes) sobre o mesmo período do ano anterior, sem o efeito do reajuste. O valor do contrato no ano anterior é informado na aba Aditivos do contrato.',
  win_rate: 'Licitações e adesões a ata ganhas ÷ (ganhas + perdidas) com resultado no período. Suspensas e canceladas ficam fora.',
  conversao: 'Das negociações abertas no período (fora do funil de Sucesso do Cliente), quantas estão ganhas.',
  health: 'Percentual das contas do Sucesso do Cliente com saúde calculada que estão saudáveis (saúde ≥ 75). Trimestres fechados usam a última avaliação de cada conta até o fim do trimestre.',
  lead_time: 'Média de dias entre criar e concluir as tarefas de viabilidade das categorias escolhidas abaixo (todas juntas), pela data de conclusão.',
  abm: 'Contas-alvo em andamento que estão ativadas ÷ contas-alvo em andamento. Ativada = bateu a régua do tier com sinais vindos da conta (não contam ações só nossas).',
};
const ST_TONE: Record<ActivationState, string> = { ativada: 'text-primary', engajada: 'text-text', esfriando: 'text-[#C2610C]', nao_engajada: 'text-faint' };

export function KpiCalc({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['kpi-calc', id], queryFn: () => api<Calc>(`/intelligence/kpis/${id}/calc`) });
  if (q.isLoading || !q.data) return <LoadingRows rows={2} />;
  const c = q.data;
  return (
    <section aria-label="Como é calculado">
      <h3 className="mb-1 text-md font-bold text-ink">Como é calculado</h3>
      {!c.kind ? <p className="text-sm text-muted">Resultado informado na tela (Lançar resultado), até a fonte ser definida.</p> : <p className="text-sm text-text">{HOW[c.kind]}</p>}
      <p className="mt-1 text-xs text-muted">Período sem dado no CRM usa o resultado lançado, se houver.</p>
      {c.kind === 'lead_time' && <Categories id={id} c={c} />}
      {c.kind === 'abm' && c.activation && <><Activation id={id} c={c} /><Accounts /></>}
    </section>
  );
}

function useSave(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/intelligence/kpis/${id}/calc`, { method: 'PUT', body }),
    onSuccess: () => { for (const k of ['kpi-calc', 'kpis', 'kpi-activation']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: 'Cálculo ajustado (nova versão da ficha)' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

function Categories({ id, c }: { id: string; c: Calc }) {
  const save = useSave(id);
  const [sel, setSel] = useState<string[]>(c.taskCategories);
  const [extra, setExtra] = useState('');
  const all = [...new Set([...c.options.categories.map((x) => x.category), ...c.taskCategories, ...sel])];
  const norm = (v: string) => v.trim().toLowerCase();
  const has = (v: string) => sel.some((x) => norm(x) === norm(v));
  return (
    <div className="mt-3 border border-line p-3">
      <p className="text-sm font-semibold text-ink">Categorias de tarefa que contam</p>
      {!all.length && <p className="text-xs text-muted">Nenhuma categoria de tarefa ainda. Crie os tipos de viabilidade (Engenharia e Infraestrutura) e escolha aqui, ou digite o nome.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {all.map((k) => (
          <label key={k} className={clsx('flex cursor-pointer items-center gap-2 border px-2.5 py-1.5 text-sm', has(k) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-text')}>
            <input type="checkbox" className="h-4 w-4 accent-primary" disabled={!c.canEdit} checked={has(k)} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => norm(x) !== norm(k)))} />{k}
            <span className="text-xs text-faint">{c.options.categories.find((x) => x.category === k)?.n ?? 0}</span>
          </label>
        ))}
      </div>
      {c.canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <FormField label="Outra categoria" htmlFor="lt-extra"><Input id="lt-extra" value={extra} maxLength={60} onChange={(e) => setExtra(e.target.value)} placeholder="Ex.: Viabilidade Infraestrutura" /></FormField>
          <Button size="sm" disabled={!extra.trim()} onClick={() => { if (!has(extra)) setSel([...sel, extra.trim()]); setExtra(''); }}>Incluir</Button>
          <span className="flex-1" />
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ taskCategories: sel })}>Salvar categorias</Button>
        </div>
      )}
    </div>
  );
}

function Activation({ id, c }: { id: string; c: Calc }) {
  const save = useSave(id);
  const [cfg, setCfg] = useState<ActivationConfig>(c.activation!);
  useEffect(() => setCfg(c.activation!), [c.activation]);
  const ro = !c.canEdit;
  const num = (v: string) => Math.max(0, Number(v.replace(/\D/g, '')) || 0);
  const survey = c.options.surveys.find((s) => s.id === cfg.survey.surveyId) ?? null;
  return (
    <div className="mt-3 space-y-4 border border-line p-3">
      <div>
        <p className="text-sm font-semibold text-ink">Régua por tier</p>
        <p className="text-xs text-muted">A conta fica ativada quando, dentro da janela, soma os pontos mínimos com os sinais fortes e as pessoas pedidas. Sem sinal forte por uma janela inteira, ela passa a "esfriando".</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-2 py-1.5 text-left font-medium">Tier</th><th className="px-2 py-1.5 text-left font-medium">Janela (dias)</th><th className="px-2 py-1.5 text-left font-medium">Pontos mínimos</th><th className="px-2 py-1.5 text-left font-medium">Sinais fortes</th><th className="px-2 py-1.5 text-left font-medium">Pessoas da conta</th></tr></thead>
          <tbody>{ACTIVATION_TIERS.map((t) => (
            <tr key={t} className="border-t border-line">
              <td className="px-2 py-1.5 font-semibold text-ink">{ABM_TIER_NAMES[t]}</td>
              {(['windowDays', 'minPoints', 'minStrong', 'minPeople'] as const).map((k) => (
                <td key={k} className="px-2 py-1.5"><Input aria-label={`${ABM_TIER_NAMES[t]}: ${k}`} className="h-9 w-20" inputMode="numeric" disabled={ro} value={String(cfg.tiers[t][k])} onChange={(e) => setCfg({ ...cfg, tiers: { ...cfg.tiers, [t]: { ...cfg.tiers[t], [k]: num(e.target.value) } } })} /></td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Sinais vindos da conta e o peso de cada um</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">{(['forte', 'medio', 'fraco'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">{SIGNAL_STRENGTH_LABELS[k]} vale<Input aria-label={`Pontos do sinal ${SIGNAL_STRENGTH_LABELS[k]}`} className="h-9 w-16" inputMode="numeric" disabled={ro} value={String(cfg.points[k])} onChange={(e) => setCfg({ ...cfg, points: { ...cfg.points, [k]: num(e.target.value) } })} />pontos</label>
        ))}</div>
        <ul className="mt-2 divide-y divide-line border border-line">{ACTIVATION_SIGNALS.map((sg) => (
          <li key={sg} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-sm">
            <span className="text-text">{ACTIVATION_SIGNAL_LABELS[sg]}</span>
            <Select aria-label={`Peso: ${ACTIVATION_SIGNAL_LABELS[sg]}`} className="h-9 w-auto" disabled={ro} value={cfg.signals[sg]} onChange={(e) => setCfg({ ...cfg, signals: { ...cfg.signals, [sg as ActivationSignal]: e.target.value as SignalStrength } })}>{SIGNAL_STRENGTHS.map((x) => <option key={x} value={x}>{SIGNAL_STRENGTH_LABELS[x]}</option>)}</Select>
          </li>
        ))}</ul>
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Pesquisa de ativação</p>
        <p className="text-xs text-muted">Responder já conta. Nota igual ou acima do mínimo, ou "sim" em "nos consultaria", vale como reconhecimento.</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Pesquisa" htmlFor="ac-survey"><Select id="ac-survey" disabled={ro} value={cfg.survey.surveyId ?? ''} onChange={(e) => setCfg({ ...cfg, survey: { ...cfg.survey, surveyId: e.target.value || null, relevanceKey: null, recommendKey: null } })}><option value="">Nenhuma (ainda)</option>{c.options.surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
          <FormField label="Nota mínima de relevância" htmlFor="ac-min"><Input id="ac-min" inputMode="numeric" disabled={ro} value={String(cfg.survey.minScore)} onChange={(e) => setCfg({ ...cfg, survey: { ...cfg.survey, minScore: num(e.target.value) } })} /></FormField>
          {survey && <>
            <FormField label="Pergunta de relevância (escala)" htmlFor="ac-rel"><Select id="ac-rel" disabled={ro} value={cfg.survey.relevanceKey ?? ''} onChange={(e) => setCfg({ ...cfg, survey: { ...cfg.survey, relevanceKey: e.target.value || null } })}><option value="">—</option>{survey.questions.filter((x) => x.type !== 'sim_nao').map((x) => <option key={x.key} value={x.key}>{x.text}</option>)}</Select></FormField>
            <FormField label="Pergunta &quot;nos consultaria&quot; (sim/não)" htmlFor="ac-rec"><Select id="ac-rec" disabled={ro} value={cfg.survey.recommendKey ?? ''} onChange={(e) => setCfg({ ...cfg, survey: { ...cfg.survey, recommendKey: e.target.value || null } })}><option value="">—</option>{survey.questions.filter((x) => x.type === 'sim_nao').map((x) => <option key={x.key} value={x.key}>{x.text}</option>)}</Select></FormField>
          </>}
        </div>
        {!c.options.surveys.length && <p className="mt-1 text-xs text-muted">Crie a pesquisa em Sucesso do Cliente → Pesquisas com uma pergunta de escala (relevância) e uma de sim/não ("nos consultaria antes de um próximo projeto?").</p>}
      </div>
      {c.canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => setCfg(DEFAULT_ACTIVATION)}>Voltar à sugestão</Button>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ activation: cfg })}>Salvar régua</Button>
        </div>
      )}
    </div>
  );
}

type Acc = { abmId: string; contactId: string; name: string; owner: string | null; tier: string; state: ActivationState; points: number; strong: number; people: number; signals: number; lastStrongOn: string | null };
function Accounts() {
  const q = useQuery({ queryKey: ['kpi-activation'], queryFn: () => api<{ items: Acc[] }>('/intelligence/kpis/activation/accounts') });
  if (q.isLoading) return <LoadingRows rows={2} />;
  const items = q.data?.items ?? [];
  const count = (s: ActivationState) => items.filter((x) => x.state === s).length;
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-ink">Contas-alvo hoje</p>
      <p className="text-xs text-muted">{(['ativada', 'engajada', 'esfriando', 'nao_engajada'] as ActivationState[]).map((s) => `${count(s)} ${ACTIVATION_STATE_LABELS[s].toLowerCase()}`).join(' · ')}</p>
      {!items.length ? <p className="mt-1 text-sm text-muted">Nenhuma conta-alvo em andamento no ABM.</p> : (
        <ul className="mt-2 divide-y divide-line border border-line text-sm">{items.slice(0, 30).map((a) => (
          <li key={a.abmId} className="flex flex-wrap items-baseline justify-between gap-2 px-2.5 py-1.5">
            <span className="min-w-0"><span className="text-ink">{a.name}</span> <span className="text-xs text-faint">{ABM_TIER_NAMES[a.tier as keyof typeof ABM_TIER_NAMES] ?? a.tier}</span></span>
            <span className="text-xs"><b className={ST_TONE[a.state]}>{ACTIVATION_STATE_LABELS[a.state]}</b> <span className="text-muted">· {a.points} pts · {a.strong} forte(s) · {a.people} pessoa(s)</span></span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
