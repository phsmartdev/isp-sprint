/** Órgãos da ata e adesões de não participantes, com os limites legais conferidos na hora (por órgão e total, por item). */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import type { AdhesionCheck, ArpRules } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AgencyChip, DocPicker, QtyInput, Table, errMsg, parseQty, qty, useArpRefresh, type ArpDetail } from './shared';

type Adhesion = {
  id: string; agencyId: string; agencyName: string; status: 'solicitada' | 'aceita_fornecedor' | 'autorizada' | 'contratada' | 'recusada' | 'cancelada' | 'expirada';
  requestedAt: string; justification: string; items: { itemId: string; qtyMilli: number; unitCents: number }[]; deadlineAt: string | null; managerAuthorizationRef: string | null;
  ruleVersion: number | null; exception: { basis: string; validatedByName: string } | null; check: AdhesionCheck;
};
type Limits = { itemId: string; itemNumber: string; description: string; unit: string; registeredMilli: number; perAgencyLimitMilli: number; totalLimitMilli: number; usedMilli: number; availableMilli: number }[];
const STATUS: Record<Adhesion['status'], [string, Tone]> = {
  solicitada: ['Solicitada', 'blue'], aceita_fornecedor: ['Aceita pelo fornecedor', 'sky'], autorizada: ['Autorizada', 'green'], contratada: ['Contratada', 'green'],
  recusada: ['Recusada', 'red'], cancelada: ['Cancelada', 'neutral'], expirada: ['Expirada', 'neutral'],
};

function NewAgency({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [f, setF] = useState({ name: '', document: '', kind: arp.status === 'rascunho' ? 'participante' : 'nao_participante' });
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/agencies`, { method: 'POST', body: { ...f, document: f.document || null } }),
    onSuccess: () => { refresh(); setF({ ...f, name: '', document: '' }); onClose(); toast({ tone: 'success', message: 'Órgão cadastrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Novo órgão" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Cadastrar</Button></>}>
      <div className="space-y-4">
        <FormField label="Tipo" htmlFor="ag-kind" hint={arp.status === 'rascunho' ? undefined : 'Depois da vigência, novos órgãos entram como não participantes (adesão).'}>
          <Select id="ag-kind" value={f.kind} disabled={arp.status !== 'rascunho'} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="participante">Participante</option><option value="nao_participante">Não participante (adesão)</option></Select>
        </FormField>
        <FormField label="Nome do órgão" htmlFor="ag-name" required><Input id="ag-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="CNPJ" htmlFor="ag-doc"><Input id="ag-doc" value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function NewAdhesion({ arp, limits, open, onClose }: { arp: ArpDetail; limits: Limits; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const others = arp.agencies.filter((g) => g.kind === 'nao_participante');
  const [agencyId, setAgencyId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDoc, setNewDoc] = useState('');
  const [requestedAt, setRequestedAt] = useState(new Date().toISOString().slice(0, 10));
  const [justification, setJustification] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const items = arp.items.map((i) => ({ itemId: i.id, qtyMilli: parseQty(values[i.id] ?? '') ?? 0 })).filter((x) => x.qtyMilli > 0);
  const m = useMutation({
    mutationFn: () => api<{ check: AdhesionCheck }>(`/arps/${arp.id}/adhesions`, { method: 'POST', body: { agencyId: agencyId && agencyId !== 'novo' ? agencyId : null, newAgency: agencyId === 'novo' ? { name: newName, document: newDoc || null } : null, requestedAt, justification, items } }),
    onSuccess: (r) => { refresh(); setValues({}); setJustification(''); setAgencyId(''); onClose(); toast({ tone: r.check.ok ? 'success' : 'error', message: r.check.ok ? 'Pedido de adesão registrado dentro dos limites' : 'Pedido registrado, mas fora dos limites legais: a autorização vai exigir exceção do Jurídico' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const lim = new Map(limits.map((l) => [l.itemId, l]));
  const ok = (agencyId && (agencyId !== 'novo' || newName.trim().length >= 2)) && justification.trim().length >= 10 && items.length;
  return (
    <Modal open={open} onClose={onClose} title="Pedido de adesão" size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>Registrar pedido</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Órgão solicitante" htmlFor="ad-agency" required><Select id="ad-agency" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}><option value="">Escolha</option>{others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="novo">Outro órgão (cadastrar)</option></Select></FormField>
          <FormField label="Data do pedido" htmlFor="ad-date" required><Input id="ad-date" type="date" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} /></FormField>
          {agencyId === 'novo' && <><FormField label="Nome do órgão" htmlFor="ad-newname" required><Input id="ad-newname" value={newName} onChange={(e) => setNewName(e.target.value)} /></FormField><FormField label="CNPJ" htmlFor="ad-newdoc"><Input id="ad-newdoc" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} /></FormField></>}
          <FormField label="Justificativa do órgão" htmlFor="ad-just" required className="sm:col-span-2" hint="Vantagem da adesão e necessidade (mínimo 10 caracteres)."><Textarea id="ad-just" rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} /></FormField>
        </div>
        <div className="max-h-[300px] overflow-y-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Limite por órgão</th><th className="px-3 py-2 font-medium">Restante no total</th><th className="px-3 py-2 font-medium">Quantidade</th></tr></thead>
            <tbody>{arp.items.map((i) => { const l = lim.get(i.id); const v = parseQty(values[i.id] ?? ''); const over = !!l && v !== null && (v > l.perAgencyLimitMilli || v > l.availableMilli); return (
              <tr key={i.id} className="border-t border-line"><td className="px-3 py-2"><span className="font-semibold">{i.itemNumber}</span> {i.description.slice(0, 50)}</td><td className="num px-3 py-2">{qty(l?.perAgencyLimitMilli)} {i.unit}</td><td className="num px-3 py-2">{qty(l?.availableMilli)}</td><td className="px-3 py-2"><QtyInput label={`Quantidade de adesão do item ${i.itemNumber}`} value={values[i.id] ?? ''} invalid={over} onChange={(x) => setValues({ ...values, [i.id]: x })} />{over && <span className="text-xs text-danger">Acima do limite</span>}</td></tr>
            ); })}</tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function Authorize({ arp, adh, onClose }: { arp: ArpDetail; adh: Adhesion | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const { me } = useAuth();
  const juridico = !!me?.sectors?.includes('juridico');
  const [ref, setRef] = useState('');
  const [doc, setDoc] = useState('');
  const [basis, setBasis] = useState('');
  const [parecer, setParecer] = useState('');
  const out = adh && !adh.check.ok;
  const m = useMutation({
    mutationFn: () => api<{ deadlineAt: string }>(`/arp-adhesions/${adh!.id}/authorize`, { method: 'POST', body: { managerAuthorizationRef: ref, documentId: doc, exception: out ? { basis, documentId: parecer } : null } }),
    onSuccess: (r) => { refresh(); setRef(''); setDoc(''); onClose(); toast({ tone: 'success', message: `Adesão autorizada. Prazo para contratar: ${fmtDate(r.deadlineAt)}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!adh} onClose={onClose} title={adh ? `Autorizar adesão de ${adh.agencyName}` : ''} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={ref.trim().length < 2 || !doc || (!!out && (!juridico || basis.trim().length < 10 || !parecer))} loading={m.isPending} onClick={() => m.mutate()}>Autorizar adesão</Button></>}>
      {adh && (
        <div className="space-y-4">
          {out ? (
            <Notice tone="warning"><span className="font-semibold">Fora dos limites legais.</span> {adh.check.lines.flatMap((l) => l.violations).join(' ')} {juridico ? 'Como Jurídico, você pode validar uma exceção com fundamento e parecer.' : 'Só alguém do setor Jurídico pode validar a exceção.'}</Notice>
          ) : <Notice>Dentro dos limites: {arp.rules.rules.adhesionPerAgencyBp / 100}% por órgão e {arp.rules.rules.adhesionTotalBp / 100}% no total, por item ({arp.rules.version ? `regras v${arp.rules.version}` : 'regras padrão'}).</Notice>}
          <FormField label="Referência da autorização do gerenciador" htmlFor="au-ref" required><Input id="au-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ex.: Ofício 45/2026" /></FormField>
          <DocPicker arpId={arp.id} id="au-doc" label="Autorização do gerenciador" categories={['autorizacao_gerenciador']} value={doc} onChange={setDoc} />
          {out && juridico && (<>
            <FormField label="Fundamento legal da exceção" htmlFor="au-basis" required><Textarea id="au-basis" rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} /></FormField>
            <DocPicker arpId={arp.id} id="au-parecer" label="Parecer jurídico" categories={['parecer_juridico']} value={parecer} onChange={setParecer} />
          </>)}
        </div>
      )}
    </Modal>
  );
}

function Accept({ arp, adh, onClose }: { arp: ArpDetail; adh: Adhesion | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [doc, setDoc] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/arp-adhesions/${adh!.id}/supplier-accept`, { method: 'POST', body: { documentId: doc || null } }),
    onSuccess: () => { refresh(); setDoc(''); onClose(); toast({ tone: 'success', message: 'Aceite do fornecedor registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!adh} onClose={onClose} title="Aceite do fornecedor" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Registrar aceite</Button></>}>
      <p className="mb-3 text-sm">O fornecedor confirma que atende a adesão sem prejuízo das obrigações com o gerenciador e os participantes.</p>
      <DocPicker arpId={arp.id} id="ac-doc" label="Documento de aceite" categories={['aceite_fornecedor']} value={doc} onChange={setDoc} optional />
    </Modal>
  );
}

function CloseAdhesion({ arp, adh, onClose }: { arp: ArpDetail; adh: Adhesion | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [status, setStatus] = useState<'recusada' | 'cancelada' | 'expirada'>('recusada');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/arp-adhesions/${adh!.id}/status`, { method: 'POST', body: { status, note } }),
    onSuccess: () => { refresh(); setNote(''); onClose(); toast({ tone: 'success', message: 'Adesão encerrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!adh} onClose={onClose} title="Encerrar adesão" footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="danger" disabled={note.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Encerrar</Button></>}>
      <div className="space-y-4">
        <FormField label="Situação" htmlFor="ca-status"><Select id="ca-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="recusada">Recusada</option><option value="cancelada">Cancelada</option><option value="expirada">Expirada (prazo vencido)</option></Select></FormField>
        <FormField label="Motivo" htmlFor="ca-note" required><Textarea id="ca-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        {adh?.status === 'autorizada' && <p className="text-sm text-muted">A quantidade autorizada e não usada volta ao limite de adesões com um lançamento compensatório.</p>}
      </div>
    </Modal>
  );
}

export function AdhesionsPanel({ arp }: { arp: ArpDetail }) {
  const q = useQuery({ queryKey: ['arp', arp.id, 'adhesions'], queryFn: () => api<{ rules: { rules: ArpRules; version: number }; items: Adhesion[]; limits: Limits }>(`/arps/${arp.id}/adhesions`) });
  const [addAgency, setAddAgency] = useState(false);
  const [creating, setCreating] = useState(false);
  const [auth, setAuth] = useState<Adhesion | null>(null);
  const [accept, setAccept] = useState<Adhesion | null>(null);
  const [closing, setClosing] = useState<Adhesion | null>(null);
  const item = new Map(arp.items.map((i) => [i.id, i]));
  const r = arp.rules.rules;
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><h2 className="text-lg font-bold text-ink">Órgãos</h2><p className="text-sm text-muted">Gerenciador, participantes (com cota no registro) e não participantes (adesão).</p></div>
          {arp.can.manage && arp.status !== 'encerrada' && arp.status !== 'cancelada' && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAddAgency(true)}>Novo órgão</Button>}
        </div>
        <Table head={['Órgão', 'Tipo', 'CNPJ', 'Cota/adesão (soma dos itens)', 'Contratado', 'Disponível']} min={760}>
          {arp.agencies.map((g) => {
            const sum = (k: 'quota' | 'contracted' | 'available') => arp.items.reduce((s, i) => s + (i.byAgency.find((b) => b.agencyId === g.id)?.[k] ?? 0), 0);
            const val = (k: 'quota' | 'contracted' | 'available') => arp.items.reduce((s, i) => s + Math.round(((i.byAgency.find((b) => b.agencyId === g.id)?.[k] ?? 0) * i.unitCents) / 1000), 0);
            return <tr key={g.id} className="border-t border-line"><td className="px-3 py-3 font-semibold text-ink">{g.name}</td><td className="px-3 py-3"><AgencyChip kind={g.kind} /></td><td className="px-3 py-3">{g.document ?? '—'}</td><td className="num px-3 py-3">{qty(sum('quota'))} · {fmtBRL(val('quota'))}</td><td className="num px-3 py-3">{fmtBRL(val('contracted'))}</td><td className="num px-3 py-3 font-semibold">{fmtBRL(Math.max(0, val('available')))}</td></tr>;
          })}
        </Table>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Adesões</h2>
            <p className="text-sm text-muted">Limites aplicados: {r.adhesionPerAgencyBp / 100}% por órgão e {r.adhesionTotalBp / 100}% no total, por item; prazo de {r.contractDeadlineDays} dias para contratar após a autorização. {r.legalBasis}</p>
          </div>
          {arp.can.manage && arp.status === 'vigente' && r.allowAdhesion && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Pedido de adesão</Button>}
        </div>
        {!r.allowAdhesion && <div className="px-4 pb-4"><Notice tone="warning">O regulamento aplicado a esta ata não admite adesão.</Notice></div>}
        {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            {!q.data!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum pedido de adesão" description="Registre o pedido do órgão não participante; os limites são conferidos na hora." /></div> : (
              <Table head={['Órgão', 'Pedido', 'Itens', 'Valor', 'Limites', 'Situação', '']} min={1040}>
                {q.data!.items.map((a) => {
                  const [label, tone] = STATUS[a.status];
                  const value = a.items.reduce((s, i) => s + Math.round((i.qtyMilli * i.unitCents) / 1000), 0);
                  const violations = a.check.lines.flatMap((l) => l.violations);
                  return (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="px-3 py-3 font-semibold text-ink">{a.agencyName}<span className="block text-xs font-normal text-muted">{a.justification.slice(0, 80)}</span></td>
                      <td className="num px-3 py-3">{fmtDate(a.requestedAt)}{a.deadlineAt && <span className="block text-xs text-muted">contratar até {fmtDate(a.deadlineAt)}</span>}</td>
                      <td className="px-3 py-3 text-xs">{a.items.map((i) => <span key={i.itemId} className="block">{item.get(i.itemId)?.itemNumber}: {qty(i.qtyMilli)} {item.get(i.itemId)?.unit}</span>)}</td>
                      <td className="num px-3 py-3">{fmtBRL(value)}</td>
                      <td className="px-3 py-3 text-xs">{a.status === 'autorizada' || a.status === 'contratada' ? (a.exception ? <span className="text-[#C2610C]">Exceção validada por {a.exception.validatedByName}</span> : 'Dentro dos limites') : violations.length ? <span className="flex gap-1 text-danger"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{violations.join(' ')}</span> : <span className="text-success">Dentro dos limites</span>}</td>
                      <td className="px-3 py-3"><Chip tone={tone}>{label}</Chip>{a.managerAuthorizationRef && <span className="block text-xs text-muted">{a.managerAuthorizationRef}</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        {a.status === 'solicitada' && arp.can.manage && <Button size="sm" variant="secondary" onClick={() => setAccept(a)}>Aceite do fornecedor</Button>}
                        {a.status === 'aceita_fornecedor' && arp.can.effect && <Button size="sm" variant="primary" onClick={() => setAuth(a)}>Autorizar</Button>}
                        {['solicitada', 'aceita_fornecedor', 'autorizada'].includes(a.status) && arp.can.effect && <Button size="sm" variant="ghost" onClick={() => setClosing(a)}>Encerrar</Button>}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
            <div className="border-t border-line p-4">
              <h3 className="mb-2 font-bold text-ink">Limite de adesão por item</h3>
              <Table head={['Item', 'Registrada', 'Limite por órgão', 'Limite total', 'Já autorizado', 'Restante']} min={720}>
                {q.data!.limits.map((l) => <tr key={l.itemId} className="border-t border-line"><td className="px-3 py-2"><span className="font-semibold">{l.itemNumber}</span> {l.description.slice(0, 50)}</td><td className="num px-3 py-2">{qty(l.registeredMilli)} {l.unit}</td><td className="num px-3 py-2">{qty(l.perAgencyLimitMilli)}</td><td className="num px-3 py-2">{qty(l.totalLimitMilli)}</td><td className="num px-3 py-2">{qty(l.usedMilli)}</td><td className="num px-3 py-2 font-semibold">{qty(l.availableMilli)}</td></tr>)}
              </Table>
            </div>
          </>
        )}
      </section>
      <NewAgency arp={arp} open={addAgency} onClose={() => setAddAgency(false)} />
      {q.data && <NewAdhesion arp={arp} limits={q.data.limits} open={creating} onClose={() => setCreating(false)} />}
      <Authorize arp={arp} adh={auth} onClose={() => setAuth(null)} />
      <Accept arp={arp} adh={accept} onClose={() => setAccept(null)} />
      <CloseAdhesion arp={arp} adh={closing} onClose={() => setClosing(null)} />
    </div>
  );
}
