/**
 * Termos aditivos: quanto do limite legal de acréscimo e supressão já foi usado (sobre o valor inicial)
 * e o registro de cada aditivo, que gera nova versão do contrato.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { AMENDMENT_KINDS, AMENDMENT_LABELS, CONTRACT_ITEM_KINDS, CONTRACT_ITEM_KIND_LABELS, contractValuesFromItems, itemKindOf, toCents, type AmendmentKind, type ContractItemKind } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { MoneyInput } from '../DealFields';
import { errMsg, todayIso, type ContractDetail } from './shared';

type Amendment = { id: string; number: string; kind: AmendmentKind; label: string; signedOn: string; valueDeltaCents: number; monthlyDeltaCents: number; newEndAt: string | null; reforma: boolean; acordo: boolean; description: string; version: number; groupId: string | null; adjustmentPct: number | null };
/** Linhas do mesmo aditivo (várias finalidades) juntas. */
const groups = (list: Amendment[]) => { const m = new Map<string, Amendment[]>(); for (const a of list) { const k = a.groupId ?? a.id; m.set(k, [...(m.get(k) ?? []), a]); } return [...m.entries()].map(([key, rows]) => ({ key, rows })); };
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
      {!d.items.length ? <EmptyState title="Nenhum aditivo registrado" description="Acréscimos, supressões, prorrogações, reajustes e mudanças de itens entram aqui e geram uma nova versão do contrato." /> : (
        <ol className="space-y-2">
          {groups(d.items).reverse().map((g) => (
            <li key={g.key} className="border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">Aditivo {g.rows[0]!.number} · {g.rows.map((a) => a.label).join(' + ')}</span>
                <span className="num text-xs text-muted">{fmtDate(g.rows[0]!.signedOn)} · versão {g.rows[0]!.version}</span>
              </div>
              <p className="mt-1 text-sm text-text">{g.rows[0]!.description}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                {g.rows.map((a) => (
                  <span key={a.id} className="contents">
                    {a.valueDeltaCents !== 0 && <span className={clsx('num', a.valueDeltaCents < 0 ? 'text-danger' : 'text-[#15803D]')}>{AMENDMENT_LABELS[a.kind]}: valor {a.valueDeltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(a.valueDeltaCents))}{d.limits.baseCents ? ` (${pctTxt(Math.abs(a.valueDeltaCents) / d.limits.baseCents)})` : ''}</span>}
                    {a.monthlyDeltaCents !== 0 && <span className="num">{AMENDMENT_LABELS[a.kind]}: mensal {a.monthlyDeltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(a.monthlyDeltaCents))}</span>}
                    {a.adjustmentPct != null && <span className="num">Reajuste {a.adjustmentPct.toLocaleString('pt-BR')}%</span>}
                    {a.newEndAt && <span>Novo término {fmtDate(a.newEndAt)}</span>}
                    {a.kind === 'itens' && <span>Itens atualizados</span>}
                    {a.reforma && <span>Reforma (limite de 50%)</span>}
                    {a.acordo && <span>Por acordo entre as partes</span>}
                  </span>
                ))}
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

type ItemDraft = { description: string; qty: string; unit: string; kind: ContractItemKind };
const PURPOSE_HINT: Partial<Record<AmendmentKind, string>> = {
  acrescimo: 'Aumenta valor ou quantidade (conta no limite legal).', supressao: 'Reduz valor ou quantidade (conta no limite legal).', prazo: 'Estende a vigência.',
  reajuste: 'Aplica o percentual aos itens e ao valor mensal.', reequilibrio: 'Recompõe o equilíbrio econômico-financeiro.', itens: 'Inclui, retira ou muda os itens do contrato.', outro: 'Outra alteração (só registro).',
};

function AmendmentDialog({ c, d, onClose }: { c: ContractDetail; d: Data; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState(String(new Set(d.items.map((x) => x.groupId ?? x.id)).size + 1));
  const [kinds, setKinds] = useState<AmendmentKind[]>([]);
  const [signedOn, setSignedOn] = useState(todayIso());
  const [vals, setVals] = useState<Record<'acrescimo' | 'supressao' | 'reequilibrio', { value: number | null; monthly: number | null }>>({ acrescimo: { value: null, monthly: null }, supressao: { value: null, monthly: null }, reequilibrio: { value: null, monthly: null } });
  const [pct, setPct] = useState('');
  const [newEndAt, setNewEndAt] = useState('');
  const [reforma, setReforma] = useState(false);
  const [acordo, setAcordo] = useState(false);
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<ItemDraft[]>(() => c.current.items.map((i) => ({ description: i.description, qty: String(i.qty), unit: (i.unitCents / 100).toFixed(2).replace('.', ','), kind: itemKindOf(i) })));
  const [error, setError] = useState<string | null>(null);
  const has = (k: AmendmentKind) => kinds.includes(k);
  const toggle = (k: AmendmentKind) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const cents = (v: number | null) => (v === null ? 0 : Math.round(v * 100));
  const remainingAdd = reforma ? Math.max(0, Math.round(d.limits.baseCents * 0.5) - d.limits.acrescimo.cents) : d.limits.acrescimo.remainingCents;
  const overAdd = d.legalLimit && has('acrescimo') && cents(vals.acrescimo.value) > remainingAdd;
  const overSup = d.legalLimit && has('supressao') && !acordo && cents(vals.supressao.value) > d.limits.supressao.remainingCents;
  const parsedItems = items.filter((i) => i.description.trim()).map((i) => ({ planId: null, description: i.description.trim(), qty: Math.max(1, Number(i.qty) || 1), unitCents: toCents(i.unit) ?? 0, kind: i.kind }));
  const newMonthly = contractValuesFromItems(parsedItems, null).monthlyCents;
  const pctNum = pct.trim() ? Number(pct.replace(',', '.')) : NaN;
  const save = useMutation({
    mutationFn: () => {
      const purposes: Record<string, unknown> = {};
      for (const k of ['acrescimo', 'supressao', 'reequilibrio'] as const) if (has(k)) purposes[k] = { valueCents: cents(vals[k].value), monthlyCents: cents(vals[k].monthly) };
      if (has('prazo')) purposes.prazo = { newEndAt };
      if (has('reajuste')) purposes.reajuste = { pct: pctNum };
      if (has('itens')) purposes.itens = true;
      if (has('outro')) purposes.outro = true;
      return api(`/contracts/${c.id}/amendments`, { method: 'POST', body: { number: number.trim(), signedOn, description: description.trim(), reforma: has('acrescimo') && reforma, acordo: has('supressao') && acordo, purposes, ...(has('itens') ? { items: parsedItems } : {}) } });
    },
    onSuccess: () => { for (const k of ['contract-amendments', 'contract', 'contracts', 'contract-ledger', 'contract-consumption']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: `Aditivo ${number} registrado: nova versão do contrato` }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  const ready = number.trim() && description.trim().length >= 5 && kinds.length > 0 && !overAdd && !overSup
    && (!has('acrescimo') || cents(vals.acrescimo.value) > 0) && (!has('supressao') || cents(vals.supressao.value) > 0)
    && (!has('prazo') || !!newEndAt) && (!has('reajuste') || Number.isFinite(pctNum)) && (!has('itens') || parsedItems.length > 0);
  const setItem = (i: number, p: Partial<ItemDraft>) => setItems((x) => x.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Modal open onClose={onClose} title="Registrar termo aditivo" size="xl" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => { setError(null); save.mutate(); }}>Registrar aditivo</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Número do aditivo" htmlFor="am-number" required><Input id="am-number" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} /></FormField>
          <FormField label="Assinado em" htmlFor="am-signed" required><Input id="am-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} /></FormField>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Finalidades (marque todas que o aditivo tem)</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{AMENDMENT_KINDS.map((k) => (
            <label key={k} className={clsx('flex cursor-pointer items-start gap-2 rounded-sm border px-3 py-2 text-sm', has(k) ? 'border-primary bg-primary-soft' : 'border-line')}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={has(k)} onChange={() => toggle(k)} />
              <span><span className="block font-semibold text-ink">{AMENDMENT_LABELS[k]}</span><span className="text-xs text-muted">{PURPOSE_HINT[k]}</span></span>
            </label>
          ))}</div>
        </fieldset>
        {(['acrescimo', 'supressao', 'reequilibrio'] as const).filter(has).map((k) => (
          <div key={k} className="rounded-md border border-line p-3">
            <p className="mb-2 text-sm font-semibold text-ink">{AMENDMENT_LABELS[k]}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={k === 'supressao' ? 'Valor suprimido' : k === 'acrescimo' ? 'Valor acrescido' : 'Valor do reequilíbrio'} htmlFor={`am-v-${k}`} required={k !== 'reequilibrio'} hint={k === 'acrescimo' ? `Disponível no limite: ${fmtBRL(remainingAdd)}` : k === 'supressao' ? `Disponível no limite: ${fmtBRL(d.limits.supressao.remainingCents)}` : undefined}><MoneyInput id={`am-v-${k}`} value={vals[k].value} onChange={(v) => setVals((x) => ({ ...x, [k]: { ...x[k], value: v } }))} /></FormField>
              <FormField label="Diferença no valor mensal" htmlFor={`am-m-${k}`} hint={has('itens') ? 'Com "Alteração dos itens", o mensal sai dos itens' : 'Deixe vazio se a mensalidade não muda'}><MoneyInput id={`am-m-${k}`} value={vals[k].monthly} onChange={(v) => setVals((x) => ({ ...x, [k]: { ...x[k], monthly: v } }))} /></FormField>
            </div>
            {k === 'acrescimo' && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={reforma} onChange={(e) => setReforma(e.target.checked)} />Reforma de edifício ou equipamento (limite de 50%)</label>}
            {k === 'supressao' && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={acordo} onChange={(e) => setAcordo(e.target.checked)} />Supressão por acordo entre as partes (pode passar de 25%)</label>}
          </div>
        ))}
        {(overAdd || overSup) && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">Acima do limite legal de {overAdd ? 'acréscimo' : 'supressão'}.</p>}
        {(has('prazo') || has('reajuste')) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {has('prazo') && <FormField label="Novo término" htmlFor="am-end" required hint={c.current.endAt ? `Término atual: ${fmtDate(c.current.endAt)}` : undefined}><Input id="am-end" type="date" value={newEndAt} onChange={(e) => setNewEndAt(e.target.value)} /></FormField>}
            {has('reajuste') && <FormField label="Reajuste (%)" htmlFor="am-pct" required hint="Aplicado aos itens e ao valor mensal. Ex.: 4,5"><Input id="am-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></FormField>}
          </div>
        )}
        {has('itens') && (
          <div className="rounded-md border border-line p-3">
            <p className="mb-1 text-sm font-semibold text-ink">Itens do contrato depois do aditivo</p>
            <p className="mb-2 text-xs text-muted">Edite, inclua ou retire. O contrato passa a valer com esta lista (nova versão); a anterior fica no histórico.{has('reajuste') ? ' O reajuste é aplicado sobre estes valores.' : ''}</p>
            <ul className="space-y-2">{items.map((r, i) => (
              <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_70px_120px_130px_auto] sm:items-end">
                <FormField label="Descrição" htmlFor={`am-id-${i}`}><Input id={`am-id-${i}`} value={r.description} onChange={(e) => setItem(i, { description: e.target.value })} /></FormField>
                <FormField label="Qtd." htmlFor={`am-iq-${i}`}><Input id={`am-iq-${i}`} inputMode="numeric" value={r.qty} onChange={(e) => setItem(i, { qty: e.target.value.replace(/\D/g, '') })} /></FormField>
                <FormField label="Valor unitário" htmlFor={`am-iu-${i}`}><Input id={`am-iu-${i}`} inputMode="decimal" value={r.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></FormField>
                <FormField label="Classificação" htmlFor={`am-ik-${i}`}><Select id={`am-ik-${i}`} value={r.kind} onChange={(e) => setItem(i, { kind: e.target.value as ContractItemKind })}>{CONTRACT_ITEM_KINDS.map((k) => <option key={k} value={k}>{CONTRACT_ITEM_KIND_LABELS[k]}</option>)}</Select></FormField>
                <Button variant="ghost" aria-label={`Retirar ${r.description || 'item'}`} icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => setItems((x) => x.filter((_, j) => j !== i))} />
              </li>
            ))}</ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setItems((x) => [...x, { description: '', qty: '1', unit: '', kind: 'recorrente' }])}>Incluir item</Button>
              <p className="text-sm text-muted">Recorrente: <b className="num text-ink">{fmtBRL(newMonthly)}</b>/mês (atual {fmtBRL(c.current.monthlyCents)})</p>
            </div>
          </div>
        )}
        <FormField label="Objeto do aditivo" htmlFor="am-desc" required><Textarea id="am-desc" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: prorrogação por 12 meses com reajuste IPCA e supressão de 1 ponto" /></FormField>
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
