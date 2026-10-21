/** Projetos: tipos, consultas e componentes reaproveitados (lista, detalhe e painéis de vínculo). */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FolderKanban, Plus, X } from 'lucide-react';
import {
  PROJECT_HEALTH_LABELS, PROJECT_KINDS, PROJECT_KIND_LABELS, PROJECT_MEMBER_ROLES, PROJECT_MEMBER_ROLE_LABELS,
  type ProjectHealth, type ProjectKind, type ProjectMemberRole, type ProjectStatus, type ProjectTemplateDef,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export type Progress = { total: number; done: number; pct: number; lateTasks: number; lateMilestones: number; health: ProjectHealth; reasons: string[] };
export type ProjectLinks = { contact: { id: string; name: string } | null; opportunity: { id: string; name: string; code: number } | null; contract: { id: string; name: string } | null; arp: { id: string; name: string } | null; campaign?: { id: string; name: string } | null };
export type ProjectRow = {
  id: string; code: number; name: string; description: string | null; kind: ProjectKind; status: ProjectStatus; statusLabel: string; priority: 'baixa' | 'media' | 'alta';
  ownerId: string; ownerName: string | null; startOn: string; dueOn: string | null; completedAt: string | null; rowVersion: number;
  contactId: string | null; opportunityId: string | null; contractId: string | null; arpId: string | null; campaignId: string | null; progress: Progress; links: ProjectLinks;
  objective: string | null; category: string | null; tags: string[];
};
export type Stage = { id: string; name: string; position: number; done: boolean; wipLimit: number | null };
export type Milestone = { id: string; name: string; dueOn: string | null; completedAt: string | null; notes: string | null; position: number };
export type Member = { userId: string; role: ProjectMemberRole; name: string; email: string };
export type Task = { id: string; status: string; title: string; notes: string | null; priority: 'baixa' | 'media' | 'alta'; ownerId: string; ownerName: string; stageId: string | null; milestoneId: string | null; startOn: string | null; dueOn: string | null; position: number; completedAt: string | null; rowVersion: number };
export type ProjectDetail = ProjectRow & { stages: Stage[]; milestones: Milestone[]; members: Member[]; tasks: Task[]; can: { manage: boolean; work: boolean; view: boolean } };
export type Template = { id: string | null; key: string | null; name: string; kind: ProjectKind; description: string | null; def: ProjectTemplateDef; builtin: boolean };

export const HEALTH_TONE: Record<ProjectHealth, Tone> = { em_dia: 'green', atencao: 'yellow', atrasado: 'red', concluido: 'blue' };
export const STATUS_TONE: Record<ProjectStatus, Tone> = { planejamento: 'neutral', em_andamento: 'blue', pausado: 'orange', concluido: 'green', cancelado: 'red' };
export const PRIORITY_LABELS = { baixa: 'Baixa', media: 'Média', alta: 'Alta' } as const;

export function HealthChip({ p }: { p: Progress }) {
  return <Chip tone={HEALTH_TONE[p.health]} title={p.reasons.join('; ') || undefined}>{PROJECT_HEALTH_LABELS[p.health]}</Chip>;
}

export function ProgressBar({ p, className }: { p: Progress; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso">
        <div className={clsx('h-full rounded-full', p.health === 'atrasado' ? 'bg-danger' : p.health === 'atencao' ? 'bg-warning' : 'bg-primary')} style={{ width: `${p.pct}%` }} />
      </div>
      <span className="num text-xs font-semibold text-ink">{p.pct}%</span>
    </div>
  );
}

export function LinkChips({ links }: { links: ProjectLinks }) {
  const items = [
    links.contact && { to: `/customers/${links.contact.id}`, label: links.contact.name },
    links.opportunity && { to: `/opportunities/${links.opportunity.id}`, label: `OP-${links.opportunity.code}` },
    links.contract && { to: `/contracts/${links.contract.id}`, label: links.contract.name },
    links.arp && { to: `/contracts/atas/${links.arp.id}`, label: links.arp.name },
    links.campaign && { to: '/campaigns', label: `Campanha: ${links.campaign.name}` },
  ].filter(Boolean) as { to: string; label: string }[];
  if (!items.length) return null;
  return <span className="flex flex-wrap gap-1.5">{items.map((i) => <Link key={i.to} to={i.to} className="rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-semibold text-primary hover:underline">{i.label}</Link>)}</span>;
}

export const useTemplates = (enabled = true) => useQuery({ queryKey: ['project-templates'], enabled, queryFn: () => api<{ items: Template[] }>('/project-templates'), staleTime: 60_000 });

export type LinkPrefill = { contactId?: string | null; opportunityId?: string | null; contractId?: string | null; arpId?: string | null; label?: string; kind?: ProjectKind; name?: string };

const today = () => new Date().toLocaleDateString('en-CA');

export function NewProjectDialog({ open, onClose, prefill, onCreated }: { open: boolean; onClose: () => void; prefill?: LinkPrefill; onCreated?: (id: string) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const tpl = useTemplates(open);
  const [f, setF] = useState({ name: '', description: '', objective: '', category: '', tags: '', kind: 'interno' as ProjectKind, template: '', startOn: today(), dueOn: '', priority: 'media' as 'baixa' | 'media' | 'alta' });
  const [members, setMembers] = useState<{ userId: string; role: ProjectMemberRole }[]>([]);
  const [add, setAdd] = useState('');
  useEffect(() => {
    if (open) setF((x) => ({ ...x, name: prefill?.name ?? '', kind: prefill?.kind ?? x.kind, template: prefill?.kind === 'contrato_publico' ? 'b:execucao_ata' : prefill?.kind === 'implantacao' ? 'b:implantacao_corporativa' : '' }));
  }, [open, prefill?.name, prefill?.kind]);
  const chosen = tpl.data?.items.find((t) => (t.builtin ? `b:${t.key}` : `c:${t.id}`) === f.template);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/projects', {
      method: 'POST',
      body: {
        name: f.name, description: f.description || null, objective: f.objective || null, category: f.category || null, tags: f.tags.split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean), kind: f.kind, priority: f.priority, startOn: f.startOn, dueOn: f.dueOn || null,
        templateKey: f.template.startsWith('b:') ? f.template.slice(2) : null, templateId: f.template.startsWith('c:') ? f.template.slice(2) : null,
        members, contactId: prefill?.contactId ?? null, opportunityId: prefill?.opportunityId ?? null, contractId: prefill?.contractId ?? null, arpId: prefill?.arpId ?? null,
      },
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); toast({ tone: 'success', message: 'Projeto criado' }); if (onCreated) onCreated(r.id); else nav(`/projetos/${r.id}`); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const others = users.filter((u) => u.id !== me?.user.id && !members.some((x) => x.userId === u.id));
  return (
    <Modal open={open} onClose={onClose} title="Novo projeto" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.name.trim().length < 3 || !f.startOn} loading={m.isPending} onClick={() => m.mutate()}>Criar projeto</Button></>}>
      <div className="space-y-4">
        {prefill?.label && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Vinculado a <span className="font-semibold text-ink">{prefill.label}</span></p>}
        <FormField label="Nome do projeto" htmlFor="pj-name" required><Input id="pj-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="pj-kind"><Select id="pj-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ProjectKind })}>{PROJECT_KINDS.map((k) => <option key={k} value={k}>{PROJECT_KIND_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Modelo" htmlFor="pj-tpl" hint={chosen ? `${chosen.def.stages.length} etapas, ${chosen.def.milestones.length} marcos, ${chosen.def.tasks.length} tarefas` : 'Em branco: quadro com 4 etapas'}>
            <Select id="pj-tpl" value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
              <option value="">Em branco</option>
              {tpl.data?.items.map((t) => <option key={t.builtin ? `b:${t.key}` : `c:${t.id}`} value={t.builtin ? `b:${t.key}` : `c:${t.id}`}>{t.name}{t.builtin ? '' : ' (da empresa)'}</option>)}
            </Select>
          </FormField>
          <FormField label="Início" htmlFor="pj-start" required hint="As datas do modelo contam a partir daqui"><Input id="pj-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
          <FormField label="Prazo final" htmlFor="pj-due" hint="Em branco: calculado pelo modelo"><Input id="pj-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          <FormField label="Prioridade" htmlFor="pj-prio"><Select id="pj-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>{Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        </div>
        {chosen && <p className="text-sm text-muted">{chosen.description}</p>}
        <FormField label="Objetivo" htmlFor="pj-obj" hint="O resultado esperado, em uma frase"><Input id="pj-obj" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Categoria" htmlFor="pj-cat"><Input id="pj-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></FormField>
          <FormField label="Etiquetas" htmlFor="pj-tags" hint="Separe por vírgula"><Input id="pj-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></FormField>
        </div>
        <FormField label="Descrição" htmlFor="pj-desc"><Textarea id="pj-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Equipe</legend>
          <p className="text-xs text-muted">Você entra como gerente do projeto. Membros trabalham nas tarefas; observadores só acompanham.</p>
          {members.map((x) => (
            <div key={x.userId} className="flex items-center gap-2">
              <span className="min-w-[160px] text-sm">{users.find((u) => u.id === x.userId)?.name}</span>
              <Select aria-label={`Papel de ${users.find((u) => u.id === x.userId)?.name}`} className="w-auto" value={x.role} onChange={(e) => setMembers(members.map((y) => (y.userId === x.userId ? { ...y, role: e.target.value as ProjectMemberRole } : y)))}>{PROJECT_MEMBER_ROLES.map((r) => <option key={r} value={r}>{PROJECT_MEMBER_ROLE_LABELS[r]}</option>)}</Select>
              <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label="Tirar da equipe" onClick={() => setMembers(members.filter((y) => y.userId !== x.userId))}><X className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <Select aria-label="Pessoa para a equipe" className="w-auto min-w-[220px]" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Escolha uma pessoa</option>{others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            <Button variant="secondary" disabled={!add} onClick={() => { setMembers([...members, { userId: add, role: 'membro' }]); setAdd(''); }}>Adicionar</Button>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

/** Painel para as telas de cliente, oportunidade, contrato e ata: projetos vinculados e atalho para criar um. */
export function LinkedProjects({ prefill, title = 'Projetos' }: { prefill: LinkPrefill; title?: string }) {
  const { can } = useAuth();
  const allowed = can('projetos');
  const filter = { contactId: prefill.contactId ?? undefined, opportunityId: prefill.opportunityId ?? undefined, contractId: prefill.contractId ?? undefined, arpId: prefill.arpId ?? undefined };
  const q = useQuery({ queryKey: ['projects', 'linked', filter], enabled: allowed, queryFn: () => api<{ items: ProjectRow[] }>(`/projects${qs(filter)}`) });
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><FolderKanban className="h-5 w-5 text-primary" aria-hidden />{title}</h2>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Criar projeto</Button>
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : !q.data?.items.length ? <EmptyState title="Nenhum projeto vinculado" description="Implantações, execuções de ata e iniciativas ligadas a este registro aparecem aqui." /> : (
        <ul className="divide-y divide-line">
          {q.data.items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Link to={`/projetos/${p.id}`} className="min-w-0 flex-1 font-semibold text-primary hover:underline">{p.name}</Link>
              <Chip tone={STATUS_TONE[p.status]}>{p.statusLabel}</Chip>
              <HealthChip p={p.progress} />
              <ProgressBar p={p.progress} className="w-32" />
              <span className="num text-xs text-muted">{p.dueOn ? `até ${fmtDate(p.dueOn)}` : 'sem prazo'}</span>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog open={open} onClose={() => setOpen(false)} prefill={prefill} />
    </section>
  );
}
