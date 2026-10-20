/**
 * Comentários e histórico da negociação: comentários formais (com @), alterações de campos com antes → depois,
 * etapas, atividades, aprovações e envios. Tudo append-only: nada aqui é editado ou apagado.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { MessageSquareText } from 'lucide-react';
import { ACTIVITY_TYPE_LABELS, LOSS_REASON_LABELS, STAGE_LABELS, type ActivityType, type LossReason, type OpportunityStage } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL, fmtDateTime } from '../lib/format';
import type { TimelineItem } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Button, ErrorState, LoadingRows } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';
import { MentionInput, WithMentions, mentionsIn, type Participant } from './MentionInput';

const FIELD_LABELS: Record<string, string> = {
  title: 'Título', ownerId: 'Responsável', sourceId: 'Origem', campaignId: 'Campanha', channel: 'Canal', reasons: 'Motivos', planId: 'Plano', valueCents: 'Valor mensal', nextAction: 'Próxima ação', nextActionAt: 'Data da próxima ação', notes: 'Anotações',
  pipelineId: 'Jornada', stage: 'Etapa', saleType: 'Tipo de venda', cableMeters: 'Metragem de cabo', activationFeeCents: 'Taxa de ativação', equipment: 'Equipamentos', routeId: 'Caminho de entrega', condominiumId: 'Condomínio',
  installCep: 'CEP', installStreet: 'Logradouro', installNumber: 'Número', installDistrict: 'Bairro', installCity: 'Cidade', installBlock: 'Bloco', installUnit: 'Apartamento', custom: 'Campos da jornada',
  engineeringStatus: 'Viabilidade da engenharia', engineeringTicket: 'Chamado da engenharia', executiveTicket: 'Projeto executivo', measurementContractId: 'Contrato por medição', measurementCents: 'Consumo da medição',
};
const MONEY = new Set(['valueCents', 'activationFeeCents', 'measurementCents']);
const NO_VALUES = new Set(['notes', 'custom', 'equipment']);
const LEGACY: Record<string, string> = { novo: 'Novo', descoberta: 'Descoberta', oferta: 'Oferta', negociacao: 'Negociação', retorno: 'Retorno' };
const st = (v?: string | null) => (v ? STAGE_LABELS[v as OpportunityStage] ?? LEGACY[v] ?? v : '—');

type Change = { from?: unknown; to?: unknown };
type Category = 'comentarios' | 'alteracoes' | 'etapas' | 'atividades' | 'aprovacoes' | 'envios' | 'outros';
const FILTERS: { key: Category | 'tudo'; label: string }[] = [
  { key: 'tudo', label: 'Tudo' }, { key: 'comentarios', label: 'Comentários' }, { key: 'alteracoes', label: 'Alterações' }, { key: 'etapas', label: 'Etapas' },
  { key: 'atividades', label: 'Atividades' }, { key: 'aprovacoes', label: 'Aprovações' }, { key: 'envios', label: 'Envios e anexos' },
];
function category(i: TimelineItem): Category {
  if (i.kind === 'activity') return 'atividades';
  if (i.type === 'comment') return 'comentarios';
  if (i.type === 'updated' || i.type === 'assigned') return 'alteracoes';
  if (i.type === 'stage_changed' || i.type === 'reopened') return 'etapas';
  if (i.type.startsWith('approval_')) return 'aprovacoes';
  if (['whatsapp_sent', 'email_sent', 'attachment_added', 'attachment_removed'].includes(i.type)) return 'envios';
  return 'outros';
}

function fmtValue(key: string, v: unknown, labels: Record<string, string>) {
  if (v === null || v === undefined || v === '') return 'vazio';
  if (MONEY.has(key) && typeof v === 'number') return fmtBRL(v);
  if (key === 'nextActionAt' && typeof v === 'string') return fmtDateTime(v);
  if (key === 'cableMeters') return `${String(v)} m`;
  if (key === 'stage') return st(String(v));
  if (key === 'saleType') return v === 'ativa' ? 'Ativa' : v === 'receptiva' ? 'Receptiva' : String(v);
  if (typeof v === 'string' && labels[v]) return labels[v]!;
  if (typeof v === 'string' && v.startsWith('[')) { try { return (JSON.parse(v) as unknown[]).join(', ') || 'vazio'; } catch { /* texto */ } }
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) return 'registro removido';
  return String(v);
}

function describe(i: TimelineItem): string {
  if (i.kind === 'activity') {
    const t = i.activityType ? ACTIVITY_TYPE_LABELS[i.activityType as ActivityType] ?? 'Atividade' : 'Atividade';
    const verb = { created: 'agendada', completed: 'concluída', reopened: 'reaberta', rescheduled: 'reagendada', assigned: 'reatribuída', updated: 'editada' }[i.type] ?? i.type;
    return `${t} ${verb}: ${i.title}`;
  }
  switch (i.type) {
    case 'created': return 'Oportunidade criada';
    case 'stage_changed': {
      const loss = i.payload?.lossReason as LossReason | undefined;
      return `Etapa: ${st(i.fromValue)} → ${st(i.toValue)}${loss ? ` (motivo: ${LOSS_REASON_LABELS[loss]})` : ''}`;
    }
    case 'reopened': return `Reaberta: ${st(i.fromValue)} → ${st(i.toValue)}`;
    case 'assigned': return 'Responsável alterado';
    case 'updated': return 'Alterou a negociação';
    case 'attachment_added': return `Anexo adicionado${i.payload?.filename ? `: ${String(i.payload.filename)}` : ''}`;
    case 'attachment_removed': return `Anexo removido${i.payload?.filename ? `: ${String(i.payload.filename)}` : ''}`;
    case 'medicao_vinculada': return i.payload?.contractId ? 'Consumo de contrato por medição vinculado' : 'Consumo de contrato por medição removido';
    case 'sucesso_cliente_decisao': return i.payload?.acionar ? 'Cliente da base: Sucesso do Cliente acionado' : 'Cliente da base: Sucesso do Cliente não acionado';
    case 'contrato_cadastrado': return `Contrato ${String(i.payload?.number ?? '')} cadastrado`;
    case 'contrato_validado': return `Contrato ${String(i.payload?.number ?? '')} validado`;
    case 'erp_solicitado': return 'Cadastro no ERP solicitado (tarefa criada)';
    case 'erp_atualizado': return `ERP atualizado${i.payload?.ref ? `: ${String(i.payload.ref)}` : ''}`;
    case 'provisionamento_solicitado': return 'Provisionamento do faturamento solicitado ao Financeiro';
    case 'implantacao_notificada': return 'Time de implantação e entrega notificado';
    case 'sucesso_cliente': return 'Negociação passou para Sucesso do Cliente';
    case 'contrato_encerrado': return 'Contrato encerrado e arquivado';
    case 'whatsapp_sent': return `Enviado por WhatsApp${i.payload?.filename ? `: ${String(i.payload.filename)}` : ''}${i.payload?.to ? ` para ${String(i.payload.to)}` : ''}`;
    case 'email_sent': return `E-mail enviado${i.payload?.subject ? `: ${String(i.payload.subject)}` : ''}`;
    case 'automation_ran': return `Automação executada${i.payload?.automation ? `: ${String(i.payload.automation)}` : ''}`;
    case 'duplicated_from': return 'Criada a partir de outra oportunidade (histórico copiado)';
    case 'duplicated_to': return 'Copiada para outro funil';
    case 'port_released': return 'Porta da CTO liberada';
    case 'approval_requested': return `Aprovação solicitada (${i.toValue ?? ''})`;
    case 'approval_decided': return `Decisão de aprovação ${i.fromValue ?? ''}: ${i.toValue ?? ''}`;
    default: return i.type.replace(/_/g, ' ');
  }
}

/** Junta alterações seguidas da mesma pessoa em até 15 min (o autosave grava campo a campo). */
type Entry = TimelineItem & { changes?: Record<string, Change>; count?: number };
function group(items: TimelineItem[]): Entry[] {
  const out: Entry[] = [];
  for (const i of items) {
    const prev = out[out.length - 1];
    const ch = (i.payload?.changed ?? null) as Record<string, Change> | null;
    if (i.type === 'updated' && ch && prev?.type === 'updated' && prev.actorName === i.actorName && Math.abs(Date.parse(prev.occurredAt) - Date.parse(i.occurredAt)) < 15 * 60_000) {
      // itens vêm do mais novo para o mais antigo: o "de" fica com o mais antigo
      for (const [k, v] of Object.entries(ch)) prev.changes![k] = { from: v.from, to: prev.changes![k]?.to ?? v.to };
      prev.count = (prev.count ?? 1) + 1;
      continue;
    }
    out.push({ ...i, changes: ch ? { ...ch } : undefined });
  }
  return out;
}

export function Timeline({ opportunityId }: { opportunityId: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Category | 'tudo'>('tudo');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Participant[]>([]);
  const q = useQuery({ queryKey: ['timeline', opportunityId], queryFn: () => api<{ items: TimelineItem[]; labels: Record<string, string> }>(`/opportunities/${opportunityId}/timeline`), refetchInterval: 30_000 });
  const read = useMutation({ mutationFn: () => api(`/opportunities/${opportunityId}/read`, { method: 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['unread', opportunityId] }); qc.invalidateQueries({ queryKey: ['mentions'] }); } });
  const comments = q.data?.items.filter((i) => i.type === 'comment').length ?? 0;
  const marked = useRef(-1);
  useEffect(() => { if (q.data && marked.current !== comments) { marked.current = comments; read.mutate(); } }, [q.data, comments, read]);
  const post = useMutation({
    mutationFn: () => api(`/opportunities/${opportunityId}/comments`, { method: 'POST', body: { body: text.trim(), mentions: mentionsIn(text, picked) } }),
    onSuccess: () => { setText(''); setPicked([]); setFilter('tudo'); qc.invalidateQueries({ queryKey: ['timeline', opportunityId] }); toast({ tone: 'success', message: 'Comentário registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const labels = q.data?.labels ?? {};
  const entries = useMemo(() => group((q.data?.items ?? []).filter((i) => filter === 'tudo' || category(i) === filter)), [q.data, filter]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const i of q.data?.items ?? []) c[category(i)] = (c[category(i)] ?? 0) + 1; return c; }, [q.data]);

  return (
    <div>
      <form className="mb-4 rounded-md border border-line bg-surface-2/60 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(); }}>
        <MentionInput oppId={opportunityId} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} label="Comentário" placeholder="Registre um comentário na negociação… use @ para mencionar" rows={3} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-muted">Fica no histórico formal e não pode ser editado nem apagado. Para conversar com o time, use o Chat.</p>
          <Button type="submit" variant="primary" size="sm" loading={post.isPending} disabled={!text.trim()} icon={<MessageSquareText className="h-4 w-4" />}>Comentar</Button>
        </div>
      </form>

      <div role="group" aria-label="Filtrar histórico" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f.key === 'tudo' ? q.data?.items.length ?? 0 : counts[f.key] ?? 0;
          return (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold transition-colors', filter === f.key ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-text hover:border-line-strong')}>
              {f.label} <span className="num opacity-75">{n}</span>
            </button>
          );
        })}
      </div>

      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : entries.length === 0 ? <p className="text-sm text-muted">Nada aqui ainda.</p> : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {entries.map((i) => i.type === 'comment' ? (
            <li key={`${i.kind}-${i.id}`} className="relative">
              <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border-2 border-surface bg-[#F5B400]" aria-hidden />
              <div className={clsx('rounded-md border p-3', ((i.payload?.mentionNames as string[] | undefined) ?? []).includes(me?.user.name ?? '') ? 'border-[#F5B400] bg-[#FFF9E6]' : 'border-line bg-surface')}>
                <p className="flex items-center gap-2 text-xs text-muted"><Avatar name={i.actorName ?? '?'} size={22} /><span className="font-semibold text-ink">{i.actorName ?? 'Sistema'}</span> comentou · <time dateTime={i.occurredAt}>{fmtDateTime(i.occurredAt)}</time></p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink"><WithMentions text={i.reason ?? ''} names={(i.payload?.mentionNames as string[] | undefined) ?? []} mine={me?.user.name} /></p>
              </div>
            </li>
          ) : (
            <li key={`${i.kind}-${i.id}`} className="relative">
              <span className={clsx('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', i.kind === 'activity' ? 'bg-sky' : i.toValue === 'ganha' ? 'bg-success' : i.toValue === 'perdida' ? 'bg-danger' : category(i) === 'alteracoes' ? 'bg-faint' : 'bg-primary')} aria-hidden />
              <p className="text-sm text-ink">{describe(i)}{i.count && i.count > 1 ? <span className="text-xs text-muted"> ({i.count} salvamentos)</span> : null}</p>
              {i.changes && Object.keys(i.changes).length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {Object.entries(i.changes).map(([k, v]) => (
                    <li key={k} className="text-text">
                      <span className="font-medium">{FIELD_LABELS[k] ?? k}</span>
                      {NO_VALUES.has(k) ? <span className="text-muted"> editado</span> : <>: <span className="text-muted line-through decoration-faint">{fmtValue(k, v.from, labels)}</span> → <span className="font-semibold text-ink">{fmtValue(k, v.to, labels)}</span></>}
                    </li>
                  ))}
                </ul>
              )}
              {i.reason && <p className="text-sm text-muted">“{i.reason}”</p>}
              <p className="text-xs text-muted"><time dateTime={i.occurredAt}>{fmtDateTime(i.occurredAt)}</time> · {i.actorName ?? 'Sistema'}{i.sourceSystem !== 'crm' ? ` · fonte ${i.sourceSystem}` : ''}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
