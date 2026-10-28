/** Configurações → Módulos e liberação → Contratos: abas por perfil, Painel, prazos dos alertas, e-mails, assuntos e modelo institucional do ofício. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  CONTRACT_TABS, CONTRACT_TAB_LABELS, DASHBOARD_SECTION_LABELS, PROFILE_KEYS, PROFILE_LABELS,
  type ContractTab, type ContractTabAccess, type DashboardConfig,
} from '@isp/domain';
import { api } from '../../lib/api';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type S = {
  renewalAlertDays: number; closureNoticeDays: number; closureFinalDays: number; guaranteeAlertDays: number; adjustmentAlertDays: number;
  provisioningSlaDays: number; implantationSlaDays: number; signatureSlaDays: number;
  ccEmail: string; financeEmail: string | null; deliveryEmail: string | null; renewalSubject: string; closureSubject: string; oficioTemplate: string; oficioTemplateId: string | null; dailyDigest: boolean;
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
      <ContractViewSettings />
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
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={f.dailyDigest !== false} onChange={(e) => set({ dailyDigest: e.target.checked })} /><span><b className="text-ink">Resumo diário da central de atenção</b><span className="block text-muted">Todo dia cedo, cada pessoa recebe por e-mail o que está com ela; Inteligência Comercial, Diretoria e Administração recebem o resumo da carteira inteira.</span></span></label>
      </section>
      <section className="card p-5">
        <h2 className="mb-1 text-md font-bold text-ink">Ofício de renovação</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">Texto do ofício com variáveis. Para usar o papel timbrado institucional, crie um modelo em <Link className="link" to="/settings/modelos?aba=contratos">Modelos de contrato</Link> com a arte e um campo {'{{oficio.corpo}}'} e escolha abaixo.</p>
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

type View = { tabAccess: ContractTabAccess; dashboard: DashboardConfig };

/** Cada aba da Gestão de Contratos é uma permissão por perfil; e a ordem e as seções do Painel. Salvos juntos, com auditoria. */
function ContractViewSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'contract-view'], queryFn: () => api<View>('/admin/contract-view') });
  const [v, setV] = useState<View | null>(null);
  useEffect(() => { if (q.data && !v) setV(q.data); }, [q.data, v]);
  const save = useMutation({
    mutationFn: () => api<View>('/admin/contract-view', { method: 'PUT', body: v }),
    onSuccess: (r) => { setV(r); qc.setQueryData(['admin', 'contract-view'], r); void qc.invalidateQueries({ queryKey: ['contracts', 'view'] }); toast({ tone: 'success', message: 'Abas e painel salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!v) return <div className="card"><LoadingRows rows={4} /></div>;
  const denied = (p: string) => v.tabAccess[p] ?? [];
  const toggleTab = (p: string, t: ContractTab, on: boolean) => setV({ ...v, tabAccess: { ...v.tabAccess, [p]: on ? denied(p).filter((x) => x !== t) : [...denied(p), t] } });
  const dash = v.dashboard;
  const setDash = (p: Partial<DashboardConfig>) => setV({ ...v, dashboard: { ...dash, ...p } });
  const move = (i: number, by: -1 | 1) => { const o = [...dash.order]; [o[i], o[i + by]] = [o[i + by]!, o[i]!]; setDash({ order: o }); };
  const changed = JSON.stringify(v) !== JSON.stringify(q.data);
  const saveBar = (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
      {changed && <span className="mr-auto text-sm font-semibold text-[#C2610C]">Alterações não salvas</span>}
      {changed && <Button onClick={() => setV(q.data!)}>Desfazer</Button>}
      <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Salvar abas e painel</Button>
    </div>
  );
  return (
    <>
      <section className="card p-5" aria-label="Abas por perfil">
        <h2 className="text-lg font-bold text-ink">Abas da Gestão de Contratos por perfil</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">Cada aba é uma permissão. Quem tem mais de um perfil vê a aba se qualquer um deles liberar. Vale para todos os perfis, inclusive a administração; aba desmarcada some do menu e da tela. O Painel, a Central de atenção e os Relatórios também recusam os dados na API para quem não tem a aba.</p>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-3 font-semibold">Aba</th>{PROFILE_KEYS.map((p) => <th key={p} className="px-2 py-2 text-center font-semibold">{PROFILE_LABELS[p]}</th>)}</tr></thead>
            <tbody>{CONTRACT_TABS.map((t) => (
              <tr key={t} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 text-ink">{CONTRACT_TAB_LABELS[t]}</td>
                {PROFILE_KEYS.map((p) => <td key={p} className="px-2 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${CONTRACT_TAB_LABELS[t]} para ${PROFILE_LABELS[p]}`} checked={!denied(p).includes(t)} onChange={(e) => toggleTab(p, t, e.target.checked)} /></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
        {saveBar}
      </section>
      <section className="card p-5" aria-label="Configuração do painel">
        <h2 className="text-lg font-bold text-ink">Painel</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">Ordem e seções do Painel de contratos para toda a empresa. Desmarque para esconder; use as setas para mudar a posição.</p>
        <ol className="divide-y divide-line rounded-md border border-line">{dash.order.map((k, i) => (
          <li key={k} className="flex items-center gap-3 px-3 py-2">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" aria-label={`Mostrar ${DASHBOARD_SECTION_LABELS[k]}`} checked={!dash.hidden.includes(k)} onChange={(e) => setDash({ hidden: e.target.checked ? dash.hidden.filter((x) => x !== k) : [...dash.hidden, k] })} />
            <span className={`min-w-0 flex-1 text-sm ${dash.hidden.includes(k) ? 'text-muted line-through' : 'text-ink'}`}>{DASHBOARD_SECTION_LABELS[k]}</span>
            <Button size="sm" variant="ghost" aria-label={`Subir ${DASHBOARD_SECTION_LABELS[k]}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label={`Descer ${DASHBOARD_SECTION_LABELS[k]}`} disabled={i === dash.order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
          </li>
        ))}</ol>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={dash.compactValues} onChange={(e) => setDash({ compactValues: e.target.checked })} /><span><b className="text-ink">Valores resumidos nos cartões</b><span className="block text-muted">A partir de R$ 10 mil, o valor aparece em mil, mi ou bi (R$ 151,1 mil · R$ 1,77 mi). O valor completo aparece ao passar o mouse.</span></span></label>
        {saveBar}
      </section>
    </>
  );
}
