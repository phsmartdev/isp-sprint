/**
 * Configurações → Webservice (API): usuários de integração e seus tokens.
 * O usuário de webservice não entra pela tela; usa só o token. O perfil define o que ele lê e grava.
 * O token aparece uma única vez, na hora de gerar.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlay';

type Token = { id: string; name: string; last4: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null; lastUsedIp: string | null };
type WsUser = { id: string; name: string; active: boolean; jobTitle: string | null; createdAt: string; profile: string | null; tokens: Token[] };
type Data = { profiles: { key: string; label: string }[]; users: WsUser[] };

const tokenState = (t: Token) => (t.revokedAt ? 'revogado' : t.expiresAt && new Date(t.expiresAt) < new Date() ? 'expirado' : 'ativo');
const STATE_TONE = { ativo: 'text-success', expirado: 'text-warning', revogado: 'text-muted' } as const;
const VALIDITY = [['30', '30 dias'], ['90', '90 dias'], ['180', '6 meses'], ['365', '1 ano'], ['', 'Sem validade']] as const;

export function AdminWebservice() {
  const q = useQuery({ queryKey: ['admin', 'webservice'], queryFn: () => api<Data>('/admin/webservice') });
  const [creating, setCreating] = useState(false);
  const [tokenFor, setTokenFor] = useState<WsUser | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-lg font-bold text-ink">Usuários de webservice</h2>
          <p className="mt-1 text-sm text-text">Para outros sistemas inserirem ou coletarem dados no BKT RevOps. O usuário de webservice <strong>não entra pela tela</strong>: usa só o token. O que ele lê e grava segue o <strong>perfil</strong> escolhido (Configurações → Permissões), e Configurações nunca ficam disponíveis pela API.</p>
          <p className="mt-2 text-sm"><Link to="/playbooks/api" className="font-semibold text-primary hover:underline">Ver a documentação da API na wiki</Link></p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Novo usuário de webservice</Button>
      </section>
      {d.users.length === 0 ? (
        <div className="card"><EmptyState icon={<KeyRound className="h-8 w-8" />} title="Nenhum usuário de webservice" description="Cadastre um usuário para cada sistema que vai se integrar (ex.: ERP, site, BI) e gere o token dele." /></div>
      ) : d.users.map((u) => <UserCard key={u.id} u={u} profiles={d.profiles} onToken={() => setTokenFor(u)} />)}
      {creating && <CreateUser profiles={d.profiles} onClose={() => setCreating(false)} />}
      {tokenFor && <CreateToken user={tokenFor} onClose={() => setTokenFor(null)} />}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['admin', 'webservice'] });
}

function UserCard({ u, profiles, onToken }: { u: WsUser; profiles: Data['profiles']; onToken: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [revoke, setRevoke] = useState<Token | null>(null);
  const [deactivate, setDeactivate] = useState(false);
  const patch = useMutation({
    mutationFn: (body: { profile?: string; active?: boolean }) => api(`/admin/webservice/${u.id}`, { method: 'PATCH', body }),
    onSuccess: () => { refresh(); setDeactivate(false); toast({ tone: 'success', message: 'Usuário de webservice atualizado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const rev = useMutation({
    mutationFn: (id: string) => api(`/admin/webservice/tokens/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => { refresh(); setRevoke(null); toast({ tone: 'success', message: 'Token revogado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  return (
    <section className={clsx('card p-5', !u.active && 'opacity-75')} aria-label={u.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-bold text-ink">{u.name} {!u.active && <span className="ml-1 text-xs font-semibold text-muted">· desativado</span>}</h3>
          <p className="text-sm text-muted">{u.jobTitle ?? 'Webservice'} · cadastrado em {fmtDate(u.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Perfil de acesso" htmlFor={`ws-p-${u.id}`}>
            <Select id={`ws-p-${u.id}`} value={u.profile ?? ''} disabled={patch.isPending} onChange={(e) => patch.mutate({ profile: e.target.value })}>
              {profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </FormField>
          {u.active
            ? <><Button variant="primary" onClick={onToken}><KeyRound className="h-4 w-4" />Gerar token</Button><Button variant="secondary" onClick={() => setDeactivate(true)}>Desativar</Button></>
            : <Button variant="secondary" loading={patch.isPending} onClick={() => patch.mutate({ active: true })}>Reativar</Button>}
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        {u.tokens.length === 0 ? <p className="border border-dashed border-line px-4 py-3 text-sm text-muted">Nenhum token gerado ainda.</p> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-3 font-semibold">Token</th><th className="py-2 pr-3 font-semibold">Situação</th><th className="py-2 pr-3 font-semibold">Gerado em</th><th className="py-2 pr-3 font-semibold">Validade</th><th className="py-2 pr-3 font-semibold">Último uso</th><th className="py-2" /></tr></thead>
            <tbody>
              {u.tokens.map((t) => {
                const st = tokenState(t);
                return (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3"><span className="font-semibold text-ink">{t.name}</span> <span className="font-mono text-xs text-muted">isk_…{t.last4}</span></td>
                    <td className={clsx('py-2 pr-3 font-semibold capitalize', STATE_TONE[st])}>{st}</td>
                    <td className="py-2 pr-3 text-text">{fmtDate(t.createdAt)}</td>
                    <td className="py-2 pr-3 text-text">{t.expiresAt ? fmtDate(t.expiresAt) : 'Sem validade'}</td>
                    <td className="py-2 pr-3 text-text">{t.lastUsedAt ? `${fmtDateTime(t.lastUsedAt)}${t.lastUsedIp ? ` · IP ${t.lastUsedIp}` : ''}` : 'Nunca usado'}</td>
                    <td className="py-2 text-right">{st === 'ativo' && <Button size="sm" variant="secondary" onClick={() => setRevoke(t)}>Revogar</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <ConfirmDialog open={!!revoke} title="Revogar token?" confirmLabel="Revogar" tone="danger" loading={rev.isPending} onCancel={() => setRevoke(null)} onConfirm={() => revoke && rev.mutate(revoke.id)}>
        O token “{revoke?.name}” para de funcionar na hora. O sistema que usa esse token vai receber erro 401 até receber um token novo.
      </ConfirmDialog>
      <ConfirmDialog open={deactivate} title="Desativar usuário de webservice?" confirmLabel="Desativar" tone="danger" loading={patch.isPending} onCancel={() => setDeactivate(false)} onConfirm={() => patch.mutate({ active: false })}>
        Todos os tokens de “{u.name}” param de funcionar até você reativar o usuário.
      </ConfirmDialog>
    </section>
  );
}

function CreateUser({ profiles, onClose }: { profiles: Data['profiles']; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [profile, setProfile] = useState(profiles.find((p) => p.key === 'operacao')?.key ?? profiles[0]?.key ?? '');
  const save = useMutation({
    mutationFn: () => api('/admin/webservice', { method: 'POST', body: { name, profile, description: description || null } }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Usuário de webservice cadastrado. Agora gere o token.' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  return (
    <Modal open onClose={onClose} title="Novo usuário de webservice" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Cadastrar</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome" htmlFor="ws-name" required hint="Aparece como autor do que o sistema gravar. Ex.: Integração ERP."><Input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Sistema ou finalidade" htmlFor="ws-desc"><Input id="ws-desc" value={description} maxLength={80} placeholder="Ex.: ERP financeiro, site institucional, BI" onChange={(e) => setDescription(e.target.value)} /></FormField>
        <FormField label="Perfil de acesso" htmlFor="ws-prof" hint="Define o que o sistema pode ler e gravar, conforme Configurações → Permissões. Escolha o menor acesso que resolve a integração.">
          <Select id="ws-prof" value={profile} onChange={(e) => setProfile(e.target.value)}>{profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select>
        </FormField>
      </div>
    </Modal>
  );
}

function CreateToken({ user, onClose }: { user: WsUser; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState('Produção');
  const [validity, setValidity] = useState('365');
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: () => api<{ token: string }>(`/admin/webservice/${user.id}/tokens`, { method: 'POST', body: { name, expiresInDays: validity ? Number(validity) : null } }),
    onSuccess: (r) => { setToken(r.token); refresh(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const copy = async () => { try { await navigator.clipboard.writeText(token!); setCopied(true); } catch { toast({ tone: 'error', message: 'Não foi possível copiar. Selecione e copie o token.' }); } };
  if (token) return (
    <Modal open onClose={onClose} title="Token gerado" footer={<Button variant="primary" onClick={onClose}>Já guardei o token</Button>}>
      <div className="space-y-3">
        <p className="border border-warning bg-warning-soft px-3 py-2 text-sm text-ink"><strong>Copie agora.</strong> Por segurança, este token não aparece de novo. Se perder, revogue e gere outro.</p>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 select-all break-all border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink">{token}</code>
          <Button variant="secondary" onClick={copy} aria-label="Copiar token">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copiado' : 'Copiar'}</Button>
        </div>
        <p className="text-sm text-muted">Envie no cabeçalho de cada requisição: <code className="font-mono text-ink">Authorization: Bearer {token.slice(0, 8)}…</code></p>
      </div>
    </Modal>
  );
  return (
    <Modal open onClose={onClose} title={`Gerar token · ${user.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Gerar token</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome do token" htmlFor="tk-name" hint="Para reconhecer onde ele está em uso. Ex.: Produção, Homologação."><Input id="tk-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Validade" htmlFor="tk-val"><Select id="tk-val" value={validity} onChange={(e) => setValidity(e.target.value)}>{VALIDITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
      </div>
    </Modal>
  );
}
