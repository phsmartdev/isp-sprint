/** Painel das frentes de uma iniciativa: progresso por marcos homologados, marco atual, próxima ação, impedimentos e riscos. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { PROJECT_STATUS_LABELS, type FrontSummary, type ProjectStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { STATUS_TONE } from './shared';

export type FrontItem = { id: string; code: number; name: string; status: ProjectStatus; ownerName: string; dueOn: string | null; tags: string[]; lateTasks: number; summary: FrontSummary };
const DEFAULT_INITIATIVE = 'Implantação ISP Sprint';
const DEFAULT_FRONTS = ['Contratos', 'CRM', 'Projetos — ajustes e homologação', 'Relatórios'];
const todayIso = () => new Date().toLocaleDateString('en-CA');

export function FrontsPanel({ tag, onTag, allowCreate = true }: { tag: string; onTag: (t: string) => void; allowCreate?: boolean }) {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['projects', 'portfolio', tag], queryFn: () => api<{ items: FrontItem[]; tags: string[] }>(`/projects/portfolio${qs({ tag: tag || undefined })}`) });
  const items = q.data?.items ?? [];
  const tags = q.data?.tags ?? [];
  const homologated = items.reduce((a, x) => a + x.summary.progress.done, 0);
  const totalMs = items.reduce((a, x) => a + x.summary.progress.total, 0);
  const pending = items.reduce((a, x) => a + x.summary.pendingHomologation.length, 0);
  const imps = items.reduce((a, x) => a + x.summary.impediments.open, 0);
  const risks = items.reduce((a, x) => a + x.summary.risks.high, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Iniciativa (etiqueta)" htmlFor="fr-tag">
          <Select id="fr-tag" className="w-72" value={tag} onChange={(e) => onTag(e.target.value)}>
            <option value="">Todos os projetos ativos</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        {allowCreate && can('projetos', 'equipe') && <Button variant="primary" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Criar frentes da implantação</Button>}
      </div>
      {!!items.length && (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Marcos homologados" value={`${homologated} de ${totalMs}`} hint="progresso real das frentes" />
          <Kpi label="Aguardando homologação" value={String(pending)} hint="marcos concluídos sem aceite" warn={pending > 0} />
          <Kpi label="Impedimentos abertos" value={String(imps)} warn={imps > 0} />
          <Kpi label="Riscos altos ou críticos" value={String(risks)} warn={risks > 0} />
        </ul>
      )}
      <section className="card overflow-hidden" aria-label="Painel das frentes">
        {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? (
          <EmptyState title="Nenhuma frente aqui" description="Crie as frentes da implantação: um projeto por módulo, com marcos que só avançam com homologação." action={allowCreate && can('projetos', 'equipe') ? <Button variant="primary" onClick={() => setCreating(true)}>Criar frentes da implantação</Button> : undefined} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Frente', 'Responsável', 'Progresso real', 'Marco atual', 'Próxima ação', 'Impedimentos', 'Riscos'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((x) => {
                  const s = x.summary;
                  return (
                    <tr key={x.id} className="border-t border-line align-top">
                      <td className="px-4 py-3"><Link to={`/projetos/${x.id}?t=marcos`} className="font-semibold text-primary hover:underline">{tag && x.name.startsWith(`${tag} — `) ? x.name.slice(tag.length + 3) : x.name}</Link><span className="mt-1 block"><Chip tone={STATUS_TONE[x.status]}>{PROJECT_STATUS_LABELS[x.status]}</Chip></span></td>
                      <td className="whitespace-nowrap px-4 py-3">{x.ownerName}</td>
                      <td className="px-4 py-3">
                        <div className="h-2 w-36 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={s.progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${x.name}: ${s.progress.pct}%`}><div className="h-full bg-success" style={{ width: `${s.progress.pct}%` }} /></div>
                        <span className="num text-xs text-muted">{s.progress.done} de {s.progress.total} {s.progress.basis === 'homologados' ? 'homologado(s)' : 'concluído(s)'}</span>
                      </td>
                      <td className="px-4 py-3">{s.current ? <><span className="font-semibold text-ink">{s.current.name}</span><span className={clsx('num block text-xs', s.current.late ? 'font-semibold text-danger' : 'text-muted')}>{s.current.dueOn ? `${s.current.late ? 'venceu ' : 'até '}${fmtDate(s.current.dueOn)}` : 'sem data'}</span></> : <span className="text-muted">Todos homologados</span>}</td>
                      <td className="max-w-[280px] px-4 py-3"><span className={clsx(s.nextAction.kind === 'homologar' && 'font-semibold text-ink')}>{s.nextAction.text}</span>{(s.nextAction.ownerName || s.nextAction.dueOn) && <span className="num block text-xs text-muted">{[s.nextAction.ownerName, s.nextAction.dueOn && fmtDate(s.nextAction.dueOn)].filter(Boolean).join(', ')}</span>}</td>
                      <td className="num px-4 py-3">{s.impediments.open ? <Chip tone={s.impediments.high ? 'red' : 'yellow'}>{s.impediments.open} aberto(s)</Chip> : <span className="text-muted">Nenhum</span>}</td>
                      <td className="num px-4 py-3">{s.risks.open ? <Chip tone={s.risks.high ? 'red' : 'yellow'}>{s.risks.open} aberto(s){s.risks.high ? `, ${s.risks.high} alto(s)` : ''}</Chip> : <span className="text-muted">Nenhum</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CreateFrontsDialog open={creating} onClose={() => setCreating(false)} onCreated={(t) => onTag(t)} />
    </div>
  );
}

const Kpi = ({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) => (
  <li className="card p-4"><p className="text-sm text-muted">{label}</p><p className={clsx('num mt-1 whitespace-nowrap text-xl font-bold', warn ? 'text-danger' : 'text-ink')}>{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</li>
);

function CreateFrontsDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (tag: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const [initiative, setInitiative] = useState(DEFAULT_INITIATIVE);
  const [startOn, setStartOn] = useState(todayIso());
  const [fronts, setFronts] = useState<{ name: string; ownerId: string }[]>(DEFAULT_FRONTS.map((name) => ({ name, ownerId: '' })));
  const owner = (f: { ownerId: string }) => f.ownerId || me?.user.id || '';
  const mut = useMutation({
    mutationFn: () => api<{ ids: string[] }>('/projects/fronts', { method: 'POST', body: { initiative, startOn, fronts: fronts.map((f) => ({ name: f.name, ownerId: owner(f) })) } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['projects'] }); toast({ tone: 'success', message: `${r.ids.length} frente(s) criada(s)` }); onCreated(initiative.trim()); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const valid = initiative.trim().length >= 3 && fronts.length > 0 && fronts.every((f) => f.name.trim().length >= 2);
  return (
    <Modal open={open} onClose={onClose} title="Criar frentes da implantação" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={mut.isPending} onClick={() => mut.mutate()}>Criar {fronts.length} frente(s)</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Cada frente vira um projeto com o modelo “Implantação de módulo”: diagnóstico, ajustes, testes, homologação com usuários, entrada em produção e 30 dias de acompanhamento. Todos os marcos exigem homologação por quem não executou.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Iniciativa" htmlFor="fr-ini" required hint="Vira a etiqueta que agrupa as frentes no painel"><Input id="fr-ini" value={initiative} onChange={(e) => setInitiative(e.target.value)} /></FormField>
          <FormField label="Início" htmlFor="fr-start" required><Input id="fr-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} /></FormField>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Frentes</legend>
          {fronts.map((f, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <FormField label={`Frente ${i + 1}`} htmlFor={`fr-n-${i}`} className="min-w-[200px] flex-1"><Input id={`fr-n-${i}`} value={f.name} onChange={(e) => setFronts(fronts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></FormField>
              <FormField label="Responsável" htmlFor={`fr-o-${i}`} className="min-w-[180px] flex-1">
                <Select id={`fr-o-${i}`} value={owner(f)} onChange={(e) => setFronts(fronts.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FormField>
              <Button variant="secondary" aria-label={`Remover frente ${i + 1}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setFronts(fronts.filter((_, j) => j !== i))} />
            </div>
          ))}
          {fronts.length < 12 && <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setFronts([...fronts, { name: '', ownerId: '' }])}>Adicionar frente</Button>}
        </fieldset>
      </div>
    </Modal>
  );
}
