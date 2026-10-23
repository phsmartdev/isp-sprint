/** Configurações → Integrações: IXC, WhatsApp (Z-API e Cloud API), Meta Lead Ads e formulário do site. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database, LifeBuoy, Globe, MessageCircle, PenLine, MessageSquare, PlugZap, RefreshCw, Users } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';

type Field = { key: string; label: string; secret?: boolean; hint?: string; type?: 'user' | 'text' };
type Item = { kind: 'ixc' | 'zapi' | 'zapsign' | 'glpi' | 'whatsapp' | 'meta' | 'site'; name: string; description: string; status: string; fields: Field[]; receivesLeads: boolean; enabled: boolean; config: Record<string, string | null>; secretsSet: Record<string, boolean>; webhookUrl: string | null; lastEventAt: string | null };
type Event = { id: string; kind: string; status: string; summary: string; leadId: string | null; createdAt: string };

const ICONS = { ixc: Database, zapi: MessageCircle, zapsign: PenLine, glpi: LifeBuoy, whatsapp: MessageSquare, meta: Users, site: Globe };
const EVENT_LABEL: Record<string, { label: string; tone: 'green' | 'neutral' | 'red' | 'yellow' }> = { lead_criado: { label: 'Lead criado', tone: 'green' }, duplicado: { label: 'Já existia', tone: 'yellow' }, ignorado: { label: 'Ignorado', tone: 'neutral' }, erro: { label: 'Erro', tone: 'red' }, recebido: { label: 'Recebido', tone: 'neutral' }, enviado: { label: 'Enviado', tone: 'green' } };
const KIND_NAME: Record<string, string> = { ixc: 'IXC', zapi: 'Z-API', zapsign: 'ZapSign', glpi: 'GLPI', whatsapp: 'WhatsApp Cloud', meta: 'Meta', site: 'Site' };

function copy(text: string, toast: ReturnType<typeof useToast>) {
  void navigator.clipboard?.writeText(text).then(() => toast({ tone: 'success', message: 'Copiado' }), () => toast({ tone: 'error', message: 'Não foi possível copiar' }));
}

function siteSnippet(url: string) {
  return `<form id="form-yepnet">
  <input name="nome" placeholder="Seu nome" required>
  <input name="telefone" placeholder="WhatsApp" required>
  <input name="email" type="email" placeholder="E-mail">
  <textarea name="mensagem" placeholder="Como podemos ajudar?"></textarea>
  <button>Quero ser contatado</button>
</form>
<script>
document.getElementById('form-yepnet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(e.target));
  const r = await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
  e.target.innerHTML = r.ok ? 'Recebemos seu contato!' : 'Não foi possível enviar. Tente pelo WhatsApp.';
});
</script>`;
}

function IntegrationCard({ item }: { item: Item }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const [enabled, setEnabled] = useState(item.enabled);
  const [config, setConfig] = useState<Record<string, string>>(() => Object.fromEntries(item.fields.filter((f) => !f.secret).map((f) => [f.key, item.config[f.key] ?? ''])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [showSnippet, setShowSnippet] = useState(false);
  const Icon = ICONS[item.kind];
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>(`/admin/integrations/${item.kind}/test`, { method: 'POST' }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); toast({ tone: r.ok ? 'success' : 'error', message: `${KIND_NAME[item.kind] ?? item.name}: ${r.message}` }); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const save = useMutation({
    mutationFn: () => api(`/admin/integrations/${item.kind}`, { method: 'PUT', body: { enabled, config, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== '')) } }),
    onSuccess: () => { setSecrets({}); qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); toast({ tone: 'success', message: `${item.name}: salvo` }); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const rotate = useMutation({
    mutationFn: () => api(`/admin/integrations/${item.kind}/rotate`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'integrations'] }); toast({ tone: 'success', message: 'Novo endereço gerado. Atualize onde o antigo estava configurado.' }); },
  });
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-circle bg-primary-soft text-primary"><Icon className="h-6 w-6" /></span>
          <div>
            <h2 className="text-md font-bold text-ink">{item.name}</h2>
            <p className="max-w-2xl text-sm text-muted">{item.description}</p>
            {item.lastEventAt && <p className="text-xs text-muted">Último evento: {fmtDateTime(item.lastEventAt)}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {item.status && <Chip tone="neutral">{item.status}</Chip>}
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{enabled ? 'Ligada' : 'Desligada'}</label>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {item.fields.map((f) => {
          const id = `in-${item.kind}-${f.key}`;
          if (f.type === 'user') return (
            <FormField key={f.key} label={f.label} htmlFor={id} hint="Sem responsável, o lead fica na fila para distribuir">
              <Select id={id} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                <option value="">Ninguém (fila)</option>
                {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </FormField>
          );
          if (f.secret) return (
            <FormField key={f.key} label={f.label} htmlFor={id} hint={item.secretsSet[f.key] ? 'Guardado. Digite só para trocar.' : f.hint}>
              <Input id={id} type="password" autoComplete="new-password" value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} placeholder={item.secretsSet[f.key] ? '••••••••' : ''} />
            </FormField>
          );
          return (
            <FormField key={f.key} label={f.label} htmlFor={id} hint={f.hint}>
              <Input id={id} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
            </FormField>
          );
        })}
      </div>
      {item.webhookUrl && (
        <div className="mt-4 rounded-md bg-surface-2 p-3">
          <p className="mb-1 text-sm font-semibold text-ink">Endereço de recebimento (webhook)</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs text-ink">{item.webhookUrl}</code>
            <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => copy(item.webhookUrl!, toast)}>Copiar</Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} loading={rotate.isPending} onClick={() => { if (confirm('Gerar um novo endereço? O atual para de funcionar.')) rotate.mutate(); }}>Gerar novo</Button>
          </div>
          <p className="mt-1 text-xs text-muted">{item.kind === 'glpi' ? 'Cada aviso do GLPI é conferido pela assinatura feita com o segredo do webhook.' : 'O código no fim do endereço é secreto: quem tiver o endereço consegue enviar leads.'}</p>
          {item.kind === 'site' && (
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => setShowSnippet((x) => !x)}>{showSnippet ? 'Ocultar código do formulário' : 'Ver código pronto para o site'}</Button>
              {showSnippet && (
                <div className="mt-2">
                  <pre className="max-h-72 overflow-auto rounded bg-ink p-3 text-xs text-white">{siteSnippet(item.webhookUrl)}</pre>
                  <Button size="sm" className="mt-2" icon={<Copy className="h-4 w-4" />} onClick={() => copy(siteSnippet(item.webhookUrl!), toast)}>Copiar código</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {(item.kind === 'zapi' || item.kind === 'glpi') && <Button icon={<PlugZap className="h-4 w-4" />} loading={test.isPending} onClick={() => test.mutate()}>Testar conexão</Button>}
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
      </div>
    </section>
  );
}

export function AdminIntegrations() {
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => api<{ items: Item[]; events: Event[] }>('/admin/integrations') });
  const smtp = useQuery({ queryKey: ['admin', 'smtp'], queryFn: () => api<{ configured: boolean; enabled?: boolean }>('/admin/smtp') });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Integrações</h2>
        <p className="text-sm text-muted">Credenciais ficam cifradas no servidor e nunca aparecem aqui. Leads recebidos entram em Leads com o canal de entrada da integração; se o telefone ou e-mail já tem lead aberto, só a interação é registrada. E-mail (SMTP): {smtp.data?.configured ? (smtp.data.enabled ? 'configurado' : 'desligado') : 'não configurado'} — veja em E-mail e alertas.</p>
      </section>
      {q.data!.items.map((i) => <IntegrationCard key={i.kind} item={i} />)}
      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-4"><h2 className="text-md font-bold text-ink">Últimos eventos recebidos</h2></div>
        {!q.data!.events.length ? <p className="px-5 pb-5 text-sm text-muted">Nada recebido ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Quando', 'Integração', 'Resultado', 'Detalhe'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.events.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="num whitespace-nowrap px-5 py-2 text-text">{fmtDateTime(e.createdAt)}</td>
                    <td className="px-5 py-2 text-text">{KIND_NAME[e.kind] ?? e.kind}</td>
                    <td className="px-5 py-2"><Chip tone={EVENT_LABEL[e.status]?.tone ?? 'neutral'}>{EVENT_LABEL[e.status]?.label ?? e.status}</Chip></td>
                    <td className="px-5 py-2 text-text">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
