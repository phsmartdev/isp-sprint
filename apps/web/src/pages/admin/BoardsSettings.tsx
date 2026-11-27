/** Configurações → Quadros de Tarefas: equipes de cada departamento, limite em execução e a diretriz 70/20/10 (versionada). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_LABELS, type BoardKey } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtDate } from '../../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Cfg = { key: BoardKey; label: string; teamIds: string[]; wipLimit: number; wipCountsWaiting: boolean; role: string };
type Policy = { current: { version: number; comercial: number; interno: number; hipotese: number; reason: string }; versions: { version: number; comercial: number; interno: number; hipotese: number; reason: string; createdAt: string; by: string | null }[] };

export function BoardsSettingsPage() {
  const q = useQuery({ queryKey: ['quadros'], queryFn: () => api<{ items: Cfg[] }>('/quadros') });
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-extrabold tracking-tight text-ink">Quadros de Tarefas</h1><p className="text-sm text-muted">Cada departamento tem o seu quadro. Ligue ou esconda o submenu de cada um em Módulos e liberação. Aqui: as equipes de cada quadro, o limite de tarefas em execução e a diretriz 70/20/10.</p></div>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length
        ? <p className="text-sm text-muted">Nenhum Quadro de Tarefas está ligado. Ligue em Configurações → Módulos e liberação (Comercial, Sucesso do Cliente ou Produto).</p>
        : q.data!.items.filter((b) => b.key !== 'marketing').map((b) => <BoardCard key={b.key} b={b} />)}
    </div>
  );
}

function BoardCard({ b }: { b: Cfg }) {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = (useLookups().data?.teams ?? []) as { id: string; name: string }[];
  const [f, setF] = useState({ teamIds: b.teamIds, wipLimit: String(b.wipLimit), wipCountsWaiting: b.wipCountsWaiting });
  const save = useMutation({
    mutationFn: () => api(`/quadros/${b.key}/config`, { method: 'PUT', body: { teamIds: f.teamIds, wipLimit: Number(f.wipLimit) || 3, wipCountsWaiting: f.wipCountsWaiting } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['quadros'] }); toast({ tone: 'success', message: `Quadro ${BOARD_LABELS[b.key]} salvo` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pol = useQuery({ queryKey: ['quadros', b.key, 'politica'], queryFn: () => api<Policy>(`/quadros/${b.key}/politica`) });
  const [p, setP] = useState<{ comercial: string; interno: string; hipotese: string; reason: string } | null>(null);
  const savePol = useMutation({
    mutationFn: () => api(`/quadros/${b.key}/politica`, { method: 'POST', body: { comercial: Math.round(Number(p!.comercial) * 100), interno: Math.round(Number(p!.interno) * 100), hipotese: Math.round(Number(p!.hipotese) * 100), reason: p!.reason } }),
    onSuccess: () => { setP(null); void pol.refetch(); toast({ tone: 'success', message: 'Nova versão da diretriz registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const sum = p ? Number(p.comercial) + Number(p.interno) + Number(p.hipotese) : 100;
  return (
    <section className="card space-y-4 p-5" aria-label={`Quadro ${BOARD_LABELS[b.key]}`}>
      <h2 className="text-lg font-bold text-ink">{BOARD_LABELS[b.key]}</h2>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">Equipes do departamento</legend>
        <p className="mb-2 text-xs text-muted">A tarefa aparece no quadro da equipe de quem é responsável por ela. Líder de equipe planeja; gerente e diretor da equipe fazem a gestão.</p>
        <div className="flex flex-wrap gap-2">{teams.map((t) => (
          <label key={t.id} className="flex items-center gap-1.5 border border-line px-2 py-1 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.teamIds.includes(t.id)} onChange={(e) => setF({ ...f, teamIds: e.target.checked ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id) })} />{t.name}</label>
        ))}</div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Tarefas em execução por pessoa" htmlFor={`wip-${b.key}`}><Input id={`wip-${b.key}`} className="w-24" inputMode="numeric" value={f.wipLimit} onChange={(e) => setF({ ...f, wipLimit: e.target.value.replace(/\D/g, '') })} /></FormField>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.wipCountsWaiting} onChange={(e) => setF({ ...f, wipCountsWaiting: e.target.checked })} />Bloqueadas (aguardando terceiros) contam no limite</label>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar quadro</Button>
      </div>
      <div className="border-t border-line pt-3">
        <h3 className="font-bold text-ink">Diretriz de capacidade</h3>
        {pol.data && <p className="text-sm">Vigente (versão {pol.data.current.version || 'padrão'}): <b>{pol.data.current.comercial / 100}% comercial · {pol.data.current.interno / 100}% interno · {pol.data.current.hipotese / 100}% hipóteses</b></p>}
        {!p ? <Button size="sm" variant="secondary" className="mt-2" onClick={() => setP({ comercial: String((pol.data?.current.comercial ?? 7000) / 100), interno: String((pol.data?.current.interno ?? 2000) / 100), hipotese: String((pol.data?.current.hipotese ?? 1000) / 100), reason: '' })}>Nova versão</Button> : (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-3">
              {(['comercial', 'interno', 'hipotese'] as const).map((k) => <FormField key={k} label={{ comercial: 'Comercial (%)', interno: 'Interno (%)', hipotese: 'Hipóteses (%)' }[k]} htmlFor={`pol-${b.key}-${k}`}><Input id={`pol-${b.key}-${k}`} className="w-24" inputMode="decimal" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value.replace(',', '.') })} /></FormField>)}
            </div>
            {sum !== 100 && <p className="text-sm text-danger">As três somam {sum}%: precisam somar 100%.</p>}
            <FormField label="Motivo da mudança" htmlFor={`pol-${b.key}-r`}><Textarea id={`pol-${b.key}-r`} rows={2} value={p.reason} onChange={(e) => setP({ ...p, reason: e.target.value })} /></FormField>
            <div className="flex gap-2"><Button size="sm" variant="primary" disabled={sum !== 100 || p.reason.trim().length < 10} loading={savePol.isPending} onClick={() => savePol.mutate()}>Registrar versão</Button><Button size="sm" variant="ghost" onClick={() => setP(null)}>Cancelar</Button></div>
          </div>
        )}
        {!!pol.data?.versions.length && <ul className="mt-2 text-xs text-muted">{pol.data.versions.map((v) => <li key={v.version}>v{v.version} · {v.comercial / 100}/{v.interno / 100}/{v.hipotese / 100} · {v.by ?? '—'} em {fmtDate(v.createdAt)} · {v.reason}</li>)}</ul>}
      </div>
    </section>
  );
}
