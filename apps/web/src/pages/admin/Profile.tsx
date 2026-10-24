import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Camera, Mail, UserRound } from 'lucide-react';
import { MODULES, MODULE_LABELS, LEVEL_LABELS, PROFILE_LABELS, type ProfileKey } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, FormField, Input } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';

async function toBase64(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function ProfilePage() {
  const { me, refresh, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me?.user.name ?? '');
  const [jobTitle, setJobTitle] = useState(me?.user.jobTitle ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [photoV, setPhotoV] = useState(0);

  const profile = useMutation({
    mutationFn: () => api('/me/profile', { method: 'PATCH', body: { name, jobTitle: jobTitle || null } }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Perfil salvo' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const password = useMutation({
    mutationFn: () => api('/me/password', { method: 'POST', body: { current: pw.current, next: pw.next } }),
    onSuccess: () => { setPw({ current: '', next: '', confirm: '' }); setPwErr({}); toast({ tone: 'success', message: 'Senha alterada. As outras sessões foram encerradas.' }); },
    onError: (e) => { if (e instanceof ApiError) setPwErr(e.fieldErrors()); toast({ tone: 'error', message: (e as Error).message }); },
  });
  const avatar = useMutation({
    mutationFn: async (f: File) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) throw new Error('Envie PNG, JPG ou WebP.');
      if (f.size > 2 * 1024 * 1024) throw new Error('A imagem passa de 2 MB.');
      return api('/me/avatar', { method: 'PUT', body: { data: await toBase64(f) } });
    },
    onSuccess: () => { setPhotoV(Date.now()); refresh(); qc.invalidateQueries(); toast({ tone: 'success', message: 'Foto atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  if (!me) return null;
  const submitPw = (e: FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 10) return setPwErr({ next: 'Use ao menos 10 caracteres' });
    if (pw.next !== pw.confirm) return setPwErr({ confirm: 'As senhas não conferem' });
    password.mutate();
  };

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader icon={<UserRound className="h-9 w-9" strokeWidth={2.2} />} title="Meu perfil" subtitle="Seus dados, foto e senha." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {can('email') && (
          <section className="card flex flex-wrap items-center justify-between gap-3 p-5 lg:col-span-2" aria-label="Meu Gmail">
            <div className="flex items-center gap-3"><Mail className="h-6 w-6 text-primary" aria-hidden /><div><h2 className="text-md font-bold text-ink">Meu Gmail</h2><p className="text-sm text-muted">Conecte o seu e-mail corporativo e, se quiser, um Gmail particular, para ler e responder pelo CRM. Só você vê essas caixas.</p></div></div>
            <Link to="/email/caixas" className="inline-flex h-10 items-center justify-center whitespace-nowrap bg-primary px-4 font-semibold text-white hover:bg-primary-hover">Conectar meu Gmail</Link>
          </section>
        )}
        <section className="card p-5">
          <h2 className="mb-4 text-md font-bold text-ink">Dados</h2>
          <div className="mb-4 flex items-center gap-4">
            <span key={photoV}><Avatar name={me.user.name} userId={me.user.id} hasPhoto={me.user.hasAvatar} size={72} /></span>
            <Button icon={<Camera className="h-4 w-4" />} loading={avatar.isPending} onClick={() => file.current?.click()}>Trocar foto</Button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Arquivo da foto" onChange={(e) => { const f = e.target.files?.[0]; if (f) avatar.mutate(f); e.target.value = ''; }} />
          </div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); profile.mutate(); }}>
            <FormField label="Nome" htmlFor="pf-name" required><Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
            <FormField label="Cargo" htmlFor="pf-job"><Input id="pf-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></FormField>
            <FormField label="E-mail" htmlFor="pf-email" hint="Alterado pela gerência"><Input id="pf-email" value={me.user.email} disabled /></FormField>
            <div className="flex justify-end"><Button type="submit" variant="primary" loading={profile.isPending}>Salvar</Button></div>
          </form>
        </section>
        <section className="card p-5">
          <h2 className="mb-4 text-md font-bold text-ink">Trocar senha</h2>
          <form className="space-y-3" onSubmit={submitPw} noValidate>
            <FormField label="Senha atual" htmlFor="pw-cur" error={pwErr.current}><Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></FormField>
            <FormField label="Nova senha" htmlFor="pw-new" hint="Ao menos 10 caracteres" error={pwErr.next}><Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></FormField>
            <FormField label="Repita a nova senha" htmlFor="pw-conf" error={pwErr.confirm}><Input id="pw-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></FormField>
            <div className="flex justify-end"><Button type="submit" variant="primary" loading={password.isPending}>Trocar senha</Button></div>
          </form>
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-1 text-md font-bold text-ink">Meu acesso</h2>
          <p className="mb-3 text-sm text-muted">Perfil: {me.profiles.map((p) => PROFILE_LABELS[p as ProfileKey] ?? p).join(', ')}. Os níveis são definidos pela gerência em Configurações → Segurança.</p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {MODULES.map((m) => (
              <div key={m} className="rounded-sm border border-line px-3 py-2"><dt className="text-xs text-muted">{MODULE_LABELS[m]}</dt><dd className="text-sm font-semibold text-ink">{LEVEL_LABELS[me.access[m]]}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
