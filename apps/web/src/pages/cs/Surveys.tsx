/** Funcionalidade 02 — Pesquisas por link: lista, revisão de atualizações, construtor, convites, resultados e a página de resposta. */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Send, Trash2 } from 'lucide-react';
import {
  DEST_VALUES, INVITE_STATUS_LABELS, INTEREST_LABELS, QUESTION_TYPES, QUESTION_TYPE_LABELS, REVIEW_ONLY, STANCE_LABELS, SURVEY_DESTINATIONS, SURVEY_DESTINATION_LABELS, SURVEY_STARTER, validateSurvey,
  type InviteStatus, type QuestionType, type SurveyDefinition, type SurveyDestination, type SurveyQuestion,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Breadcrumb, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';

const VALUE_LABELS: Record<string, string> = { ...INTEREST_LABELS, ...STANCE_LABELS };
const DEST_TYPES: Record<SurveyDestination, QuestionType[]> = { nenhum: [...QUESTION_TYPES], cs_nps: ['nps'], cs_csat: ['csat'], stakeholder_interesse: ['escolha'], stakeholder_posicionamento: ['escolha'], pessoa_email: ['texto'], pessoa_telefone: ['texto'] };
type ListItem = { id: string; name: string; title: string; active: boolean; questions: number; invites: number; responses: number; responseRate: number | null; nps: number | null; currentVersion: number };

// ---------------------------------------------------------------- aba Pesquisas em Sucesso do Cliente
export function SurveysTab() {
  const q = useQuery({ queryKey: ['surveys'], queryFn: () => api<{ canManage: boolean; pendingUpdates: number; items: ListItem[] }>('/surveys') });
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      {d.pendingUpdates > 0 && <PendingUpdates canDecide={d.canManage} />}
      <section className="card overflow-hidden" aria-label="Pesquisas">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div><h3 className="font-bold text-ink">Pesquisas por link</h3><p className="text-xs text-muted">Cada convite é pessoal e vale para uma resposta. NPS e satisfação entram na saúde da conta; o poder de influência nunca vem de pesquisa.</p></div>
          {d.canManage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova pesquisa</Button>}
        </div>
        {!d.items.length ? <div className="border-t border-line"><EmptyState title="Nenhuma pesquisa criada" description={d.canManage ? 'Crie uma pesquisa a partir do modelo pronto e envie convites para as contas.' : 'A liderança cria as pesquisas; depois você envia os convites.'} /></div> : (
          <div className="scroll-thin overflow-x-auto border-t border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Pesquisa', 'Perguntas', 'Convites', 'Respostas', 'Taxa de resposta', 'NPS'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{d.items.map((x) => (
                <tr key={x.id} className={clsx('border-t border-line', !x.active && 'opacity-60')}>
                  <td className="px-3 py-2.5"><Link className="font-semibold text-primary hover:underline" to={`/sucesso/pesquisas/${x.id}`}>{x.name}</Link><span className="block text-xs text-muted">{x.title}{!x.active && ' · desativada'} · v{x.currentVersion}</span></td>
                  <td className="num px-3 py-2.5">{x.questions}</td><td className="num px-3 py-2.5">{x.invites}</td><td className="num px-3 py-2.5">{x.responses}</td>
                  <td className="num px-3 py-2.5">{x.responseRate === null ? '—' : `${x.responseRate}%`}</td><td className="num px-3 py-2.5 font-semibold">{x.nps ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {creating && <SurveyEditor onClose={() => setCreating(false)} />}
    </div>
  );
}

type Upd = { id: string; destination: SurveyDestination; destinationLabel: string; value: unknown; previous: unknown; account: string; person: string | null; survey: string; respondedAt: string };
const fmtVal = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : VALUE_LABELS[String(v)] ?? String(v));
function PendingUpdates({ canDecide }: { canDecide: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['survey-updates'], queryFn: () => api<{ canDecide: boolean; items: Upd[] }>('/survey-updates') });
  const [rej, setRej] = useState<Upd | null>(null);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note: string }) => api(`/survey-updates/${v.id}/decide`, { method: 'POST', body: { approve: v.approve, note: v.note } }),
    onSuccess: (_r, v) => { setRej(null); setNote(''); void qc.invalidateQueries({ queryKey: ['survey-updates'] }); void qc.invalidateQueries({ queryKey: ['surveys'] }); void qc.invalidateQueries({ queryKey: ['stakeholders'] }); toast({ tone: 'success', message: v.approve ? 'Atualização aplicada ao cadastro' : 'Atualização rejeitada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="card overflow-hidden" aria-label="Atualizações para revisar">
      <div className="p-4"><h3 className="font-bold text-ink">Respostas que mudam o cadastro ({items.length})</h3><p className="text-xs text-muted">Posicionamento e dados de contato só mudam depois que alguém da liderança confirma.</p></div>
      <ul className="divide-y divide-line border-t border-line">{items.map((u) => (
        <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-[220px] flex-1"><p><b className="text-ink">{u.person ?? '—'}</b> · {u.account}</p><p>{u.destinationLabel}: {fmtVal(u.previous)} → <b>{fmtVal(u.value)}</b></p><p className="text-xs text-muted">{u.survey} · respondida em {fmtDateTime(u.respondedAt)}</p></div>
          {canDecide ? <div className="flex gap-2"><Button size="sm" variant="primary" loading={m.isPending && m.variables?.id === u.id && m.variables.approve} onClick={() => m.mutate({ id: u.id, approve: true, note: '' })}>Aplicar</Button><Button size="sm" variant="secondary" onClick={() => setRej(u)}>Rejeitar</Button></div> : <span className="text-xs text-muted">Aguardando a liderança</span>}
        </li>
      ))}</ul>
      <Modal open={!!rej} onClose={() => setRej(null)} title="Rejeitar atualização" footer={<><Button variant="secondary" onClick={() => setRej(null)}>Cancelar</Button><Button variant="danger" disabled={note.trim().length < 5} loading={m.isPending} onClick={() => rej && m.mutate({ id: rej.id, approve: false, note })}>Rejeitar</Button></>}>
        <FormField label="Motivo" htmlFor="su-n" required><Textarea id="su-n" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------- construtor
function SurveyEditor({ survey, onClose }: { survey?: { id: string; name: string; rowVersion: number; currentVersion: number; definition: SurveyDefinition }; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(survey?.name ?? '');
  const [def, setDef] = useState<SurveyDefinition>(survey?.definition ?? JSON.parse(JSON.stringify(SURVEY_STARTER)) as SurveyDefinition);
  const [note, setNote] = useState('');
  const setQ = (i: number, p: Partial<SurveyQuestion>) => setDef({ ...def, questions: def.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const move = (i: number, d: -1 | 1) => { const qs = [...def.questions]; const [x] = qs.splice(i, 1); qs.splice(i + d, 0, x!); setDef({ ...def, questions: qs }); };
  const errs = [...(name.trim().length < 3 ? ['Dê um nome interno à pesquisa.'] : []), ...validateSurvey(def)];
  const save = useMutation({
    mutationFn: () => (survey ? api<{ version?: number; id?: string }>(`/surveys/${survey.id}`, { method: 'PUT', body: { rowVersion: survey.rowVersion, name, definition: def, note } }) : api<{ version?: number; id?: string }>('/surveys', { method: 'POST', body: { name, definition: def } })),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['surveys'] }); void qc.invalidateQueries({ queryKey: ['survey'] }); toast({ tone: 'success', message: survey ? `Pesquisa salva (versão ${r.version})` : 'Pesquisa criada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Drawer open onClose={onClose} title={survey ? `Editar: ${survey.name}` : 'Nova pesquisa'} width="lg">
      <div className="space-y-4">
        <FormField label="Nome interno" htmlFor="sv-n" hint="Só a equipe vê"><Input id="sv-n" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Título para quem responde" htmlFor="sv-t"><Input id="sv-t" value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} /></FormField>
        <FormField label="Abertura" htmlFor="sv-i"><Textarea id="sv-i" rows={2} value={def.intro} onChange={(e) => setDef({ ...def, intro: e.target.value })} /></FormField>
        <section className="space-y-2" aria-label="Perguntas">
          <h4 className="font-bold text-ink">Perguntas ({def.questions.length})</h4>
          {def.questions.map((q, i) => {
            const dests = SURVEY_DESTINATIONS.filter((d) => DEST_TYPES[d].includes(q.type));
            const vals = DEST_VALUES[q.destination];
            const forced = REVIEW_ONLY.includes(q.destination);
            return (
              <div key={i} role="group" aria-label={`Pergunta ${i + 1}`} className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="num text-xs font-bold text-muted">{i + 1}</span>
                  <Input aria-label={`Pergunta ${i + 1}: texto`} placeholder="Texto da pergunta" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} />
                  <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="h-4 w-4" />} />
                  <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === def.questions.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="h-4 w-4" />} />
                  <Button size="sm" variant="ghost" aria-label="Remover pergunta" disabled={def.questions.length === 1} onClick={() => setDef({ ...def, questions: def.questions.filter((_, j) => j !== i) })} icon={<Trash2 className="h-4 w-4" />} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto]">
                  <Select aria-label={`Pergunta ${i + 1}: tipo`} value={q.type} onChange={(e) => { const t = e.target.value as QuestionType; setQ(i, { type: t, destination: DEST_TYPES[q.destination].includes(t) ? q.destination : 'nenhum', options: t === 'escolha' || t === 'multipla' ? q.options ?? [{ key: 'a', label: '' }, { key: 'b', label: '' }] : undefined }); }}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}</Select>
                  <Select aria-label={`Pergunta ${i + 1}: destino da resposta`} value={q.destination} onChange={(e) => { const d = e.target.value as SurveyDestination; setQ(i, { destination: d, mode: REVIEW_ONLY.includes(d) ? 'pendente' : q.mode }); }}>{dests.map((d) => <option key={d} value={d}>{SURVEY_DESTINATION_LABELS[d]}</option>)}</Select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />Obrigatória</label>
                </div>
                {q.destination !== 'nenhum' && (
                  <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={`Pergunta ${i + 1}: como atualizar`}>
                    <label className={clsx('flex items-center gap-1.5', forced && 'opacity-50')}><input type="radio" disabled={forced} checked={q.mode === 'automatica'} onChange={() => setQ(i, { mode: 'automatica' })} />Atualizar na hora</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={q.mode === 'pendente'} onChange={() => setQ(i, { mode: 'pendente' })} />Revisar antes de atualizar</label>
                    {forced && <span className="text-xs text-muted">Este dado sempre passa por revisão.</span>}
                  </div>
                )}
                {(q.type === 'escolha' || q.type === 'multipla') && (
                  <div className="space-y-1.5 pl-5">
                    {(q.options ?? []).map((o, k) => (
                      <div key={k} className="flex flex-wrap items-center gap-2">
                        <Input aria-label={`Pergunta ${i + 1}: opção ${k + 1}`} className="max-w-xs" placeholder={`Opção ${k + 1}`} value={o.label} onChange={(e) => setQ(i, { options: q.options!.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                        {vals && <Select aria-label={`Pergunta ${i + 1}: opção ${k + 1} corresponde a`} className="w-auto" value={o.maps ?? ''} onChange={(e) => setQ(i, { options: q.options!.map((x, j) => (j === k ? { ...x, maps: e.target.value || null } : x)) })}><option value="">Não altera</option>{vals.map((v) => <option key={v} value={v}>{VALUE_LABELS[v] ?? v}</option>)}</Select>}
                        <Button size="sm" variant="ghost" aria-label="Remover opção" disabled={(q.options?.length ?? 0) <= 2} onClick={() => setQ(i, { options: q.options!.filter((_, j) => j !== k) })} icon={<Trash2 className="h-4 w-4" />} />
                      </div>
                    ))}
                    <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setQ(i, { options: [...(q.options ?? []), { key: `o${Date.now().toString(36)}`, label: '' }] })}>Incluir opção</button>
                  </div>
                )}
              </div>
            );
          })}
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setDef({ ...def, questions: [...def.questions, { key: `q${Date.now().toString(36)}`, type: 'texto', text: '', required: false, destination: 'nenhum', mode: 'automatica' }] })}>Incluir pergunta</Button>
        </section>
        <FormField label="Agradecimento" htmlFor="sv-th"><Input id="sv-th" value={def.thanks} onChange={(e) => setDef({ ...def, thanks: e.target.value })} /></FormField>
        <p className="text-xs text-muted">O poder de influência não aparece como destino: ele é sempre avaliado pela equipe.</p>
        <div className="space-y-2 border-t border-line pt-4">
          {errs.map((e) => <Notice key={e} tone="warning">{e}</Notice>)}
          {survey && <FormField label="O que mudou" htmlFor="sv-note" required hint={`Hoje na versão ${survey.currentVersion}. Mudança nas perguntas gera nova versão; convites já enviados seguem a versão deles.`}><Input id="sv-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>}
          <Button variant="primary" disabled={!!errs.length || (!!survey && note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>{survey ? 'Salvar pesquisa' : 'Criar pesquisa'}</Button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- página da pesquisa
type Detail = {
  id: string; name: string; active: boolean; currentVersion: number; rowVersion: number; definition: SurveyDefinition; canManage: boolean;
  versions: { id: string; version: number; note: string; createdByName: string | null; createdAt: string }[];
  invites: { id: string; version: number; account: string; contactId: string; person: string | null; respondentName: string | null; respondentEmail: string | null; status: InviteStatus; expiresAt: string; respondedAt: string | null; emailedAt: string | null; cancelReason: string | null; createdByName: string; createdAt: string }[];
  responses: { id: string; version: number; answers: Record<string, unknown>; npsScore: number | null; createdAt: string; account?: string; person: string | null }[];
  stats: { invites: number; responses: number; responseRate: number | null; nps: number | null; csatAvg: number | null; perQuestion: { key: string; text: string; type: QuestionType; answered: number; distribution: Record<string, number>; texts: string[]; options?: { key: string; label: string }[] }[] };
};
const INV_TONE: Record<InviteStatus, Tone> = { enviado: 'blue', aberto: 'sky', respondido: 'green', expirado: 'neutral', cancelado: 'neutral' };
export function SurveyPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['survey', id], queryFn: () => api<Detail>(`/surveys/${id}`) });
  const [tab, setTab] = useState<'resultados' | 'convites' | 'respostas' | 'perguntas'>('resultados');
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const cm = useMutation({ mutationFn: () => api(`/survey-invites/${cancel}/cancel`, { method: 'POST', body: { reason } }), onSuccess: () => { setCancel(null); setReason(''); void qc.invalidateQueries({ queryKey: ['survey', id] }); toast({ tone: 'success', message: 'Convite cancelado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const act = useMutation({ mutationFn: (v: boolean) => api(`/surveys/${id}/active`, { method: 'POST', body: { active: v } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['survey', id] }); void qc.invalidateQueries({ queryKey: ['surveys'] }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.stats;
  const Kpi = ({ v, l }: { v: string | number; l: string }) => <div className="card p-4"><p className="text-xs text-muted">{l}</p><p className="num font-display text-2xl font-bold text-ink">{v}</p></div>;
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Sucesso do Cliente', to: '/sucesso?t=pesquisas' }, { label: 'Pesquisas', to: '/sucesso?t=pesquisas' }, { label: d.name }]} />
      <PageHeader icon={<ClipboardList className="h-9 w-9" strokeWidth={2.2} />} title={d.name} subtitle={`${d.definition.title} · versão ${d.currentVersion}${d.active ? '' : ' · desativada'}`}
        actions={<>{d.active && <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setInviting(true)}>Novo convite</Button>}{d.canManage && <Button variant="secondary" onClick={() => setEditing(true)}>Editar pesquisa</Button>}{d.canManage && <Button variant="ghost" loading={act.isPending} onClick={() => act.mutate(!d.active)}>{d.active ? 'Desativar' : 'Ativar'}</Button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi l="Convites" v={s.invites} /><Kpi l="Respostas" v={s.responses} /><Kpi l="Taxa de resposta" v={s.responseRate === null ? '—' : `${s.responseRate}%`} /><Kpi l="NPS" v={s.nps ?? '—'} /><Kpi l="Satisfação média" v={s.csatAvg === null ? '—' : `${s.csatAvg} de 5`} /></div>
      <Tabs label="Pesquisa" className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'resultados', label: 'Resultados' }, { key: 'convites', label: 'Convites', count: d.invites.length }, { key: 'respostas', label: 'Respostas', count: d.responses.length }, { key: 'perguntas', label: 'Perguntas e versões' }]} />
      {tab === 'resultados' && (
        <div className="grid gap-4 lg:grid-cols-2">{s.perQuestion.map((p) => {
          const total = Object.values(p.distribution).reduce((a, b) => a + b, 0);
          const keys = p.type === 'nps' ? Array.from({ length: 11 }, (_, i) => String(i)) : p.type === 'csat' || p.type === 'escala' ? ['1', '2', '3', '4', '5'] : p.type === 'sim_nao' ? ['true', 'false'] : (p.options ?? []).map((o) => o.key);
          const label = (k: string) => p.options?.find((o) => o.key === k)?.label ?? (k === 'true' ? 'Sim' : k === 'false' ? 'Não' : k);
          return (
            <section key={p.key} className="card p-4" aria-label={p.text}>
              <h3 className="font-bold text-ink">{p.text}</h3><p className="mb-2 text-xs text-muted">{p.answered} resposta(s)</p>
              {p.type === 'texto' ? (!p.texts.length ? <p className="text-sm text-muted">Sem respostas.</p> : <ul className="space-y-1 text-sm">{p.texts.map((t, i) => <li key={i} className="rounded bg-surface-2 px-2 py-1">“{t}”</li>)}</ul>) : (
                <ul className="space-y-1">{keys.map((k) => { const n = p.distribution[k] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0; return (
                  <li key={k} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2 text-sm"><span className="truncate">{label(k)}</span><span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className={clsx('block h-full rounded-full', p.type === 'nps' ? (Number(k) >= 9 ? 'bg-success' : Number(k) >= 7 ? 'bg-warning' : 'bg-danger') : 'bg-primary')} style={{ width: `${pct}%` }} /></span><span className="num text-right text-xs text-muted">{n}</span></li>
                ); })}</ul>
              )}
            </section>
          );
        })}</div>
      )}
      {tab === 'convites' && (
        <section className="card overflow-hidden" aria-label="Convites">
          {!d.invites.length ? <EmptyState title="Nenhum convite" description="Crie um convite pessoal para alguém de uma conta responder." /> : (
            <ul className="divide-y divide-line">{d.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-[220px] flex-1"><p><b className="text-ink">{i.person ?? i.respondentName ?? 'Sem nome'}</b> · {i.account} <Chip tone={INV_TONE[i.status]}>{INVITE_STATUS_LABELS[i.status]}</Chip></p><p className="text-xs text-muted">Enviado por {i.createdByName} em {fmtDateTime(i.createdAt)}{i.emailedAt && ' · por e-mail'} · {i.respondedAt ? `respondido em ${fmtDateTime(i.respondedAt)}` : `vale até ${fmtDate(i.expiresAt)}`} · v{i.version}{i.cancelReason && ` · cancelado: ${i.cancelReason}`}</p></div>
                {(i.status === 'enviado' || i.status === 'aberto') && <Button size="sm" variant="ghost" onClick={() => setCancel(i.id)}>Cancelar</Button>}
              </li>
            ))}</ul>
          )}
        </section>
      )}
      {tab === 'respostas' && (
        <section className="card overflow-hidden" aria-label="Respostas">
          {!d.responses.length ? <EmptyState title="Nenhuma resposta ainda" description="As respostas aparecem aqui assim que chegarem." /> : <ul className="divide-y divide-line">{d.responses.map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm"><p><b className="text-ink">{r.person ?? '—'}</b> · {r.account} · <span className="num text-xs text-muted">{fmtDateTime(r.createdAt)}</span>{r.npsScore !== null && <> · NPS <b>{r.npsScore}</b></>}</p>
              <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">{d.definition.questions.map((qq) => { const v = r.answers[qq.key]; if (v === null || v === undefined || v === '') return null; const show = Array.isArray(v) ? v.map((k) => qq.options?.find((o) => o.key === k)?.label ?? k).join(', ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : qq.options?.find((o) => o.key === v)?.label ?? String(v); return <div key={qq.key} className="contents"><dt className="text-muted">{qq.text}</dt><dd>{show}</dd></div>; })}</dl></li>
          ))}</ul>}
        </section>
      )}
      {tab === 'perguntas' && (
        <section className="card space-y-3 p-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm">{d.definition.questions.map((qq) => <li key={qq.key}>{qq.text} <span className="text-xs text-muted">· {QUESTION_TYPE_LABELS[qq.type]}{qq.required ? ' · obrigatória' : ''}{qq.destination !== 'nenhum' ? ` · vai para: ${SURVEY_DESTINATION_LABELS[qq.destination]} (${qq.mode === 'automatica' ? 'na hora' : 'com revisão'})` : ''}</span></li>)}</ol>
          <h4 className="font-bold text-ink">Versões</h4><ol className="space-y-1 text-sm">{d.versions.map((v) => <li key={v.id}><b>v{v.version}</b> · <span className="num text-xs text-muted">{fmtDateTime(v.createdAt)}</span> · {v.createdByName ?? '—'}: {v.note}</li>)}</ol>
        </section>
      )}
      {editing && <SurveyEditor survey={d} onClose={() => setEditing(false)} />}
      {inviting && <InviteDialog surveyId={d.id} needsPerson={d.definition.questions.some((qq) => qq.destination.startsWith('stakeholder_') || qq.destination.startsWith('pessoa_'))} onClose={() => setInviting(false)} />}
      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Cancelar convite" footer={<><Button variant="secondary" onClick={() => setCancel(null)}>Voltar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={cm.isPending} onClick={() => cm.mutate()}>Cancelar convite</Button></>}>
        <FormField label="Motivo" htmlFor="ic-r" required hint="O link para de funcionar na hora"><Textarea id="ic-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
    </div>
  );
}

/** Convite pessoal: conta (busca), pessoa da conta (opcional ou obrigatória), prazo e envio por e-mail. */
export function InviteDialog({ surveyId, needsPerson, onClose, preset }: { surveyId?: string; needsPerson?: boolean; onClose: () => void; preset?: { contactId: string; account: string; stakeholderId: string } }) {
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['surveys'], enabled: !surveyId, queryFn: () => api<{ items: ListItem[] }>('/surveys') });
  const [sid, setSid] = useState(surveyId ?? '');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 250);
  const found = useQuery({ queryKey: ['contacts-search', term], enabled: !preset && term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string }[] }>(`/contacts?q=${encodeURIComponent(term)}`) });
  const [acc, setAcc] = useState<{ id: string; name: string } | null>(preset ? { id: preset.contactId, name: preset.account } : null);
  const people = useQuery({ queryKey: ['stakeholders', acc?.id], enabled: !!acc, queryFn: () => api<{ items: { id: string; name: string; email: string | null; active: boolean }[] }>(`/accounts/${acc!.id}/stakeholders`) });
  const [f, setF] = useState({ stakeholderId: preset?.stakeholderId ?? '', respondentName: '', respondentEmail: '', days: 15, sendEmail: false });
  const [made, setMade] = useState<{ url: string; emailed: { ok: boolean; error?: string } | null } | null>(null);
  useEffect(() => { if (!surveyId && list.data && !sid) setSid(list.data.items.find((x) => x.active)?.id ?? ''); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const person = people.data?.items.find((p) => p.id === f.stakeholderId);
  const m = useMutation({
    mutationFn: () => api<{ url: string; emailed: { ok: boolean; error?: string } | null }>(`/surveys/${sid}/invites`, { method: 'POST', body: { contactId: acc!.id, stakeholderId: f.stakeholderId || null, respondentName: f.stakeholderId ? null : f.respondentName || null, respondentEmail: f.respondentEmail || null, days: f.days, sendEmail: f.sendEmail } }),
    onSuccess: (r) => { setMade({ ...r, url: `${window.location.origin}${r.url}` }); void qc.invalidateQueries({ queryKey: ['survey'] }); void qc.invalidateQueries({ queryKey: ['surveys'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={made ? 'Convite criado' : 'Novo convite'} size="lg" footer={made ? <Button variant="primary" onClick={onClose}>Concluir</Button> : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!sid || !acc || (needsPerson && !f.stakeholderId)} loading={m.isPending} onClick={() => m.mutate()}>Criar convite</Button></>}>
      {made ? (
        <div className="space-y-3">
          <FormField label="Link pessoal" htmlFor="iv-url"><div className="flex gap-2"><Input id="iv-url" readOnly value={made.url} /><Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void navigator.clipboard.writeText(made.url).then(() => toast({ tone: 'success', message: 'Link copiado' }))}>Copiar</Button></div></FormField>
          {made.emailed && (made.emailed.ok ? <Notice tone="info">Convite enviado por e-mail.</Notice> : <Notice tone="warning">Não foi possível enviar por e-mail: {made.emailed.error} Copie o link e envie por outro canal.</Notice>)}
          <p className="text-sm text-muted">O link é pessoal e vale para uma resposta.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {!surveyId && <FormField label="Pesquisa" htmlFor="iv-s"><Select id="iv-s" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Escolha</option>{list.data?.items.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
          {acc ? <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Conta: <b>{acc.name}</b>{!preset && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => { setAcc(null); setF({ ...f, stakeholderId: '' }); }}>trocar</button>}</p> : (
            <>
              <FormField label="Conta" htmlFor="iv-a"><Input id="iv-a" placeholder="Busque pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} /></FormField>
              {!!found.data?.items.length && <ul className="max-h-40 overflow-y-auto rounded-md border border-line">{found.data.items.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setAcc(c)}>{c.name}</button></li>)}</ul>}
            </>
          )}
          {acc && (
            <FormField label={needsPerson ? 'Pessoa que vai responder' : 'Pessoa da conta (opcional)'} htmlFor="iv-p" hint={needsPerson ? 'Esta pesquisa atualiza dados de uma pessoa: escolha quem vai responder' : undefined}>
              <Select id="iv-p" value={f.stakeholderId} onChange={(e) => setF({ ...f, stakeholderId: e.target.value })}><option value="">{needsPerson ? 'Escolha' : 'Ninguém em especial'}</option>{people.data?.items.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </FormField>
          )}
          {acc && !f.stakeholderId && <div className="grid gap-3 sm:grid-cols-2"><FormField label="Nome de quem responde" htmlFor="iv-n"><Input id="iv-n" value={f.respondentName} onChange={(e) => setF({ ...f, respondentName: e.target.value })} /></FormField><FormField label="E-mail" htmlFor="iv-e"><Input id="iv-e" type="email" value={f.respondentEmail} onChange={(e) => setF({ ...f, respondentEmail: e.target.value })} /></FormField></div>}
          {acc && f.stakeholderId && <p className="text-xs text-muted">E-mail cadastrado: {person?.email ?? 'nenhum'}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Válido por" htmlFor="iv-d"><Select id="iv-d" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>{[7, 15, 30, 60].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select></FormField>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.sendEmail} onChange={(e) => setF({ ...f, sendEmail: e.target.checked })} />Enviar por e-mail agora</label>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- página de resposta (sem login)
type PublicSurvey = { title: string; intro: string; questions: { key: string; type: QuestionType; text: string; required: boolean; options?: { key: string; label: string }[] }[]; account: string | null; respondentName: string | null; expiresAt: string };
export function PublicSurveyPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-survey', token], retry: false, queryFn: () => api<PublicSurvey>(`/public/survey/${token}`) });
  const [a, setA] = useState<Record<string, unknown>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [thanks, setThanks] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ thanks: string }>(`/public/survey/${token}`, { method: 'POST', body: { answers: a } }),
    onSuccess: (r) => setThanks(r.thanks),
    onError: (e) => { if (e instanceof ApiError) setErrs({ ...e.fieldErrors(), _: e.problem.detail ?? e.problem.title }); },
  });
  const shell = (body: React.ReactNode) => <div className="min-h-screen bg-bg"><header className="bg-navy-active px-4 py-4 sm:px-8"><p className="font-display text-lg font-bold text-white">BKT</p></header><main className="mx-auto max-w-2xl p-4 sm:p-8">{body}</main></div>;
  if (q.isLoading) return shell(<LoadingRows rows={4} />);
  if (q.isError) return shell(<ErrorState error={q.error} />);
  if (thanks) return shell(<div className="card p-8 text-center" role="status"><h1 className="font-display text-2xl font-bold text-ink">{thanks}</h1><p className="mt-2 text-sm text-muted">Pode fechar esta página.</p></div>);
  const d = q.data!;
  const scale = (key: string, from: number, to: number, lo: string, hi: string) => (
    <div><div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Nota">{Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => <button key={n} type="button" role="radio" aria-checked={a[key] === n} onClick={() => setA({ ...a, [key]: n })} className={clsx('num h-11 min-w-11 rounded-md border px-2 text-base font-bold', a[key] === n ? 'border-primary bg-primary text-white' : 'border-line bg-surface hover:border-primary')}>{n}</button>)}</div><p className="mt-1 flex justify-between text-xs text-muted"><span>{lo}</span><span>{hi}</span></p></div>
  );
  return shell(
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setErrs({}); m.mutate(); }} noValidate>
      <div><h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{d.title}</h1>{d.respondentName && <p className="mt-1 text-sm text-muted">Olá, {d.respondentName.split(' ')[0]}{d.account ? ` · ${d.account}` : ''}</p>}{d.intro && <p className="mt-2 text-text">{d.intro}</p>}</div>
      {d.questions.map((qq, i) => (
        <fieldset key={qq.key} className={clsx('card space-y-3 p-4', errs[qq.key] && 'border-danger')}>
          <legend className="sr-only">{qq.text}</legend>
          <p className="font-semibold text-ink" aria-hidden><span className="num text-muted">{i + 1}.</span> {qq.text}{qq.required && <span className="text-danger"> *</span>}</p>
          {qq.type === 'nps' ? scale(qq.key, 0, 10, 'Nada provável', 'Muito provável') : qq.type === 'csat' ? scale(qq.key, 1, 5, 'Muito insatisfeito', 'Muito satisfeito') : qq.type === 'escala' ? scale(qq.key, 1, 5, 'Pouco', 'Muito')
            : qq.type === 'sim_nao' ? <div className="flex gap-4">{[true, false].map((v) => <label key={String(v)} className="flex items-center gap-2"><input type="radio" name={qq.key} checked={a[qq.key] === v} onChange={() => setA({ ...a, [qq.key]: v })} />{v ? 'Sim' : 'Não'}</label>)}</div>
            : qq.type === 'escolha' ? <div className="space-y-1.5">{qq.options?.map((o) => <label key={o.key} className="flex items-center gap-2"><input type="radio" name={qq.key} checked={a[qq.key] === o.key} onChange={() => setA({ ...a, [qq.key]: o.key })} />{o.label}</label>)}</div>
            : qq.type === 'multipla' ? <div className="space-y-1.5">{qq.options?.map((o) => { const cur = (a[qq.key] as string[] | undefined) ?? []; return <label key={o.key} className="flex items-center gap-2"><input type="checkbox" checked={cur.includes(o.key)} onChange={(e) => setA({ ...a, [qq.key]: e.target.checked ? [...cur, o.key] : cur.filter((x) => x !== o.key) })} />{o.label}</label>; })}</div>
            : <Textarea aria-label={qq.text} rows={3} value={(a[qq.key] as string) ?? ''} onChange={(e) => setA({ ...a, [qq.key]: e.target.value })} />}
          {errs[qq.key] && <p role="alert" className="text-sm font-semibold text-danger">{errs[qq.key]}</p>}
        </fieldset>
      ))}
      {errs._ && <p role="alert" className="text-sm font-semibold text-danger">{errs._}</p>}
      <Button type="submit" variant="primary" className="w-full sm:w-auto" loading={m.isPending}>Enviar respostas</Button>
      <p className="text-xs text-muted">Link pessoal, válido até {fmtDate(d.expiresAt)}.</p>
    </form>,
  );
}
