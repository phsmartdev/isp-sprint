/** Aba "Atas de registro de preços" dentro de Gestão de Contratos: painel, lista, nova ata, regras legais e relatórios. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Scale, Search } from 'lucide-react';
import { ARP_REGIMES, ARP_REGIME_LABELS, ARP_STATUSES, ARP_STATUS_LABELS, LEGAL_CAPS, type ArpRegime, type ArpRules } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, fmtPct } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { ArpReports } from './Reports';
import { ArpStatusChip, Table, errMsg, type ArpListRow } from './shared';
import { FitText } from '../../components/ui/FitText';

type Dash = {
  atas: { total: number; vigentes: number; emCadastro: number };
  values: { registered: number; reserved: number; contracted: number; executed: number; available: number; adhesionValue: number };
  openOpportunities: { count: number; valueCents: number };
  adhesions: Record<string, number>;
  conversions: number;
  monthly: { month: string; valueCents: number }[];
  byAgency: { name: string; kind: string; contracted: number }[];
  limits: { ata: string; item: string; usedPct: number }[];
  note: string;
};

/** Painel das atas. Com período, o consumo mensal e por órgão considera só as formalizações do intervalo. */
export function ArpDashboard({ compact, from, to }: { compact?: boolean; from?: string; to?: string }) {
  const q = useQuery({ queryKey: ['arps', 'dashboard', from, to], queryFn: () => api<Dash>(`/arps/dashboard${qs({ from, to })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={3} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const max = Math.max(1, ...d.monthly.map((m) => m.valueCents));
  const stats: [string, string, string?][] = [
    ['Valor registrado', fmtBRL(d.values.registered), `${d.atas.vigentes} vigente(s) de ${d.atas.total} ata(s)`],
    ['Contratado', fmtBRL(d.values.contracted), d.values.registered ? `${fmtPct(d.values.contracted / d.values.registered)} do registrado` : undefined],
    ['Reservado em oportunidades', fmtBRL(d.values.reserved), `${d.openOpportunities.count} oportunidade(s) aberta(s)`],
    ['Saldo disponível', fmtBRL(d.values.available), 'potencial remanescente'],
    ['Adesões autorizadas', fmtBRL(d.values.adhesionValue), `${d.adhesions.solicitada ?? 0} pedido(s) em análise`],
  ];
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {stats.map(([l, v, s]) => <li key={l} className="card p-4"><p className="text-sm text-muted">{l}</p><FitText className="num mt-1 text-2xl font-bold text-ink">{v}</FitText>{s && <p className="mt-0.5 text-xs text-muted">{s}</p>}</li>)}
      </ul>
      {!compact && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="card p-5 xl:col-span-2" aria-labelledby="arp-month">
            <h3 id="arp-month" className="mb-3 font-bold text-ink">Consumo formalizado por mês</h3>
            {!d.monthly.length ? <p className="text-sm text-muted">Nenhuma contratação formalizada ainda.</p> : (
              <ul className="space-y-2">
                {d.monthly.map((m) => (
                  <li key={m.month} className="grid grid-cols-[72px_minmax(0,1fr)_120px] items-center gap-3 text-sm">
                    <span className="num text-muted">{m.month.split('-').reverse().join('/')}</span>
                    <span className="h-3 rounded-full bg-surface-2"><span className="block h-3 rounded-full bg-primary" style={{ width: `${(m.valueCents / max) * 100}%` }} /></span>
                    <span className="num text-right font-semibold">{fmtBRL(m.valueCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-5" aria-labelledby="arp-ag">
            <h3 id="arp-ag" className="mb-3 font-bold text-ink">Órgãos que mais contrataram</h3>
            {!d.byAgency.length ? <p className="text-sm text-muted">Sem consumo ainda.</p> : <ul className="space-y-2 text-sm">{d.byAgency.map((g) => <li key={g.name} className="flex justify-between gap-3"><span className="truncate">{g.name}</span><span className="num font-semibold">{fmtBRL(g.contracted)}</span></li>)}</ul>}
            {!!d.limits.length && (<>
              <h3 className="mb-2 mt-5 font-bold text-ink">Limites de adesão mais usados</h3>
              <ul className="space-y-1.5 text-sm">{d.limits.map((l) => <li key={`${l.ata}-${l.item}`} className="flex justify-between gap-3"><span>Ata {l.ata} · item {l.item}</span><span className={l.usedPct >= 0.8 ? 'num font-semibold text-danger' : 'num'}>{fmtPct(l.usedPct)}</span></li>)}</ul>
            </>)}
          </section>
        </div>
      )}
      <p className="text-xs text-muted">{d.note}</p>
    </div>
  );
}

function NewArp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const empty = { number: '', object: '', processNumber: '', regime: 'federal' as ArpRegime, supplierName: '', supplierDocument: '', signedAt: '', startAt: '', endAt: '', managerName: '', managerDocument: '', notes: '' };
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<{ name: string; document: string; joinedOn: string; effectiveOn: string }[]>([]);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/arps', { method: 'POST', body: { ...f, participants: parts.filter((p) => p.name.trim().length >= 2).map((p) => ({ name: p.name, document: p.document || null, joinedOn: p.joinedOn || null, effectiveOn: p.effectiveOn || null })), processNumber: f.processNumber || null, supplierDocument: f.supplierDocument || null, managerDocument: f.managerDocument || null, signedAt: f.signedAt || null, startAt: f.startAt || null, endAt: f.endAt || null, notes: f.notes || null } }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['arps'] }); setF(empty); setParts([]); onClose(); toast({ tone: 'success', message: 'Ata cadastrada. Agora importe ou cadastre os itens.' }); nav(`/contracts/atas/${a.id}?t=itens&importar=1`); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.number.trim()) e.number = 'Informe o número da ata';
    if (f.object.trim().length < 3) e.object = 'Descreva o objeto';
    if (f.supplierName.trim().length < 2) e.supplierName = 'Informe o fornecedor';
    if (f.managerName.trim().length < 2) e.managerName = 'Informe o órgão gerenciador';
    if (f.startAt && f.endAt && f.endAt < f.startAt) e.endAt = 'Fim antes do início';
    setErrs(e);
    if (!Object.keys(e).length) m.mutate();
  };
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal open={open} onClose={onClose} title="Nova ata de registro de preços" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={submit}>Cadastrar ata</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Número da ata" htmlFor="na-number" required error={errs.number}><Input id="na-number" value={f.number} invalid={!!errs.number} onChange={(e) => set({ number: e.target.value })} placeholder="Ex.: 12/2026" /></FormField>
        <FormField label="Processo administrativo" htmlFor="na-proc"><Input id="na-proc" value={f.processNumber} onChange={(e) => set({ processNumber: e.target.value })} /></FormField>
        <FormField label="Objeto" htmlFor="na-object" required error={errs.object} className="sm:col-span-2"><Textarea id="na-object" rows={2} value={f.object} invalid={!!errs.object} onChange={(e) => set({ object: e.target.value })} /></FormField>
        <FormField label="Órgão gerenciador" htmlFor="na-mgr" required error={errs.managerName}><Input id="na-mgr" value={f.managerName} invalid={!!errs.managerName} onChange={(e) => set({ managerName: e.target.value })} /></FormField>
        <FormField label="CNPJ do gerenciador" htmlFor="na-mgrdoc"><Input id="na-mgrdoc" value={f.managerDocument} onChange={(e) => set({ managerDocument: e.target.value })} /></FormField>
        <FormField label="Fornecedor registrado" htmlFor="na-sup" required error={errs.supplierName}><Input id="na-sup" value={f.supplierName} invalid={!!errs.supplierName} onChange={(e) => set({ supplierName: e.target.value })} /></FormField>
        <FormField label="CNPJ do fornecedor" htmlFor="na-supdoc"><Input id="na-supdoc" value={f.supplierDocument} onChange={(e) => set({ supplierDocument: e.target.value })} /></FormField>
        <FormField label="Regime jurídico" htmlFor="na-regime" className="sm:col-span-2" hint="Define os limites de adesão e as regras de remanejamento e conversão aplicados."><Select id="na-regime" value={f.regime} onChange={(e) => set({ regime: e.target.value as ArpRegime })}>{ARP_REGIMES.map((r) => <option key={r} value={r}>{ARP_REGIME_LABELS[r]}</option>)}</Select></FormField>
        <FormField label="Assinatura" htmlFor="na-signed"><Input id="na-signed" type="date" value={f.signedAt} onChange={(e) => set({ signedAt: e.target.value })} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Início da vigência" htmlFor="na-start"><Input id="na-start" type="date" value={f.startAt} onChange={(e) => set({ startAt: e.target.value })} /></FormField>
          <FormField label="Fim da vigência" htmlFor="na-end" error={errs.endAt}><Input id="na-end" type="date" value={f.endAt} invalid={!!errs.endAt} onChange={(e) => set({ endAt: e.target.value })} /></FormField>
        </div>
      </div>
      <fieldset className="mt-5 space-y-2">
        <legend className="text-sm font-semibold text-ink">Participantes originários</legend>
        <p className="text-xs text-muted">Órgãos que entram com o gerenciador na formalização. Quem chegar depois entra como adesão (não participante). Sem data, vale a data de assinatura da ata.</p>
        {parts.map((p, i) => {
          const up = (x: Partial<typeof p>) => setParts(parts.map((y, k) => (k === i ? { ...y, ...x } : y)));
          return (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_140px_32px]">
              <Input aria-label={`Participante ${i + 1}`} placeholder="Nome do órgão" value={p.name} onChange={(e) => up({ name: e.target.value })} />
              <Input aria-label={`CNPJ do participante ${i + 1}`} placeholder="CNPJ" value={p.document} onChange={(e) => up({ document: e.target.value })} />
              <Input aria-label={`Data de participação ${i + 1}`} type="date" title="Data de participação" value={p.joinedOn} onChange={(e) => up({ joinedOn: e.target.value })} />
              <Input aria-label={`Início da eficácia ${i + 1}`} type="date" title="Início da eficácia (se diferente)" value={p.effectiveOn} onChange={(e) => up({ effectiveOn: e.target.value })} />
              <button type="button" className="text-sm text-muted hover:text-danger" aria-label={`Remover participante ${i + 1}`} onClick={() => setParts(parts.filter((_, k) => k !== i))}>✕</button>
            </div>
          );
        })}
        <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setParts([...parts, { name: '', document: '', joinedOn: '', effectiveOn: '' }])}>Adicionar participante</button>
      </fieldset>
    </Modal>
  );
}

function List() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(search, 300);
  const q = useQuery({ queryKey: ['arps', 'list', dq, status], placeholderData: keepPreviousData, queryFn: () => api<{ items: ArpListRow[]; canManage: boolean }>(`/arps${qs({ q: dq || undefined, status: status || undefined })}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[220px] flex-1 lg:max-w-[320px]">
          <label htmlFor="arp-q" className="sr-only">Buscar atas</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="arp-q" className="h-12 pl-10" placeholder="Número ou objeto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Situação da ata" className="h-12 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas as situações</option>{ARP_STATUSES.map((s) => <option key={s} value={s}>{ARP_STATUS_LABELS[s]}</option>)}</Select>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="card"><EmptyState title="Nenhuma ata cadastrada" description="Cadastre a ata com o órgão gerenciador e importe os itens da planilha." /></div>
      ) : (
        <div className="card overflow-hidden">
          <Table head={['Ata', 'Gerenciador', 'Situação', 'Vigência', 'Itens', 'Registrado', 'Contratado', 'Saldo', 'Oport. abertas', 'Alertas']} min={1080}>
            {q.data!.items.map((a) => (
              <tr key={a.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/contracts/atas/${a.id}`)}>
                <td className="px-3 py-3"><Link to={`/contracts/atas/${a.id}`} className="font-semibold text-ink hover:underline" onClick={(e) => e.stopPropagation()}>Ata {a.number}</Link><span className="block max-w-[280px] truncate text-xs text-muted">{a.object}</span></td>
                <td className="px-3 py-3">{a.managerName ?? '—'}</td>
                <td className="px-3 py-3"><ArpStatusChip status={a.status} /></td>
                <td className="num px-3 py-3">{a.startAt ? `${fmtDate(a.startAt)} a ${fmtDate(a.endAt)}` : '—'}</td>
                <td className="num px-3 py-3">{a.itemCount}</td>
                <td className="num px-3 py-3">{fmtBRL(a.registeredValueCents)}</td>
                <td className="num px-3 py-3 font-semibold">{fmtBRL(a.contractedValueCents)}</td>
                <td className="num px-3 py-3">{fmtBRL(a.availableValueCents)}</td>
                <td className="num px-3 py-3">{a.openOpportunities}</td>
                <td className="px-3 py-3">{a.alerts ? <span className="font-semibold text-danger">{a.alerts}</span> : '—'}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

type RulesData = { current: { regime: ArpRegime; rules: ArpRules; version: number; caps: { adhesionPerAgencyBp: number; adhesionTotalBp: number } }[]; history: { id: string; regime: ArpRegime; version: number; rules: ArpRules; note: string; createdAt: string; createdByName: string | null }[]; canEdit: boolean };

function Rules() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['arp-rules'], queryFn: () => api<RulesData>('/arp-rules') });
  const [edit, setEdit] = useState<{ regime: ArpRegime; rules: ArpRules } | null>(null);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api('/arp-rules', { method: 'POST', body: { regime: edit!.regime, rules: edit!.rules, note } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['arp-rules'] }); setEdit(null); setNote(''); toast({ tone: 'success', message: 'Nova versão das regras em vigor' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = edit?.rules;
  const setR = (p: Partial<ArpRules>) => setEdit(edit && { ...edit, rules: { ...edit.rules, ...p } });
  const cap = edit ? LEGAL_CAPS[edit.regime] : null;
  return (
    <div className="space-y-4">
      <Notice>Os tetos legais (Lei 14.133/2021, art. 86, §§ 4º e 5º: 50% por órgão e 200% no total, por item) são fixos. Aqui você só pode ser mais restritivo. Cada mudança cria uma versão nova; decisões antigas continuam com a versão da época.</Notice>
      <div className="card overflow-hidden">
        <Table head={['Regime', 'Versão', 'Limite por órgão', 'Limite total', 'Prazo para contratar', 'Adesão', 'Conversão', 'Fundamento', '']} min={1080}>
          {q.data!.current.map((c) => (
            <tr key={c.regime} className="border-t border-line align-top">
              <td className="px-3 py-3 font-semibold text-ink">{ARP_REGIME_LABELS[c.regime].split(' (')[0]}</td>
              <td className="num px-3 py-3">{c.version || 'padrão'}</td>
              <td className="num px-3 py-3">{c.rules.adhesionPerAgencyBp / 100}%</td>
              <td className="num px-3 py-3">{c.rules.adhesionTotalBp / 100}%</td>
              <td className="num px-3 py-3">{c.rules.contractDeadlineDays} dias</td>
              <td className="px-3 py-3">{c.rules.allowAdhesion ? 'Permitida' : 'Não permitida'}</td>
              <td className="px-3 py-3">{c.rules.allowConversion ? 'Prevista' : 'Só com exceção jurídica'}</td>
              <td className="max-w-[260px] px-3 py-3 text-xs text-muted">{c.rules.legalBasis}</td>
              <td className="px-3 py-3">{q.data!.canEdit && <Button size="sm" variant="secondary" onClick={() => setEdit({ regime: c.regime, rules: c.rules })}>Nova versão</Button>}</td>
            </tr>
          ))}
        </Table>
      </div>
      {!!q.data!.history.length && (
        <section className="card p-5">
          <h3 className="mb-2 font-bold text-ink">Versões anteriores</h3>
          <ul className="space-y-2 text-sm">{q.data!.history.map((h) => <li key={h.id}><span className="font-semibold">{ARP_REGIME_LABELS[h.regime].split(' (')[0]} v{h.version}</span> · {fmtDateTime(h.createdAt)} · {h.createdByName ?? '—'}: {h.note}</li>)}</ul>
        </section>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Regras: ${ARP_REGIME_LABELS[edit.regime].split(' (')[0]}` : ''} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={note.trim().length < 5} onClick={() => m.mutate()}>Criar versão</Button></>}>
        {r && cap && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Limite por órgão (%)" htmlFor="ru-per" hint={`Teto legal: ${cap.adhesionPerAgencyBp / 100}%`}><Input id="ru-per" type="number" min={0} max={cap.adhesionPerAgencyBp / 100} value={r.adhesionPerAgencyBp / 100} onChange={(e) => setR({ adhesionPerAgencyBp: Math.round(Number(e.target.value) * 100) })} /></FormField>
            <FormField label="Limite total de adesões (%)" htmlFor="ru-tot" hint={`Teto legal: ${cap.adhesionTotalBp / 100}%`}><Input id="ru-tot" type="number" min={0} max={cap.adhesionTotalBp / 100} value={r.adhesionTotalBp / 100} onChange={(e) => setR({ adhesionTotalBp: Math.round(Number(e.target.value) * 100) })} /></FormField>
            <FormField label="Prazo para contratar após autorização (dias)" htmlFor="ru-days"><Input id="ru-days" type="number" min={1} max={365} value={r.contractDeadlineDays} onChange={(e) => setR({ contractDeadlineDays: Number(e.target.value) })} /></FormField>
            <div className="space-y-2 pt-6 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.allowAdhesion} onChange={(e) => setR({ allowAdhesion: e.target.checked })} />Regulamento admite adesão</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.remanejamentoNeedsManager} onChange={(e) => setR({ remanejamentoNeedsManager: e.target.checked })} />Remanejamento exige o gerenciador</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.allowConversion} onChange={(e) => setR({ allowConversion: e.target.checked })} />Regulamento prevê conversão entre itens</label>
            </div>
            <FormField label="Fundamento legal" htmlFor="ru-basis" className="sm:col-span-2"><Textarea id="ru-basis" rows={2} value={r.legalBasis} onChange={(e) => setR({ legalBasis: e.target.value })} /></FormField>
            <FormField label="Motivo da mudança" htmlFor="ru-note" required className="sm:col-span-2"><Textarea id="ru-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          </div>
        )}
      </Modal>
    </div>
  );
}

type Sub = 'atas' | 'painel' | 'relatorios' | 'regras';
export function AtasTab() {
  const [sub, setSub] = useState<Sub>('atas');
  const [creating, setCreating] = useState(false);
  const canManage = useQuery({ queryKey: ['arps', 'list', '', ''], queryFn: () => api<{ items: ArpListRow[]; canManage: boolean }>('/arps') }).data?.canManage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Sub> label="Atas de registro de preços" value={sub} onChange={setSub} tabs={[{ key: 'atas', label: 'Atas' }, { key: 'painel', label: 'Painel' }, { key: 'relatorios', label: 'Relatórios' }, { key: 'regras', label: 'Regras legais' }]} />
        {canManage && <Button variant="primary" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>Nova ata</Button>}
      </div>
      {sub === 'atas' && <><ArpDashboard compact /><List /></>}
      {sub === 'painel' && <ArpDashboard />}
      {sub === 'relatorios' && <ArpReports />}
      {sub === 'regras' && <Rules />}
      <NewArp open={creating} onClose={() => setCreating(false)} />
      <p className="flex items-center gap-2 text-xs text-muted"><Scale className="h-4 w-4" aria-hidden />Saldos calculados pelo livro de movimentações. Venda fechada só reserva; o consumo acontece na formalização com empenho, contrato ou ordem de serviço.</p>
    </div>
  );
}
