/**
 * Configurações → Responsabilidades de contratos (Playbook): atores externos com canais de aviso, regras de aviso por
 * nível de responsabilidade (R/A/C/I e escalonamento) e SLA por atividade. Os papéis de cada pessoa ficam no cadastro
 * do usuário (Configurações → Usuários).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus } from 'lucide-react';
import {
  NOTIFY_EVENTS, NOTIFY_EVENT_LABELS, PLAYBOOK_ROLES, PLAYBOOK_ROLE_LABELS, RACI_LETTERS, RACI_LETTER_LABELS,
  type NotifyRules, type PlaybookRole, type RaciLetter,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Actor = { id: string; name: string; organization: string | null; email?: string | null; whatsapp?: string | null; channels: string[]; roles: PlaybookRole[]; notes?: string | null; active: boolean };
type Row = { key: string; phase: string; label: string; A: PlaybookRole; slaHours: number | null };
type Data = { roles: { key: PlaybookRole; label: string; users: { id: string; name: string }[]; actors: { id: string; name: string }[] }[]; phases: { key: string; label: string }[]; matrix: Row[]; rules: NotifyRules; actors: Actor[] };

const code = (r: string) => r.replace('_', ' ');

function SlaInput({ row }: { row: Row }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(row.slaHours == null ? '' : String(row.slaHours));
  const m = useMutation({
    mutationFn: () => api(`/contract-playbook/sla/${row.key}`, { method: 'PUT', body: { slaHours: v.trim() === '' ? null : Number(v) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-playbook'] }); toast({ tone: 'success', message: 'SLA salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const changed = (v.trim() === '' ? null : Number(v)) !== row.slaHours;
  return <Input aria-label={`SLA em horas: ${row.label}`} inputMode="numeric" className="w-24" placeholder="em aberto" value={v} disabled={m.isPending} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={() => { if (changed) m.mutate(); }} />;
}

function RulesEditor({ rules }: { rules: NotifyRules }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [r, setR] = useState<NotifyRules>(rules);
  const dirty = JSON.stringify(r) !== JSON.stringify(rules);
  const save = useMutation({
    mutationFn: () => api('/contract-playbook/notify-rules', { method: 'PUT', body: r }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-playbook'] }); toast({ tone: 'success', message: 'Regras de aviso salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const toggle = (ev: (typeof NOTIFY_EVENTS)[number], l: RaciLetter) => setR((x) => ({ ...x, events: { ...x.events, [ev]: x.events[ev].includes(l) ? x.events[ev].filter((y) => y !== l) : [...x.events[ev], l] } }));
  return (
    <section className="card p-5" aria-label="Avisos por nível de responsabilidade">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-bold text-ink">Avisos por nível de responsabilidade</h2>
          <p className="text-sm text-muted">Quem recebe cada aviso das atividades de contrato, pela matriz RACI da atividade. Todo aviso por e-mail ou WhatsApp leva o botão “Confirmar recebimento”.</p></div>
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Salvar regras</Button>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Evento</th>{RACI_LETTERS.map((l) => <th key={l} className="px-3 py-2 text-center font-medium" title={RACI_LETTER_LABELS[l]}>{RACI_LETTER_LABELS[l]}</th>)}</tr></thead>
        <tbody>{NOTIFY_EVENTS.map((ev) => (
          <tr key={ev} className="border-t border-line"><td className="px-3 py-2 text-ink">{NOTIFY_EVENT_LABELS[ev]}</td>
            {RACI_LETTERS.map((l) => <td key={l} className="px-3 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${NOTIFY_EVENT_LABELS[ev]}: ${RACI_LETTER_LABELS[l]}`} checked={r.events[ev].includes(l)} onChange={() => toggle(ev, l)} /></td>)}</tr>
        ))}</tbody>
      </table></div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FormField label="Avisar “perto de vencer” com quantas horas de antecedência" htmlFor="nr-soon" hint="Em branco: o aviso de prazo perto de vencer fica desligado.">
          <Input id="nr-soon" inputMode="numeric" className="max-w-[160px]" placeholder="em aberto" value={r.dueSoonHours ?? ''} onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setR((x) => ({ ...x, dueSoonHours: d ? Number(d) : null })); }} />
        </FormField>
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Escalonamento por atraso</p>
          <p className="mb-2 text-xs text-muted">Atividade vencida há mais de X horas avisa o papel indicado (além de R e A). Sem níveis, não há escalonamento.</p>
          <div className="space-y-2">{r.escalation.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span>Após</span>
              <Input aria-label={`Horas de atraso do nível ${i + 1}`} inputMode="numeric" className="w-20" value={e.afterHours} onChange={(ev) => { const d = Number(ev.target.value.replace(/\D/g, '')) || 1; setR((x) => ({ ...x, escalation: x.escalation.map((y, j) => (j === i ? { ...y, afterHours: d } : y)) })); }} />
              <span>h de atraso, avisar</span>
              <Select aria-label={`Papel do nível ${i + 1}`} className="w-auto" value={e.role} onChange={(ev) => setR((x) => ({ ...x, escalation: x.escalation.map((y, j) => (j === i ? { ...y, role: ev.target.value as PlaybookRole } : y)) }))}>{PLAYBOOK_ROLES.map((p) => <option key={p} value={p}>{PLAYBOOK_ROLE_LABELS[p]}</option>)}</Select>
              <Button size="sm" onClick={() => setR((x) => ({ ...x, escalation: x.escalation.filter((_, j) => j !== i) }))}>Remover</Button>
            </div>
          ))}</div>
          {r.escalation.length < 5 && <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setR((x) => ({ ...x, escalation: [...x.escalation, { afterHours: 24, role: 'SC' }] }))}>Nível de escalonamento</Button>}
        </div>
      </div>
    </section>
  );
}

function ActorModal({ actor, onClose }: { actor: Actor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: actor?.name ?? '', organization: actor?.organization ?? '', email: actor?.email ?? '', whatsapp: actor?.whatsapp ?? '', channels: actor?.channels ?? [], roles: actor?.roles ?? [], notes: actor?.notes ?? '', active: actor?.active ?? true });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => { const body = { ...f, organization: f.organization || null, email: f.email || null, whatsapp: f.whatsapp || null, notes: f.notes || null }; return actor ? api(`/contract-external-actors/${actor.id}`, { method: 'PUT', body }) : api('/contract-external-actors', { method: 'POST', body }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-playbook'] }); toast({ tone: 'success', message: 'Ator externo salvo' }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrs({ ...e.fieldErrors(), _: e.problem.detail ?? e.problem.title }); },
  });
  const tog = <K extends 'channels' | 'roles'>(k: K, v: string) => setF((x) => ({ ...x, [k]: (x[k] as string[]).includes(v) ? (x[k] as string[]).filter((y) => y !== v) : [...(x[k] as string[]), v] }));
  return (
    <Modal open onClose={onClose} title={actor ? `Editar ${actor.name}` : 'Novo ator externo'} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={f.name.trim().length < 2} onClick={() => { setErrs({}); m.mutate(); }}>Salvar</Button></>}>
      {errs._ && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{errs._}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="ea-name" required><Input id="ea-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="Empresa ou órgão" htmlFor="ea-org"><Input id="ea-org" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} /></FormField>
        <FormField label="E-mail" htmlFor="ea-email" error={errs.email}><Input id="ea-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
        <FormField label="WhatsApp (com DDD)" htmlFor="ea-wa" error={errs.whatsapp}><Input id="ea-wa" inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></FormField>
      </div>
      <fieldset className="mt-3"><legend className="mb-1 text-sm font-semibold text-ink">Como avisar</legend>
        <div className="flex gap-4 text-sm">{[['email', 'E-mail'], ['whatsapp', 'WhatsApp']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f.channels.includes(k!)} onChange={() => tog('channels', k!)} />{l}</label>)}</div>
        <p className="mt-1 text-xs text-muted">O aviso leva o link para confirmar o recebimento e responder; a resposta fica no histórico da atividade e do contrato.</p>
      </fieldset>
      <fieldset className="mt-3"><legend className="mb-1 text-sm font-semibold text-ink">Papéis no Playbook</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{PLAYBOOK_ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => tog('roles', r)} />{PLAYBOOK_ROLE_LABELS[r]}</label>)}</div>
      </fieldset>
      <FormField label="Observações" htmlFor="ea-notes" className="mt-3"><Textarea id="ea-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      {actor && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Ativo (inativo não recebe avisos)</label>}
    </Modal>
  );
}

export function AdminContractResponsibilities() {
  const q = useQuery({ queryKey: ['contract-playbook'], queryFn: () => api<Data>('/contract-playbook') });
  const [edit, setEdit] = useState<Actor | 'new' | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <Notice>Os papéis de cada pessoa (GC, SC, ANC, ASC…) são definidos no cadastro do usuário, em <Link className="link" to="/settings/users">Configurações → Usuários</Link>. Aqui ficam os atores externos, os avisos e os prazos.</Notice>

      <section className="card p-5" aria-label="Quem ocupa cada papel">
        <h2 className="mb-3 font-bold text-ink">Quem ocupa cada papel</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{d.roles.map((r) => (
          <div key={r.key} className="min-w-0 border border-line p-3 text-sm">
            <p className="font-semibold text-ink"><span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{code(r.key)}</span>{r.label}</p>
            <p className={clsx('mt-1', !r.users.length && !r.actors.length && 'text-muted')}>{[...r.users.map((u) => u.name), ...r.actors.map((a) => `${a.name} (externo)`)].join(', ') || 'Em aberto'}</p>
          </div>
        ))}</div>
      </section>

      <section className="card p-5" aria-label="Atores externos">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold text-ink">Atores externos</h2><p className="text-sm text-muted">Pessoas sem login no sistema (diretoria, jurídico ou financeiro terceirizado…) que recebem os avisos e respondem pelo link.</p></div>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Novo ator externo</Button>
        </div>
        {!d.actors.length ? <p className="py-4 text-sm text-muted">Nenhum ator externo cadastrado.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-2 pr-3 font-medium">Nome</th><th className="py-2 pr-3 font-medium">Papéis</th><th className="py-2 pr-3 font-medium">Canais</th><th className="py-2 pr-3 font-medium">Contato</th><th className="py-2" /></tr></thead>
            <tbody>{d.actors.map((a) => (
              <tr key={a.id} className={clsx('border-t border-line', !a.active && 'opacity-50')}>
                <td className="py-2 pr-3"><span className="font-semibold text-ink">{a.name}</span>{a.organization && <span className="block text-xs text-muted">{a.organization}</span>}{!a.active && <Chip>Inativo</Chip>}</td>
                <td className="py-2 pr-3 text-xs">{a.roles.map((r) => PLAYBOOK_ROLE_LABELS[r]).join(', ') || '—'}</td>
                <td className="py-2 pr-3 text-xs">{a.channels.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(' · ') || <span className="text-danger">nenhum</span>}</td>
                <td className="py-2 pr-3 text-xs">{[a.email, a.whatsapp].filter(Boolean).join(' · ') || '—'}</td>
                <td className="py-2 text-right"><Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(a)}>Editar</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <RulesEditor key={JSON.stringify(d.rules)} rules={d.rules} />

      <section className="card p-5" aria-label="SLA por atividade">
        <h2 className="font-bold text-ink">Prazo (SLA) por atividade</h2>
        <p className="mb-3 text-sm text-muted">Em horas. Tarefa criada para a atividade sem prazo informado recebe o prazo pelo SLA. Em branco: sem SLA.</p>
        {d.phases.map((p) => (
          <div key={p.key} className="mb-4">
            <h3 className="mb-1 text-sm font-bold text-ink">{p.label}</h3>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><tbody>{d.matrix.filter((x) => x.phase === p.key).map((x) => (
              <tr key={x.key} className="border-t border-line"><td className="py-1.5 pr-3 text-ink">{x.label}</td><td className="py-1.5 pr-3 text-xs text-muted">A: {PLAYBOOK_ROLE_LABELS[x.A]}</td><td className="w-28 py-1.5"><SlaInput row={x} /></td></tr>
            ))}</tbody></table></div>
          </div>
        ))}
      </section>
      {edit && <ActorModal actor={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
