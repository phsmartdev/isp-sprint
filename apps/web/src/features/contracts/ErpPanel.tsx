/**
 * Aba "Cadastro ERP" do contrato: prepara, confere e acompanha o cadastro no IXC.
 * Herdado vem do contrato/conta/oportunidade na hora (não é copiado); o manual vence o herdado.
 * A conferência é de outra pessoa; o lançamento no IXC é manual (token só leitura) e a conferência no IXC é por leitura.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, FileDown, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import {
  ERP_CYCLES, ERP_CYCLE_LABELS, ERP_FIELDS, ERP_GROUPS, ERP_GROUP_LABELS, type ErpCycle, type ErpExtra, type ErpFieldDef, type ErpGroup, type ErpItem, type ErpStatus, type IxcCompare,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg, type ContractDetail } from './shared';

type Field = { key: string; value: string | null; inherited: string | number | null; origin: 'herdado' | 'manual' | 'vazio'; state: 'pendente' | 'preenchido' | 'validado' | 'divergente' | 'sincronizado'; ixcFound: string | null; hasValue: boolean };
type Issue = { key: string; group: ErpGroup; label: string; message: string };
type Can = { fill: boolean; review: boolean; reviewBlockedReason: string | null; launch: boolean; check: boolean; checkBlockedReason: string | null };
type Rec = {
  id: string; seq: number; cycle: ErpCycle; status: ErpStatus; statusLabel: string; rowVersion: number;
  fields: Field[]; items: ErpItem[]; extras: ErpExtra[]; evidenceDocIds: string[]; documents: { id: string; name: string; category: string; version: number; signed: boolean }[];
  issues: Issue[]; branchName: string | null; ixcClientId: string | null; ixcContractId: string | null; compare: IxcCompare[] | null;
  submittedByName: string | null; submittedAt: string | null; approvedByName: string | null; approvedAt: string | null; approvedHash: string | null;
  launcherName: string | null; launchedByName: string | null; launchedAt: string | null; checkedByName: string | null; checkedAt: string | null;
  editorNames: string[]; events: { id: string; action: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string; actorName: string | null; data: Record<string, unknown> | null }[];
  can: Can;
};
type Resp = { cycles: { id: string; seq: number; cycle: ErpCycle; status: ErpStatus; statusLabel: string; createdAt: string; checkedAt: string | null }[]; current: Rec | null; legacyRef: string | null; canStart: boolean };

const TONE: Record<ErpStatus, Tone> = {
  nao_iniciado: 'neutral', em_preenchimento: 'blue', aguardando_conferencia: 'orange', devolvido: 'orange', aprovado: 'purple',
  aguardando_lancamento: 'orange', lancado: 'blue', conferido_ixc: 'green', divergente: 'red',
};
const STATE_LABEL: Record<Field['state'] | 'herdado', string> = { herdado: 'Herdado', pendente: 'Pendente', preenchido: 'Manual', validado: 'Validado', divergente: 'Divergente', sincronizado: 'Conferido no IXC' };
const STATE_TONE: Record<Field['state'] | 'herdado', string> = {
  herdado: 'bg-surface-2 text-muted', pendente: 'bg-warning-soft text-[#C2610C]', preenchido: 'bg-primary-soft text-primary', validado: 'bg-success-soft text-success',
  divergente: 'bg-danger-soft text-danger', sincronizado: 'bg-success-soft text-success',
};
const ACTION_LABEL: Record<string, string> = {
  aberto: 'Ciclo aberto', salvo: 'Alterações salvas', aprovacao_invalidada: 'Campo crítico alterado: aprovação invalidada', submit: 'Enviado para conferência', approve: 'Aprovado',
  return: 'Devolvido para correção', release: 'Liberado para lançamento', launch: 'Lançamento no IXC registrado', check: 'Conferência no IXC', leitura_ixc: 'Leitura do IXC (campos para conferir à mão)',
  reopen: 'Cadastro reaberto', senha_visualizada: 'Senha da Central visualizada', ficha_gerada: 'Ficha de lançamento gerada',
};
const editable = (st: ErpStatus) => st !== 'aguardando_conferencia';
const centsToInput = (v: string | null) => (v == null || v === '' ? '' : (Number(v) / 100).toFixed(2).replace('.', ','));
const inputToCents = (v: string) => { const n = Number(v.replace(/\./g, '').replace(',', '.')); return v.trim() === '' ? '' : Number.isFinite(n) ? String(Math.round(n * 100)) : v; };
const showInherited = (def: ErpFieldDef, v: string | number | null) => (v == null || v === '' ? null : def.type === 'money' ? fmtBRL(Number(v)) : def.type === 'date' ? fmtDate(String(v)) : def.options?.find((o) => o.value === String(v))?.label ?? String(v));

export function ErpPanel({ c }: { c: ContractDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['contract', c.id, 'erp'];
  const q = useQuery({ queryKey: key, queryFn: () => api<Resp>(`/contracts/${c.id}/erp`) });
  const [cycle, setCycle] = useState<ErpCycle>('implantacao');
  const start = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/erp`, { method: 'POST', body: { cycle } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ tone: 'success', message: 'Cadastro ERP aberto' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const starter = d.canStart && (
    <div className="flex flex-wrap items-end gap-2">
      <FormField label="Motivo do cadastro" htmlFor="erp-cycle"><Select id="erp-cycle" value={cycle} onChange={(e) => setCycle(e.target.value as ErpCycle)}>{ERP_CYCLES.map((k) => <option key={k} value={k}>{ERP_CYCLE_LABELS[k]}</option>)}</Select></FormField>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} loading={start.isPending} onClick={() => start.mutate()}>{d.current ? 'Abrir novo ciclo' : 'Iniciar Cadastro ERP'}</Button>
    </div>
  );
  if (!d.current) return (
    <EmptyState title="Cadastro ERP não iniciado" description={`Reúne, confere e acompanha os dados que vão para o IXC.${d.legacyRef ? ` Código registrado antes desta etapa: ${d.legacyRef}.` : ''}`} action={starter || undefined} />
  );
  return <RecordView key={`${d.current.id}:${d.current.rowVersion}`} c={c} r={d.current} cycles={d.cycles} starter={d.current.status === 'conferido_ixc' ? starter : null} />;
}

function RecordView({ c, r, cycles, starter }: { c: ContractDetail; r: Rec; cycles: Resp['cycles']; starter: React.ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['contract', c.id, 'erp'];
  const byKey = useMemo(() => new Map(r.fields.map((f) => [f.key, f])), [r.fields]);
  const issueOf = useMemo(() => new Map(r.issues.map((i) => [i.key, i.message])), [r.issues]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ErpItem[]>(r.items);
  const [extras, setExtras] = useState<ErpExtra[]>(r.extras);
  const [evidence, setEvidence] = useState<string[]>(r.evidenceDocIds);
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'return' | 'launch' | 'reopen' | 'release'>(null);
  const [check, setCheck] = useState<null | { compare: IxcCompare[]; pending: string[]; ixcError: string | null }>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(ERP_GROUPS.map((g) => [g, g === 'A' || r.issues.some((i) => i.group === g)])));
  const canWrite = r.can.fill && editable(r.status);
  const itemsDirty = JSON.stringify(items) !== JSON.stringify(r.items);
  const extrasDirty = JSON.stringify(extras) !== JSON.stringify(r.extras);
  const evidenceDirty = [...evidence].sort().join() !== [...r.evidenceDocIds].sort().join();
  const dirty = Object.keys(draft).length > 0 || itemsDirty || extrasDirty || evidenceDirty || secret !== null;

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => api<{ status: ErpStatus; invalidated: string[] }>(`/contracts/${c.id}/erp/${r.id}`, { method: 'PUT', body: {
      rowVersion: r.rowVersion, values: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() === '' ? null : v])),
      items: itemsDirty ? items : undefined, extras: extrasDirty ? extras : undefined, evidenceDocIds: evidenceDirty ? evidence : undefined, secret: secret === null ? undefined : secret || null,
    } }),
    onSuccess: (x) => { toast({ tone: x.invalidated.length ? 'error' : 'success', message: x.invalidated.length ? 'Campo crítico alterado: o cadastro volta para conferência.' : 'Cadastro salvo' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ status: ErpStatus; compare?: IxcCompare[]; pendingManual?: string[]; ixcError?: string | null }>(`/contracts/${c.id}/erp/${r.id}/actions`, { method: 'POST', body: { rowVersion: r.rowVersion, ...body } }),
    onSuccess: (x, body) => {
      setModal(null);
      if (body.action === 'check' && x.pendingManual?.length) { setCheck({ compare: x.compare ?? [], pending: x.pendingManual, ixcError: x.ixcError ?? null }); refresh(); return; }
      setCheck(null);
      toast({ tone: x.status === 'divergente' ? 'error' : 'success', message: x.status === 'divergente' ? 'Divergência encontrada: pendência de correção criada.' : 'Feito' });
      refresh(); qc.invalidateQueries({ queryKey: ['contract', c.id] });
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError && e.problem.errors?.length ? `${errMsg(e)}` : errMsg(e) }),
  });
  const reveal = useMutation({ mutationFn: () => api<{ secret: string }>(`/contracts/${c.id}/erp/${r.id}/secret`), onSuccess: (x) => { setRevealed(x.secret); refresh(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });

  const valueOf = (def: ErpFieldDef) => (def.key in draft ? draft[def.key]! : byKey.get(def.key)?.origin === 'manual' ? byKey.get(def.key)?.value ?? '' : '');
  const set = (k: string, v: string) => setDraft((x) => ({ ...x, [k]: v }));
  const field = (def: ErpFieldDef) => {
    const f = byKey.get(def.key)!;
    const id = `erp-${def.key}`;
    const issue = issueOf.get(def.key);
    const inh = showInherited(def, f.inherited);
    const badge: Field['state'] | 'herdado' = def.key in draft ? 'preenchido' : f.origin === 'herdado' && f.state !== 'divergente' && f.state !== 'sincronizado' && f.state !== 'validado' ? 'herdado' : f.state;
    const v = valueOf(def);
    const placeholder = inh ? `${inh} (herdado)` : '';
    let input: React.ReactNode;
    if (def.type === 'secret') {
      input = (
        <div className="flex flex-wrap items-center gap-2">
          <Input id={id} type="password" autoComplete="new-password" disabled={!canWrite} value={secret ?? ''} placeholder={f.hasValue ? '•••••••• (definida — digite para trocar)' : 'Defina a senha'} onChange={(e) => setSecret(e.target.value)} className="max-w-xs" />
          {f.hasValue && r.can.launch && (revealed ? <span className="num rounded bg-surface-2 px-2 py-1 text-sm">{revealed}</span> : <Button size="sm" icon={<Eye className="h-4 w-4" />} loading={reveal.isPending} onClick={() => reveal.mutate()}>Ver senha</Button>)}
        </div>
      );
    } else if (def.type === 'choice') {
      input = (
        <Select id={id} disabled={!canWrite} value={v} onChange={(e) => set(def.key, e.target.value)} invalid={!!issue}>
          <option value="">{inh ? `${inh} (herdado)` : 'Escolha'}</option>
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    } else if (def.type === 'textarea') {
      input = <Textarea id={id} rows={2} disabled={!canWrite} value={v} placeholder={placeholder} onChange={(e) => set(def.key, e.target.value)} invalid={!!issue} />;
    } else if (def.type === 'money') {
      input = <Input id={id} inputMode="decimal" disabled={!canWrite} value={def.key in draft ? centsToInput(draft[def.key]!) : centsToInput(v)} placeholder={placeholder} onChange={(e) => set(def.key, inputToCents(e.target.value))} invalid={!!issue} />;
    } else {
      input = <Input id={id} type={def.type === 'date' ? 'date' : def.type === 'month' ? 'month' : def.type === 'email' ? 'email' : 'text'} inputMode={def.type === 'int' || def.type === 'cep' ? 'numeric' : undefined} disabled={!canWrite} value={v} placeholder={placeholder} onChange={(e) => set(def.key, def.type === 'uf' ? e.target.value.toUpperCase() : e.target.value)} invalid={!!issue} />;
    }
    return (
      <div key={def.key} className={clsx('min-w-0', def.type === 'textarea' && 'sm:col-span-2')}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
          <label htmlFor={id} className="text-sm font-medium text-ink">{def.label}{def.required && <span className="text-danger" aria-hidden> *</span>}{def.critical && <span className="ml-1 text-[11px] font-normal text-muted" title="Alterar depois da aprovação exige nova conferência">· crítico</span>}</label>
          {!(badge === 'pendente' && !def.required && !issue) && <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-semibold', STATE_TONE[badge])}>{STATE_LABEL[badge]}</span>}
        </div>
        {input}
        {issue ? <p className="mt-0.5 text-xs text-danger">{issue}</p> : f.state === 'divergente' && f.ixcFound ? <p className="mt-0.5 text-xs text-danger">No IXC: {f.ixcFound}</p> : def.hint ? <p className="mt-0.5 text-xs text-muted">{def.hint}</p> : null}
        {def.key === 'a_filial' && r.branchName && <p className="mt-0.5 text-xs text-muted">Filial da venda: {r.branchName}</p>}
        {canWrite && f.origin === 'manual' && f.inherited != null && f.inherited !== '' && !(def.key in draft) && <button type="button" className="mt-0.5 text-xs text-primary underline" onClick={() => set(def.key, '')}>voltar ao herdado ({inh})</button>}
      </div>
    );
  };

  const groupIssues = (g: ErpGroup) => r.issues.filter((i) => i.group === g).length;
  const status = r.status;
  const can = r.can;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        {/* faixa de situação e o próximo passo */}
        <section className="card p-4" aria-label="Situação do Cadastro ERP">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Chip tone={TONE[status]}>{r.statusLabel}</Chip><span className="text-sm text-muted">Ciclo {r.seq} · {ERP_CYCLE_LABELS[r.cycle]}</span></div>
              <p className="mt-1 text-sm text-text">
                {r.issues.length ? <span className="font-semibold text-[#C2610C]">{r.issues.length} pendência(s) para enviar</span> : <span className="font-semibold text-success">Sem pendências de preenchimento</span>}
                {r.ixcClientId && <> · IXC cliente <span className="num">{r.ixcClientId}</span></>}{r.ixcContractId && <> · contrato <span className="num">{r.ixcContractId}</span></>}
              </p>
              <p className="text-xs text-muted">
                {r.submittedByName && <>Enviado por {r.submittedByName} {fmtDateTime(r.submittedAt)}. </>}
                {r.approvedByName && <>Aprovado por {r.approvedByName} {fmtDateTime(r.approvedAt)}. </>}
                {r.launchedByName && <>Lançado por {r.launchedByName} {fmtDateTime(r.launchedAt)}. </>}
                {r.checkedByName && <>Conferido no IXC por {r.checkedByName} {fmtDateTime(r.checkedAt)}.</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite && dirty && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}
              {canWrite && ['nao_iniciado', 'em_preenchimento', 'devolvido'].includes(status) && <Button variant={dirty ? 'secondary' : 'primary'} icon={<Send className="h-4 w-4" />} disabled={dirty || r.issues.length > 0} title={dirty ? 'Salve antes de enviar' : r.issues.length ? 'Resolva as pendências antes de enviar' : undefined} loading={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>Enviar para conferência</Button>}
              {status === 'aguardando_conferencia' && can.review && <><Button onClick={() => setModal('return')}>Devolver</Button><Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ action: 'approve' })}>Aprovar</Button></>}
              {['aprovado', 'aguardando_lancamento', 'lancado', 'conferido_ixc', 'divergente'].includes(status) && r.approvedHash && <a className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2" href={`/api/v1/contracts/${c.id}/erp/${r.id}/sheet.pdf`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" />Ficha de lançamento</a>}
              {status === 'aprovado' && can.launch && !dirty && <Button onClick={() => act.mutate({ action: 'release' })} loading={act.isPending}>Liberar para lançamento</Button>}
              {['aprovado', 'aguardando_lancamento'].includes(status) && can.launch && !dirty && <Button variant="primary" onClick={() => setModal('launch')}>Registrar lançamento no IXC</Button>}
              {['lancado', 'divergente'].includes(status) && !dirty && (can.check ? <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ action: 'check' })}>Conferir no IXC</Button> : null)}
              {status === 'divergente' && can.fill && !dirty && <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setModal('reopen')}>Reabrir cadastro</Button>}
            </div>
          </div>
          {status === 'aguardando_conferencia' && !can.review && can.reviewBlockedReason && <div className="mt-3"><Notice>{can.reviewBlockedReason}</Notice></div>}
          {['lancado', 'divergente'].includes(status) && !can.check && can.checkBlockedReason && <div className="mt-3"><Notice>{can.checkBlockedReason}</Notice></div>}
          {status === 'aguardando_conferencia' && <p className="mt-2 text-xs text-muted">Em conferência: os campos ficam travados até a aprovação ou a devolução.</p>}
          {['aprovado', 'aguardando_lancamento', 'lancado', 'conferido_ixc'].includes(status) && <p className="mt-2 text-xs text-muted">Aprovado não é lançado: o lançamento no IXC é registrado à parte, com os códigos gerados lá. Alterar um campo crítico agora devolve o cadastro para conferência.</p>}
          {starter && <div className="mt-3 border-t border-line pt-3">{starter}</div>}
        </section>

        {check && (
          <section className="card p-4" aria-label="Conferência no IXC">
            <h3 className="font-bold text-ink">Conferência no IXC</h3>
            {check.ixcError && <p className="mt-1 text-sm text-[#C2610C]">{check.ixcError}</p>}
            <p className="mb-2 text-sm text-muted">A leitura do IXC não trouxe {check.pending.length} campo(s). Confira na tela do IXC e marque o resultado de cada um.</p>
            <ManualCheck compare={check.compare} pending={check.pending} loading={act.isPending} onSubmit={(ok, bad) => act.mutate({ action: 'check', manualOk: ok, manualDivergent: bad })} />
          </section>
        )}
        {!check && r.compare && r.compare.length > 0 && <CompareTable compare={r.compare} />}

        {ERP_GROUPS.map((g) => {
          const defs = ERP_FIELDS.filter((x) => x.group === g);
          const n = groupIssues(g);
          let sec: string | undefined;
          return (
            <section key={g} className="card">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={open[g]} onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}>
                <span className="font-bold text-ink">{g}. {ERP_GROUP_LABELS[g]}</span>
                <span className="flex items-center gap-2">{n > 0 && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-[#C2610C]">{n} pendente(s)</span>}<ChevronDown className={clsx('h-4 w-4 text-muted transition', open[g] && 'rotate-180')} /></span>
              </button>
              {open[g] && (
                <div className="border-t border-line px-4 py-4">
                  {g === 'C' ? <ItemsTable items={items} setItems={setItems} disabled={!canWrite} issues={issueOf} /> : (
                    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                      {defs.map((def) => {
                        const head = def.section && def.section !== sec ? (sec = def.section) : null;
                        return [head && <h4 key={`h-${head}`} className="col-span-full -mb-1 mt-1 text-xs font-bold uppercase tracking-wide text-muted">{head}</h4>, field(def)];
                      })}
                    </div>
                  )}
                  {g === 'G' && <Extras extras={extras} setExtras={setExtras} disabled={!canWrite} />}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <aside className="min-w-0 space-y-3">
        <section className="card p-4">
          <h3 className="mb-2 font-bold text-ink">Evidências</h3>
          {!r.documents.length ? <p className="text-sm text-muted">Nenhum documento no contrato. Anexe na aba Documentos.</p> : (
            <ul className="space-y-1.5">{r.documents.map((doc) => (
              <li key={doc.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" disabled={!canWrite} checked={evidence.includes(doc.id)} onChange={(e) => setEvidence((x) => (e.target.checked ? [...x, doc.id] : x.filter((y) => y !== doc.id)))} /><span className="min-w-0"><span className="block truncate text-ink">{doc.name}</span><span className="text-xs text-muted">{doc.category} · v{doc.version}{doc.signed ? ' · assinado' : ''}</span></span></label></li>
            ))}</ul>
          )}
        </section>
        <section className="card p-4">
          <h3 className="mb-2 font-bold text-ink">Histórico</h3>
          <ol className="space-y-2.5">{r.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="font-semibold text-ink">{ACTION_LABEL[e.action] ?? e.action}</p>
              <p className="text-xs text-muted">{e.actorName ?? 'Sistema'} · {fmtDateTime(e.createdAt)}</p>
              {e.note && <p className="mt-0.5 whitespace-pre-line text-xs text-text">“{e.note}”</p>}
            </li>
          ))}</ol>
        </section>
        {cycles.length > 1 && (
          <section className="card p-4">
            <h3 className="mb-2 font-bold text-ink">Ciclos</h3>
            <ul className="space-y-1 text-sm">{cycles.map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{x.seq}. {ERP_CYCLE_LABELS[x.cycle]}</span><span className="text-muted">{x.statusLabel}</span></li>)}</ul>
          </section>
        )}
      </aside>

      <ReasonModal open={modal === 'return'} title="Devolver para correção" label="Justificativa (o que corrigir)" confirm="Devolver" loading={act.isPending} onClose={() => setModal(null)} onConfirm={(note) => act.mutate({ action: 'return', note })} />
      <ReasonModal open={modal === 'reopen'} title="Reabrir o cadastro" label="O que será corrigido no cadastro" confirm="Reabrir" loading={act.isPending} onClose={() => setModal(null)} onConfirm={(note) => act.mutate({ action: 'reopen', note })} />
      {modal === 'launch' && <LaunchModal r={r} loading={act.isPending} onClose={() => setModal(null)} onConfirm={(ixcClientId, ixcContractId, note) => act.mutate({ action: 'launch', ixcClientId, ixcContractId, note: note || undefined })} />}
    </div>
  );
}

function ItemsTable({ items, setItems, disabled, issues }: { items: ErpItem[]; setItems: (f: (x: ErpItem[]) => ErpItem[]) => void; disabled: boolean; issues: Map<string, string> }) {
  if (!items.length) return <p className="text-sm text-danger">Nenhum produto ou serviço no contrato. Inclua os itens na edição do contrato.</p>;
  const up = (i: number, p: Partial<ErpItem>) => setItems((x) => x.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const cell = (i: number, k: 'ixcCode' | 'unit' | 'periodicity' | 'location', label: string) => (
    <td className="px-2 py-1.5"><Input aria-label={`${label} — item ${i + 1}`} disabled={disabled} value={items[i]![k] ?? ''} invalid={issues.has(`items.${i}.${k}`)} onChange={(e) => up(i, { [k]: e.target.value || null })} /></td>
  );
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-muted">Descrição, quantidade e valor vêm da versão vigente do contrato. Complete o que o IXC pede.</p>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-2 py-2 font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qtd.</th><th className="px-2 py-2 text-right font-medium">Unitário</th><th className="px-2 py-2 font-medium">Código IXC *</th><th className="px-2 py-2 font-medium">Unidade *</th><th className="px-2 py-2 font-medium">Periodicidade *</th><th className="px-2 py-2 font-medium">Local de prestação</th></tr></thead>
        <tbody>{items.map((it, i) => (
          <tr key={i} className="border-t border-line">
            <td className="px-2 py-1.5 text-ink">{it.description}</td><td className="num px-2 py-1.5 text-right">{it.qty}</td><td className="num px-2 py-1.5 text-right">{fmtBRL(it.unitCents)}</td>
            {cell(i, 'ixcCode', 'Código IXC')}{cell(i, 'unit', 'Unidade')}{cell(i, 'periodicity', 'Periodicidade')}{cell(i, 'location', 'Local de prestação')}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Extras({ extras, setExtras, disabled }: { extras: ErpExtra[]; setExtras: (f: (x: ErpExtra[]) => ErpExtra[]) => void; disabled: boolean }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Campos adicionais exigidos pelo IXC</h4>
      {!extras.length && <p className="mb-2 text-sm text-muted">Nenhum. Inclua os campos que o IXC pedir para este produto ou modalidade.</p>}
      <div className="space-y-2">{extras.map((x, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_160px_auto]">
          <Input aria-label="Nome do campo" placeholder="Campo" disabled={disabled} value={x.label} onChange={(e) => setExtras((a) => a.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
          <Input aria-label="Valor" placeholder="Valor" disabled={disabled} value={x.value} onChange={(e) => setExtras((a) => a.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
          <Input aria-label="Campo no IXC" placeholder="campo no IXC" disabled={disabled} value={x.ixc ?? ''} onChange={(e) => setExtras((a) => a.map((y, j) => (j === i ? { ...y, ixc: e.target.value || null } : y)))} />
          {!disabled && <Button size="sm" aria-label="Remover campo" icon={<Trash2 className="h-4 w-4" />} onClick={() => setExtras((a) => a.filter((_, j) => j !== i))} />}
        </div>
      ))}</div>
      {!disabled && <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setExtras((a) => [...a, { label: '', value: '', ixc: null }])}>Campo adicional</Button>}
    </div>
  );
}

function CompareTable({ compare }: { compare: IxcCompare[] }) {
  const bad = compare.filter((x) => x.status === 'divergente');
  return (
    <section className="card p-4" aria-label="Resultado da conferência no IXC">
      <h3 className="mb-2 flex items-center gap-2 font-bold text-ink">{bad.length ? <AlertTriangle className="h-4 w-4 text-danger" /> : <CheckCircle2 className="h-4 w-4 text-success" />}Última conferência no IXC</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium">Campo</th><th className="py-1.5 font-medium">Aprovado</th><th className="py-1.5 font-medium">No IXC</th><th className="py-1.5 font-medium">Resultado</th></tr></thead>
        <tbody>{[...bad, ...compare.filter((x) => x.status !== 'divergente')].map((x) => (
          <tr key={x.key} className="border-t border-line"><td className="py-1.5">{x.label}</td><td className="py-1.5">{x.expected}</td><td className="py-1.5">{x.found ?? '—'}</td><td className={clsx('py-1.5 font-semibold', x.status === 'divergente' ? 'text-danger' : x.status === 'ok' ? 'text-success' : 'text-muted')}>{x.status === 'divergente' ? 'Divergente' : x.status === 'ok' ? 'Confere' : 'Não lido'}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function ManualCheck({ compare, pending, loading, onSubmit }: { compare: IxcCompare[]; pending: string[]; loading: boolean; onSubmit: (ok: string[], bad: string[]) => void }) {
  const [res, setRes] = useState<Record<string, 'ok' | 'bad' | ''>>(() => Object.fromEntries(pending.map((k) => [k, ''])));
  const rows = compare.filter((x) => pending.includes(x.key));
  const done = pending.every((k) => res[k]);
  return (
    <div>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium">Campo</th><th className="py-1.5 font-medium">Valor aprovado</th><th className="py-1.5 font-medium">Na tela do IXC</th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.key} className="border-t border-line"><td className="py-1.5">{x.label}</td><td className="py-1.5 font-semibold">{x.expected}</td>
            <td className="py-1.5"><div className="flex gap-3" role="radiogroup" aria-label={`Resultado para ${x.label}`}>
              <label className="flex items-center gap-1"><input type="radio" name={`mc-${x.key}`} checked={res[x.key] === 'ok'} onChange={() => setRes((r) => ({ ...r, [x.key]: 'ok' }))} />Confere</label>
              <label className="flex items-center gap-1"><input type="radio" name={`mc-${x.key}`} checked={res[x.key] === 'bad'} onChange={() => setRes((r) => ({ ...r, [x.key]: 'bad' }))} />Diferente</label>
            </div></td></tr>
        ))}</tbody>
      </table></div>
      <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!done} loading={loading} onClick={() => onSubmit(pending.filter((k) => res[k] === 'ok'), pending.filter((k) => res[k] === 'bad'))}>Registrar conferência</Button></div>
    </div>
  );
}

function ReasonModal({ open, title, label, confirm, loading, onClose, onConfirm }: { open: boolean; title: string; label: string; confirm: string; loading: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={note.trim().length < 5} loading={loading} onClick={() => onConfirm(note.trim())}>{confirm}</Button></>}>
      <FormField label={label} htmlFor="erp-note" required hint="Mínimo 5 caracteres. Fica no histórico."><Textarea id="erp-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
    </Modal>
  );
}

function LaunchModal({ r, loading, onClose, onConfirm }: { r: Rec; loading: boolean; onClose: () => void; onConfirm: (cli: string, ctr: string, note: string) => void }) {
  const [cli, setCli] = useState(r.ixcClientId ?? '');
  const [ctr, setCtr] = useState(r.ixcContractId ?? '');
  const [note, setNote] = useState('');
  const okNum = (v: string) => /^\d{1,12}$/.test(v.trim());
  return (
    <Modal open onClose={onClose} title="Registrar lançamento no IXC" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!okNum(cli) || !okNum(ctr)} loading={loading} onClick={() => onConfirm(cli.trim(), ctr.trim(), note.trim())}>Registrar</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Lance no IXC com a ficha aprovada e informe os códigos gerados lá. A conferência será feita por outra pessoa, lendo o IXC.</p>
        <FormField label="Código do cliente no IXC" htmlFor="erp-cli" required><Input id="erp-cli" inputMode="numeric" value={cli} onChange={(e) => setCli(e.target.value)} /></FormField>
        <FormField label="Código do contrato no IXC" htmlFor="erp-ctr" required><Input id="erp-ctr" inputMode="numeric" value={ctr} onChange={(e) => setCtr(e.target.value)} /></FormField>
        <FormField label="Observação" htmlFor="erp-lnote"><Textarea id="erp-lnote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}
