/**
 * Configurações → Responsabilidades de contratos (Playbook): quem ocupa cada papel (internos no cadastro do usuário,
 * externos como atores externos), responsáveis nomeados e SLA por ação, atores externos com canais de aviso e regras
 * de aviso por nível de responsabilidade (R/A/C/I e escalonamento).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus, UserPlus, X } from 'lucide-react';
import {
  NOTIFY_EVENTS, NOTIFY_EVENT_LABELS, PLAYBOOK_EXTERNAL_ROLES, PLAYBOOK_ROLES, PLAYBOOK_ROLE_LABELS, RACI_LETTERS, RACI_LETTER_LABELS,
  type NotifyRules, type PlaybookRole, type RaciLetter,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Actor = { id: string; name: string; organization: string | null; email?: string | null; whatsapp?: string | null; channels: string[]; roles: PlaybookRole[]; notes?: string | null; active: boolean };
type Person = { kind: 'user' | 'actor'; id: string; name: string; organization?: string | null; active?: boolean };
type Row = { key: string; phase: string; label: string; R: PlaybookRole[]; A: PlaybookRole; C: PlaybookRole[]; I: PlaybookRole[]; slaHours: number | null; assignees: Partial<Record<RaciLetter, Person[]>> };
type RoleInfo = { key: PlaybookRole; label: string; external: boolean; users: { id: string; name: string }[]; actors: { id: string; name: string }[] };
type Data = { roles: RoleInfo[]; phases: { key: string; label: string }[]; matrix: Row[]; rules: NotifyRules; actors: Actor[]; people: Person[] };
const LETTER_SHORT: Record<RaciLetter, string> = { R: 'Executa (R)', A: 'Responde (A)', C: 'Consultado (C)', I: 'Informado (I)' };
const rolesOfLetter = (row: Row, l: RaciLetter): PlaybookRole[] => (l === 'A' ? [row.A] : row[l]);

const code = (r: string) => r.replace('_', ' ');

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
          <p className="text-sm text-muted">Quem recebe cada aviso das atividades de contrato, pela matriz RACI da atividade. A abertura de cada e-mail é rastreada (quando e quantas vezes); pelo WhatsApp vai um link, e o acesso conta como leitura.</p></div>
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

function ActorModal({ actor, initialRole, onClose }: { actor: Actor | null; initialRole?: PlaybookRole; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: actor?.name ?? '', organization: actor?.organization ?? '', email: actor?.email ?? '', whatsapp: actor?.whatsapp ?? '', channels: actor?.channels ?? [], roles: actor?.roles ?? (initialRole ? [initialRole] : []), notes: actor?.notes ?? '', active: actor?.active ?? true });
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
        <p className="mb-1 text-xs text-muted">Só os papéis ocupados por atores externos. Os internos (GC, SC, ANC, ASC, CS, DIR) ficam no cadastro do usuário.</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{PLAYBOOK_EXTERNAL_ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => tog('roles', r)} />{PLAYBOOK_ROLE_LABELS[r]}</label>)}</div>
      </fieldset>
      <FormField label="Observações" htmlFor="ea-notes" className="mt-3"><Textarea id="ea-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      {actor && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Ativo (inativo não recebe avisos)</label>}
    </Modal>
  );
}

/** Escolha das pessoas de cada letra da RACI de uma atividade. Letra vazia = vale quem ocupa o papel da matriz. */
function AssigneesModal({ row, people, roles, onClose }: { row: Row; people: Person[]; roles: RoleInfo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [a, setA] = useState<Record<RaciLetter, Person[]>>(() => Object.fromEntries(RACI_LETTERS.map((l) => [l, (row.assignees[l] ?? []).map((p) => ({ kind: p.kind, id: p.id, name: p.name }))])) as Record<RaciLetter, Person[]>);
  const [sla, setSla] = useState(row.slaHours == null ? '' : String(row.slaHours));
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      await api(`/contract-playbook/assignees/${row.key}`, { method: 'PUT', body: { assignees: Object.fromEntries(RACI_LETTERS.map((l) => [l, a[l].map((p) => ({ kind: p.kind, id: p.id }))])) } });
      const slaHours = sla.trim() === '' ? null : Number(sla);
      if (slaHours !== row.slaHours) await api(`/contract-playbook/sla/${row.key}`, { method: 'PUT', body: { slaHours } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-playbook'] }); toast({ tone: 'success', message: 'Responsáveis salvos' }); onClose(); },
    onError: (e) => setErr(errMsg(e)),
  });
  const holders = (l: RaciLetter) => rolesOfLetter(row, l).map((r) => { const ri = roles.find((x) => x.key === r); const names = [...(ri?.users ?? []).map((u) => u.name), ...(ri?.actors ?? []).map((x) => x.name)]; return `${PLAYBOOK_ROLE_LABELS[r]}${names.length ? ` (${names.join(', ')})` : ' (em aberto)'}`; }).join('; ');
  const users = people.filter((p) => p.kind === 'user'), actors = people.filter((p) => p.kind === 'actor');
  return (
    <Modal open onClose={onClose} title={row.label} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => { setErr(''); m.mutate(); }}>Salvar</Button></>}>
      {err && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <p className="mb-3 text-sm text-muted">Indique as pessoas de cada nível de responsabilidade desta ação. Sem ninguém indicado, vale quem ocupa o papel da matriz. Quem executa (R) também inclui o dono de cada tarefa.</p>
      <div className="space-y-4">
        {RACI_LETTERS.map((l) => {
          const chosen = a[l];
          const single = l === 'A';
          const avail = (list: Person[]) => list.filter((p) => !chosen.some((c) => c.kind === p.kind && c.id === p.id));
          return (
            <fieldset key={l} className="border-t border-line pt-3">
              <legend className="text-sm font-semibold text-ink">{RACI_LETTER_LABELS[l]}{single && <span className="ml-1 text-xs font-normal text-muted">· uma pessoa</span>}</legend>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {chosen.map((p) => (
                  <span key={`${p.kind}:${p.id}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-sm text-ink">
                    {p.name}{p.kind === 'actor' && <span className="text-xs text-muted">(externo)</span>}
                    <button type="button" className="rounded-full p-0.5 text-muted hover:text-danger" aria-label={`Remover ${p.name} de ${RACI_LETTER_LABELS[l]}`} onClick={() => setA((x) => ({ ...x, [l]: x[l].filter((y) => !(y.kind === p.kind && y.id === p.id)) }))}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                {(!single || !chosen.length) && (
                  <Select aria-label={`Adicionar pessoa em ${RACI_LETTER_LABELS[l]}`} className="w-auto min-w-[220px]" value="" onChange={(e) => { const [kind, id] = e.target.value.split(':'); const p = people.find((x) => x.kind === kind && x.id === id); if (p) setA((x) => ({ ...x, [l]: single ? [p] : [...x[l], p] })); }}>
                    <option value="">{chosen.length ? 'Adicionar outra pessoa…' : 'Indicar pessoa…'}</option>
                    {avail(users).length > 0 && <optgroup label="Usuários do sistema">{avail(users).map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>}
                    {avail(actors).length > 0 && <optgroup label="Atores externos">{avail(actors).map((p) => <option key={p.id} value={`actor:${p.id}`}>{p.name}{p.organization ? ` · ${p.organization}` : ''}</option>)}</optgroup>}
                  </Select>
                )}
              </div>
              {!chosen.length && <p className="mt-1 text-xs text-muted">{rolesOfLetter(row, l).length ? `Pela matriz: ${holders(l)}` : 'A matriz não prevê ninguém neste nível.'}</p>}
            </fieldset>
          );
        })}
        <FormField label="Prazo (SLA) em horas" htmlFor="as-sla" hint="Tarefa criada para esta ação sem prazo informado recebe o prazo pelo SLA. Em branco: sem SLA." className="border-t border-line pt-3">
          <Input id="as-sla" inputMode="numeric" className="max-w-[160px]" placeholder="em aberto" value={sla} onChange={(e) => setSla(e.target.value.replace(/\D/g, ''))} />
        </FormField>
      </div>
    </Modal>
  );
}

function LetterCell({ row, l }: { row: Row; l: RaciLetter }) {
  const people = row.assignees[l] ?? [];
  const roles = rolesOfLetter(row, l);
  if (people.length) return <span className="text-ink">{people.map((p) => <span key={`${p.kind}:${p.id}`} className={clsx('block font-medium', p.active === false && 'text-danger line-through')} title={p.active === false ? 'Inativo: não recebe avisos' : undefined}>{p.name}{p.kind === 'actor' && <span className="ml-1 text-[11px] font-normal text-muted">ext.</span>}</span>)}</span>;
  return roles.length ? <span className="text-xs text-muted" title={roles.map((r) => PLAYBOOK_ROLE_LABELS[r]).join(', ')}>{roles.map(code).join(', ')} <span className="italic">(papel)</span></span> : <span className="text-xs text-muted">—</span>;
}

export function AdminContractResponsibilities() {
  const q = useQuery({ queryKey: ['contract-playbook'], queryFn: () => api<Data>('/contract-playbook') });
  const [edit, setEdit] = useState<Actor | 'new' | null>(null);
  const [newRole, setNewRole] = useState<PlaybookRole | undefined>();
  const [assign, setAssign] = useState<Row | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const roleCard = (r: RoleInfo) => (
    <div key={r.key} className="flex min-w-0 items-start justify-between gap-2 border border-line p-3 text-sm">
      <div className="min-w-0">
        <p className="font-semibold text-ink"><span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{code(r.key)}</span>{r.label}</p>
        <p className={clsx('mt-1', !r.users.length && !r.actors.length && 'text-muted')}>{(r.external ? r.actors.map((a) => a.name) : r.users.map((u) => u.name)).join(', ') || 'Em aberto'}</p>
      </div>
      {r.external && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} aria-label={`Cadastrar ator externo como ${r.label}`} onClick={() => { setNewRole(r.key); setEdit('new'); }}>Cadastrar</Button>}
    </div>
  );
  return (
    <div className="space-y-4">
      <Notice>Papéis internos (GC, SC, ANC, ASC, CS, DIR) são definidos no cadastro do usuário, em <Link className="link" to="/settings/users">Configurações → Usuários</Link>. Financeiro, Operação/T.I., Jurídico e as lideranças são atores externos, cadastrados aqui. Em cada ação você pode indicar as pessoas responsáveis.</Notice>

      <section className="card p-5" aria-label="Quem ocupa cada papel">
        <h2 className="mb-3 font-bold text-ink">Quem ocupa cada papel</h2>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Equipe interna · cadastro do usuário</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{d.roles.filter((r) => !r.external).map(roleCard)}</div>
        <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-muted">Atores externos · cadastrados abaixo</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{d.roles.filter((r) => r.external).map(roleCard)}</div>
      </section>

      <section className="card p-5" aria-label="Responsáveis por ação">
        <h2 className="font-bold text-ink">Responsáveis por ação</h2>
        <p className="mb-3 text-sm text-muted">Quem executa, responde, é consultado e é informado em cada ação do Playbook, e o prazo (SLA). Sem pessoa indicada, vale quem ocupa o papel da matriz.</p>
        {d.phases.map((p) => (
          <div key={p.key} className="mb-5">
            <h3 className="mb-1 text-sm font-bold text-ink">{p.label}</h3>
            <div className="overflow-x-auto"><table className="w-full min-w-[860px] table-fixed text-left text-sm">
              <colgroup><col className="w-[28%]" />{RACI_LETTERS.map((l) => <col key={l} className="w-[14%]" />)}<col className="w-[7%]" /><col className="w-[9%]" /></colgroup>
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Ação</th>{RACI_LETTERS.map((l) => <th key={l} className="px-3 py-2 font-medium" title={RACI_LETTER_LABELS[l]}>{LETTER_SHORT[l]}</th>)}<th className="px-3 py-2 font-medium">SLA</th><th className="px-3 py-2" /></tr></thead>
              <tbody>{d.matrix.filter((x) => x.phase === p.key).map((x) => (
                <tr key={x.key} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-ink">{x.label}</td>
                  {RACI_LETTERS.map((l) => <td key={l} className="px-3 py-2"><LetterCell row={x} l={l} /></td>)}
                  <td className="num whitespace-nowrap px-3 py-2 text-xs">{x.slaHours ? `${x.slaHours} h` : <span className="text-muted">em aberto</span>}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" icon={<Pencil className="h-4 w-4" />} aria-label={`Editar responsáveis: ${x.label}`} onClick={() => setAssign(x)}>Editar</Button></td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        ))}
      </section>

      <section className="card p-5" aria-label="Atores externos">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-bold text-ink">Atores externos</h2><p className="text-sm text-muted">Pessoas sem login no sistema (Financeiro, Operação/T.I., Jurídico, lideranças) que recebem os avisos e respondem pelo link.</p></div>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setNewRole(undefined); setEdit('new'); }}>Novo ator externo</Button>
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

      {edit && <ActorModal actor={edit === 'new' ? null : edit} initialRole={edit === 'new' ? newRole : undefined} onClose={() => setEdit(null)} />}
      {assign && <AssigneesModal row={assign} people={d.people} roles={d.roles} onClose={() => setAssign(null)} />}
    </div>
  );
}
