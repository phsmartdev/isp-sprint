import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import type { Me } from '../lib/types';
import { Button, FormField, Input } from '../components/ui/primitives';
import { Hexagons } from '../components/brand';

const GOOGLE_ERRORS: Record<string, string> = {
  google_desligado: 'O login com Google ainda não foi configurado. Entre com e-mail e senha.',
  google_cancelado: 'O login com Google foi cancelado.',
  google_estado: 'O login com Google expirou. Tente de novo.',
  google_falhou: 'Não foi possível falar com o Google agora. Tente de novo em instantes.',
  google_email: 'Essa conta Google não tem e-mail verificado.',
  google_dominio: 'Use a conta Google do e-mail corporativo.',
  google_sem_usuario: 'Não há usuário ativo no CRM com esse e-mail do Google. Peça à gerência para cadastrar ou corrigir seu e-mail.',
  google_outra_conta: 'Seu usuário já está vinculado a outra conta Google. Entre com ela ou peça à gerência para corrigir o e-mail.',
};

const errText = (err: unknown) => (err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Não foi possível concluir. Verifique a conexão.');

/** Quadro da direita com a logo; a imagem fixa (Personalização → Fundo do login) fica à esquerda. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen bg-navy">
      <div className="fixed inset-0 overflow-hidden bg-gradient-to-br from-navy to-primary lg:right-[520px]" aria-hidden>
        <Hexagons className="absolute inset-0 h-full w-full" />
        <img src="/brand/bkt-logo-white.png" alt="" className="absolute bottom-10 left-10 hidden h-16 w-auto lg:block" draggable={false} />
      </div>
      <div className="relative ml-auto flex min-h-screen w-full items-center justify-center px-4 py-10 lg:w-[520px] lg:bg-surface lg:px-12 lg:shadow-overlay">
        <div className="w-full max-w-sm space-y-5 rounded-lg bg-surface p-7 shadow-overlay lg:p-0 lg:shadow-none">
          <div className="flex flex-col items-center gap-3 pb-2">
            <img src="/brand/bkt-logo.png" alt="BKT" className="h-14 w-auto object-contain" draggable={false} />
            <p className="font-display text-sm font-bold tracking-[0.18em] text-muted">ISP SPRINT</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Campo de senha com "mostrar senha" e aviso de Caps Lock (os erros de digitação mais comuns no login). */
export function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <div>
      <div className="relative">
        <Input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} required value={value} onChange={(e) => onChange(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} className="pr-11" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show}>
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {caps && <p className="mt-1 text-xs font-semibold text-warning">Caps Lock está ligado.</p>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => GOOGLE_ERRORS[params.get('erro') ?? ''] ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => api<{ google: boolean; passwordReset: boolean }>('/auth/providers'), staleTime: 300_000, retry: false });
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (me) return <Navigate to={safeNext} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const r = await api<{ message: string }>('/auth/password/forgot', { method: 'POST', body: { email: email.trim() } });
        setInfo(r.message);
      } else {
        const data = await api<Me>('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
        qc.setQueryData(['me'], data);
        nav(safeNext, { replace: true });
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  const switchTo = (m: 'login' | 'forgot') => { setMode(m); setError(null); setInfo(null); };

  return (
    <AuthFrame>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <h1 className="text-lg font-extrabold text-ink">{mode === 'login' ? 'Entrar no CRM' : 'Criar nova senha'}</h1>
          <p className="text-sm text-muted">{mode === 'login' ? 'Use seu e-mail corporativo.' : 'Informe seu e-mail. Enviaremos um link que vale por 1 hora.'}</p>
        </div>

        {mode === 'login' && providers.data?.google && (
          <>
            <a href={`/api/v1/auth/google/start?next=${encodeURIComponent(safeNext)}`} className="flex h-11 w-full items-center justify-center gap-3 rounded-sm border border-line bg-surface text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <GoogleMark /> Entrar com Google
            </a>
            <div className="flex items-center gap-3 text-xs text-muted" aria-hidden><span className="h-px flex-1 bg-line" />ou com e-mail e senha<span className="h-px flex-1 bg-line" /></div>
          </>
        )}

        <FormField label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoCapitalize="none" spellCheck={false} />
        </FormField>
        {mode === 'login' && (
          <FormField label="Senha" htmlFor="password">
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </FormField>
        )}
        {error && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {info && <p role="status" className="rounded-sm bg-success-soft px-3 py-2 text-sm text-success">{info}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>{mode === 'login' ? 'Entrar' : 'Enviar link'}</Button>
        <p className="text-center text-sm">
          {mode === 'login'
            ? <button type="button" className="link" onClick={() => switchTo('forgot')}>Esqueci minha senha</button>
            : <button type="button" className="link" onClick={() => switchTo('login')}>Voltar para o login</button>}
        </p>
        {mode === 'forgot' && <p className="text-center text-xs text-muted">Não recebeu? Confira o spam ou peça à gerência uma senha temporária em Configurações → Usuários.</p>}
        {import.meta.env.DEV && (
          <p className="text-center text-xs text-muted">Demonstração: carlos@yepnet.test (gerência), ana@yepnet.test (supervisão), lucas@yepnet.test (vendedor) · senha Sprint@2026</p>
        )}
      </form>
    </AuthFrame>
  );
}

/** Página pública do link enviado por e-mail. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError('Use ao menos 10 caracteres.');
    if (password !== confirm) return setError('As duas senhas não são iguais.');
    setLoading(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame>
      {done ? (
        <div className="space-y-4">
          <h1 className="text-lg font-extrabold text-ink">Senha criada</h1>
          <p className="text-sm text-muted">Use a nova senha para entrar. As sessões abertas em outros aparelhos foram encerradas.</p>
          <Link to="/login" className="flex h-11 w-full items-center justify-center rounded-sm bg-primary text-sm font-semibold text-white">Ir para o login</Link>
        </div>
      ) : !token ? (
        <div className="space-y-4">
          <h1 className="text-lg font-extrabold text-ink">Link incompleto</h1>
          <p className="text-sm text-muted">Abra o link do e-mail inteiro ou peça um novo em “Esqueci minha senha”.</p>
          <Link to="/login" className="link text-sm">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div>
            <h1 className="text-lg font-extrabold text-ink">Criar nova senha</h1>
            <p className="text-sm text-muted">Ao menos 10 caracteres. O link vale uma única vez.</p>
          </div>
          <FormField label="Nova senha" htmlFor="np"><PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" /></FormField>
          <FormField label="Repita a nova senha" htmlFor="np2"><PasswordInput id="np2" value={confirm} onChange={setConfirm} autoComplete="new-password" /></FormField>
          {error && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>Salvar nova senha</Button>
          <p className="text-center text-sm"><Link to="/login" className="link">Voltar para o login</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}
