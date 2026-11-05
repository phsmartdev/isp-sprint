/**
 * Configurações → Comunicação de contratos → Relatório mensal: modelos das mensagens enviadas ao setor responsável e a
 * quem valida, quando o relatório entra na rotina e antes de cada prazo. E-mail, WhatsApp e chamado no GLPI.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REPORT_CHANNELS, REPORT_CHANNEL_LABELS, REPORT_MESSAGE_KINDS, REPORT_MESSAGE_LABELS, REPORT_VARIABLES,
  type ReportChannel, type ReportMessage, type ReportMessageKind, type ReportMessages,
} from '@isp/domain';
import { api } from '../../lib/api';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

const EMPTY: ReportMessage = { channels: [], subject: '', body: '', whatsapp: '', glpi: { entityId: null, groupId: null, categoryId: null } };
const HINT: Record<ReportMessageKind, string> = {
  inicio_rotina: 'Enviada quando o contrato passa a exigir relatório mensal (ou muda setor, validador ou dia): avisa que o envio entrou na rotina.',
  lembrete: 'Enviada X dias antes de cada prazo (antecedência definida no contrato). Também cria a tarefa para o setor.',
};
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\D/g, '')) || null);

function MessageEditor({ kind, value, onChange, disabled }: { kind: ReportMessageKind; value: ReportMessage; onChange: (m: ReportMessage) => void; disabled: boolean }) {
  const [focus, setFocus] = useState<'subject' | 'body' | 'whatsapp'>('body');
  const id = (k: string) => `rm-${kind}-${k}`;
  const insert = (v: string) => onChange({ ...value, [focus]: `${value[focus]}{{${v}}}` });
  const has = (c: ReportChannel) => value.channels.includes(c);
  return (
    <section className="card space-y-4 p-5" aria-label={REPORT_MESSAGE_LABELS[kind]}>
      <div><h3 className="font-bold text-ink">{REPORT_MESSAGE_LABELS[kind]}</h3><p className="text-sm text-muted">{HINT[kind]}</p></div>
      <fieldset disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold text-ink">Canais</legend>
        <div className="flex flex-wrap gap-4 text-sm">{REPORT_CHANNELS.map((c) => (
          <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={has(c)} onChange={() => onChange({ ...value, channels: has(c) ? value.channels.filter((x) => x !== c) : [...value.channels, c] })} />{REPORT_CHANNEL_LABELS[c]}</label>
        ))}</div>
        {!value.channels.length && <p className="mt-1 text-xs text-muted">Sem canal marcado, esta mensagem não é enviada.</p>}
      </fieldset>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted">Inserir variável no campo em edição</p>
        <div className="flex flex-wrap gap-1.5">{REPORT_VARIABLES.map(([k, l]) => <button key={k} type="button" disabled={disabled} title={l} onClick={() => insert(k)} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink hover:border-primary">{`{{${k}}}`}</button>)}</div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <FormField label={has('glpi') ? 'Assunto (e-mail) e título do chamado (GLPI)' : 'Assunto do e-mail'} htmlFor={id('subj')}><Input id={id('subj')} disabled={disabled} value={value.subject} onFocus={() => setFocus('subject')} onChange={(e) => onChange({ ...value, subject: e.target.value })} placeholder="ex.: Relatório mensal do contrato {{contrato}} entra na sua rotina" /></FormField>
          <FormField label={has('glpi') ? 'Texto do e-mail e do chamado' : 'Texto do e-mail'} htmlFor={id('body')}><Textarea id={id('body')} disabled={disabled} rows={8} value={value.body} onFocus={() => setFocus('body')} onChange={(e) => onChange({ ...value, body: e.target.value })} placeholder={'ex.: Olá, {{destinatario}}.\nA partir de agora o relatório mensal do contrato {{contrato}} ({{cliente}}) é enviado pelo setor {{setor}} até o {{dia_envio}} de cada mês e validado por {{validador}}.'} /></FormField>
        </div>
        <div className="space-y-3">
          <FormField label="Mensagem do WhatsApp" htmlFor={id('wa')} hint="Em branco: usa o texto do e-mail."><Textarea id={id('wa')} disabled={disabled} rows={5} value={value.whatsapp} onFocus={() => setFocus('whatsapp')} onChange={(e) => onChange({ ...value, whatsapp: e.target.value })} /></FormField>
          {has('glpi') && (
            <fieldset className="rounded-md border border-line p-3" disabled={disabled}>
              <legend className="px-1 text-sm font-semibold text-ink">Chamado no GLPI (um por envio, para o setor)</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <FormField label="ID da entidade" htmlFor={id('ent')} required><Input id={id('ent')} inputMode="numeric" value={value.glpi.entityId ?? ''} onChange={(e) => onChange({ ...value, glpi: { ...value.glpi, entityId: e.target.value.trim() === '' ? null : Number(e.target.value.replace(/\D/g, '')) } })} /></FormField>
                <FormField label="ID do grupo" htmlFor={id('grp')}><Input id={id('grp')} inputMode="numeric" value={value.glpi.groupId ?? ''} onChange={(e) => onChange({ ...value, glpi: { ...value.glpi, groupId: num(e.target.value) } })} /></FormField>
                <FormField label="ID da categoria" htmlFor={id('cat')}><Input id={id('cat')} inputMode="numeric" value={value.glpi.categoryId ?? ''} onChange={(e) => onChange({ ...value, glpi: { ...value.glpi, categoryId: num(e.target.value) } })} /></FormField>
              </div>
              <p className="mt-1 text-xs text-muted">Números do próprio GLPI. Exige a integração com o GLPI ligada em Configurações → Integrações.</p>
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}

export function ReportMessagesAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contract-report-messages'], queryFn: () => api<{ messages: ReportMessages; canManage: boolean }>('/contract-report-messages') });
  const [draft, setDraft] = useState<ReportMessages | null>(null);
  const save = useMutation({
    mutationFn: (messages: ReportMessages) => api<{ messages: ReportMessages }>('/contract-report-messages', { method: 'PUT', body: { messages } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-report-messages'] }); setDraft(null); toast({ tone: 'success', message: 'Modelos salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const cur = draft ?? q.data!.messages;
  const disabled = !q.data!.canManage;
  return (
    <div className="space-y-4">
      <Notice>Mensagens para quem envia e quem valida o relatório mensal dos contratos que o exigem (marcado no cadastro do contrato, em “Envio de relatório”). São avisos internos: vão direto, sem fila de aprovação. Modelo sem canal não é enviado.</Notice>
      {REPORT_MESSAGE_KINDS.map((k) => <MessageEditor key={k} kind={k} disabled={disabled} value={cur[k] ?? EMPTY} onChange={(m) => setDraft({ ...cur, [k]: m })} />)}
      {!disabled && <div className="flex justify-end"><Button variant="primary" disabled={!draft} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>Salvar modelos</Button></div>}
    </div>
  );
}
