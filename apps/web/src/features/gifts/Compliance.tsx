/**
 * Marketing → Brindes → Compliance: uma tela só. Indicadores de governança (só executadas), pendências, concessões filtradas;
 * detalhes, decisão, execução e documentos num painel lateral; diretrizes e prestação de contas em painéis próprios.
 * O sistema identifica e informa; a autoridade competente decide (validação real no servidor).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, FileDown, FileText, Plus, Settings2, ShieldCheck, Upload, X } from 'lucide-react';
import {
  ATTENTION_LABELS, ATTENTION_SITUATIONS, CONCESSION_DECISION_LABELS, CONCESSION_KIND_LABELS, CONCESSION_KINDS, CONCESSION_PURPOSE_LABELS, CONCESSION_PURPOSES, CONCESSION_STATE_LABELS, CONCESSION_STATES,
  CONTROL_TYPE_LABELS, KIT_CATEGORIES, KIT_CATEGORY_LABELS, OUTCOME_LABELS, POWER_CLASS_LABELS, RULE_PARAM_LABELS, RULE_PARAMS, APPROVER_LEVEL_LABELS,
  type AttentionSituation, type ConcessionDecision, type ConcessionKind, type ConcessionPurpose, type ConcessionState, type ControlType, type KitCategory, type Outcome, type RuleParam,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { fileToBase64 } from '../../lib/files';
import { useUrlState } from '../../lib/hooks';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Finding = { ruleKey: string; version: number; name: string; controlType: ControlType; approverLevel: string; message: string; history: string | null };
type Evaluation = { outcome: Outcome; level: string | null; findings: Finding[] };
type Account = { contactId: string; name: string; shareCents: number };
type Row = { id: string; code: string; kind: ConcessionKind; purpose: ConcessionPurpose; description: string; plannedOn: string; executedOn: string | null; state: ConcessionState; outcome: Outcome; exception: boolean; estimatedCents: number; approvedCents: number | null; executedCents: number | null; requesterId: string; requesterName: string; accounts: Account[]; institutionalClass: string | null; complete: boolean };
type Kpis = { realizedCents: number; executed: number; accounts: number; exceptions: number; conformityPct: number | null; exceptionPct: number | null; traceabilityPct: number | null; pendencies: number };
type Data = {
  from: string; to: string; rows: Row[]; kpis: Kpis; pendencies: { requestId: string; code: string; text: string; since: string }[]; totals: { requested: number; approved: number; realized: number };
  options: { units: { id: string; name: string }[]; requesters: { id: string; name: string }[] }; catalog: { items: { id: string; name: string; unitCostCents: number; stock: number }[]; kits: { id: string; name: string; costCents: number; available: number }[] };
  can: { decideLevels: string[]; configure: boolean; report: boolean; seesAll: boolean }; policy: { configured: boolean; rules: number; segregation: boolean; conformingLevel: string; note: string | null };
};

const OUTCOME_TONE: Record<Outcome, string> = { conforme: 'text-[#15803D]', autorizacao: 'text-primary', excecao: 'text-[#C2610C]', impedido: 'text-danger' };
const STATE_TONE: Partial<Record<ConcessionState, string>> = { executado: 'bg-success-soft text-[#15803D]', aprovado: 'bg-primary-soft text-primary', reservado: 'bg-sky-soft text-[#1F7DB8]', ajustes: 'bg-warning-soft text-[#9A4D06]', rejeitado: 'bg-danger-soft text-danger', cancelado: 'bg-surface-2 text-muted' };
const Tag = ({ className, children }: { className?: string; children: React.ReactNode }) => <span className={clsx('inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-semibold', className ?? 'bg-surface-2 text-ink')}>{children}</span>;
const toCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100) || 0;
const money = (c: number | null | undefined) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const accTxt = (r: Pick<Row, 'accounts' | 'institutionalClass'>) => (r.accounts.length ? r.accounts.map((a) => a.name).join(', ') : `Institucional · ${r.institutionalClass ?? ''}`);

function useInvalidate() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['compliance'] }); void qc.invalidateQueries({ queryKey: ['account-gifts'] }); void qc.invalidateQueries({ queryKey: ['brindes'] }); };
}
function useAct<T = unknown>(done: string, after?: (r: T) => void) {
  const inv = useInvalidate();
  const toast = useToast();
  return useMutation({
    mutationFn: (x: { url: string; method?: string; body?: unknown }) => api<T>(x.url, { method: x.method ?? 'POST', body: x.body }),
    onSuccess: (r) => { inv(); toast({ tone: 'success', message: done }); after?.(r); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

export function ComplianceSection() {
  const year = new Date().getFullYear();
  const [f, setF] = useUrlState({ id: '', de: `${year}-01-01`, ate: new Date().toISOString().slice(0, 10), tipo: '', sit: '', conf: '', un: '', resp: '', busca: '' });
  const params = { from: f.de, to: f.ate, kind: f.tipo || undefined, state: f.sit || undefined, outcome: f.conf || undefined, orgUnitId: f.un || undefined, requesterId: f.resp || undefined };
  const q = useQuery({ queryKey: ['compliance', params], queryFn: () => api<Data>(`/brindes/compliance${qs(params)}`) });
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<'' | 'report' | 'rules'>('');
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const term = f.busca.trim().toLowerCase();
  const rows = term ? d.rows.filter((r) => r.code.toLowerCase().includes(term) || accTxt(r).toLowerCase().includes(term) || r.description.toLowerCase().includes(term)) : d.rows;
  const k = d.kpis;
  return (
    <div className="space-y-4">
      <section aria-label="Filtros do compliance" className="flex flex-wrap items-end gap-2 border border-line bg-surface px-4 py-3">
        <FormField label="De" htmlFor="gc-de"><Input id="gc-de" type="date" value={f.de} onChange={(e) => setF({ de: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="gc-ate"><Input id="gc-ate" type="date" value={f.ate} onChange={(e) => setF({ ate: e.target.value })} /></FormField>
        <FormField label="Tipo" htmlFor="gc-tipo"><Select id="gc-tipo" value={f.tipo} onChange={(e) => setF({ tipo: e.target.value })}><option value="">Todos</option>{CONCESSION_KINDS.map((x) => <option key={x} value={x}>{CONCESSION_KIND_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Situação" htmlFor="gc-sit"><Select id="gc-sit" value={f.sit} onChange={(e) => setF({ sit: e.target.value })}><option value="">Todas</option>{CONCESSION_STATES.map((x) => <option key={x} value={x}>{CONCESSION_STATE_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Conformidade" htmlFor="gc-conf"><Select id="gc-conf" value={f.conf} onChange={(e) => setF({ conf: e.target.value })}><option value="">Todas</option>{(['conforme', 'autorizacao', 'excecao', 'impedido'] as Outcome[]).map((x) => <option key={x} value={x}>{OUTCOME_LABELS[x]}</option>)}<option value="excecao_autorizada">Exceções autorizadas</option></Select></FormField>
        {d.options.units.length > 0 && <FormField label="Unidade" htmlFor="gc-un"><Select id="gc-un" value={f.un} onChange={(e) => setF({ un: e.target.value })}><option value="">Todas</option>{d.options.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
        {d.can.seesAll && <FormField label="Responsável" htmlFor="gc-resp"><Select id="gc-resp" value={f.resp} onChange={(e) => setF({ resp: e.target.value })}><option value="">Todos</option>{d.options.requesters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
        <FormField label="Conta ou código" htmlFor="gc-busca"><Input id="gc-busca" value={f.busca} onChange={(e) => setF({ busca: e.target.value })} placeholder="Buscar" /></FormField>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" icon={<Settings2 className="h-4 w-4" />} onClick={() => setPanel('rules')}>Diretrizes</Button>
          {d.can.report && <Button icon={<FileText className="h-4 w-4" />} onClick={() => setPanel('report')}>Prestação de contas</Button>}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova solicitação</Button>
        </div>
      </section>

      {!d.policy.configured && <Notice tone="warning">Nenhuma diretriz vigente: as solicitações ficam "dentro das diretrizes" por falta de regra. {d.can.configure ? 'Abra Diretrizes e carregue a política de brindes.' : 'Peça à administração para cadastrar as diretrizes.'}</Notice>}

      <section aria-label="Indicadores de governança" className="border border-line bg-surface">
        <dl className="grid grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-line">
          {[['Total realizado', fmtBRL(k.realizedCents), 'concessões executadas no período'], ['Concessões realizadas', String(k.executed), `${fmtBRL(d.totals.approved)} aprovados no período`], ['Contas beneficiadas', String(k.accounts), 'contas distintas'], ['Exceções autorizadas', String(k.exceptions), 'aprovação excepcional']].map(([l, v, h]) => (
            <div key={l} className="px-4 py-2.5"><dt className="text-2xs font-semibold text-muted">{l}</dt><dd className="num text-base font-bold text-ink">{v}</dd><p className="text-2xs text-faint">{h}</p></div>
          ))}
        </dl>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line bg-surface-2/50 px-4 py-2 text-xs">
          <div className="flex gap-1.5" title="executadas sem exceção ÷ executadas"><dt className="text-muted">Conformidade</dt><dd className="num font-semibold text-ink">{pct(k.conformityPct)}</dd></div>
          <div className="flex gap-1.5" title="executadas com exceção ÷ executadas"><dt className="text-muted">Exceções</dt><dd className="num font-semibold text-ink">{pct(k.exceptionPct)}</dd></div>
          <div className="flex gap-1.5" title="justificativa + decisão + evidência ÷ executadas"><dt className="text-muted">Rastreabilidade</dt><dd className="num font-semibold text-ink">{pct(k.traceabilityPct)}</dd></div>
          <div className="flex gap-1.5"><dt className="text-muted">Pendências de controle</dt><dd className={clsx('num font-semibold', k.pendencies ? 'text-danger' : 'text-ink')}>{k.pendencies}</dd></div>
          <div className="flex gap-1.5"><dt className="text-muted">Aguardando decisão</dt><dd className="num font-semibold text-ink">{fmtBRL(d.totals.requested)}</dd></div>
        </dl>
      </section>

      {d.pendencies.length > 0 && (
        <section aria-label="Pendências de controle" className="border-l-4 border-danger bg-danger-soft/40 px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-ink"><AlertTriangle className="h-4 w-4 text-danger" aria-hidden />Pendências de controle</p>
          <ul className="space-y-0.5 text-sm">{d.pendencies.slice(0, 6).map((p, n) => <li key={`${p.requestId}-${n}`}><button type="button" className="font-semibold text-ink hover:underline" onClick={() => setF({ id: p.requestId })}>{p.code}</button><span className="text-muted"> · {p.text} · desde {fmtDate(p.since)}</span></li>)}</ul>
        </section>
      )}

      <section aria-label="Concessões" className="card overflow-x-auto p-0">
        {!rows.length ? <EmptyState title="Nenhuma concessão no período" description="Registre a solicitação de brinde, kit, apoio ou patrocínio: o sistema avalia as diretrizes e encaminha a quem decide." /> : (
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5 font-semibold">Concessão</th><th className="px-3 py-2.5 font-semibold">Conta beneficiada</th><th className="px-3 py-2.5 font-semibold">Data</th><th className="px-3 py-2.5 text-right font-semibold">Previsto · aprovado · realizado</th><th className="px-3 py-2.5 font-semibold">Conformidade</th><th className="px-4 py-2.5 font-semibold">Situação</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => setF({ id: r.id })}>
                <td className="px-4 py-2.5"><button type="button" className="text-left font-semibold text-ink hover:text-primary">{r.code} · {r.description}</button><span className="block text-xs text-muted">{CONCESSION_KIND_LABELS[r.kind]} · {r.requesterName}</span></td>
                <td className="px-3 py-2.5 text-text">{accTxt(r)}</td>
                <td className="px-3 py-2.5 text-text">{fmtDate(r.executedOn ?? r.plannedOn)}<span className="block text-xs text-muted">{r.executedOn ? 'executada' : 'prevista'}</span></td>
                <td className="num px-3 py-2.5 text-right">{fmtBRL(r.estimatedCents)}<span className="block text-xs text-muted">{r.approvedCents == null ? '—' : fmtBRL(r.approvedCents)} · {r.executedCents == null ? '—' : fmtBRL(r.executedCents)}</span></td>
                <td className={clsx('px-3 py-2.5 text-xs font-semibold', r.exception ? 'text-[#C2610C]' : OUTCOME_TONE[r.outcome])}>{r.exception ? 'Exceção autorizada' : OUTCOME_LABELS[r.outcome]}{r.state === 'executado' && !r.complete && <span className="block font-normal text-danger">registro incompleto</span>}</td>
                <td className="px-4 py-2.5"><Tag className={STATE_TONE[r.state]}>{CONCESSION_STATE_LABELS[r.state]}</Tag></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Os indicadores contam só concessões executadas no período. Segregação de funções {d.policy.segregation ? 'ativa' : 'desativada'}; {d.policy.rules} diretriz(es) vigente(s){d.policy.note ? ` · ${d.policy.note}` : ''}.</p>

      {creating && <RequestForm catalog={d.catalog} units={d.options.units} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setF({ id }); }} />}
      {f.id && <RequestDrawer id={f.id} catalog={d.catalog} units={d.options.units} onClose={() => setF({ id: '' })} />}
      {panel === 'report' && <ReportDrawer from={f.de} to={f.ate} units={d.options.units} onClose={() => setPanel('')} />}
      {panel === 'rules' && <RulesDrawer catalog={d.catalog} onClose={() => setPanel('')} />}
    </div>
  );
}

// ------------------------------------------------------------------ solicitação (criar e alterar)
type Detail = {
  request: Row & { justification: string; kitId: string | null; kits: number; items: { itemId: string; qty: number }[]; kitCategory: KitCategory | null; collective: boolean; audience: string | null; attention: AttentionSituation[]; recipients: { stakeholderId: string; contactId: string; name: string; title: string | null; powerClass: string }[]; eventName: string | null; orgUnitId: string | null; rowVersion: number; executorName: string | null; cancelReason: string | null };
  accounts: (Account & { nature: string | null; history?: { executed: number; investedCents: number; exceptions: number; inProgress: number; lastOn: string | null } })[];
  evaluation: Evaluation; level: string | null; decisions: { id: string; decision: ConcessionDecision; deciderName: string; level: string; reason: string | null; conditions: string | null; amountCents: number; createdAt: string }[];
  events: { id: string; type: string; text: string; actorName: string | null; createdAt: string }[]; documents: { id: string; kind: string; name: string; at: string }[];
  stock: { itemId: string; name: string; need: number; stock: number; reservedByOthers: number; available: number }[]; budget: { code: string | null; what: string; approved: number; committed: number; paid: number; balance: number } | null;
  can: { decide: ConcessionDecision[]; decideReason: string | null; edit: boolean; reserve: boolean; execute: boolean; cancel: boolean; upload: boolean };
};
type Catalog = Data['catalog'];
type Preview = { evaluation: Evaluation; level: string | null; accounts: (Account & { nature: string | null; history?: Detail['accounts'][number]['history'] })[] };

function RequestForm({ catalog, units, initial, onClose, onSaved }: { catalog: Catalog; units: { id: string; name: string }[]; initial?: Detail; onClose: () => void; onSaved: (id: string) => void }) {
  const r = initial?.request;
  const [v, setV] = useState({
    kind: (r?.kind ?? 'kit') as ConcessionKind, purpose: (r?.purpose ?? 'relacionamento') as ConcessionPurpose, eventName: r?.eventName ?? '', description: r?.description ?? '', justification: r?.justification ?? '',
    plannedOn: r?.plannedOn ?? new Date().toISOString().slice(0, 10), kitId: r?.kitId ?? '', kits: String(r?.kits || 1), items: r?.items ?? [] as { itemId: string; qty: number }[], estimated: money(r?.estimatedCents), manualValue: !!r,
    kitCategory: (r?.kitCategory ?? '') as KitCategory | '', collective: r?.collective ?? false, audience: r?.audience ?? '', attention: r?.attention ?? [] as AttentionSituation[], orgUnitId: r?.orgUnitId ?? '', institutionalClass: r?.institutionalClass ?? '',
  });
  const [accs, setAccs] = useState<{ contactId: string; name: string }[]>(initial?.accounts.map((a) => ({ contactId: a.contactId, name: a.name })) ?? []);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [rateio, setRateio] = useState(false);
  const [people, setPeople] = useState<string[]>(r?.recipients.map((p) => p.stakeholderId) ?? []);
  const [term, setTerm] = useState('');
  const found = useQuery({ queryKey: ['contacts-search', term], enabled: term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string }[] }>(`/contacts?q=${encodeURIComponent(term)}`) });
  const stake = useQuery({ queryKey: ['compliance', 'stakeholders', accs.map((a) => a.contactId).join(',')], enabled: accs.length > 0, queryFn: async () => (await Promise.all(accs.map((a) => api<{ items: { id: string; name: string; title: string | null; powerClass?: string }[] }>(`/accounts/${a.contactId}/stakeholders`).then((x) => x.items.map((p) => ({ ...p, account: a.name })))))).flat() });
  const kit = catalog.kits.find((x) => x.id === v.kitId);
  const autoCents = (kit ? kit.costCents * Number(v.kits || 0) : 0) + v.items.reduce((t, l) => t + l.qty * (catalog.items.find((i) => i.id === l.itemId)?.unitCostCents ?? 0), 0);
  const estimatedCents = v.manualValue ? toCents(v.estimated) : autoCents;
  const usesStock = v.kind !== 'patrocinio_financeiro';
  const body = {
    kind: v.kind, purpose: v.purpose, eventName: v.eventName || null, description: v.description, justification: v.justification, plannedOn: v.plannedOn,
    kitId: usesStock && v.kitId ? v.kitId : null, kits: usesStock && v.kitId ? Number(v.kits || 0) : 0, items: usesStock ? v.items.filter((l) => l.itemId && l.qty > 0) : [], estimatedCents,
    kitCategory: v.kitCategory || null, collective: v.collective, audience: v.audience || null, attention: v.attention, orgUnitId: v.orgUnitId || null, institutionalClass: accs.length ? null : v.institutionalClass || null,
    stakeholderIds: v.collective ? [] : people, accounts: accs.map((a) => ({ contactId: a.contactId, shareCents: rateio ? toCents(shares[a.contactId] ?? '') : null })),
  };
  const key = JSON.stringify(body);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { api<Preview>('/brindes/compliance/avaliar', { method: 'POST', body: { ...body, description: body.description || undefined, justification: body.justification || undefined } }).then((p) => { setPreview(p); setPreviewErr(null); }).catch((e) => setPreviewErr(errMsg(e))); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useAct<{ id: string }>(r ? 'Solicitação alterada' : 'Solicitação registrada', (x) => onSaved(x.id ?? r!.id));
  const ok = v.description.trim().length >= 5 && v.justification.trim().length >= 10 && (accs.length || v.institutionalClass.trim()) && (v.purpose !== 'evento' || v.eventName.trim()) && (!v.collective || v.audience.trim());
  return (
    <Modal open onClose={onClose} size="xl" title={r ? `Alterar ${r.code}` : 'Nova solicitação de concessão'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate(r ? { url: `/brindes/compliance/solicitacoes/${r.id}`, method: 'PATCH', body: { ...body, rowVersion: r.rowVersion } } : { url: '/brindes/compliance/solicitacoes', body })}>{r ? 'Salvar e reavaliar' : 'Enviar para avaliação'}</Button></>}>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          <FormField label="Tipo de concessão" htmlFor="rq-k"><Select id="rq-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ConcessionKind })}>{CONCESSION_KINDS.map((x) => <option key={x} value={x}>{CONCESSION_KIND_LABELS[x]}</option>)}</Select></FormField>
          <FormField label="Finalidade" htmlFor="rq-p"><Select id="rq-p" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value as ConcessionPurpose })}>{CONCESSION_PURPOSES.map((x) => <option key={x} value={x}>{CONCESSION_PURPOSE_LABELS[x]}</option>)}</Select></FormField>
          {v.purpose === 'evento' && <FormField label="Evento" htmlFor="rq-ev" required className="sm:col-span-2"><Input id="rq-ev" value={v.eventName} onChange={(e) => setV({ ...v, eventName: e.target.value })} /></FormField>}
          <FormField label="Descrição" htmlFor="rq-d" required className="sm:col-span-2"><Input id="rq-d" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="O que será concedido" /></FormField>
          <FormField label="Justificativa institucional ou comercial" htmlFor="rq-j" required className="sm:col-span-2"><Textarea id="rq-j" rows={2} value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></FormField>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Contas beneficiadas</legend>
            <div className="flex flex-wrap gap-2">{accs.map((a) => <span key={a.contactId} className="inline-flex items-center gap-1 bg-primary-soft px-2 py-1 text-sm text-primary">{a.name}{rateio && <Input aria-label={`Parte de ${a.name} (R$)`} className="h-7 w-24" value={shares[a.contactId] ?? ''} onChange={(e) => setShares({ ...shares, [a.contactId]: e.target.value })} placeholder="R$" />}<button type="button" aria-label={`Tirar ${a.name}`} onClick={() => { setAccs(accs.filter((x) => x.contactId !== a.contactId)); setPeople([]); }}><X className="h-3.5 w-3.5" /></button></span>)}</div>
            <Input aria-label="Buscar conta" className="mt-2" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar conta pelo nome (mínimo 2 letras)" />
            {term.trim().length >= 2 && <ul className="mt-1 max-h-36 overflow-y-auto border border-line">{(found.data?.items ?? []).filter((c) => !accs.some((a) => a.contactId === c.id)).slice(0, 8).map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => { setAccs([...accs, { contactId: c.id, name: c.name }]); setTerm(''); }}>{c.name}</button></li>)}</ul>}
            {accs.length > 1 && <label className="mt-2 flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={rateio} onChange={(e) => setRateio(e.target.checked)} /> Informar o rateio por conta (sem marcar, divide igual)</label>}
            {!accs.length && <Input aria-label="Classificação da ação institucional" className="mt-2" value={v.institutionalClass} onChange={(e) => setV({ ...v, institutionalClass: e.target.value })} placeholder="Sem conta: classifique a ação institucional (ex.: evento setorial)" />}
          </fieldset>

          {v.kind !== 'patrocinio_financeiro' && (
            <>
              <FormField label="Kit" htmlFor="rq-kit"><Select id="rq-kit" value={v.kitId} onChange={(e) => setV({ ...v, kitId: e.target.value })}><option value="">Sem kit</option>{catalog.kits.map((x) => <option key={x.id} value={x.id}>{x.name} · {fmtBRL(x.costCents)} ({x.available} disponíveis)</option>)}</Select></FormField>
              <FormField label="Quantidade de kits" htmlFor="rq-kn"><Input id="rq-kn" inputMode="numeric" disabled={!v.kitId} value={v.kits} onChange={(e) => setV({ ...v, kits: e.target.value.replace(/\D/g, '') })} /></FormField>
              <div className="sm:col-span-2">
                {v.items.map((l, n) => (
                  <div key={n} className="mb-1 flex gap-2"><Select aria-label="Item avulso" value={l.itemId} onChange={(e) => setV({ ...v, items: v.items.map((x, i) => (i === n ? { ...x, itemId: e.target.value } : x)) })}><option value="">Item</option>{catalog.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {fmtBRL(i.unitCostCents)} ({i.stock} em estoque)</option>)}</Select><Input aria-label="Quantidade do item" className="w-24" inputMode="numeric" value={String(l.qty)} onChange={(e) => setV({ ...v, items: v.items.map((x, i) => (i === n ? { ...x, qty: Number(e.target.value.replace(/\D/g, '') || 0) } : x)) })} /><Button variant="ghost" aria-label="Tirar item" onClick={() => setV({ ...v, items: v.items.filter((_, i) => i !== n) })}><X className="h-4 w-4" /></Button></div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setV({ ...v, items: [...v.items, { itemId: '', qty: 1 }] })}>Item avulso</Button>
              </div>
              <FormField label="Categoria do kit (política)" htmlFor="rq-cat"><Select id="rq-cat" value={v.kitCategory} onChange={(e) => setV({ ...v, kitCategory: e.target.value as KitCategory })}><option value="">Não se aplica</option>{KIT_CATEGORIES.map((c) => <option key={c} value={c}>{KIT_CATEGORY_LABELS[c]}</option>)}</Select></FormField>
            </>
          )}
          <FormField label="Valor estimado (R$)" htmlFor="rq-v" hint={v.manualValue ? 'informado' : 'calculado pelo custo do estoque'}><div className="flex gap-2"><Input id="rq-v" inputMode="decimal" value={v.manualValue ? v.estimated : money(autoCents)} onChange={(e) => setV({ ...v, estimated: e.target.value, manualValue: true })} />{v.manualValue && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, manualValue: false })}>Calcular</Button>}</div></FormField>
          <FormField label="Data prevista" htmlFor="rq-dt"><Input id="rq-dt" type="date" value={v.plannedOn} onChange={(e) => setV({ ...v, plannedOn: e.target.value })} /></FormField>
          {units.length > 0 && <FormField label="Unidade de negócio" htmlFor="rq-un"><Select id="rq-un" value={v.orgUnitId} onChange={(e) => setV({ ...v, orgUnitId: e.target.value })}><option value="">Não informada</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Destinatários</legend>
            <label className="mb-2 flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={v.collective} onChange={(e) => setV({ ...v, collective: e.target.checked })} /> Entrega coletiva (evento, treinamento, visita): controle pelo grupo</label>
            {v.collective ? <Input aria-label="Grupo destinatário" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })} placeholder="Ex.: participantes do treinamento da Secretaria" />
              : !accs.length ? <p className="text-sm text-muted">Escolha a conta para ver os stakeholders.</p>
              : <ul className="max-h-40 overflow-y-auto border border-line">{(stake.data ?? []).map((p) => <li key={p.id}><label className="flex items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={people.includes(p.id)} onChange={(e) => setPeople(e.target.checked ? [...people, p.id] : people.filter((x) => x !== p.id))} /><span className="flex-1">{p.name}{p.title ? ` · ${p.title}` : ''} <span className="text-muted">({p.account})</span></span><span className="text-xs font-semibold text-muted">{POWER_CLASS_LABELS[(p.powerClass ?? 'nao_avaliado') as keyof typeof POWER_CLASS_LABELS]}</span></label></li>)}{stake.data && !stake.data.length && <li className="px-3 py-2 text-sm text-muted">A conta não tem stakeholders mapeados.</li>}</ul>}
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Situações de atenção no período</legend>
            <div className="flex flex-wrap gap-1.5">{ATTENTION_SITUATIONS.map((a) => <button key={a} type="button" aria-pressed={v.attention.includes(a)} onClick={() => setV({ ...v, attention: v.attention.includes(a) ? v.attention.filter((x) => x !== a) : [...v.attention, a] })} className={clsx('border px-2 py-1 text-xs', v.attention.includes(a) ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-text hover:border-line-strong')}>{ATTENTION_LABELS[a]}</button>)}</div>
          </fieldset>
        </div>
        <aside aria-label="Avaliação automática" className="self-start border border-line bg-surface-2/50 p-4 lg:sticky lg:top-0">
          <p className="text-xs font-semibold text-muted">Avaliação automática</p>
          {previewErr ? <p className="mt-2 text-sm text-danger">{previewErr}</p> : !preview ? <p className="mt-2 text-sm text-muted">Avaliando…</p> : <EvaluationView ev={preview.evaluation} level={preview.level} accounts={preview.accounts} />}
          <p className="mt-3 text-2xs text-faint">O sistema identifica e informa; a autoridade competente decide.</p>
        </aside>
      </div>
    </Modal>
  );
}

function EvaluationView({ ev, level, accounts }: { ev: Evaluation; level: string | null; accounts?: Preview['accounts'] }) {
  return (
    <div className="mt-1 space-y-3">
      <p className={clsx('text-base font-bold', OUTCOME_TONE[ev.outcome])}>{OUTCOME_LABELS[ev.outcome]}</p>
      {level && <p className="text-xs text-muted">Decide: <b className="text-ink">{APPROVER_LEVEL_LABELS[level as 'gerencia']}</b></p>}
      {ev.findings.length > 0 && <ul className="space-y-2">{ev.findings.map((f, n) => <li key={n} className={clsx('border-l-2 pl-2 text-xs leading-snug', f.controlType === 'restricao' ? 'border-danger' : f.controlType === 'orientativa' ? 'border-[#D97706]' : 'border-primary')}><span className="block font-semibold text-ink">{f.name} <span className="font-normal text-muted">(v{f.version})</span></span><span className="text-text">{f.message}</span>{f.history && <span className="block text-muted">Histórico: {f.history}</span>}</li>)}</ul>}
      {accounts?.some((a) => a.history) && (
        <div><p className="text-xs font-semibold text-muted">Histórico das contas</p>
          <ul className="mt-1 space-y-1 text-xs">{accounts.map((a) => <li key={a.contactId}><b className="text-ink">{a.name}</b>{a.nature === 'publica' && ' · órgão público'}: {a.history?.executed ?? 0} concessão(ões), {fmtBRL(a.history?.investedCents ?? 0)}{a.history?.lastOn ? `, última em ${fmtDate(a.history.lastOn)}` : ''}{a.history?.exceptions ? ` · ${a.history.exceptions} exceção(ões)` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ painel da solicitação
function RequestDrawer({ id, catalog, units, onClose }: { id: string; catalog: Catalog; units: { id: string; name: string }[]; onClose: () => void }) {
  const q = useQuery({ queryKey: ['compliance', 'req', id], queryFn: () => api<Detail>(`/brindes/compliance/solicitacoes/${id}`) });
  const [editing, setEditing] = useState(false);
  const [dec, setDec] = useState<{ decision: ConcessionDecision | ''; reason: string; conditions: string; approved: string }>({ decision: '', reason: '', conditions: '', approved: '' });
  const [exec, setExec] = useState({ on: new Date().toISOString().slice(0, 10), value: '' });
  const [cancel, setCancel] = useState<string | null>(null);
  const [docKind, setDocKind] = useState('comprovante');
  const act = useAct('Registrado');
  const d = q.data;
  const r = d?.request;
  return (
    <Drawer open onClose={onClose} width="lg" title={r ? `${r.code} · ${r.description}` : 'Concessão'}>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && r && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Tag className={STATE_TONE[r.state]}>{CONCESSION_STATE_LABELS[r.state]}</Tag><span className={clsx('text-xs font-semibold', r.exception ? 'text-[#C2610C]' : OUTCOME_TONE[r.outcome])}>{r.exception ? 'Exceção autorizada' : OUTCOME_LABELS[r.outcome]}</span>{d.can.edit && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>Alterar</Button>}</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[['Tipo', CONCESSION_KIND_LABELS[r.kind]], ['Finalidade', `${CONCESSION_PURPOSE_LABELS[r.purpose]}${r.eventName ? ` · ${r.eventName}` : ''}`], ['Solicitante', r.requesterName], ['Data prevista', fmtDate(r.plannedOn)], ['Previsto', fmtBRL(r.estimatedCents)], ['Aprovado', r.approvedCents == null ? '—' : fmtBRL(r.approvedCents)], ['Realizado', r.executedCents == null ? '—' : `${fmtBRL(r.executedCents)} em ${fmtDate(r.executedOn)}`], ['Execução', r.executorName ?? '—'], ['Categoria do kit', r.kitCategory ? KIT_CATEGORY_LABELS[r.kitCategory] : '—'], ['Unidade', units.find((u) => u.id === r.orgUnitId)?.name ?? '—']].map(([k, val]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{val}</dd></div>)}
          </dl>
          <div><p className="text-xs text-muted">Justificativa</p><p className="text-ink">{r.justification}</p></div>
          <div><p className="mb-1 text-xs font-semibold text-muted">Contas e destinatários</p>
            {d.accounts.length ? <ul className="space-y-1">{d.accounts.map((a) => <li key={a.contactId}><Link className="font-semibold text-ink hover:underline" to={`/customers/${a.contactId}?t=brindes`}>{a.name}</Link> · {fmtBRL(a.shareCents)}{a.history ? <span className="text-xs text-muted"> · {a.history.executed} concessão(ões) antes, {fmtBRL(a.history.investedCents)}</span> : null}</li>)}</ul> : <p className="text-ink">Ação institucional: {r.institutionalClass}</p>}
            {r.collective ? <p className="mt-1 text-text">Entrega coletiva: {r.audience}</p> : r.recipients.length > 0 && <p className="mt-1 text-text">{r.recipients.map((p) => `${p.name}${p.title ? ` (${p.title})` : ''} · ${POWER_CLASS_LABELS[p.powerClass as keyof typeof POWER_CLASS_LABELS] ?? p.powerClass}`).join('; ')}</p>}
            {r.attention.length > 0 && <p className="mt-1 text-xs text-[#9A4D06]">Situações de atenção: {r.attention.map((a) => ATTENTION_LABELS[a]).join(', ')}</p>}
          </div>
          <section className="border border-line p-3"><p className="text-xs font-semibold text-muted">Avaliação das diretrizes</p><EvaluationView ev={d.evaluation} level={d.level} /></section>

          {r.state === 'solicitado' && (
            <section aria-label="Decisão" className="border border-line p-3">
              <p className="mb-2 text-xs font-semibold text-muted">Decisão</p>
              {!d.can.decide.length ? <p className="text-muted">{d.can.decideReason ?? 'Aguardando a alçada competente.'}</p> : (
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-1.5">{d.can.decide.map((x) => <button key={x} type="button" aria-pressed={dec.decision === x} onClick={() => setDec({ ...dec, decision: x })} className={clsx('border px-3 py-1.5 text-sm font-semibold', dec.decision === x ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:border-line-strong')}>{CONCESSION_DECISION_LABELS[x]}</button>)}</div>
                  {dec.decision && <Textarea aria-label="Fundamentação da decisão" rows={2} value={dec.reason} onChange={(e) => setDec({ ...dec, reason: e.target.value })} placeholder={dec.decision === 'aprovar_excecao' ? 'Fundamentação expressa (obrigatória, vale só para esta solicitação)' : 'Fundamentação'} />}
                  {(dec.decision === 'aprovar' || dec.decision === 'aprovar_excecao') && <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="Valor aprovado (R$)" value={dec.approved} onChange={(e) => setDec({ ...dec, approved: e.target.value })} placeholder={`Valor aprovado (até ${fmtBRL(r.estimatedCents)})`} /><Input aria-label="Condições da autorização" value={dec.conditions} onChange={(e) => setDec({ ...dec, conditions: e.target.value })} placeholder="Condições (opcional)" /></div>}
                  {dec.decision && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ url: `/brindes/compliance/solicitacoes/${r.id}/decidir`, body: { decision: dec.decision, reason: dec.reason || null, conditions: dec.conditions || null, approvedCents: dec.approved ? toCents(dec.approved) : null, rowVersion: r.rowVersion } })}>Registrar decisão</Button>}
                </div>
              )}
            </section>
          )}

          {(d.stock.length > 0 || d.budget) && (
            <section className="border border-line p-3">
              {d.stock.length > 0 && <><p className="mb-1 text-xs font-semibold text-muted">Materiais</p><ul className="space-y-0.5">{d.stock.map((x) => <li key={x.itemId} className="flex justify-between gap-2"><span>{x.need}× {x.name}</span><span className={clsx('text-xs', x.available < x.need ? 'font-semibold text-danger' : 'text-muted')}>{x.stock} em estoque · {x.reservedByOthers} reservado(s) por outras</span></li>)}</ul></>}
              {d.budget && <p className="mt-2 text-xs text-muted">Orçamento {d.budget.code ?? ''} {d.budget.what}: aprovado {fmtBRL(d.budget.approved)}, comprometido {fmtBRL(d.budget.committed)}, pago {fmtBRL(d.budget.paid)}, saldo {fmtBRL(d.budget.balance)}.</p>}
            </section>
          )}

          {(d.can.reserve || d.can.execute) && (
            <section aria-label="Execução" className="border border-line p-3">
              <p className="mb-2 text-xs font-semibold text-muted">Execução (a baixa do estoque acontece só aqui, uma vez)</p>
              <div className="flex flex-wrap items-end gap-2">
                {d.can.reserve && r.state === 'aprovado' && <Button loading={act.isPending} onClick={() => act.mutate({ url: `/brindes/compliance/solicitacoes/${r.id}/reservar` })}>Reservar materiais</Button>}
                <FormField label="Executada em" htmlFor="ex-on"><Input id="ex-on" type="date" value={exec.on} onChange={(e) => setExec({ ...exec, on: e.target.value })} /></FormField>
                <FormField label="Valor realizado (R$)" htmlFor="ex-v"><Input id="ex-v" inputMode="decimal" value={exec.value} onChange={(e) => setExec({ ...exec, value: e.target.value })} placeholder={money(r.approvedCents ?? r.estimatedCents)} /></FormField>
                <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ url: `/brindes/compliance/solicitacoes/${r.id}/executar`, body: { executedOn: exec.on, executedCents: exec.value ? toCents(exec.value) : null } })}>Confirmar execução</Button>
              </div>
            </section>
          )}

          <section aria-label="Documentos" className="border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-muted">Documentos e evidências</p>
            {d.documents.length ? <ul className="space-y-0.5">{d.documents.map((x) => <li key={x.id}><a className="text-primary hover:underline" href={`/api/v1/brindes/compliance/documentos/${x.id}`}>{x.kind}: {x.name}</a> <span className="text-xs text-muted">{fmtDateTime(x.at)}</span></li>)}</ul> : <p className="text-muted">Nenhum documento. Executada sem comprovante vira pendência de controle.</p>}
            {d.can.upload && <div className="mt-2 flex flex-wrap items-center gap-2"><Select aria-label="Tipo do documento" className="h-9 w-auto" value={docKind} onChange={(e) => setDocKind(e.target.value)}>{[['comprovante', 'Comprovante'], ['entrega', 'Registro de entrega'], ['evidencia', 'Evidência'], ['autorizacao', 'Autorização'], ['outro', 'Outro']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary"><Upload className="h-4 w-4" aria-hidden />Anexar<input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) act.mutate({ url: `/brindes/compliance/solicitacoes/${r.id}/documentos`, body: { kind: docKind, name: fl.name, mime: fl.type, data: await fileToBase64(fl) } }); e.target.value = ''; }} /></label></div>}
          </section>

          {d.decisions.length > 0 && <section><p className="mb-1 text-xs font-semibold text-muted">Decisões</p><ul className="space-y-1">{d.decisions.map((x) => <li key={x.id} className="text-text"><b className="text-ink">{CONCESSION_DECISION_LABELS[x.decision]}</b> por {x.deciderName} ({APPROVER_LEVEL_LABELS[x.level as 'gerencia']}) em {fmtDateTime(x.createdAt)} · {fmtBRL(x.amountCents)}{x.reason ? ` · ${x.reason}` : ''}{x.conditions ? ` · condições: ${x.conditions}` : ''}</li>)}</ul></section>}
          <section><p className="mb-1 text-xs font-semibold text-muted">Histórico</p><ol className="space-y-1 border-l border-line pl-3">{d.events.map((e) => <li key={e.id} className="text-text"><span className="text-xs text-muted">{fmtDateTime(e.createdAt)} · {e.actorName ?? 'sistema'}</span><br />{e.text}</li>)}</ol></section>
          {d.can.cancel && (cancel === null ? <Button variant="ghost" onClick={() => setCancel('')}>{r.state === 'executado' ? 'Estornar concessão' : 'Cancelar concessão'}</Button> : <div className="flex gap-2"><Input aria-label="Motivo do cancelamento" value={cancel} onChange={(e) => setCancel(e.target.value)} placeholder="Motivo (fica no histórico)" /><Button variant="danger" disabled={cancel.trim().length < 5} loading={act.isPending} onClick={() => act.mutate({ url: `/brindes/compliance/solicitacoes/${r.id}/cancelar`, body: { reason: cancel } })}>Confirmar</Button></div>)}
        </div>
      )}
      {editing && d && <RequestForm catalog={catalog} units={units} initial={d} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </Drawer>
  );
}

// ------------------------------------------------------------------ prestação de contas
function ReportDrawer({ from, to, units, onClose }: { from: string; to: string; units: { id: string; name: string }[]; onClose: () => void }) {
  const q = useQuery({ queryKey: ['compliance', 'reports'], queryFn: () => api<{ items: { id: string; code: string; version: number; periodFrom: string; periodTo: string; createdAt: string; createdByName: string; records: number; letterhead: boolean; analysis: string | null }[]; branches: { id: string; name: string; letterhead: boolean }[] }>('/brindes/compliance/prestacoes') });
  const [v, setV] = useState({ from, to, orgUnitId: '', kinds: [] as ConcessionKind[], detailed: true, justifications: true, exceptions: true, evidences: false, analysis: '', conclusion: '', branchId: '' });
  const gen = useAct<{ id: string; code: string; version: number }>('Prestação de contas emitida', (r) => { window.location.href = `/api/v1/brindes/compliance/prestacoes/${r.id}/pdf`; });
  const branches = q.data?.branches ?? [];
  useEffect(() => { if (!v.branchId && branches.length) setV((x) => ({ ...x, branchId: branches.find((b) => b.letterhead)?.id ?? '' })); }, [branches, v.branchId]);
  const chk = (k: 'detailed' | 'justifications' | 'exceptions' | 'evidences', l: string) => <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{l}</label>;
  return (
    <Drawer open onClose={onClose} width="lg" title="Prestação de Contas"
      footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" icon={<FileDown className="h-4 w-4" />} loading={gen.isPending} onClick={() => gen.mutate({ url: '/brindes/compliance/prestacoes', body: { ...v, orgUnitId: v.orgUnitId || null, branchId: v.branchId || null, analysis: v.analysis || null, conclusion: v.conclusion || null } })}>Gerar PDF</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Relatório institucional da Gestão Comercial para a reunião do CIEI, montado com os registros do sistema. O PDF emitido fica guardado com versão: mudanças posteriores nos registros não alteram o documento apresentado.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="De" htmlFor="pc-de"><Input id="pc-de" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></FormField>
          <FormField label="Até" htmlFor="pc-ate"><Input id="pc-ate" type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></FormField>
          {units.length > 0 && <FormField label="Unidade de negócio" htmlFor="pc-un"><Select id="pc-un" value={v.orgUnitId} onChange={(e) => setV({ ...v, orgUnitId: e.target.value })}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
          <FormField label="Timbrado (filial)" htmlFor="pc-br"><Select id="pc-br" value={v.branchId} onChange={(e) => setV({ ...v, branchId: e.target.value })}><option value="">Sem timbrado</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.letterhead ? '' : ' (sem timbrado cadastrado)'}</option>)}</Select></FormField>
        </div>
        {!branches.some((b) => b.letterhead) && <Notice tone="warning">Nenhuma filial tem o timbrado oficial cadastrado. O PDF sai com cabeçalho padrão e informa isso. Cadastre em Configuração → Filiais.</Notice>}
        <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Categorias incluídas</legend><div className="flex flex-wrap gap-1.5">{CONCESSION_KINDS.map((k) => <button key={k} type="button" aria-pressed={v.kinds.includes(k)} onClick={() => setV({ ...v, kinds: v.kinds.includes(k) ? v.kinds.filter((x) => x !== k) : [...v.kinds, k] })} className={clsx('border px-2 py-1 text-xs', v.kinds.includes(k) ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-text')}>{CONCESSION_KIND_LABELS[k]}</button>)}</div><p className="mt-1 text-xs text-muted">Nenhuma marcada = todas.</p></fieldset>
        <div className="grid gap-1 sm:grid-cols-2">{chk('detailed', 'Demonstrativo detalhado')}{chk('justifications', 'Justificativas')}{chk('exceptions', 'Exceções e autorizações')}{chk('evidences', 'Lista de evidências')}</div>
        <FormField label="Análise executiva da gestão" htmlFor="pc-an"><Textarea id="pc-an" rows={3} value={v.analysis} onChange={(e) => setV({ ...v, analysis: e.target.value })} placeholder="Comportamento das concessões no período" /></FormField>
        <FormField label="Conclusão da Gestão Comercial" htmlFor="pc-co"><Textarea id="pc-co" rows={3} value={v.conclusion} onChange={(e) => setV({ ...v, conclusion: e.target.value })} placeholder="Efetividade dos controles, ocorrências, melhorias e pontos de atenção" /></FormField>
        <section><p className="mb-1 text-xs font-semibold text-muted">Relatórios emitidos</p>
          {!q.data?.items.length ? <p className="text-sm text-muted">Nenhuma prestação de contas emitida.</p> : <ul className="divide-y divide-line border border-line text-sm">{q.data.items.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2"><span><b className="text-ink">{x.code} v{x.version}</b> · {fmtDate(x.periodFrom)} a {fmtDate(x.periodTo)}<span className="block text-xs text-muted">{fmtDateTime(x.createdAt)} por {x.createdByName} · {x.records} registro(s){x.letterhead ? '' : ' · sem timbrado'}</span></span><a className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={`/api/v1/brindes/compliance/prestacoes/${x.id}/pdf`}><FileDown className="h-4 w-4" aria-hidden />PDF</a></li>)}</ul>}
        </section>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ diretrizes
type RuleRow = { id: string; ruleKey: string; version: number; name: string; description: string | null; param: RuleParam; controlType: ControlType; approverLevel: string; limitValue: number | null; windowDays: number | null; kinds: string[]; natures: string[]; kitCategories: string[]; validFrom: string; validTo: string | null; active: boolean; changeNote: string | null; createdByName: string | null; createdAt: string };
const MONEY_PARAMS: RuleParam[] = ['valor_por_kit', 'valor_por_concessao', 'valor_acumulado_conta', 'valor_periodo'];
const LIMIT_PARAMS: RuleParam[] = [...MONEY_PARAMS, 'quantidade_itens', 'frequencia_conta'];
const WINDOW: RuleParam[] = ['valor_acumulado_conta', 'valor_periodo', 'frequencia_conta'];
const EVENTS: Record<string, string> = { aguardando: 'Aguardando autorização', fora_parametros: 'Fora dos parâmetros', aprovada: 'Aprovação concedida', rejeitada: 'Rejeitada', ajustes: 'Ajustes solicitados', pendencia_documental: 'Pendência documental', executada: 'Execução concluída' };

function RulesDrawer({ catalog, onClose }: { catalog: Catalog; onClose: () => void }) {
  const q = useQuery({ queryKey: ['compliance', 'rules'], queryFn: () => api<{ rules: RuleRow[]; settings: { segregation: boolean; conformingLevel: string; channels: Record<string, { email?: boolean; whatsapp?: boolean }>; policyNote: string | null }; canConfigure: boolean }>('/brindes/compliance/diretrizes') });
  const [edit, setEdit] = useState<Partial<RuleRow> | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const load = useAct<{ created: number; skipped: number; frequency: string }>('Diretrizes da política carregadas');
  const saveSet = useAct('Ajustes salvos');
  const latest = useMemo(() => { const m = new Map<string, RuleRow>(); for (const r of q.data?.rules ?? []) if (!m.has(r.ruleKey) || m.get(r.ruleKey)!.version < r.version) m.set(r.ruleKey, r); return [...m.values()]; }, [q.data]);
  const st = q.data?.settings;
  const [set, setSet] = useState<typeof st | null>(null);
  useEffect(() => { if (st && !set) setSet(st); }, [st, set]);
  const can = !!q.data?.canConfigure;
  const val = (r: RuleRow) => (r.limitValue == null ? '' : MONEY_PARAMS.includes(r.param) ? fmtBRL(r.limitValue) : `${r.limitValue}`) + (r.windowDays ? ` em ${r.windowDays} dias` : '');
  return (
    <Drawer open onClose={onClose} width="lg" title="Diretrizes de compliance">
      {q.isLoading ? <LoadingRows /> : (
        <div className="space-y-5 text-sm">
          {can && <div className="flex flex-wrap gap-2"><Button icon={<ShieldCheck className="h-4 w-4" />} loading={load.isPending} onClick={() => load.mutate({ url: '/brindes/compliance/diretrizes/politica' })}>Carregar diretrizes da política</Button><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ param: 'valor_por_concessao', controlType: 'orientativa', approverLevel: 'gerencia', validFrom: new Date().toISOString().slice(0, 10), active: true, kinds: [], natures: [], kitCategories: [] })}>Nova diretriz</Button></div>}
          {load.data && <Notice>{load.data.created} diretriz(es) criada(s), {load.data.skipped} já existia(m). {load.data.frequency}</Notice>}
          {!latest.length ? <EmptyState title="Nenhuma diretriz cadastrada" description={can ? 'Carregue as diretrizes da política de brindes ou cadastre uma a uma.' : 'A administração cadastra as diretrizes.'} /> : (
            <ul className="divide-y divide-line border border-line">{latest.map((r) => (
              <li key={r.ruleKey} className={clsx('px-3 py-2.5', !r.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2"><span><b className="text-ink">{r.name}</b> <span className="text-xs text-muted">v{r.version}{!r.active ? ' · inativa' : ''}</span><span className="block text-xs text-muted">{RULE_PARAM_LABELS[r.param]}{val(r) ? `: ${val(r)}` : ''} · {CONTROL_TYPE_LABELS[r.controlType]} · {APPROVER_LEVEL_LABELS[r.approverLevel as 'gerencia']}{r.kitCategories.length ? ` · categoria ${r.kitCategories.join(', ')}` : ''}{r.natures.length ? ` · ${r.natures.join(', ')}` : ''} · desde {fmtDate(r.validFrom)}</span></span>
                  <span className="flex shrink-0 gap-1">{r.version > 1 && <Button size="sm" variant="ghost" onClick={() => setHist(hist === r.ruleKey ? null : r.ruleKey)}>Versões</Button>}{can && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Nova versão</Button>}</span></div>
                {r.description && <p className="mt-1 text-xs text-text">{r.description}</p>}
                {hist === r.ruleKey && <ol className="mt-2 space-y-0.5 border-l border-line pl-3 text-xs text-muted">{(q.data?.rules ?? []).filter((x) => x.ruleKey === r.ruleKey).map((x) => <li key={x.id}>v{x.version} · {fmtDateTime(x.createdAt)} · {x.createdByName ?? '—'} · {val(x) || '—'} · {x.changeNote}</li>)}</ol>}
              </li>
            ))}</ul>
          )}
          {set && (
            <section aria-label="Ajustes do compliance" className="space-y-3 border border-line p-3">
              <p className="text-xs font-semibold text-muted">Ajustes</p>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={!can} checked={set.segregation} onChange={(e) => setSet({ ...set, segregation: e.target.checked })} />Segregação de funções: quem solicita não decide a própria solicitação</label>
              <FormField label="Quem aprova as concessões dentro das diretrizes" htmlFor="gs-lv"><Select id="gs-lv" disabled={!can} value={set.conformingLevel} onChange={(e) => setSet({ ...set, conformingLevel: e.target.value })}><option value="gerencia">Gestão comercial</option><option value="diretoria">Diretoria</option></Select></FormField>
              <FormField label="Referência da política" htmlFor="gs-pn"><Input id="gs-pn" disabled={!can} value={set.policyNote ?? ''} onChange={(e) => setSet({ ...set, policyNote: e.target.value })} /></FormField>
              <div><p className="mb-1 text-sm font-semibold text-ink">Avisos por canal</p><p className="mb-2 text-xs text-muted">O aviso interno (sino) é sempre enviado. GLPI e IXC não têm destino de aviso para pessoas: não recebem estes avisos. O CIEI não recebe avisos automáticos.</p>
                <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Evento</th><th className="py-1 font-medium">E-mail</th><th className="py-1 font-medium">WhatsApp</th></tr></thead>
                  <tbody>{Object.entries(EVENTS).map(([k, l]) => <tr key={k} className="border-t border-line"><td className="py-1.5">{l}</td>{(['email', 'whatsapp'] as const).map((ch) => <td key={ch}><input type="checkbox" aria-label={`${l} por ${ch}`} disabled={!can} checked={!!set.channels[k]?.[ch]} onChange={(e) => setSet({ ...set, channels: { ...set.channels, [k]: { ...set.channels[k], [ch]: e.target.checked } } })} /></td>)}</tr>)}</tbody></table>
              </div>
              {can && <Button variant="primary" loading={saveSet.isPending} onClick={() => saveSet.mutate({ url: '/brindes/compliance/ajustes', method: 'PUT', body: { segregation: set.segregation, conformingLevel: set.conformingLevel, channels: set.channels, policyNote: set.policyNote || null } })}>Salvar ajustes</Button>}
            </section>
          )}
        </div>
      )}
      {edit && <RuleModal r={edit} catalog={catalog} onClose={() => setEdit(null)} />}
    </Drawer>
  );
}

function RuleModal({ r, catalog, onClose }: { r: Partial<RuleRow> & { allowedKitIds?: string[] }; catalog: Catalog; onClose: () => void }) {
  const [v, setV] = useState({ name: r.name ?? '', description: r.description ?? '', param: (r.param ?? 'valor_por_concessao') as RuleParam, controlType: (r.controlType ?? 'orientativa') as ControlType, approverLevel: r.approverLevel ?? 'gerencia', limit: r.limitValue == null ? '' : MONEY_PARAMS.includes(r.param!) ? money(r.limitValue) : String(r.limitValue), windowDays: r.windowDays ? String(r.windowDays) : '', kinds: (r.kinds ?? []) as ConcessionKind[], natures: r.natures ?? [], kitCategories: (r.kitCategories ?? []) as KitCategory[], allowedKitIds: r.allowedKitIds ?? [], validFrom: r.validFrom ?? new Date().toISOString().slice(0, 10), validTo: r.validTo ?? '', active: r.active ?? true, changeNote: '' });
  const save = useAct('Diretriz salva', onClose);
  const limit = LIMIT_PARAMS.includes(v.param) ? (MONEY_PARAMS.includes(v.param) ? toCents(v.limit) : Number(v.limit || 0)) : null;
  const toggle = <T extends string>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  return (
    <Modal open onClose={onClose} size="lg" title={r.ruleKey ? `Nova versão: ${r.name}` : 'Nova diretriz'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 3 || v.changeNote.trim().length < 5} loading={save.isPending} onClick={() => save.mutate({ url: '/brindes/compliance/diretrizes', body: { ruleKey: r.ruleKey, name: v.name, description: v.description || null, param: v.param, controlType: v.controlType, approverLevel: v.approverLevel, limitValue: limit, windowDays: WINDOW.includes(v.param) ? Number(v.windowDays || 0) || null : null, kinds: v.kinds, natures: v.natures, kitCategories: v.kitCategories, allowedKitIds: v.allowedKitIds, validFrom: v.validFrom, validTo: v.validTo || null, active: v.active, changeNote: v.changeNote } })}>Salvar versão</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="ru-n" required className="sm:col-span-2"><Input id="ru-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
        <FormField label="Descrição" htmlFor="ru-d" className="sm:col-span-2"><Textarea id="ru-d" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></FormField>
        <FormField label="Parâmetro" htmlFor="ru-p"><Select id="ru-p" value={v.param} onChange={(e) => setV({ ...v, param: e.target.value as RuleParam })}>{RULE_PARAMS.map((p) => <option key={p} value={p}>{RULE_PARAM_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Tipo de controle" htmlFor="ru-c"><Select id="ru-c" value={v.controlType} onChange={(e) => setV({ ...v, controlType: e.target.value as ControlType })}>{(['orientativa', 'autorizacao', 'restricao'] as ControlType[]).map((c) => <option key={c} value={c}>{CONTROL_TYPE_LABELS[c]}</option>)}</Select></FormField>
        {LIMIT_PARAMS.includes(v.param) && <FormField label={MONEY_PARAMS.includes(v.param) ? 'Limite (R$)' : 'Limite'} htmlFor="ru-l" required><Input id="ru-l" inputMode="decimal" value={v.limit} onChange={(e) => setV({ ...v, limit: e.target.value })} /></FormField>}
        {WINDOW.includes(v.param) && <FormField label="Período (dias)" htmlFor="ru-w" required><Input id="ru-w" inputMode="numeric" value={v.windowDays} onChange={(e) => setV({ ...v, windowDays: e.target.value.replace(/\D/g, '') })} /></FormField>}
        {v.param === 'composicao_kit' && <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold">Kits permitidos</legend><div className="flex flex-wrap gap-1.5">{catalog.kits.map((k) => <button key={k.id} type="button" aria-pressed={v.allowedKitIds.includes(k.id)} onClick={() => setV({ ...v, allowedKitIds: toggle(v.allowedKitIds, k.id) })} className={clsx('border px-2 py-1 text-xs', v.allowedKitIds.includes(k.id) ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{k.name}</button>)}</div></fieldset>}
        <FormField label="Alçada" htmlFor="ru-a"><Select id="ru-a" value={v.approverLevel} onChange={(e) => setV({ ...v, approverLevel: e.target.value })}><option value="gerencia">Gestão comercial</option><option value="diretoria">Diretoria</option></Select></FormField>
        <FormField label="Vigência a partir de" htmlFor="ru-vf"><Input id="ru-vf" type="date" value={v.validFrom} onChange={(e) => setV({ ...v, validFrom: e.target.value })} /></FormField>
        <FormField label="Vigência até (opcional)" htmlFor="ru-vt"><Input id="ru-vt" type="date" value={v.validTo} onChange={(e) => setV({ ...v, validTo: e.target.value })} /></FormField>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold">Escopo (vazio = vale para todos)</legend>
          <div className="flex flex-wrap gap-1.5">
            {CONCESSION_KINDS.map((k) => <button key={k} type="button" aria-pressed={v.kinds.includes(k)} onClick={() => setV({ ...v, kinds: toggle(v.kinds, k) })} className={clsx('border px-2 py-1 text-xs', v.kinds.includes(k) ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{CONCESSION_KIND_LABELS[k]}</button>)}
            {(['publica', 'privada'] as const).map((n) => <button key={n} type="button" aria-pressed={v.natures.includes(n)} onClick={() => setV({ ...v, natures: toggle(v.natures, n) })} className={clsx('border px-2 py-1 text-xs', v.natures.includes(n) ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{n === 'publica' ? 'Cliente público' : 'Cliente privado'}</button>)}
            {KIT_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={v.kitCategories.includes(c)} onClick={() => setV({ ...v, kitCategories: toggle(v.kitCategories, c) })} className={clsx('border px-2 py-1 text-xs', v.kitCategories.includes(c) ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>Categoria {c}</button>)}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Ativa</label>
        <FormField label="Motivo da alteração" htmlFor="ru-cn" required className="sm:col-span-2"><Input id="ru-cn" value={v.changeNote} onChange={(e) => setV({ ...v, changeNote: e.target.value })} placeholder="Fica no histórico de versões" /></FormField>
      </div>
    </Modal>
  );
}
