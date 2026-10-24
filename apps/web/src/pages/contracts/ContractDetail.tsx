/** Ficha individual do contrato. */
import { useAuth } from '../../auth/AuthProvider';
import { WorkLinks } from '../../features/tasks/WorkLinks';
import { EntityPeoplePanel } from '../../features/abm/EntityPeoplePanel';
import { useState } from 'react';
import { ContractJourney } from '../../features/cs/ContractJourney';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSignature, Pencil } from 'lucide-react';
import { CONTRACT_STAGES, CONTRACT_STAGE_LABELS, LEGAL_REGIME_LABELS, type ContractStage } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Breadcrumb, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { ContractForm, formFrom, payloadOf, type FormState } from '../../features/contracts/ContractForm';
import { ProcessPanel } from '../../features/contracts/ProcessPanel';
import { LedgerPanel } from '../../features/contracts/LedgerPanel';
import { ConsumptionPanel } from '../../features/contracts/ConsumptionPanel';
import { AmendmentsPanel } from '../../features/contracts/AmendmentsPanel';
import { ExecutionPanel } from '../../features/contracts/ExecutionPanel';
import { GenerateModal, SignModal } from '../../features/contracts/SignaturePanels';
import { AlertsPanel, DocumentsPanel, TimelinePanel, UploadModal, VersionsPanel } from '../../features/contracts/ContractPanels';
import { DaysLeft, KIND_LABEL, PendBadge, StageChip, TypeChip, errMsg, type ContractDetail } from '../../features/contracts/shared';

type Tab = 'resumo' | 'execucao' | 'aditivos' | 'consumo' | 'extrato' | 'processos' | 'documentos' | 'versoes' | 'notificacoes' | 'projetos' | 'pessoas' | 'historico';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-sm text-muted">{label}</dt><dd className="text-ink">{children}</dd></div>;
}

function EditDrawer({ c, onClose }: { c: ContractDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => formFrom(c, c.current));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => { const p = payloadOf(f); return api<{ version: number }>(`/contracts/${c.id}`, { method: 'PUT', body: { ...p.header, version: p.version, reason: f.reason || undefined } }); },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); toast({ tone: 'success', message: r.version !== c.currentVersion ? `Salvo como versão ${r.version}` : 'Salvo' }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Drawer open onClose={onClose} title={`Editar contrato ${c.current.number}`} width="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Salvar</Button></>}>
      {error && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <ContractForm value={f} onChange={(p) => setF((x) => ({ ...x, ...p }))} editing validated={!!c.validatedAt} />
    </Drawer>
  );
}

function ValidateModal({ c, open, onClose }: { c: ContractDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<null | { provisioning: { emails: { to: string; status: string }[]; tasks: number }; delivery: { emails: { to: string; status: string }[]; tasks: number }; erp: { tasks: number } }>(null);
  const [error, setError] = useState<string | null>(null);
  const v = useMutation({ mutationFn: () => api<NonNullable<typeof result>>(`/contracts/${c.id}/validate`, { method: 'POST' }), onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['contract', c.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); }, onError: (e) => setError(errMsg(e)) });
  const mails = (list: { to: string; status: string }[]) => (list.length ? list.map((m) => `${m.to} (${m.status === 'enviado' ? 'enviado' : m.status === 'nao_configurado' ? 'não enviado: SMTP não configurado' : 'falhou'})`).join(', ') : 'nenhum destinatário — configure em Configurações → Contratos ou os setores dos usuários');
  return (
    <Modal open={open} onClose={onClose} title="Validar cadastro" size="md" footer={result ? <Button variant="primary" onClick={onClose}>Ver o contrato</Button> : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={v.isPending} onClick={() => { setError(null); v.mutate(); }}>Validar e iniciar implantação</Button></>}>
      {error && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!result ? (
        <div className="space-y-2 text-sm text-text">
          <p>Ao validar:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>abre a implantação e cria a tarefa de cadastro no ERP (a integração automática com o ERP ainda não está configurada);</li>
            <li>pede ao Financeiro o provisionamento do faturamento, por tarefa e e-mail;</li>
            <li>avisa o time de implantação e entrega;</li>
            <li>registra tudo no histórico da negociação e passa a oportunidade para Sucesso do Cliente.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="h-5 w-5" />Cadastro validado</p>
          <p><strong>ERP:</strong> {result.erp.tasks} tarefa(s) de cadastro criada(s). Registre o código na etapa da implantação.</p>
          <p><strong>Financeiro:</strong> {result.provisioning.tasks} tarefa(s). E-mails: {mails(result.provisioning.emails)}.</p>
          <p><strong>Implantação:</strong> {result.delivery.tasks} tarefa(s). E-mails: {mails(result.delivery.emails)}.</p>
        </div>
      )}
    </Modal>
  );
}

function MoveModal({ c, open, onClose }: { c: ContractDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [stage, setStage] = useState<ContractStage>(c.stage);
  const [reason, setReason] = useState('');
  const [closureAt, setClosureAt] = useState(c.current.endAt ?? '');
  const m = useMutation({ mutationFn: () => api(`/contracts/${c.id}/stage`, { method: 'POST', body: { stage, reason: reason || undefined, closureAt: stage === 'encerramento' ? closureAt || undefined : undefined } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); toast({ tone: 'success', message: `Contrato em ${CONTRACT_STAGE_LABELS[stage]}` }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const options = CONTRACT_STAGES.filter((s) => s !== 'cadastro_validacao' && s !== 'arquivado');
  return (
    <Modal open={open} onClose={onClose} title="Mover no funil" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={stage === c.stage || (stage === 'encerramento' && reason.trim().length < 3)} onClick={() => m.mutate()}>Mover</Button></>}>
      <div className="space-y-3">
        <FormField label="Etapa" htmlFor="mv-stage"><Select id="mv-stage" value={stage} onChange={(e) => setStage(e.target.value as ContractStage)}>{options.map((s) => <option key={s} value={s}>{CONTRACT_STAGE_LABELS[s]}</option>)}</Select></FormField>
        {['renovacao', 'reajuste', 'encerramento'].includes(stage) && <p className="text-sm text-muted">Abre o processo de {CONTRACT_STAGE_LABELS[stage].toLowerCase()} com o roteiro de etapas.</p>}
        {stage === 'encerramento' && <FormField label="Data prevista do encerramento" htmlFor="mv-at"><Input id="mv-at" type="date" value={closureAt} onChange={(e) => setClosureAt(e.target.value)} /></FormField>}
        <FormField label="Motivo" htmlFor="mv-reason" required={stage === 'encerramento'}><Textarea id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        <p className="text-xs text-muted">Arquivar acontece só ao concluir o encerramento, com as validações.</p>
      </div>
    </Modal>
  );
}

export function ContractDetailPage() {
  const { id = '' } = useParams();
  const { can, feature } = useAuth();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('aba') as Tab | null) ?? 'resumo');
  const [edit, setEdit] = useState(false);
  const [validate, setValidate] = useState(false);
  const [move, setMove] = useState(false);
  const [generate, setGenerate] = useState(false);
  const [sign, setSign] = useState<{ id: string; name: string } | null>(null);
  const [upload, setUpload] = useState<null | { category?: string; processId?: string; newVersionOf?: Parameters<typeof UploadModal>[0]['newVersionOf'] }>(null);
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api<ContractDetail>(`/contracts/${id}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const v = c.current;
  const openProcs = c.processes.filter((p) => p.status === 'aberto');
  const openAlerts = c.alerts.filter((a) => a.status === 'aberto');
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Gestão de Contratos', to: '/contracts' }, { label: `${v.number} · ${c.contact.name}` }]} />
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="num text-sm text-muted">CT-{c.code} · versão {c.currentVersion}</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Contrato {v.number}</h1>
          <p className="text-md text-text"><Link to={`/customers/${c.contactId}`} className="link font-semibold">{c.contact.name}</Link>{c.contact.document ? ` · ${c.contact.document}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StageChip stage={c.stage} />
            <TypeChip type={c.billingType} />
            <Chip tone={c.kind === 'publico' ? 'purple' : 'neutral'}>{KIND_LABEL[c.kind]}{c.kind === 'publico' ? ` · ${LEGAL_REGIME_LABELS[c.legalRegime]}` : ''}</Chip>
            {c.renewed && <Chip tone="green">Contrato Renovado</Chip>}
            {c.closureExpected && c.stage !== 'arquivado' && <Chip tone="red">Encerramento previsto {fmtDate(c.closureAt)}</Chip>}
            {openProcs.map((p) => <Chip key={p.id} tone="blue">{p.kind === 'implantacao' ? 'Implantação' : p.kind === 'renovacao' ? 'Renovação' : p.kind === 'reajuste' ? 'Reajuste' : 'Encerramento'} em andamento</Chip>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.permissions.validate && <Button variant="primary" icon={<FileSignature className="h-4 w-4" />} onClick={() => setValidate(true)}>Validar cadastro</Button>}
          {c.permissions.edit && c.stage !== 'arquivado' && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Editar</Button>}
          {c.permissions.edit && c.validatedAt && c.stage !== 'arquivado' && <Button onClick={() => setMove(true)}>Mover no funil</Button>}
        </div>
      </header>

      <section aria-label="Situação" className="card mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Info label="Vigência">{fmtDate(v.startAt)} a {fmtDate(v.endAt)}</Info>
        <Info label="Dias restantes"><DaysLeft days={c.daysLeft} archived={c.stage === 'arquivado'} /></Info>
        <Info label={c.billingType === 'medicao' ? 'Saldo contratado' : c.billingType === 'frequente' ? 'Valor mensal estimado' : 'Valor mensal'}><span className="num font-semibold">{c.billingType === 'medicao' ? fmtBRL(v.totalCents) : fmtBRL(v.monthlyCents)}</span></Info>
        <Info label="Responsável">{c.commercialOwnerName ?? '—'}</Info>
        <Info label="Pendências"><PendBadge p={c.pendencies} /></Info>
        <Info label="Próxima ação">{c.nextAction ?? '—'}{c.nextActionAt ? <span className="block text-xs text-muted">{fmtDate(c.nextActionAt)}</span> : null}</Info>
      </section>

      {c.stage === 'cadastro_validacao' && <div className="mb-4"><Notice tone="warning">Cadastro aguardando validação. Confira os dados; a validação inicia ERP, provisionamento, implantação e o pós-venda.</Notice></div>}
      {c.stage === 'arquivado' && <div className="mb-4"><Notice>Encerrado em {fmtDateTime(c.closedAt)}. Arquivo: {c.archiveLocation} · responsável {c.archiveResponsibleName ?? '—'}. Nota final: {c.finalNote}</Notice></div>}

      <div className="card">
        <div className="px-5 pt-2">
          <Tabs<Tab> label="Ficha do contrato" value={tab} onChange={setTab} tabs={[
            { key: 'resumo', label: 'Resumo' },
            ...(c.billingType === 'medicao' || c.kind === 'publico' ? [{ key: 'consumo' as Tab, label: c.billingType === 'medicao' ? (c.kind === 'publico' ? 'Consumo e empenho' : 'Consumo') : 'Empenhos' }] : []),
            ...(c.billingType !== 'recorrente' ? [{ key: 'extrato' as Tab, label: c.billingType === 'medicao' ? 'Saldo e consumo' : 'Lançamentos' }] : []),
            ...(c.stage !== 'cadastro_validacao' ? [{ key: 'execucao' as Tab, label: 'Execução' }, { key: 'aditivos' as Tab, label: 'Aditivos' }] : []),
            { key: 'processos', label: 'Processos', count: openProcs.length },
            { key: 'documentos', label: 'Documentos' },
            { key: 'versoes', label: 'Versões', count: c.versions.length },
            { key: 'notificacoes', label: 'Notificações', count: openAlerts.length },
            ...(can('projetos') ? [{ key: 'projetos' as Tab, label: 'Tarefas e projetos' }] : []),
            ...(feature('marketing.abm') ? [{ key: 'pessoas' as Tab, label: 'Pessoas e ABM' }] : []),
            { key: 'historico', label: 'Linha do tempo' },
          ]} />
        </div>
        <div className="p-5" role="tabpanel">
          {tab === 'resumo' && (
            <div className="space-y-6">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Objeto"><span className="whitespace-pre-line">{v.object}</span></Info>
                <Info label="Assinatura">{fmtDate(v.signedAt)}</Info>
                <Info label="Ativação técnica">{v.activationAt ? fmtDate(v.activationAt) : <span className="text-[#C2610C]">Pendente</span>}</Info>
                <Info label="Início do faturamento">{v.billingStartAt ? fmtDate(v.billingStartAt) : <span className="text-[#C2610C]">Pendente</span>}</Info>
                <Info label="Prazo">{v.termMonths ? `${v.termMonths} meses` : '—'}</Info>
                <Info label="Renovação prevista">{fmtDate(v.renewalAt)}</Info>
                <Info label="Valor global">{fmtBRL(v.totalCents)}</Info>
                <Info label="Faturamento">{v.billingDay ? `Dia ${v.billingDay}` : '—'}{v.billingTerms ? <span className="block text-sm text-muted">{v.billingTerms}</span> : null}</Info>
                <Info label="Reajuste">{v.adjustmentIndex ?? '—'}{v.adjustmentBaseDate ? ` · data-base ${fmtDate(v.adjustmentBaseDate)}` : ''}{v.adjustmentRule ? <span className="block text-sm text-muted">{v.adjustmentRule}</span> : null}</Info>
                <Info label="Responsável operacional">{c.operationalOwnerName ?? '—'}</Info>
                <Info label="Sucesso do Cliente">{c.csmName ?? '—'}{c.validatedAt && <span className="block"><ContractJourney contractId={c.id} /></span>}</Info>
                <Info label="ERP">{c.erpRef ?? <span className="text-[#C2610C]">Cadastro pendente</span>}</Info>
                {c.kind === 'publico' && <Info label="Órgão / processo">{v.publicTerms?.agency ?? '—'}{v.publicTerms?.processNumber ? ` · ${v.publicTerms.processNumber}` : ''}{v.publicTerms?.modality ? <span className="block text-sm text-muted">{v.publicTerms.modality}{v.publicTerms.commitmentNote ? ` · empenho ${v.publicTerms.commitmentNote}` : ''}</span> : null}</Info>}
                {c.kind === 'publico' && <Info label="Limite total de vigência">{c.legalLimitAt ? fmtDate(c.legalLimitAt) : 'Não informado'}</Info>}
                <Info label="Garantia">{v.guarantee ? `${v.guarantee.type}${v.guarantee.amountCents ? ` · ${fmtBRL(v.guarantee.amountCents)}` : ''}${v.guarantee.expiresAt ? ` · vence ${fmtDate(v.guarantee.expiresAt)}` : ''}` : 'Sem garantia'}</Info>
                <Info label="Oportunidade de origem">{c.opportunity ? <Link className="link" to={`/opportunities/${c.opportunity.id}`}>OP-{c.opportunity.code}{c.opportunity.handoffStage === 'sucesso_cliente' ? ' · Sucesso do Cliente' : ''}</Link> : '—'}</Info>
                <Info label="Validado">{c.validatedAt ? `${fmtDateTime(c.validatedAt)} · ${c.validatedByName ?? ''}` : 'Ainda não'}</Info>
              </dl>
              <div>
                <h2 className="mb-2 font-bold text-ink">Produtos e serviços</h2>
                {!v.items.length ? <p className="text-sm text-muted">Nenhum item.</p> : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Qtd.</th><th className="px-3 py-2 text-right font-medium">Unitário</th><th className="px-3 py-2 text-right font-medium">Total/mês</th></tr></thead>
                    <tbody>{v.items.map((i, k) => <tr key={k} className="border-t border-line"><td className="px-3 py-2 text-ink">{i.description}</td><td className="num px-3 py-2 text-right">{i.qty}</td><td className="num px-3 py-2 text-right">{fmtBRL(i.unitCents)}</td><td className="num px-3 py-2 text-right font-semibold">{fmtBRL(i.qty * i.unitCents)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              {v.specialConditions && <div><h2 className="mb-1 font-bold text-ink">Condições específicas</h2><p className="whitespace-pre-line text-sm text-text">{v.specialConditions}</p></div>}
              <div><h2 className="mb-1 font-bold text-ink">Cliente</h2><p className="text-sm text-text">{c.contact.name}{c.contact.email ? ` · ${c.contact.email}` : ''}{c.contact.phone ? ` · ${c.contact.phone}` : ''}{c.address ? ` · ${[c.address.street, c.address.number, c.address.district, c.address.city, c.address.state].filter(Boolean).join(', ')}` : ''}</p><p className="text-xs text-muted">Dados do cadastro do cliente no CRM (não são copiados para o contrato).</p></div>
            </div>
          )}
          {tab === 'processos' && (
            <div className="space-y-4">
              {!c.processes.length ? <EmptyState title="Nenhum processo" description={c.validatedAt ? 'Renovação, reajuste e encerramento abrem pelos alertas automáticos ou pelo botão Mover no funil.' : 'A implantação abre na validação do cadastro.'} /> : c.processes.map((p) => <ProcessPanel key={p.id} c={c} p={p} onUpload={(category, processId) => setUpload({ category, processId })} />)}
            </div>
          )}
          {tab === 'consumo' && <ConsumptionPanel c={c} />}
          {tab === 'aditivos' && <AmendmentsPanel c={c} />}
          {tab === 'execucao' && <ExecutionPanel c={c} />}
          {tab === 'extrato' && <LedgerPanel c={c} />}
          {tab === 'documentos' && <DocumentsPanel c={c} onUpload={(o) => setUpload({ newVersionOf: o.newVersionOf })} onGenerate={() => setGenerate(true)} onSign={setSign} />}
          {tab === 'versoes' && <VersionsPanel c={c} />}
          {tab === 'notificacoes' && <AlertsPanel c={c} />}
          {tab === 'historico' && <TimelinePanel c={c} />}
          {tab === 'pessoas' && <EntityPeoplePanel entity="contrato" entityId={c.id} compact />}
          {tab === 'projetos' && <WorkLinks prefill={{ contractId: c.id, contactId: c.contactId, label: `CT-${c.code} · ${c.contact.name}`, kind: 'implantacao', name: `Implantação ${c.contact.name}` }} />}
        </div>
      </div>
      {edit && <EditDrawer c={c} onClose={() => setEdit(false)} />}
      <ValidateModal c={c} open={validate} onClose={() => setValidate(false)} />
      {move && <MoveModal c={c} open onClose={() => setMove(false)} />}
      {generate && <GenerateModal c={c} open onClose={() => setGenerate(false)} />}
      {sign && <SignModal c={c} doc={sign} open onClose={() => setSign(null)} />}
      {upload && <UploadModal c={c} open onClose={() => setUpload(null)} category={upload.category} processId={upload.processId} newVersionOf={upload.newVersionOf ?? null} />}
    </div>
  );
}
