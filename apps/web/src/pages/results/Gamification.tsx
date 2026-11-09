/**
 * Gestão de Times → Gamificação colaborativa: regra de pontuação com aprovação (jornadas com pesos por tarefa),
 * a minha nota (mês e ano, de onde vieram os pontos), o time para a liderança (média, dispersão e notas) e o Badge Ouro.
 * Sem ranking nem pódio: comparação pública pode constranger quem não fica em primeiro.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Settings2, Trophy, Trash2, Plus } from 'lucide-react';
import { BUSINESS_EVENT_TYPES } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Avatar, Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { BkGoldMedal, DISPERSION_LABEL, DISPERSION_STYLE, fmtPts, useGamification, type Board, type GamData, type GamSettings, type JourneyDef, type MemberScore, type CompetencyLevel, compositionText, fmtPct } from '../../features/gamification/Gamification';
import { slugKey, DEFAULT_CERTIFICATE_SETTINGS, type BadgeKey } from '@isp/domain';
import { BadgeIcon, BadgeRuleEditor, BadgeRules, MyBadges } from '../../features/gamification/Badges';

type SettingsResp = {
  people: { id: string; name: string; teamIds: string[]; lead: boolean }[];
  pipelines: { id: string; name: string; stages: { key: string; name: string }[] }[];
  settings: GamSettings | null; version: number | null; start: GamSettings; canConfigure: boolean; teams: { id: string; name: string }[];
  proposal: { version: number; settings: GamSettings; note: string; createdAt: string; canDecide: boolean } | null;
  history: { version: number; note: string; status: 'proposta' | 'aprovada' | 'recusada'; decisionNote: string | null; decidedAt: string | null; createdAt: string; by: string | null }[];
};
const eventLabel = (k: string) => BUSINESS_EVENT_TYPES.find((t) => t.key === k)?.label ?? k;

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

function Breakdown({ m, label }: { m: MemberScore | null; label: string }) {
  if (!m) return <p className="text-sm text-muted">Sem pontos em {label}.</p>;
  const rows: [string, string][] = [
    ['Tarefas da jornada', fmtPts(m.tasks)], ['Negócios ganhos (minha parte)', fmtPts(m.wins)], ['Eventos próprios', fmtPts(m.direct)], ['Ajudando colegas', fmtPts(m.participation)],
    ['Crédito extra (acima da alçada)', fmtPts(m.extra)],
    [`Meta do nível (${m.levelName})`, `${fmtPts(m.expected)} pts`],
    ['Atingimento', `${fmtPct(m.attainment)}${m.extraAttainment ? ` + ${fmtPct(m.extraAttainment)} extra` : ''}`],
    ['Média do time', fmtPct(m.teamAverage)],
  ];
  return (
    <dl className="text-sm">
      {rows.map(([l, v]) => <div key={l} className="flex justify-between gap-2 border-b border-line py-1"><dt className="text-muted">{l}</dt><dd className="num text-right font-semibold">{v}</dd></div>)}
      <div className="flex justify-between py-1.5"><dt className="font-semibold text-ink">Nota</dt><dd className="num text-lg font-extrabold text-ink">{fmtPts(m.score)}</dd></div>
    </dl>
  );
}

function Boards({ d }: { d: GamData & { monthBoard: Board; yearBoard: Board; settings: GamSettings } }) {
  const st = d.settings;
  const monthName = new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const myGold = d.me?.gold;
  const yearBadges = new Map(d.yearBoard.teams.flatMap((t) => (t.members ?? []).map((m) => [m.userId, (m as { badges?: { key: BadgeKey; name: string; tier: string | null; tierIndex: number | null }[] }).badges ?? []] as const)));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <section aria-label="Minha nota" className="card p-4">
          <div className="flex flex-wrap items-center gap-4">
            {myGold && <BkGoldMedal size={52} year={d.year} />}
            <div className="flex-1">
              <p className="text-sm text-muted">Minha nota em {d.year}</p>
              <p className="font-display text-2xl font-extrabold text-ink"><span className="num">{fmtPts(d.me?.score ?? 0)}</span> pts{d.me?.level && <span className="ml-2 text-base font-semibold text-primary">faixa {d.me.level}</span>}</p>
              {myGold && <p className="text-sm font-semibold text-[#8A6610]">Badge Ouro: vencedor do ano</p>}
            </div>
            <Link to="/meus-pontos" className="text-sm font-semibold text-primary hover:underline">De onde vieram meus pontos</Link>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div><h3 className="mb-1 text-sm font-bold text-ink">{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</h3><Breakdown m={d.monthBoard.me} label={monthName} /></div>
            <div><h3 className="mb-1 text-sm font-bold text-ink">Ano {d.year}</h3><Breakdown m={d.yearBoard.me} label={String(d.year)} /></div>
          </div>
        </section>
        {!!d.myBadges?.length && <MyBadges badges={d.myBadges} year={d.year} compact />}
        {!!st.badges?.length && (
          <details className="card p-4" aria-label="Regras das badges">
            <summary className="cursor-pointer font-display text-lg font-bold text-ink">Regras das badges</summary>
            <div className="mt-3"><BadgeRules badges={st.badges} /></div>
          </details>
        )}
        {d.monthBoard.teams.map((t) => (
          <section key={t.teamId} aria-label={`Time ${t.name}`} className="card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-ink">{t.name}<span className="ml-2 text-sm font-normal text-muted">{monthName}</span></h2>
              <p className="text-sm text-muted">Média do time <span className="num font-bold text-ink">{fmtPct(t.average)}</span></p>
            </div>
            {t.dispersion && (
              <div className={clsx('mb-3 border-l-4 px-3 py-2 text-sm', DISPERSION_STYLE[t.dispersion.tone])} role="status" aria-label={`Dispersão do time ${t.name}`}>
                <p className="font-semibold">{DISPERSION_LABEL[t.dispersion.tone]}{t.dispersion.cv != null && ` · dispersão ${Math.round(t.dispersion.cv * 100)}%`}</p>
                <p className="text-xs">Indicador da liderança: diferença entre os resultados individuais. Atenção a partir de {st.dispersionYellowBp / 100}%, problema a partir de {st.dispersionRedBp / 100}%.{t.dispersion.tone === 'vermelho' || t.dispersion.tone === 'amarelo' ? ' Combine apoio entre as pessoas do time para nivelar o resultado.' : ''}</p>
              </div>
            )}
            {t.members ? (
              <>
                <p className="mb-1 text-xs text-muted">Visível só para a liderança, como apoio à gestão do time. As pessoas não veem a nota umas das outras.</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="text-xs text-muted"><tr>{['Pessoa', 'Nível', 'Pontos', 'Atingimento', 'Extra', 'Nota', ...(st.badges?.length ? ['Badges no ano'] : [])].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {[...t.members].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((m) => (
                        <tr key={m.userId} className="border-t border-line">
                          <td className="px-2 py-1.5"><span className="flex items-center gap-2"><Avatar name={m.name} userId={m.userId} hasPhoto={m.hasPhoto} size={28} /><span className="font-semibold text-ink">{m.name}</span>{m.lead && <Chip tone="blue">Liderança</Chip>}</span></td>
                          <td className="px-2 py-1.5 text-xs">{m.levelName}</td>
                          <td className="num px-2 py-1.5">{fmtPts(m.points)} / {fmtPts(m.expected)}</td>
                          <td className="num px-2 py-1.5">{fmtPct(m.attainment)}</td>
                          <td className="num px-2 py-1.5">{m.extraAttainment ? `+${fmtPct(m.extraAttainment)}` : '—'}</td>
                          <td className="num px-2 py-1.5 font-bold">{fmtPts(m.score)}</td>
                          {!!st.badges?.length && <td className="px-2 py-1.5"><span className="flex gap-0.5">{(yearBadges.get(m.userId) ?? []).map((b) => <BadgeIcon key={b.key} badgeKey={b.key} tierIndex={b.tierIndex} size={22} label={`${b.name}: ${b.tier ?? 'sem faixa'}`} />)}</span></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <p className="text-sm text-muted">A média do time entra na sua nota: quando o time sobe, todo mundo sobe.</p>}
          </section>
        ))}
      </div>
      <aside className="space-y-4">
        {d.gold.length > 0 && (
          <section className="card flex items-center gap-3 p-4" aria-label="Selo do ano">
            <BkGoldMedal size={48} year={d.year} />
            <p className="text-sm"><span className="font-semibold text-ink">{d.gold.map((g) => g.name).join(', ')}</span><br /><span className="text-muted">Badge Ouro {d.year}: vencedor do ano</span></p>
          </section>
        )}
        <section className="card p-4 text-sm text-muted" aria-label="Como funciona">
          <h2 className="mb-1 font-display text-lg font-bold text-ink">Como funciona</h2>
          <p>Cada tarefa da jornada vale pontos para quem conclui. Excluir ou reabrir tira os pontos.</p>
          <p className="mt-1">Negócio ganho: o peso do ganho é dividido entre quem trabalhou nas tarefas daquela oportunidade.</p>
          <p className="mt-1">Ajudar na venda do colega vale {fmtPts(st.participationMultiplierBp / 10_000)}× o crédito.</p>
          <p className="mt-1">A nota é proporcional ao nível: pontos do mês ÷ meta do nível (teto {st.bonuses.scoreCapBp / 100}%). Bônus: no prazo +{st.bonuses.onTimeBp / 100}%, aprovada pela gerência +{st.bonuses.adherenceBp / 100}%. Acima da alçada vira crédito extra (+{st.bonuses.extraPerLevelBp / 100}% por nível, até +{st.bonuses.extraCapBp / 100} p.p.).</p>
          <ul className="mt-1 list-disc pl-4">{st.competencyLevels.map((l) => <li key={l.key}>{l.name}: {l.scoresTasks ? `meta ${l.expectedMonthlyPoints} pts/mês · ` : ''}{compositionText(l)}</li>)}</ul>
          {!!st.badges?.length && <p className="mt-1">Badges do ano — {st.badges.map((b) => `${b.name} (${b.tiers.map((t) => t.minPoints).join(' / ')} pts)`).join(' · ')}. Todos podem chegar a todas as faixas.</p>}
          <p className="mt-1">Sem ranking: só o vencedor do ano recebe o Badge Ouro. Regra aprovada v{d.settingsVersion}.</p>
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
          {s.journeys.length > 0 && <>
            <p className="font-semibold text-ink">Jornadas</p>
            <ul className="mb-2 mt-1 space-y-0.5">{s.journeys.map((j) => <li key={j.key}><span className="font-semibold">{j.name}</span>: {j.components.map((c) => `${c.name} ${c.points}${c.level ? ` (${c.level.toUpperCase()})` : ''}`).join(' · ')} · ganho {j.wonPoints}</li>)}</ul>
          </>}
          <p className="font-semibold text-ink">Pontos por evento</p>
          <ul className="mt-1 space-y-0.5">{Object.entries(s.points).filter(([, v]) => v > 0).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{eventLabel(k)}</span><span className="num font-semibold">{v}</span></li>)}</ul>
        </div>
        <div>
          <p className="font-semibold text-ink">Colaboração e hierarquia</p>
          <ul className="mt-1 space-y-0.5">
            <li>Ajuda ao colega vale {fmtPts(s.participationMultiplierBp / 10_000)}×</li>
            {s.competencyLevels.map((l) => <li key={l.key}>{l.name}: {l.scoresTasks ? `meta ${l.expectedMonthlyPoints} pts · ` : ''}{compositionText(l)}</li>)}
            <li>Bônus: no prazo +{s.bonuses.onTimeBp / 100}% · aprovada +{s.bonuses.adherenceBp / 100}% · acima da alçada +{s.bonuses.extraPerLevelBp / 100}%/nível (até +{s.bonuses.extraCapBp / 100} p.p.) · teto {s.bonuses.scoreCapBp / 100}%</li>
            <li>Pedido de Apoio: {s.support ? `quem apoia ganha ${(s.support.helperMultiplierBp / 10_000).toLocaleString('pt-BR')}× os pontos da tarefa (ou ${s.support.basePoints} pts × ${(s.support.helperMultiplierBp / 10_000).toLocaleString('pt-BR')} sem tarefa) · quem pede ganha ${s.support.requesterPoints} pt(s) · teto ${s.support.monthlyCapPoints} pts/mês` : 'não pontua'}</li>
            <li>Certificados de cursos: {s.certificates ? `${s.certificates.pointsPerCertificate} pts + ${(s.certificates.pointsPerHourTenths / 10).toLocaleString('pt-BR')} pt/h (até ${s.certificates.maxHoursCounted} h), teto de ${s.certificates.monthlyCapPoints} pts/mês, depois de validados pela liderança` : 'não pontuam'}</li>
            <li>Badges: {s.badges?.length ? s.badges.map((b) => `${b.name} ${b.tiers.map((x) => x.minPoints).join('/')} pts`).join(' · ') : 'não usados'}</li>
            <li>Participam: {teamNames}</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-ink">Dispersão e faixas</p>
          <ul className="mt-1 space-y-0.5">
            <li>Atenção a partir de {s.dispersionYellowBp / 100}%, problema a partir de {s.dispersionRedBp / 100}%</li>
            {s.levels.map((l) => <li key={l.name}>{l.name}: nota {l.minPoints}+ no ano</li>)}
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
      <JourneysEditor value={v.journeys ?? []} pipelines={meta.pipelines} levels={v.competencyLevels} onChange={(journeys) => setV({ ...v, journeys })} />
      <LevelsEditor v={v} setV={setV} people={meta.people} />
      <PerformanceWeightsEditor v={v} setV={setV} />
      <SupportRuleEditor v={v} setV={setV} />
      <CertificateRuleEditor v={v} setV={setV} />
      <BadgeRuleEditor v={v} setV={setV} />
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
      <fieldset className="mt-4"><legend className="text-sm font-semibold text-ink">Faixas pela nota do ano (nota mínima)</legend>
        <div className="mt-1 space-y-1">
          {v.levels.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Nome da faixa ${i + 1}`} className="h-8 w-[180px]" value={l.name} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input aria-label={`Nota mínima da faixa ${i + 1}`} inputMode="numeric" className="num h-8 w-[110px]" value={String(l.minPoints)} onChange={(e) => setV({ ...v, levels: v.levels.map((x, j) => (j === i ? { ...x, minPoints: Number(e.target.value.replace(/\D/g, '') || 0) } : x)) })} />
              <button type="button" aria-label={`Tirar faixa ${i + 1}`} className="p-1 text-muted hover:text-danger" onClick={() => setV({ ...v, levels: v.levels.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setV({ ...v, levels: [...v.levels, { name: '', minPoints: (v.levels.at(-1)?.minPoints ?? 0) + 100 }] })}>Adicionar faixa</Button>
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

/** Jornadas com pesos: cada tarefa (componente) de uma etapa do funil vale pontos para quem a conclui; o ganho tem peso próprio. */
function JourneysEditor({ value, pipelines, levels, onChange }: { value: JourneyDef[]; pipelines: SettingsResp['pipelines']; levels: CompetencyLevel[]; onChange: (v: JourneyDef[]) => void }) {
  const set = (i: number, j: Partial<JourneyDef>) => onChange(value.map((x, k) => (k === i ? { ...x, ...j } : x)));
  const free = pipelines.filter((p) => !value.some((j) => j.pipelineId === p.id));
  const unique = (base: string, used: string[]) => { let k = base, n = 2; while (used.includes(k)) k = `${base}_${n++}`; return k; };
  return (
    <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Jornadas com pesos por tarefa</legend>
      <p className="text-xs text-muted">A tarefa nasce quando a oportunidade entra na etapa. Concluir pontua quem concluiu; excluir ou reabrir tira os pontos. No negócio ganho, o peso do ganho é dividido entre quem trabalhou nas tarefas.</p>
      <div className="mt-2 space-y-3">
        {value.map((j, i) => {
          const p = pipelines.find((x) => x.id === j.pipelineId);
          return (
            <div key={j.key} className="border border-line p-3" aria-label={`Jornada ${j.name}`} role="group">
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Nome da jornada" htmlFor={`j-name-${i}`}><Input id={`j-name-${i}`} className="h-9 w-[220px]" value={j.name} onChange={(e) => set(i, { name: e.target.value })} /></FormField>
                <FormField label="Funil" htmlFor={`j-pipe-${i}`}><Select id={`j-pipe-${i}`} className="h-9 w-[220px]" value={j.pipelineId} onChange={(e) => { const np = pipelines.find((x) => x.id === e.target.value); const auto = !j.name.trim() || pipelines.some((x) => j.name === `Jornada ${x.name}`); set(i, { pipelineId: e.target.value, components: j.components.map((c) => ({ ...c, stageKey: null })), ...(auto && np ? { name: `Jornada ${np.name}` } : {}) }); }}>{pipelines.filter((x) => x.id === j.pipelineId || free.includes(x)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
                <FormField label="Pontos do negócio ganho" htmlFor={`j-won-${i}`}><Input id={`j-won-${i}`} inputMode="numeric" className="num h-9 w-[110px]" value={String(j.wonPoints)} onChange={(e) => set(i, { wonPoints: Number(e.target.value.replace(/\D/g, '') || 0) })} /></FormField>
                <button type="button" className="mb-2 p-1 text-muted hover:text-danger" aria-label={`Tirar jornada ${j.name}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Tarefa</th><th className="py-1 text-left font-medium">Etapa</th><th className="py-1 text-left font-medium">Alçada</th><th className="py-1 text-left font-medium">Pontos</th><th className="py-1 text-left font-medium">Prazo (dias)</th><th /></tr></thead>
                <tbody>
                  {j.components.map((c, ci) => {
                    const setC = (x: Partial<JourneyDef['components'][number]>) => set(i, { components: j.components.map((y, k) => (k === ci ? { ...y, ...x } : y)) });
                    return (
                      <tr key={c.key} className="border-t border-line">
                        <td className="py-1 pr-2"><Input aria-label={`Tarefa ${ci + 1} da jornada ${j.name}`} className="h-8" value={c.name} onChange={(e) => setC({ name: e.target.value })} /></td>
                        <td className="py-1 pr-2"><Select aria-label={`Etapa da tarefa ${ci + 1} da jornada ${j.name}`} className="h-8" value={c.stageKey ?? ''} onChange={(e) => setC({ stageKey: e.target.value || null })}><option value="">Na criação</option>{(p?.stages ?? []).filter((s) => s.key !== 'ganha' && s.key !== 'perdida').map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></td>
                        <td className="py-1 pr-2"><Select aria-label={`Alçada da tarefa ${ci + 1} da jornada ${j.name}`} className="h-8" value={c.level ?? ''} onChange={(e) => setC({ level: e.target.value || null })}><option value="">Qualquer nível</option>{levels.filter((l) => l.scoresTasks).map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</Select></td>
                        <td className="py-1 pr-2"><Input aria-label={`Pontos da tarefa ${ci + 1} da jornada ${j.name}`} inputMode="numeric" className="num h-8 w-[80px]" value={String(c.points)} onChange={(e) => setC({ points: Number(e.target.value.replace(/\D/g, '') || 0) })} /></td>
                        <td className="py-1 pr-2"><Input aria-label={`Prazo da tarefa ${ci + 1} da jornada ${j.name}`} inputMode="numeric" className="num h-8 w-[70px]" value={String(c.dueDays)} onChange={(e) => setC({ dueDays: Number(e.target.value.replace(/\D/g, '') || 0) })} /></td>
                        <td><button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Tirar tarefa ${ci + 1} da jornada ${j.name}`} onClick={() => set(i, { components: j.components.filter((_, k) => k !== ci) })}><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Button className="mt-2" size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => set(i, { components: [...j.components, { key: unique(`tarefa_${j.components.length + 1}`, j.components.map((c) => c.key)), name: '', stageKey: null, points: 5, dueDays: 2 }] })}>Adicionar tarefa</Button>
            </div>
          );
        })}
        {free.length > 0 && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => { const p = free[0]!; onChange([...value, { key: unique(slugKey(p.name), value.map((j) => j.key)), name: `Jornada ${p.name}`, pipelineId: p.id, wonPoints: 0, components: [] }]); }}>Adicionar jornada</Button>}
      </div>
    </fieldset>
  );
}

/** Níveis de competência (meta e composição da nota), quem está em cada nível e os bônus. */
function LevelsEditor({ v, setV, people }: { v: GamSettings; setV: (x: GamSettings) => void; people: SettingsResp['people'] }) {
  const n = (s: string) => Number(s.replace(',', '.').replace(/[^\d.]/g, '') || 0);
  const setL = (i: number, x: Partial<CompetencyLevel>) => setV({ ...v, competencyLevels: v.competencyLevels.map((l, k) => (k === i ? { ...l, ...x } : l)) });
  const setW = (i: number, key: keyof CompetencyLevel['weights'], val: string) => setL(i, { weights: { ...v.competencyLevels[i]!.weights, [key]: Math.round(n(val) * 100) } });
  const bon = (key: keyof GamSettings['bonuses'], label: string, hint?: string) => (
    <FormField label={label} htmlFor={`b-${key}`} hint={hint}><Input id={`b-${key}`} inputMode="numeric" className="num" value={String(v.bonuses[key] / 100)} onChange={(e) => setV({ ...v, bonuses: { ...v.bonuses, [key]: Math.round(n(e.target.value) * 100) } })} /></FormField>
  );
  return (
    <>
      <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Níveis de competência: meta de pontos e composição da nota (soma 100%)</legend>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-muted"><tr>{['Nível', 'Ordem', 'Pontua tarefas', 'Meta/mês', 'Próprio %', 'Time %', 'Dispersão %', 'Área %'].map((h) => <th key={h} className="py-1 pr-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {v.competencyLevels.map((l, i) => {
                const sum = l.weights.ownBp + l.weights.teamBp + l.weights.dispersionBp + l.weights.areaBp;
                return (
                  <tr key={l.key} className="border-t border-line">
                    <td className="py-1 pr-2"><Input aria-label={`Nome do nível ${l.key}`} className="h-8 w-[220px]" value={l.name} onChange={(e) => setL(i, { name: e.target.value })} /></td>
                    <td className="py-1 pr-2"><Input aria-label={`Ordem do nível ${l.key}`} inputMode="numeric" className="num h-8 w-[56px]" value={String(l.rank)} onChange={(e) => setL(i, { rank: n(e.target.value) })} /></td>
                    <td className="py-1 pr-2"><input type="checkbox" aria-label={`Nível ${l.key} pontua tarefas`} checked={l.scoresTasks} onChange={(e) => setL(i, { scoresTasks: e.target.checked })} /></td>
                    <td className="py-1 pr-2"><Input aria-label={`Meta do nível ${l.key}`} inputMode="numeric" className="num h-8 w-[70px]" value={String(l.expectedMonthlyPoints)} onChange={(e) => setL(i, { expectedMonthlyPoints: n(e.target.value) })} /></td>
                    {(['ownBp', 'teamBp', 'dispersionBp', 'areaBp'] as const).map((k) => <td key={k} className="py-1 pr-2"><Input aria-label={`${k} do nível ${l.key}`} inputMode="numeric" className={`num h-8 w-[60px] ${sum !== 10_000 ? 'border-danger' : ''}`} value={String(l.weights[k] / 100)} onChange={(e) => setW(i, k, e.target.value)} /></td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Quem está em cada nível</legend>
        <p className="text-xs text-muted">Sem escolha, vale o padrão: {v.competencyLevels.find((l) => l.key === v.defaultLevelKey)?.name} (quem lidera time: {v.competencyLevels.find((l) => l.key === v.defaultLeadLevelKey)?.name}).</p>
        <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 border-b border-line py-1 text-sm"><span>{p.name}{p.lead && <span className="text-xs text-muted"> · lidera time</span>}</span>
              <Select aria-label={`Nível de ${p.name}`} className="h-8 w-[240px]" value={v.assignments[p.id] ?? ''} onChange={(e) => { const a = { ...v.assignments }; if (e.target.value) a[p.id] = e.target.value; else delete a[p.id]; setV({ ...v, assignments: a }); }}>
                <option value="">Padrão</option>{v.competencyLevels.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </Select>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Bônus e tetos (%)</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-5">
          {bon('onTimeBp', 'No prazo', 'sobre a tarefa')}
          {bon('adherenceBp', 'Aprovada pela gerência', 'aderência, opcional')}
          {bon('extraPerLevelBp', 'Acima da alçada', 'por nível acima')}
          {bon('extraCapBp', 'Teto do extra', 'pontos percentuais')}
          {bon('scoreCapBp', 'Teto do atingimento')}
        </div>
      </fieldset>
    </>
  );
}

/** Performance por nível hierárquico: pesos de atividade e metas (soma 100% por nível) e faixas. */
function PerformanceWeightsEditor({ v, setV }: { v: GamSettings; setV: (x: GamSettings) => void }) {
  const n = (s: string) => Math.round(Number(s.replace(',', '.').replace(/[^\d.]/g, '') || 0) * 100);
  const cols = [['activity', 'Atividade'], ['individual', 'Metas individuais'], ['team', 'Metas do time'], ['unit', 'Metas da área'], ['company', 'Metas da empresa']] as const;
  const pw = v.performanceWeights ?? {};
  return (
    <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Performance por nível hierárquico (% de cada componente; soma 100%)</legend>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-1 pr-2 text-left font-medium">Nível</th>{cols.map(([, l]) => <th key={l} className="py-1 pr-2 text-left font-medium">{l}</th>)}</tr></thead>
          <tbody>
            {v.competencyLevels.map((l) => {
              const w = pw[l.key] ?? { activity: 0, individual: 0, team: 0, unit: 0, company: 0 };
              const sum = cols.reduce((t, [k]) => t + (w[k] ?? 0), 0);
              return (
                <tr key={l.key} className="border-t border-line">
                  <td className="py-1 pr-2">{l.name}</td>
                  {cols.map(([k, label]) => <td key={k} className="py-1 pr-2"><Input aria-label={`${label}: performance de ${l.name}`} inputMode="numeric" className={`num h-8 w-[70px] ${sum !== 10_000 ? 'border-danger' : ''}`} value={String((w[k] ?? 0) / 100)} onChange={(e) => setV({ ...v, performanceWeights: { ...pw, [l.key]: { ...w, [k]: n(e.target.value) } } })} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <FormField label="No alvo a partir de (%)" htmlFor="pb-green"><Input id="pb-green" inputMode="numeric" className="num" value={String((v.performanceBands?.greenBp ?? 0) / 100)} onChange={(e) => setV({ ...v, performanceBands: { ...v.performanceBands, greenBp: n(e.target.value) } })} /></FormField>
        <FormField label="Atenção a partir de (%)" htmlFor="pb-yellow"><Input id="pb-yellow" inputMode="numeric" className="num" value={String((v.performanceBands?.yellowBp ?? 0) / 100)} onChange={(e) => setV({ ...v, performanceBands: { ...v.performanceBands, yellowBp: n(e.target.value) } })} /></FormField>
      </div>
      <p className="mt-1 text-xs text-muted">Componente sem meta no mês não pesa contra: o peso vai para os demais. Atividade = nota da gamificação; metas = atingimento médio das metas de Objetivos e metas.</p>
    </fieldset>
  );
}

/** Pedido de Apoio: quanto vale apoiar (multiplicador sobre os pontos da tarefa), a base sem tarefa, quem pede e o teto do mês. */
const SUPPORT_SUGGESTED = { helperMultiplierBp: 15_000, basePoints: 3, requesterPoints: 1, monthlyCapPoints: 30 };
function SupportRuleEditor({ v, setV }: { v: GamSettings; setV: (x: GamSettings) => void }) {
  const on = !!v.support;
  const sp = v.support ?? SUPPORT_SUGGESTED;
  const n = (x: string) => Number(x.replace(',', '.').replace(/[^\d.]/g, '') || 0);
  const set = (k: keyof typeof sp, val: number) => setV({ ...v, support: { ...sp, [k]: val } });
  return (
    <fieldset className="mt-4 border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Pedido de Apoio</legend>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={(e) => setV({ ...v, support: e.target.checked ? sp : undefined })} />Apoio confirmado vale pontos</label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label="Quem apoia ganha (×)" htmlFor="sp-m" hint="sobre os pontos da tarefa; 1,5 = 1,5×"><Input id="sp-m" inputMode="decimal" className="num" value={String(sp.helperMultiplierBp / 10_000).replace('.', ',')} onChange={(e) => set('helperMultiplierBp', Math.round(n(e.target.value) * 10_000))} /></FormField>
          <FormField label="Pontos-base sem tarefa" htmlFor="sp-b" hint="quando o pedido não é de uma tarefa com pontos"><Input id="sp-b" inputMode="numeric" className="num" value={String(sp.basePoints)} onChange={(e) => set('basePoints', Math.round(n(e.target.value)))} /></FormField>
          <FormField label="Quem pede ganha" htmlFor="sp-r" hint="pontos por apoio confirmado"><Input id="sp-r" inputMode="numeric" className="num" value={String(sp.requesterPoints)} onChange={(e) => set('requesterPoints', Math.round(n(e.target.value)))} /></FormField>
          <FormField label="Teto por pessoa no mês" htmlFor="sp-c" hint="pontos de apoio (apoiar + pedir)"><Input id="sp-c" inputMode="numeric" className="num" value={String(sp.monthlyCapPoints)} onChange={(e) => set('monthlyCapPoints', Math.round(n(e.target.value)))} /></FormField>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Os pontos só entram depois que quem pediu confirma o apoio. Ninguém confirma o próprio apoio.</p>
    </fieldset>
  );
}

/** Certificados de cursos complementares da área: pontos extras depois de validados pela liderança. */
function CertificateRuleEditor({ v, setV }: { v: GamSettings; setV: (x: GamSettings) => void }) {
  const on = !!v.certificates;
  const c = v.certificates ?? DEFAULT_CERTIFICATE_SETTINGS;
  const n = (x: string) => Number(x.replace(',', '.').replace(/[^\d.]/g, '') || 0);
  const set = (k: keyof typeof c, val: number) => setV({ ...v, certificates: { ...c, [k]: val } });
  return (
    <fieldset className="mt-4 border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Certificados de cursos complementares</legend>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={(e) => setV({ ...v, certificates: e.target.checked ? c : undefined })} />Certificado de curso da área vale pontos extras</label>
      {on && (
        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label="Pontos por certificado" htmlFor="ct-p"><Input id="ct-p" inputMode="numeric" className="num" value={String(c.pointsPerCertificate)} onChange={(e) => set('pointsPerCertificate', Math.round(n(e.target.value)))} /></FormField>
          <FormField label="Pontos por hora" htmlFor="ct-h" hint="0,5 = meio ponto por hora"><Input id="ct-h" inputMode="decimal" className="num" value={String(c.pointsPerHourTenths / 10).replace('.', ',')} onChange={(e) => set('pointsPerHourTenths', Math.round(n(e.target.value) * 10))} /></FormField>
          <FormField label="Horas contadas até" htmlFor="ct-m"><Input id="ct-m" inputMode="numeric" className="num" value={String(c.maxHoursCounted)} onChange={(e) => set('maxHoursCounted', Math.round(n(e.target.value)))} /></FormField>
          <FormField label="Teto por pessoa no mês" htmlFor="ct-c"><Input id="ct-c" inputMode="numeric" className="num" value={String(c.monthlyCapPoints)} onChange={(e) => set('monthlyCapPoints', Math.round(n(e.target.value)))} /></FormField>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">A pessoa envia o certificado de um curso da sua área (setor ou time); a liderança do time valida. Conta no mês da validação. Ninguém valida o próprio.</p>
    </fieldset>
  );
}
