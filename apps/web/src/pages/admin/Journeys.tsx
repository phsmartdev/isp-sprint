/** Configurações → Jornadas: funis, etapas, quem trabalha em cada um, campos do cadastro e automações. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Trash2, Workflow, Zap } from 'lucide-react';
import { SEGMENTS, SEGMENT_LABELS, type Segment } from '@isp/domain';
import {
  ACTION_LABELS, ACTION_TYPES, AUTOMATION_EMAIL_VARIABLES, FIELD_TYPES, FIELD_TYPE_LABELS, TRIGGER_LABELS, TRIGGER_TYPES,
  type Automation, type AutomationAction,
} from '@isp/shared';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { stageColor } from '../../components/badges';

type Req = { proposta?: boolean; plano?: boolean; proximaAcao?: boolean; respostasObrigatorias?: boolean };
type JStage = { id?: string; key?: string; name: string; kind: 'open' | 'won' | 'lost'; color: string | null; requirements: Req; count?: number };
type JField = { chave?: string; rotulo: string; tipo: (typeof FIELD_TYPES)[number]; opcoes: string[]; obrigatorio: boolean };
type JAutomation = Automation & { id: string; runs: { n: number; errors: number; last: string } | null };
export type Journey = {
  id: string; key: string; name: string; description: string | null; segments: Segment[]; isDefault: boolean;
  members: { userId: string; name: string; email: string }[];
  stages: (JStage & { id: string; key: string; count: number })[];
  fields: JField[];
  automations: JAutomation[];
  open: number;
};
type Run = { id: string; status: string; detail: { actions?: { action: string; error?: string }[] } | null; createdAt: string; automation: string; opportunityId: string; opportunityTitle: string };

const useJourneys = () => useQuery({ queryKey: ['admin', 'journeys'], queryFn: () => api<{ items: Journey[] }>('/admin/journeys') });
const REQ_LABELS: Record<keyof Req, string> = { plano: 'Plano escolhido', proposta: 'Proposta anexada', proximaAcao: 'Próxima ação definida', respostasObrigatorias: 'Perguntas obrigatórias respondidas' };
const KIND_LABELS = { open: 'Aberta', won: 'Venda fechada', lost: 'Perdida' } as const;
const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => x.message)].filter((v, i, a) => a.indexOf(v) === i).join(' ') : (e as Error).message);

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['lookups'] });
    qc.invalidateQueries({ queryKey: ['pipeline'] });
    qc.invalidateQueries({ queryKey: ['playbook'] });
  };
}

// =================================================================== lista

export function AdminJourneys() {
  const q = useJourneys();
  const runs = useQuery({ queryKey: ['admin', 'automation-runs'], queryFn: () => api<{ items: Run[] }>('/admin/automation-runs') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const current = q.data?.items.find((j) => j.id === editing) ?? null;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Jornadas de vendas</h2>
            <p className="max-w-3xl text-sm text-muted">Cada jornada é um funil com suas etapas, quem trabalha nele, os campos do cadastro e as automações. Sem membros, todos usam; quem não é membro vê só as próprias oportunidades da jornada.</p>
          </div>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova jornada</Button>
        </div>
        {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {q.data!.items.map((j) => (
              <li key={j.id} className="flex flex-col rounded-md border border-line p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 font-bold text-ink"><Workflow className="h-4 w-4 text-primary" aria-hidden />{j.name}</p>
                    {j.description && <p className="text-sm text-muted">{j.description}</p>}
                  </div>
                  {j.isDefault && <Chip tone="blue">Padrão</Chip>}
                </div>
                <ol className="mb-3 flex flex-wrap gap-1" aria-label="Etapas">
                  {j.stages.map((s, i) => {
                    const c = stageColor(s.key, s.color, i);
                    return <li key={s.id} className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${c}22`, color: c }}>{s.name}{s.count ? ` · ${s.count}` : ''}</li>;
                  })}
                </ol>
                <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-muted">Abertas</dt><dd className="num text-ink">{j.open}</dd>
                  <dt className="text-muted">Segmentos</dt><dd className="text-ink">{j.segments.length ? j.segments.map((s) => SEGMENT_LABELS[s]).join(', ') : 'Nenhum (escolha manual)'}</dd>
                  <dt className="text-muted">Quem trabalha</dt><dd className="text-ink">{j.members.length ? `${j.members.length} pessoa(s)` : 'Todos'}</dd>
                  <dt className="text-muted">Campos próprios</dt><dd className="num text-ink">{j.fields.length}</dd>
                  <dt className="text-muted">Automações</dt><dd className="num text-ink">{j.automations.filter((a) => a.ativo).length} ativa(s)</dd>
                </dl>
                <div className="mt-auto"><Button size="sm" onClick={() => setEditing(j.id)}>Configurar</Button></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-lg font-bold text-ink">Últimas execuções de automações</h2>
        <p className="mb-3 text-sm text-muted">O que cada automação fez e se deu certo. Falhas não bloqueiam a mudança de etapa.</p>
        {runs.isLoading ? <LoadingRows rows={3} /> : !runs.data?.items.length ? <p className="text-sm text-muted">Nenhuma execução ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Quando', 'Automação', 'Oportunidade', 'Resultado'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {runs.data.items.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="num whitespace-nowrap px-4 py-2 text-text">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2 font-medium text-ink">{r.automation}</td>
                    <td className="px-4 py-2"><a className="link" href={`/opportunities/${r.opportunityId}`}>{r.opportunityTitle}</a></td>
                    <td className="px-4 py-2"><Chip tone={r.status === 'ok' ? 'green' : r.status === 'erro' ? 'red' : 'neutral'}>{r.status === 'ok' ? 'Executada' : r.status === 'erro' ? 'Falhou' : r.status}</Chip>{r.detail?.actions?.length ? <span className="ml-2 text-xs text-muted">{r.detail.actions.map((x) => `${ACTION_LABELS[x.action as AutomationAction['tipo']] ?? x.action}${x.error ? `: ${x.error}` : ''}`).join(' · ')}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateJourney open={creating} journeys={q.data?.items ?? []} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setEditing(id); }} />
      {current && <JourneyEditor key={current.id} journey={current} all={q.data!.items} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SegmentPicker({ value, onChange, idPrefix }: { value: Segment[]; onChange: (v: Segment[]) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink">Usada automaticamente para</legend>
      <div className="flex flex-wrap gap-3">
        {SEGMENTS.map((s) => (
          <label key={s} htmlFor={`${idPrefix}-${s}`} className="flex items-center gap-2 text-sm">
            <input id={`${idPrefix}-${s}`} type="checkbox" checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
            {SEGMENT_LABELS[s]}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">Cada tipo de deal entra em uma jornada só. Sem nenhum, a jornada é escolhida à mão no cadastro.</p>
    </fieldset>
  );
}

function CreateJourney({ open, journeys, onClose, onCreated }: { open: boolean; journeys: Journey[]; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ name: '', description: '', copyFromId: '', segments: [] as Segment[] });
  useEffect(() => { if (open) setForm({ name: '', description: '', copyFromId: '', segments: [] }); }, [open]);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/admin/journeys', { method: 'POST', body: { name: form.name, description: form.description || null, segments: form.segments, copyFromId: form.copyFromId || null } }),
    onSuccess: (r) => { invalidate(); toast({ tone: 'success', message: 'Jornada criada' }); onCreated(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Nova jornada" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={form.name.trim().length < 2} onClick={() => m.mutate()}>Criar jornada</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome" htmlFor="nj-name" required><Input id="nj-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Upgrade de base" data-autofocus /></FormField>
        <FormField label="Descrição" htmlFor="nj-desc"><Input id="nj-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <FormField label="Começar com as etapas de" htmlFor="nj-copy" hint="Você ajusta as etapas depois">
          <Select id="nj-copy" value={form.copyFromId} onChange={(e) => setForm({ ...form, copyFromId: e.target.value })}>
            <option value="">Funil básico (6 etapas)</option>
            {journeys.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </Select>
        </FormField>
        <SegmentPicker value={form.segments} onChange={(segments) => setForm({ ...form, segments })} idPrefix="nj-seg" />
      </div>
    </Modal>
  );
}

// =================================================================== editor

function JourneyEditor({ journey, all, onClose }: { journey: Journey; all: Journey[]; onClose: () => void }) {
  const [tab, setTab] = useState<'geral' | 'etapas' | 'campos' | 'automacoes'>('geral');
  return (
    <Drawer open onClose={onClose} title={`Jornada ${journey.name}`} width="lg">
      <Tabs label="Partes da jornada" value={tab} onChange={setTab} className="mb-4" tabs={[
        { key: 'geral', label: 'Geral e pessoas' },
        { key: 'etapas', label: 'Etapas', count: journey.stages.length },
        { key: 'campos', label: 'Campos', count: journey.fields.length },
        { key: 'automacoes', label: 'Automações', count: journey.automations.filter((a) => a.ativo).length },
      ]} />
      {tab === 'geral' && <GeneralTab journey={journey} onClose={onClose} />}
      {tab === 'etapas' && <StagesTab journey={journey} />}
      {tab === 'campos' && <FieldsTab journey={journey} />}
      {tab === 'automacoes' && <AutomationsTab journey={journey} all={all} />}
    </Drawer>
  );
}

function GeneralTab({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const lookups = useLookups();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ name: journey.name, description: journey.description ?? '', segments: journey.segments, isDefault: journey.isDefault, memberIds: journey.members.map((m) => m.userId) });
  const [filter, setFilter] = useState('');
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/admin/journeys/${journey.id}`, { method: 'PATCH', body }),
    onSuccess: (_r, body) => { invalidate(); toast({ tone: 'success', message: body.active === false ? 'Jornada desativada' : 'Jornada salva' }); if (body.active === false) onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const users = (lookups.data?.users ?? []).filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      <FormField label="Nome" htmlFor="jg-name" required><Input id="jg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="Descrição" htmlFor="jg-desc"><Input id="jg-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
      <SegmentPicker value={form.segments} onChange={(segments) => setForm({ ...form, segments })} idPrefix="jg-seg" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} disabled={journey.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />Jornada padrão (quando nenhuma outra se aplica)</label>
      <fieldset className="rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Quem trabalha nesta jornada</legend>
        <p className="mb-2 text-xs text-muted">{form.memberIds.length ? `${form.memberIds.length} selecionada(s). Só elas criam e veem oportunidades da equipe aqui; a gerência vê tudo.` : 'Ninguém marcado: todos trabalham nesta jornada.'}</p>
        <Input aria-label="Filtrar pessoas" className="mb-2" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por nome" />
        <ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {users.map((u) => (
            <li key={u.id}>
              <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={form.memberIds.includes(u.id)} onChange={(e) => setForm({ ...form, memberIds: e.target.checked ? [...form.memberIds, u.id] : form.memberIds.filter((x) => x !== u.id) })} />
                {u.name}
              </label>
            </li>
          ))}
        </ul>
        {form.memberIds.length > 0 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setForm({ ...form, memberIds: [] })}>Liberar para todos</Button>}
      </fieldset>
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        <Button variant="danger" disabled={journey.isDefault || save.isPending} onClick={() => { if (confirm(`Desativar a jornada ${journey.name}? Ela some dos formulários; o histórico fica.`)) save.mutate({ active: false }); }}>Desativar jornada</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ name: form.name, description: form.description || null, segments: form.segments, isDefault: form.isDefault || undefined, memberIds: form.memberIds })}>Salvar</Button>
      </div>
    </div>
  );
}

function StagesTab({ journey }: { journey: Journey }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [stages, setStages] = useState<JStage[]>(() => journey.stages.map((s) => ({ ...s, requirements: { ...s.requirements } })));
  const upd = (i: number, v: Partial<JStage>) => setStages((x) => x.map((s, j) => (j === i ? { ...s, ...v } : s)));
  const moveBy = (i: number, d: number) => setStages((x) => { const y = [...x]; const [it] = y.splice(i, 1); y.splice(i + d, 0, it!); return y; });
  const save = useMutation({
    mutationFn: () => api(`/admin/journeys/${journey.id}/stages`, { method: 'PUT', body: { stages: stages.map((s) => ({ key: s.key, name: s.name, kind: s.kind, color: s.color || null, requirements: { proposta: !!s.requirements.proposta, plano: !!s.requirements.plano, proximaAcao: !!s.requirements.proximaAcao, respostasObrigatorias: !!s.requirements.respostasObrigatorias } })) } }),
    onSuccess: () => { invalidate(); toast({ tone: 'success', message: 'Etapas salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const won = stages.filter((s) => s.kind === 'won').length;
  const lost = stages.filter((s) => s.kind === 'lost').length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Arraste a ordem com as setas. Marque o que a etapa exige para entrar: o vendedor só avança quando cumprir (a proposta pode ser anexada na própria janela de avanço).</p>
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <li key={s.id ?? `new-${i}`} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: `${stageColor(s.key ?? '', s.color, i)}22`, color: stageColor(s.key ?? '', s.color, i) }}>{i + 1}</span>
              <Input aria-label={`Nome da etapa ${i + 1}`} className="min-w-[160px] flex-1" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} />
              <Select aria-label="Tipo da etapa" className="w-auto" value={s.kind} onChange={(e) => upd(i, { kind: e.target.value as JStage['kind'] })}>
                {(['open', 'won', 'lost'] as const).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </Select>
              <input aria-label="Cor" type="color" className="h-9 w-10 cursor-pointer rounded border border-line" value={s.color ?? stageColor(s.key ?? '', null, i)} onChange={(e) => upd(i, { color: e.target.value.toUpperCase() })} />
              <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => moveBy(i, -1)} icon={<ArrowUp className="h-4 w-4" />} />
              <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === stages.length - 1} onClick={() => moveBy(i, 1)} icon={<ArrowDown className="h-4 w-4" />} />
              <Button size="sm" variant="ghost" aria-label="Remover etapa" disabled={!!s.count} title={s.count ? `${s.count} oportunidade(s) nesta etapa` : undefined} onClick={() => setStages((x) => x.filter((_, j) => j !== i))} icon={<Trash2 className="h-4 w-4 text-danger" />} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-9">
              {(Object.keys(REQ_LABELS) as (keyof Req)[]).filter((k) => s.kind !== 'lost' || k === 'proximaAcao').map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-xs text-text">
                  <input type="checkbox" checked={!!s.requirements[k]} onChange={(e) => upd(i, { requirements: { ...s.requirements, [k]: e.target.checked } })} />
                  {REQ_LABELS[k]}
                </label>
              ))}
              {!!s.count && <span className="text-xs text-muted">{s.count} oportunidade(s)</span>}
            </div>
          </li>
        ))}
      </ol>
      {(won !== 1 || lost !== 1) && <Notice tone="warning">A jornada precisa de exatamente uma etapa “Venda fechada” e uma “Perdida”.</Notice>}
      <div className="flex justify-between gap-2">
        <Button icon={<Plus className="h-4 w-4" />} disabled={stages.length >= 15} onClick={() => setStages((x) => { const at = Math.max(0, x.findIndex((s) => s.kind !== 'open')); const y = [...x]; y.splice(at === -1 ? x.length : at, 0, { name: 'Nova etapa', kind: 'open', color: null, requirements: {} }); return y; })}>Adicionar etapa</Button>
        <Button variant="primary" loading={save.isPending} disabled={won !== 1 || lost !== 1} onClick={() => save.mutate()}>Salvar etapas</Button>
      </div>
    </div>
  );
}

function FieldsTab({ journey }: { journey: Journey }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [fields, setFields] = useState<(JField & { opcoesText: string })[]>(() => journey.fields.map((f) => ({ ...f, opcoesText: f.opcoes.join(', ') })));
  const upd = (i: number, v: Partial<JField & { opcoesText: string }>) => setFields((x) => x.map((f, j) => (j === i ? { ...f, ...v } : f)));
  const save = useMutation({
    mutationFn: () => api(`/admin/journeys/${journey.id}/fields`, { method: 'PUT', body: { fields: fields.map((f) => ({ chave: f.chave, rotulo: f.rotulo, tipo: f.tipo, obrigatorio: f.obrigatorio, opcoes: f.tipo === 'lista' ? f.opcoesText.split(',').map((o) => o.trim()).filter(Boolean) : [] })) } }),
    onSuccess: () => { invalidate(); toast({ tone: 'success', message: 'Campos salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Estes campos aparecem no cadastro e na tela da oportunidade, além dos campos fixos (nome do deal, cliente, telefone, e-mail, endereço, tipo, canal e responsável). Remover um campo esconde o campo; o valor já preenchido continua guardado.</p>
      {!fields.length && <EmptyState title="Sem campos próprios" description="Adicione o que esta jornada precisa saber, como CNPJ ou melhor horário." />}
      <ul className="space-y-2">
        {fields.map((f, i) => (
          <li key={f.chave ?? `new-${i}`} className="grid grid-cols-1 gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto_auto] sm:items-end">
            <FormField label="Rótulo" htmlFor={`jf-l-${i}`}><Input id={`jf-l-${i}`} value={f.rotulo} onChange={(e) => upd(i, { rotulo: e.target.value })} /></FormField>
            <FormField label="Tipo" htmlFor={`jf-t-${i}`}>
              <Select id={`jf-t-${i}`} value={f.tipo} onChange={(e) => upd(i, { tipo: e.target.value as JField['tipo'] })}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}</Select>
            </FormField>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={f.obrigatorio} onChange={(e) => upd(i, { obrigatorio: e.target.checked })} />Obrigatório</label>
            <Button variant="ghost" aria-label="Remover campo" onClick={() => setFields((x) => x.filter((_, j) => j !== i))} icon={<Trash2 className="h-4 w-4 text-danger" />} />
            {f.tipo === 'lista' && <FormField className="sm:col-span-4" label="Opções (separadas por vírgula)" htmlFor={`jf-o-${i}`}><Input id={`jf-o-${i}`} value={f.opcoesText} onChange={(e) => upd(i, { opcoesText: e.target.value })} placeholder="Manhã, Tarde, Noite" /></FormField>}
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-2">
        <Button icon={<Plus className="h-4 w-4" />} disabled={fields.length >= 40} onClick={() => setFields((x) => [...x, { rotulo: '', tipo: 'texto', opcoes: [], opcoesText: '', obrigatorio: false }])}>Adicionar campo</Button>
        <Button variant="primary" loading={save.isPending} disabled={fields.some((f) => f.rotulo.trim().length < 2)} onClick={() => save.mutate()}>Salvar campos</Button>
      </div>
    </div>
  );
}

// =================================================================== automações

function describeTrigger(a: Automation, j: Journey) {
  const st = (k?: string | null) => j.stages.find((s) => s.key === k)?.name ?? k;
  if (a.gatilho.tipo === 'entrou_na_etapa') return `Quando entrar em “${st(a.gatilho.etapa)}”`;
  if (a.gatilho.tipo === 'parada') return `Quando ficar ${a.gatilho.dias} dia(s) parada${a.gatilho.etapa ? ` em “${st(a.gatilho.etapa)}”` : ''}`;
  return `Quando: ${TRIGGER_LABELS[a.gatilho.tipo].toLowerCase()}`;
}

function AutomationsTab({ journey, all }: { journey: Journey; all: Journey[] }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<JAutomation | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (a: JAutomation) => api(`/admin/automations/${a.id}`, { method: 'PUT', body: { nome: a.nome, ativo: !a.ativo, gatilho: a.gatilho, acoes: a.acoes } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Automações rodam depois que a mudança é gravada: criam tarefas, enviam e-mails, movem o card, trocam o responsável ou duplicam a oportunidade (com todo o histórico) em outro funil.</p>
      {!journey.automations.length && <EmptyState title="Nenhuma automação" description="Exemplo: quando perder, duplicar na jornada de Recuperação." />}
      <ul className="space-y-2">
        {journey.automations.map((a) => (
          <li key={a.id} className={clsx('rounded-md border p-3', a.ativo ? 'border-line' : 'border-dashed border-line opacity-70')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink"><Zap className="h-4 w-4 text-warning" aria-hidden />{a.nome}</p>
                <p className="text-sm text-text">{describeTrigger(a, journey)}</p>
                <p className="text-sm text-muted">{a.acoes.map((x) => ACTION_LABELS[x.tipo]).join(' → ')}</p>
                {a.runs && <p className="text-xs text-muted">{a.runs.n} execução(ões){a.runs.errors ? `, ${a.runs.errors} com falha` : ''} · última {fmtDateTime(a.runs.last)}</p>}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={a.ativo} onChange={() => toggle.mutate(a)} />Ativa</label>
                <Button size="sm" onClick={() => setEditing(a)}>Editar</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nova automação</Button>
      {editing && <AutomationEditor journey={journey} all={all} automation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function defaultAction(tipo: AutomationAction['tipo'], journey: Journey, all: Journey[]): AutomationAction {
  switch (tipo) {
    case 'criar_tarefa': return { tipo, titulo: 'Retornar ao cliente', tipoAtividade: 'tarefa', prazoDias: 1, responsavel: 'dono' };
    case 'enviar_email': return { tipo, para: 'responsavel', assunto: 'Atualização: {{oportunidade.titulo}}', corpo: 'Olá {{responsavel.nome}},\n\nA oportunidade {{oportunidade.titulo}} ({{cliente.nome}}) entrou em {{etapa.nome}}.\n\n{{link}}' };
    case 'mover_etapa': return { tipo, etapa: journey.stages.find((s) => s.kind === 'open')?.key ?? '' };
    case 'duplicar': return { tipo, jornada: (all.find((j) => j.id !== journey.id) ?? journey).key, etapa: null, responsavel: 'mesmo' };
    case 'atribuir': return { tipo, responsavel: 'dono' };
  }
}

function PersonSelect({ id, value, onChange, keep }: { id: string; value: string; onChange: (v: string) => void; keep: 'dono' | 'mesmo' }) {
  const lookups = useLookups();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={keep}>{keep === 'dono' ? 'Responsável da oportunidade' : 'O mesmo responsável'}</option>
      {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  );
}

function AutomationEditor({ journey, all, automation, onClose }: { journey: Journey; all: Journey[]; automation: JAutomation | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [a, setA] = useState<Automation>(() => automation ? { nome: automation.nome, ativo: automation.ativo, gatilho: { ...automation.gatilho }, acoes: automation.acoes.map((x) => ({ ...x })) } : { nome: '', ativo: true, gatilho: { tipo: 'perdida', etapa: null, dias: null }, acoes: [defaultAction('duplicar', journey, all)] });
  const [error, setError] = useState<string | null>(null);
  const updAction = (i: number, v: Partial<AutomationAction>) => setA((x) => ({ ...x, acoes: x.acoes.map((ac, j) => (j === i ? ({ ...ac, ...v } as AutomationAction) : ac)) }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...a, gatilho: { tipo: a.gatilho.tipo, etapa: ['entrou_na_etapa', 'parada'].includes(a.gatilho.tipo) ? a.gatilho.etapa || null : null, dias: a.gatilho.tipo === 'parada' ? a.gatilho.dias : null } };
      return automation ? api(`/admin/automations/${automation.id}`, { method: 'PUT', body }) : api(`/admin/journeys/${journey.id}/automations`, { method: 'POST', body });
    },
    onSuccess: () => { invalidate(); toast({ tone: 'success', message: 'Automação salva' }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  const openStages = journey.stages.filter((s) => s.kind === 'open');
  return (
    <Modal open onClose={onClose} title={automation ? 'Editar automação' : 'Nova automação'} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={a.nome.trim().length < 2} onClick={() => save.mutate()}>Salvar automação</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <FormField label="Nome" htmlFor="au-name" required><Input id="au-name" value={a.nome} onChange={(e) => setA({ ...a, nome: e.target.value })} placeholder="Ex.: Perdeu → Recuperação" data-autofocus /></FormField>
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Quando</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Gatilho" htmlFor="au-trg">
              <Select id="au-trg" value={a.gatilho.tipo} onChange={(e) => setA({ ...a, gatilho: { ...a.gatilho, tipo: e.target.value as Automation['gatilho']['tipo'] } })}>{TRIGGER_TYPES.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}</Select>
            </FormField>
            {(a.gatilho.tipo === 'entrou_na_etapa' || a.gatilho.tipo === 'parada') && (
              <FormField label="Etapa" htmlFor="au-st">
                <Select id="au-st" value={a.gatilho.etapa ?? ''} onChange={(e) => setA({ ...a, gatilho: { ...a.gatilho, etapa: e.target.value || null } })}>
                  {a.gatilho.tipo === 'parada' ? <option value="">Qualquer etapa aberta</option> : <option value="">Escolha</option>}
                  {(a.gatilho.tipo === 'parada' ? openStages : journey.stages).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </Select>
              </FormField>
            )}
            {a.gatilho.tipo === 'parada' && <FormField label="Dias sem mudança" htmlFor="au-days"><Input id="au-days" type="number" min={1} max={365} value={a.gatilho.dias ?? ''} onChange={(e) => setA({ ...a, gatilho: { ...a.gatilho, dias: e.target.value ? Number(e.target.value) : null } })} /></FormField>}
          </div>
          {a.gatilho.tipo === 'parada' && <p className="mt-2 text-xs text-muted">Verificado uma vez por dia pelo agendamento. Cada oportunidade dispara uma vez por etapa.</p>}
        </fieldset>
        <fieldset className="space-y-2 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Então</legend>
          {a.acoes.map((ac, i) => (
            <div key={i} className="rounded-md bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Select aria-label={`Ação ${i + 1}`} className="w-auto" value={ac.tipo} onChange={(e) => setA((x) => ({ ...x, acoes: x.acoes.map((y, j) => (j === i ? defaultAction(e.target.value as AutomationAction['tipo'], journey, all) : y)) }))}>
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
                </Select>
                <Button size="sm" variant="ghost" aria-label="Remover ação" disabled={a.acoes.length === 1} onClick={() => setA((x) => ({ ...x, acoes: x.acoes.filter((_, j) => j !== i) }))} icon={<Trash2 className="h-4 w-4 text-danger" />} />
              </div>
              {ac.tipo === 'criar_tarefa' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <FormField label="Título da tarefa" htmlFor={`au-${i}-t`}><Input id={`au-${i}-t`} value={ac.titulo} onChange={(e) => updAction(i, { titulo: e.target.value })} /></FormField>
                  <FormField label="Tipo" htmlFor={`au-${i}-k`}>
                    <Select id={`au-${i}-k`} value={ac.tipoAtividade} onChange={(e) => updAction(i, { tipoAtividade: e.target.value as typeof ac.tipoAtividade })}>
                      {(['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'] as const).map((t) => <option key={t} value={t}>{{ tarefa: 'Tarefa', ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', visita: 'Visita' }[t]}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Prazo (dias depois)" htmlFor={`au-${i}-d`}><Input id={`au-${i}-d`} type="number" min={0} max={365} value={ac.prazoDias} onChange={(e) => updAction(i, { prazoDias: Number(e.target.value || 0) })} /></FormField>
                  <FormField label="Para quem" htmlFor={`au-${i}-p`}><PersonSelect id={`au-${i}-p`} value={ac.responsavel} keep="dono" onChange={(v) => updAction(i, { responsavel: v })} /></FormField>
                </div>
              )}
              {ac.tipo === 'enviar_email' && (
                <div className="space-y-2">
                  <FormField label="Para" htmlFor={`au-${i}-to`}>
                    <Select id={`au-${i}-to`} value={ac.para} onChange={(e) => updAction(i, { para: e.target.value as typeof ac.para })}>
                      <option value="responsavel">Responsável da oportunidade</option><option value="cliente">Cliente</option><option value="gerencia">Gerência</option>
                    </Select>
                  </FormField>
                  <FormField label="Assunto" htmlFor={`au-${i}-s`}><Input id={`au-${i}-s`} value={ac.assunto} onChange={(e) => updAction(i, { assunto: e.target.value })} /></FormField>
                  <FormField label="Mensagem" htmlFor={`au-${i}-b`} hint={`Variáveis: ${AUTOMATION_EMAIL_VARIABLES.map((v) => `{{${v}}}`).join(' ')}`}><Textarea id={`au-${i}-b`} className="min-h-[120px]" value={ac.corpo} onChange={(e) => updAction(i, { corpo: e.target.value })} /></FormField>
                  {ac.para === 'cliente' && <p className="text-xs text-muted">Só envia se o cliente tiver e-mail e o SMTP estiver configurado.</p>}
                </div>
              )}
              {ac.tipo === 'mover_etapa' && (
                <FormField label="Mover para" htmlFor={`au-${i}-m`}>
                  <Select id={`au-${i}-m`} value={ac.etapa} onChange={(e) => updAction(i, { etapa: e.target.value })}>{journey.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>
                </FormField>
              )}
              {ac.tipo === 'duplicar' && (() => {
                const target = all.find((j) => j.key === ac.jornada);
                return (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <FormField label="Funil de destino" htmlFor={`au-${i}-j`}>
                      <Select id={`au-${i}-j`} value={ac.jornada} onChange={(e) => updAction(i, { jornada: e.target.value, etapa: null })}>{all.map((j) => <option key={j.id} value={j.key}>{j.name}</option>)}</Select>
                    </FormField>
                    <FormField label="Etapa de destino" htmlFor={`au-${i}-je`}>
                      <Select id={`au-${i}-je`} value={ac.etapa ?? ''} onChange={(e) => updAction(i, { etapa: e.target.value || null })}>
                        <option value="">Primeira etapa</option>
                        {target?.stages.filter((s) => s.kind === 'open').map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                      </Select>
                    </FormField>
                    <FormField label="Responsável" htmlFor={`au-${i}-jr`}><PersonSelect id={`au-${i}-jr`} value={ac.responsavel} keep="mesmo" onChange={(v) => updAction(i, { responsavel: v })} /></FormField>
                    <p className="text-xs text-muted sm:col-span-3">A cópia leva histórico, atividades, respostas do roteiro e anexos, com link para a original.</p>
                  </div>
                );
              })()}
              {ac.tipo === 'atribuir' && <FormField label="Novo responsável" htmlFor={`au-${i}-a`}><PersonSelect id={`au-${i}-a`} value={ac.responsavel} keep="dono" onChange={(v) => updAction(i, { responsavel: v })} /></FormField>}
            </div>
          ))}
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={a.acoes.length >= 10} onClick={() => setA((x) => ({ ...x, acoes: [...x.acoes, defaultAction('criar_tarefa', journey, all)] }))}>Adicionar ação</Button>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.ativo} onChange={(e) => setA({ ...a, ativo: e.target.checked })} />Ativa</label>
      </div>
    </Modal>
  );
}
