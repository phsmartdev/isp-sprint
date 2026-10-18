import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Opportunity, PipelineStage } from '../lib/types';
import { useToast } from '../components/ui/overlay';
import type { TransitionPayload } from './TransitionDialog';

type PipelineData = { stages: PipelineStage[] };

/** Transição com UI otimista no Kanban e rollback se o servidor recusar (409 versão, 422 regra). */
export function useTransitionMutation() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ opp, payload }: { opp: Opportunity; payload: TransitionPayload }) =>
      api<Opportunity>(`/opportunities/${opp.id}/transition`, { method: 'POST', body: { ...payload, rowVersion: opp.rowVersion } }),
    onMutate: async ({ opp, payload }) => {
      await qc.cancelQueries({ queryKey: ['pipeline'] });
      const snapshots = qc.getQueriesData<PipelineData>({ queryKey: ['pipeline'] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const moved = { ...opp, stage: payload.toStage };
        qc.setQueryData<PipelineData>(key, {
          ...data,
          stages: data.stages.map((s) => {
            const cards = s.cards.filter((c) => c.id !== opp.id);
            if (s.key === payload.toStage) cards.unshift(moved);
            return { ...s, cards, count: cards.length, valueCents: cards.reduce((a, c) => a + (c.valueCents ?? 0), 0) };
          }),
        });
      }
      return { snapshots };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'Outra pessoa alterou esta oportunidade. O quadro foi atualizado.' : (e as Error).message });
    },
    onSuccess: (o) => {
      qc.setQueryData(['opportunity', o.id], o);
      toast({ tone: 'success', message: `Movida para ${o.stageName ?? o.stage}` });
    },
    onSettled: (_d, _e, v) => {
      for (const k of ['pipeline', 'opportunities', 'home', 'reports', 'intelligence']) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ['opportunity', v.opp.id] });
      qc.invalidateQueries({ queryKey: ['timeline', v.opp.id] });
    },
  });
}
