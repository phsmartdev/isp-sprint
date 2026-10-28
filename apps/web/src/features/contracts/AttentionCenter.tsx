/**
 * Central de atenção dos contratos: uma fila só com tudo o que pede ação (notificações, processos atrasados,
 * cadastros sem validação e execução), do mais grave ao menos grave.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Mail } from 'lucide-react';
import { ATTENTION_LEVEL_LABELS, type AttentionLevel } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, ErrorState, FormField, LoadingRows, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Item = {
  key: string; source: 'notificacao' | 'processo' | 'validacao' | 'execucao'; kind: string; kindLabel: string; level: AttentionLevel; score: number;
  title: string; detail: string | null; dueAt: string | null; daysLeft: number | null; valueCents: number;
  contractId: string | null; contractCode: number | null; contractNumber: string | null; clientName: string | null; ownerId: string | null; ownerName: string | null; alertId: string | null; href: string;
};
type Data = { items: Item[]; today: string; summary: { total: number; critica: number; alta: number; media: number; overdue: number; contracts: number; valueAtStakeCents: number; bySource: { key: string; label: string; n: number }[] } };

const LEVEL_STYLE: Record<AttentionLevel, { bar: string; text: string; soft: string }> = {
  critica: { bar: 'bg-danger', text: 'text-danger', soft: 'bg-danger-soft' },
  alta: { bar: 'bg-[#EA7A0C]', text: 'text-[#C2610C]', soft: 'bg-warning-soft' },
  media: { bar: 'bg-[#E0A400]', text: 'text-[#8A6500]', soft: 'bg-[#FEF7DC]' },
};
const when = (d: number | null) => (d === null ? 'Sem prazo' : d < 0 ? `Atrasado ${-d} dia${d === -1 ? '' : 's'}` : d === 0 ? 'Vence hoje' : d === 1 ? 'Vence amanhã' : `Em ${d} dias`);

export function AttentionCenter() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useUrlState({ quem: 'todos', nivel: '', fonte: '' });
  const q = useQuery({ queryKey: ['contracts', 'attention', f.quem], queryFn: () => api<Data>(`/contracts/attention${qs({ mine: f.quem === 'meus' ? '1' : '0' })}`), refetchInterval: 120_000 });
  const [resolving, setResolving] = useState<Item | null>(null);
  const digest = useMutation({
    mutationFn: () => api<{ sent: number; skipped: number }>('/contracts/digest/run', { method: 'POST' }),
    onSuccess: (r) => toast({ tone: 'success', message: r.sent ? `Resumo enviado para ${r.sent} pessoa(s)` : r.skipped ? 'O resumo de hoje já foi enviado' : 'Nenhum resumo enviado: confira o SMTP e o resumo diário em Configurações → Módulos e liberação → Contratos' }),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const items = d.items.filter((x) => (!f.nivel || x.level === f.nivel) && (!f.fonte || x.source === f.fonte));
  const counter = (l: AttentionLevel) => (
    <button type="button" aria-pressed={f.nivel === l} onClick={() => setF({ nivel: f.nivel === l ? '' : l })}
      className={clsx('flex flex-1 items-center gap-3 border p-4 text-left transition-colors', f.nivel === l ? 'border-ink' : 'border-line hover:border-muted', 'bg-surface')}>
      <span className={clsx('h-10 w-1.5 shrink-0', LEVEL_STYLE[l].bar)} aria-hidden />
      <span><span className="num block text-2xl font-extrabold text-ink">{d.summary[l]}</span><span className={clsx('text-sm font-semibold', LEVEL_STYLE[l].text)}>{ATTENTION_LEVEL_LABELS[l]}</span></span>
    </button>
  );
  return (
    <div className="space-y-4">
      <section aria-label="Resumo da central de atenção" className="flex flex-col gap-3 lg:flex-row">
        <div className="flex flex-1 gap-3">{counter('critica')}{counter('alta')}{counter('media')}</div>
        <div className="flex flex-1 flex-col justify-center border border-line bg-surface p-4">
          <p className="text-sm text-muted"><b className="num text-ink">{d.summary.overdue}</b> atrasado(s) em <b className="num text-ink">{d.summary.contracts}</b> contrato(s)</p>
          <p className="text-sm text-muted">Valor anual dos contratos com pendência: <b className="num text-ink">{fmtBRL(d.summary.valueAtStakeCents)}</b></p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="De quem" className="flex border border-line">
          {[['todos', 'Toda a carteira'], ['meus', 'Só o que está comigo']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={f.quem === k} onClick={() => setF({ quem: k })} className={clsx('px-3 py-2 text-sm', f.quem === k ? 'bg-ink font-semibold text-white' : 'text-text hover:bg-surface-2')}>{l}</button>
          ))}
        </div>
        <div role="group" aria-label="Origem" className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={!f.fonte} onClick={() => setF({ fonte: '' })} className={clsx('border px-3 py-2 text-sm', !f.fonte ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-text hover:bg-surface-2')}>Tudo <span className="num">({d.summary.total})</span></button>
          {d.summary.bySource.map((s) => (
            <button key={s.key} type="button" aria-pressed={f.fonte === s.key} onClick={() => setF({ fonte: f.fonte === s.key ? '' : s.key })} className={clsx('border px-3 py-2 text-sm', f.fonte === s.key ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-text hover:bg-surface-2')}>{s.label} <span className="num">({s.n})</span></button>
          ))}
        </div>
        {can('contratos', 'total') && <Button className="ml-auto" size="sm" variant="outline" icon={<Mail className="h-4 w-4" />} loading={digest.isPending} onClick={() => digest.mutate()}>Enviar resumo do dia</Button>}
      </div>

      {!items.length ? (
        <div className="card"><EmptyState icon={<CheckCircle2 className="h-10 w-10" />} title={d.items.length ? 'Nada com esse filtro' : 'Nada pedindo ação agora'} description={d.items.length ? 'Tire o filtro para ver o resto da fila.' : 'Vencimentos, saldos, empenhos e processos estão em dia.'} /></div>
      ) : (
        <ol aria-label="Itens que pedem ação" className="space-y-2">
          {items.map((x) => (
            <li key={x.key} className="card flex overflow-hidden">
              <span className={clsx('w-1.5 shrink-0', LEVEL_STYLE[x.level].bar)} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className={clsx('px-2 py-0.5 font-semibold', LEVEL_STYLE[x.level].soft, LEVEL_STYLE[x.level].text)}>{ATTENTION_LEVEL_LABELS[x.level]}</span>
                    <span className="text-muted">{x.kindLabel}</span>
                    {x.contractNumber && <span className="text-muted">Contrato {x.contractNumber}{x.contractCode ? ` (CT-${x.contractCode})` : ''}</span>}
                  </p>
                  <p className="mt-1 font-semibold text-ink">{x.title}</p>
                  {x.detail && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{x.detail}</p>}
                  <p className="mt-1 text-xs text-muted">Com {x.ownerName ?? 'responsável não definido'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end md:gap-1">
                  <span className={clsx('text-sm font-semibold', (x.daysLeft ?? 0) < 0 ? 'text-danger' : x.daysLeft !== null && x.daysLeft <= 3 ? 'text-[#C2610C]' : 'text-text')}>{when(x.daysLeft)}</span>
                  {x.valueCents > 0 && <span className="num text-xs text-muted">{fmtBRL(x.valueCents)}/ano</span>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {x.alertId && <Button size="sm" variant="outline" onClick={() => setResolving(x)}>Resolver</Button>}
                  <Link to={x.href} className="inline-flex h-9 items-center bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90">Abrir</Link>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {resolving && <ResolveDialog item={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}

function ResolveDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/contracts/alerts/${item.alertId}/resolve`, { method: 'POST', body: { resolution: text.trim() } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['contracts'] }); void qc.invalidateQueries({ queryKey: ['contract'] }); toast({ tone: 'success', message: 'Notificação concluída' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Resolver notificação" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={text.trim().length < 3} onClick={() => m.mutate()}>Concluir notificação</Button></>}>
      <p className="mb-3 text-sm text-text">{item.title}</p>
      <FormField label="Providência tomada" htmlFor="att-res" required hint="Fica no histórico do contrato."><Textarea id="att-res" rows={3} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></FormField>
    </Modal>
  );
}
