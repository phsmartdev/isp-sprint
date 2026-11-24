/**
 * Academia — prova da trilha, do lado de quem aprende: responde, entrega, vê a nota e a correção. O gabarito e as
 * explicações só chegam do servidor depois da aprovação ou quando acabam as tentativas.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Check, ChevronLeft, X } from 'lucide-react';
import { optionLetter } from '@isp/domain';
import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';
import { Breadcrumb, Button, ErrorState, LoadingRows } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';

type Status = { used: number; left: number | null; best: number | null; passed: boolean; canTry: boolean };
type Attempt = { id: string; correct: number; total: number; pct: number; passed: boolean; at: string };
type ReviewQ = { id: string; text: string; options: string[]; chosen: number | null; right: boolean; correct?: number; explanation?: string | null };
type Review = { attempt: Attempt; revealed: boolean; questions: ReviewQ[] };
type QuizData = {
  track: { id: string; title: string; completedAt: string | null };
  quiz: { passPct: number; maxAttempts: number | null; total: number; questions: { id: string; text: string; options: string[] }[] };
  status: Status; available: boolean; attempts: Attempt[]; review: Review | null;
};
type SubmitRes = { result: { correct: number; total: number; pct: number; passed: boolean }; status: Status; completed: boolean; review: Review };

export function AcademyQuizPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient(), toast = useToast();
  const r = useQuery({ queryKey: ['academia', 'prova', id], queryFn: () => api<QuizData>(`/academia/trilhas/${id}/prova`), refetchOnWindowFocus: false });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitRes | null>(null);
  const send = useMutation({
    mutationFn: () => api<SubmitRes>(`/academia/trilhas/${id}/prova`, { method: 'POST', body: { answers } }),
    onSuccess: (x) => {
      setResult(x); setAnswers({});
      void qc.invalidateQueries({ queryKey: ['academia'] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (r.isLoading) return <LoadingRows rows={6} />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!;
  const status = result?.status ?? d.status;
  const review = result?.review ?? (d.status.canTry ? null : d.review);
  const answering = !result && d.available && d.status.canTry && d.quiz.questions.length > 0;
  const answered = d.quiz.questions.filter((q) => answers[q.id] !== undefined).length;
  const back = `/playbooks/academia/trilhas/${id}`;
  const attemptsLine = d.quiz.maxAttempts ? `${status.used} de ${d.quiz.maxAttempts} tentativa(s) usada(s)` : `${status.used} tentativa(s) · ilimitadas`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Breadcrumb items={[{ label: 'Playbooks', to: '/playbooks' }, { label: d.track.title, to: back }, { label: 'Prova' }]} />
      <header className="space-y-1">
        <Link to={back} className="inline-flex items-center gap-1 text-sm text-primary"><ChevronLeft className="h-4 w-4" />Voltar à trilha</Link>
        <h1 className="font-display text-2xl font-bold text-ink">Prova — {d.track.title}</h1>
        <p className="text-sm text-muted">{d.quiz.total} pergunta(s) · nota mínima {d.quiz.passPct}% · {attemptsLine}{status.best !== null ? ` · melhor nota ${status.best}%` : ''}</p>
      </header>

      {!d.available && (
        <div className="border border-line bg-surface px-5 py-6 text-center">
          <p className="font-semibold text-ink">A prova libera depois que você assiste às aulas obrigatórias.</p>
          <Link to={back} className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">Ir para as aulas</Link>
        </div>
      )}

      {result && <ResultBanner r={result} trackId={id} onRetry={() => { setResult(null); void r.refetch(); }} />}
      {!result && d.status.passed && <div className="flex items-center gap-3 border border-[#15803D] bg-[#F0FDF4] px-5 py-4 text-ink"><Award className="h-6 w-6 text-[#15803D]" aria-hidden /><span><b>Você foi aprovado</b> com {d.status.best}%.{' '}<Link to={back} className="font-semibold text-primary hover:underline">Baixe o certificado na página da trilha.</Link></span></div>}
      {!result && d.available && !d.status.canTry && !d.status.passed && <div className="border border-danger/40 bg-[#FEF2F2] px-5 py-4 text-sm text-ink"><b>Tentativas esgotadas.</b> Sua melhor nota foi {d.status.best ?? 0}% (mínimo {d.quiz.passPct}%). Fale com a curadoria da trilha.</div>}

      {answering && (
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-4">
          {d.status.used > 0 && d.review && !d.review.revealed && <p className="border border-line bg-surface-2 px-4 py-2 text-sm text-text">Na tentativa anterior você acertou {d.review.attempt.correct} de {d.review.attempt.total} ({d.review.attempt.pct}%).</p>}
          <ol className="space-y-4">{d.quiz.questions.map((q, qi) => (
            <li key={q.id} className="border border-line bg-surface" data-testid="quiz-q">
              <fieldset className="p-5">
                <legend className="sr-only">Pergunta {qi + 1}</legend>
                <p className="mb-3 font-semibold text-ink"><span className="mr-1 text-primary">{qi + 1}.</span>{q.text}</p>
                <div className="space-y-2">{q.options.map((o, oi) => (
                  <label key={oi} className={clsx('flex cursor-pointer items-start gap-3 border px-3 py-2 text-sm', answers[q.id] === oi ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
                    <input type="radio" name={`q-${q.id}`} className="mt-0.5" checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                    <span><b className="mr-1">{optionLetter(oi)})</b>{o}</span>
                  </label>
                ))}</div>
              </fieldset>
            </li>
          ))}</ol>
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-5 py-3">
            <span className="text-sm text-muted"><span className="num">{answered}</span> de {d.quiz.total} respondida(s)</span>
            <Button type="submit" variant="primary" disabled={answered < d.quiz.total} loading={send.isPending}>Entregar prova</Button>
          </div>
        </form>
      )}

      {review && <ReviewList review={review} />}

      {d.attempts.length > 0 && !answering && (
        <section aria-label="Tentativas" className="border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-semibold text-ink">Tentativas</h2>
          <ul className="divide-y divide-line">{d.attempts.map((a, i) => (
            <li key={a.id} className="flex justify-between px-5 py-2 text-sm"><span>{i + 1}ª · {fmtDateTime(a.at)}</span><span className={clsx('num font-semibold', a.passed ? 'text-[#15803D]' : 'text-danger')}>{a.pct}% ({a.correct}/{a.total}){a.passed ? ' · aprovada' : ''}</span></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

function ResultBanner({ r, trackId, onRetry }: { r: SubmitRes; trackId: string; onRetry: () => void }) {
  const ok = r.result.passed;
  return (
    <div role="status" className={clsx('space-y-2 border px-5 py-4', ok ? 'border-[#15803D] bg-[#F0FDF4]' : 'border-danger/40 bg-[#FEF2F2]')} data-testid="quiz-result">
      <p className="num font-display text-3xl font-extrabold text-ink">{r.result.pct}% <span className="text-base font-semibold text-muted">({r.result.correct} de {r.result.total})</span></p>
      <p className="font-semibold text-ink">{ok ? (r.completed ? 'Aprovado! Trilha concluída.' : 'Aprovado!') : 'Abaixo da nota mínima.'}</p>
      <div className="flex flex-wrap gap-3">
        {ok && <Link to={`/playbooks/academia/trilhas/${trackId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><Award className="h-4 w-4" aria-hidden />Ver a trilha e baixar o certificado</Link>}
        {!ok && r.status.canTry && <Button variant="primary" onClick={onRetry}>Tentar de novo{r.status.left !== null ? ` (${r.status.left} restante${r.status.left > 1 ? 's' : ''})` : ''}</Button>}
        {!ok && !r.status.canTry && <span className="text-sm text-ink">Você usou todas as tentativas. Fale com a curadoria da trilha.</span>}
      </div>
    </div>
  );
}

function ReviewList({ review }: { review: Review }) {
  return (
    <section aria-label="Correção" className="space-y-3">
      <h2 className="font-display text-lg font-bold text-ink">Correção</h2>
      {!review.revealed && <p className="text-sm text-muted">Você vê o que acertou e errou. A resposta certa e a explicação aparecem quando você for aprovado ou acabarem as tentativas.</p>}
      <ol className="space-y-3">{review.questions.map((q, qi) => (
        <li key={q.id} className={clsx('border-l-4 border bg-surface p-4', q.right ? 'border-l-[#15803D] border-line' : 'border-l-danger border-line')} data-testid="review-q">
          <p className="mb-2 flex items-start gap-2 font-semibold text-ink">{q.right ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" aria-label="acertou" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="errou" />}<span>{qi + 1}. {q.text}</span></p>
          <ul className="space-y-1 text-sm">{q.options.map((o, oi) => {
            const mine = q.chosen === oi, right = review.revealed && q.correct === oi;
            return (
              <li key={oi} className={clsx('px-2 py-1', right && 'bg-[#F0FDF4] font-semibold text-[#15803D]', mine && !q.right && 'bg-[#FEF2F2] text-danger', mine && q.right && 'bg-[#F0FDF4] font-semibold text-[#15803D]')}>
                <b className="mr-1">{optionLetter(oi)})</b>{o}{mine ? ' — sua resposta' : ''}{right && !mine ? ' — resposta certa' : ''}
              </li>
            );
          })}</ul>
          {review.revealed && q.explanation && <p className="mt-2 border-t border-line pt-2 text-sm text-text"><b>Explicação:</b> {q.explanation}</p>}
        </li>
      ))}</ol>
    </section>
  );
}
