/** Processo do contrato (implantação, renovação, reajuste, encerramento): roteiro de etapas com o que cada uma exige. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Circle, FileText, Mail, MinusCircle } from 'lucide-react';
import { PROCESS_LABELS, SECTOR_LABELS, adjustedCents, addDays, processSteps, toCents, type StepDef } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { dec, errMsg, todayIso, type ContractDetail, type Process } from './shared';

const OUTCOME: Record<string, string> = { renovado: 'Renovado', nao_renovado: 'Não renovado', aplicado: 'Reajuste aplicado', implantado: 'Implantado', encerrado: 'Encerrado' };
const DECISION_LABELS: Record<string, [string, string]> = {
  verificar_prorrogacao: ['Prorrogação possível', 'Não é possível prorrogar'],
  manifestacao_cliente: ['Cliente quer renovar', 'Cliente não quer renovar'],
  aprovacao: ['Aprovado', 'Reprovado'],
  validacao_cs: ['Encerramento validado', 'Não validado'],
};

function StepForm({ c, p, d, onDone, onUpload }: { c: ContractDetail; p: Process; d: StepDef; onDone: () => void; onUpload: (category: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const data = p.data as { index?: string; currentCents?: number; pct?: number };
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(todayIso());
  const [decision, setDecision] = useState<'sim' | 'nao' | ''>('');
  const [index, setIndex] = useState(data.index ?? c.current.adjustmentIndex ?? '');
  const [pct, setPct] = useState('');
  const nextStart = c.current.endAt ? addDays(c.current.endAt, 1) : todayIso();
  const [startAt, setStartAt] = useState(nextStart);
  const [term, setTerm] = useState(String(c.current.termMonths ?? 12));
  const [monthly, setMonthly] = useState(dec(c.current.monthlyCents));
  const [location, setLocation] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pctNum = Number(pct.replace(',', '.'));
  const send = useMutation({
    mutationFn: (skip: boolean) => {
      const value: Record<string, unknown> = {};
      if (!skip) {
        if (d.requires === 'erp') value.ref = ref;
        if (d.requires === 'data') value.date = date;
        if (d.requires === 'decisao') value.decision = decision || undefined;
        if (d.key === 'calculo') { value.index = index; value.pct = Number.isFinite(pctNum) ? pctNum : undefined; }
        if (d.key === 'nova_vigencia') { value.startAt = startAt; value.termMonths = Number(term) || undefined; const m = toCents(monthly); if (m !== null) value.monthlyCents = m; }
        if (d.key === 'arquivamento') { value.location = location; if (responsibleId) value.responsibleId = responsibleId; }
      }
      return api<{ processStatus: string }>(`/contracts/${c.id}/processes/${p.id}/steps/${d.key}`, { method: 'POST', body: { note: note || undefined, skip, value } });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); toast({ tone: 'success', message: r.processStatus === 'concluido' ? `${PROCESS_LABELS[p.kind]} concluída` : `${d.label}: registrado` }); onDone(); },
    onError: (e) => setError(errMsg(e)),
  });
  const id = (k: string) => `st-${p.id.slice(0, 6)}-${d.key}-${k}`;
  return (
    <div className="mt-2 space-y-3 rounded-md bg-surface-2 p-3">
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {d.hint && <p className="text-sm text-muted">{d.hint}</p>}
      {d.requires === 'erp' && <FormField label="Código/referência no ERP" htmlFor={id('ref')} required><Input id={id('ref')} value={ref} onChange={(e) => setRef(e.target.value)} /></FormField>}
      {d.requires === 'data' && <FormField label="Data" htmlFor={id('date')} required><Input id={id('date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[220px]" /></FormField>}
      {d.requires === 'documento' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink">Anexe o documento do tipo <strong>{d.docType}</strong>{['documento_assinado', 'pdf_assinado', 'formalizacao'].includes(d.key) ? ' marcado como assinado' : ''}.</span>
          <Button size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => onUpload(d.docType!)}>Enviar documento</Button>
        </div>
      )}
      {d.requires === 'decisao' && (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Decisão</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['sim', 'nao'] as const).map((k, i) => <label key={k} className="flex items-center gap-2"><input type="radio" name={id('dec')} checked={decision === k} onChange={() => setDecision(k)} />{(DECISION_LABELS[d.key] ?? ['Sim', 'Não'])[i]}</label>)}
          </div>
        </fieldset>
      )}
      {d.key === 'calculo' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Índice" htmlFor={id('idx')} required><Input id={id('idx')} value={index} onChange={(e) => setIndex(e.target.value)} /></FormField>
          <FormField label="Percentual (%)" htmlFor={id('pct')} required><Input id={id('pct')} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="4,5" /></FormField>
          <div className="text-sm"><p className="text-muted">Valor atual → reajustado</p><p className="num mt-2 font-semibold text-ink">{fmtBRL(c.current.monthlyCents)} → {Number.isFinite(pctNum) && pct ? fmtBRL(adjustedCents(c.current.monthlyCents, pctNum)) : '—'}</p></div>
        </div>
      )}
      {d.key === 'nova_vigencia' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Início da nova vigência" htmlFor={id('start')} required><Input id={id('start')} type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></FormField>
          <FormField label="Prazo (meses)" htmlFor={id('term')} required><Input id={id('term')} inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))} /></FormField>
          <FormField label="Valor mensal (R$)" htmlFor={id('m')}><Input id={id('m')} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></FormField>
        </div>
      )}
      {d.key === 'arquivamento' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Local do arquivo" htmlFor={id('loc')} required><Input id={id('loc')} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: Drive/Contratos/Encerrados/045-2025" /></FormField>
          <FormField label="Responsável pelo arquivamento" htmlFor={id('resp')}>
            <Select id={id('resp')} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}><option value="">Eu</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </FormField>
        </div>
      )}
      <FormField label={d.key === 'arquivamento' ? 'Nota final' : d.requires === 'nota' ? 'O que foi feito' : 'Observação'} htmlFor={id('note')} required={d.requires === 'nota' || d.key === 'arquivamento' || decision === 'nao'}>
        <Textarea id={id('note')} className="min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onDone}>Cancelar</Button>
        {d.optional && <Button loading={send.isPending && send.variables === true} onClick={() => { setError(null); send.mutate(true); }}>Pular etapa</Button>}
        <Button variant="primary" loading={send.isPending && send.variables === false} onClick={() => { setError(null); send.mutate(false); }}>Concluir etapa</Button>
      </div>
    </div>
  );
}

function OficioActions({ c, p }: { c: ContractDetail; p: Process }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<'gerar' | 'enviar' | null>(null);
  const [num, setNum] = useState('');
  const [months, setMonths] = useState('12');
  const [to, setTo] = useState(c.contact.email ?? '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); setOpen(null); };
  const gen = useMutation({ mutationFn: () => api<{ name: string }>(`/contracts/${c.id}/processes/${p.id}/oficio`, { method: 'POST', body: { oficioNumber: num, months: Number(months) || 12 } }), onSuccess: (r) => { toast({ tone: 'success', message: `Ofício gerado: ${r.name}` }); done(); }, onError: (e) => setError(errMsg(e)) });
  const snd = useMutation({ mutationFn: () => api<{ subject: string; cc: string }>(`/contracts/${c.id}/processes/${p.id}/oficio/send`, { method: 'POST', body: { to, message: msg } }), onSuccess: (r) => { toast({ tone: 'success', message: `Ofício enviado (cópia para ${r.cc})` }); done(); }, onError: (e) => setError(errMsg(e)) });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => { setError(null); setOpen('gerar'); }}>Gerar ofício</Button>
        <Button size="sm" icon={<Mail className="h-4 w-4" />} disabled={!p.steps.gerar_oficio} onClick={() => { setError(null); setOpen('enviar'); }}>Enviar ofício por e-mail</Button>
      </div>
      <Modal open={open === 'gerar'} onClose={() => setOpen(null)} title="Gerar ofício de renovação" size="sm" footer={<><Button onClick={() => setOpen(null)}>Cancelar</Button><Button variant="primary" loading={gen.isPending} disabled={!num.trim()} onClick={() => gen.mutate()}>Gerar e anexar</Button></>}>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <p className="text-sm text-muted">Usa o modelo institucional de Configurações → Contratos e anexa o PDF ao contrato com o nome padrão.</p>
          <FormField label="Número do ofício" htmlFor="of-num" required><Input id="of-num" value={num} onChange={(e) => setNum(e.target.value)} placeholder="12/2026" /></FormField>
          <FormField label="Renovar por (meses)" htmlFor="of-months"><Input id="of-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} /></FormField>
        </div>
      </Modal>
      <Modal open={open === 'enviar'} onClose={() => setOpen(null)} title="Enviar ofício por e-mail" size="sm" footer={<><Button onClick={() => setOpen(null)}>Cancelar</Button><Button variant="primary" loading={snd.isPending} disabled={!to.trim()} onClick={() => snd.mutate()}>Enviar</Button></>}>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <p className="text-sm text-muted">Assunto: <span className="font-semibold text-ink">Ofício de Renovação Contratual – Contrato {c.current.number} – Cliente {c.contact.name}</span> (configurável). Cópia automática para o e-mail de contratos.</p>
          <FormField label="Para" htmlFor="of-to" required><Input id="of-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
          <FormField label="Mensagem" htmlFor="of-msg" hint="Em branco usa a mensagem padrão."><Textarea id="of-msg" className="min-h-[100px]" value={msg} onChange={(e) => setMsg(e.target.value)} /></FormField>
        </div>
      </Modal>
    </>
  );
}

export function ProcessPanel({ c, p, onUpload }: { c: ContractDetail; p: Process; onUpload: (category: string, processId: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const defs = processSteps(p.kind, c.kind);
  const [active, setActive] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const done = defs.filter((d) => p.steps[d.key]).length;
  const cancelM = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/processes/${p.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract', c.id] }); setCancel(false); toast({ tone: 'success', message: 'Processo cancelado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const open = p.status === 'aberto';
  return (
    <section className={clsx('rounded-lg border p-4', open ? 'border-primary/30 bg-surface' : 'border-line bg-surface-2/50')} aria-label={`Processo de ${PROCESS_LABELS[p.kind]}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-md font-bold text-ink">{PROCESS_LABELS[p.kind]} <span className="text-sm font-normal text-muted">· aberto em {fmtDate(p.openedAt)}{p.dueAt ? ` · prazo ${fmtDate(p.dueAt)}` : ''}</span></h3>
          <p className="text-sm text-muted">{done} de {defs.length} etapas{p.kind === 'reajuste' && (p.data as { newCents?: number }).newCents ? ` · ${fmtBRL((p.data as { currentCents: number }).currentCents)} → ${fmtBRL((p.data as { newCents: number }).newCents)}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={open ? 'blue' : p.status === 'concluido' ? 'green' : 'neutral'}>{open ? 'Em andamento' : p.status === 'concluido' ? OUTCOME[p.outcome ?? ''] ?? 'Concluído' : 'Cancelado'}</Chip>
          {open && c.permissions.manage && p.kind !== 'implantacao' && <Button size="sm" variant="ghost" onClick={() => setCancel(true)}>Cancelar processo</Button>}
        </div>
      </header>
      {open && p.kind === 'renovacao' && c.kind === 'publico' && <div className="mb-3"><OficioActions c={c} p={p} /></div>}
      <ol className="space-y-1">
        {defs.map((d) => {
          const st = p.steps[d.key];
          return (
            <li key={d.key} className="rounded-md px-2 py-2 hover:bg-surface-2/60">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5" aria-hidden>{st ? (st.skipped ? <MinusCircle className="h-5 w-5 text-muted" /> : <CheckCircle2 className="h-5 w-5 text-success" />) : <Circle className="h-5 w-5 text-line-strong" />}</span>
                <div className="min-w-0 flex-1">
                  <p className={clsx('font-semibold', st ? 'text-ink' : 'text-text')}>{d.label}{d.optional && <span className="font-normal text-muted"> (opcional)</span>}</p>
                  <p className="text-xs text-muted">Setor: {d.sectors.map((x) => SECTOR_LABELS[x]).join(' ou ')}</p>
                  {st && (
                    <p className="mt-1 text-sm text-text">
                      {st.skipped ? 'Pulada' : 'Feita'} por {st.doneByName} em {fmtDateTime(st.doneAt)}
                      {st.value && typeof st.value === 'object' && 'ref' in st.value ? ` · ERP ${String(st.value.ref)}` : ''}
                      {st.value && typeof st.value === 'object' && 'date' in st.value ? ` · ${fmtDate(String(st.value.date))}` : ''}
                      {st.value && typeof st.value === 'object' && 'decision' in st.value ? ` · ${(DECISION_LABELS[d.key] ?? ['Sim', 'Não'])[st.value.decision === 'sim' ? 0 : 1]}` : ''}
                      {st.value && typeof st.value === 'object' && 'name' in st.value ? ` · ${String(st.value.name)}` : ''}
                      {st.note ? ` — ${st.note}` : ''}
                    </p>
                  )}
                </div>
                {!st && open && active !== d.key && <Button size="sm" onClick={() => setActive(d.key)}>Registrar</Button>}
              </div>
              {!st && open && active === d.key && <StepForm c={c} p={p} d={d} onDone={() => setActive(null)} onUpload={(cat) => onUpload(cat, p.id)} />}
            </li>
          );
        })}
      </ol>
      <Modal open={cancel} onClose={() => setCancel(false)} title={`Cancelar ${PROCESS_LABELS[p.kind].toLowerCase()}`} size="sm" footer={<><Button onClick={() => setCancel(false)}>Voltar</Button><Button variant="danger" loading={cancelM.isPending} disabled={reason.trim().length < 3} onClick={() => cancelM.mutate()}>Cancelar processo</Button></>}>
        <FormField label="Motivo" htmlFor="pc-reason" required><Textarea id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
    </section>
  );
}
