/** Data Import Engine — tipos, consultas e peças comuns às telas. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportConfig, ImportScope, Issue, RunCounters, TargetEntity, TargetField } from '@isp/domain';
import { SCOPE_LABELS } from '@isp/domain';
import { api } from '../../lib/api';
import { Chip, type Tone } from '../../components/ui/primitives';

export type Caps = Record<'painel' | 'conectores' | 'modelos' | 'aprovar_versao' | 'simular' | 'executar' | 'grande_volume' | 'auditoria', boolean>;
export type RefOpt = { id: string; label: string; sub?: string | null };
export type SchemaResp = { schema: Record<TargetEntity, TargetField[]>; can: Caps; refs: Record<'usuario' | 'etapa' | 'origem' | 'filial', RefOpt[]> };
export type ConnectorItem = { id: string; kind: 'rdstation_crm' | 'csv'; name: string; status: 'nao_testado' | 'ok' | 'falhou'; lastTestAt: string | null; lastTestResult: string | null; archived: boolean; hasToken: boolean; files: { id: string; entity: string; name: string; idColumn: string | null; rows: number; createdAt: string }[] };
export type DiscoveredField = { path: string; type: string; samples: string[]; filled: number; total: number };
export type RunSummary = { id: string; code: number; mode: 'simulacao' | 'importacao'; status: RunStatus; phase: 'extracao' | 'processamento' | 'fim'; counters: RunCounters; scope: ImportScope; template: string | null; version: string | null; temporaryChanges: boolean; startedBy: string | null; createdAt: string; finishedAt: string | null; warnings: string[]; error: string | null; simulationRunId: string | null; source: string };
export type RunStatus = 'na_fila' | 'em_andamento' | 'pausada' | 'cancelada' | 'concluida' | 'concluida_com_pendencias' | 'falhou';
export type RecordItem = { id: string; sourceEntity: string; sourceId: string; targetEntity: TargetEntity; action: 'criar' | 'atualizar' | 'ignorar' | 'revisar' | 'erro'; targetId: string | null; values: Record<string, unknown>; originals: Record<string, unknown>; converted: string[]; issues: Issue[]; legacy: Record<string, unknown>; reason: string | null; duplicate: boolean; decision: string | null; raw: Record<string, unknown>; selectedBecause: string };

export const STATUS_LABEL: Record<RunStatus, [string, Tone]> = {
  na_fila: ['Na fila', 'neutral'], em_andamento: ['Em andamento', 'blue'], pausada: ['Pausada', 'yellow'], cancelada: ['Cancelada', 'neutral'],
  concluida: ['Concluída', 'green'], concluida_com_pendencias: ['Concluída com pendências', 'orange'], falhou: ['Interrompida', 'red'],
};
export const RunStatusChip = ({ s }: { s: RunStatus }) => <Chip tone={STATUS_LABEL[s][1]}>{STATUS_LABEL[s][0]}</Chip>;
export const ModeChip = ({ m }: { m: 'simulacao' | 'importacao' }) => <Chip tone={m === 'simulacao' ? 'sky' : 'purple'}>{m === 'simulacao' ? 'Simulação' : 'Importação'}</Chip>;
export const ACTION_TONE: Record<RecordItem['action'], Tone> = { criar: 'green', atualizar: 'blue', ignorar: 'neutral', revisar: 'yellow', erro: 'red' };
export const ACTION_LABEL: Record<RecordItem['action'], string> = { criar: 'Criar', atualizar: 'Atualizar', ignorar: 'Ignorar', revisar: 'Revisar', erro: 'Erro' };

export function scopeText(s: ImportScope): string {
  switch (s.mode) {
    case 'uma_oportunidade': return `${SCOPE_LABELS[s.mode]}: conta ${s.accountId}, oportunidade ${s.opportunityId}`;
    case 'uma_conta': return `${SCOPE_LABELS[s.mode]}: conta ${s.accountId}`;
    case 'base_completa': return SCOPE_LABELS[s.mode];
    case 'personalizado': {
      const parts = [s.accountIds.length && `${s.accountIds.length} conta(s)`, s.opportunityIds.length && `${s.opportunityIds.length} oportunidade(s)`, s.ownerIds.length && `${s.ownerIds.length} responsável(is)`, s.stageIds.length && `${s.stageIds.length} etapa(s)`, s.pipelineIds.length && `${s.pipelineIds.length} funil(is)`, s.status.length && s.status.join('/'), (s.createdFrom || s.createdTo) && `criadas ${s.createdFrom ?? '…'} a ${s.createdTo ?? '…'}`, (s.closedFrom || s.closedTo) && `fechadas ${s.closedFrom ?? '…'} a ${s.closedTo ?? '…'}`, s.imported !== 'todos' && (s.imported === 'importados' ? 'só já importados' : 'só ainda não importados')].filter(Boolean);
      return `${SCOPE_LABELS[s.mode]}${parts.length ? `: ${parts.join(', ')}` : ''}`;
    }
  }
}

export const useImportSchema = () => useQuery({ queryKey: ['import', 'schema'], queryFn: () => api<SchemaResp>('/admin/import/schema'), staleTime: 60_000 });
export const useConnectors = () => useQuery({ queryKey: ['import', 'connectors'], queryFn: () => api<{ items: ConnectorItem[]; can: Caps }>('/admin/import/connectors') });

/** Contadores reais da execução (nada estimado). */
export function Counters({ c, compact }: { c: RunCounters; compact?: boolean }) {
  const items: [string, number, string][] = [['Identificados', c.identificados, 'text-ink'], ['Processados', c.processados, 'text-ink'], ['Criados', c.criados, 'text-[#15803D]'], ['Atualizados', c.atualizados, 'text-primary'], ['Ignorados', c.ignorados, 'text-muted'], ['Para revisar', c.revisar, 'text-[#9A6B00]'], ['Com erro', c.erros, 'text-danger'], ['Pendentes', c.pendentes, 'text-muted']];
  return (
    <dl className={compact ? 'flex flex-wrap gap-x-4 gap-y-1 text-xs' : 'grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8'}>
      {items.map(([l, v, tone]) => compact
        ? <div key={l} className="flex gap-1"><dt className="text-muted">{l}</dt><dd className={`num font-semibold ${tone}`}>{v}</dd></div>
        : <div key={l} className="rounded-md border border-line bg-surface p-3"><dt className="text-xs text-muted">{l}</dt><dd className={`num text-2xl font-bold ${tone}`}>{v.toLocaleString('pt-BR')}</dd></div>)}
    </dl>
  );
}

/**
 * Conduz a execução enquanto a tela está aberta: chama um passo de cada vez (a API processa em lotes curtos e
 * guarda o checkpoint). Fechar a tela só pausa o avanço; ao voltar, continua de onde parou.
 */
export function useRunDriver(runId: string | null, active: boolean, onUpdate?: (r: RunSummary) => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!runId || !active) return;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await api<{ busy?: boolean; waiting?: boolean; failed?: string; run: RunSummary }>(`/admin/import/runs/${runId}/step`, { method: 'POST' });
        if (!alive.current) return;
        onUpdate?.(r.run);
        void qc.invalidateQueries({ queryKey: ['import', 'run', runId] });
        if (['na_fila', 'em_andamento'].includes(r.run.status)) timer = window.setTimeout(tick, r.waiting || r.busy ? 2500 : 150);
        else void qc.invalidateQueries({ queryKey: ['import'] });
      } catch (e) { if (alive.current) setError((e as Error).message); }
    };
    void tick();
    return () => { alive.current = false; window.clearTimeout(timer); };
  }, [runId, active]); // eslint-disable-line react-hooks/exhaustive-deps
  return error;
}

export const pretty = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
export type { ImportConfig };
