/** Configurações → Contratos: prazos dos alertas, e-mails, assuntos e modelo institucional do ofício. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type S = {
  renewalAlertDays: number; closureNoticeDays: number; closureFinalDays: number; guaranteeAlertDays: number; adjustmentAlertDays: number;
  provisioningSlaDays: number; implantationSlaDays: number; signatureSlaDays: number;
  ccEmail: string; financeEmail: string | null; deliveryEmail: string | null; renewalSubject: string; closureSubject: string; oficioTemplate: string; oficioTemplateId: string | null;
};
const DAYS: [keyof S, string, string][] = [
  ['renewalAlertDays', 'Alerta de renovação (dias antes do término)', 'Abre a renovação e cria tarefas para Inteligência Comercial.'],
  ['closureNoticeDays', 'Primeiro aviso de encerramento (dias)', 'E-mail para Comercial e Financeiro.'],
  ['closureFinalDays', 'Segundo aviso de encerramento (dias)', 'Validação com Sucesso do Cliente e tarefas de desmobilização e faturamento final.'],
  ['guaranteeAlertDays', 'Vencimento da garantia (dias antes)', ''],
  ['adjustmentAlertDays', 'Reajuste (dias antes da data-base)', ''],
  ['provisioningSlaDays', 'Prazo do provisionamento (dias)', 'Depois disso, o Financeiro recebe alerta.'],
  ['implantationSlaDays', 'Prazo da implantação (dias)', 'Até a ativação técnica.'],
  ['signatureSlaDays', 'Prazo das assinaturas (dias)', ''],
];
const VARS = ['cidade', 'data_extenso', 'oficio_numero', 'cliente.nome', 'cliente.documento', 'cliente.endereco', 'contrato.numero', 'contrato.objeto', 'contrato.inicio', 'contrato.termino', 'contrato.valor_mensal', 'contrato.valor_global', 'contrato.orgao', 'contrato.processo', 'renovacao.meses', 'responsavel.nome', 'empresa.nome'];

export function AdminContractSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'contract-settings'], queryFn: () => api<S>('/admin/contract-settings') });
  const tpls = useQuery({ queryKey: ['admin', 'proposal-templates', 'contrato'], queryFn: () => api<{ items: { id: string; name: string }[] }>('/admin/proposal-templates?purpose=contrato') });
  const [f, setF] = useState<S | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data); }, [q.data, f]);
  const save = useMutation({ mutationFn: () => api('/admin/contract-settings', { method: 'PUT', body: { ...f, financeEmail: f!.financeEmail || null, deliveryEmail: f!.deliveryEmail || null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'contract-settings'] }); toast({ tone: 'success', message: 'Parâmetros de contratos salvos' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!f) return <div className="card"><LoadingRows /></div>;
  const set = (p: Partial<S>) => setF({ ...f, ...p });
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Contratos</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">Prazos dos alertas automáticos, destinatários e textos. Quem recebe as tarefas de cada etapa sai dos <Link className="link" to="/settings/users">setores dos usuários</Link> (Comercial, Inteligência Comercial, Financeiro, Jurídico, Sucesso do Cliente, Diretoria, Administração e Implantação).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {DAYS.map(([k, label, hint]) => <FormField key={k} label={label} htmlFor={`cs-${k}`} hint={hint || undefined}><Input id={`cs-${k}`} inputMode="numeric" value={String(f[k])} onChange={(e) => set({ [k]: Number(e.target.value.replace(/\D/g, '')) || 0 } as Partial<S>)} /></FormField>)}
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-md font-bold text-ink">E-mails</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormField label="Cópia dos ofícios" htmlFor="cs-cc"><Input id="cs-cc" type="email" value={f.ccEmail} onChange={(e) => set({ ccEmail: e.target.value })} /></FormField>
          <FormField label="E-mail do Financeiro" htmlFor="cs-fin" hint="Em branco: usuários do setor Financeiro."><Input id="cs-fin" type="email" value={f.financeEmail ?? ''} onChange={(e) => set({ financeEmail: e.target.value })} /></FormField>
          <FormField label="E-mail da implantação e entrega" htmlFor="cs-del" hint="Em branco: usuários do setor Implantação."><Input id="cs-del" type="email" value={f.deliveryEmail ?? ''} onChange={(e) => set({ deliveryEmail: e.target.value })} /></FormField>
          <FormField label="Assunto do ofício de renovação" htmlFor="cs-rs" className="md:col-span-3" hint="[Nº] e [Nome] viram o número do contrato e o cliente."><Input id="cs-rs" value={f.renewalSubject} onChange={(e) => set({ renewalSubject: e.target.value })} /></FormField>
          <FormField label="Assunto do aviso de encerramento" htmlFor="cs-cs" className="md:col-span-3"><Input id="cs-cs" value={f.closureSubject} onChange={(e) => set({ closureSubject: e.target.value })} /></FormField>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-1 text-md font-bold text-ink">Ofício de renovação</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">Texto do ofício com variáveis. Para usar o papel timbrado institucional, crie um modelo em <Link className="link" to="/settings/contract-templates">Modelos de contrato</Link> com a arte e um campo {'{{oficio.corpo}}'} e escolha abaixo.</p>
        <FormField label="Modelo institucional (papel timbrado)" htmlFor="cs-tpl" className="mb-3 max-w-md">
          <Select id="cs-tpl" value={f.oficioTemplateId ?? ''} onChange={(e) => set({ oficioTemplateId: e.target.value || null })}><option value="">Sem arte (PDF simples com o nome da empresa)</option>{tpls.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        </FormField>
        <FormField label="Texto do ofício" htmlFor="cs-of"><Textarea id="cs-of" className="min-h-[320px] font-mono text-sm" value={f.oficioTemplate} onChange={(e) => set({ oficioTemplate: e.target.value })} /></FormField>
        <p className="mt-2 text-xs text-muted">Variáveis: {VARS.map((v) => `{{${v}}}`).join(' ')}</p>
      </section>
      <Notice>A integração automática com o ERP não está configurada: as etapas de ERP viram tarefas e pedem o código informado por uma pessoa.</Notice>
      <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar parâmetros</Button></div>
    </div>
  );
}
