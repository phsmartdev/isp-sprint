/** Livro de movimentações, operações entre itens (simular → pedir → aprovar → efetivar), documentos e histórico da ata. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Download, FlaskConical, Plus, Trash2, Upload, XCircle } from 'lucide-react';
import { ARP_LEDGER_KINDS, ARP_LEDGER_LABELS, OPERATION_HINTS, ITEM_PATCH_LABELS, OPERATION_KINDS, OPERATION_LABELS, type OperationKind } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { fmtBytes } from '../../lib/files';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { useAuth } from '../../auth/AuthProvider';
import { DOC_CATEGORIES, DOC_LABELS, DocPicker, QtyInput, Table, errMsg, parseMoney, parseQty, qty, useArpDocs, useArpRefresh, useDocUpload, type ArpDetail, type Operation, type Simulation } from './shared';

type LedgerRow = { id: string; occurredAt: string; kind: string; kindLabel: string; dir: 'saida' | 'entrada' | null; itemId: string; agencyId: string; itemNumber: string; lot: string | null; agencyName: string; qtyMilli: number; unit: string; amountCents: number; origin: string; opportunityCode: number | null; documentName: string | null; actorName: string | null; justification: string | null; ruleVersion: number; reversesId: string | null; effectiveOn: string | null };

// ------------------------------------------------------------------ livro
function Execution({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [f, setF] = useState({ kind: 'execucao' as 'execucao' | 'faturamento', itemId: '', agencyId: '', qty: '', doc: '', justification: '' });
  const [req] = useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api<{ written: number }>(`/arps/${arp.id}/ledger/execution`, { method: 'POST', body: { kind: f.kind, itemId: f.itemId, agencyId: f.agencyId, qtyMilli: parseQty(f.qty), documentId: f.doc || null, justification: f.justification, requestId: req } }),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: f.kind === 'execucao' ? 'Execução registrada' : 'Faturamento registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const it = arp.items.find((i) => i.id === f.itemId);
  const b = it?.byAgency.find((x) => x.agencyId === f.agencyId);
  return (
    <Modal open={open} onClose={onClose} title="Registrar execução ou faturamento" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.itemId || !f.agencyId || !parseQty(f.qty) || f.justification.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Tipo" htmlFor="ex-kind"><Select id="ex-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option value="execucao">Execução (serviço prestado)</option><option value="faturamento">Faturamento</option></Select></FormField>
        <FormField label="Item" htmlFor="ex-item"><Select id="ex-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Escolha</option>{arp.items.filter((i) => i.contractedMilli > 0).map((i) => <option key={i.id} value={i.id}>{i.itemNumber} · {i.description.slice(0, 40)}</option>)}</Select></FormField>
        <FormField label="Órgão" htmlFor="ex-ag"><Select id="ex-ag" value={f.agencyId} onChange={(e) => setF({ ...f, agencyId: e.target.value })}><option value="">Escolha</option>{(it?.byAgency.filter((x) => x.contracted > 0) ?? []).map((x) => <option key={x.agencyId} value={x.agencyId}>{arp.agencies.find((g) => g.id === x.agencyId)?.name}</option>)}</Select></FormField>
        <FormField label="Quantidade" htmlFor="ex-qty" hint={b ? (f.kind === 'execucao' ? `Contratado e não executado: ${qty(b.contracted - b.executed)}` : `Executado e não faturado: ${qty(b.executed - b.billed)}`) : undefined}><Input id="ex-qty" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></FormField>
        <FormField label="Descrição" htmlFor="ex-just" required className="sm:col-span-2"><Textarea id="ex-just" rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} placeholder="Ex.: medição de setembro" /></FormField>
        <div className="sm:col-span-2"><DocPicker arpId={arp.id} id="ex-doc" label="Documento (medição, nota fiscal)" categories={['outro', 'contrato', 'ordem_servico']} value={f.doc} onChange={(d) => setF({ ...f, doc: d })} optional /></div>
      </div>
      <p className="mt-3 text-xs text-muted">Execução e faturamento não mudam o saldo disponível da ata; servem para acompanhar o que foi entregue e cobrado.</p>
    </Modal>
  );
}

export function LedgerPanel({ arp }: { arp: ArpDetail }) {
  const [f, setF] = useState({ kind: '', itemId: '', agencyId: '' });
  const [exec, setExec] = useState(false);
  const q = useQuery({ queryKey: ['arp', arp.id, 'ledger', f], queryFn: () => api<{ items: LedgerRow[] }>(`/arps/${arp.id}/ledger${qs({ kind: f.kind || undefined, itemId: f.itemId || undefined, agencyId: f.agencyId || undefined })}`) });
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Movimentação" htmlFor="lg-kind"><Select id="lg-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Todas</option>{ARP_LEDGER_KINDS.map((k) => <option key={k} value={k}>{ARP_LEDGER_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Item" htmlFor="lg-item"><Select id="lg-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Todos</option>{arp.items.map((i) => <option key={i.id} value={i.id}>{i.lot ? `${i.lot}/` : ''}{i.itemNumber}</option>)}</Select></FormField>
          <FormField label="Órgão" htmlFor="lg-ag"><Select id="lg-ag" value={f.agencyId} onChange={(e) => setF({ ...f, agencyId: e.target.value })}><option value="">Todos</option>{arp.agencies.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></FormField>
        </div>
        <div className="flex gap-2">
          <a className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 font-semibold text-primary hover:bg-primary-soft" href={`/api/v1/arp-reports${qs({ type: 'movimentacoes', arpId: arp.id, kind: f.kind || undefined, itemId: f.itemId || undefined, agencyId: f.agencyId || undefined, format: 'csv' })}`} download><Download className="h-4 w-4" />CSV</a>
          {arp.can.effect && arp.items.some((i) => i.contractedMilli > 0) && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setExec(true)}>Execução ou faturamento</Button>}
        </div>
      </div>
      <p className="px-4 pb-3 text-xs text-muted">Livro imutável: nada é apagado ou editado. Correções entram como lançamentos compensatórios (Conversões e remanejamentos → Correção de lançamento).</p>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhuma movimentação" description="Reservas, consumos, adesões e operações aparecem aqui, uma linha por lançamento." /></div> : (
        <Table head={['Data', 'Eficácia', 'Movimentação', 'Item', 'Órgão', 'Quantidade', 'Valor', 'Origem', 'Documento', 'Responsável', 'Justificativa']} min={1340}>
          {q.data!.items.map((l) => (
            <tr key={l.id} className={clsx('border-t border-line align-top', l.reversesId && 'bg-surface-2/50')}>
              <td className="num whitespace-nowrap px-3 py-2">{fmtDateTime(l.occurredAt)}</td>
              <td className="num whitespace-nowrap px-3 py-2">{l.effectiveOn ? fmtDate(l.effectiveOn) : '—'}</td>
              <td className="px-3 py-2 font-semibold text-ink">{l.kindLabel}{l.dir && <span className="block text-xs font-normal text-muted">{l.dir === 'saida' ? 'saída' : 'entrada'}</span>}{l.reversesId && <span className="block text-xs font-normal text-muted">compensatório</span>}</td>
              <td className="px-3 py-2">{l.lot ? `${l.lot}/` : ''}{l.itemNumber}</td>
              <td className="px-3 py-2">{l.agencyName}</td>
              <td className="num whitespace-nowrap px-3 py-2">{qty(l.qtyMilli)} {l.unit}</td>
              <td className="num whitespace-nowrap px-3 py-2">{fmtBRL(l.amountCents)}</td>
              <td className="px-3 py-2">{l.origin}{l.opportunityCode && <span className="block text-xs text-muted">OP-{l.opportunityCode}</span>}</td>
              <td className="max-w-[160px] truncate px-3 py-2">{l.documentName ?? '—'}</td>
              <td className="px-3 py-2">{l.actorName ?? '—'}<span className="block text-xs text-muted">regra v{l.ruleVersion}</span></td>
              <td className="max-w-[240px] px-3 py-2 text-xs">{l.justification ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      <Execution arp={arp} open={exec} onClose={() => setExec(false)} />
    </section>
  );
}

// ------------------------------------------------------------------ operações
type Line = { itemId: string; agencyId: string; qty: string };
const blank = (): Line => ({ itemId: '', agencyId: '', qty: '' });

function LinesInput({ arp, title, lines, setLines, sameItem }: { arp: ArpDetail; title: string; lines: Line[]; setLines: (l: Line[]) => void; sameItem?: string }) {
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{title}</legend>
      {lines.map((l, i) => {
        const it = arp.items.find((x) => x.id === (sameItem ?? l.itemId));
        const b = it?.byAgency.find((x) => x.agencyId === l.agencyId);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {!sameItem && <Select aria-label={`${title}: item ${i + 1}`} className="w-auto min-w-[200px]" value={l.itemId} onChange={(e) => set(i, { itemId: e.target.value })}><option value="">Item</option>{arp.items.map((x) => <option key={x.id} value={x.id}>{x.itemNumber} · {x.description.slice(0, 32)} ({fmtBRL(x.unitCents)})</option>)}</Select>}
            <Select aria-label={`${title}: órgão ${i + 1}`} className="w-auto min-w-[180px]" value={l.agencyId} onChange={(e) => set(i, { agencyId: e.target.value })}><option value="">Órgão</option>{arp.agencies.filter((g) => g.kind !== 'nao_participante').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <QtyInput label={`${title}: quantidade ${i + 1}`} value={l.qty} onChange={(v) => set(i, { qty: v })} unit={it?.unit} />
            {b && <span className="text-xs text-muted">disponível {qty(b.available)}</span>}
            {lines.length > 1 && <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Remover linha ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        );
      })}
      <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setLines([...lines, blank()])}>Adicionar linha</button>
    </fieldset>
  );
}

function SimulationView({ arp, sim }: { arp: ArpDetail; sim: Simulation }) {
  const it = (id: string) => arp.items.find((i) => i.id === id);
  const ag = (id: string) => arp.agencies.find((g) => g.id === id);
  return (
    <div className={clsx('space-y-3 rounded-md border p-4', sim.ok ? 'border-success/40 bg-success-soft/40' : 'border-danger/40 bg-danger-soft/40')} role="status">
      <p className="flex items-center gap-2 font-semibold text-ink">{sim.ok ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> : <XCircle className="h-5 w-5 text-danger" aria-hidden />}{sim.ok ? 'Operação admissível' : 'Operação não admitida'}</p>
      {!!sim.errors.length && <ul className="list-disc pl-5 text-sm text-danger">{sim.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {!!sim.warnings.length && <ul className="list-disc pl-5 text-sm text-[#9A5B00]">{sim.warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
      <p className="text-sm">Valor de origem <span className="num font-semibold">{fmtBRL(sim.sourceValueCents)}</span> · destino <span className="num font-semibold">{fmtBRL(sim.targetValueCents)}</span></p>
      {!!sim.impact.length && (
        <table className="w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1 font-medium">Item e órgão</th><th className="py-1 font-medium">Cota antes → depois</th><th className="py-1 font-medium">Disponível antes → depois</th></tr></thead>
          <tbody>{sim.impact.map((x) => <tr key={`${x.itemId}${x.agencyId}`} className="border-t border-line/60"><td className="py-1">{it(x.itemId)?.itemNumber} · {ag(x.agencyId)?.name}</td><td className="num py-1">{qty(x.before.quota)} → {qty(x.after.quota)}</td><td className={clsx('num py-1', x.after.available < 0 && 'text-danger')}>{qty(x.before.available)} → {qty(x.after.available)}</td></tr>)}</tbody>
        </table>
      )}
      <p className="text-xs text-muted">Fundamento: {sim.legalBasis} ({sim.ruleVersion ? `regras v${sim.ruleVersion}` : 'regras padrão'})</p>
    </div>
  );
}

function NewOperation({ arp, open, onClose, initialKind = 'remanejamento' }: { arp: ArpDetail; open: boolean; onClose: () => void; initialKind?: OperationKind }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [kind, setKind] = useState<OperationKind>(initialKind);
  const [criteria, setCriteria] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  useEffect(() => { if (open) setKind(initialKind); }, [open, initialKind]);
  const [sources, setSources] = useState<Line[]>([blank()]);
  const [targets, setTargets] = useState<Line[]>([blank()]);
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [entryId, setEntryId] = useState('');
  const [fixed, setFixed] = useState('');
  const [sim, setSim] = useState<Simulation | null>(null);
  const [justification, setJustification] = useState('');
  const [doc, setDoc] = useState('');
  const ledger = useQuery({ queryKey: ['arp', arp.id, 'ledger', 'correcao'], enabled: open && kind === 'correcao', queryFn: () => api<{ items: LedgerRow[] }>(`/arps/${arp.id}/ledger`) });
  const conv = (ls: Line[], forceItem?: string) => ls.map((l) => ({ itemId: forceItem ?? l.itemId, agencyId: l.agencyId, qtyMilli: parseQty(l.qty) ?? 0 })).filter((l) => l.itemId && l.agencyId);
  const manager = arp.agencies.find((g) => g.kind === 'gerenciador')!;
  const input = () => ({
    kind,
    sources: kind === 'alteracao_preco' ? [{ itemId, agencyId: manager.id, qtyMilli: 0 }] : kind === 'correcao' ? [] : conv(sources, kind === 'remanejamento' ? itemId : undefined),
    targets: kind === 'conversao' ? conv(targets) : kind === 'remanejamento' ? conv(targets, itemId) : [],
    newUnitCents: kind === 'alteracao_preco' ? parseMoney(price) : null,
    correctsEntryId: kind === 'correcao' ? entryId || null : null,
    correctedQtyMilli: kind === 'correcao' ? parseQty(fixed) ?? 0 : null,
    criteria: kind === 'conversao' ? criteria : null,
    effectiveOn: effectiveOn || null,
  });
  const simulate = useMutation({ mutationFn: () => api<Simulation>(`/arps/${arp.id}/operations/simulate`, { method: 'POST', body: input() }), onSuccess: setSim, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const request = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/operations`, { method: 'POST', body: { input: input(), justification, documentId: doc || null } }),
    onSuccess: () => { refresh(); reset(); onClose(); toast({ tone: 'success', message: 'Operação solicitada. Agora precisa de aprovação de outra pessoa.' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const reset = () => { setSources([blank()]); setTargets([blank()]); setItemId(''); setPrice(''); setEntryId(''); setFixed(''); setSim(null); setJustification(''); setDoc(''); setCriteria(''); setEffectiveOn(''); };
  const change = (fn: () => void) => { fn(); setSim(null); };
  const correctable = (ledger.data?.items ?? []).filter((l) => ['consumo', 'reserva', 'execucao', 'faturamento', 'ajuste'].includes(l.kind) && !l.reversesId);
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Nova operação entre itens" size="xl"
      footer={<><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancelar</Button><Button variant="outline" icon={<FlaskConical className="h-4 w-4" />} loading={simulate.isPending} onClick={() => simulate.mutate()}>Simular</Button><Button variant="primary" disabled={!sim?.ok || justification.trim().length < 10} loading={request.isPending} onClick={() => request.mutate()}>Solicitar operação</Button></>}>
      <div className="space-y-4">
        <FormField label="Operação" htmlFor="op-kind" hint={OPERATION_HINTS[kind]}><Select id="op-kind" value={kind} onChange={(e) => change(() => { setKind(e.target.value as OperationKind); })}>{OPERATION_KINDS.filter((k) => k !== 'alteracao_item').map((k) => <option key={k} value={k}>{OPERATION_LABELS[k]}</option>)}</Select></FormField>
        {(kind === 'remanejamento' || kind === 'alteracao_preco') && <FormField label="Item" htmlFor="op-item"><Select id="op-item" value={itemId} onChange={(e) => change(() => setItemId(e.target.value))}><option value="">Escolha</option>{arp.items.map((i) => <option key={i.id} value={i.id}>{i.itemNumber} · {i.description.slice(0, 50)} ({fmtBRL(i.unitCents)})</option>)}</Select></FormField>}
        {kind === 'remanejamento' && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><LinesInput arp={arp} title="Sai de" lines={sources} setLines={(l) => change(() => setSources(l))} sameItem={itemId} /><LinesInput arp={arp} title="Vai para" lines={targets} setLines={(l) => change(() => setTargets(l))} sameItem={itemId} /></div>}
        {kind === 'conversao' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><LinesInput arp={arp} title="Item de origem" lines={sources} setLines={(l) => change(() => setSources(l))} /><LinesInput arp={arp} title="Item de destino" lines={targets} setLines={(l) => change(() => setTargets(l))} /></div>}
        {kind === 'conversao' && <FormField label="Critério de equivalência" htmlFor="op-crit" required hint="Como a quantidade de origem vira quantidade de destino (unidades, valor, especificação)"><Textarea id="op-crit" rows={2} value={criteria} onChange={(e) => change(() => setCriteria(e.target.value))} /></FormField>}
        {kind !== 'correcao' && <FormField label="Data de eficácia" htmlFor="op-eff" hint="Quando a operação passa a valer. Em branco: na efetivação"><Input id="op-eff" type="date" value={effectiveOn} onChange={(e) => change(() => setEffectiveOn(e.target.value))} /></FormField>}
        {kind === 'cancelamento' && <LinesInput arp={arp} title="Quantitativo cancelado" lines={sources} setLines={(l) => change(() => setSources(l))} />}
        {kind === 'alteracao_preco' && <FormField label="Novo preço unitário (R$)" htmlFor="op-price"><Input id="op-price" inputMode="decimal" value={price} onChange={(e) => change(() => setPrice(e.target.value))} /></FormField>}
        {kind === 'correcao' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Lançamento a corrigir" htmlFor="op-entry" className="sm:col-span-2"><Select id="op-entry" value={entryId} onChange={(e) => change(() => setEntryId(e.target.value))}><option value="">Escolha</option>{correctable.map((l) => <option key={l.id} value={l.id}>{fmtDateTime(l.occurredAt)} · {l.kindLabel} · item {l.itemNumber} · {l.agencyName} · {qty(l.qtyMilli)}</option>)}</Select></FormField>
            <FormField label="Quantidade correta" htmlFor="op-fixed" hint="0 desfaz o lançamento sem substituir"><Input id="op-fixed" inputMode="decimal" value={fixed} onChange={(e) => change(() => setFixed(e.target.value))} /></FormField>
          </div>
        )}
        {sim && <SimulationView arp={arp} sim={sim} />}
        {sim?.ok && (<>
          <FormField label="Justificativa" htmlFor="op-just" required hint="Mínimo 10 caracteres"><Textarea id="op-just" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} /></FormField>
          <DocPicker arpId={arp.id} id="op-doc" label="Documento de apoio" categories={['autorizacao_gerenciador', 'parecer_juridico', 'outro']} value={doc} onChange={setDoc} optional />
        </>)}
      </div>
    </Modal>
  );
}

function Decide({ op, onClose, arpId }: { op: Operation | null; onClose: () => void; arpId: string }) {
  const toast = useToast();
  const refresh = useArpRefresh(arpId);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (approve: boolean) => api(`/arp-operations/${op!.id}/decide`, { method: 'POST', body: { approve, note } }),
    onSuccess: (_, approve) => { refresh(); setNote(''); onClose(); toast({ tone: 'success', message: approve ? 'Operação aprovada' : 'Operação reprovada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!op} onClose={onClose} title={op ? `Decidir: ${op.label}` : ''} footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="danger" disabled={note.trim().length < 5} loading={m.isPending && m.variables === false} onClick={() => m.mutate(false)}>Reprovar</Button><Button variant="primary" loading={m.isPending && m.variables === true} onClick={() => m.mutate(true)}>Aprovar</Button></>}>
      {op && <div className="space-y-3"><p className="text-sm">{op.justification}</p><p className="text-sm text-muted">Pedido por {op.requestedByName} em {fmtDateTime(op.createdAt)}.</p><FormField label="Observação" htmlFor="dc-note" hint="Obrigatória para reprovar"><Textarea id="dc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField></div>}
    </Modal>
  );
}

function Effect({ arp, op, onClose }: { arp: ArpDetail; op: Operation | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const { me } = useAuth();
  const [doc, setDoc] = useState('');
  const [basis, setBasis] = useState('');
  const [parecer, setParecer] = useState('');
  const [legal, setLegal] = useState('');
  const needsLegal = op?.kind === 'conversao' && arp.rules.rules.conversionNeedsLegalOpinion !== false;
  const needsException = op?.kind === 'conversao' && !arp.rules.rules.allowConversion;
  const juridico = !!me?.sectors?.includes('juridico');
  const m = useMutation({
    mutationFn: () => api<{ entries: number }>(`/arp-operations/${op!.id}/effect`, { method: 'POST', body: { documentId: doc, legalOpinionDocumentId: needsLegal ? legal : null, exception: needsException ? { basis, documentId: parecer } : null } }),
    onSuccess: (r) => { refresh(); setDoc(''); onClose(); toast({ tone: 'success', message: `Operação efetivada: ${r.entries} lançamento(s) no livro` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!op} onClose={onClose} title={op ? `Efetivar: ${op.label}` : ''} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="primary" disabled={!doc || (needsLegal && !legal) || (needsException && (!juridico || basis.trim().length < 10 || !parecer))} loading={m.isPending} onClick={() => m.mutate()}>Efetivar</Button></>}>
      {op && (
        <div className="space-y-4">
          <p className="text-sm">O saldo é conferido de novo na hora de efetivar. Se mudou desde a aprovação e a operação deixou de caber, nada é gravado.</p>
          <DocPicker arpId={arp.id} id="ef-doc" label="Documento de autorização" categories={['autorizacao_gerenciador', 'parecer_juridico', 'publicacao', 'ata', 'outro']} value={doc} onChange={setDoc} />
          {needsLegal && <DocPicker arpId={arp.id} id="ef-legal" label="Parecer jurídico da conversão" categories={['parecer_juridico']} value={legal} onChange={setLegal} />}
          {needsException && (juridico ? (<>
            <Notice tone="warning">O regulamento desta ata não prevê conversão entre itens. A efetivação exige exceção validada pelo Jurídico.</Notice>
            <FormField label="Fundamento legal da exceção" htmlFor="ef-basis" required><Textarea id="ef-basis" rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} /></FormField>
            <DocPicker arpId={arp.id} id="ef-parecer" label="Parecer jurídico" categories={['parecer_juridico']} value={parecer} onChange={setParecer} />
          </>) : <Notice tone="warning">O regulamento desta ata não prevê conversão. Só alguém do setor Jurídico pode efetivar com exceção.</Notice>)}
        </div>
      )}
    </Modal>
  );
}

const OP_STATUS: Record<Operation['status'], [string, Tone]> = { solicitada: ['Aguardando aprovação', 'yellow'], aprovada: ['Aprovada, falta efetivar', 'blue'], reprovada: ['Reprovada', 'red'], efetivada: ['Efetivada', 'green'] };
export function OperationsPanel({ arp }: { arp: ArpDetail }) {
  const q = useQuery({ queryKey: ['arp', arp.id, 'operations'], queryFn: () => api<{ items: Operation[] }>(`/arps/${arp.id}/operations`) });
  const [creating, setCreating] = useState<OperationKind | null>(null);
  const [deciding, setDeciding] = useState<Operation | null>(null);
  const [effecting, setEffecting] = useState<Operation | null>(null);
  const item = (id: string) => arp.items.find((i) => i.id === id);
  const ag = (id: string) => arp.agencies.find((g) => g.id === id);
  const describe = (o: Operation) => {
    const l = (x: { itemId: string; agencyId: string; qtyMilli: number }) => `${qty(x.qtyMilli)} do item ${item(x.itemId)?.itemNumber} (${ag(x.agencyId)?.name})`;
    if (o.kind === 'alteracao_item') return `Item ${item(o.input.sources[0]?.itemId ?? '')?.itemNumber}: ${Object.keys(o.input.itemPatch ?? {}).map((k) => ITEM_PATCH_LABELS[k as keyof typeof ITEM_PATCH_LABELS] ?? k).join(', ')}`;
    if (o.kind === 'alteracao_preco') return `Item ${item(o.input.sources[0]?.itemId ?? '')?.itemNumber}: novo preço ${fmtBRL(o.input.newUnitCents)}`;
    return [o.input.sources.map(l).join(', '), o.input.targets.map(l).join(', ')].filter(Boolean).join(' → ') || '—';
  };
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 className="text-lg font-bold text-ink">Conversões e remanejamentos</h2><p className="text-sm text-muted">Toda operação é simulada, pedida, aprovada por outra pessoa e efetivada com documento. Nada muda o saldo antes da efetivação.</p></div>
        {arp.can.manage && arp.status === 'vigente' && <div className="flex gap-2"><Button variant="secondary" onClick={() => setCreating('conversao')}>Converter saldo entre itens</Button><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('remanejamento')}>Nova operação</Button></div>}
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhuma operação" description="Remanejamentos entre órgãos, conversões entre itens, correções, alterações de preço e cancelamentos aparecem aqui." /></div> : (
        <Table head={['Operação', 'O que muda', 'Valores', 'Justificativa', 'Situação', '']} min={1080}>
          {q.data!.items.map((o) => { const [label, tone] = OP_STATUS[o.status]; return (
            <tr key={o.id} className="border-t border-line align-top">
              <td className="px-3 py-3 font-semibold text-ink">{o.label}<span className="block text-xs font-normal text-muted">{o.requestedByName} · {fmtDateTime(o.createdAt)}</span></td>
              <td className="max-w-[300px] px-3 py-3 text-xs">{describe(o)}</td>
              <td className="num whitespace-nowrap px-3 py-3 text-xs">{fmtBRL(o.simulation.sourceValueCents)} → {fmtBRL(o.simulation.targetValueCents)}</td>
              <td className="max-w-[260px] px-3 py-3 text-xs">{o.justification}{o.decisionNote && <span className="block text-muted">Decisão: {o.decisionNote}</span>}</td>
              <td className="px-3 py-3"><Chip tone={tone}>{label}</Chip>{o.decidedByName && <span className="block text-xs text-muted">por {o.decidedByName}</span>}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right">
                {o.canDecide && <Button size="sm" variant="secondary" onClick={() => setDeciding(o)}>Decidir</Button>}
                {o.canEffect && <Button size="sm" variant="primary" onClick={() => setEffecting(o)}>Efetivar</Button>}
              </td>
            </tr>
          ); })}
        </Table>
      )}
      <NewOperation arp={arp} open={!!creating} initialKind={creating ?? 'remanejamento'} onClose={() => setCreating(null)} />
      <Decide arpId={arp.id} op={deciding} onClose={() => setDeciding(null)} />
      <Effect arp={arp} op={effecting} onClose={() => setEffecting(null)} />
    </section>
  );
}

// ------------------------------------------------------------------ documentos e histórico
export function DocsPanel({ arp }: { arp: ArpDetail }) {
  const q = useArpDocs(arp.id);
  const [cat, setCat] = useState<(typeof DOC_CATEGORIES)[number]>('ata');
  const input = useRef<HTMLInputElement>(null);
  const up = useDocUpload(arp.id, () => cat, () => undefined);
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 p-4">
        <div><h2 className="text-lg font-bold text-ink">Documentos</h2><p className="text-sm text-muted">Ata, edital, publicações, adesões, autorizações, empenhos, contratos e pareceres. Arquivos até 3 MB.</p></div>
        {arp.can.manage && (
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Tipo" htmlFor="dc-cat"><Select id="dc-cat" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_LABELS[c]}</option>)}</Select></FormField>
            <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={up.isPending} onClick={() => input.current?.click()}>Anexar documento</Button>
            <input ref={input} type="file" className="sr-only" aria-label="Arquivo do documento" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
          </div>
        )}
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : !q.data?.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum documento" /></div> : (
        <Table head={['Documento', 'Tipo', 'Tamanho', 'Enviado por', 'Em', '']} min={720}>
          {q.data.items.map((d) => <tr key={d.id} className="border-t border-line"><td className="px-3 py-3 font-semibold text-ink">{d.name}</td><td className="px-3 py-3">{DOC_LABELS[d.category]}</td><td className="num px-3 py-3">{fmtBytes(d.sizeBytes)}</td><td className="px-3 py-3">{d.uploadedBy ?? '—'}</td><td className="num px-3 py-3">{fmtDateTime(d.createdAt)}</td><td className="px-3 py-3 text-right"><a className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" href={`/api/v1/arps/${arp.id}/documents/${d.id}`} download><Download className="h-4 w-4" />Baixar</a></td></tr>)}
        </Table>
      )}
    </section>
  );
}

export function HistoryPanel({ arp }: { arp: ArpDetail }) {
  const q = useQuery({ queryKey: ['arp', arp.id, 'events'], queryFn: () => api<{ items: { id: string; type: string; summary: string; occurredAt: string; actorName: string | null }[] }>(`/arps/${arp.id}/events`) });
  const changes = useQuery({ queryKey: ['arp', arp.id, 'item-changes'], queryFn: () => api<{ items: { id: string; createdAt: string; itemNumber: string; lot: string | null; version: number | null; field: string; fromValue: string | null; toValue: string | null; reason: string; operationId: string | null; documentName: string | null; actorName: string | null }[] }>(`/arps/${arp.id}/item-changes`) });
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Histórico da ata</h2>
      {q.isLoading ? <LoadingRows rows={4} /> : !q.data?.items.length ? <p className="text-sm text-muted">Sem eventos.</p> : (
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {q.data.items.map((e) => <li key={e.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-circle bg-primary" aria-hidden /><p className="text-sm text-ink">{e.summary}</p><p className="text-xs text-muted">{e.actorName ?? 'Sistema'} · {fmtDateTime(e.occurredAt)}</p></li>)}
        </ol>
      )}
      <h3 className="mb-2 mt-6 text-base font-bold text-ink">Alterações dos itens</h3>
      {changes.isLoading ? <LoadingRows rows={2} /> : !changes.data?.items.length ? <p className="text-sm text-muted">Nenhum item foi alterado.</p> : (
        <Table head={['Em', 'Item', 'Versão', 'Campo', 'De → para', 'Motivo', 'Documento', 'Por']} min={980}>
          {changes.data.items.map((c) => <tr key={c.id} className="border-t border-line align-top"><td className="num whitespace-nowrap px-3 py-2">{fmtDateTime(c.createdAt)}</td><td className="px-3 py-2">{c.lot ? `${c.lot}/` : ''}{c.itemNumber}</td><td className="num px-3 py-2">{c.version ? `v${c.version}` : '—'}</td><td className="px-3 py-2">{ITEM_PATCH_LABELS[c.field as keyof typeof ITEM_PATCH_LABELS] ?? c.field}</td><td className="max-w-[260px] px-3 py-2 text-xs">{c.fromValue ?? '—'} → {c.toValue ?? '—'}</td><td className="max-w-[240px] px-3 py-2 text-xs">{c.reason}{c.operationId && <span className="block text-muted">via operação aprovada</span>}</td><td className="max-w-[160px] truncate px-3 py-2">{c.documentName ?? '—'}</td><td className="px-3 py-2">{c.actorName ?? '—'}</td></tr>)}
        </Table>
      )}
    </section>
  );
}
