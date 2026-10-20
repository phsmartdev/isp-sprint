/**
 * Ata de registro de preços dentro da oportunidade: atrelar ao saldo (cota do órgão ou adesão já autorizada)
 * ou pedir nova adesão para um órgão/instituição não participante. A formalização (consumo) segue na ficha da ata.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FileCheck2, Link2, ScrollText, Unlink } from 'lucide-react';
import type { AdhesionCheck, AgencyKind } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, Chip, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { QtyInput, errMsg, parseQty, qty } from './shared';

type Linked = {
  linked: null | {
    arp: { id: string; number: string; object: string; status: string; endAt: string | null };
    lines: { id: string; itemId: string; agencyId: string; agencyName: string; agencyKind: AgencyKind; itemNumber: string; lot: string | null; description: string; unit: string; qtyMilli: number; valueCents: number; status: 'reservada' | 'liberada' | 'formalizada' }[];
    contractedCents: number;
    canFormalize: boolean;
  };
  adhesions: { id: string; arpId: string; arpNumber: string; agencyName: string; status: string; requestedAt: string; deadlineAt: string | null; items: { itemId: string; qtyMilli: number }[] }[];
  canEdit: boolean;
  hasActiveArps: boolean;
};
type AtaOpt = { id: string; number: string; object: string; endAt: string | null; managerName: string | null; availableValueCents: number; items: number };
type Options = {
  arp: { id: string; number: string; object: string };
  rules: { allowAdhesion: boolean; adhesionPerAgencyBp: number; adhesionTotalBp: number; contractDeadlineDays: number; version: number };
  agencies: { id: string; name: string; kind: AgencyKind; mode: 'cota' | 'adesao_autorizada' | 'adesao_pendente' | 'sem_adesao'; adhesionDeadline: string | null }[];
  items: { id: string; itemNumber: string; lot: string | null; description: string; unit: string; unitCents: number; availableByAgency: Record<string, number>; adhesionPerAgencyLimitMilli: number; adhesionTotalRemainingMilli: number; adhesionByAgency: Record<string, number> }[];
};
const ADH_STATUS: Record<string, [string, Tone]> = {
  solicitada: ['Adesão solicitada', 'blue'], aceita_fornecedor: ['Aceita pelo fornecedor', 'sky'], autorizada: ['Adesão autorizada', 'green'], contratada: ['Contratada', 'green'],
  recusada: ['Adesão recusada', 'red'], cancelada: ['Adesão cancelada', 'neutral'], expirada: ['Adesão expirada', 'neutral'],
};
const LINE_STATUS: Record<string, [string, Tone]> = { reservada: ['Reservado', 'blue'], formalizada: ['Consumido', 'green'], liberada: ['Liberado', 'neutral'] };
const toQtyText = (m: number) => String(m / 1000).replace('.', ',');

function LinkDialog({ oppId, open, onClose, current }: { oppId: string; open: boolean; onClose: () => void; current: Linked }) {
  const toast = useToast();
  const qc = useQueryClient();
  const linkedArp = current.linked?.arp.id ?? '';
  const [arpId, setArpId] = useState(linkedArp);
  const [mode, setMode] = useState<'saldo' | 'adesao'>('saldo');
  const [agencyId, setAgencyId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newDoc, setNewDoc] = useState('');
  const [justification, setJustification] = useState('');
  const [requestedAt, setRequestedAt] = useState(new Date().toISOString().slice(0, 10));
  const atas = useQuery({ queryKey: ['opp-arp-options', oppId], enabled: open && !linkedArp, queryFn: () => api<{ atas: AtaOpt[] }>(`/opportunities/${oppId}/arp/options`) });
  const opt = useQuery({ queryKey: ['opp-arp-options', oppId, arpId], enabled: open && !!arpId, queryFn: () => api<Options>(`/opportunities/${oppId}/arp/options${qs({ arpId })}`) });

  // ao abrir de novo com a ata já atrelada, começa pelas reservas atuais
  useEffect(() => {
    if (!open) return;
    setArpId(linkedArp);
    const res = current.linked?.lines.filter((l) => l.status === 'reservada') ?? [];
    setAgencyId(res[0]?.agencyId ?? '');
    setValues(Object.fromEntries(res.map((l) => [l.itemId, toQtyText(l.qtyMilli)])));
    setMode('saldo');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = opt.data;
  const reservedHere = useMemo(() => new Map((current.linked?.lines ?? []).filter((l) => l.status === 'reservada' && l.agencyId === agencyId).map((l) => [l.itemId, l.qtyMilli])), [current, agencyId]);
  const ag = o?.agencies.find((g) => g.id === agencyId);
  const limitFor = (it: Options['items'][number]) => {
    if (mode === 'saldo') return (it.availableByAgency[agencyId] ?? 0) + (reservedHere.get(it.id) ?? 0);
    const usedByAgency = agencyId && agencyId !== 'novo' ? it.adhesionByAgency[agencyId] ?? 0 : 0;
    return Math.max(0, Math.min(it.adhesionPerAgencyLimitMilli - usedByAgency, it.adhesionTotalRemainingMilli));
  };
  const lines = (o?.items ?? []).map((i) => ({ itemId: i.id, qtyMilli: parseQty(values[i.id] ?? '') ?? 0 })).filter((l) => l.qtyMilli > 0);
  const total = (o?.items ?? []).reduce((s, i) => s + Math.round(((parseQty(values[i.id] ?? '') ?? 0) * i.unitCents) / 1000), 0);
  const over = (o?.items ?? []).some((i) => (parseQty(values[i.id] ?? '') ?? 0) > limitFor(i));
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['opp-arp', oppId] }); void qc.invalidateQueries({ queryKey: ['opp-arp-options', oppId] }); void qc.invalidateQueries({ queryKey: ['timeline'] }); onClose(); toast({ tone: 'success', message: msg }); };
  const reserve = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/arp/reserve`, { method: 'POST', body: { arpId, agencyId, lines } }),
    onSuccess: () => done(current.linked ? 'Reservas atualizadas' : 'Oportunidade atrelada à ata e saldo reservado'),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const adhesion = useMutation({
    mutationFn: () => api<{ check: AdhesionCheck }>(`/opportunities/${oppId}/arp/adhesion`, { method: 'POST', body: { arpId, agencyId: agencyId && agencyId !== 'novo' ? agencyId : null, newAgency: agencyId === 'novo' ? { name: newName, document: newDoc || null } : null, requestedAt, justification, items: lines } }),
    onSuccess: (r) => done(r.check.ok ? 'Pedido de adesão registrado. Quando for autorizado, a quantidade fica reservada para esta oportunidade.' : 'Pedido registrado, mas fora dos limites legais: a autorização vai depender de exceção validada pelo Jurídico.'),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const cotas = o?.agencies.filter((g) => g.mode === 'cota') ?? [];
  const aderidos = o?.agencies.filter((g) => g.mode === 'adesao_autorizada') ?? [];
  const pendentes = o?.agencies.filter((g) => g.mode === 'adesao_pendente') ?? [];
  const naoPart = o?.agencies.filter((g) => g.kind === 'nao_participante' && g.mode !== 'adesao_pendente') ?? [];
  const canSubmit = !!arpId && !!lines.length && !over && (mode === 'saldo' ? !!agencyId : (!!agencyId && (agencyId !== 'novo' || newName.trim().length >= 2) && justification.trim().length >= 10));
  const switchMode = (m: 'saldo' | 'adesao') => { setMode(m); setAgencyId(''); setValues({}); };

  return (
    <Modal open={open} onClose={onClose} title={current.linked ? `Saldo da ata ${current.linked.arp.number}` : 'Atrelar ao saldo de uma ata'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        {mode === 'saldo'
          ? <Button variant="primary" disabled={!canSubmit} loading={reserve.isPending} onClick={() => reserve.mutate()}>{current.linked ? 'Salvar reservas' : 'Reservar saldo'}</Button>
          : <Button variant="primary" disabled={!canSubmit} loading={adhesion.isPending} onClick={() => adhesion.mutate()}>Pedir adesão</Button>}
      </>}>
      <div className="space-y-4">
        {!linkedArp && (
          atas.isLoading ? <LoadingRows rows={2} /> : !atas.data?.atas.length ? <Notice tone="warning">Nenhuma ata vigente. As atas são cadastradas em Gestão de Contratos → Atas de registro de preços.</Notice> : (
            <FormField label="Ata" htmlFor="oa-arp" required>
              <Select id="oa-arp" value={arpId} onChange={(e) => { setArpId(e.target.value); setAgencyId(''); setValues({}); }}>
                <option value="">Escolha a ata</option>
                {atas.data.atas.map((a) => <option key={a.id} value={a.id}>Ata {a.number} · {a.object.slice(0, 60)}{a.managerName ? ` · ${a.managerName}` : ''} · saldo {fmtBRL(a.availableValueCents)}</option>)}
              </Select>
            </FormField>
          )
        )}
        {arpId && (opt.isLoading ? <LoadingRows rows={3} /> : o && (<>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Como esta venda usa a ata</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                ['saldo', 'Usar saldo existente', 'Cota do gerenciador ou de um participante, ou o que um órgão já aderiu.'],
                ['adesao', 'Pedir nova adesão', 'Órgão ou instituição que não participa da ata (carona). A quantidade fica reservada quando o gerenciador autorizar.'],
              ] as const).map(([k, t, d]) => (
                <label key={k} className={clsx('flex cursor-pointer gap-3 rounded-md border p-3', mode === k ? 'border-primary bg-primary-soft' : 'border-line', k === 'adesao' && !o.rules.allowAdhesion && 'cursor-not-allowed opacity-50')}>
                  <input type="radio" name="oa-mode" className="mt-1" checked={mode === k} disabled={k === 'adesao' && !o.rules.allowAdhesion} onChange={() => switchMode(k)} />
                  <span><span className="block font-semibold text-ink">{t}</span><span className="text-sm text-muted">{k === 'adesao' && !o.rules.allowAdhesion ? 'O regulamento desta ata não admite adesão.' : d}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === 'saldo' ? (
            <FormField label="Órgão contratante" htmlFor="oa-agency" required hint={ag?.mode === 'adesao_autorizada' && ag.adhesionDeadline ? `Adesão autorizada: contratar até ${fmtDate(ag.adhesionDeadline)}` : undefined}>
              <Select id="oa-agency" value={agencyId} onChange={(e) => { setAgencyId(e.target.value); setValues({}); }}>
                <option value="">Escolha o órgão</option>
                {!!cotas.length && <optgroup label="Cota da ata">{cotas.map((g) => <option key={g.id} value={g.id}>{g.name}{g.kind === 'gerenciador' ? ' (gerenciador)' : ''}</option>)}</optgroup>}
                {!!aderidos.length && <optgroup label="Já aderiram (adesão autorizada)">{aderidos.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
                {!!pendentes.length && <optgroup label="Adesão em análise (ainda sem saldo)">{pendentes.map((g) => <option key={g.id} value={g.id} disabled>{g.name}</option>)}</optgroup>}
              </Select>
            </FormField>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Órgão ou instituição" htmlFor="oa-adh-agency" required>
                <Select id="oa-adh-agency" value={agencyId} onChange={(e) => { setAgencyId(e.target.value); setValues({}); }}>
                  <option value="">Escolha</option>
                  {naoPart.map((g) => <option key={g.id} value={g.id}>{g.name}{g.mode === 'adesao_autorizada' ? ' (nova adesão, além da já autorizada)' : ''}</option>)}
                  <option value="novo">Outro órgão ou instituição (cadastrar)</option>
                </Select>
              </FormField>
              <FormField label="Data do pedido" htmlFor="oa-adh-date" required><Input id="oa-adh-date" type="date" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} /></FormField>
              {agencyId === 'novo' && <>
                <FormField label="Nome do órgão ou instituição" htmlFor="oa-adh-name" required><Input id="oa-adh-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></FormField>
                <FormField label="CNPJ" htmlFor="oa-adh-doc"><Input id="oa-adh-doc" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} /></FormField>
              </>}
              <FormField label="Justificativa do órgão" htmlFor="oa-adh-just" required className="sm:col-span-2" hint="Por que aderir: necessidade e vantagem (mínimo 10 caracteres)."><Textarea id="oa-adh-just" rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} /></FormField>
              <p className="text-xs text-muted sm:col-span-2">Limites desta ata: {o.rules.adhesionPerAgencyBp / 100}% do registrado por órgão e {o.rules.adhesionTotalBp / 100}% somando todas as adesões, por item. Depois do pedido: aceite do fornecedor e autorização do gerenciador; o prazo para contratar é de {o.rules.contractDeadlineDays} dias.</p>
            </div>
          )}

          {agencyId && (
            <div className="max-h-[320px] overflow-y-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">{mode === 'saldo' ? 'Disponível' : 'Pode pedir até'}</th><th className="px-3 py-2 font-medium">Quantidade</th></tr></thead>
                <tbody>
                  {o.items.map((i) => {
                    const lim = limitFor(i);
                    const v = parseQty(values[i.id] ?? '');
                    const bad = v !== null && v > lim;
                    return (
                      <tr key={i.id} className="border-t border-line">
                        <td className="px-3 py-2"><span className="font-semibold text-ink">{i.lot ? `${i.lot}/` : ''}{i.itemNumber}</span> <span className="text-muted">{i.description.slice(0, 60)}</span><span className="block text-xs text-muted">{fmtBRL(i.unitCents)} por {i.unit}</span></td>
                        <td className={clsx('num px-3 py-2', lim <= 0 && 'text-muted')}>{qty(lim)} {i.unit}</td>
                        <td className="px-3 py-2"><QtyInput label={`Quantidade do item ${i.itemNumber}`} value={values[i.id] ?? ''} invalid={bad} onChange={(x) => setValues({ ...values, [i.id]: x })} />{bad && <span className="text-xs text-danger">{mode === 'saldo' ? 'Acima do saldo' : 'Acima do limite legal'}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {agencyId && <p className="text-right text-sm">Valor: <span className="num font-bold text-ink">{fmtBRL(total)}</span></p>}
          <p className="text-xs text-muted">Reservar não consome a ata, e fechar a venda também não. O consumo só acontece na formalização, com o empenho, contrato ou ordem de serviço.</p>
        </>))}
      </div>
    </Modal>
  );
}

function Unlinker({ oppId, open, onClose }: { oppId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/arp/unlink`, { method: 'POST', body: { reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['opp-arp', oppId] }); void qc.invalidateQueries({ queryKey: ['timeline'] }); setReason(''); onClose(); toast({ tone: 'success', message: 'Oportunidade desatrelada; o saldo voltou para a ata' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Desatrelar da ata" footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Desatrelar e liberar saldo</Button></>}>
      <p className="mb-3 text-sm">As reservas desta oportunidade voltam a ficar disponíveis na ata. Pedidos de adesão já feitos continuam na ata, com o órgão.</p>
      <FormField label="Motivo" htmlFor="oa-unlink" required><Textarea id="oa-unlink" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

export function OpportunityArpPanel({ oppId, stage }: { oppId: string; stage: string }) {
  const q = useQuery({ queryKey: ['opp-arp', oppId], queryFn: () => api<Linked>(`/opportunities/${oppId}/arp`) });
  const [open, setOpen] = useState(false);
  const [unlink, setUnlink] = useState(false);
  if (q.isLoading || q.isError || !q.data) return null;
  const d = q.data;
  const l = d.linked;
  const reserved = l?.lines.filter((x) => x.status === 'reservada') ?? [];
  const pending = d.adhesions.filter((a) => ['solicitada', 'aceita_fornecedor'].includes(a.status));
  if (!l && !d.adhesions.length) {
    if (!d.canEdit || !d.hasActiveArps) return null;
    return (
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4" aria-label="Ata de registro de preços">
        <p className="flex items-center gap-2 text-sm text-text"><ScrollText className="h-5 w-5 text-primary" aria-hidden />Venda para órgão público por ata de registro de preços?</p>
        <Button variant="outline" size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => setOpen(true)}>Atrelar ao saldo da ata</Button>
        <LinkDialog oppId={oppId} open={open} onClose={() => setOpen(false)} current={d} />
      </section>
    );
  }
  return (
    <section className="card p-5" aria-labelledby="oa-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="oa-title" className="flex items-center gap-2 text-md font-bold text-ink"><ScrollText className="h-5 w-5 text-primary" aria-hidden />Ata de registro de preços</h2>
          {l && <p className="text-sm text-muted"><Link className="font-semibold text-primary hover:underline" to={`/contracts/atas/${l.arp.id}?t=oportunidades`}>Ata {l.arp.number}</Link> · {l.arp.object}</p>}
        </div>
        {d.canEdit && l && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{reserved.length ? 'Alterar saldo ou pedir adesão' : 'Usar saldo ou pedir adesão'}</Button>
            {l.contractedCents === 0 && <Button size="sm" variant="ghost" icon={<Unlink className="h-4 w-4" />} onClick={() => setUnlink(true)}>Desatrelar</Button>}
          </div>
        )}
      </div>
      {l && !!l.lines.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Órgão</th><th className="px-3 py-2 font-medium">Quantidade</th><th className="px-3 py-2 font-medium">Valor</th><th className="px-3 py-2 font-medium">Situação</th></tr></thead>
            <tbody>{l.lines.map((x) => { const [t, tone] = LINE_STATUS[x.status]!; return (
              <tr key={x.id} className="border-t border-line"><td className="px-3 py-2"><span className="font-semibold text-ink">{x.lot ? `${x.lot}/` : ''}{x.itemNumber}</span> <span className="block text-xs text-muted">{x.description.slice(0, 40)}</span></td><td className="px-3 py-2">{x.agencyName}{x.agencyKind === 'nao_participante' && <span className="block text-xs text-muted">adesão</span>}</td><td className="num px-3 py-2">{qty(x.qtyMilli)} {x.unit}</td><td className="num px-3 py-2">{fmtBRL(x.valueCents)}</td><td className="px-3 py-2"><Chip tone={tone}>{t}</Chip></td></tr>
            ); })}</tbody>
          </table>
        </div>
      )}
      {l && !l.lines.length && !pending.length && <p className="text-sm text-muted">Atrelada à ata, ainda sem itens reservados.</p>}
      {!!d.adhesions.length && (
        <ul className="mt-3 space-y-1.5 text-sm" aria-label="Pedidos de adesão desta oportunidade">
          {d.adhesions.map((a) => { const [t, tone] = ADH_STATUS[a.status] ?? [a.status, 'neutral' as Tone]; return (
            <li key={a.id} className="flex flex-wrap items-center gap-2"><Chip tone={tone}>{t}</Chip><span>{a.agencyName}</span><span className="text-muted">· pedido em {fmtDate(a.requestedAt)}{a.deadlineAt ? ` · contratar até ${fmtDate(a.deadlineAt)}` : ''}</span></li>
          ); })}
        </ul>
      )}
      {!!pending.length && <p className="mt-2 text-xs text-muted">Quando o gerenciador autorizar a adesão, a quantidade pedida fica reservada aqui automaticamente.</p>}
      {l && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
          <span>Reservado <span className="num font-semibold">{fmtBRL(reserved.reduce((s, x) => s + x.valueCents, 0))}</span> · Consumido <span className="num font-semibold">{fmtBRL(l.contractedCents)}</span></span>
          {stage === 'ganha' && reserved.length > 0 && (l.canFormalize
            ? <Link to={`/contracts/atas/${l.arp.id}?t=oportunidades`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"><FileCheck2 className="h-4 w-4" aria-hidden />Formalizar na ata</Link>
            : <span className="text-xs text-muted">Falta formalizar com empenho, contrato ou OS (Contratos, Jurídico ou Administração).</span>)}
        </div>
      )}
      <LinkDialog oppId={oppId} open={open} onClose={() => setOpen(false)} current={d} />
      <Unlinker oppId={oppId} open={unlink} onClose={() => setUnlink(false)} />
    </section>
  );
}
