/**
 * Entrada da Jornada 3D: carrega os dados REAIS da conta (visão 360° e /jornada-3d, ambos só leitura) e adapta para a cena;
 * a página de teste usa o modo demonstrativo, que nunca chama a API de gravação.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { ErrorState, LoadingRows } from '../../../components/ui/primitives';
import { Journey3D } from './Journey3D';
import { DEMO_SCENARIOS, adapt, demoModel } from './model';

export function Journey3DAccount({ contactId, onExit }: { contactId: string; onExit?: () => void }) {
  const a = useQuery({ queryKey: ['cs-account', contactId], queryFn: () => api<Parameters<typeof adapt>[0]>(`/cs/accounts/${contactId}`) });
  const j = useQuery({ queryKey: ['cs-journey3d', contactId], queryFn: () => api<Parameters<typeof adapt>[1]>(`/cs/accounts/${contactId}/jornada-3d`) });
  if (a.isLoading || j.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (a.isError || j.isError) return <ErrorState error={a.error ?? j.error} onRetry={() => { void a.refetch(); void j.refetch(); }} />;
  return <Journey3D model={adapt(a.data!, j.data!)} onExit={onExit} />;
}

/** Página de teste: conta fictícia, com cenários para testar as animações (nada é gravado). */
export function Journey3DDemoPage() {
  const [k, setK] = useState<(typeof DEMO_SCENARIOS)[number]['key']>('ongoing_risco');
  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-muted"><Link className="text-primary hover:underline" to="/sucesso">Sucesso do Cliente</Link> / Jornada 3D (teste)</p><h1 className="text-2xl font-bold text-ink">Jornada Viva do Cliente · demonstração</h1></div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cenário de demonstração">
          {DEMO_SCENARIOS.map((s) => <button key={s.key} type="button" aria-pressed={k === s.key} onClick={() => setK(s.key)} className={clsx('rounded-md border px-3 py-1.5 text-sm font-semibold', k === s.key ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink hover:bg-surface-2')}>{s.label}</button>)}
        </div>
      </div>
      <Journey3D key={k} model={demoModel(k)} />
    </div>
  );
}
