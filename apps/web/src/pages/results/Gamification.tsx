/**
 * Gestão de Times → Gamificação colaborativa: regra de pontuação com aprovação, pódio do mês e do ano, ranking com foto
 * (mês e ano), placar por time (média; dispersão para a liderança), pesos por hierarquia, níveis e Selo BK de Qualidade.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Settings2, Trophy, Trash2, Plus } from 'lucide-react';
import { BUSINESS_EVENT_TYPES, GAMIFICATION_ROLE_LABELS, GAMIFICATION_ROLES } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Avatar, Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Tabs } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { BkGoldMedal, DISPERSION_LABEL, DISPERSION_STYLE, fmtPts, Podium, useGamification, type Board, type GamData, type GamSettings } from '../../features/gamification/Gamification';

type SettingsResp = {
  settings: GamSettings | null; version: number | null; start: GamSettings; canConfigure: boolean; teams: { id: string; name: string }[];
  proposal: { version: number; settings: GamSettings; note: string; createdAt: string; canDecide: boolean } | null;
  history: { version: number; note: string; status: 'proposta' | 'aprovada' | 'recusada'; decisionNote: string | null; decidedAt: string | null; createdAt: string; by: string | null }[];
};
const eventLabel = (k: string) => BUSINESS_EVENT_TYPES.find((t) => t.key === k)?.label ?? k;
const ROLE_SHORT = { colaborador: 'Colaborador', lideranca: 'Liderança' } as const;

export function GamificationPage() {
  const [month, setMonth] = useState('');
  const q = useGamification(month || undefined);
  const [rules, setRules] = useState(false);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const header = (
    <PageHeader icon={<Trophy />} title="Gamificação" subtitle="Colaboração acima da competição: a média do time entra na nota de cada pessoa, com pesos por hierarquia, e ajudar o colega vale mais. A liderança acompanha a dispersão do time."
      actions={<div className="flex flex-wrap items-center gap-2">
        {!d.pending && <Input aria-label="Mês" type="month" className="h-10 w-[170px]" value={month || d.month} onChange={(e) => setMonth(e.target.value)} />}
        {d.canConfigure && <Button variant="outline" icon={<Settings2 className="h-4 w-4" />} onClick={() => setRules(true)}>Regra de pontuação</Button>}
      </div>} />
  );
  return (
    <div>
      {header}
      <ProposalBanner />
      {d.pending || !d.monthBoard || !d.yearBoard || !d.settings ? (
        <Notice tone="info">A gamificação começa quando a regra de pontuação for aprovada. Até lá ninguém pontua.{d.canConfigure ? ' Revise a proposta acima, ajuste em "Regra de pontuação" se quiser, e aprove.' : ''}</Notice>
      ) : <Boards d={d as GamData & { monthBoard: Board; yearBoard: Board; settings: GamSettings }} />}
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

function Boards({ d }: { d: GamData & { monthBoard: Board; yearBoard: Board; settings: GamSettings } }) {
  const st = d.settings;
  const [tab, setTab] = useState<'mes' | 'ano'>('mes');
  const monthName = new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const ranking = tab === 'mes' ? d.monthBoard.people : d.yearBoard.people;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {d.me && (
          <section aria-label="Minha nota" className="card flex flex-wrap items-center gap-4 p-4">
            {d.me.gold && <BkGoldMedal size={48} year={d.year} />}
            <div className="flex-1">
              <p className="text-sm text-muted">Minha nota em {d.year}</p>
              <p className="font-display text-2xl font-extrabold text-ink"><span className="num">{fmtPts(d.me.score)}</span> pts{d.me.level && <span className="ml-2 text-base font-semibold text-primary">nível {d.me.level}</span>}</p>
            </div>
            <p className="text-sm text-muted">{d.me.gold ? 'Medalha de ouro: Selo BK de Qualidade' : `${d.me.rank}º no ano`}</p>
          </section>
        )}
        <section aria-label="Ranking" className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Ranking</h2>
            <Tabs label="Período do ranking" value={tab} onChange={(x) => setTab(x as 'mes' | 'ano')} tabs={[{ key: 'mes', label: `Mês (${monthName})` }, { key: 'ano', label: `Ano ${d.year}` }]} />
          </div>
          <ol className="divide-y divide-line text-sm">
            {ranking.map((p, i) => {
              const lvl = tab === 'ano' ? d.yearBoard.people.find((x) => x.userId === p.userId)?.level : null;
              return (
                <li key={p.userId} className="flex items-center gap-3 py-2">
                  <span className="num w-7 text-right font-bold text-muted">{i + 1}º</span>
                  <Avatar name={p.name} userId={p.userId} hasPhoto={p.hasPhoto} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{p.name}</span>
                    <span className="block text-xs text-muted">{ROLE_SHORT[p.role]} · próprios {fmtPts(p.own)} · média do time {fmtPts(p.teamAverage)}</span>
                  </span>
                  {tab === 'ano' && d.gold.some((g) => g.userId === p.userId) && <BkGoldMedal size={22} year={d.year} />}
                  {lvl && <span className="text-xs font-semibold text-primary">{lvl}</span>}
                  <span className="num w-20 text-right text-base font-bold text-ink">{fmtPts(p.score)}</span>
                </li>
              );
            })}
          </ol>
        </section>
        {d.monthBoard.teams.map((t) => (
          <section key={t.teamId} aria-label={`Time ${t.name}`} className="card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-ink">{t.name}<span className="ml-2 text-sm font-normal text-muted">{monthName}</span></h2>
              <p className="text-sm text-muted">Média do time <span className="num font-bold text-ink">{fmtPts(t.average)}</span> · total <span className="num">{fmtPts(t.points)}</span></p>
            </div>
            {t.dispersion && (
              <div className={clsx('mb-3 border-l-4 px-3 py-2 text-sm', DISPERSION_STYLE[t.dispersion.tone])} role="status" aria-label={`Dispersão do time ${t.name}`}>
                <p className="font-semibold">{DISPERSION_LABEL[t.dispersion.tone]}{t.dispersion.cv != null && ` · dispersão ${Math.round(t.dispersion.cv * 100)}%`}</p>
                <p className="text-xs">Indicador da liderança: diferença entre os resultados individuais (de {fmtPts(t.dispersion.min)} a {fmtPts(t.dispersion.max)}). Atenção a partir de {st.dispersionYellowBp / 100}%, problema a partir de {st.dispersionRedBp / 100}%.{t.dispersion.tone === 'vermelho' || t.dispersion.tone === 'amarelo' ? ' Combine apoio entre as pessoas do time para nivelar o resultado.' : ''}</p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted"><tr>{['Pessoa', 'Próprios', 'Ajudando colegas', 'Média do time', 'Nota'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {t.members.map((m) => (
                    <tr key={m.userId} className="border-t border-line">
                      <td className="px-2 py-1.5"><span className="flex items-center gap-2"><Avatar name={m.name} userId={m.userId} hasPhoto={m.hasPhoto} size={28} /><span className="font-semibold text-ink">{m.name}</span>{m.role === 'lideranca' && <Chip tone="blue">Liderança</Chip>}</span></td>
                      <td className="num px-2 py-1.5">{fmtPts(m.direct)}</td>
                      <td className="num px-2 py-1.5">{fmtPts(m.participation)}</td>
                      <td className="num px-2 py-1.5 text-muted">{fmtPts(m.teamAverage)}</td>
                      <td className="num px-2 py-1.5 font-bold">{fmtPts(m.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <aside className="space-y-4">
        <section className="card p-4" aria-label="Pódio do mês">
          <h2 className="font-display text-lg font-bold text-ink">Pódio de {monthName}</h2>
          <Podium key={d.month} people={d.monthBoard.podium} label={monthName} />
        </section>
        <section className="card p-4" aria-label="Pódio do ano">
          <h2 className="font-display text-lg font-bold text-ink">Pódio de {d.year}</h2>
          <Podium key={`y${d.year}`} people={d.yearBoard.podium} label={String(d.year)} />
          {d.gold.length > 0 && <p className="mt-3 flex items-center gap-2 text-sm"><BkGoldMedal size={28} year={d.year} /><span><span className="font-semibold text-ink">{d.gold.map((g) => g.name).join(', ')}</span>: medalha de ouro, Selo BK de Qualidade</span></p>}
        </section>
        <section className="card p-4 text-sm text-muted" aria-label="Como funciona">
          <h2 className="mb-1 font-display text-lg font-bold text-ink">Como funciona</h2>
          <p>Pontos vêm dos eventos de negócio válidos (Desempenho). Ajudar na venda do colega vale {fmtPts(st.participationMultiplierBp / 10_000)}× o crédito.</p>
          <ul className="mt-1 list-disc pl-4">{GAMIFICATION_ROLES.map((r) => <li key={r}>{ROLE_SHORT[r]}: {st.hierarchyWeights[r].ownBp / 100}% próprio + {st.hierarchyWeights[r].teamBp / 100}% média do time</li>)}</ul>
          <p className="mt-1">Regra aprovada v{d.settingsVersion}.</p>
        </section>
      </aside>
    </div>
  );
}

/** Proposta pendente: resumo legível para quem aprova, com Aprovar e Recusar (quem propôs não decide). */
function ProposalBanner() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['gamificacao-settings'], queryFn: () => api<SettingsResp>('/times/gamificacao/settings') });
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (approve: boolean) => api(`/times/gamificacao/settings/${q.data!.proposal!.version}/decide`, { method: 'POST', body: { approve, note: note.trim() || null } }),
    onSuccess: (_d, approve) => { for (const k of ['gamificacao', 'gamificacao-settings', 'selo']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: approve ? 'Regra aprovada: a gamificação já vale' : 'Proposta recusada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const p = q.data?.proposal;
  if (!p) return null;
  const s = p.settings;
  const teamNames = s.teamIds.length ? s.teamIds.map((id) => q.data!.teams.find((t) => t.id === id)?.name ?? '').join(', ') : 'todos os times';
  return (
    <section aria-label="Regra de pontuação aguardando aprovação" className="mb-4 border border-[#B45309] bg-[#FFF7E6] p-4">
      <h2 className="font-display text-lg font-bold text-ink">Regra de pontuação v{p.version} aguardando aprovação</h2>
      <p className="text-sm text-muted">{p.note} · proposta em {fmtDate(p.createdAt)}</p>
      <div className="mt-3 grid gap-4 text-sm md:grid-cols-3">
        <div>
          <p className="font-semibold text-ink">Pontos por evento</p>
          <ul className="mt-1 space-y-0.5">{Object.entries(s.points).filter(([, v]) => v > 0).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{eventLabel(k)}</span><span className="num font-semibold">{v}</span></li>)}</ul>
        </div>
        <div>
          <p className="font-semibold text-ink">Colaboração e hierarquia</p>
          <ul className="mt-1 space-y-0.5">
            <li>Ajuda ao colega vale {fmtPts(s.participationMultiplierBp / 10_000)}×</li>
            {GAMIFICATION_ROLES.map((r) => <li key={r}>{ROLE_SHORT[r]}: {s.hierarchyWeights[r].ownBp / 100}% próprio + {s.hierarchyWeights[r].teamBp / 100}% do time</li>)}
            <li>Participam: {teamNames}</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-ink">Dispersão e níveis</p>
          <ul className="mt-1 space-y-0.5">
            <li>Atenção a partir de {s.dispersionYellowBp / 100}%, problema a partir de {s.dispersionRedBp / 100}%</li>
            {s.levels.map((l) => <li key={l.name}>{l.name}: {l.minPoints.toLocaleString('pt-BR')} pts no ano</li>)}
          </ul>
        </div>
      </div>
      {p.canDecide ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <FormField className="min-w-[260px] flex-1" label="Observação (obrigatória para recusar)" htmlFor="g-decision"><Input id="g-decision" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <Button variant="outline" loading={decide.isPending} onClick={() => decide.mutate(false)}>Recusar</Button>
          <Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate(true)}>Aprovar regra</Button>
        </div>
      ) : <p className="mt-3 text-sm text-muted">{q.data?.canConfigure ? 'Você propôs esta versão: outra pessoa que administra a Gestão de Times aprova.' : 'Aguardando a aprovação de quem administra a Gestão de Times.'}</p>}
    </section>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = useQuery({ queryKey: ['gamificacao-settings'], queryFn: () => api<SettingsResp>('/times/gamificacao/settings') });
  if (meta.isLoading || !meta.data) return null;
  return <RulesForm meta={meta.data} onClose={onClose} onSaved={() => { for (const k of ['gamificacao', 'gamificacao-settings']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: 'Proposta enviada: vale depois de aprovada' }); onClose(); }} />;
}

function RulesForm({ meta, onClose, onSaved }: { meta: SettingsResp; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<GamSettings>(meta.proposal?.settings ?? meta.settings ?? meta.start);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api('/times/gamificacao/settings', { method: 'POST', body: { ...v, points: Object.fromEntries(Object.entries(v.points).filter(([, x]) => x > 0)), note } }),
    onSuccess: onSaved, onError: (e) => setErr(errMsg(e)),
  });
  const num = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, '') || 0);
  const pct = (k: 'dispersionYellowBp' | 'dispersionRedBp' | 'participationMultiplierBp', label: string, hint?: string) => (
    <FormField label={label} htmlFor={`g-${k}`} hint={hint}><Input id={`g-${k}`} inputMode="numeric" value={String(v[k] / 100)} onChange={(e) => setV({ ...v, [k]: Math.round(num(e.target.value) * 100) })} /></FormField>
  );
  return (
    <Modal open onClose={onClose} title="Regra de pontuação" size="xl" footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Fechar</Button><Button variant="primary" disabled={note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Enviar para aprovação</Button></div>}>
      {err && <p role="alert" className="mb-2 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <Notice tone="info">Cada mudança vira uma proposta e só vale depois de aprovada por quem administra a Gestão de Times (quem propõe não aprova). {meta.version ? `Hoje vale a v${meta.version}.` : 'Ainda não há regra aprovada.'}</Notice>
      <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Pesos da nota por hierarquia (próprio + time = 100%)</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          {GAMIFICATION_ROLES.map((r) => (
            <div key={r} className="border border-line p-2">
              <p className="text-sm font-semibold text-ink">{GAMIFICATION_ROLE_LABELS[r]}</p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <label className="flex items-center gap-1">Próprio <Input aria-label={`Peso próprio: ${GAMIFICATION_ROLE_LABELS[r]}`} inputMode="numeric" className="num h-8 w-[70px]" value={String(v.hierarchyWeights[r].ownBp / 100)} onChange={(e) => { const own = Math.min(10_000, Math.round(num(e.target.value) * 100)); setV({ ...v, hierarchyWeights: { ...v.hierarchyWeights, [r]: { ownBp: own, teamBp: 10_000 - own } } }); }} />%</label>
                <span>+ time {v.hierarchyWeights[r].teamBp / 100}%</span>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {pct('participationMultiplierBp', 'Valor da ajuda ao colega (%)', '100 = igual ao próprio; 150 = vale 1,5×')}
        {pct('dispersionYellowBp', 'Dispersão: atenção a partir de (%)')}
        {pct('dispersionRedBp', 'Dispersão: problema a partir de (%)')}
      </div>
      <fieldset className="mt-4"><legend className="text-sm font-semibold text-ink">Times que participam (nenhum marcado = todos)</legend>
        <div className="mt-1 flex flex-wrap gap-3">{meta.teams.map((t) => <label key={t.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.teamIds.includes(t.id)} onChange={(e) => setV({ ...v, teamIds: e.target.checked ? [...v.teamIds, t.id] : v.teamIds.filter((x) => x !== t.id) })} />{t.name}</label>)}</div>
      </fieldset>
      <fieldset className="mt-4"><legend className="text-sm font-semibold text-ink">Pontos por evento de negócio (0 = não pontua)</legend>
        <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {BUSINESS_EVENT_TYPES.map((t) => (
            <label key={t.key} className="flex items-center justify-between gap-2 border-b border-line py-1 text-sm"><span>{t.label}</span>
              <Input aria-label={`Pontos: ${t.label}`} inputMode="numeric" className="num h-8 w-[80px]" value={String(v.points[t.key] ?? 0)} onChange={(e) => setV({ ...v, points: { ...v.points, [t.key]: Number(e.target.value.replace(/\D/g, '') || 0) } })} />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4"><legend className="text-sm font-semibold text-ink">Níveis pela nota do ano</legend>
        <div className="mt-1 space-y-1">
          {v.levels.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Nome do nível ${i + 1}`} className="h-8 w-[180px]" value={l.name} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input aria-label={`Pontos mínimos do nível ${i + 1}`} inputMode="numeric" className="num h-8 w-[110px]" value={String(l.minPoints)} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, minPoints: Number(e.target.value.replace(/\D/g, '') || 0) } : x)) })} />
              <button type="button" aria-label={`Tirar nível ${i + 1}`} className="p-1 text-muted hover:text-danger" onClick={() => setV({ ...v, levels: v.levels.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setV({ ...v, levels: [...v.levels, { name: '', minPoints: (v.levels.at(-1)?.minPoints ?? 0) + 100 }] })}>Adicionar nível</Button>
        </div>
      </fieldset>
      <FormField className="mt-4" label="Motivo da mudança" htmlFor="g-note" required><Input id="g-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      {meta.history.length > 0 && (
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold text-ink">Histórico de versões</summary>
          <ul className="mt-1 space-y-0.5 text-muted">{meta.history.map((h) => <li key={h.version}>v{h.version} · {h.status === 'aprovada' ? 'aprovada' : h.status === 'recusada' ? 'recusada' : 'aguardando aprovação'} · {h.note}{h.decisionNote ? ` (${h.decisionNote})` : ''} · {h.by ?? 'Sistema'}, {fmtDate(h.createdAt)}</li>)}</ul>
        </details>
      )}
    </Modal>
  );
}
