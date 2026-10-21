/** Ficha da ata de registro de preços (dentro de Gestão de Contratos). */
import { WorkLinks } from '../../features/tasks/WorkLinks';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ScrollText } from 'lucide-react';
import { ARP_REGIMES, ARP_REGIME_LABELS, type ArpRegime, type ArpStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Breadcrumb, Button, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { TvArea, TvBar, TvButton, useTvMode } from '../../features/TvMode';
import { MoneyToggle } from '../../lib/privacy';
import { ArpStatusChip, errMsg, useArp, useArpRefresh, type ArpDetail } from '../../features/arp/shared';
import { ItemsPanel } from '../../features/arp/ItemsPanel';
import { ImportWizard } from '../../features/arp/ImportWizard';
import { OpportunitiesPanel } from '../../features/arp/OpportunitiesPanel';
import { AdhesionsPanel } from '../../features/arp/AdhesionsPanel';
import { DocsPanel, HistoryPanel, LedgerPanel, OperationsPanel } from '../../features/arp/LedgerPanels';
import { ArpReports } from '../../features/arp/Reports';

type Tab = 'itens' | 'oportunidades' | 'orgaos' | 'movimentacoes' | 'operacoes' | 'documentos' | 'relatorios' | 'projetos' | 'historico';
const TABS: { key: Tab; label: string }[] = [
  { key: 'itens', label: 'Itens e saldos' }, { key: 'oportunidades', label: 'Oportunidades' }, { key: 'orgaos', label: 'Órgãos e adesões' }, { key: 'movimentacoes', label: 'Movimentações' },
  { key: 'operacoes', label: 'Conversões e remanejamentos' }, { key: 'documentos', label: 'Documentos' }, { key: 'relatorios', label: 'Relatórios' }, { key: 'projetos', label: 'Tarefas e projetos' }, { key: 'historico', label: 'Histórico' },
];

function EditArp({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [f, setF] = useState({ number: arp.number, object: arp.object, processNumber: arp.processNumber ?? '', regime: arp.regime, supplierName: arp.supplierName, supplierDocument: arp.supplierDocument ?? '', signedAt: arp.signedAt ?? '', startAt: arp.startAt ?? '', endAt: arp.endAt ?? '', notes: arp.notes ?? '' });
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}`, { method: 'PATCH', body: { ...f, processNumber: f.processNumber || null, supplierDocument: f.supplierDocument || null, signedAt: f.signedAt || null, startAt: f.startAt || null, endAt: f.endAt || null, notes: f.notes || null, regime: arp.status === 'rascunho' ? f.regime : undefined, rowVersion: arp.rowVersion } }),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: 'Dados da ata salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal open={open} onClose={onClose} title={`Editar ata ${arp.number}`} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Número" htmlFor="ea-number"><Input id="ea-number" value={f.number} onChange={(e) => set({ number: e.target.value })} /></FormField>
        <FormField label="Processo" htmlFor="ea-proc"><Input id="ea-proc" value={f.processNumber} onChange={(e) => set({ processNumber: e.target.value })} /></FormField>
        <FormField label="Objeto" htmlFor="ea-obj" className="sm:col-span-2"><Textarea id="ea-obj" rows={2} value={f.object} onChange={(e) => set({ object: e.target.value })} /></FormField>
        <FormField label="Fornecedor" htmlFor="ea-sup"><Input id="ea-sup" value={f.supplierName} onChange={(e) => set({ supplierName: e.target.value })} /></FormField>
        <FormField label="CNPJ do fornecedor" htmlFor="ea-supdoc"><Input id="ea-supdoc" value={f.supplierDocument} onChange={(e) => set({ supplierDocument: e.target.value })} /></FormField>
        <FormField label="Regime jurídico" htmlFor="ea-regime" className="sm:col-span-2" hint={arp.status !== 'rascunho' ? 'Não muda depois que a ata está vigente.' : undefined}><Select id="ea-regime" value={f.regime} disabled={arp.status !== 'rascunho'} onChange={(e) => set({ regime: e.target.value as ArpRegime })}>{ARP_REGIMES.map((r) => <option key={r} value={r}>{ARP_REGIME_LABELS[r]}</option>)}</Select></FormField>
        <FormField label="Assinatura" htmlFor="ea-signed"><Input id="ea-signed" type="date" value={f.signedAt} onChange={(e) => set({ signedAt: e.target.value })} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Início" htmlFor="ea-start"><Input id="ea-start" type="date" value={f.startAt} onChange={(e) => set({ startAt: e.target.value })} /></FormField>
          <FormField label="Fim" htmlFor="ea-end"><Input id="ea-end" type="date" value={f.endAt} onChange={(e) => set({ endAt: e.target.value })} /></FormField>
        </div>
        <FormField label="Observações" htmlFor="ea-notes" className="sm:col-span-2"><Textarea id="ea-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function StatusAction({ arp }: { arp: ArpDetail }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [to, setTo] = useState<ArpStatus | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}`, { method: 'PATCH', body: { status: to, rowVersion: arp.rowVersion } }),
    onSuccess: () => { refresh(); setTo(null); toast({ tone: 'success', message: 'Situação da ata atualizada' }); },
    onError: (e) => { setTo(null); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const text: Record<string, string> = {
    vigente: 'Ao tornar vigente, os itens, quantidades, preços e participantes ficam fixos. Mudanças depois só por operação formal com documento.',
    encerrada: 'A ata encerrada não aceita novas oportunidades, adesões nem operações. O histórico fica disponível.',
    cancelada: 'A ata cancelada sai do painel e não aceita novas movimentações.',
  };
  return (
    <>
      {arp.status === 'rascunho' && arp.can.manage && <Button variant="primary" onClick={() => setTo('vigente')}>Tornar vigente</Button>}
      {arp.status === 'vigente' && arp.can.effect && <Button variant="secondary" onClick={() => setTo('encerrada')}>Encerrar ata</Button>}
      {(arp.status === 'rascunho' || arp.status === 'vigente') && arp.can.effect && <Button variant="ghost" onClick={() => setTo('cancelada')}>Cancelar ata</Button>}
      <ConfirmDialog open={!!to} title={to === 'vigente' ? 'Tornar a ata vigente?' : to === 'encerrada' ? 'Encerrar a ata?' : 'Cancelar a ata?'} confirmLabel={to === 'vigente' ? 'Tornar vigente' : to === 'encerrada' ? 'Encerrar' : 'Cancelar ata'} tone={to === 'vigente' ? 'primary' : 'danger'} loading={m.isPending} onConfirm={() => m.mutate()} onCancel={() => setTo(null)}>
        <p className="text-sm">{to ? text[to] : ''}</p>
      </ConfirmDialog>
    </>
  );
}

export function ArpDetailPage() {
  const { id = '' } = useParams();
  const q = useArp(id);
  const refresh = useArpRefresh(id);
  const [f, setF] = useUrlState({ t: 'itens', importar: '' });
  const tab = (TABS.some((t) => t.key === f.t) ? f.t : 'itens') as Tab;
  const [editing, setEditing] = useState(false);
  const tvRef = useRef<HTMLDivElement>(null);
  const tv = useTvMode(tvRef);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data!;
  const manager = a.agencies.find((g) => g.kind === 'gerenciador');
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Gestão de Contratos', to: '/contracts?t=atas' }, { label: 'Atas de registro de preços', to: '/contracts?t=atas' }, { label: `Ata ${a.number}` }]} />
      <PageHeader
        icon={<ScrollText className="h-9 w-9" strokeWidth={2.2} />}
        title={`Ata ${a.number}`}
        subtitle={a.object}
        actions={<><MoneyToggle /><TvButton onClick={() => void tv.enter()} />{a.can.manage && a.status !== 'encerrada' && a.status !== 'cancelada' && <Button variant="secondary" onClick={() => setEditing(true)}>Editar dados</Button>}<StatusAction arp={a} /></>}
      />
      <section className="card mb-4 grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm md:grid-cols-3 xl:grid-cols-6">
        <div><p className="text-xs text-muted">Situação</p><div className="mt-1"><ArpStatusChip status={a.status} /></div></div>
        <div><p className="text-xs text-muted">Vigência</p><p className="num mt-1 font-semibold text-ink">{a.startAt ? `${fmtDate(a.startAt)} a ${fmtDate(a.endAt)}` : 'Não informada'}</p></div>
        <div><p className="text-xs text-muted">Gerenciador</p><p className="mt-1 font-semibold text-ink">{manager?.name ?? '—'}</p></div>
        <div><p className="text-xs text-muted">Fornecedor</p><p className="mt-1 font-semibold text-ink">{a.supplierName}</p></div>
        <div><p className="text-xs text-muted">Regime</p><p className="mt-1 font-semibold text-ink">{ARP_REGIME_LABELS[a.regime].split(' (')[0]}</p><p className="text-xs text-muted">{a.rules.version ? `regras v${a.rules.version}` : 'regras padrão'}</p></div>
        <div><p className="text-xs text-muted">Processo</p><p className="mt-1 font-semibold text-ink">{a.processNumber ?? '—'}</p></div>
      </section>
      {!!a.alerts.length && (
        <ul className="mb-4 space-y-2" aria-label="Alertas da ata">
          {a.alerts.map((x, i) => <li key={i} className={x.level === 'alta' ? 'flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-ink' : 'flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-ink'}><AlertTriangle className={x.level === 'alta' ? 'mt-0.5 h-4 w-4 shrink-0 text-danger' : 'mt-0.5 h-4 w-4 shrink-0 text-[#C2610C]'} aria-hidden />{x.text}</li>)}
        </ul>
      )}
      {!!a.contracts.length && (
        <p className="mb-4 text-sm text-muted">Contratos decorrentes: {a.contracts.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link className="font-semibold text-primary hover:underline" to={`/contracts/${c.id}`}>{c.number}</Link></span>)}</p>
      )}
      <TvArea innerRef={tvRef} active={tv.active} fallback={tv.fallback}>
        {tv.active && <TvBar title={`Ata ${a.number}`} period={new Date().toLocaleDateString('pt-BR')} tabs={TABS.filter((t) => ['itens', 'oportunidades', 'orgaos', 'relatorios'].includes(t.key))} tab={tab} onTab={(t) => setF({ t })} onExit={tv.exit} queryKeys={[['arp', id]]} />}
        <Tabs<Tab> label="Áreas da ata" className="mb-5" value={tab} onChange={(t) => setF({ t })} tabs={TABS} />
        {tab === 'itens' && <ItemsPanel arp={a} onImport={() => setF({ importar: '1' })} />}
        {tab === 'oportunidades' && <OpportunitiesPanel arp={a} />}
        {tab === 'orgaos' && <AdhesionsPanel arp={a} />}
        {tab === 'movimentacoes' && <LedgerPanel arp={a} />}
        {tab === 'operacoes' && <OperationsPanel arp={a} />}
        {tab === 'documentos' && <DocsPanel arp={a} />}
        {tab === 'relatorios' && <ArpReports arpId={a.id} items={a.items} agencies={a.agencies} />}
        {tab === 'historico' && <HistoryPanel arp={a} />}
        {tab === 'projetos' && <WorkLinks prefill={{ arpId: a.id, label: `Ata ${a.number}`, kind: 'contrato_publico', name: `Execução da ata ${a.number}` }} />}
      </TvArea>
      {a.can.manage && <ImportWizard arpId={a.id} status={a.status} open={f.importar === '1'} onClose={() => setF({ importar: '' })} onDone={refresh} />}
      {editing && <EditArp arp={a} open onClose={() => setEditing(false)} />}
    </div>
  );
}
