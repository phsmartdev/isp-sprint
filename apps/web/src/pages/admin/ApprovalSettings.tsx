/** Configurações → Aprovações e alçadas: limite de desconto por alçada, opções da classificação e aviso por WhatsApp/e-mail. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPROVAL_LEVELS, APPROVAL_LEVEL_LABELS, CLASSIFICATION_DIMENSIONS, CLASSIFICATION_LABELS, DEFAULT_APPROVAL_TEMPLATE, type ApprovalLevel, type ClassificationDimension } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, ErrorState, FormField, Input, LoadingRows, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type S = {
  policy: { limits: { level: ApprovalLevel; maxDiscountBp: number; minMarginBp: number | null }[] };
  classificationOptions: Record<ClassificationDimension, string[]>;
  notifyEmail: boolean; notifyWhatsapp: boolean; notifyShowClass: boolean; template: string;
};
type Form = { limits: Record<ApprovalLevel, { max: string; min: string }>; options: Record<ClassificationDimension, string>; notifyEmail: boolean; notifyWhatsapp: boolean; notifyShowClass: boolean; template: string };

const pctText = (bp: number | null) => (bp === null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const toBp = (t: string) => { const v = Number(t.replace(',', '.')); return t.trim() === '' || Number.isNaN(v) ? null : Math.round(v * 100); };
const VARS = ['cliente', 'oportunidade', 'responsavel', 'tipo', 'classe', 'classe_linha', 'valor', 'justificativa', 'link'];

export function AdminApprovalSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'approval-settings'], queryFn: () => api<S>('/admin/approval-settings') });
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => {
    if (!q.data || f) return;
    const d = q.data;
    setF({
      limits: Object.fromEntries(APPROVAL_LEVELS.map((l) => { const x = d.policy.limits.find((y) => y.level === l); return [l, { max: pctText(x?.maxDiscountBp ?? 0), min: pctText(x?.minMarginBp ?? null) }]; })) as Form['limits'],
      options: Object.fromEntries(CLASSIFICATION_DIMENSIONS.map((k) => [k, d.classificationOptions[k].join('\n')])) as Form['options'],
      notifyEmail: d.notifyEmail, notifyWhatsapp: d.notifyWhatsapp, notifyShowClass: d.notifyShowClass, template: d.template,
    });
  }, [q.data, f]);
  const save = useMutation({
    mutationFn: () => api<S>('/admin/approval-settings', {
      method: 'PUT',
      body: {
        policy: { limits: APPROVAL_LEVELS.map((l) => ({ level: l, maxDiscountBp: toBp(f!.limits[l].max) ?? 0, minMarginBp: toBp(f!.limits[l].min) })) },
        classificationOptions: Object.fromEntries(CLASSIFICATION_DIMENSIONS.map((k) => [k, f!.options[k].split('\n').map((x) => x.trim()).filter(Boolean)])),
        notifyEmail: f!.notifyEmail, notifyWhatsapp: f!.notifyWhatsapp, notifyShowClass: f!.notifyShowClass, template: f!.template,
      },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'approval-settings'] }); toast({ tone: 'success', message: 'Aprovações salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!f) return <div className="card"><LoadingRows /></div>;
  const setLim = (l: ApprovalLevel, p: Partial<{ max: string; min: string }>) => setF({ ...f, limits: { ...f.limits, [l]: { ...f.limits[l], ...p } } });
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Alçadas de desconto</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">Desconto máximo sobre o preço de tabela que cada alçada pode aprovar e, se quiser, a margem mínima depois do desconto. Acima do limite da Diretoria a aprovação é excepcional. A alçada da pessoa vem do perfil (Vendedor, Supervisão, Gerência) ou do setor Diretoria em <Link className="link" to="/settings/users">Usuários</Link>.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {APPROVAL_LEVELS.map((l) => (
            <fieldset key={l} className="rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-bold text-ink">{APPROVAL_LEVEL_LABELS[l]}</legend>
              <FormField label="Desconto máximo (%)" htmlFor={`al-${l}`}><Input id={`al-${l}`} inputMode="decimal" value={f.limits[l].max} onChange={(e) => setLim(l, { max: e.target.value })} /></FormField>
              <FormField label="Margem mínima (%)" htmlFor={`am-${l}`} hint="Em branco: sem exigência" className="mt-2"><Input id={`am-${l}`} inputMode="decimal" value={f.limits[l].min} onChange={(e) => setLim(l, { min: e.target.value })} /></FormField>
            </fieldset>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Pedidos dentro da alçada do Vendedor são registrados pela Supervisão. Quem pede nunca decide o próprio pedido.</p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Classificação estratégica do cliente</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">Opções que aparecem no cadastro do cliente (uma por linha). Mudar a lista não altera classificações já registradas.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {CLASSIFICATION_DIMENSIONS.map((k) => (
            <FormField key={k} label={CLASSIFICATION_LABELS[k]} htmlFor={`co-${k}`}><Textarea id={`co-${k}`} className="min-h-[120px]" value={f.options[k]} onChange={(e) => setF({ ...f, options: { ...f.options, [k]: e.target.value } })} /></FormField>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Aviso de aprovação</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted">Quem tem alçada recebe o pedido; quem pediu recebe a decisão. O WhatsApp sai pela <Link className="link" to="/settings/integrations">Z-API</Link> para o número no cadastro do usuário. A mensagem leva só o resumo seguro; números e contratos ficam na página autenticada.</p>
        <div className="mb-3 flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={f.notifyEmail} onChange={(e) => setF({ ...f, notifyEmail: e.target.checked })} />E-mail</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={f.notifyWhatsapp} onChange={(e) => setF({ ...f, notifyWhatsapp: e.target.checked })} />WhatsApp</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={f.notifyShowClass} onChange={(e) => setF({ ...f, notifyShowClass: e.target.checked })} />Mostrar a classe estratégica</label>
        </div>
        <FormField label="Mensagem" htmlFor="ap-tpl"><Textarea id="ap-tpl" className="min-h-[180px] font-mono text-sm" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} /></FormField>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">Variáveis: {VARS.map((v) => `{{${v}}}`).join(' ')}</p>
          <Button size="sm" variant="ghost" onClick={() => setF({ ...f, template: DEFAULT_APPROVAL_TEMPLATE })}>Restaurar texto padrão</Button>
        </div>
      </section>
      <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>
    </div>
  );
}
