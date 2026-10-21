/** Scorecards por função: indicadores, pesos (normalizados), metas, teto, a quem se aplica e composição de quem tem duas funções. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { PERIOD_LABELS, PROFILE_KEYS, PROFILE_LABELS, normalizeWeights, validateScorecard, type ScorecardDef } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import type { IndicatorRow } from './IndicatorBuilder';

type Card = { id: string; name: string; description: string | null; appliesProfiles: string[]; appliesJobTitles: string[]; appliesTeamIds: string[]; periodicity: 'semana' | 'mes' | 'trimestre' | 'ano'; active: boolean; currentVersion: number; def: ScorecardDef; assignments: { userId: string; weight: number; name: string }[] };

export function ScorecardsAdmin() {
  const q = useQuery({ queryKey: ['performance', 'scorecards'], queryFn: () => api<{ items: Card[]; canEdit: boolean }>('/performance/scorecards') });
  const inds = useQuery({ queryKey: ['performance', 'indicators'], queryFn: () => api<{ items: IndicatorRow[] }>('/performance/indicators') });
  const [edit, setEdit] = useState<Card | 'new' | null>(null);
  if (q.isLoading || inds.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  const name = (id: string) => inds.data?.items.find((i) => i.id === id)?.def.name ?? '(removido)';
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><h2 className="text-lg font-bold text-ink">Scorecards por função</h2><p className="text-sm text-muted">Cada função tem seus indicadores e pesos. Funções diferentes não são comparadas entre si. Indicador sem dado fica fora da nota e os pesos dos demais são redistribuídos.</p></div>
          {q.data!.canEdit && <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!inds.data?.items.length} onClick={() => setEdit('new')}>Novo scorecard</Button>}
        </div>
        {!inds.data?.items.length && <div className="px-4 pb-4"><Notice tone="info">Crie indicadores antes de montar um scorecard.</Notice></div>}
        {!q.data!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum scorecard" /></div> : (
          <ul className="divide-y divide-line border-t border-line">
            {q.data!.items.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 font-semibold text-ink">{c.name} {!c.active && <Chip tone="neutral">Inativo</Chip>}<span className="ml-2 text-xs font-normal text-muted">{PERIOD_LABELS[c.periodicity]} · v{c.currentVersion} · aplica a: {[...c.appliesProfiles.map((p) => PROFILE_LABELS[p as keyof typeof PROFILE_LABELS] ?? p), ...c.appliesJobTitles].join(', ') || 'só atribuídos'}{c.assignments.length ? ` · ${c.assignments.length} atribuição(ões)` : ''}</span></p>
                  {q.data!.canEdit && <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>Editar</Button>}
                </div>
                <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">{normalizeWeights(c.def.items).map((i) => <li key={i.indicatorId} className="rounded-sm bg-surface-2 px-2 py-0.5">{name(i.indicatorId)} · {Math.round(i.norm * 100)}%</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      {q.data!.canEdit && <Assignments cards={q.data!.items} />}
      <ScorecardEditor row={edit} onClose={() => setEdit(null)} indicators={inds.data?.items ?? []} />
    </div>
  );
}

function ScorecardEditor({ row, onClose, indicators }: { row: Card | 'new' | null; onClose: () => void; indicators: IndicatorRow[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const teams = useLookups().data?.teams ?? [];
  const blank = { name: '', description: '', appliesProfiles: [] as string[], jobTitles: '', appliesTeamIds: [] as string[], periodicity: 'mes' as Card['periodicity'], active: true, def: { items: [], cap: 1.2 } as ScorecardDef, note: '' };
  const [f, setF] = useState(blank);
  const [key, setKey] = useState<string | null>(null);
  const k = row === 'new' ? 'new' : row?.id ?? null;
  if (k !== key) { setKey(k); setF(row && row !== 'new' ? { name: row.name, description: row.description ?? '', appliesProfiles: row.appliesProfiles, jobTitles: row.appliesJobTitles.join(', '), appliesTeamIds: row.appliesTeamIds, periodicity: row.periodicity, active: row.active, def: structuredClone(row.def), note: '' } : blank); }
  const errs = validateScorecard(f.def);
  const norm = normalizeWeights(f.def.items);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, description: f.description || null, appliesProfiles: f.appliesProfiles, appliesJobTitles: f.jobTitles.split(',').map((x) => x.trim()).filter(Boolean), appliesTeamIds: f.appliesTeamIds, periodicity: f.periodicity, def: f.def };
      return row === 'new' ? api('/performance/scorecards', { method: 'POST', body }) : api(`/performance/scorecards/${(row as Card).id}`, { method: 'PUT', body: { ...body, active: f.active, note: f.note } });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['performance'] }); onClose(); toast({ tone: 'success', message: 'Scorecard salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const setItems = (items: ScorecardDef['items']) => setF({ ...f, def: { ...f.def, items } });
  return (
    <Drawer open={!!row} onClose={onClose} title={row === 'new' ? 'Novo scorecard' : 'Editar scorecard'} width="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!!errs.length || f.name.trim().length < 3 || (row !== 'new' && f.note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="space-y-4">
        <FormField label="Nome da função" htmlFor="sc-name" required><Input id="sc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Vendedor, Analista de contratos…" /></FormField>
        <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Aplica-se aos perfis</legend><div className="flex flex-wrap gap-3">{PROFILE_KEYS.map((p) => <label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.appliesProfiles.includes(p)} onChange={(e) => setF({ ...f, appliesProfiles: e.target.checked ? [...f.appliesProfiles, p] : f.appliesProfiles.filter((x) => x !== p) })} />{PROFILE_LABELS[p]}</label>)}</div></fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Ou aos cargos" htmlFor="sc-jobs" hint="Separe por vírgula, como está no cadastro do usuário"><Input id="sc-jobs" value={f.jobTitles} onChange={(e) => setF({ ...f, jobTitles: e.target.value })} /></FormField>
          <FormField label="Periodicidade" htmlFor="sc-per"><Select id="sc-per" value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value as Card['periodicity'] })}>{(['semana', 'mes', 'trimestre', 'ano'] as const).map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</Select></FormField>
        </div>
        <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Ou às equipes</legend><div className="flex flex-wrap gap-3">{teams.map((t) => <label key={t.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.appliesTeamIds.includes(t.id)} onChange={(e) => setF({ ...f, appliesTeamIds: e.target.checked ? [...f.appliesTeamIds, t.id] : f.appliesTeamIds.filter((x) => x !== t.id) })} />{t.name}</label>)}</div></fieldset>
        <section>
          <h3 className="mb-2 font-bold text-ink">Indicadores e pesos</h3>
          {f.def.items.map((it, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <Select aria-label={`Indicador ${i + 1}`} className="w-auto min-w-[220px] flex-1" value={it.indicatorId} onChange={(e) => setItems(f.def.items.map((x, k2) => (k2 === i ? { ...x, indicatorId: e.target.value } : x)))}>{indicators.map((x) => <option key={x.id} value={x.id}>{x.def.name}</option>)}</Select>
              <Input aria-label={`Peso ${i + 1}`} className="w-20" inputMode="numeric" value={String(it.weight)} onChange={(e) => setItems(f.def.items.map((x, k2) => (k2 === i ? { ...x, weight: Number(e.target.value) || 0 } : x)))} />
              <span className="num w-12 text-xs text-muted">{Math.round((norm[i]?.norm ?? 0) * 100)}%</span>
              <Input aria-label={`Meta ${i + 1}`} className="w-28" inputMode="decimal" placeholder="meta padrão" value={it.target ?? ''} onChange={(e) => setItems(f.def.items.map((x, k2) => (k2 === i ? { ...x, target: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) } : x)))} />
              <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Retirar indicador ${i + 1}`} onClick={() => setItems(f.def.items.filter((_, k2) => k2 !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {indicators.length > 0 && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setItems([...f.def.items, { indicatorId: indicators.find((x) => !f.def.items.some((y) => y.indicatorId === x.id))?.id ?? indicators[0]!.id, weight: 10 }])}>Adicionar indicador</button>}
          <p className="mt-2 text-xs text-muted">A meta usada é, nesta ordem: a meta da pessoa no período, a meta deste scorecard e a meta padrão do indicador. Sem nenhuma, o indicador aparece "sem meta" e não pontua.</p>
        </section>
        <FormField label="Teto de cumprimento por indicador" htmlFor="sc-cap" hint="Ex.: 120% evita que um indicador muito acima compense todos os outros"><Input id="sc-cap" className="w-28" inputMode="numeric" value={String(Math.round(f.def.cap * 100))} onChange={(e) => setF({ ...f, def: { ...f.def, cap: (Number(e.target.value) || 100) / 100 } })} /></FormField>
        {row !== 'new' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Ativo</label>}
        {!!errs.length && <Notice tone="warning">{errs.join(' ')}</Notice>}
        {row !== 'new' && <FormField label="O que mudou" htmlFor="sc-note" required><Input id="sc-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>}
      </div>
    </Drawer>
  );
}

function Assignments({ cards }: { cards: Card[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const [userId, setUserId] = useState('');
  const current = cards.flatMap((c) => c.assignments.filter((a) => a.userId === userId).map((a) => ({ scorecardId: c.id, weight: a.weight })));
  const [items, setItems] = useState<{ scorecardId: string; weight: number }[] | null>(null);
  const list = items ?? current;
  const save = useMutation({
    mutationFn: () => api(`/performance/scorecards/assignments/${userId}`, { method: 'PUT', body: { items: list } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['performance'] }); setItems(null); toast({ tone: 'success', message: 'Composição salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card space-y-3 p-4">
      <div><h2 className="text-lg font-bold text-ink">Quem tem mais de uma função</h2><p className="text-sm text-muted">Sem composição definida, valem os scorecards da regra (perfil, cargo ou equipe) com pesos iguais. Aqui você define explicitamente quais valem e o peso de cada um.</p></div>
      <FormField label="Pessoa" htmlFor="as-user"><Select id="as-user" value={userId} onChange={(e) => { setUserId(e.target.value); setItems(null); }}><option value="">Escolha</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
      {userId && (
        <>
          {list.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Scorecard ${i + 1}`} className="w-auto min-w-[200px]" value={it.scorecardId} onChange={(e) => setItems(list.map((x, k2) => (k2 === i ? { ...x, scorecardId: e.target.value } : x)))}>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              <Input aria-label={`Peso do scorecard ${i + 1}`} className="w-20" inputMode="numeric" value={String(it.weight)} onChange={(e) => setItems(list.map((x, k2) => (k2 === i ? { ...x, weight: Number(e.target.value) || 1 } : x)))} />
              <span className="num text-xs text-muted">{Math.round((normalizeWeights(list)[i]?.norm ?? 0) * 100)}%</span>
              <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label="Retirar" onClick={() => setItems(list.filter((_, k2) => k2 !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2">
            {list.length < 5 && cards.length > 0 && <Button size="sm" variant="secondary" onClick={() => setItems([...list, { scorecardId: cards[0]!.id, weight: 50 }])}>Adicionar scorecard</Button>}
            {items && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar composição</Button>}
          </div>
        </>
      )}
    </section>
  );
}
