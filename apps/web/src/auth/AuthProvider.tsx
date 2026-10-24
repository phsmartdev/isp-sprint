import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { atLeast, featureOn, type AccessLevel, type BusinessModule, type FeatureKey, type Module, type SensitiveAction } from '@isp/domain';
import { api, ApiError } from '../lib/api';
import { setFinanceRestricted, setTimezone } from '../lib/format';
import type { Me } from '../lib/types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  /** Nível do usuário no módulo (matriz de segurança). */
  level: (m: Module) => AccessLevel;
  can: (m: Module, min?: AccessLevel) => boolean;
  /** Etapa 1: módulo de negócio ligado para a pessoa; funcionalidade disponível; ação sensível permitida. */
  mod: (m: BusinessModule) => boolean;
  feature: (f: FeatureKey) => boolean;
  action: (a: SensitiveAction) => boolean;
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
        // acesso por IP liberado: sessão fora da rede autorizada volta para o login, que explica o motivo
        if (e instanceof ApiError && e.status === 403 && e.problem.type === 'urn:isp:ip-bloqueado') return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (q.data) setTimezone(q.data.tenant.timezone);
    // Etapa 1: sem "ver financeiro", todo valor em R$ aparece como oculto (inclusive somas feitas na tela)
    setFinanceRestricted(!!q.data && q.data.actions?.ver_financeiro === false);
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
    mod: (m) => me?.modules?.[m] ?? true,
    feature: (f) => (me?.modules ? featureOn(f, me.modules, me.disabledFeatures ?? [], me.access) : true),
    action: (a) => me?.actions?.[a] ?? true,
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
