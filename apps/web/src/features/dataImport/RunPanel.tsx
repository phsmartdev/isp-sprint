/**
 * Execução (simulação ou importação): progresso real, controles, indicadores de qualidade separados, dependências
 * incluídas e o navegador de registros — original da origem à esquerda, transformado à direita, com o que mudou.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { RECORD_ACTION_LABELS, TARGET_ENTITIES, TARGET_ENTITY_LABELS, type ImportConfig, type Quality, type TargetEntity } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { ACTION_LABEL, ACTION_TONE, Counters, ModeChip, RunStatusChip, pretty, scopeText, useImportSchema, useRunDriver, type Caps, type RecordItem, type RunSummary } from './shared';

export type RunDetail = {
  run: RunSummary; can: Caps; config: ImportConfig; quality: Quality; byEntity: Record<string, Record<string, number>>;
  comparison: { action: string; simulacao: number; importacao: number }[] | null; jobs: Record<string, number>; failedJobs: { job: Record<string, unknown>; error: string | null; attempts: number }[];
  selection: { selecionados: number; dependencias: { entity: string; reason: string; n: number }[] };
};

function QualityCards({ q }: { q: Quality }) {
  const cards: [string, string, string, boolean][] = [
    ['Cobertura de campos', `${q.campos}%`, 'campos de destino preenchidos', q.campos < 50],
    ['Cobertura de registros', `${q.registros}%`, 'registros sem erro impeditivo', q.registros < 100],
    ['Transformações', `${q.transformacoes}%`, 'conversões sem erro', q.transformacoes < 100],
    ['Relacionamentos', `${q.relacionamentos}%`, 'registros com relações resolvidas', q.relacionamentos < 100],
    ['Duplicidades', String(q.duplicidades), 'achados por CPF/CNPJ ou e-mail', q.duplicidades > 0],
    ['Com legado', String(q.legado), 'registros com campos preservados', false],
    ['Erros impeditivos', String(q.impeditivos), 'nunca são gravados', q.impeditivos > 0],
    ['Pendentes de revisão', String(q.revisao), 'precisam de decisão', q.revisao > 0],
  ];
  return (
    <section aria-label="Indicadores de qualidade" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([l, v, sub, warn]) => <div key={l} className={clsx('rounded-md border bg-surface p-3', warn ? 'border-warning/40' : 'border-line')}><p className="text-xs text-muted">{l}</p><p className={clsx('num text-2xl font-bold', warn ? 'text-[#9A4B07]' : 'text-ink')}>{v}</p><p className="text-[11px] text-muted">{sub}</p></div>)}
      </div>
      {!!q.porCampo.length && (
        <div className="rounded-md border border-line bg-surface p-3">
          <p className="mb-1 text-sm font-semibold text-ink">Onde estão os problemas</p>
          <ul className="grid gap-x-6 text-sm sm:grid-cols-2">{q.porCampo.map((f) => <li key={f.field} className="flex justify-between border-b border-line py-1"><span>{f.field.replace(/^(\w+)\./, (_, e: string) => `${TARGET_ENTITY_LABELS[e as TargetEntity] ?? e} · `)}</span><span className="num font-semibold">{f.count}</span></li>)}</ul>
        </div>
      )}
    </section>
  );
}

type Groups = { review: { entity: string; reason: string | null; n: number; decided: number }[]; reviewIssues: { entity: string; message: string; n: number }[]; errors: { entity: string; message: string; n: number }[] };
/** O que travou, agrupado por motivo, com decisão em lote para os registros em revisão. */
function ReviewGroups({ runId, canDecide }: { runId: string; canDecide: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['import', 'run', runId, 'groups'], queryFn: () => api<Groups>(`/admin/import/runs/${runId}/review-groups`) });
  const bulk = useMutation({ mutationFn: (b: { entity: string; reason: string; decision: string | null }) => api<{ count: number }>(`/admin/import/runs/${runId}/decisions`, { method: 'POST', body: b }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['import', 'run', runId] }); toast({ tone: 'success', message: `Decisão aplicada a ${r.count} registro(s)` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (!q.data || (!q.data.review.length && !q.data.errors.length)) return null;
  const d = q.data;
  const ent = (e: string) => TARGET_ENTITY_LABELS[e as TargetEntity] ?? e;
  return (
    <section aria-label="Pendências agrupadas" className="grid gap-4 lg:grid-cols-2">
      {!!d.review.length && (
        <div className="rounded-md border border-warning/40 bg-surface p-3 text-sm">
          <p className="mb-2 font-semibold text-ink">Em revisão</p>
          <ul className="space-y-2">{d.review.map((g) => (
            <li key={`${g.entity}${g.reason}`} className="border-b border-line pb-2">
              <p><b>{g.n}</b> × {ent(g.entity)} — {g.reason}{g.decided ? <span className="text-xs text-muted"> ({g.decided} já decididos)</span> : null}</p>
              {canDecide && <div className="mt-1 flex flex-wrap gap-1.5">
                {g.reason?.startsWith('Já existe') && <Button size="sm" onClick={() => bulk.mutate({ entity: g.entity, reason: g.reason!, decision: 'vincular' })}>Vincular todos aos existentes</Button>}
                {g.reason?.startsWith('Alterado manualmente') && <Button size="sm" onClick={() => bulk.mutate({ entity: g.entity, reason: g.reason!, decision: 'atualizar' })}>Sobrescrever todos</Button>}
                {g.reason === 'Campos para revisar' && <Button size="sm" onClick={() => bulk.mutate({ entity: g.entity, reason: g.reason!, decision: 'importar' })}>Importar todos assim mesmo</Button>}
                <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ entity: g.entity, reason: g.reason!, decision: 'ignorar' })}>Não importar</Button>
                {!!g.decided && <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ entity: g.entity, reason: g.reason!, decision: null })}>Desfazer</Button>}
              </div>}
            </li>
          ))}</ul>
          {!!d.reviewIssues.length && <><p className="mt-2 text-xs font-semibold text-muted">Motivos</p><ul className="text-xs">{d.reviewIssues.map((x, i) => <li key={i}>{x.n} × {ent(x.entity)}: {x.message}</li>)}</ul></>}
          <p className="mt-2 text-[11px] text-muted">"Importar assim mesmo" grava sem o que ficou pendente (ex.: tarefa sem a negociação, ligada só à empresa). As decisões valem para a importação desta simulação.</p>
        </div>
      )}
      {!!d.errors.length && (
        <div className="rounded-md border border-danger/30 bg-surface p-3 text-sm">
          <p className="mb-2 font-semibold text-ink">Erros (nunca são gravados)</p>
          <ul className="space-y-1">{d.errors.map((x, i) => <li key={i} className="border-b border-line pb-1"><b>{x.n}</b> × {ent(x.entity)}: {x.message}</li>)}</ul>
          <p className="mt-2 text-[11px] text-muted">Corrija o mapeamento ou a planilha e simule de novo, ou siga sem eles.</p>
        </div>
      )}
    </section>
  );
}

function Value({ v, changed }: { v: unknown; changed?: boolean }) {
  return <span className={clsx('break-all', changed && 'bg-[#E0F2FE] px-0.5')}>{pretty(v)}</span>;
}

function RecordBrowser({ runId, mode, canDecide }: { runId: string; mode: 'simulacao' | 'importacao'; canDecide: boolean }) {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [idx, setIdx] = useState(0);
  const qc = useQueryClient();
  const toast = useToast();
  const schema = useImportSchema();
  const q = useQuery({ queryKey: ['import', 'run', runId, 'records', action, entity, page], queryFn: () => api<{ total: number; page: number; items: RecordItem[] }>(`/admin/import/runs/${runId}/records?page=${page}${action ? `&action=${action}` : ''}${entity ? `&entity=${entity}` : ''}`) });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: string | null }) => api(`/admin/import/records/${id}/decision`, { method: 'POST', body: { decision } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['import', 'run', runId, 'records'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const items = q.data?.items ?? [];
  const r = items[Math.min(idx, items.length - 1)];
  const fields = r ? schema.data?.schema[r.targetEntity] ?? [] : [];
  return (
    <section aria-label="Registros" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-ink">Registros, lado a lado</h3>
        <Select aria-label="Filtrar por resultado" className="h-8 w-40 text-sm" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); setIdx(0); }}><option value="">Todos</option>{Object.entries(RECORD_ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Filtrar por entidade" className="h-8 w-44 text-sm" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); setIdx(0); }}><option value="">Todas as entidades</option>{TARGET_ENTITIES.map((t) => <option key={t} value={t}>{TARGET_ENTITY_LABELS[t]}</option>)}</Select>
        <span className="ml-auto text-sm text-muted">{q.data ? `${q.data.total} registro(s)` : ''}</span>
      </div>
      {q.isLoading ? <LoadingRows rows={4} /> : !items.length ? <p className="text-sm text-muted">Nenhum registro com este filtro.</p> : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ul className="max-h-[560px] overflow-auto rounded-md border border-line bg-surface text-sm" aria-label="Lista de registros">
            {items.map((x, i) => (
              <li key={x.id}><button type="button" aria-current={i === idx} onClick={() => setIdx(i)} className={clsx('flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left', i === idx ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                <Chip tone={ACTION_TONE[x.action]}>{ACTION_LABEL[x.action]}</Chip>
                <span className="min-w-0 flex-1 truncate">{pretty(x.values.name ?? x.values.title ?? x.values.text ?? x.sourceId)}<span className="block text-[11px] text-muted">{TARGET_ENTITY_LABELS[x.targetEntity]} · {x.sourceId}</span></span>
              </button></li>
            ))}
            <li className="flex items-center justify-between px-3 py-2 text-xs"><button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); setIdx(0); }} className="disabled:opacity-40" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>Página {page}<button type="button" disabled={(q.data?.total ?? 0) <= page * 25} onClick={() => { setPage(page + 1); setIdx(0); }} className="disabled:opacity-40" aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button></li>
          </ul>
          {r && (
            <article aria-label="Registro selecionado" className="space-y-3 rounded-md border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Chip>
                <span className="text-sm text-text">{r.reason}</span>
                {r.duplicate && <Chip tone="orange">Possível duplicidade</Chip>}
                <span className="ml-auto text-xs text-muted">Entrou por: {r.selectedBecause}</span>
              </div>
              {!!r.issues.length && <ul className="space-y-1 text-sm">{r.issues.map((i, k) => <li key={k} className={clsx('rounded-sm px-2 py-1', i.level === 'erro' ? 'bg-danger-soft text-danger' : i.level === 'revisao' ? 'bg-[#FFF6D6] text-[#9A6B00]' : 'bg-surface-2 text-muted')}><b>{fields.find((f) => f.key === i.field)?.label ?? i.field}:</b> {i.message}</li>)}</ul>}
              {mode === 'simulacao' && canDecide && (r.action === 'revisar' || r.action === 'criar' || r.action === 'atualizar') && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Decisão para a importação:</span>
                  {r.action === 'revisar' && (r.duplicate ? <Button size="sm" variant={r.decision === 'vincular' ? 'primary' : 'secondary'} onClick={() => decide.mutate({ id: r.id, decision: 'vincular' })}>Vincular ao existente</Button>
                    : r.reason?.startsWith('Alterado manualmente') ? <Button size="sm" variant={r.decision === 'atualizar' ? 'primary' : 'secondary'} onClick={() => decide.mutate({ id: r.id, decision: 'atualizar' })}>Sobrescrever com a origem</Button>
                    : <Button size="sm" variant={r.decision === 'importar' ? 'primary' : 'secondary'} onClick={() => decide.mutate({ id: r.id, decision: 'importar' })}>Importar assim mesmo</Button>)}
                  <Button size="sm" variant={r.decision === 'ignorar' ? 'primary' : 'secondary'} onClick={() => decide.mutate({ id: r.id, decision: 'ignorar' })}>Não importar</Button>
                  {r.decision && <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, decision: null })}>Desfazer decisão</Button>}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0"><p className="mb-1 text-xs font-semibold text-muted">Original na origem ({r.sourceEntity} {r.sourceId})</p><pre className="max-h-96 overflow-auto rounded-sm bg-surface-2 p-2 text-[11px] leading-snug">{JSON.stringify(r.raw, null, 2)}</pre></div>
                <div className="min-w-0"><p className="mb-1 text-xs font-semibold text-muted">No ISP Sprint ({TARGET_ENTITY_LABELS[r.targetEntity]})</p>
                  <table className="w-full text-sm"><tbody>{fields.map((f) => {
                    const has = f.key in r.values || f.key in r.originals;
                    if (!has) return null;
                    const conv = r.converted.includes(f.key);
                    const bad = r.issues.some((i) => i.field === f.key && i.level !== 'aviso');
                    return <tr key={f.key} className={clsx('border-b border-line align-top', bad && 'bg-danger-soft/50')}><td className="w-40 py-1 pr-2 text-xs text-muted">{f.label}</td><td className="py-1"><Value v={r.values[f.key]} changed={conv} />{conv && <span className="block text-[11px] text-muted">de: {pretty(r.originals[f.key])}</span>}</td></tr>;
                  })}</tbody></table>
                  {!!Object.keys(r.legacy).length && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted">Preservado como legado ({Object.keys(r.legacy).length} campo(s) sem correspondência)</summary><pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-surface-2 p-2">{JSON.stringify(r.legacy, null, 2)}</pre></details>}
                </div>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export function RunPanel({ runId, autoDrive = true }: { runId: string; autoDrive?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['import', 'run', runId], queryFn: () => api<RunDetail>(`/admin/import/runs/${runId}`) });
  const running = !!q.data && ['na_fila', 'em_andamento'].includes(q.data.run.status);
  const canDrive = !!q.data && (q.data.run.mode === 'simulacao' ? q.data.can.simular : q.data.can.executar);
  const driveErr = useRunDriver(runId, autoDrive && running && canDrive);
  const control = useMutation({ mutationFn: (action: string) => api(`/admin/import/runs/${runId}/control`, { method: 'POST', body: { action } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['import'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const r = d.run;
  const done = ['concluida', 'concluida_com_pendencias', 'cancelada', 'falhou'].includes(r.status);
  const pct = r.counters.identificados ? Math.round((r.counters.processados / r.counters.identificados) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <ModeChip m={r.mode} /><RunStatusChip s={r.status} />
        <span className="text-sm text-text">#{r.code} · {r.template ? `${r.template} v${r.version}` : 'Configuração avulsa'}{r.temporaryChanges && ' · com alterações temporárias'}</span>
        <span className="text-xs text-muted">{scopeText(r.scope)} · {r.startedBy} · {fmtDateTime(r.createdAt)}</span>
        {canDrive && <span className="ml-auto flex gap-2">
          {running && <Button size="sm" icon={<Pause className="h-4 w-4" />} loading={control.isPending} onClick={() => control.mutate('pausar')}>Pausar</Button>}
          {(r.status === 'pausada' || r.status === 'falhou') && <Button size="sm" icon={<Play className="h-4 w-4" />} loading={control.isPending} onClick={() => control.mutate('retomar')}>Retomar</Button>}
          {!done && <Button size="sm" variant="ghost" icon={<Square className="h-4 w-4" />} onClick={() => { if (window.confirm('Cancelar a execução? O que já foi gravado fica.')) control.mutate('cancelar'); }}>Cancelar</Button>}
          {!!d.jobs.falhou && r.status !== 'cancelada' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => control.mutate('refazer_falhas')}>Refazer buscas que falharam ({d.jobs.falhou})</Button>}
        </span>}
      </div>
      {running && (
        <div aria-label="Progresso" className="space-y-1">
          <p className="text-sm text-text">{r.phase === 'extracao' ? `Buscando na origem: ${d.jobs.feito ?? 0} busca(s) feitas, ${d.jobs.pendente ?? 0} na fila` : `Processando ${r.counters.processados} de ${r.counters.identificados}`}</p>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={r.phase === 'processamento' ? pct : undefined} aria-valuemin={0} aria-valuemax={100}><div className={clsx('h-full bg-primary transition-all', r.phase === 'extracao' && 'w-1/4 animate-pulse')} style={r.phase === 'processamento' ? { width: `${pct}%` } : undefined} /></div>
          {!canDrive && <p className="text-xs text-muted">Quem iniciou conduz o processamento.</p>}
        </div>
      )}
      {driveErr && <Notice tone="warning">{driveErr}</Notice>}
      {r.error && <Notice tone="warning">Interrompida: {r.error}</Notice>}
      <Counters c={r.counters} />
      {!!r.warnings.length && <Notice tone="warning"><ul className="list-disc pl-4">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>}
      {d.comparison && (
        <section aria-label="Simulação × importação"><h3 className="mb-2 font-bold text-ink">Simulação × importação</h3>
          <table className="text-sm"><thead className="text-xs text-muted"><tr><th className="pr-6 text-left font-medium">Resultado</th><th className="pr-6 text-right font-medium">Simulação</th><th className="text-right font-medium">Importação</th></tr></thead>
            <tbody>{d.comparison.map((c) => <tr key={c.action} className="border-t border-line"><td className="py-1 pr-6">{ACTION_LABEL[c.action as RecordItem['action']]}</td><td className="num pr-6 text-right">{c.simulacao}</td><td className={clsx('num text-right font-semibold', c.simulacao !== c.importacao && 'text-[#9A4B07]')}>{c.importacao}</td></tr>)}</tbody></table>
          {d.comparison.some((c) => c.simulacao !== c.importacao) && <p className="mt-1 text-xs text-muted">Diferenças vêm de dados alterados na origem entre a simulação e a importação, ou de decisões tomadas na revisão.</p>}
        </section>
      )}
      {(done || r.phase === 'processamento') && <QualityCards q={d.quality} />}
      <section aria-label="Seleção" className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-line bg-surface p-3 text-sm">
          <p className="font-semibold text-ink">Seleção conferida</p>
          <p className="text-text">{d.selection.selecionados} registro(s) escolhidos pelo escopo.</p>
          {!!d.selection.dependencias.length && <><p className="mt-2 text-xs font-semibold text-muted">Incluídos como dependência (e por quê):</p><ul className="max-h-40 overflow-auto text-xs">{d.selection.dependencias.map((x, i) => <li key={i} className="border-b border-line py-0.5">{x.n} × {x.entity} — {x.reason}</li>)}</ul></>}
        </div>
        <div className="rounded-md border border-line bg-surface p-3 text-sm">
          <p className="font-semibold text-ink">Por entidade</p>
          <table className="w-full text-xs"><tbody>{Object.entries(d.byEntity).map(([e, v]) => <tr key={e} className="border-b border-line"><td className="py-1">{TARGET_ENTITY_LABELS[e as TargetEntity] ?? e}</td><td className="py-1 text-right">{Object.entries(v).map(([a, n]) => `${ACTION_LABEL[a as RecordItem['action']]} ${n}`).join(' · ')}</td></tr>)}</tbody></table>
          {!!d.failedJobs.length && <><p className="mt-2 text-xs font-semibold text-danger">Buscas que falharam</p><ul className="text-xs">{d.failedJobs.map((j, i) => <li key={i}>{String(j.job.path ?? j.job.entity)} — {j.error} ({j.attempts}×)</li>)}</ul></>}
        </div>
      </section>
      {done && r.mode === 'simulacao' && <ReviewGroups runId={runId} canDecide={d.can.simular} />}
      {(done || r.phase !== 'extracao') && <RecordBrowser runId={runId} mode={r.mode} canDecide={d.can.simular} />}
    </div>
  );
}
