/** Configurações → E-mail: servidor SMTP, teste de envio, alertas automáticos e registro de envios. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Pagination } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';

type Smtp = { configured: false } | { configured: true; host: string; port: number; secure: boolean; username: string | null; fromName: string; fromEmail: string; replyTo: string | null; enabled: boolean; hasPassword: boolean; lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null; updatedAt: string };
type Notif = { activityDigest: boolean; leadAssigned: boolean; dealWon: boolean; userAccess: boolean; smtpConfigured: boolean; cronConfigured: boolean };
type EmailRow = { id: string; kind: string; to: string; subject: string; status: string; error: string | null; createdAt: string; createdByName: string | null };

const KIND_LABELS: Record<string, string> = { proposta: 'Proposta', followup: 'Follow-up', convite_usuario: 'Acesso de usuário', nova_senha: 'Nova senha', alerta_atividades: 'Resumo de atividades', alerta_lead_atribuido: 'Lead atribuído', alerta_venda_fechada: 'Venda fechada', automacao: 'Automação', teste: 'Teste' };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);

function SmtpForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'smtp'], queryFn: () => api<Smtp>('/admin/smtp') });
  const [f, setF] = useState({ host: '', port: '587', secure: false, username: '', password: '', fromName: '', fromEmail: '', replyTo: '', enabled: true });
  const [changePwd, setChangePwd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState(me?.user.email ?? '');
  useEffect(() => {
    const d = q.data;
    if (d?.configured) setF({ host: d.host, port: String(d.port), secure: d.secure, username: d.username ?? '', password: '', fromName: d.fromName, fromEmail: d.fromEmail, replyTo: d.replyTo ?? '', enabled: d.enabled });
    setChangePwd(!d?.configured || !d.hasPassword);
  }, [q.data]);
  const set = (v: Partial<typeof f>) => setF((x) => ({ ...x, ...v }));
  const save = useMutation({
    mutationFn: () => api('/admin/smtp', { method: 'PUT', body: { host: f.host, port: Number(f.port), secure: f.secure, username: f.username || null, ...(changePwd ? { password: f.password } : {}), fromName: f.fromName, fromEmail: f.fromEmail, replyTo: f.replyTo || null, enabled: f.enabled } }),
    onSuccess: () => { setErrors({}); qc.invalidateQueries({ queryKey: ['admin'] }); toast({ tone: 'success', message: 'Configuração de e-mail salva' }); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; error?: string }>('/admin/smtp/test', { method: 'POST', body: { to: testTo } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin'] }); toast(r.ok ? { tone: 'success', message: `E-mail de teste enviado para ${testTo}` } : { tone: 'error', message: `Falhou: ${r.error}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Mail className="h-5 w-5 text-primary" />Servidor de e-mail (SMTP)</h2>
          <p className="max-w-3xl text-sm text-muted">Usado para enviar propostas e follow-ups ao cliente, alertas ao time e acesso de novos usuários. A senha fica cifrada no servidor e nunca volta para esta tela.</p>
        </div>
        {d.configured ? <Chip tone={d.enabled ? (d.lastTestOk === false ? 'red' : 'green') : 'neutral'}>{!d.enabled ? 'Desligado' : d.lastTestOk === false ? 'Último teste falhou' : d.lastTestOk ? 'Funcionando' : 'Não testado'}</Chip> : <Chip tone="neutral">Não configurado</Chip>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label="Servidor" htmlFor="sm-host" required error={errors.host} className="xl:col-span-2"><Input id="sm-host" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.seuprovedor.com.br" /></FormField>
        <FormField label="Porta" htmlFor="sm-port" required error={errors.port}><Input id="sm-port" type="number" value={f.port} onChange={(e) => set({ port: e.target.value, secure: e.target.value === '465' ? true : f.secure })} /></FormField>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.secure} onChange={(e) => set({ secure: e.target.checked })} />SSL direto (porta 465)</label>
        <FormField label="Usuário" htmlFor="sm-user"><Input id="sm-user" autoComplete="off" value={f.username} onChange={(e) => set({ username: e.target.value })} /></FormField>
        <FormField label="Senha" htmlFor="sm-pass" hint={d.configured && d.hasPassword && !changePwd ? 'Guardada' : 'Em branco: sem senha'}>
          {changePwd ? <Input id="sm-pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} /> : <Button id="sm-pass" onClick={() => setChangePwd(true)}>Trocar senha</Button>}
        </FormField>
        <FormField label="Nome do remetente" htmlFor="sm-fname" required error={errors.fromName}><Input id="sm-fname" value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="BKT Vendas" /></FormField>
        <FormField label="E-mail do remetente" htmlFor="sm-from" required error={errors.fromEmail}><Input id="sm-from" type="email" value={f.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder="vendas@empresa.com.br" /></FormField>
        <FormField label="Responder para" htmlFor="sm-reply" error={errors.replyTo} hint="Em branco: o vendedor que enviou"><Input id="sm-reply" type="email" value={f.replyTo} onChange={(e) => set({ replyTo: e.target.value })} /></FormField>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Envio ligado</label>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Enviar teste para" htmlFor="sm-test"><Input id="sm-test" type="email" className="w-64" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></FormField>
          <Button icon={<Send className="h-4 w-4" />} loading={test.isPending} disabled={!d.configured || !testTo} onClick={() => test.mutate()}>Testar</Button>
          {d.configured && d.lastTestAt && <span className="pb-2 text-xs text-muted">Último teste {fmtDateTime(d.lastTestAt)}{d.lastTestError ? `: ${d.lastTestError}` : ''}</span>}
        </div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar configuração</Button>
      </div>
    </section>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'notifications'], queryFn: () => api<Notif>('/admin/notifications') });
  const m = useMutation({
    mutationFn: (body: Omit<Notif, 'smtpConfigured' | 'cronConfigured'>) => api('/admin/notifications', { method: 'PUT', body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'notifications'] }); toast({ tone: 'success', message: 'Alertas atualizados' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const n = q.data!;
  const items: { key: keyof Omit<Notif, 'smtpConfigured' | 'cronConfigured'>; title: string; desc: string }[] = [
    { key: 'activityDigest', title: 'Resumo diário de atividades', desc: 'Cada pessoa recebe pela manhã as atividades de hoje e as vencidas.' },
    { key: 'leadAssigned', title: 'Lead atribuído', desc: 'Avisa o vendedor quando um lead é passado para ele.' },
    { key: 'dealWon', title: 'Venda fechada', desc: 'Avisa a supervisão do time e a gerência a cada venda fechada.' },
    { key: 'userAccess', title: 'Acesso de usuários', desc: 'Envia o convite com a senha provisória e as trocas de senha.' },
  ];
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Alertas automáticos</h2>
      <p className="mb-3 text-sm text-muted">Os textos de cada e-mail ficam no modelo de instrução (seção “emails”). O sino do topo continua mostrando as atividades do dia.</p>
      {!n.smtpConfigured && <div className="mb-3"><Notice tone="warning">Configure o SMTP acima: sem ele nenhum alerta é enviado.</Notice></div>}
      {!n.cronConfigured && <div className="mb-3"><Notice>O resumo diário e as automações de “parada há X dias” precisam do agendamento ligado no servidor (variável CRON_SECRET).</Notice></div>}
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <span><span className="block font-semibold text-ink">{i.title}</span><span className="block text-sm text-muted">{i.desc}</span></span>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={n[i.key]} disabled={m.isPending} onChange={(e) => m.mutate({ activityDigest: n.activityDigest, leadAssigned: n.leadAssigned, dealWon: n.dealWon, userAccess: n.userAccess, [i.key]: e.target.checked })} />Ligado</label>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">Quer mudar os textos? <Link className="link" to="/settings/modelos?aba=instrucao">Exporte o modelo de instrução</Link>, edite e envie de volta.</p>
    </section>
  );
}

function EmailLog() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin', 'emails', page], queryFn: () => api<{ items: EmailRow[]; total: number; page: number; pageSize: number }>(`/admin/emails${qs({ page, pageSize: 25 })}`), placeholderData: (p) => p });
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-3 pt-4"><h2 className="text-lg font-bold text-ink">E-mails enviados</h2><p className="text-sm text-muted">Registro permanente de cada envio, inclusive os que falharam.</p></div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <p className="px-5 pb-5 text-sm text-muted">Nenhum e-mail enviado ainda.</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Quando', 'Tipo', 'Para', 'Assunto', 'Enviado por', 'Situação'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="num whitespace-nowrap px-5 py-2 text-text">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-5 py-2 text-text">{KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td className="break-all px-5 py-2 text-text">{r.to}</td>
                    <td className="px-5 py-2 text-ink">{r.subject}</td>
                    <td className="px-5 py-2 text-text">{r.createdByName ?? 'Sistema'}</td>
                    <td className="px-5 py-2"><Chip tone={r.status === 'enviado' ? 'green' : r.status === 'falhou' ? 'red' : 'neutral'} title={r.error ?? undefined}>{r.status === 'enviado' ? 'Enviado' : r.status === 'falhou' ? 'Falhou' : r.status}</Chip>{r.error && <span className="block max-w-xs truncate text-xs text-danger" title={r.error}>{r.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3"><Pagination page={page} pageSize={25} total={q.data!.total} onPage={setPage} noun="e-mails" /></div>
        </>
      )}
    </section>
  );
}

export function AdminEmail() {
  return (
    <div className="space-y-4">
      <SmtpForm />
      <Notifications />
      <EmailLog />
    </div>
  );
}
