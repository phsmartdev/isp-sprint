/**
 * Oportunidades da ata: criar a partir dos itens (reserva o saldo), vincular existente, ajustar ou liberar reservas e
 * formalizar a contratação com documento (é aqui, e só aqui, que o saldo é consumido).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { FileCheck2, Link2, Plus } from 'lucide-react';
import { STAGE_LABELS, type OpportunityStage } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useDebounced, useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { DocPicker, QtyInput, Table, errMsg, parseQty, qty, useArpRefresh, type ArpDetail } from './shared';

type OppLine = { id: string; itemId: string; agencyId: string; qtyMilli: number; unitCents: number; status: 'reservada' | 'liberada' | 'formalizada'; valueCents: number };
type Opp = { id: string; code: number; title: string; stage: OpportunityStage; ownerName: string; contactName: string; createdAt: string; wonAt: string | null; lines: OppLine[]; valueCents: number; contractedCents: number; contractId: string | null; situation: 'formalizada' | 'aguardando_formalizacao' | 'perdida' | 'em_andamento' };
const SITUATION: Record<Opp['situation'], [string, Tone]> = { em_andamento: ['Em negociação', 'blue'], aguardando_formalizacao: ['Aguardando formalização', 'yellow'], formalizada: ['Contratação formalizada', 'green'], perdida: ['Perdida', 'red'] };

/** Escolha do órgão e das quantidades por item, mostrando o saldo disponível daquele órgão. */
function LinesEditor({ arp, agencyId, setAgencyId, values, setValues, lockAgency, release }: { arp: ArpDetail; agencyId: string; setAgencyId: (v: string) => void; values: Record<string, string>; setValues: (v: Record<string, string>) => void; lockAgency?: boolean; release?: Map<string, number> }) {
  const agencies = arp.agencies;
  const avail = (itemId: string) => {
    const b = arp.items.find((i) => i.id === itemId)?.byAgency.find((x) => x.agencyId === agencyId);
    const own = arp.agencies.find((g) => g.id === agencyId);
    // o gerenciador fica com o que não foi distribuído: o servidor calcula; aqui mostramos o que veio no balanço
    return (b?.available ?? (own?.kind === 'gerenciador' ? arp.items.find((i) => i.id === itemId)!.availableMilli : 0)) + (release?.get(itemId) ?? 0);
  };
  const total = arp.items.reduce((s, i) => s + Math.round(((parseQty(values[i.id] ?? '') ?? 0) * i.unitCents) / 1000), 0);
  return (
    <div className="space-y-3">
      <FormField label="Órgão contratante" htmlFor="ol-agency" required>
        <Select id="ol-agency" value={agencyId} disabled={lockAgency} onChange={(e) => setAgencyId(e.target.value)}>
          <option value="">Escolha o órgão</option>
          {agencies.map((g) => <option key={g.id} value={g.id}>{g.name}{g.kind === 'nao_participante' ? ' (adesão)' : g.kind === 'gerenciador' ? ' (gerenciador)' : ''}</option>)}
        </Select>
      </FormField>
      {agencyId && (
        <div className="max-h-[340px] overflow-y-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Disponível para o órgão</th><th className="px-3 py-2 font-medium">Quantidade</th></tr></thead>
            <tbody>
              {arp.items.map((i) => {
                const a = avail(i.id);
                const v = parseQty(values[i.id] ?? '');
                const over = v !== null && v > a;
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-3 py-2"><span className="font-semibold text-ink">{i.lot ? `${i.lot}/` : ''}{i.itemNumber}</span> <span className="text-muted">{i.description.slice(0, 60)}</span><span className="block text-xs text-muted">{fmtBRL(i.unitCents)} por {i.unit}</span></td>
                    <td className={clsx('num px-3 py-2', a <= 0 && 'text-muted')}>{qty(Math.max(0, a))} {i.unit}</td>
                    <td className="px-3 py-2"><QtyInput label={`Quantidade do item ${i.itemNumber}`} value={values[i.id] ?? ''} invalid={over} onChange={(x) => setValues({ ...values, [i.id]: x })} />{over && <span className="text-xs text-danger">Acima do saldo</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {agencyId && <p className="text-right text-sm">Valor: <span className="num font-bold text-ink">{fmtBRL(total)}</span></p>}
    </div>
  );
}
const toLines = (arp: ArpDetail, values: Record<string, string>) => arp.items.map((i) => ({ itemId: i.id, qtyMilli: parseQty(values[i.id] ?? '') ?? 0 })).filter((l) => l.qtyMilli > 0);

function NewOpp({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const lookups = useLookups();
  const [agencyId, setAgencyId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const lines = toLines(arp, values);
  const m = useMutation({
    mutationFn: () => api<{ id: string; code: number }>(`/arps/${arp.id}/opportunities`, { method: 'POST', body: { agencyId, lines, title: title || null, ownerId: ownerId || null } }),
    onSuccess: (o) => { refresh(); setValues({}); setAgencyId(''); setTitle(''); onClose(); toast({ tone: 'success', message: `OP-${o.code} criada e saldo reservado` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Nova oportunidade da ata" size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!agencyId || !lines.length} loading={m.isPending} onClick={() => m.mutate()}>Criar e reservar</Button></>}>
      <div className="space-y-4">
        <Notice>A oportunidade reserva o saldo dos itens escolhidos. Fechar a venda não consome a ata: o consumo só acontece na formalização com empenho, contrato ou ordem de serviço. Oportunidades de ata não geram negócio no Sucesso do Cliente.</Notice>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Título" htmlFor="no-title" hint="Em branco: Ata + órgão"><Input id="no-title" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label="Responsável" htmlFor="no-owner"><Select id="no-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Eu</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        </div>
        <LinesEditor arp={arp} agencyId={agencyId} setAgencyId={setAgencyId} values={values} setValues={setValues} />
      </div>
    </Modal>
  );
}

function LinkOpp({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 300);
  const [oppId, setOppId] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const found = useQuery({ queryKey: ['opps-search', dq], enabled: open && dq.length >= 2, queryFn: () => api<{ items: { id: string; code: number; title: string; stage: string; arpId: string | null }[] }>(`/opportunities${qs({ q: dq, pageSize: 10 })}`) });
  const lines = toLines(arp, values);
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/opportunities/link`, { method: 'POST', body: { opportunityId: oppId, agencyId, lines } }),
    onSuccess: () => { refresh(); setOppId(''); setValues({}); onClose(); toast({ tone: 'success', message: 'Oportunidade vinculada e saldo reservado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Vincular oportunidade existente" size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!oppId || !agencyId || !lines.length} loading={m.isPending} onClick={() => m.mutate()}>Vincular e reservar</Button></>}>
      <div className="space-y-4">
        <FormField label="Buscar oportunidade" htmlFor="lo-q"><Input id="lo-q" placeholder="Código, cliente ou título" value={search} onChange={(e) => setSearch(e.target.value)} /></FormField>
        {!!found.data?.items.length && (
          <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Resultados">
            {found.data.items.map((o) => (
              <li key={o.id}><label className={clsx('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', oppId === o.id ? 'border-primary bg-primary-soft' : 'border-line', o.arpId && o.arpId !== arp.id && 'opacity-50')}>
                <input type="radio" name="lo-opp" checked={oppId === o.id} disabled={!!o.arpId && o.arpId !== arp.id} onChange={() => setOppId(o.id)} />
                <span className="font-semibold">OP-{o.code}</span> {o.title}<span className="ml-auto text-xs text-muted">{o.arpId && o.arpId !== arp.id ? 'em outra ata' : STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage}</span>
              </label></li>
            ))}
          </ul>
        )}
        {oppId && <LinesEditor arp={arp} agencyId={agencyId} setAgencyId={setAgencyId} values={values} setValues={setValues} />}
      </div>
    </Modal>
  );
}

function AdjustLines({ arp, opp, onClose }: { arp: ArpDetail; opp: Opp | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const reserved = opp?.lines.filter((l) => l.status === 'reservada') ?? [];
  const agencyId = reserved[0]?.agencyId ?? '';
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const init = useMemo(() => Object.fromEntries(reserved.map((l) => [l.itemId, String(l.qtyMilli / 1000).replace('.', ',')])), [opp]); // eslint-disable-line react-hooks/exhaustive-deps
  const release = useMemo(() => new Map(reserved.map((l) => [l.itemId, l.qtyMilli])), [opp]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = values ?? init;
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/opportunities/${opp!.id}/lines`, { method: 'PUT', body: { lines: toLines(arp, cur).map((l) => ({ ...l, agencyId })) } }),
    onSuccess: () => { refresh(); setValues(null); onClose(); toast({ tone: 'success', message: 'Reservas ajustadas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!opp} onClose={() => { setValues(null); onClose(); }} title={opp ? `Ajustar reservas da OP-${opp.code}` : ''} size="xl" footer={<><Button variant="secondary" onClick={() => { setValues(null); onClose(); }}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar reservas</Button></>}>
      <LinesEditor arp={arp} agencyId={agencyId} setAgencyId={() => undefined} lockAgency values={cur} setValues={setValues} release={release} />
    </Modal>
  );
}

function Formalize({ arp, opp, onClose }: { arp: ArpDetail; opp: Opp | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [doc, setDoc] = useState('');
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const reserved = opp?.lines.filter((l) => l.status === 'reservada') ?? [];
  const item = (id: string) => arp.items.find((i) => i.id === id)!;
  const lines = reserved.map((l) => ({ itemId: l.itemId, agencyId: l.agencyId, qtyMilli: values[l.id] !== undefined ? parseQty(values[l.id]!) ?? 0 : l.qtyMilli })).filter((l) => l.qtyMilli > 0);
  const changed = reserved.some((l) => values[l.id] !== undefined && parseQty(values[l.id]!) !== l.qtyMilli);
  const total = lines.reduce((s, l) => s + Math.round((l.qtyMilli * item(l.itemId).unitCents) / 1000), 0);
  const m = useMutation({
    mutationFn: () => api<{ duplicate: boolean; consumed: number }>(`/arps/${arp.id}/formalize`, { method: 'POST', body: { opportunityId: opp!.id, documentId: doc, contractId: opp!.contractId, note, ...(changed ? { lines } : {}) } }),
    onSuccess: (r) => { refresh(); setDoc(''); setNote(''); setValues({}); onClose(); toast({ tone: 'success', message: r.duplicate ? 'Esta formalização já estava registrada; nada foi duplicado.' : `Contratação formalizada: ${r.consumed} item(ns) consumido(s) da ata` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!opp} onClose={onClose} title={opp ? `Formalizar contratação da OP-${opp.code}` : ''} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!doc || !lines.length} loading={m.isPending} onClick={() => m.mutate()}>Formalizar e consumir saldo</Button></>}>
      {opp && (
        <div className="space-y-4">
          <p className="text-sm text-text">A formalização transforma a reserva em consumo confirmado da ata. Anexe o empenho, contrato ou ordem de serviço que comprova a contratação.</p>
          <div className="rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Reservado</th><th className="px-3 py-2 font-medium">Contratar</th></tr></thead>
              <tbody>{reserved.map((l) => <tr key={l.id} className="border-t border-line"><td className="px-3 py-2">{item(l.itemId).itemNumber} · {item(l.itemId).description.slice(0, 50)}</td><td className="num px-3 py-2">{qty(l.qtyMilli)} {item(l.itemId).unit}</td><td className="px-3 py-2"><QtyInput label={`Contratar do item ${item(l.itemId).itemNumber}`} value={values[l.id] ?? String(l.qtyMilli / 1000).replace('.', ',')} onChange={(v) => setValues({ ...values, [l.id]: v })} /></td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-right text-sm">Valor contratado: <span className="num font-bold text-ink">{fmtBRL(total)}</span></p>
          <DocPicker arpId={arp.id} id="fz-doc" label="Documento da contratação" categories={['empenho', 'contrato', 'ordem_servico']} value={doc} onChange={setDoc} />
          {opp.contractId ? <p className="text-sm text-muted">O consumo fica vinculado ao contrato cadastrado desta oportunidade.</p> : <p className="text-sm text-muted">Sem contrato cadastrado para esta oportunidade: o consumo fica vinculado só ao documento. O contrato pode ser cadastrado depois em Gestão de Contratos.</p>}
          <FormField label="Observação" htmlFor="fz-note"><Textarea id="fz-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        </div>
      )}
    </Modal>
  );
}

function Release({ arp, opp, onClose }: { arp: ArpDetail; opp: Opp | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/opportunities/${opp!.id}/release`, { method: 'POST', body: { reason } }),
    onSuccess: () => { refresh(); setReason(''); onClose(); toast({ tone: 'success', message: 'Reservas liberadas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!opp} onClose={onClose} title={opp ? `Liberar reservas da OP-${opp.code}` : ''} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Liberar saldo</Button></>}>
      <p className="mb-3 text-sm">O saldo reservado volta a ficar disponível para outras oportunidades. Oportunidades perdidas liberam sozinhas.</p>
      <FormField label="Motivo" htmlFor="rl-reason" required><Textarea id="rl-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

export function OpportunitiesPanel({ arp }: { arp: ArpDetail }) {
  const q = useQuery({ queryKey: ['arp', arp.id, 'opps'], queryFn: () => api<{ items: Opp[] }>(`/arps/${arp.id}/opportunities`) });
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [adjust, setAdjust] = useState<Opp | null>(null);
  const [formal, setFormal] = useState<Opp | null>(null);
  const [release, setRelease] = useState<Opp | null>(null);
  const item = new Map(arp.items.map((i) => [i.id, i]));
  const agency = new Map(arp.agencies.map((g) => [g.id, g]));
  const vigente = arp.status === 'vigente';
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 className="text-lg font-bold text-ink">Oportunidades da ata</h2><p className="text-sm text-muted">Reservas, vendas fechadas e contratações formalizadas.</p></div>
        {arp.can.manage && vigente && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => setLinking(true)}>Vincular existente</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!arp.items.length} onClick={() => setCreating(true)}>Nova oportunidade</Button>
          </div>
        )}
      </div>
      {!vigente && <div className="px-4 pb-4"><Notice tone="warning">Oportunidades só com a ata vigente.</Notice></div>}
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="border-t border-line"><EmptyState title="Nenhuma oportunidade vinculada" description="Crie a oportunidade escolhendo o órgão e os itens: o saldo fica reservado até a formalização ou a perda." /></div>
      ) : (
        <Table head={['Oportunidade', 'Órgão', 'Itens', 'Valor reservado', 'Contratado', 'Situação', '']} min={1000}>
          {q.data!.items.map((o) => {
            const reserved = o.lines.filter((l) => l.status === 'reservada');
            const ag = agency.get(o.lines[0]?.agencyId ?? '');
            const [label, tone] = SITUATION[o.situation];
            return (
              <tr key={o.id} className="border-t border-line align-top">
                <td className="px-3 py-3"><Link to={`/opportunities/${o.id}`} className="font-semibold text-ink hover:underline">OP-{o.code}</Link><span className="block text-xs text-muted">{o.title} · {o.ownerName} · {fmtDate(o.createdAt)}</span></td>
                <td className="px-3 py-3">{ag?.name ?? o.contactName}</td>
                <td className="px-3 py-3 text-xs">{o.lines.map((l) => <span key={l.id} className="block"><span className="font-semibold">{item.get(l.itemId)?.itemNumber}</span>: {qty(l.qtyMilli)} {item.get(l.itemId)?.unit} <span className="text-muted">({l.status})</span></span>)}</td>
                <td className="num px-3 py-3">{fmtBRL(reserved.reduce((s, l) => s + l.valueCents, 0))}</td>
                <td className="num px-3 py-3 font-semibold">{fmtBRL(o.contractedCents)}</td>
                <td className="px-3 py-3"><Chip tone={tone}>{label}</Chip></td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {o.stage === 'ganha' && reserved.length > 0 && arp.can.effect && vigente && <Button size="sm" variant="primary" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => setFormal(o)}>Formalizar</Button>}
                  {o.stage !== 'ganha' && o.stage !== 'perdida' && reserved.length > 0 && arp.can.manage && vigente && (
                    <span className="inline-flex gap-1"><Button size="sm" variant="secondary" onClick={() => setAdjust(o)}>Ajustar</Button><Button size="sm" variant="ghost" onClick={() => setRelease(o)}>Liberar</Button></span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <NewOpp arp={arp} open={creating} onClose={() => setCreating(false)} />
      <LinkOpp arp={arp} open={linking} onClose={() => setLinking(false)} />
      <AdjustLines arp={arp} opp={adjust} onClose={() => setAdjust(null)} />
      <Formalize arp={arp} opp={formal} onClose={() => setFormal(null)} />
      <Release arp={arp} opp={release} onClose={() => setRelease(null)} />
    </section>
  );
}
