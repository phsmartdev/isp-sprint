import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Lightbulb, MessageSquareQuote, Search } from 'lucide-react';
import type { InstructionJourney } from '@isp/shared';
import { api } from '../lib/api';
import { Input, SaveStatus, Select, Textarea } from '../components/ui/primitives';

type Playbook = { version: number; jornadas: InstructionJourney[]; objecoes: { id: string; titulo: string; resposta: string; jornadas: string[] }[] };
export const usePlaybook = () => useQuery({ queryKey: ['playbook'], queryFn: () => api<Playbook>('/meta/playbook'), staleTime: 5 * 60_000 });

/** Roteiro da etapa atual (e o que já foi respondido antes), com salvamento automático das respostas. */
export function StageScript({ oppId, pipelineKey, stage, disabled }: { oppId: string; pipelineKey: string; stage: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const pb = usePlaybook();
  const answersQ = useQuery({ queryKey: ['answers', oppId], queryFn: () => api<{ items: { questionId: string; answer: string }[] }>(`/opportunities/${oppId}/answers`) });
  const journey = pb.data?.jornadas.find((j) => j.chave === pipelineKey);
  const idx = journey?.etapas.findIndex((e) => e.chave === stage) ?? -1;
  const current = idx >= 0 ? journey!.etapas[idx]! : null;
  const earlier = (journey?.etapas.slice(0, Math.max(0, idx)) ?? []).filter((e) => e.perguntas.length);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef<Record<string, string>>({});
  const timer = useRef<number>();
  useEffect(() => { if (answersQ.data) setValues(Object.fromEntries(answersQ.data.items.map((a) => [a.questionId, a.answer]))); }, [answersQ.data]);
  const flush = async () => {
    const entries = Object.entries(dirty.current);
    if (!entries.length) return;
    dirty.current = {};
    setStatus('saving');
    try {
      await api(`/opportunities/${oppId}/answers`, { method: 'PUT', body: { answers: entries.map(([questionId, answer]) => ({ questionId, answer })) } });
      setStatus('saved');
      qc.invalidateQueries({ queryKey: ['answers', oppId] });
    } catch {
      setStatus('error');
    }
  };
  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (id: string, v: string) => {
    setValues((x) => ({ ...x, [id]: v }));
    dirty.current[id] = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };
  if (!journey || !current) return null;
  const answered = (id: string) => !!values[id]?.trim();
  const Q = ({ q }: { q: InstructionJourney['etapas'][number]['perguntas'][number] }) => {
    const id = `q-${q.id}`;
    return (
      <div className="rounded-md border border-line p-3">
        <label htmlFor={id} className="flex items-start gap-2 text-sm font-semibold text-ink">
          {answered(q.id) ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <span className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', q.obrigatoria ? 'bg-warning' : 'bg-line-strong')} aria-hidden />}
          <span>{q.texto}{q.obrigatoria && <span className="ml-1 text-xs font-normal text-[#B45309]">(obrigatória)</span>}</span>
        </label>
        {q.ajuda && <p className="ml-6 text-xs text-muted">{q.ajuda}</p>}
        <div className="ml-6 mt-2">
          {q.tipo === 'sim_nao' ? (
            <div className="flex gap-2" role="radiogroup" aria-label={q.texto}>
              {[['sim', 'Sim'], ['nao', 'Não']].map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={values[q.id] === v} disabled={disabled} onClick={() => set(q.id, values[q.id] === v ? '' : v!)} className={clsx('rounded-full border px-4 py-1.5 text-sm', values[q.id] === v ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line hover:border-line-strong')}>{l}</button>
              ))}
            </div>
          ) : q.tipo === 'opcoes' ? (
            <Select id={id} value={values[q.id] ?? ''} disabled={disabled} onChange={(e) => set(q.id, e.target.value)}>
              <option value="">Escolha</option>
              {q.opcoes?.map((o) => <option key={o}>{o}</option>)}
            </Select>
          ) : (
            <Textarea id={id} className="min-h-[56px]" value={values[q.id] ?? ''} disabled={disabled} onChange={(e) => set(q.id, e.target.value)} />
          )}
        </div>
      </div>
    );
  };
  return (
    <section className="card p-5" aria-labelledby="h-script">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="h-script" className="text-md font-bold text-ink">Roteiro · {current.nome}</h2>
        <SaveStatus state={status} onRetry={() => void flush()} />
      </div>
      {current.dicas.length > 0 && (
        <ul className="mb-3 space-y-1">
          {current.dicas.map((d) => <li key={d} className="flex gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary"><Lightbulb className="h-4 w-4 shrink-0" aria-hidden />{d}</li>)}
        </ul>
      )}
      {current.perguntas.length ? <div className="space-y-2">{current.perguntas.map((q) => <Q key={q.id} q={q} />)}</div> : <p className="text-sm text-muted">Sem perguntas nesta etapa.</p>}
      {earlier.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Etapas anteriores ({earlier.reduce((a, e) => a + e.perguntas.filter((q) => answered(q.id)).length, 0)}/{earlier.reduce((a, e) => a + e.perguntas.length, 0)} respondidas)</summary>
          <div className="mt-2 space-y-3">
            {earlier.map((e) => (
              <div key={e.chave}>
                <p className="mb-1 text-xs font-semibold text-muted">{e.nome}</p>
                <div className="space-y-2">{e.perguntas.map((q) => <Q key={q.id} q={q} />)}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function Objections({ pipelineKey }: { pipelineKey: string }) {
  const pb = usePlaybook();
  const [term, setTerm] = useState('');
  const list = useMemo(() => (pb.data?.objecoes ?? []).filter((o) => (!o.jornadas.length || o.jornadas.includes(pipelineKey)) && (!term || `${o.titulo} ${o.resposta}`.toLowerCase().includes(term.toLowerCase()))), [pb.data, pipelineKey, term]);
  if (!pb.data?.objecoes.length) return null;
  return (
    <section className="card p-5" aria-labelledby="h-obj">
      <h2 id="h-obj" className="mb-2 flex items-center gap-2 text-md font-bold text-ink"><MessageSquareQuote className="h-5 w-5 text-primary" />Objeções</h2>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <Input aria-label="Buscar objeção" className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="O cliente disse…" />
      </div>
      <ul className="space-y-1.5">
        {list.map((o) => (
          <li key={o.id}>
            <details className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-ink">“{o.titulo}”</summary>
              <p className="mt-1.5 text-sm text-text">{o.resposta}</p>
            </details>
          </li>
        ))}
        {!list.length && <li className="text-sm text-muted">Nada encontrado.</li>}
      </ul>
    </section>
  );
}
