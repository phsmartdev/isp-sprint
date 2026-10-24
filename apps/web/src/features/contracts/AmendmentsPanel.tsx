/**
 * Termos aditivos: quanto do limite legal de acréscimo e supressão já foi usado (sobre o valor inicial)
 * e o registro de cada aditivo, que gera nova versão do contrato.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { AMENDMENT_KINDS, AMENDMENT_LABELS, type AmendmentKind } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { MoneyInput } from '../DealFields';
import { errMsg, todayIso, type ContractDetail } from './shared';

type Amendment = { id: string; number: string; kind: AmendmentKind; label: string; signedOn: string; valueDeltaCents: number; monthlyDeltaCents: number; newEndAt: string | null; reforma: boolean; acordo: boolean; description: string; version: number };
type Use = { cents: number; share: number | null; remainingCents: number };
type Data = { items: Amendment[]; limits: { baseCents: number; limitPct: number; capCents: number; acrescimo: Use; supressao: Use }; legalLimit: boolean; canManage: boolean };

const pctTxt = (x: number | null) => (x === null ? '—' : `${(Math.round(x * 1000) / 10).toLocaleString('pt-BR')}%`);

function LimitBar({ label, use, limit }: { label: string; use: Use; limit: number }) {
  const ratio = use.share === null ? 0 : use.share / limit;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="num text-muted">{pctTxt(use.share)} de {Math.round(limit * 100)}% · restam {fmtBRL(use.remainingCents)}</span>
      </div>
      <div className="mt-1 h-2 bg-surface-2" role="meter" aria-label={`${label}: uso do limite`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div className={clsx('h-2', ratio >= 0.9 ? 'bg-danger' : ratio >= 0.7 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
      </div>
    </div>
  );
}

export function AmendmentsPanel({ c }: { c: ContractDetail }) {
  const q = useQuery({ queryKey: ['contract-amendments', c.id], queryFn: () => api<Data>(`/contracts/${c.id}/amendments`) });
  const [open, setOpen] = useState(false);
  if (q.isLoading || !q.data) return <LoadingRows rows={4} />;
  const d = q.data;
  const writable = d.canManage && c.stage !== 'arquivado' && c.stage !== 'cadastro_validacao';
  return (
    <section aria-label="Termos aditivos" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-md font-bold text-ink">Termos aditivos</h3>
          <p className="text-sm text-muted">Valor inicial do contrato: <b className="num text-ink">{fmtBRL(d.limits.baseCents)}</b>. Cada aditivo gera uma nova versão.</p>
        </div>
        {writable && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Registrar aditivo</Button>}
      </div>
      <div className="grid grid-cols-1 gap-4 border border-line p-4 md:grid-cols-2">
        <LimitBar label="Acréscimos" use={d.limits.acrescimo} limit={d.limits.limitPct} />
        <LimitBar label="Supressões" use={d.limits.supressao} limit={0.25} />
        <p className="text-xs text-muted md:col-span-2">{d.legalLimit
          ? `Contrato público: o sistema bloqueia acréscimo acima de ${Math.round(d.limits.limitPct * 100)}% do valor inicial${d.limits.limitPct === 0.5 ? ' (reforma)' : ' (50% em reforma de edifício ou equipamento)'} e supressão acima de 25% sem acordo entre as partes.`
          : 'Contrato privado: os percentuais servem de referência, sem bloqueio.'}</p>
      </div>
      {!d.items.length ? <EmptyState title="Nenhum aditivo registrado" description="Acréscimos, supressões, prorrogações e reequilíbrios entram aqui e atualizam o contrato." /> : (
        <ol className="space-y-2">
          {[...d.items].reverse().map((a) => (
            <li key={a.id} className="border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">Aditivo {a.number} · {a.label}</span>
                <span className="num text-xs text-muted">{fmtDate(a.signedOn)} · versão {a.version}</span>
              </div>
              <p className="mt-1 text-sm text-text">{a.description}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                {a.valueDeltaCents !== 0 && <span className={clsx('num', a.valueDeltaCents < 0 ? 'text-danger' : 'text-[#15803D]')}>Valor {a.valueDeltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(a.valueDeltaCents))}{d.limits.baseCents ? ` (${pctTxt(Math.abs(a.valueDeltaCents) / d.limits.baseCents)})` : ''}</span>}
                {a.monthlyDeltaCents !== 0 && <span className="num">Mensal {a.monthlyDeltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(a.monthlyDeltaCents))}</span>}
                {a.newEndAt && <span>Novo término {fmtDate(a.newEndAt)}</span>}
                {a.reforma && <span>Reforma (limite de 50%)</span>}
                {a.acordo && <span>Por acordo entre as partes</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
      {open && <AmendmentDialog c={c} d={d} onClose={() => setOpen(false)} />}
      <YearValues c={c} />
    </section>
  );
}

function AmendmentDialog({ c, d, onClose }: { c: ContractDetail; d: Data; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState(String(d.items.length + 1));
  const [kind, setKind] = useState<AmendmentKind>('acrescimo');
  const [signedOn, setSignedOn] = useState(todayIso());
  const [value, setValue] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [newEndAt, setNewEndAt] = useState('');
  const [reforma, setReforma] = useState(false);
  const [acordo, setAcordo] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cents = (v: number | null) => (v === null ? 0 : Math.round(v * 100));
  const money = kind === 'acrescimo' || kind === 'supressao' || kind === 'reequilibrio';
  const remaining = kind === 'acrescimo' ? (reforma ? Math.max(0, Math.round(d.limits.baseCents * 0.5) - d.limits.acrescimo.cents) : d.limits.acrescimo.remainingCents) : kind === 'supressao' ? d.limits.supressao.remainingCents : null;
  const over = d.legalLimit && remaining !== null && cents(value) > remaining && !(kind === 'supressao' && acordo);
  const save = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/amendments`, { method: 'POST', body: { number: number.trim(), kind, signedOn, valueDeltaCents: money ? cents(value) : 0, monthlyDeltaCents: money ? cents(monthly) : 0, newEndAt: newEndAt || null, reforma: kind === 'acrescimo' && reforma, acordo: kind === 'supressao' && acordo, description: description.trim() } }),
    onSuccess: () => { for (const k of ['contract-amendments', 'contract', 'contracts', 'contract-ledger', 'contract-consumption']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: `Aditivo ${number} registrado` }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  const ready = number.trim() && description.trim().length >= 5 && (!money || kind === 'reequilibrio' || cents(value) > 0) && (kind !== 'prazo' || newEndAt) && !over;
  return (
    <Modal open onClose={onClose} title="Registrar termo aditivo" size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>Registrar aditivo</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Número do aditivo" htmlFor="am-number" required><Input id="am-number" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} /></FormField>
          <FormField label="Tipo" htmlFor="am-kind" required><Select id="am-kind" value={kind} onChange={(e) => setKind(e.target.value as AmendmentKind)}>{AMENDMENT_KINDS.map((k) => <option key={k} value={k}>{AMENDMENT_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Assinado em" htmlFor="am-signed" required><Input id="am-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} /></FormField>
        </div>
        {money && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={kind === 'supressao' ? 'Valor suprimido' : 'Valor acrescido'} htmlFor="am-value" required={kind !== 'reequilibrio'} hint={remaining !== null ? `Disponível no limite: ${fmtBRL(remaining)}` : undefined}><MoneyInput id="am-value" value={value} onChange={setValue} /></FormField>
            <FormField label="Diferença no valor mensal" htmlFor="am-monthly" hint="Deixe vazio se a mensalidade não muda"><MoneyInput id="am-monthly" value={monthly} onChange={setMonthly} /></FormField>
          </div>
        )}
        {over && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">Acima do limite legal: restam {fmtBRL(remaining ?? 0)} para {kind === 'acrescimo' ? 'acréscimo' : 'supressão'}.</p>}
        {kind === 'acrescimo' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={reforma} onChange={(e) => setReforma(e.target.checked)} />Reforma de edifício ou equipamento (limite de 50%)</label>}
        {kind === 'supressao' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={acordo} onChange={(e) => setAcordo(e.target.checked)} />Supressão por acordo entre as partes (pode passar de 25%)</label>}
        <FormField label="Novo término" htmlFor="am-end" required={kind === 'prazo'} hint={c.current.endAt ? `Término atual: ${fmtDate(c.current.endAt)}` : undefined}><Input id="am-end" type="date" value={newEndAt} onChange={(e) => setNewEndAt(e.target.value)} /></FormField>
        <FormField label="Objeto do aditivo" htmlFor="am-desc" required><Textarea id="am-desc" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: inclusão de 2 pontos de acesso na unidade Centro" /></FormField>
      </div>
    </Modal>
  );
}

type YearValue = { id: string; year: number; monthlyCents: number; onlyAdjustment: boolean; note: string | null; createdAt: string; supersededAt: string | null; by: string | null };
/** Quanto o contrato valia por mês em cada ano: o Booking compara um ano com o outro sem contar o reajuste como crescimento. */
function YearValues({ c }: { c: ContractDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contract-year-values', c.id], queryFn: () => api<{ items: YearValue[]; canManage: boolean }>(`/contracts/${c.id}/year-values`) });
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear - 1));
  const [value, setValue] = useState<number | null>(null);
  const [only, setOnly] = useState(true);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/year-values`, { method: 'POST', body: { year: Number(year), monthlyCents: Math.round((value ?? 0) * 100), onlyAdjustment: only, note: note.trim() || null } }),
    onSuccess: () => { for (const k of ['contract-year-values', 'kpis', 'contract']) void qc.invalidateQueries({ queryKey: [k] }); setValue(null); setNote(''); toast({ tone: 'success', message: `Valor de ${year} salvo` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  return (
    <section className="border-t border-line pt-5" aria-label="Valor por ano">
      <h3 className="text-md font-bold text-ink">Valor do contrato por ano</h3>
      <p className="text-sm text-muted">Para o Booking comparar um ano com o outro sem contar o reajuste como crescimento. Use quando o contrato foi cadastrado já com o valor reajustado: informe quanto ele valia por mês no ano anterior.</p>
      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line border border-line text-sm">
          {items.map((y) => (
            <li key={y.id} className={clsx('flex flex-wrap items-baseline justify-between gap-2 px-3 py-2', y.supersededAt && 'text-faint line-through')}>
              <span><b className="text-ink">{y.year}</b> · <span className="num">{fmtBRL(y.monthlyCents)}/mês</span>{y.onlyAdjustment ? <span className="text-muted"> · diferença é reajuste</span> : <span className="text-muted"> · diferença é crescimento</span>}{y.note ? <span className="text-muted"> · {y.note}</span> : null}</span>
              <span className="text-xs text-muted">{y.by ?? '—'} · {fmtDate(y.createdAt)}{y.supersededAt ? ' · substituído' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {q.data?.canManage && (
        <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[110px_200px_1fr_auto]">
          <FormField label="Ano" htmlFor="yv-year"><Select id="yv-year" value={year} onChange={(e) => setYear(e.target.value)}>{[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => <option key={y} value={y}>{y}</option>)}</Select></FormField>
          <FormField label="Valor mensal naquele ano" htmlFor="yv-value"><MoneyInput id="yv-value" value={value} onChange={setValue} /></FormField>
          <FormField label="Observação" htmlFor="yv-note"><Input id="yv-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: antes do reajuste IPCA de março" /></FormField>
          <Button variant="primary" loading={save.isPending} disabled={!value} onClick={() => save.mutate()}>Salvar valor</Button>
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" className="h-4 w-4 accent-primary" checked={only} onChange={(e) => setOnly(e.target.checked)} />A diferença para o valor atual é só reajuste (não é crescimento)</label>
        </div>
      )}
    </section>
  );
}
