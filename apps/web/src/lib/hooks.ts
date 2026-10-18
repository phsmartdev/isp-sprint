import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Lookups } from './types';

export function useLookups() {
  return useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/meta/lookups'), staleTime: 10 * 60_000 });
}

/** Nome e cor de uma etapa pela jornada (as etapas são configuráveis). */
export function useStageInfo() {
  const l = useLookups();
  return (pipelineId: string | null | undefined, key: string) => {
    const p = l.data?.pipelines.find((x) => x.id === pipelineId) ?? l.data?.pipelines.find((x) => x.isDefault);
    const idx = p?.stages.findIndex((st) => st.key === key) ?? -1;
    const st = idx >= 0 ? p!.stages[idx]! : null;
    return { name: st?.name ?? null, color: st?.color ?? null, index: Math.max(0, idx), stage: st, pipeline: p ?? null };
  };
}

/**
 * Estado de filtros na URL: sobrevive a refresh, voltar/avançar e compartilhamento de link.
 * Também é o mecanismo de "vista salva" mais simples: o link é a vista.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const state = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, params.get(k) ?? v])) as T;
  const set = useCallback(
    (patch: Partial<T>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === (defaults as Record<string, string>)[k]) next.delete(k);
            else next.set(k, String(v));
          }
          if (opts.resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaults],
  );
  return [state, set] as const;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Atalho de teclado global que ignora quando o foco está em campos de texto. */
export function useHotkey(key: string, handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        handler();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [key, handler]);
}

/** Período padrão: do dia 1 do mês até hoje (datas locais AAAA-MM-DD). */
export function defaultPeriod() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}
