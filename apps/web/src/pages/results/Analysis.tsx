/** Jornada de análise da intervenção: Problema → Pareto → Ishikawa → 5 Porquês → Conclusão. Salva sozinho enquanto a pessoa escreve. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Search, X } from 'lucide-react';
import {
  ANALYSIS_STEPS, analysisGaps, diagnosisFrom, paretoRows,
  type AnalysisContent, type AnalysisPareto, type IshikawaCause, type IshikawaKey, type WhyChain,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Breadcrumb, Button, ErrorState, FormField, Input, LoadingRows, Notice, SaveStatus, Tabs, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';

type Step = (typeof ANALYSIS_STEPS)[number]['key'];
type Resp = {
  analysis: { rowVersion: number; status: 'rascunho' | 'concluida'; conclusion: string | null; concludedAt: string | null; concludedByName: string | null } | null;
  content: AnalysisContent; categories: { key: IshikawaKey; label: string; hint: string }[]; canEdit: boolean; canReopen: boolean;
};
const newId = () => Math.random().toString(36).slice(2, 10);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['interventions', 'analysis', id], queryFn: () => api<Resp>(`/interventions/${id}/analysis`) });
  const iv = useQuery({ queryKey: ['interventions', 'one', id], queryFn: () => api<{ displayTitle: string; competencias: string[]; ownerName: string }>(`/interventions/${id}`) });
  const [step, setStep] = useState<Step>('problema');
  const [c, setC] = useState<AnalysisContent | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // aceita o conteúdo do servidor na primeira carga e quando ele está à frente da versão local (conclusão, reabertura, outra aba)
  useEffect(() => {
    if (!q.data) return;
    const sv = q.data.analysis?.rowVersion ?? 0;
    if (c === null || (!dirty && sv > (version ?? -1))) { setC(q.data.content); setVersion(sv); }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (fn: (x: AnalysisContent) => AnalysisContent) => { setC((x) => (x ? fn(x) : x)); setDirty(true); };

  const save = useMutation({
    mutationFn: (content: AnalysisContent) => api<{ rowVersion: number }>(`/interventions/${id}/analysis`, { method: 'PUT', body: { rowVersion: version ?? 0, content } }),
    onMutate: () => setSaveState('saving'),
    onSuccess: (r, sent) => { setVersion(r.rowVersion); setSaveState('saved'); if (sent === cRef.current) setDirty(false); },
    onError: (e) => { setSaveState('error'); if (e instanceof ApiError && e.status === 409) toast({ tone: 'error', message: 'Outra pessoa alterou esta análise. Recarregue a página para ver a versão atual.' }); },
  });
  const cRef = useRef(c); cRef.current = c;
  useEffect(() => {
    if (!dirty || !c || save.isPending || saveState === 'error') return;
    const t = setTimeout(() => save.mutate(c), 900);
    return () => clearTimeout(t);
  }, [c, dirty, save.isPending, saveState]); // eslint-disable-line react-hooks/exhaustive-deps

  const conclude = useMutation({
    mutationFn: (conclusion: string) => api(`/interventions/${id}/analysis/conclude`, { method: 'POST', body: { rowVersion: version, conclusion: conclusion || undefined } }),
    onSuccess: () => { setDirty(false); void qc.invalidateQueries({ queryKey: ['interventions'] }); toast({ tone: 'success', message: 'Análise concluída. O diagnóstico já está no plano de ação.' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const [reopenWhy, setReopenWhy] = useState('');
  const reopen = useMutation({
    mutationFn: () => api(`/interventions/${id}/analysis/reopen`, { method: 'POST', body: { rowVersion: version, reason: reopenWhy } }),
    onSuccess: () => { setReopenWhy(''); void qc.invalidateQueries({ queryKey: ['interventions'] }); toast({ tone: 'success', message: 'Análise reaberta' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });

  const gaps = useMemo(() => (c ? analysisGaps(c) : []), [c]);
  if (q.isLoading || !c) return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />;
  const d = q.data!;
  const ro = !d.canEdit;
  const concluded = d.analysis?.status === 'concluida';
  const countFor = (k: Step) => gaps.filter((g) => g.step === k).length;
  return (
    <div>
      <Breadcrumb items={[{ label: 'Intervenções', to: '/times/intervencoes' }, { label: iv.data?.displayTitle ?? '…', to: `/times/intervencoes?id=${id}` }, { label: 'Análise' }]} />
      <PageHeader icon={<Search />} title="Análise da intervenção" subtitle={iv.data ? `${iv.data.displayTitle} · responsável ${iv.data.ownerName}` : ''}
        actions={!ro ? <SaveStatus state={dirty && saveState !== 'saving' && saveState !== 'error' ? 'idle' : saveState} onRetry={() => { setSaveState('idle'); save.mutate(c); }} /> : undefined} />
      {concluded && <Notice tone="info">Análise concluída por {d.analysis!.concludedByName} em {fmtDateTime(d.analysis!.concludedAt!)}. Para alterar, reabra com o motivo.</Notice>}
      {!concluded && ro && <Notice tone="info">Você acompanha esta análise; quem conduz é o responsável pela intervenção ou quem está acima dele.</Notice>}
      <Tabs label="Etapas da análise" value={step} onChange={setStep} className="my-4" tabs={ANALYSIS_STEPS.map((s) => ({ key: s.key, label: s.label, count: concluded ? undefined : countFor(s.key) || undefined }))} />

      {step === 'problema' && (
        <section className="card grid max-w-3xl gap-4 p-5">
          <p className="text-sm text-muted">Descreva o desvio com fatos, sem apontar culpados nem já propor solução.</p>
          <FormField label="O quê" htmlFor="an-what" required hint="Qual resultado ficou abaixo do esperado?"><Textarea id="an-what" rows={2} readOnly={ro} value={c.problem.what} onChange={(e) => edit((x) => ({ ...x, problem: { ...x.problem, what: e.target.value } }))} /></FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Onde" htmlFor="an-where"><Input id="an-where" readOnly={ro} value={c.problem.where} onChange={(e) => edit((x) => ({ ...x, problem: { ...x.problem, where: e.target.value } }))} /></FormField>
            <FormField label="Quando" htmlFor="an-when"><Input id="an-when" readOnly={ro} value={c.problem.when} onChange={(e) => edit((x) => ({ ...x, problem: { ...x.problem, when: e.target.value } }))} /></FormField>
            <FormField label="Quanto" htmlFor="an-much" required hint="Tamanho do desvio"><Input id="an-much" readOnly={ro} value={c.problem.howMuch} onChange={(e) => edit((x) => ({ ...x, problem: { ...x.problem, howMuch: e.target.value } }))} /></FormField>
          </div>
        </section>
      )}
      {step === 'pareto' && <ParetoStep id={id!} ro={ro} value={c.pareto} onChange={(p) => edit((x) => ({ ...x, pareto: p }))} />}
      {step === 'ishikawa' && <IshikawaStep ro={ro} problem={c.problem.what} categories={d.categories} causes={c.causes} onChange={(causes) => edit((x) => ({ ...x, causes }))} />}
      {step === 'porques' && <WhysStep ro={ro} causes={c.causes.filter((x) => x.selected && x.text.trim())} whys={c.whys} onChange={(whys) => edit((x) => ({ ...x, whys }))} />}
      {step === 'conclusao' && (
        <section className="card max-w-3xl space-y-4 p-5">
          {concluded ? <pre className="whitespace-pre-wrap font-sans text-sm">{d.analysis!.conclusion}</pre> : gaps.length ? (
            <>
              <h2 className="font-bold text-ink">Falta pouco</h2>
              <ul className="space-y-1 text-sm">{gaps.map((g, i) => <li key={i}><button type="button" className="text-left text-primary hover:underline" onClick={() => setStep(g.step)}>{ANALYSIS_STEPS.find((s) => s.key === g.step)!.label}</button>: {g.message}</li>)}</ul>
            </>
          ) : (
            <ConcludeBox preview={diagnosisFrom(c)} ro={ro} pending={conclude.isPending || save.isPending || dirty} onConclude={(t) => conclude.mutate(t)} />
          )}
          {d.canReopen && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <FormField label="Motivo para reabrir" htmlFor="an-reopen" className="min-w-[280px] flex-1"><Input id="an-reopen" value={reopenWhy} onChange={(e) => setReopenWhy(e.target.value)} /></FormField>
              <Button variant="secondary" disabled={reopenWhy.trim().length < 10} loading={reopen.isPending} onClick={() => reopen.mutate()}>Reabrir análise</Button>
            </div>
          )}
          <Link to={`/times/intervencoes?id=${id}`} className="inline-block text-sm font-semibold text-primary hover:underline">Voltar à intervenção</Link>
        </section>
      )}
    </div>
  );
}

function ConcludeBox({ preview, ro, pending, onConclude }: { preview: string; ro: boolean; pending: boolean; onConclude: (t: string) => void }) {
  const [t, setT] = useState(preview);
  useEffect(() => setT(preview), [preview]);
  return (
    <>
      <h2 className="font-bold text-ink">Diagnóstico</h2>
      <p className="text-sm text-muted">Montado a partir das etapas. Ajuste o texto se quiser; ele vai para o plano de ação.</p>
      <Textarea aria-label="Diagnóstico" rows={8} readOnly={ro} value={t} onChange={(e) => setT(e.target.value)} />
      {!ro && <Button variant="primary" loading={pending} onClick={() => onConclude(t === preview ? '' : t)}>Concluir análise</Button>}
    </>
  );
}

function ParetoStep({ id, ro, value, onChange }: { id: string; ro: boolean; value: AnalysisPareto | null; onChange: (p: AnalysisPareto) => void }) {
  const toast = useToast();
  const p = value ?? { title: 'Ocorrências por motivo', source: 'manual' as const, items: [{ label: '', value: 0 }] };
  const { rows, total } = paretoRows(p.items);
  const load = useMutation({
    mutationFn: (source: 'motivos_perda' | 'motivos_perda_valor') => api<{ items: { label: string; value: number }[]; sample: number }>(`/interventions/${id}/analysis/pareto-data?source=${source}`).then((r) => ({ ...r, source })),
    onSuccess: (r) => {
      if (!r.items.length) { toast({ tone: 'error', message: 'Nenhuma negociação perdida no período da meta. Monte o Pareto à mão.' }); return; }
      onChange({ title: r.source === 'motivos_perda' ? 'Negociações perdidas por motivo' : 'Valor mensal perdido por motivo (R$)', source: r.source, items: r.items });
      toast({ tone: 'success', message: `Pareto preenchido com ${r.sample} negociação(ões) perdida(s) do período` });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const setItem = (i: number, v: Partial<{ label: string; value: number }>) => onChange({ ...p, source: 'manual', items: p.items.map((x, k) => (k === i ? { ...x, ...v } : x)) });
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <section className="card space-y-3 p-5">
        <p className="text-sm text-muted">Onde se concentra o problema? Liste as ocorrências por categoria; os poucos itens que somam 80% são o foco.</p>
        {!ro && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={load.isPending && load.variables === 'motivos_perda'} onClick={() => load.mutate('motivos_perda')}>Usar perdas do período (quantidade)</Button>
            <Button variant="secondary" size="sm" loading={load.isPending && load.variables === 'motivos_perda_valor'} onClick={() => load.mutate('motivos_perda_valor')}>Usar perdas do período (valor)</Button>
          </div>
        )}
        <FormField label="Título" htmlFor="pa-title"><Input id="pa-title" readOnly={ro} value={p.title} onChange={(e) => onChange({ ...p, title: e.target.value })} /></FormField>
        <ul className="space-y-2">
          {p.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <Input aria-label={`Categoria ${i + 1}`} placeholder="Categoria" className="flex-1" readOnly={ro} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} />
              <Input aria-label={`Valor ${i + 1}`} inputMode="decimal" className="w-28" readOnly={ro} value={it.value ? String(it.value).replace('.', ',') : ''} onChange={(e) => setItem(i, { value: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 })} />
              {!ro && <button type="button" aria-label={`Remover categoria ${i + 1}`} className="rounded p-2 text-muted hover:text-danger" onClick={() => onChange({ ...p, items: p.items.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
        {!ro && p.items.length < 30 && <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange({ ...p, items: [...p.items, { label: '', value: 0 }] })}>Adicionar categoria</Button>}
        {p.source !== 'manual' && <p className="text-xs text-muted">Origem: negociações perdidas registradas no CRM no período da meta.</p>}
      </section>
      <section className="card p-5">
        <h2 className="mb-2 font-bold text-ink">{p.title || 'Pareto'}</h2>
        {rows.length < 2 ? <p className="text-sm text-muted">Informe pelo menos duas categorias com valor para ver o gráfico.</p> : <ParetoChart rows={rows} total={total} />}
      </section>
    </div>
  );
}

function ParetoChart({ rows, total }: { rows: ReturnType<typeof paretoRows>['rows']; total: number }) {
  const W = 640, H = 280, L = 44, R = 44, T = 16, B = 70;
  const iw = W - L - R, ih = H - T - B;
  const max = rows[0]!.value;
  const bw = iw / rows.length;
  const y = (v: number) => T + ih - (v / max) * ih;
  const yc = (c: number) => T + ih - c * ih;
  const line = rows.map((r, i) => `${L + bw * i + bw / 2},${yc(r.cumulative)}`).join(' ');
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Pareto: ${rows.filter((r) => r.vital).map((r) => r.label).join(', ')} somam ${pct(rows.filter((r) => r.vital).at(-1)!.cumulative)} do total`}>
        <line x1={L} x2={W - R} y1={yc(0.8)} y2={yc(0.8)} className="stroke-muted" strokeDasharray="4 4" strokeWidth={1} />
        <text x={W - R + 4} y={yc(0.8) + 4} className="fill-muted text-[11px]">80%</text>
        <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} className="stroke-line" />
        {rows.map((r, i) => (
          <g key={r.label}>
            <rect x={L + bw * i + bw * 0.15} width={bw * 0.7} y={y(r.value)} height={T + ih - y(r.value)} rx={3} className={r.vital ? 'fill-primary' : 'fill-primary/30'} />
            <text x={L + bw * i + bw / 2} y={y(r.value) - 4} textAnchor="middle" className="num fill-ink text-[11px]">{Number.isInteger(r.value) ? r.value : r.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</text>
            <text x={L + bw * i + bw / 2} y={T + ih + 14} textAnchor="end" transform={`rotate(-30 ${L + bw * i + bw / 2} ${T + ih + 14})`} className="fill-ink text-[11px]">{r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}</text>
          </g>
        ))}
        <polyline points={line} fill="none" className="stroke-ink" strokeWidth={2} />
        {rows.map((r, i) => <circle key={r.label} cx={L + bw * i + bw / 2} cy={yc(r.cumulative)} r={3} className="fill-ink" />)}
        <text x={L - 6} y={T + 8} textAnchor="end" className="fill-muted text-[11px]">{max.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>
        <text x={W - R + 4} y={T + 8} className="fill-muted text-[11px]">100%</text>
      </svg>
      <figcaption className="mt-2 text-sm"><b>Foco:</b> {rows.filter((r) => r.vital).map((r) => `${r.label} (${pct(r.share)})`).join(', ')} · total <span className="num">{total.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span></figcaption>
    </figure>
  );
}

function IshikawaStep({ ro, problem, categories, causes, onChange }: { ro: boolean; problem: string; categories: Resp['categories']; causes: IshikawaCause[]; onChange: (c: IshikawaCause[]) => void }) {
  const [draft, setDraft] = useState<Partial<Record<IshikawaKey, string>>>({});
  const add = (k: IshikawaKey) => { const t = (draft[k] ?? '').trim(); if (!t) return; onChange([...causes, { id: newId(), category: k, text: t, selected: false }]); setDraft({ ...draft, [k]: '' }); };
  const box = (cat: Resp['categories'][number]) => (
    <div key={cat.key} className="rounded-lg border border-line bg-surface p-3">
      <h3 className="font-bold text-ink">{cat.label}</h3>
      <p className="mb-2 text-xs text-muted">{cat.hint}</p>
      <ul className="space-y-1.5">
        {causes.filter((c) => c.category === cat.key).map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" disabled={ro} checked={c.selected} aria-label={`Investigar: ${c.text}`} onChange={(e) => onChange(causes.map((x) => (x.id === c.id ? { ...x, selected: e.target.checked } : x)))} />
            <span className={clsx('flex-1', c.selected && 'font-semibold')}>{c.text}</span>
            {!ro && <button type="button" aria-label={`Remover causa ${c.text}`} className="text-muted hover:text-danger" onClick={() => onChange(causes.filter((x) => x.id !== c.id))}><X className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
      </ul>
      {!ro && (
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); add(cat.key); }}>
          <Input aria-label={`Nova causa em ${cat.label}`} placeholder="Nova causa" className="h-8 flex-1 text-sm" value={draft[cat.key] ?? ''} onChange={(e) => setDraft({ ...draft, [cat.key]: e.target.value })} />
          <Button type="submit" variant="secondary" size="sm" aria-label={`Adicionar causa em ${cat.label}`} icon={<Plus className="h-4 w-4" />} />
        </form>
      )}
    </div>
  );
  return (
    <section className="card p-5">
      <p className="mb-4 text-sm text-muted">Liste as causas possíveis em cada categoria e marque as mais prováveis para investigar nos 5 Porquês.</p>
      <div className="grid gap-3 md:grid-cols-3">{categories.slice(0, 3).map(box)}</div>
      <div className="my-3 flex items-center gap-0" aria-hidden>
        <div className="h-1 flex-1 rounded-l bg-ink/70" />
        <div className="h-0 w-0 border-y-[10px] border-l-[14px] border-y-transparent border-l-ink/70" />
        <div className="ml-2 max-w-[40%] rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white">{problem.trim() || 'Problema'}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">{categories.slice(3).map(box)}</div>
    </section>
  );
}

function WhysStep({ ro, causes, whys, onChange }: { ro: boolean; causes: IshikawaCause[]; whys: WhyChain[]; onChange: (w: WhyChain[]) => void }) {
  if (!causes.length) return <section className="card p-5"><p className="text-sm text-muted">Marque no Ishikawa as causas que vão ser investigadas.</p></section>;
  const chainOf = (id: string): WhyChain => whys.find((w) => w.causeId === id) ?? { causeId: id, whys: [''], rootCause: '', evidence: '', confirmed: false };
  const put = (w: WhyChain) => onChange([...whys.filter((x) => x.causeId !== w.causeId), w]);
  return (
    <div className="space-y-4">
      {causes.map((cause) => {
        const w = chainOf(cause.id);
        const shown = Math.min(5, Math.max(3, w.whys.filter((x) => x.trim()).length + 1));
        return (
          <section key={cause.id} className="card max-w-3xl space-y-3 p-5" aria-label={`5 Porquês: ${cause.text}`}>
            <h2 className="font-bold text-ink">{cause.text}</h2>
            <ol className="space-y-2">
              {Array.from({ length: shown }, (_, k) => (
                <li key={k} className="flex items-center gap-2" style={{ paddingLeft: k * 12 }}>
                  <span className="num w-20 shrink-0 text-xs font-semibold text-muted">{k + 1}º por quê?</span>
                  <Input aria-label={`${k + 1}º por quê — ${cause.text}`} readOnly={ro} value={w.whys[k] ?? ''} onChange={(e) => { const arr = [...w.whys]; arr[k] = e.target.value; put({ ...w, whys: arr.slice(0, 5) }); }} />
                </li>
              ))}
            </ol>
            <FormField label="Causa raiz encontrada" htmlFor={`rc-${cause.id}`}><Input id={`rc-${cause.id}`} readOnly={ro} value={w.rootCause} onChange={(e) => put({ ...w, rootCause: e.target.value })} /></FormField>
            <FormField label="Evidência" htmlFor={`ev-${cause.id}`} hint="Dado ou fato que confirma a causa"><Textarea id={`ev-${cause.id}`} rows={2} readOnly={ro} value={w.evidence} onChange={(e) => put({ ...w, evidence: e.target.value })} /></FormField>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={w.confirmed} onChange={(e) => put({ ...w, confirmed: e.target.checked })} /> Causa raiz confirmada pela evidência</label>
          </section>
        );
      })}
    </div>
  );
}

