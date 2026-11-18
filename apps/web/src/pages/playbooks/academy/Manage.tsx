/**
 * Academia — Gestão: trilhas que a pessoa edita ou decide (aprovar, pedir ajustes, rejeitar), atribuição com prazo,
 * acompanhamento da liderança, e o editor da trilha (dados, público, regras, cursos, módulos e aulas a partir de vídeos
 * e playlists do YouTube).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  CONTENT_STATE_LABELS, ENROLLMENT_STATUS_LABELS, MIN_WATCH_PCTS, PROFILE_KEYS, PROFILE_LABELS, PROGRESS_METHODS, PROGRESS_METHOD_LABELS, TRACK_LEVELS, TRACK_LEVEL_LABELS,
  TRACK_MODES, TRACK_MODE_LABELS, TRACK_STATUS_LABELS, VISIBILITIES, VISIBILITY_LABELS, fmtDuration, playableState,
  type ContentState, type EnrollmentStatus, type TrackSnapshot, type TrackStatus,
} from '@isp/domain';
import { api, qs } from '../../../lib/api';
import { fmtDate, fmtDateTime } from '../../../lib/format';
import { Breadcrumb, Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../../components/ui/primitives';
import { Modal, useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { usePbSetup } from '../Library';
import { Multi } from '../Editor';
import { Bar } from './Learn';

type GestaoItem = { id: string; title: string; status: TrackStatus; mode: string; team: string | null; curator: string | null; version: number | null; open: { id: string; number: number; status: string; submittedBy: string | null; submittedAt: string | null } | null; enrolled: number; completed: number; can: { edit: boolean; decide: boolean }; updatedAt: string };
type Gestao = { items: GestaoItem[]; can: { create: boolean; follow: boolean } };
export const useAcademyGestao = () => useQuery({ queryKey: ['academia', 'gestao'], queryFn: () => api<Gestao>('/academia/gestao') });

/** Aba “Academia — Gestão”. */
export function AcademyAdmin() {
  const g = useAcademyGestao();
  const nav = useNavigate();
  const [decide, setDecide] = useState<GestaoItem | null>(null);
  const [assign, setAssign] = useState<GestaoItem | null>(null);
  if (g.isLoading) return <LoadingRows rows={5} />;
  if (g.isError) return <ErrorState error={g.error} onRetry={() => g.refetch()} />;
  const d = g.data!;
  const pending = d.items.filter((x) => x.can.decide);
  return (
    <div className="space-y-8">
      {!!pending.length && (
        <section aria-label="Aguardando a sua decisão" className="space-y-2">
          <h2 className="font-display text-lg font-bold text-ink">Aguardando a sua decisão</h2>
          <ul className="divide-y divide-line border border-line bg-surface">{pending.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{x.title}</p><p className="text-xs text-muted">Versão {x.open!.number} · enviada por {x.open!.submittedBy} em {x.open!.submittedAt ? fmtDateTime(x.open!.submittedAt) : '—'}</p></div>
              <Link to={`/playbooks/academia/gestao/${x.id}`} className="text-sm font-semibold text-primary hover:underline">Ver trilha</Link>
              <Button size="sm" variant="primary" onClick={() => setDecide(x)}>Decidir</Button>
            </li>
          ))}</ul>
        </section>
      )}
      <section aria-label="Trilhas" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-ink">Trilhas</h2>
          {d.can.create && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/playbooks/academia/gestao/nova')}>Nova trilha</Button>}
        </div>
        {!d.items.length ? <EmptyState title="Nenhuma trilha ainda" description={d.can.create ? 'Crie a primeira trilha colando vídeos ou uma playlist do YouTube. Ela passa pela Gerência antes de ser publicada.' : 'As trilhas que você cuida aparecem aqui.'} /> : (
          <div className="overflow-x-auto border border-line bg-surface"><table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Trilha', 'Situação', 'Modalidade', 'Time', 'Inscritos', 'Concluíram', ''].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} className="border-t border-line">
                <td className="px-4 py-2.5">{x.can.edit ? <Link className="font-semibold text-ink hover:text-primary" to={`/playbooks/academia/gestao/${x.id}`}>{x.title}</Link> : <span className="font-semibold text-ink">{x.title}</span>}</td>
                <td className="px-4 py-2.5">{TRACK_STATUS_LABELS[x.status]}{x.version ? <span className="text-muted"> · v{x.version}</span> : null}{x.open && <span className="block text-xs text-primary">v{x.open.number} em aprovação</span>}</td>
                <td className="px-4 py-2.5">{TRACK_MODE_LABELS[x.mode as keyof typeof TRACK_MODE_LABELS]}</td>
                <td className="px-4 py-2.5">{x.team ?? '—'}</td>
                <td className="num px-4 py-2.5">{x.enrolled}</td>
                <td className="num px-4 py-2.5">{x.completed}</td>
                <td className="px-4 py-2.5 text-right">{x.status === 'publicada' && <Button size="sm" onClick={() => setAssign(x)}>Atribuir</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {d.can.follow && <FollowUp />}
      {decide && <DecideModal item={decide} onClose={() => setDecide(null)} />}
      {assign && <AssignModal item={assign} onClose={() => setAssign(null)} />}
    </div>
  );
}

function DecideModal({ item, onClose }: { item: GestaoItem; onClose: () => void }) {
  const qc = useQueryClient(), toast = useToast();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (decision: 'aprovar' | 'ajustes' | 'rejeitar') => api<{ enrolled: number }>(`/academia/versoes/${item.open!.id}/decidir`, { method: 'POST', body: { decision, note: note.trim() || null } }),
    onSuccess: (r, dec) => { void qc.invalidateQueries({ queryKey: ['academia'] }); toast({ tone: 'success', message: dec === 'aprovar' ? `Trilha publicada${r.enrolled ? ` · ${r.enrolled} pessoa(s) receberam a obrigatória` : ''}` : dec === 'ajustes' ? 'Ajustes pedidos' : 'Versão rejeitada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Decidir: ${item.title} (v${item.open!.number})`} footer={<>
      <Button onClick={() => m.mutate('rejeitar')} disabled={!note.trim()} loading={m.isPending && m.variables === 'rejeitar'}>Rejeitar</Button>
      <Button onClick={() => m.mutate('ajustes')} disabled={!note.trim()} loading={m.isPending && m.variables === 'ajustes'}>Pedir ajustes</Button>
      <Button variant="primary" onClick={() => m.mutate('aprovar')} loading={m.isPending && m.variables === 'aprovar'}>Aprovar e publicar</Button>
    </>}>
      <p className="mb-3 text-sm text-text">Ao aprovar, a estrutura enviada é congelada nesta versão. Quem já está numa versão anterior continua nela. Em trilha obrigatória, o público recebe a trilha com o prazo configurado.</p>
      <FormField label="Comentário" htmlFor="ac-note" hint="Obrigatório para pedir ajustes ou rejeitar."><Textarea id="ac-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
    </Modal>
  );
}

function AssignModal({ item, onClose }: { item: GestaoItem; onClose: () => void }) {
  const qc = useQueryClient(), toast = useToast();
  const setup = usePbSetup();
  const [userIds, setUsers] = useState<string[]>([]), [teamIds, setTeams] = useState<string[]>([]), [due, setDue] = useState('');
  const m = useMutation({
    mutationFn: () => api<{ added: number; already: number }>(`/academia/trilhas/${item.id}/atribuir`, { method: 'POST', body: { userIds, teamIds, dueOn: due || null } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['academia'] }); toast({ tone: 'success', message: `${r.added} pessoa(s) receberam a trilha${r.already ? ` · ${r.already} já estavam` : ''}` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Atribuir: ${item.title}`} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!userIds.length && !teamIds.length} loading={m.isPending} onClick={() => m.mutate()}>Atribuir</Button></>}>
      {!setup.data ? <LoadingRows rows={3} /> : (
        <div className="space-y-4">
          <Multi label="Times (todas as pessoas ativas do time)" options={setup.data.teams.map((t) => ({ id: t.id, label: t.name }))} value={teamIds} onChange={setTeams} />
          <Multi label="Pessoas" options={setup.data.users.map((u) => ({ id: u.id, label: u.name }))} value={userIds} onChange={setUsers} />
          <FormField label="Prazo" htmlFor="as-due" hint="Sem data, vale o prazo padrão da trilha (se houver)."><Input id="as-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="max-w-xs" /></FormField>
          <p className="text-xs text-muted">A liderança atribui às pessoas dos times que lidera; quem cuida da trilha, a Gerência e a Diretoria atribuem a qualquer pessoa. Cada pessoa é avisada no sino.</p>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ acompanhamento
type Follow = {
  scope: { all: boolean; people: number };
  totals: { eligible: number; enrolled: number; completed: number; inProgress: number; late: number; hours: number };
  tracks: { id: string; title: string; mode: string; archived: boolean; eligible: number; enrolled: number; adhesionPct: number | null; completed: number; completionPct: number | null; inProgress: number; late: number; hours: number }[];
  people: { userId: string; name: string; teams: string[]; source: string | null; dueOn: string | null; pct: number; hours: number; lastAt: string | null; status: EnrollmentStatus | 'nao_inscrito'; completedAt: string | null }[];
  teams: { id: string; name: string }[];
};
function FollowUp() {
  const [trilha, setTrilha] = useState(''), [time, setTime] = useState('');
  const r = useQuery({ queryKey: ['academia', 'acompanhamento', trilha, time], queryFn: () => api<Follow>(`/academia/acompanhamento${qs({ trilha: trilha || undefined, time: time || undefined })}`) });
  const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
  return (
    <section aria-label="Acompanhamento" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-lg font-bold text-ink">Acompanhamento</h2><p className="text-sm text-muted">{r.data ? (r.data.scope.all ? 'Toda a empresa' : `Pessoas dos times que você lidera (${r.data.scope.people})`) : ' '}. Números do progresso registrado pelo player.</p></div>
        {r.data && <FormField label="Time" htmlFor="af-t"><Select id="af-t" value={time} onChange={(e) => setTime(e.target.value)}><option value="">Todos</option>{r.data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>}
      </div>
      {r.isLoading ? <LoadingRows rows={4} /> : r.isError ? <ErrorState error={r.error} onRetry={() => r.refetch()} /> : (() => {
        const d = r.data!;
        const stat = (label: string, v: string, tone?: string) => <div className="bg-surface px-5 py-3"><p className="text-sm text-muted">{label}</p><p className={clsx('num font-display text-2xl font-extrabold', tone ?? 'text-ink')}>{v}</p></div>;
        return (
          <>
            <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6">
              {stat('Elegíveis', String(d.totals.eligible))}{stat('Inscritos', String(d.totals.enrolled))}{stat('Em andamento', String(d.totals.inProgress))}
              {stat('Concluíram', String(d.totals.completed), d.totals.completed ? 'text-[#15803D]' : undefined)}{stat('Atrasados', String(d.totals.late), d.totals.late ? 'text-danger' : undefined)}{stat('Horas assistidas', d.totals.hours.toLocaleString('pt-BR'))}
            </div>
            {!d.tracks.length ? <p className="text-sm text-muted">Sem trilhas publicadas.</p> : (
              <div className="overflow-x-auto border border-line bg-surface"><table className="w-full min-w-[860px] text-left text-sm" aria-label="Indicadores por trilha">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Trilha', 'Elegíveis', 'Inscritos', 'Adesão', 'Concluíram', 'Conclusão', 'Atrasados', 'Horas'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>{d.tracks.map((t) => (
                  <tr key={t.id} className={clsx('border-t border-line', trilha === t.id && 'bg-primary-soft')}>
                    <td className="px-4 py-2.5"><button type="button" className="text-left font-semibold text-ink hover:text-primary" onClick={() => setTrilha(trilha === t.id ? '' : t.id)}>{t.title}</button>{t.archived && <span className="ml-2 text-xs text-muted">arquivada</span>}</td>
                    <td className="num px-4 py-2.5">{t.eligible}</td><td className="num px-4 py-2.5">{t.enrolled}</td><td className="num px-4 py-2.5">{pct(t.adhesionPct)}</td>
                    <td className="num px-4 py-2.5">{t.completed}</td><td className="num px-4 py-2.5">{pct(t.completionPct)}</td>
                    <td className={clsx('num px-4 py-2.5', t.late && 'text-danger')}>{t.late}</td><td className="num px-4 py-2.5">{t.hours.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {trilha && (
              <div className="overflow-x-auto border border-line bg-surface"><table className="w-full min-w-[820px] text-left text-sm" aria-label="Pessoas na trilha">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Pessoa', 'Time', 'Situação', 'Progresso', 'Horas', 'Prazo', 'Última atividade'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>{d.people.map((p) => (
                  <tr key={p.userId} className="border-t border-line">
                    <td className="px-4 py-2.5 font-semibold text-ink">{p.name}</td><td className="px-4 py-2.5 text-xs">{p.teams.join(', ') || '—'}</td>
                    <td className={clsx('px-4 py-2.5', p.status === 'atrasada' && 'text-danger', p.status === 'concluida' && 'text-[#15803D]')}>{p.status === 'nao_inscrito' ? 'Não inscrita' : ENROLLMENT_STATUS_LABELS[p.status]}</td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Bar pct={p.pct} className="w-24" /><span className="num text-xs">{p.pct.toLocaleString('pt-BR')}%</span></div></td>
                    <td className="num px-4 py-2.5">{p.hours.toLocaleString('pt-BR')}</td><td className="num px-4 py-2.5">{p.dueOn ? fmtDate(p.dueOn) : '—'}</td><td className="px-4 py-2.5 text-xs">{p.lastAt ? fmtDateTime(p.lastAt) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </>
        );
      })()}
    </section>
  );
}

// ------------------------------------------------------------------ editor
type Content = { id: string; kind: 'youtube_video' | 'link'; externalId: string | null; url: string | null; title: string; channel: string | null; durationSeconds: number | null; thumbnailUrl: string | null; state: ContentState };
type EdLesson = { key: string; id?: string; contentId: string; title: string | null; required: boolean; minWatchPct: number | null };
type EdModule = { key: string; id?: string; title: string; playlistId: string | null; lessons: EdLesson[] };
type EdCourse = { key: string; id?: string; title: string; description: string | null; minWatchPct: number | null; modules: EdModule[] };
type TrackMetaForm = {
  title: string; description: string; objectives: string; competencies: string; ownerTeamId: string; curatorId: string;
  visibility: (typeof VISIBILITIES)[number]; teamIds: string[]; costCenterIds: string[]; profiles: string[]; userIds: string[];
  mode: (typeof TRACK_MODES)[number]; level: (typeof TRACK_LEVELS)[number]; workloadMinutes: string; dueDays: string; minWatchPct: number; progressMethod: (typeof PROGRESS_METHODS)[number]; sequential: boolean;
};
type EditorData = {
  track: Record<string, unknown> & { id: string; title: string; description: string | null; status: TrackStatus; rowVersion: number; objectives: string[]; competencies: string[]; ownerTeamId: string | null; curatorId: string | null; visibility: TrackMetaForm['visibility']; teamIds: string[]; costCenterIds: string[]; profiles: string[]; userIds: string[]; mode: TrackMetaForm['mode']; level: TrackMetaForm['level']; workloadMinutes: number | null; dueDays: number | null; minWatchPct: number; progressMethod: TrackMetaForm['progressMethod']; sequential: boolean; cover: string | null };
  structure: TrackSnapshot; minutes: number; contents: Record<string, Content>; playlists: { id: string; title: string; count: number }[];
  versions: { id: string; number: number; status: string; submittedAt: string | null; publishedAt: string | null }[];
  open: { id: string; number: number; status: string; canDecide: boolean } | null; changed: boolean; errors: string[];
  events: { type: string; note: string | null; actor: string | null; at: string }[]; can: { edit: boolean; submit: boolean };
};
const EMPTY_META: TrackMetaForm = { title: '', description: '', objectives: '', competencies: '', ownerTeamId: '', curatorId: '', visibility: 'corporativo', teamIds: [], costCenterIds: [], profiles: [], userIds: [], mode: 'livre', level: 'basico', workloadMinutes: '', dueDays: '', minWatchPct: 90, progressMethod: 'quantidade', sequential: false };
const VERSION_LABELS: Record<string, string> = { revisao_gerencia: 'Em análise da Gerência', homologacao_diretoria: 'Em homologação da Diretoria', publicada: 'Publicada', substituida: 'Substituída', rejeitada: 'Rejeitada', ajustes: 'Ajustes pedidos' };
const EVENT_LABELS: Record<string, string> = { criada: 'Criou a trilha', editada: 'Editou', sincronizada: 'Conferiu os vídeos no YouTube', academia_enviada: 'Enviou para aprovação', academia_publicada: 'Aprovou e publicou', academia_ajustes: 'Pediu ajustes', academia_rejeitada: 'Rejeitou', academia_atribuida: 'Atribuiu', academia_obrigatoria: 'Enviou a obrigatória', arquivada: 'Arquivou', reativada: 'Reativou', inscricao: 'Inscrição', concluida: 'Concluiu' };
let seq = 0;
const k = () => `n${++seq}`;
const toForm = (t: EditorData['track']): TrackMetaForm => ({ title: t.title, description: t.description ?? '', objectives: t.objectives.join('\n'), competencies: t.competencies.join(', '), ownerTeamId: t.ownerTeamId ?? '', curatorId: t.curatorId ?? '', visibility: t.visibility, teamIds: t.teamIds, costCenterIds: t.costCenterIds, profiles: t.profiles, userIds: t.userIds, mode: t.mode, level: t.level, workloadMinutes: t.workloadMinutes ? String(t.workloadMinutes) : '', dueDays: t.dueDays ? String(t.dueDays) : '', minWatchPct: t.minWatchPct, progressMethod: t.progressMethod, sequential: t.sequential });
const toBody = (m: TrackMetaForm) => ({
  title: m.title, description: m.description.trim() || null, objectives: m.objectives.split('\n').map((x) => x.trim()).filter(Boolean), competencies: m.competencies.split(',').map((x) => x.trim()).filter(Boolean),
  ownerTeamId: m.ownerTeamId || null, curatorId: m.curatorId || null, visibility: m.visibility, teamIds: m.teamIds, costCenterIds: m.costCenterIds, profiles: m.profiles, userIds: m.userIds,
  mode: m.mode, level: m.level, workloadMinutes: m.workloadMinutes ? Number(m.workloadMinutes) : null, dueDays: m.dueDays ? Number(m.dueDays) : null, minWatchPct: m.minWatchPct, progressMethod: m.progressMethod, sequential: m.sequential,
});
const fromSnap = (s: TrackSnapshot): EdCourse[] => s.courses.map((c) => ({ key: k(), id: c.id, title: c.title, description: c.description, minWatchPct: c.minWatchPct, modules: c.modules.map((m) => ({ key: k(), id: m.id, title: m.title, playlistId: m.playlistId ?? null, lessons: m.lessons.map((l) => ({ key: k(), id: l.id, contentId: l.contentId, title: l.title, required: l.required, minWatchPct: l.minWatchPct })) })) }));
const move = <T,>(xs: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; };

function MetaFields({ m, set }: { m: TrackMetaForm; set: (m: TrackMetaForm) => void }) {
  const setup = usePbSetup();
  const f = <K extends keyof TrackMetaForm>(key: K, v: TrackMetaForm[K]) => set({ ...m, [key]: v });
  if (!setup.data) return <LoadingRows rows={4} />;
  const s = setup.data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField label="Nome da trilha" htmlFor="tm-t" required className="md:col-span-2"><Input id="tm-t" value={m.title} onChange={(e) => f('title', e.target.value)} placeholder="Ex.: Onboarding Comercial" /></FormField>
      <FormField label="Descrição" htmlFor="tm-d" className="md:col-span-2"><Textarea id="tm-d" rows={2} value={m.description} onChange={(e) => f('description', e.target.value)} /></FormField>
      <FormField label="Objetivos de aprendizagem" htmlFor="tm-o" hint="Um por linha."><Textarea id="tm-o" rows={3} value={m.objectives} onChange={(e) => f('objectives', e.target.value)} /></FormField>
      <FormField label="Competências desenvolvidas" htmlFor="tm-c" hint="Separadas por vírgula."><Textarea id="tm-c" rows={3} value={m.competencies} onChange={(e) => f('competencies', e.target.value)} /></FormField>
      <FormField label="Time responsável" htmlFor="tm-tm"><Select id="tm-tm" value={m.ownerTeamId} onChange={(e) => f('ownerTeamId', e.target.value)}><option value="">—</option>{s.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
      <FormField label="Curadoria" htmlFor="tm-cu"><Select id="tm-cu" value={m.curatorId} onChange={(e) => f('curatorId', e.target.value)}><option value="">Quem criou</option>{s.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
      <FormField label="Modalidade" htmlFor="tm-mo"><Select id="tm-mo" value={m.mode} onChange={(e) => f('mode', e.target.value as TrackMetaForm['mode'])}>{TRACK_MODES.map((x) => <option key={x} value={x}>{TRACK_MODE_LABELS[x]}</option>)}</Select></FormField>
      <FormField label="Nível" htmlFor="tm-lv"><Select id="tm-lv" value={m.level} onChange={(e) => f('level', e.target.value as TrackMetaForm['level'])}>{TRACK_LEVELS.map((x) => <option key={x} value={x}>{TRACK_LEVEL_LABELS[x]}</option>)}</Select></FormField>
      <FormField label="Percentual mínimo assistido por aula" htmlFor="tm-mp"><Select id="tm-mp" value={m.minWatchPct} onChange={(e) => f('minWatchPct', Number(e.target.value))}>{MIN_WATCH_PCTS.map((x) => <option key={x} value={x}>{x}%</option>)}</Select></FormField>
      <FormField label="Cálculo do progresso da trilha" htmlFor="tm-pm"><Select id="tm-pm" value={m.progressMethod} onChange={(e) => f('progressMethod', e.target.value as TrackMetaForm['progressMethod'])}>{PROGRESS_METHODS.map((x) => <option key={x} value={x}>{PROGRESS_METHOD_LABELS[x]}</option>)}</Select></FormField>
      <FormField label="Prazo após a inscrição (dias)" htmlFor="tm-dd"><Input id="tm-dd" type="number" min={1} value={m.dueDays} onChange={(e) => f('dueDays', e.target.value)} /></FormField>
      <FormField label="Carga horária (min)" htmlFor="tm-wl" hint="Vazio: soma da duração dos vídeos."><Input id="tm-wl" type="number" min={1} value={m.workloadMinutes} onChange={(e) => f('workloadMinutes', e.target.value)} /></FormField>
      <label className="flex items-center gap-2 text-sm text-ink md:col-span-2"><input type="checkbox" checked={m.sequential} onChange={(e) => f('sequential', e.target.checked)} />Aulas em sequência (a próxima obrigatória libera depois da anterior)</label>
      <fieldset className="space-y-2 md:col-span-2"><legend className="mb-1 text-sm font-semibold text-ink">Quem pode ver</legend>
        <div className="flex flex-wrap gap-2">{VISIBILITIES.map((v) => <button key={v} type="button" aria-pressed={m.visibility === v} onClick={() => f('visibility', v)} className={clsx('border px-3 py-1.5 text-sm font-semibold', m.visibility === v ? 'border-navy bg-navy text-white' : 'border-line hover:border-primary')}>{VISIBILITY_LABELS[v]}</button>)}</div>
        {m.visibility === 'compartilhado' && <><Multi label="Times" options={s.teams.map((t) => ({ id: t.id, label: t.name }))} value={m.teamIds} onChange={(v) => f('teamIds', v)} /><Multi label="Centros de custo" options={s.costCenters.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))} value={m.costCenterIds} onChange={(v) => f('costCenterIds', v)} /></>}
        {m.visibility === 'restrito' && <Multi label="Perfis" options={PROFILE_KEYS.map((p) => ({ id: p, label: PROFILE_LABELS[p] }))} value={m.profiles} onChange={(v) => f('profiles', v)} />}
        {m.visibility !== 'corporativo' && <Multi label="Pessoas específicas" options={s.users.map((u) => ({ id: u.id, label: u.name }))} value={m.userIds} onChange={(v) => f('userIds', v)} />}
      </fieldset>
    </div>
  );
}

export function AcademyEditorPage() {
  const { id } = useParams();
  const nav = useNavigate(), qc = useQueryClient(), toast = useToast();
  const isNew = !id || id === 'nova';
  const r = useQuery({ queryKey: ['academia', 'editor', id], queryFn: () => api<EditorData>(`/academia/trilhas/${id}/editor`), enabled: !isNew });
  const [meta, setMeta] = useState<TrackMetaForm>(EMPTY_META);
  const [courses, setCourses] = useState<EdCourse[]>([]);
  const [contents, setContents] = useState<Record<string, Content>>({});
  const [dirty, setDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  useEffect(() => {
    if (!r.data) return;
    if (!metaDirty) setMeta(toForm(r.data.track));
    if (!dirty) { setCourses(fromSnap(r.data.structure)); }
    setContents((c) => ({ ...c, ...r.data!.contents }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.data]);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/academia/trilhas', { method: 'POST', body: toBody(meta) }),
    onSuccess: (x) => { void qc.invalidateQueries({ queryKey: ['academia'] }); toast({ tone: 'success', message: 'Trilha criada. Agora inclua os vídeos.' }); nav(`/playbooks/academia/gestao/${x.id}`, { replace: true }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveMeta = useMutation({
    mutationFn: () => api(`/academia/trilhas/${id}`, { method: 'PUT', body: { ...toBody(meta), rowVersion: r.data!.track.rowVersion } }),
    onSuccess: async () => { setMetaDirty(false); await r.refetch(); toast({ tone: 'success', message: 'Dados salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveStructure = useMutation({
    mutationFn: () => api(`/academia/trilhas/${id}/estrutura`, { method: 'PUT', body: {
      rowVersion: r.data!.track.rowVersion,
      courses: courses.map((c) => ({ id: c.id, title: c.title, description: c.description, minWatchPct: c.minWatchPct, modules: c.modules.map((m) => ({ id: m.id, title: m.title, playlistId: m.playlistId, lessons: m.lessons.map((l) => ({ id: l.id, contentId: l.contentId, title: l.title, required: l.required, minWatchPct: l.minWatchPct })) })) })),
    } }),
    onSuccess: async () => { const x = await r.refetch(); if (x.data) setCourses(fromSnap(x.data.structure)); setDirty(false); toast({ tone: 'success', message: 'Estrutura salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const submit = useMutation({
    mutationFn: () => api<{ number: number; status: string }>(`/academia/trilhas/${id}/enviar`, { method: 'POST', body: {} }),
    onSuccess: (x) => { void qc.invalidateQueries({ queryKey: ['academia'] }); toast({ tone: 'success', message: `Versão ${x.number} enviada: ${VERSION_LABELS[x.status]}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const sync = useMutation({
    mutationFn: () => api<{ videos: number; changed: { title: string; state: string }[]; playlists: { module: string; added?: number; removed?: number; error?: string }[] }>(`/academia/trilhas/${id}/sincronizar`, { method: 'POST' }),
    onSuccess: (x) => { void r.refetch(); toast({ tone: 'success', message: [`${x.videos} vídeo(s) conferido(s)`, ...x.changed.map((c) => `${c.title}: ${CONTENT_STATE_LABELS[c.state as ContentState]}`), ...x.playlists.map((p) => p.error ? `${p.module}: ${p.error}` : `${p.module}: ${p.added} novo(s) e ${p.removed} fora da playlist`)].join(' · ') }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const archive = useMutation({ mutationFn: () => api(`/academia/trilhas/${id}/arquivar`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['academia'] }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });

  const upd = (f: (c: EdCourse[]) => EdCourse[]) => { setCourses(f); setDirty(true); };
  const totalSec = useMemo(() => courses.flatMap((c) => c.modules.flatMap((m) => m.lessons)).reduce((t, l) => t + (contents[l.contentId]?.durationSeconds ?? 0), 0), [courses, contents]);

  if (isNew) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <Breadcrumb items={[{ label: 'Playbooks', to: '/playbooks' }, { label: 'Academia — Gestão', to: '/playbooks?aba=academia' }, { label: 'Nova trilha' }]} />
        <h1 className="font-display text-2xl font-bold text-ink">Nova trilha</h1>
        <div className="border border-line bg-surface p-5"><MetaFields m={meta} set={setMeta} /></div>
        <div className="flex justify-end gap-2"><Button onClick={() => nav('/playbooks?aba=academia')}>Cancelar</Button><Button variant="primary" disabled={meta.title.trim().length < 3} loading={create.isPending} onClick={() => create.mutate()}>Criar e incluir vídeos</Button></div>
      </div>
    );
  }
  if (r.isLoading) return <LoadingRows rows={8} />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!;
  const editable = d.can.edit;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Breadcrumb items={[{ label: 'Playbooks', to: '/playbooks' }, { label: 'Academia — Gestão', to: '/playbooks?aba=academia' }, { label: d.track.title }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/playbooks?aba=academia" className="mb-1 inline-flex items-center gap-1 text-sm text-primary"><ChevronLeft className="h-4 w-4" />Gestão</Link>
          <h1 className="font-display text-2xl font-bold text-ink">{d.track.title}</h1>
          <p className="text-sm text-muted">{TRACK_STATUS_LABELS[d.track.status]}{d.open ? ` · versão ${d.open.number} ${VERSION_LABELS[d.open.status]?.toLowerCase()}` : ''} · {fmtDuration(totalSec)} de vídeo</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {d.track.status === 'publicada' && <Link to={`/playbooks/academia/trilhas/${d.track.id}`} className="inline-flex h-10 items-center border border-line px-3 text-sm font-semibold text-ink hover:border-line-strong">Ver como aluno</Link>}
            <Button icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>Conferir no YouTube</Button>
            <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!d.can.submit || dirty || metaDirty || !!d.errors.length} loading={submit.isPending} onClick={() => submit.mutate()} title={dirty || metaDirty ? 'Salve antes de enviar' : d.errors.join(' ') || (!d.changed ? 'Nada mudou desde a versão publicada' : undefined)}>Enviar para aprovação</Button>
          </div>
        )}
      </header>
      {!!d.errors.length && <p className="border border-[#B45309]/40 bg-[#FFF7ED] px-4 py-2 text-sm text-[#7C2D12]">Para enviar: {d.errors.join(' ')}</p>}

      <section aria-label="Dados da trilha" className="border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-display text-lg font-bold text-ink">Dados, regras e público</h2>{editable && <Button size="sm" variant="primary" disabled={!metaDirty} loading={saveMeta.isPending} onClick={() => saveMeta.mutate()}>Salvar dados</Button>}</div>
        <fieldset disabled={!editable} className="p-5"><MetaFields m={meta} set={(m) => { setMeta(m); setMetaDirty(true); }} /></fieldset>
      </section>

      <section aria-label="Estrutura" className="border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-bold text-ink">Cursos, módulos e aulas</h2>
          {editable && <div className="flex gap-2"><Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => upd((c) => [...c, { key: k(), title: `Curso ${c.length + 1}`, description: null, minWatchPct: null, modules: [{ key: k(), title: 'Módulo 1', playlistId: null, lessons: [] }] }])}>Curso</Button><Button size="sm" variant="primary" disabled={!dirty} loading={saveStructure.isPending} onClick={() => saveStructure.mutate()}>Salvar estrutura</Button></div>}
        </div>
        {editable && <AddContent courses={courses} onAdd={(res, target) => {
          setContents((c) => ({ ...c, ...Object.fromEntries(res.contents.map((x) => [x.id, x])) }));
          upd((cs) => {
            const lessons = res.contents.map((x) => ({ key: k(), contentId: x.id, title: null, required: x.kind !== 'link', minWatchPct: null }));
            if (!cs.length) return [{ key: k(), title: 'Curso 1', description: null, minWatchPct: null, modules: [{ key: k(), title: res.playlist?.title ?? 'Módulo 1', playlistId: res.playlist?.id ?? null, lessons }] }];
            if (res.playlist && target === 'novo') { const last = cs.length - 1; return cs.map((c, i) => i === last ? { ...c, modules: [...c.modules, { key: k(), title: res.playlist!.title, playlistId: res.playlist!.id, lessons }] } : c); }
            return cs.map((c) => ({ ...c, modules: c.modules.map((m) => (m.key === target || (target === 'novo' && false) ? { ...m, lessons: [...m.lessons, ...lessons] } : m)) }));
          });
        }} />}
        <div className="space-y-5 p-5">
          {!courses.length && <p className="text-sm text-muted">Cole acima o link de um vídeo ou de uma playlist do YouTube para começar.</p>}
          {courses.map((c, ci) => (
            <fieldset key={c.key} disabled={!editable} className="border border-line">
              <div className="flex flex-wrap items-center gap-2 bg-surface-2 px-3 py-2">
                <Input aria-label="Nome do curso" value={c.title} onChange={(e) => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, title: e.target.value } : x))} className="max-w-sm flex-1 font-semibold" />
                <Select aria-label="Mínimo do curso" value={c.minWatchPct ?? ''} onChange={(e) => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, minWatchPct: e.target.value ? Number(e.target.value) : null } : x))} className="w-40"><option value="">Mínimo da trilha</option>{MIN_WATCH_PCTS.map((p) => <option key={p} value={p}>{p}% neste curso</option>)}</Select>
                <span className="ml-auto flex gap-1">
                  <IconBtn label="Subir curso" onClick={() => upd((cs) => move(cs, ci, -1))}><ArrowUp className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Descer curso" onClick={() => upd((cs) => move(cs, ci, 1))}><ArrowDown className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Incluir módulo" onClick={() => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, modules: [...x.modules, { key: k(), title: `Módulo ${x.modules.length + 1}`, playlistId: null, lessons: [] }] } : x))}><Plus className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Excluir curso" onClick={() => upd((cs) => cs.filter((x) => x.key !== c.key))}><Trash2 className="h-4 w-4" /></IconBtn>
                </span>
              </div>
              <div className="space-y-3 p-3">
                {c.modules.map((m, mi) => {
                  const setMod = (f: (m: EdModule) => EdModule) => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, modules: x.modules.map((y) => y.key === m.key ? f(y) : y) } : x));
                  return (
                    <div key={m.key} className="border-l-2 border-primary/40 pl-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Input aria-label="Nome do módulo" value={m.title} onChange={(e) => setMod((x) => ({ ...x, title: e.target.value }))} className="max-w-sm flex-1" />
                        {m.playlistId && <span className="text-xs text-muted">da playlist</span>}
                        <span className="ml-auto flex gap-1">
                          <IconBtn label="Subir módulo" onClick={() => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, modules: move(x.modules, mi, -1) } : x))}><ArrowUp className="h-4 w-4" /></IconBtn>
                          <IconBtn label="Descer módulo" onClick={() => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, modules: move(x.modules, mi, 1) } : x))}><ArrowDown className="h-4 w-4" /></IconBtn>
                          <IconBtn label="Excluir módulo" onClick={() => upd((cs) => cs.map((x) => x.key === c.key ? { ...x, modules: x.modules.filter((y) => y.key !== m.key) } : x))}><Trash2 className="h-4 w-4" /></IconBtn>
                        </span>
                      </div>
                      {!m.lessons.length ? <p className="py-2 text-xs text-muted">Sem aulas: escolha este módulo ao colar um link.</p> : (
                        <ol className="divide-y divide-line border border-line">{m.lessons.map((l, li) => {
                          const ct = contents[l.contentId];
                          const bad = ct && ct.kind === 'youtube_video' && !playableState(ct.state);
                          return (
                            <li key={l.key} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm" data-testid="ed-lesson">
                              {ct?.thumbnailUrl ? <img src={ct.thumbnailUrl} alt="" className="h-9 w-16 object-cover" /> : <span className="h-9 w-16 bg-surface-2" />}
                              <span className="min-w-0 flex-1">
                                <Input aria-label="Título da aula" value={l.title ?? ''} placeholder={ct?.title ?? 'Aula'} onChange={(e) => setMod((x) => ({ ...x, lessons: x.lessons.map((y) => y.key === l.key ? { ...y, title: e.target.value || null } : y) }))} className="h-8" />
                                <span className="text-xs text-muted">{ct?.kind === 'link' ? 'Link de apoio' : ct?.durationSeconds ? fmtDuration(ct.durationSeconds) : 'duração após a 1ª reprodução'}{ct?.channel ? ` · ${ct.channel}` : ''}{bad && <b className="text-[#B45309]"> · {CONTENT_STATE_LABELS[ct.state]}</b>}</span>
                              </span>
                              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.required} onChange={(e) => setMod((x) => ({ ...x, lessons: x.lessons.map((y) => y.key === l.key ? { ...y, required: e.target.checked } : y) }))} />Obrigatória</label>
                              {ct?.kind !== 'link' && <Select aria-label="Mínimo da aula" value={l.minWatchPct ?? ''} onChange={(e) => setMod((x) => ({ ...x, lessons: x.lessons.map((y) => y.key === l.key ? { ...y, minWatchPct: e.target.value ? Number(e.target.value) : null } : y) }))} className="h-8 w-28 text-xs"><option value="">Herda</option>{MIN_WATCH_PCTS.map((p) => <option key={p} value={p}>{p}%</option>)}</Select>}
                              <IconBtn label="Subir aula" onClick={() => setMod((x) => ({ ...x, lessons: move(x.lessons, li, -1) }))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                              <IconBtn label="Descer aula" onClick={() => setMod((x) => ({ ...x, lessons: move(x.lessons, li, 1) }))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                              <IconBtn label="Tirar aula" onClick={() => setMod((x) => ({ ...x, lessons: x.lessons.filter((y) => y.key !== l.key) }))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                            </li>
                          );
                        })}</ol>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <section aria-label="Versões e histórico" className="grid gap-4 md:grid-cols-2">
        <div className="border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-display text-lg font-bold text-ink">Versões</h2>
          {!d.versions.length ? <p className="px-5 py-3 text-sm text-muted">Nenhuma versão enviada.</p> : <ul className="divide-y divide-line">{d.versions.map((v) => <li key={v.id} className="flex justify-between px-5 py-2 text-sm"><span>Versão {v.number}</span><span className="text-muted">{VERSION_LABELS[v.status] ?? v.status}{v.publishedAt ? ` · ${fmtDate(v.publishedAt)}` : ''}</span></li>)}</ul>}
          {editable && d.track.status !== 'rascunho' && <div className="border-t border-line px-5 py-3"><Button size="sm" loading={archive.isPending} onClick={() => archive.mutate()}>{d.track.status === 'arquivada' ? 'Reativar trilha' : 'Arquivar trilha'}</Button></div>}
        </div>
        <div className="border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-display text-lg font-bold text-ink">Histórico</h2>
          <ul className="max-h-72 divide-y divide-line overflow-auto">{d.events.map((e, i) => <li key={i} className="px-5 py-2 text-sm"><span className="font-semibold text-ink">{EVENT_LABELS[e.type] ?? e.type}</span>{e.note && <span className="text-text"> — {e.note}</span>}<span className="block text-xs text-muted">{e.actor ?? '—'} · {fmtDateTime(e.at)}</span></li>)}</ul>
        </div>
      </section>
    </div>
  );
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => <button type="button" aria-label={label} title={label} onClick={onClick} className="p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">{children}</button>;

type AddRes = { kind: 'video' | 'playlist' | 'link'; contents: Content[]; playlist?: { id: string; title: string; missing: number } };
function AddContent({ courses, onAdd }: { courses: EdCourse[]; onAdd: (r: AddRes, target: string) => void }) {
  const toast = useToast();
  const [input, setInput] = useState(''), [title, setTitle] = useState(''), [target, setTarget] = useState('novo');
  const modules = courses.flatMap((c) => c.modules.map((m) => ({ key: m.key, label: `${c.title} › ${m.title}` })));
  const isYt = /youtu\.?be|^[A-Za-z0-9_-]{11}$|^(PL|UU|LL|FL|OL|RD)[A-Za-z0-9_-]{10,}$/.test(input.trim());
  const m = useMutation({
    mutationFn: () => api<{ kind: 'video' | 'playlist' | 'link'; content?: Content; contents?: Content[]; playlist?: { id: string; title: string; missing: number } }>('/academia/conteudos', { method: 'POST', body: { input: input.trim(), title: title.trim() || undefined } }),
    onSuccess: (r) => {
      const contents = r.contents ?? (r.content ? [r.content] : []);
      const t = target === 'novo' && r.kind !== 'playlist' ? (modules[modules.length - 1]?.key ?? 'novo') : target;
      onAdd({ kind: r.kind, contents, playlist: r.playlist }, t);
      setInput(''); setTitle('');
      toast({ tone: 'success', message: r.kind === 'playlist' ? `${contents.length} vídeo(s) da playlist incluído(s)${r.playlist?.missing ? ` · ${r.playlist.missing} indisponível(is) ficaram de fora` : ''}. Salve a estrutura.` : `${contents[0]?.title ?? 'Conteúdo'} incluído. Salve a estrutura.` });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <form className="flex flex-wrap items-end gap-2 border-b border-line bg-surface-2/50 px-5 py-3" onSubmit={(e) => { e.preventDefault(); if (input.trim()) m.mutate(); }}>
      <FormField label="Link do YouTube (vídeo ou playlist) ou link de apoio" htmlFor="ac-in" className="min-w-[260px] flex-1"><Input id="ac-in" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=… ou …/playlist?list=…" /></FormField>
      {input.trim() && !isYt && <FormField label="Título do link" htmlFor="ac-ti"><Input id="ac-ti" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>}
      <FormField label="Onde incluir" htmlFor="ac-tg"><Select id="ac-tg" value={target} onChange={(e) => setTarget(e.target.value)}><option value="novo">{modules.length ? 'Playlist: novo módulo · vídeo: último módulo' : 'Novo curso e módulo'}</option>{modules.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select></FormField>
      <Button type="submit" variant="primary" loading={m.isPending} disabled={!input.trim()}>Incluir</Button>
    </form>
  );
}
