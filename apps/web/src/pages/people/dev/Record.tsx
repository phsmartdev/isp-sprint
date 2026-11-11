/**
 * Ficha do colaborador: tudo de uma vez — dados e perfil, liderança, gamificação (pontos, nota, badges), metas e
 * resultados, treinamentos, reconhecimentos, feedback em números, férias, intervenções e a linha do tempo da jornada.
 */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Award, BookOpen, CalendarDays, Flag, Gauge, GraduationCap, Layers, Mail, MessageSquareHeart, Phone, Sparkles, Star, Trophy, UserRound, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtDate } from '../../../lib/format';
import { Avatar, Chip, EmptyState, ErrorState, LoadingRows } from '../../../components/ui/primitives';
import { orgLine, type PersonCard } from '../shared';
import { look } from '../feed/Achievement';
import { day } from './api';

type Badge = { key: string; name: string; description: string; points: number; tier: string | null; tierIndex: number | null; next: { name: string; minPoints: number; missing: number } | null };
type Rec = {
  relation: 'eu' | 'liderado' | 'rh';
  person: PersonCard & { email: string; phone: string | null; teams: string[]; memberSince: string; bio: string | null; interests: string[]; skills: string[] };
  leadership: { current: PersonCard[]; history: { manager: string; from: string; to: string | null; source: string }[] };
  gamification: { month: { points: number; score: number; level: string } | null; year: { points: number; score: number } | null; badges: Badge[] } | null;
  contributions: { module: string; label: string; total: number; items: { type: string; label: string; count: number }[] }[];
  scorecards: { composite: number | null; cards: { scorecardId: string; name: string; score: number | null; incomplete: boolean; range: { from: string; to: string }; items: { indicatorId: string; name: string; value: number | null; target: number | null; attainment: number | null; status: string; unit: string }[] }[] };
  awards: { badgeKey: string; year: number; tier: string; at: string }[];
  goals: { id: string; title: string; target: number; unit: string | null; periodStart: string; periodEnd: string; category: string; last: { competencia: string; value: number | null; attainment: number | null; color: string } | null }[];
  trainings: { id: string; title: string; hours: number; issuedOn: string; code: string }[];
  courses: { id: string; title: string; institution: string; hours: number; completedOn: string; status: string }[];
  recognitions: { total: number; items: { id: string; from: string; category: string; emoji: string; message: string | null; at: string }[] };
  feedback: { received: number; byModality: Record<string, number>; pendingAck: number; fromLeadership: number; fromTeam: number; sentToTeam: number; sentToLeadership: number; lastReceivedAt: string | null };
  vacations: { id: string; startDate: string; days: number; status: string }[];
  interventions: { id: string; title: string | null; status: string; dueOn: string; kind: string }[];
  timeline: { at: string; kind: string; title: string; detail?: string | null }[];
};
const MOD: Record<string, string> = { reconhecimento: 'Reconhecimento', orientacao: 'Orientação', melhoria: 'Melhoria', reforco: 'Reforço', desenvolvimento: 'Desenvolvimento', alinhamento: 'Alinhamento' };
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const COLOR: Record<string, string> = { verde: 'bg-success', amarelo: 'bg-[#F5B400]', vermelho: 'bg-danger' };
const TL_ICON: Record<string, typeof Star> = { entrada: Sparkles, lideranca: Users, badge: Trophy, treinamento: GraduationCap, curso: BookOpen, reconhecimento: Award, feedback: MessageSquareHeart, ferias: CalendarDays };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="num mt-1 font-display text-2xl font-bold text-ink">{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>;
}
function Section({ title, icon: Icon, children, aside }: { title: string; icon: typeof Star; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card p-5" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-md font-bold text-ink"><Icon className="h-5 w-5 text-primary" aria-hidden />{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export function RecordPage() {
  const { userId = '' } = useParams();
  const q = useQuery({ queryKey: ['pessoas', 'dev', 'ficha', userId], queryFn: () => api<Rec>(`/pessoas/desenvolvimento/pessoas/${userId}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const r = q.data;
  const p = r.person;
  const g = r.gamification;
  const earned = g?.badges.filter((b) => b.tierIndex !== null) ?? [];
  const contrib = r.contributions.reduce((a, c) => a + c.total, 0);
  const hours = r.trainings.reduce((a, c) => a + c.hours, 0) + r.courses.filter((c) => c.status === 'aprovado').reduce((a, c) => a + c.hours, 0);
  return (
    <div className="space-y-4">
      <Link to="/pessoas/desenvolvimento/pessoas" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Colaboradores</Link>

      {/* capa da ficha */}
      <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-navy to-primary p-6 text-white" aria-label="Colaborador">
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="rounded-circle bg-gradient-to-tr from-[#F5B400] via-[#E1306C] to-[#833AB4] p-[3px]"><span className="block rounded-circle bg-navy p-[3px]"><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={112} /></span></span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-wide">{p.name}</h1>
            <p className="text-white/85">{orgLine(p) || 'Colaborador'}</p>
            <p className="mt-1 text-sm text-white/75">{p.teams.length > 0 && <>Times: {p.teams.join(', ')} · </>}Na ISP-SPRINT desde {fmtDate(p.memberSince)}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/85">
              <span className="flex items-center gap-1"><Mail className="h-4 w-4" aria-hidden />{p.email}</span>
              {p.phone && <span className="flex items-center gap-1"><Phone className="h-4 w-4" aria-hidden />{p.phone}</span>}
              {r.leadership.current.length > 0 && <span className="flex items-center gap-1"><UserRound className="h-4 w-4" aria-hidden />Liderança: {r.leadership.current.map((m) => m.name).join(', ')}</span>}
            </div>
          </div>
          {earned.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Badges conquistados">
              {earned.map((b) => <span key={b.key} title={`${b.name} · ${b.tier}`} className="flex h-14 w-14 items-center justify-center rounded-circle border-2 border-white/70 text-2xl shadow" style={{ background: `radial-gradient(circle at 30% 30%, ${look(b.key).from}, ${look(b.key).to})` }}>{look(b.key).emoji}</span>)}
            </div>
          )}
        </div>
        {p.bio && <p className="relative mt-4 max-w-3xl text-sm text-white/90">{p.bio}</p>}
      </section>

      {/* destaques que valem para qualquer área */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile label="Indicadores da função" value={r.scorecards.composite !== null ? `${n1(r.scorecards.composite)}%` : '—'} hint={r.scorecards.cards.length ? r.scorecards.cards.map((c) => c.name).join(', ') : 'sem scorecard para o cargo'} />
        <Tile label="Contribuições no ano" value={String(contrib)} hint={r.contributions.length ? `${r.contributions.length} área(s)` : 'nenhuma registrada'} />
        <Tile label="Pontos no ano" value={g?.year ? n1(g.year.points) : '—'} hint={g?.year ? `nota ${n1(g.year.score)}` : 'sem regra aprovada'} />
        <Tile label="Nota do mês" value={g?.month ? n1(g.month.score) : '—'} hint={g?.month?.level ?? undefined} />
        <Tile label="Treinamentos" value={`${hours} h`} hint={`${r.trainings.length + r.courses.filter((c) => c.status === 'aprovado').length} concluído(s)`} />
        <Tile label="Reconhecimentos" value={String(r.recognitions.total)} hint={`${earned.length} badge(s)`} />
        <Tile label="Feedbacks" value={String(r.feedback.received)} hint={r.feedback.pendingAck ? `${r.feedback.pendingAck} aguardando ciência` : 'recebidos'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Section title="Indicadores da função" icon={Gauge} aside={<span className="text-xs text-muted">pelo scorecard do cargo, time ou perfil</span>}>
            {!r.scorecards.cards.length ? <p className="text-sm text-muted">Nenhum scorecard se aplica a esta pessoa. Cadastre em Desempenho → Indicadores → Scorecards por função (vale para qualquer área: atendimento, operações, financeiro, comercial…).</p> : r.scorecards.cards.map((c) => (
              <div key={c.scorecardId} className="mb-3 last:mb-0">
                <p className="mb-1 text-sm font-semibold text-ink">{c.name} <span className="font-normal text-muted">· {day(c.range.from)} a {day(c.range.to)} · {c.score !== null ? `${n1(c.score)}%` : 'sem dados'}{c.incomplete ? ' (parcial)' : ''}</span></p>
                <ul className="divide-y divide-line text-sm">{c.items.map((i) => (
                  <li key={i.indicatorId} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-ink">{i.name}</span>
                    <span className="shrink-0 text-right text-xs text-muted">{i.value !== null ? <b className="num text-sm text-ink">{n1(i.value)}</b> : 'sem dado'}{i.target !== null && ` / meta ${n1(i.target)}`}{i.attainment !== null && ` · ${n1(i.attainment * 100)}%`}</span>
                  </li>
                ))}</ul>
              </div>
            ))}
          </Section>

          <Section title="Contribuições por área" icon={Layers} aside={<span className="text-xs text-muted">no ano, em todos os módulos</span>}>
            {!r.contributions.length ? <p className="text-sm text-muted">Nenhuma contribuição registrada neste ano.</p> : (
              <div className="grid gap-3 sm:grid-cols-2">{r.contributions.map((c) => (
                <div key={c.module} className="border border-line p-3">
                  <p className="flex items-center justify-between text-sm font-semibold text-ink">{c.label}<span className="num text-primary">{c.total}</span></p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">{c.items.map((i) => <li key={i.type} className="flex justify-between gap-2"><span className="truncate">{i.label}</span><span className="num text-ink">{i.count}</span></li>)}</ul>
                </div>
              ))}</div>
            )}
          </Section>

          <Section title="Badges do ano" icon={Trophy}>
            {!g ? <p className="text-sm text-muted">A gamificação ainda não tem regra aprovada.</p> : (
              <div className="grid gap-2 sm:grid-cols-2">{g.badges.map((b) => (
                <div key={b.key} className={clsx('flex items-center gap-3 border p-3', b.tierIndex === null ? 'border-line opacity-70' : 'border-primary/40')}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-circle text-xl" style={{ background: b.tierIndex === null ? 'var(--tw-color-surface-2, #eef1f5)' : `radial-gradient(circle at 30% 30%, ${look(b.key).from}, ${look(b.key).to})` }} aria-hidden>{look(b.key).emoji}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{b.name} {b.tier && <Chip tone="green">{b.tier}</Chip>}</span><span className="block text-xs text-muted">{n1(b.points)} pts{b.next ? ` · faltam ${n1(b.next.missing)} para ${b.next.name}` : ''}</span></span>
                </div>
              ))}</div>
            )}
          </Section>

          <Section title="Metas e resultados" icon={Flag}>
            {!r.goals.length ? <p className="text-sm text-muted">Nenhuma meta individual neste ano.</p> : (
              <ul className="divide-y divide-line">{r.goals.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className={clsx('h-3 w-3 rounded-circle', m.last ? COLOR[m.last.color] ?? 'bg-line' : 'bg-line')} aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{m.title}</span><span className="text-xs text-muted">{day(m.periodStart)} a {day(m.periodEnd)} · meta {n1(m.target)}{m.unit ? ` ${m.unit}` : ''}</span></span>
                  <span className="text-right text-xs text-muted">{m.last ? <><b className="num text-sm text-ink">{m.last.attainment !== null ? `${n1(m.last.attainment)}%` : '—'}</b><br />{m.last.competencia}</> : 'sem apuração'}</span>
                </li>
              ))}</ul>
            )}
          </Section>

          <Section title="Treinamentos e certificados" icon={GraduationCap}>
            {!r.trainings.length && !r.courses.length ? <p className="text-sm text-muted">Nenhum treinamento ou curso registrado.</p> : (
              <ul className="divide-y divide-line text-sm">
                {r.trainings.map((c) => <li key={c.id} className="flex justify-between gap-3 py-2"><span><b className="text-ink">{c.title}</b><span className="block text-xs text-muted">Playbook · certificado {c.code}</span></span><span className="text-right text-xs text-muted">{c.hours} h<br />{day(c.issuedOn)}</span></li>)}
                {r.courses.map((c) => <li key={c.id} className="flex justify-between gap-3 py-2"><span><b className="text-ink">{c.title}</b><span className="block text-xs text-muted">{c.institution} · {c.status === 'aprovado' ? 'validado' : c.status}</span></span><span className="text-right text-xs text-muted">{c.hours} h<br />{day(c.completedOn)}</span></li>)}
              </ul>
            )}
          </Section>

          <Section title="Reconhecimentos" icon={Award}>
            {!r.recognitions.items.length ? <p className="text-sm text-muted">Nenhum reconhecimento ainda.</p> : (
              <ul className="space-y-2">{r.recognitions.items.map((x) => <li key={x.id} className="border-l-2 border-primary pl-3 text-sm"><span className="font-semibold text-ink">{x.emoji} {x.category}</span> <span className="text-muted">· {x.from} · {fmtDate(x.at)}</span>{x.message && <p className="text-text">{x.message}</p>}</li>)}</ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Feedback" icon={MessageSquareHeart}>
            <p className="mb-2 text-xs text-muted">Só números. O conteúdo fica com quem enviou e quem recebeu.</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-muted">Da liderança</dt><dd className="num font-bold text-ink">{r.feedback.fromLeadership}</dd></div>
              <div><dt className="text-muted">Do time (via RH ou identificado)</dt><dd className="num font-bold text-ink">{r.feedback.fromTeam}</dd></div>
              <div><dt className="text-muted">Enviou ao time</dt><dd className="num font-bold text-ink">{r.feedback.sentToTeam}</dd></div>
              <div><dt className="text-muted">Enviou à liderança</dt><dd className="num font-bold text-ink">{r.feedback.sentToLeadership}</dd></div>
            </dl>
            <ul className="mt-3 space-y-1">{Object.entries(r.feedback.byModality).filter(([, v]) => v > 0).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 text-xs"><span className="w-28 text-muted">{MOD[k]}</span><span className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (v / Math.max(1, r.feedback.received)) * 160)}px` }} /><span className="num text-ink">{v}</span></li>
            ))}</ul>
            {r.feedback.lastReceivedAt && <p className="mt-2 text-xs text-muted">Último recebido em {fmtDate(r.feedback.lastReceivedAt)}</p>}
          </Section>

          <Section title="Liderança" icon={Users}>
            {!r.leadership.history.length ? <p className="text-sm text-muted">Sem liderança registrada.</p> : (
              <ol className="space-y-1.5 text-sm">{r.leadership.history.map((h, i) => <li key={i}><b className="text-ink">{h.manager}</b> <span className="text-muted">· desde {fmtDate(h.from)}{h.to ? ` até ${fmtDate(h.to)}` : ' (atual)'}</span></li>)}</ol>
            )}
          </Section>

          {(r.person.interests.length > 0 || r.person.skills.length > 0) && (
            <Section title="Interesses e competências" icon={Star}>
              <div className="flex flex-wrap gap-1.5">{[...r.person.skills, ...r.person.interests].map((x) => <Chip key={x}>{x}</Chip>)}</div>
            </Section>
          )}

          {r.vacations.length > 0 && (
            <Section title="Férias" icon={CalendarDays}>
              <ul className="space-y-1 text-sm">{r.vacations.map((v) => <li key={v.id} className="flex justify-between"><span>{day(v.startDate)} · {v.days} dias</span><span className="text-xs text-muted">{v.status}</span></li>)}</ul>
            </Section>
          )}
          {r.interventions.length > 0 && (
            <Section title="Intervenções (Gestão de Times)" icon={Flag}>
              <ul className="space-y-1 text-sm">{r.interventions.map((v) => <li key={v.id} className="flex justify-between gap-2"><span className="truncate">{v.title ?? 'Intervenção'}</span><span className="text-xs text-muted">{v.status} · {day(v.dueOn)}</span></li>)}</ul>
            </Section>
          )}

          <Section title="Jornada" icon={Sparkles}>
            {!r.timeline.length ? <EmptyState title="Jornada começando" /> : (
              <ol className="relative space-y-3 border-l-2 border-line pl-5">{r.timeline.map((e, i) => {
                const Icon = TL_ICON[e.kind] ?? Star;
                return (
                  <li key={i} className="relative">
                    <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-circle bg-primary-soft text-primary"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                    <p className="text-sm font-semibold text-ink">{e.title}</p>
                    <p className="text-xs text-muted">{fmtDate(e.at)}{e.detail ? ` · ${e.detail}` : ''}</p>
                  </li>
                );
              })}</ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
