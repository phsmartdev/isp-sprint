/** Configuração → E-mail corporativo (Gmail): domínios, situação da integração, caixas compartilhadas, filas e regras de entrada. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import {
  MAIL_PRIORITIES, MAIL_PRIORITY_LABELS, ROUTING_MODES, ROUTING_MODE_LABELS, RULE_FIELDS, RULE_FIELD_LABELS, RULE_OPS, RULE_OP_LABELS, mailSettingsErrors, queueErrors, ruleErrors,
  type MailRuleDef, type RoutingMode, type RuleCondition,
} from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { useMailboxes } from '../email/Email';

type Settings = { allowedDomains: string[]; syncDays: number; canEdit: boolean; google: { configured: boolean; simulated: boolean; redirectUri: string; scopes: string[] } };
type Queue = { id: string; name: string; mailboxId: string | null; routing: RoutingMode; slaHours: number; members: string[]; active: boolean; rowVersion: number };
type Rule = { id: string; name: string; mailboxId: string | null; position: number; def: MailRuleDef; active: boolean; rowVersion: number };

export function AdminGmailSettings() {
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">E-mail corporativo (Gmail)</h1><p className="text-sm text-muted">Caixas do Google Workspace lidas e respondidas dentro do CRM, com filas, regras de entrada e prazo de primeira resposta.</p></div>
      <IntegrationCard />
      <SharedBoxes />
      <Queues />
      <Rules />
    </div>
  );
}

function useInvalidate() { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: ['mail'] }); }

function IntegrationCard() {
  const toast = useToast(); const inv = useInvalidate();
  const q = useQuery({ queryKey: ['mail', 'settings'], queryFn: () => api<Settings>('/mail/settings') });
  const [domains, setDomains] = useState(''); const [days, setDays] = useState('30');
  useEffect(() => { if (q.data) { setDomains(q.data.allowedDomains.join(', ')); setDays(String(q.data.syncDays)); } }, [q.data]);
  const list = domains.split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const errs = mailSettingsErrors({ allowedDomains: list, syncDays: Number(days) });
  const save = useMutation({ mutationFn: () => api('/mail/settings', { method: 'PUT', body: { allowedDomains: list, syncDays: Number(days) } }), onSuccess: () => { inv(); toast({ tone: 'success', message: 'Configuração salva' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={3} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card space-y-4 p-4" aria-label="Integração com o Google">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Integração com o Google</h2>
        <Chip tone={!d.google.configured ? 'red' : d.google.simulated ? 'orange' : 'yellow'}>{!d.google.configured ? 'Não configurada' : d.google.simulated ? 'Google simulado (teste)' : 'Validação real pendente'}</Chip>
      </div>
      <Notice tone="warning">
        A integração foi construída sobre a Gmail API e testada com um servidor do Google simulado. Para funcionar de verdade falta: (1) no Google Cloud, ativar a Gmail API no projeto do login com Google; (2) na tela de consentimento, incluir os escopos abaixo e, para uso só da empresa, marcar o app como Interno do Workspace; (3) cadastrar o endereço de retorno abaixo; (4) conectar uma caixa de teste e conferir leitura e envio.
      </Notice>
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div><dt className="font-semibold text-ink">Endereço de retorno (redirect URI)</dt><dd className="break-all text-muted"><code>{d.google.redirectUri}</code></dd></div>
        <div><dt className="font-semibold text-ink">Escopos pedidos</dt><dd className="break-all text-muted">{d.google.scopes.join(' ')}</dd></div>
        <div><dt className="font-semibold text-ink">Credenciais no servidor</dt><dd className="text-muted">{d.google.configured ? 'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET definidos (os mesmos do login com Google).' : 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel.'}</dd></div>
        <div><dt className="font-semibold text-ink">Atualização</dt><dd className="text-muted">Ao abrir o e-mail (a cada 2 min), no botão "Sincronizar agora" e na rotina diária. Aviso instantâneo do Gmail (Pub/Sub) fica para depois da validação.</dd></div>
      </dl>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <FormField label="Domínios da empresa" htmlFor="gm-d" hint="Só caixas destes domínios podem ser conectadas. Endereços destes domínios não contam como cliente."><Input id="gm-d" disabled={!d.canEdit} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="yepnet.com.br, bktele.com.br" /></FormField>
        <FormField label="Primeira sincronização (dias)" htmlFor="gm-s"><Input id="gm-s" type="number" min={1} max={90} disabled={!d.canEdit} value={days} onChange={(e) => setDays(e.target.value)} /></FormField>
      </div>
      {d.canEdit && <div className="flex flex-wrap items-center gap-3">{errs[0] && <span className="text-sm text-danger">{errs[0]}</span>}<Button variant="primary" disabled={!!errs.length} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>}
    </section>
  );
}

function SharedBoxes() {
  const toast = useToast(); const inv = useInvalidate();
  const boxes = useMailboxes();
  const [addr, setAddr] = useState(''); const [name, setName] = useState('');
  const add = useMutation({ mutationFn: () => api('/mail/mailboxes', { method: 'POST', body: { kind: 'compartilhada', address: addr.trim(), displayName: name.trim() || null } }), onSuccess: () => { setAddr(''); setName(''); inv(); toast({ tone: 'success', message: 'Caixa cadastrada. Agora conecte com o Google.' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const shared = (boxes.data?.items ?? []).filter((b) => b.kind === 'compartilhada');
  return (
    <section className="card space-y-3 p-4" aria-label="Caixas compartilhadas">
      <h2 className="text-lg font-bold text-ink">Caixas compartilhadas</h2>
      {shared.length ? <ul className="divide-y divide-line">{shared.map((b) => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b className="text-ink">{b.displayName ?? b.address}</b> <span className="text-muted">{b.address}</span></span><Chip tone={b.status === 'conectada' ? 'green' : b.status === 'erro' ? 'red' : 'neutral'}>{b.status === 'conectada' ? 'Conectada' : b.status === 'erro' ? 'Com erro' : b.status === 'pausada' ? 'Pausada' : 'Não conectada'}</Chip></li>)}</ul> : <p className="text-sm text-muted">Nenhuma ainda. Cadastre as caixas do time (ex.: comercial@, suporte@).</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <FormField label="Endereço" htmlFor="gm-ba"><Input id="gm-ba" type="email" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="comercial@yepnet.com.br" /></FormField>
        <FormField label="Nome exibido" htmlFor="gm-bn"><Input id="gm-bn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Comercial Yepnet" /></FormField>
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={!addr.includes('@')} loading={add.isPending} onClick={() => add.mutate()}>Cadastrar caixa</Button>
      </div>
      <p className="text-sm text-muted">Para conectar (entrar com a conta Google da caixa), use <Link to="/email/caixas" className="font-semibold text-primary hover:underline">E-mail → Caixas e conexão</Link>.</p>
    </section>
  );
}

function Queues() {
  const q = useQuery({ queryKey: ['mail', 'queues'], queryFn: () => api<{ items: Queue[] }>('/mail/queues') });
  const boxes = useMailboxes();
  const users = useLookups().data?.users ?? [];
  const [edit, setEdit] = useState<Queue | 'new' | null>(null);
  return (
    <section className="card space-y-3 p-4" aria-label="Filas">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold text-ink">Filas</h2><Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Nova fila</Button></div>
      {q.isLoading ? <LoadingRows rows={2} /> : !q.data?.items.length ? <p className="text-sm text-muted">Sem filas, as conversas das caixas compartilhadas ficam sem responsável até alguém assumir.</p> : (
        <ul className="divide-y divide-line">{q.data.items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0"><b className="text-ink">{x.name}</b>{!x.active && <Chip className="ml-2">Inativa</Chip>}<span className="block text-xs text-muted">{boxes.data?.items.find((b) => b.id === x.mailboxId)?.address ?? 'Sem caixa (só por regra)'} · 1ª resposta em {x.slaHours} h · {ROUTING_MODE_LABELS[x.routing].split(' (')[0]} · {x.members.map((m) => users.find((u) => u.id === m)?.name.split(' ')[0] ?? '?').join(', ')}</span></span>
            <Button size="sm" variant="ghost" onClick={() => setEdit(x)}>Editar</Button>
          </li>
        ))}</ul>
      )}
      {edit && <QueueDialog queue={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function QueueDialog({ queue, onClose }: { queue: Queue | null; onClose: () => void }) {
  const toast = useToast(); const inv = useInvalidate();
  const boxes = (useMailboxes().data?.items ?? []).filter((b) => b.kind === 'compartilhada');
  const users = (useLookups().data?.users ?? []);
  const [v, setV] = useState({ name: queue?.name ?? '', mailboxId: queue?.mailboxId ?? '', routing: queue?.routing ?? ('rodizio' as RoutingMode), slaHours: String(queue?.slaHours ?? 8), members: queue?.members ?? [], active: queue?.active ?? true });
  const errs = queueErrors({ name: v.name, mode: v.routing, members: v.members, slaHours: Number(v.slaHours) });
  const save = useMutation({
    mutationFn: () => queue
      ? api(`/mail/queues/${queue.id}`, { method: 'PATCH', body: { rowVersion: queue.rowVersion, name: v.name, routing: v.routing, slaHours: Number(v.slaHours), members: v.members, active: v.active } })
      : api('/mail/queues', { method: 'POST', body: { name: v.name, mailboxId: v.mailboxId || null, routing: v.routing, slaHours: Number(v.slaHours), members: v.members } }),
    onSuccess: () => { inv(); toast({ tone: 'success', message: queue ? 'Fila salva' : 'Fila criada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={queue ? 'Editar fila' : 'Nova fila'} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!!errs.length} loading={save.isPending} onClick={() => save.mutate()}>{queue ? 'Salvar fila' : 'Criar fila'}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Nome da fila" htmlFor="qd-n"><Input id="qd-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Comercial empresarial" /></FormField>
        <FormField label="Caixa" htmlFor="qd-b" hint={queue ? 'A caixa não muda depois de criada.' : 'Tudo o que chega nesta caixa entra na fila (as regras podem mandar para outra).'}><Select id="qd-b" disabled={!!queue} value={v.mailboxId} onChange={(e) => setV({ ...v, mailboxId: e.target.value })}><option value="">Nenhuma (só por regra)</option>{boxes.map((b) => <option key={b.id} value={b.id}>{b.displayName ?? b.address}</option>)}</Select></FormField>
        <FormField label="Direcionamento" htmlFor="qd-r"><Select id="qd-r" value={v.routing} onChange={(e) => setV({ ...v, routing: e.target.value as RoutingMode })}>{ROUTING_MODES.map((m) => <option key={m} value={m}>{ROUTING_MODE_LABELS[m]}</option>)}</Select></FormField>
        <FormField label="Prazo de 1ª resposta (horas)" htmlFor="qd-s"><Input id="qd-s" type="number" min={1} max={720} value={v.slaHours} onChange={(e) => setV({ ...v, slaHours: e.target.value })} /></FormField>
      </div>
      <fieldset className="mt-3"><legend className="mb-1.5 text-sm font-semibold text-ink">Quem atende</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">{users.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.members.includes(u.id)} onChange={(e) => setV({ ...v, members: e.target.checked ? [...v.members, u.id] : v.members.filter((x) => x !== u.id) })} />{u.name}</label>)}</div>
      </fieldset>
      {queue && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Fila ativa</label>}
      {errs[0] && <p className="mt-3 text-sm text-danger">{errs[0]}</p>}
    </Modal>
  );
}

function Rules() {
  const toast = useToast(); const inv = useInvalidate();
  const q = useQuery({ queryKey: ['mail', 'rules'], queryFn: () => api<{ items: Rule[] }>('/mail/rules') });
  const queues = useQuery({ queryKey: ['mail', 'queues'], queryFn: () => api<{ items: Queue[] }>('/mail/queues') });
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const [testing, setTesting] = useState(false);
  const patch = useMutation({ mutationFn: (v: { r: Rule; body: Record<string, unknown> }) => api(`/mail/rules/${v.r.id}`, { method: 'PATCH', body: { rowVersion: v.r.rowVersion, ...v.body } }), onSuccess: inv, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const qName = (id?: string | null) => queues.data?.items.find((x) => x.id === id)?.name;
  return (
    <section className="card space-y-3 p-4" aria-label="Regras de entrada">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-bold text-ink">Regras de entrada</h2><p className="text-xs text-muted">Avaliadas de cima para baixo na primeira mensagem de cada conversa; a primeira que casa vale.</p></div>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setTesting(true)}>Testar regras</Button><Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Nova regra</Button></div>
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : !q.data?.items.length ? <p className="text-sm text-muted">Nenhuma regra. Sem regra, a mensagem vai para a fila da caixa.</p> : (
        <ol className="divide-y divide-line">{q.data.items.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0"><b className="text-ink">{i + 1}. {r.name}</b>{!r.active && <Chip className="ml-2">Inativa</Chip>}
              <span className="block text-xs text-muted">Se {r.def.match === 'todas' ? 'todas' : 'qualquer uma'}: {r.def.conditions.map((c) => `${RULE_FIELD_LABELS[c.field]} ${RULE_OP_LABELS[c.op]} "${c.value}"`).join('; ')} → {[r.def.actions.ignore && 'arquivar', qName(r.def.actions.queueId) && `fila ${qName(r.def.actions.queueId)}`, r.def.actions.priority && `prioridade ${MAIL_PRIORITY_LABELS[r.def.actions.priority]}`, r.def.actions.tag && `etiqueta ${r.def.actions.tag}`].filter(Boolean).join(', ')}</span></span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Subir ${r.name}`} disabled={i === 0} onClick={() => patch.mutate({ r, body: { move: 'subir' } })}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" aria-label={`Descer ${r.name}`} disabled={i === q.data!.items.length - 1} onClick={() => patch.mutate({ r, body: { move: 'descer' } })}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ r, body: { active: !r.active } })}>{r.active ? 'Desativar' : 'Ativar'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Editar</Button>
            </span>
          </li>
        ))}</ol>
      )}
      {edit && <RuleDialog rule={edit === 'new' ? null : edit} queues={queues.data?.items ?? []} onClose={() => setEdit(null)} />}
      {testing && <RuleTester onClose={() => setTesting(false)} />}
    </section>
  );
}

function RuleDialog({ rule, queues, onClose }: { rule: Rule | null; queues: Queue[]; onClose: () => void }) {
  const toast = useToast(); const inv = useInvalidate();
  const boxes = (useMailboxes().data?.items ?? []).filter((b) => b.kind === 'compartilhada');
  const [name, setName] = useState(rule?.name ?? '');
  const [mailboxId, setMailboxId] = useState(rule?.mailboxId ?? '');
  const [def, setDef] = useState<MailRuleDef>(rule?.def ?? { match: 'todas', conditions: [{ field: 'assunto', op: 'contem', value: '' }], actions: {} });
  const errs = ruleErrors({ name, def });
  const setCond = (i: number, c: Partial<RuleCondition>) => setDef({ ...def, conditions: def.conditions.map((x, k) => (k === i ? { ...x, ...c } : x)) });
  const setAct = (a: Partial<MailRuleDef['actions']>) => setDef({ ...def, actions: { ...def.actions, ...a } });
  const save = useMutation({
    mutationFn: () => rule ? api(`/mail/rules/${rule.id}`, { method: 'PATCH', body: { rowVersion: rule.rowVersion, name, def } }) : api('/mail/rules', { method: 'POST', body: { name, mailboxId: mailboxId || null, def } }),
    onSuccess: () => { inv(); toast({ tone: 'success', message: rule ? 'Regra salva' : 'Regra criada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={rule ? 'Editar regra' : 'Nova regra'} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!!errs.length} loading={save.isPending} onClick={() => save.mutate()}>{rule ? 'Salvar regra' : 'Criar regra'}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Nome da regra" htmlFor="rd-n"><Input id="rd-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pedidos de cotação vão para o Comercial" /></FormField>
        <FormField label="Vale para" htmlFor="rd-b"><Select id="rd-b" disabled={!!rule} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}><option value="">Todas as caixas compartilhadas</option>{boxes.map((b) => <option key={b.id} value={b.id}>{b.displayName ?? b.address}</option>)}</Select></FormField>
      </div>
      <fieldset className="mt-3 space-y-2"><legend className="mb-1 text-sm font-semibold text-ink">Quando a mensagem atender a <Select aria-label="Combinação das condições" className="inline-block h-8 w-auto py-0" value={def.match} onChange={(e) => setDef({ ...def, match: e.target.value as 'todas' | 'qualquer' })}><option value="todas">todas</option><option value="qualquer">qualquer uma</option></Select> destas condições</legend>
        {def.conditions.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[10rem_9rem_1fr_auto]">
            <Select aria-label={`Campo da condição ${i + 1}`} value={c.field} onChange={(e) => setCond(i, { field: e.target.value as RuleCondition['field'] })}>{RULE_FIELDS.map((x) => <option key={x} value={x}>{RULE_FIELD_LABELS[x]}</option>)}</Select>
            <Select aria-label={`Operador da condição ${i + 1}`} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleCondition['op'] })}>{RULE_OPS.map((x) => <option key={x} value={x}>{RULE_OP_LABELS[x]}</option>)}</Select>
            <Input aria-label={`Valor da condição ${i + 1}`} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={c.field === 'dominio' ? 'prefeitura.se.gov.br' : 'cotação'} className="col-span-2 sm:col-span-1" />
            <Button size="sm" variant="ghost" disabled={def.conditions.length === 1} onClick={() => setDef({ ...def, conditions: def.conditions.filter((_, k) => k !== i) })}>Remover</Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} disabled={def.conditions.length >= 10} onClick={() => setDef({ ...def, conditions: [...def.conditions, { field: 'de', op: 'contem', value: '' }] })}>Condição</Button>
      </fieldset>
      <fieldset className="mt-3"><legend className="mb-1 text-sm font-semibold text-ink">Então</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Mandar para a fila" htmlFor="rd-q"><Select id="rd-q" disabled={def.actions.ignore} value={def.actions.queueId ?? ''} onChange={(e) => setAct({ queueId: e.target.value || null })}><option value="">Não muda</option>{queues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
          <FormField label="Prioridade" htmlFor="rd-p"><Select id="rd-p" value={def.actions.priority ?? ''} onChange={(e) => setAct({ priority: (e.target.value || null) as MailRuleDef['actions']['priority'] })}><option value="">Não muda</option>{MAIL_PRIORITIES.map((p) => <option key={p} value={p}>{MAIL_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
          <FormField label="Etiqueta" htmlFor="rd-t"><Input id="rd-t" maxLength={40} value={def.actions.tag ?? ''} onChange={(e) => setAct({ tag: e.target.value || null })} placeholder="licitação" /></FormField>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!def.actions.ignore} onChange={(e) => setAct({ ignore: e.target.checked, ...(e.target.checked ? { queueId: null, assignTo: null } : {}) })} />Arquivar sem passar por fila (propaganda, avisos automáticos)</label>
      </fieldset>
      {errs[0] && <p className="mt-3 text-sm text-danger">{errs[0]}</p>}
    </Modal>
  );
}

function RuleTester({ onClose }: { onClose: () => void }) {
  const boxes = (useMailboxes().data?.items ?? []).filter((b) => b.kind === 'compartilhada');
  const [v, setV] = useState({ mailboxId: boxes[0]?.id ?? '', from: '', subject: '', text: '' });
  const t = useMutation({ mutationFn: () => api<{ rule: { name: string } | null }>('/mail/rules/test', { method: 'POST', body: v }) });
  return (
    <Modal open onClose={onClose} title="Testar regras" footer={<><Button onClick={onClose}>Fechar</Button><Button variant="primary" disabled={!v.mailboxId || !v.from} loading={t.isPending} onClick={() => t.mutate()}>Testar</Button></>}>
      <div className="space-y-3">
        <FormField label="Caixa" htmlFor="rt-b"><Select id="rt-b" value={v.mailboxId} onChange={(e) => setV({ ...v, mailboxId: e.target.value })}>{boxes.map((b) => <option key={b.id} value={b.id}>{b.displayName ?? b.address}</option>)}</Select></FormField>
        <FormField label="Remetente" htmlFor="rt-f"><Input id="rt-f" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} placeholder="compras@prefeitura.test" /></FormField>
        <FormField label="Assunto" htmlFor="rt-s"><Input id="rt-s" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></FormField>
        <FormField label="Texto" htmlFor="rt-t"><Textarea id="rt-t" rows={3} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></FormField>
        {t.data && <Notice>{t.data.rule ? `Casa com a regra "${t.data.rule.name}".` : 'Nenhuma regra casa: vai para a fila da caixa.'}</Notice>}
      </div>
    </Modal>
  );
}
