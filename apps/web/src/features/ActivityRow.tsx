import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarCheck, FileText, MoreVertical, Phone, Users, Send, MapPin } from 'lucide-react';
import type { ActivityType } from '@isp/domain';
import { api } from '../lib/api';
import { fmtRelativeShort, fmtTime, isoToLocalInput, localDayKey, localInputToIso } from '../lib/format';
import type { Activity } from '../lib/types';
import { Chip, Input, Button } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { ActivityTag, productLabel } from '../components/badges';
import { WhatsIcon } from '../pages/Leads';

export const TYPE_ICON: Record<ActivityType, React.ReactNode> = {
  ligacao: <Phone className="h-[22px] w-[22px] text-success" />,
  reuniao: <Users className="h-[22px] w-[22px] text-primary" />,
  whatsapp: <Send className="h-[22px] w-[22px] text-primary" />,
  email: <FileText className="h-[22px] w-[22px] text-primary" />,
  tarefa: <CalendarCheck className="h-[22px] w-[22px] text-primary" />,
  visita: <MapPin className="h-[22px] w-[22px] text-purple" />,
};
const CONTACT_ICON: Record<ActivityType, React.ReactNode> = {
  ligacao: <Phone className="h-[18px] w-[18px] text-primary" />,
  reuniao: <Users className="h-[18px] w-[18px] text-primary" />,
  whatsapp: <WhatsIcon />,
  email: <Phone className="h-[18px] w-[18px] text-primary" />,
  tarefa: <Users className="h-[18px] w-[18px] text-primary" />,
  visita: <MapPin className="h-[18px] w-[18px] text-primary" />,
};

function useActivityPatch() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ a, body }: { a: Activity; body: Record<string, unknown> }) => api<Activity>(`/activities/${a.id}`, { method: 'PATCH', body: { ...body, rowVersion: a.rowVersion } }),
    onSuccess: (a, v) => {
      toast({ tone: 'success', message: v.body.completed === true ? 'Atividade concluída' : v.body.completed === false ? 'Atividade reaberta' : 'Atividade reagendada' });
      for (const k of ['activities', 'home', 'timeline']) qc.invalidateQueries({ queryKey: [k] });
      if (a.opportunityId) qc.invalidateQueries({ queryKey: ['timeline', a.opportunityId] });
    },
    onError: (e) => { toast({ tone: 'error', message: (e as Error).message }); qc.invalidateQueries({ queryKey: ['activities'] }); },
  });
}

function RowMenu({ a, onReschedule }: { a: Activity; onReschedule: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button className="rounded-sm p-1.5 text-ink hover:bg-surface-2" aria-label={`Mais ações: ${a.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><MoreVertical className="h-5 w-5" /></button>
      {open && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-line bg-surface py-1 text-sm shadow-overlay">
          <li><button role="menuitem" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setOpen(false); onReschedule(); }}>Reagendar</button></li>
          {a.opportunityId && <li><Link role="menuitem" className="block px-3 py-2 hover:bg-surface-2" to={`/opportunities/${a.opportunityId}`}>Abrir oportunidade</Link></li>}
        </ul>
      )}
    </div>
  );
}

/** Linha de atividade no padrão do design: hora, ícone, título/descrição, contato, selo e ação. */
export function ActivityRow({ a, showOwner, compact }: { a: Activity; showOwner?: boolean; compact?: boolean }) {
  const patch = useActivityPatch();
  const [resched, setResched] = useState(false);
  const [when, setWhen] = useState(isoToLocalInput(a.dueAt));
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState('');
  // acompanhamento de Sucesso do Cliente: concluir pede o resultado (sem ele não conta na cobertura)
  const complete = () => (a.csKind && !a.completedAt ? setAsking(true) : patch.mutate({ a, body: { completed: !a.completedAt } }));
  const today = a.dueAt ? localDayKey(a.dueAt) === localDayKey(new Date()) : false;
  return (
    <li className={clsx('grid items-center gap-3 py-3.5', compact ? 'grid-cols-[24px_auto_24px_minmax(0,1fr)_auto_32px]' : 'grid-cols-[28px_52px_28px_minmax(0,1.3fr)] lg:grid-cols-[28px_52px_28px_minmax(0,1.3fr)_minmax(0,1fr)_110px_96px_32px]')}>
      <input type="checkbox" className="h-5 w-5" checked={!!a.completedAt} disabled={patch.isPending} onChange={complete} aria-label={`${a.completedAt ? 'Reabrir' : 'Concluir'}: ${a.title}`} />
      <span className={clsx('num whitespace-nowrap', compact ? 'text-sm' : 'text-md', a.overdue ? 'font-semibold text-danger' : 'text-muted')}>{a.dueAt ? (compact && !today ? fmtRelativeShort(a.dueAt) : fmtTime(a.dueAt)) : '—'}</span>
      <span aria-hidden>{TYPE_ICON[a.type]}</span>
      <span className="min-w-0">
        <span className={clsx('block truncate text-md font-semibold text-ink', a.completedAt && 'text-muted line-through')}>{a.title}</span>
        <span className="block truncate text-sm text-muted">{a.notes ?? ''}{showOwner ? ` · ${a.ownerName}` : ''}</span>
      </span>
      {!compact && <span className="col-span-4 flex min-w-0 items-center gap-2.5 lg:col-span-1">
        {a.contactName && <span aria-hidden>{CONTACT_ICON[a.type]}</span>}
        <span className="min-w-0"><span className="block truncate text-sm text-ink">{a.contactName ?? ''}</span><span className="block truncate text-xs text-muted">{productLabel(a.contactSegment)}</span></span>
      </span>}
      {!compact && <span className="hidden lg:block"><ActivityTag t={a.type} /></span>}
      <span className={compact ? '' : 'hidden lg:block'}>
        {a.completedAt ? <Chip tone="green">Concluída</Chip> : a.overdue ? <Chip tone="red">Atrasada</Chip> : today ? (
          <Button size="sm" className="border-primary/10 bg-primary-soft text-primary hover:bg-primary-soft/70" onClick={complete}>Concluir</Button>
        ) : <Chip tone="orange" className="min-w-[78px] justify-center">Pendente</Chip>}
      </span>
      <span className={compact ? '' : 'hidden lg:block'}><RowMenu a={a} onReschedule={() => setResched(true)} /></span>
      <Modal open={asking} onClose={() => setAsking(false)} title="Resultado do acompanhamento" size="sm" footer={<><Button onClick={() => { setAsking(false); patch.mutate({ a, body: { completed: true } }); }}>Concluir sem resultado</Button><Button variant="primary" disabled={result.trim().length < 5} loading={patch.isPending} onClick={() => patch.mutate({ a, body: { completed: true, csResult: result } }, { onSuccess: () => setAsking(false) })}>Registrar</Button></>}>
        <label className="text-sm font-semibold text-ink" htmlFor={`res-${a.id}`}>O que aconteceu?</label>
        <textarea id={`res-${a.id}`} className="field-input mt-1 min-h-[90px]" value={result} onChange={(e) => setResult(e.target.value)} />
        <p className="mt-1 text-xs text-muted">Sem resultado registrado, o acompanhamento não conta na cobertura da carteira.</p>
      </Modal>
      <Modal open={resched} onClose={() => setResched(false)} title="Reagendar atividade" size="sm" footer={<><Button onClick={() => setResched(false)}>Cancelar</Button><Button variant="primary" loading={patch.isPending} onClick={() => patch.mutate({ a, body: { dueAt: localInputToIso(when) } }, { onSuccess: () => setResched(false) })}>Reagendar</Button></>}>
        <label className="text-sm font-semibold text-ink" htmlFor={`re-${a.id}`}>Nova data e hora</label>
        <Input id={`re-${a.id}`} type="datetime-local" className="mt-1" value={when} onChange={(e) => setWhen(e.target.value)} />
        <p className="mt-2 text-xs text-muted">Atual: {fmtRelativeShort(a.dueAt)}</p>
      </Modal>
    </li>
  );
}

