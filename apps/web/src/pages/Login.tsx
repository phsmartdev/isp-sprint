import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import type { Me } from '../lib/types';
import { Button, FormField, Input } from '../components/ui/primitives';
import { BrandImage, ConfiarFacilPartial } from '../components/brand';

/** Login: imagem fixa à esquerda (Personalização → Fundo do login) e o quadro de acesso à direita, com a logo dentro. */
export function LoginPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (me) return <Navigate to={safeNext} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<Me>('/auth/login', { method: 'POST', body: { email, password } });
      qc.setQueryData(['me'], data);
      nav(safeNext, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen bg-navy">
      {/* imagem fixa: ocupa a tela toda no celular e o lado esquerdo no computador */}
      <div className="fixed inset-0 lg:right-[520px]" aria-hidden>
        <BrandImage slot="login_fundo" publicAsset className="h-full w-full object-cover" fallback={<div className="h-full w-full bg-[radial-gradient(ellipse_at_30%_40%,#1B3FA0_0%,#0A1F5C_55%,#071640_100%)]" />} />
      </div>
      <div className="relative ml-auto flex min-h-screen w-full items-center justify-center px-4 py-10 lg:w-[520px] lg:bg-surface lg:px-12 lg:shadow-overlay">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-lg bg-surface p-7 shadow-overlay lg:p-0 lg:shadow-none" noValidate>
          <div className="flex flex-col items-center gap-2 pb-2">
            <BrandImage
              slot="logo_claro"
              publicAsset
              alt="Yepnet"
              className="h-14 w-auto max-w-[220px] object-contain"
              fallback={<span className="select-none text-[44px] font-extrabold leading-none tracking-tight" aria-label="Yepnet"><span className="text-navy">Yep</span><span className="text-[#5DBB2F]">net</span></span>}
            />
            <p className="text-md font-semibold text-ink"><ConfiarFacilPartial /></p>
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-ink">Entrar no CRM</h1>
            <p className="text-sm text-muted">Use seu e-mail corporativo.</p>
          </div>
          <FormField label="E-mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Senha" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          {error && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>Entrar</Button>
          {import.meta.env.DEV && (
            <p className="text-center text-xs text-muted">Demonstração: carlos@yepnet.test (gerência), ana@yepnet.test (supervisão), lucas@yepnet.test (vendedor) · senha Sprint@2026</p>
          )}
        </form>
      </div>
    </div>
  );
}
