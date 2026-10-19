import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { atLeast, type AccessLevel, type Module } from '@isp/domain';
import { api, ApiError } from '../lib/api';
import { setTimezone } from '../lib/format';
import type { Me } from '../lib/types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  /** Nível do usuário no módulo (matriz de segurança). */
  level: (m: Module) => AccessLevel;
  can: (m: Module, min?: AccessLevel) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (q.data) setTimezone(q.data.tenant.timezone);
  }, [q.data]);

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    window.addEventListener('isp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('isp:unauthorized', onUnauthorized);
  }, [qc]);

  const me = q.data ?? null;
  const level = (m: Module): AccessLevel => me?.access[m] ?? 'nenhum';
  const value: AuthState = {
    me,
    loading: q.isLoading,
    level,
    can: (m, min = 'proprio') => atLeast(level(m), min),
    refresh: () => q.refetch(),
    logout: async () => {
      // para tudo antes de sair: nenhuma tela tenta recarregar sem sessão (o que mostrava "Faça login para continuar")
      await qc.cancelQueries();
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch {
        /* mesmo com falha de rede, a saída segue: o cookie expira e a próxima chamada pede login */
      }
      qc.clear();
      // recarrega a aplicação já na tela de login, sem estado anterior
      window.location.replace('/login');
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
