/**
 * Prova e certificado do treinamento, no fim da página do playbook (wiki).
 * Quem mantém monta a prova; quem lê faz a prova; aprovado, baixa o certificado (que também vale na gamificação).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Check, ClipboardCheck, Download, FilePenLine, Plus, Trash2, X } from 'lucide-react';
import { DEFAULT_TRAINING_EXAM, type ExamQuestion, type TrainingExam } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, FormField, Input, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type View = { courseTitle: string | null; instructions: string | null; passPct: number; maxAttempts: number; hours: number; certificate: boolean; countsForGamification: boolean; questions: { id: string; text: string; multiple: boolean; options: { id: string; text: string }[] }[] };
type ExamResp =
  | { exists: false; canEdit: boolean; exam: null }
  | {
    exists: true; active: boolean; version: number; canEdit: boolean; canTake: boolean; exam: TrainingExam | null; view: View;
    me: { attempts: { id: string; scorePct: number; passed: boolean; at: string }[]; remaining: number | null; passed: boolean; certificate: { id: string; code: string; issuedOn: string; scorePct: number; hours: number; gamification: boolean } | null };
    stats: { people: number; attempts: number; passed: number } | null;
  };
type Result = { total: number; correct: number; scorePct: number; passed: boolean; passPct: number; remaining: number | null; perQuestion: { id: string; correct: boolean }[]; review: { id: string; correct: string[]; explanation: string | null }[] | null; certificate: { id: string; code: string; gamification: boolean } | null };

const pdfUrl = (id: string) => `/api/v1/training-certificates/${id}/pdf`;
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function TrainingExamSection({ playbookId, title }: { playbookId: string; title: string }) {
  const q = useQuery({ queryKey: ['playbooks', 'exam', playbookId], queryFn: () => api<ExamResp>(`/playbooks/${playbookId}/exam`) });
  const [editing, setEditing] = useState(false);
  const [taking, setTaking] = useState(false);
  const d = q.data;
  if (!d || (!d.exists && !d.canEdit)) return null;
  return (
    <section aria-label="Prova e certificado" className="border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-navy px-5 py-3 text-white">
        <ClipboardCheck className="h-5 w-5 text-lime" aria-hidden />
        <h2 className="flex-1 font-display text-lg font-bold">Prova e certificado</h2>
        {d.canEdit && <Button size="sm" icon={d.exists ? <FilePenLine className="h-4 w-4" /> : <Plus className="h-4 w-4" />} onClick={() => setEditing(true)}>{d.exists ? 'Editar prova' : 'Criar prova'}</Button>}
      </header>
      <div className="space-y-3 p-5 text-sm">
        {!d.exists ? <p className="text-muted">Este treinamento ainda não tem prova. Crie uma para que as pessoas recebam o certificado ao serem aprovadas.</p> : (
          <>
            {!d.active && <p className="border-l-4 border-[#B45309] bg-[#FFF7E6] px-3 py-2 text-[#92400E]">Prova desativada: só quem mantém o playbook vê esta seção.</p>}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([['Questões', String(d.view.questions.length)], ['Nota mínima', pct(d.view.passPct)], ['Tentativas', d.view.maxAttempts ? String(d.view.maxAttempts) : 'Sem limite'], ['Certificado', d.view.certificate ? `${d.view.hours} h${d.view.countsForGamification ? ' · vale na gamificação' : ''}` : 'Não emite']] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold text-ink">{v}</dd></div>
              ))}
            </dl>
            {d.view.instructions && <p className="text-muted">{d.view.instructions}</p>}
            {d.me.certificate ? (
              <div className="flex flex-wrap items-center gap-3 border border-[#15803D]/40 bg-[#F0FDF4] px-4 py-3">
                <Award className="h-6 w-6 text-[#15803D]" aria-hidden />
                <p className="flex-1 text-ink"><b>Aprovado com {pct(d.me.certificate.scorePct)}.</b> Certificado {d.me.certificate.code}, emitido em {fmtDate(d.me.certificate.issuedOn)}{d.me.certificate.gamification ? '; já conta como curso complementar em Meus pontos.' : '.'}</p>
                <a className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" href={pdfUrl(d.me.certificate.id)} target="_blank" rel="noreferrer"><Download className="h-4 w-4" aria-hidden />Baixar certificado</a>
              </div>
            ) : d.me.passed ? <p className="font-semibold text-[#15803D]">Você foi aprovado nesta prova.</p> : d.canTake && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={<ClipboardCheck className="h-4 w-4" />} disabled={d.me.remaining === 0} onClick={() => setTaking(true)}>Fazer a prova</Button>
                <span className="text-muted">{d.me.remaining === 0 ? 'Você usou todas as tentativas. Fale com quem mantém o treinamento.' : d.me.remaining != null ? `${d.me.remaining} de ${d.view.maxAttempts} tentativas restantes.` : 'Tentativas sem limite.'}</span>
              </div>
            )}
            {!!d.me.attempts.length && (
              <ul aria-label="Minhas tentativas" className="space-y-0.5 text-xs text-muted">{d.me.attempts.map((a) => <li key={a.id}>{fmtDateTime(a.at)} · {pct(a.scorePct)} · <span className={a.passed ? 'font-semibold text-[#15803D]' : 'font-semibold text-danger'}>{a.passed ? 'aprovado' : 'não aprovado'}</span></li>)}</ul>
            )}
            {d.stats && <p className="text-xs text-muted">Resultados: {d.stats.people} pessoa(s) fizeram, {d.stats.passed} aprovada(s), {d.stats.attempts} tentativa(s).</p>}
          </>
        )}
      </div>
      {editing && <ExamEditor playbookId={playbookId} initial={d.exists ? d.exam ?? DEFAULT_TRAINING_EXAM : DEFAULT_TRAINING_EXAM} active={d.exists ? d.active : true} title={title} onClose={() => setEditing(false)} />}
      {taking && d.exists && <TakeExam playbookId={playbookId} view={d.view} onClose={() => setTaking(false)} />}
    </section>
  );
}

function TakeExam({ playbookId, view, onClose }: { playbookId: string; view: View; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const send = useMutation({
    mutationFn: () => api<Result>(`/playbooks/${playbookId}/exam/attempts`, { method: 'POST', body: { answers } }),
    onSuccess: () => { for (const k of [['playbooks', 'exam', playbookId], ['meus-pontos'], ['certificados']]) void qc.invalidateQueries({ queryKey: k }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const r = send.data;
  const pick = (qid: string, oid: string, multiple: boolean) => setAnswers((a) => {
    const cur = a[qid] ?? [];
    return { ...a, [qid]: multiple ? (cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid]) : [oid] };
  });
  const unanswered = view.questions.filter((q) => !(answers[q.id] ?? []).length).length;
  return (
    <Modal open onClose={onClose} size="lg" title={`Prova · ${view.courseTitle ?? 'Treinamento'}`}
      footer={r ? <Button variant="primary" onClick={onClose}>Fechar</Button> : <><span className="mr-auto text-xs text-muted">{unanswered ? `${unanswered} sem resposta` : 'Todas respondidas'}</span><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>Enviar respostas</Button></>}>
      {r && (
        <div role="status" className={clsx('mb-4 border-l-4 px-4 py-3', r.passed ? 'border-[#15803D] bg-[#F0FDF4] text-[#14532D]' : 'border-danger bg-danger-soft text-ink')}>
          <p className="font-display text-xl font-bold">{r.passed ? 'Aprovado' : 'Não foi desta vez'} · {pct(r.scorePct)}</p>
          <p className="text-sm">{r.correct} de {r.total} questões certas; nota mínima {pct(r.passPct)}.{!r.passed && (r.remaining === 0 ? ' Você usou todas as tentativas.' : r.remaining != null ? ` Restam ${r.remaining} tentativa(s): revise o playbook e tente de novo.` : ' Revise o playbook e tente de novo.')}</p>
          {r.certificate && <a className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" href={pdfUrl(r.certificate.id)} target="_blank" rel="noreferrer"><Download className="h-4 w-4" aria-hidden />Baixar certificado {r.certificate.code}</a>}
          {r.certificate?.gamification && <p className="mt-1 text-xs">O certificado já conta como curso complementar validado em Meus pontos.</p>}
        </div>
      )}
      {view.instructions && !r && <p className="mb-3 text-sm text-muted">{view.instructions}</p>}
      <ol className="space-y-4">
        {view.questions.map((q, i) => {
          const res = r?.perQuestion.find((x) => x.id === q.id);
          const rev = r?.review?.find((x) => x.id === q.id);
          return (
            <li key={q.id} aria-label={`Questão ${i + 1}`} className={clsx('border p-3', res ? (res.correct ? 'border-[#15803D]/50' : 'border-danger/60') : 'border-line')}>
              <p className="font-semibold text-ink"><span className="num mr-1 text-muted">{i + 1}.</span>{q.text}{q.multiple && <span className="ml-1 text-xs font-normal text-muted">(marque todas as corretas)</span>}
                {res && (res.correct ? <Check className="ml-1 inline h-4 w-4 text-[#15803D]" aria-label="certa" /> : <X className="ml-1 inline h-4 w-4 text-danger" aria-label="errada" />)}</p>
              <div className="mt-2 space-y-1">
                {q.options.map((o) => (
                  <label key={o.id} className={clsx('flex items-start gap-2 text-sm', rev?.correct.includes(o.id) && 'font-semibold text-[#15803D]')}>
                    <input type={q.multiple ? 'checkbox' : 'radio'} name={`q-${q.id}`} className="mt-0.5 h-4 w-4 accent-primary" disabled={!!r} checked={(answers[q.id] ?? []).includes(o.id)} onChange={() => pick(q.id, o.id, q.multiple)} />
                    <span>{o.text}</span>
                  </label>
                ))}
              </div>
              {rev?.explanation && <p className="mt-2 text-xs text-muted">{rev.explanation}</p>}
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const newQuestion = (): ExamQuestion => ({ id: nid('q'), text: '', options: [{ id: nid('o'), text: '' }, { id: nid('o'), text: '' }], correct: [], explanation: null });

function ExamEditor({ playbookId, initial, active: active0, title, onClose }: { playbookId: string; initial: TrainingExam; active: boolean; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [e, setE] = useState<TrainingExam>(() => ({ ...structuredClone(initial), questions: initial.questions.length ? structuredClone(initial.questions) : [newQuestion()] }));
  const [active, setActive] = useState(active0);
  const n = (x: string) => Math.round(Number(x.replace(/\D/g, '') || 0));
  const setQ = (i: number, q: ExamQuestion) => setE({ ...e, questions: e.questions.map((x, k) => (k === i ? q : x)) });
  const save = useMutation({
    mutationFn: () => api(`/playbooks/${playbookId}/exam`, { method: 'PUT', body: { ...e, active } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks', 'exam', playbookId] }); toast({ tone: 'success', message: 'Prova salva' }); onClose(); },
    onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  return (
    <Modal open onClose={onClose} size="xl" title="Prova do treinamento"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar prova</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome do curso no certificado" htmlFor="ex-title" hint={`Em branco: ${title}`}><Input id="ex-title" value={e.courseTitle ?? ''} maxLength={200} onChange={(x) => setE({ ...e, courseTitle: x.target.value || null })} /></FormField>
        <FormField label="Orientações para quem vai fazer" htmlFor="ex-ins"><Input id="ex-ins" value={e.instructions ?? ''} maxLength={2000} onChange={(x) => setE({ ...e, instructions: x.target.value || null })} /></FormField>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField label="Nota mínima (%)" htmlFor="ex-pass"><Input id="ex-pass" inputMode="numeric" className="num" value={String(e.passPct)} onChange={(x) => setE({ ...e, passPct: n(x.target.value) })} /></FormField>
        <FormField label="Tentativas por pessoa" htmlFor="ex-att" hint="0 = sem limite"><Input id="ex-att" inputMode="numeric" className="num" value={String(e.maxAttempts)} onChange={(x) => setE({ ...e, maxAttempts: n(x.target.value) })} /></FormField>
        <FormField label="Carga horária (h)" htmlFor="ex-h"><Input id="ex-h" inputMode="numeric" className="num" value={String(e.hours)} onChange={(x) => setE({ ...e, hours: n(x.target.value) })} /></FormField>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={e.certificate} onChange={(x) => setE({ ...e, certificate: x.target.checked, countsForGamification: x.target.checked && e.countsForGamification })} />Emitir certificado na aprovação</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={e.countsForGamification} disabled={!e.certificate} onChange={(x) => setE({ ...e, countsForGamification: x.target.checked })} />Certificado vale como curso complementar na gamificação</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={active} onChange={(x) => setActive(x.target.checked)} />Prova ativa</label>
      </div>
      <p className="mt-2 text-xs text-muted">Quem faz a prova não vê as respostas certas; o gabarito aparece só depois da aprovação. Mudar a prova não altera tentativas nem certificados já emitidos.</p>
      <ol className="mt-4 space-y-3">
        {e.questions.map((q, i) => (
          <li key={q.id} aria-label={`Questão ${i + 1}`} className="border border-line p-3">
            <div className="flex items-start gap-2">
              <span className="num mt-2 text-sm font-bold text-muted">{i + 1}.</span>
              <Textarea aria-label={`Enunciado da questão ${i + 1}`} rows={2} className="flex-1" value={q.text} maxLength={2000} placeholder="Enunciado" onChange={(x) => setQ(i, { ...q, text: x.target.value })} />
              <button type="button" aria-label={`Excluir questão ${i + 1}`} className="mt-2 text-muted hover:text-danger" disabled={e.questions.length === 1} onClick={() => setE({ ...e, questions: e.questions.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-xs text-muted">Marque a(s) alternativa(s) correta(s). Com mais de uma, a pessoa precisa marcar todas.</p>
            <div className="mt-1 space-y-1">
              {q.options.map((o, k) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input type="checkbox" aria-label={`Alternativa ${k + 1} correta`} className="h-4 w-4 accent-primary" checked={q.correct.includes(o.id)} onChange={() => setQ(i, { ...q, correct: q.correct.includes(o.id) ? q.correct.filter((c) => c !== o.id) : [...q.correct, o.id] })} />
                  <Input aria-label={`Alternativa ${k + 1} da questão ${i + 1}`} className="flex-1" value={o.text} maxLength={500} placeholder={`Alternativa ${k + 1}`} onChange={(x) => setQ(i, { ...q, options: q.options.map((y) => (y.id === o.id ? { ...y, text: x.target.value } : y)) })} />
                  <button type="button" aria-label={`Excluir alternativa ${k + 1}`} className="text-muted hover:text-danger" disabled={q.options.length <= 2} onClick={() => setQ(i, { ...q, options: q.options.filter((y) => y.id !== o.id), correct: q.correct.filter((c) => c !== o.id) })}><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {q.options.length < 8 && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setQ(i, { ...q, options: [...q.options, { id: nid('o'), text: '' }] })}>Adicionar alternativa</button>}
              <Input aria-label={`Explicação da questão ${i + 1}`} className="min-w-[240px] flex-1 text-xs" value={q.explanation ?? ''} maxLength={1000} placeholder="Explicação mostrada depois da aprovação (opcional)" onChange={(x) => setQ(i, { ...q, explanation: x.target.value || null })} />
            </div>
          </li>
        ))}
      </ol>
      {e.questions.length < 100 && <Button className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={() => setE({ ...e, questions: [...e.questions, newQuestion()] })}>Adicionar questão</Button>}
    </Modal>
  );
}
