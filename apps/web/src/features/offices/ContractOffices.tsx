/**
 * Emitir ofício a partir do contrato: modelo, filial, destinatário e os valores das variáveis (já preenchidos com os
 * dados do contrato, todos ajustáveis), texto e posição editáveis só para este ofício, prévia exata e emissão com o
 * número sequencial da filial. Ofícios emitidos ficam listados para baixar.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, Download, FileText, RefreshCw, Send, TrendingUp, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { OfficeEditor, type OfficeBlock, type VarDef } from './OfficeEditor';

type Tpl = { id: string; name: string; description: string | null; blocks: OfficeBlock[]; usedVars: string[] };
type ApplyState = { appliedAt?: string; appliedByName?: string; version?: number; checkedAt?: string; checkedByName?: string; checkOk?: boolean; checkNote?: string | null };
type AdjItem = { description: string; qty: number; unitCents: number; pct: number; newUnitCents: number };
type Adjustment = ApplyState & { anniversary: string; index: string | null; pct: number; items: AdjItem[]; currentMonthlyCents: number; newMonthlyCents: number };
type Renewal = ApplyState & { fromEndAt: string | null; startAt: string; endAt: string; termMonths: number };
type Issued = { id: string; label: string; subject: string | null; createdAt: string; by: string | null; adjustment: Adjustment | null; renewal: Renewal | null; sentAt: string | null; sentTo: string | null };
type ContractInfo = {
  items: { description: string; qty: number; unitCents: number }[]; monthlyCents: number; index: string | null; endAt: string | null; startAt: string | null; version: number; renewalClause: string | null; canManage: boolean;
  adjust: { inPeriod: boolean; anniversary: string | null }; renew: { inPeriod: boolean; suggestion: { startAt: string; endAt: string; termMonths: number } };
};
type Recipient = { personId: string; name: string; email: string | null; title: string | null; role: string };
type Data = { contract: ContractInfo; branchId: string | null; branches: { id: string; name: string }[]; vars: Record<string, string>; varDefs: VarDef[]; recipients: Recipient[]; recipientPersonId: string | null; issued: Issued[]; templates: Tpl[] };
type IndexRef = { index: string; label: string; from: string; to: string; pct: number | null; note: string | null; source: string };

const pctFmt = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const dmy = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const mY = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function OfficesList({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['contrato', contractId, 'oficios'], queryFn: () => api<Data>(`/contracts/${contractId}/oficios`) });
  const [send, setSend] = useState<Issued | null>(null);
  const [check, setCheck] = useState<{ l: Issued; acao: 'reajuste' | 'renovacao' } | null>(null);
  const [confirm, setConfirm] = useState<{ l: Issued; acao: 'reajuste' | 'renovacao' } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const apply = useMutation({
    mutationFn: (v: { l: Issued; acao: 'reajuste' | 'renovacao' }) => api<{ version: number }>(`/oficios/${v.l.id}/aplicar`, { method: 'POST', body: { acao: v.acao } }),
    onSuccess: async (r, v) => {
      await qc.invalidateQueries({ queryKey: ['contrato', contractId] });
      toast({ tone: 'success', message: `${v.acao === 'reajuste' ? 'Reajuste aplicado' : 'Renovação aplicada'} (versão ${r.version}). Confira agora.` });
      setConfirm(null);
      setCheck(v);
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = q.data;
  if (!d?.issued.length) return null;
  const ct = d.contract;
  return (
    <section className="card p-4" aria-label="Ofícios emitidos">
      <h2 className="mb-2 text-sm font-bold text-ink">Ofícios emitidos</h2>
      <ul className="divide-y divide-line text-sm">{d.issued.map((l) => {
        const adj = l.adjustment, ren = l.renewal;
        return (
          <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
            <span className="min-w-0 flex-1"><b className="text-ink">Ofício nº {l.label}</b>{l.subject && ` · ${l.subject}`}
              <span className="block text-xs text-muted">{fmtDateTime(l.createdAt)}{l.by && ` · ${l.by}`}{l.sentAt && ` · enviado para ${l.sentTo} em ${fmtDateTime(l.sentAt)}`}</span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {adj && <StateChip what="Reajuste" st={adj} detail={pctFmt(adj.pct)} />}
                {ren && <StateChip what="Renovação" st={ren} detail={`até ${dmy(ren.endAt)}`} />}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {adj && !adj.appliedAt && ct.adjust.inPeriod && ct.canManage && <Button size="sm" variant="primary" onClick={() => setConfirm({ l, acao: 'reajuste' })}><TrendingUp className="h-4 w-4" aria-hidden />Aplicar reajuste</Button>}
              {ren && !ren.appliedAt && ct.renew.inPeriod && ct.canManage && <Button size="sm" variant="primary" onClick={() => setConfirm({ l, acao: 'renovacao' })}><RefreshCw className="h-4 w-4" aria-hidden />Aplicar renovação</Button>}
              {adj?.appliedAt && !adj.checkedAt && ct.canManage && <Button size="sm" onClick={() => setCheck({ l, acao: 'reajuste' })}><ClipboardCheck className="h-4 w-4" aria-hidden />Conferir reajuste</Button>}
              {ren?.appliedAt && !ren.checkedAt && ct.canManage && <Button size="sm" onClick={() => setCheck({ l, acao: 'renovacao' })}><ClipboardCheck className="h-4 w-4" aria-hidden />Conferir renovação</Button>}
              <Button size="sm" onClick={() => setSend(l)}><Send className="h-4 w-4" aria-hidden />Enviar ao cliente</Button>
              <a href={`/api/v1/oficios/${l.id}/pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="h-4 w-4" aria-hidden />PDF</a>
            </span>
          </li>
        );
      })}</ul>
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={confirm.acao === 'reajuste' ? 'Aplicar reajuste no contrato' : 'Aplicar renovação no contrato'} size="lg"
          footer={<><Button onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate(confirm)}>{confirm.acao === 'reajuste' ? 'Aplicar reajuste' : 'Aplicar renovação'}</Button></>}>
          {confirm.acao === 'reajuste' && confirm.l.adjustment ? (
            <div className="space-y-3"><p className="text-sm text-muted">Os valores unitários dos itens passam a ser os do ofício nº {confirm.l.label}, a partir de {dmy(confirm.l.adjustment.anniversary)}. Gera uma nova versão do contrato; em seguida, confira.</p><AdjustTable items={confirm.l.adjustment.items} pct={confirm.l.adjustment.pct} /></div>
          ) : confirm.l.renewal ? (
            <p className="text-sm text-ink">A vigência do contrato passa a ser de <b>{dmy(confirm.l.renewal.startAt)}</b> a <b>{dmy(confirm.l.renewal.endAt)}</b> ({confirm.l.renewal.termMonths} meses), conforme o ofício nº {confirm.l.label}. Gera uma nova versão do contrato; em seguida, confira.</p>
          ) : null}
        </Modal>
      )}
      {check && <CheckModal contractId={contractId} letter={d.issued.find((x) => x.id === check.l.id) ?? check.l} acao={check.acao} contract={ct} onClose={() => setCheck(null)} />}
      {send && <SendModal letter={send} recipients={d.recipients} recipientId={d.recipientPersonId} contractId={contractId} onClose={() => setSend(null)} />}
    </section>
  );
}

function StateChip({ what, st, detail }: { what: string; st: ApplyState; detail: string }) {
  if (!st.appliedAt) return <Chip tone="blue">{what} proposto · {detail}</Chip>;
  if (!st.checkedAt) return <Chip tone="orange">{what} aplicado · aguarda conferência</Chip>;
  return st.checkOk ? <Chip tone="green" title={`Conferido por ${st.checkedByName ?? ''}`}>{what} aplicado e conferido</Chip> : <Chip tone="red" title={st.checkNote ?? ''}>{what} com divergência</Chip>;
}

/** Tabela "quanto é × quanto será" por item. */
function AdjustTable({ items, pct, onPct }: { items: { description: string; qty: number; unitCents: number; pct: number }[]; pct?: number; onPct?: (k: number, v: number) => void }) {
  const nu = (i: { unitCents: number; pct: number }) => Math.round(i.unitCents * (1 + i.pct / 100));
  const sumA = items.reduce((a, i) => a + i.qty * i.unitCents, 0), sumB = items.reduce((a, i) => a + i.qty * nu(i), 0);
  const avg = pct ?? (sumA ? ((sumB / sumA) - 1) * 100 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" aria-label="Reajuste por item">
        <thead><tr className="border-b-2 border-ink/80 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <th className="py-2 pr-2">Item</th><th className="px-2 text-right">Qtd.</th><th className="px-2 text-right">Unitário atual</th><th className="px-2 text-right">Reajuste</th><th className="px-2 text-right">Unitário reajustado</th><th className="px-2 text-right">Total atual</th><th className="pl-2 text-right">Total reajustado</th>
        </tr></thead>
        <tbody>{items.map((i, k) => (
          <tr key={k} className="border-b border-line">
            <td className="py-2 pr-2 text-ink">{i.description}</td><td className="px-2 text-right tabular-nums">{i.qty}</td><td className="px-2 text-right tabular-nums">{fmtBRL(i.unitCents)}</td>
            <td className="px-2 text-right">{onPct ? <Input aria-label={`Reajuste (%) de ${i.description}`} className="ml-auto h-8 w-24 text-right tabular-nums" inputMode="decimal" value={String(i.pct).replace('.', ',')} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v)) onPct(k, v); }} /> : <span className="tabular-nums">{pctFmt(i.pct)}</span>}</td>
            <td className="px-2 text-right font-semibold tabular-nums text-ink">{fmtBRL(nu(i))}</td><td className="px-2 text-right tabular-nums">{fmtBRL(i.qty * i.unitCents)}</td><td className="pl-2 text-right font-semibold tabular-nums text-ink">{fmtBRL(i.qty * nu(i))}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="border-t-2 border-ink/80 font-bold text-ink"><td className="py-2 pr-2">Total mensal</td><td /><td /><td className="px-2 text-right tabular-nums">{pctFmt(Math.round(avg * 10000) / 10000)}</td><td /><td className="px-2 text-right tabular-nums">{fmtBRL(sumA)}</td><td className="pl-2 text-right tabular-nums">{fmtBRL(sumB)}</td></tr></tfoot>
      </table>
    </div>
  );
}

/** Conferência logo depois de aplicar: o que o ofício propôs × o que está no contrato agora. */
function CheckModal({ contractId, letter, acao, contract, onClose }: { contractId: string; letter: Issued; acao: 'reajuste' | 'renovacao'; contract: ContractInfo; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [diverge, setDiverge] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (ok: boolean) => api(`/oficios/${letter.id}/conferir`, { method: 'POST', body: { acao, ok, note: ok ? null : note } }),
    onSuccess: (_r, ok) => { void qc.invalidateQueries({ queryKey: ['contrato', contractId] }); toast({ tone: 'success', message: ok ? 'Conferência registrada' : 'Divergência registrada na próxima ação do contrato' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const adj = letter.adjustment, ren = letter.renewal;
  const rows = acao === 'reajuste' && adj ? adj.items.map((i, k) => ({ label: i.description, office: i.newUnitCents, now: contract.items[k]?.unitCents ?? null })) : [];
  const allOk = acao === 'reajuste' ? rows.every((r) => r.office === r.now) : !!ren && contract.startAt === ren.startAt && contract.endAt === ren.endAt;
  return (
    <Modal open onClose={onClose} title={acao === 'reajuste' ? 'Conferir reajuste aplicado' : 'Conferir renovação aplicada'} size="lg"
      footer={<><Button onClick={onClose}>Depois</Button>{diverge ? <Button variant="danger" loading={m.isPending} disabled={note.trim().length < 5} onClick={() => m.mutate(false)}>Registrar divergência</Button> : <><Button onClick={() => setDiverge(true)}>Há divergência</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(true)}>Conferido, está correto</Button></>}</>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Compare o que o ofício nº {letter.label} propôs com o que ficou gravado no contrato (versão {contract.version}).</p>
        {acao === 'reajuste' ? (
          <table className="w-full" aria-label="Conferência dos itens">
            <thead><tr className="border-b-2 border-ink/80 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"><th className="py-2">Item</th><th className="text-right">No ofício</th><th className="text-right">No contrato agora</th><th className="w-10 text-center">OK</th></tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k} className="border-b border-line"><td className="py-2 text-ink">{r.label}</td><td className="text-right tabular-nums">{fmtBRL(r.office)}</td><td className="text-right tabular-nums">{fmtBRL(r.now)}</td><td className="text-center">{r.office === r.now ? <Check className="mx-auto h-4 w-4 text-success" aria-label="Confere" /> : <X className="mx-auto h-4 w-4 text-danger" aria-label="Não confere" />}</td></tr>)}</tbody>
          </table>
        ) : ren ? (
          <dl className="grid grid-cols-2 gap-2"><dt className="text-muted">Nova vigência no ofício</dt><dd className="font-semibold text-ink">{dmy(ren.startAt)} a {dmy(ren.endAt)}</dd><dt className="text-muted">Vigência no contrato agora</dt><dd className="font-semibold text-ink">{dmy(contract.startAt)} a {dmy(contract.endAt)}</dd></dl>
        ) : null}
        {allOk ? <Notice>Tudo confere com o ofício.</Notice> : <Notice tone="warning">Há diferença entre o ofício e o contrato: registre a divergência.</Notice>}
        {diverge && <FormField label="Divergência encontrada" htmlFor="ck-note" required><Textarea id="ck-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>}
      </div>
    </Modal>
  );
}

/** Envio ao cliente pelo e-mail da empresa, com o PDF anexo. */
function SendModal({ letter, recipients, recipientId, contractId, onClose }: { letter: Issued; recipients: Recipient[]; recipientId: string | null; contractId: string; onClose: () => void }) {
  const first = recipients.find((r) => r.personId === recipientId && r.email) ?? recipients.find((r) => r.email);
  const [to, setTo] = useState(first?.email ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(`Ofício nº ${letter.label}${letter.subject ? ` – ${letter.subject}` : ''}`);
  const [message, setMessage] = useState(`Prezado(a)${first ? ` ${first.name.split(' ')[0]}` : ''},\n\nEncaminhamos em anexo o Ofício nº ${letter.label}${letter.subject ? `, referente a ${letter.subject.toLowerCase()}` : ''}.\n\nFicamos à disposição para qualquer esclarecimento.\n\nAtenciosamente,`);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/oficios/${letter.id}/enviar`, { method: 'POST', body: { to: to.trim(), cc: cc.trim() || null, subject, message } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['contrato', contractId] }); toast({ tone: 'success', message: `Ofício nº ${letter.label} enviado para ${to}` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Enviar ofício nº ${letter.label}`} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!/^\S+@\S+\.\S+$/.test(to.trim())} onClick={() => m.mutate()}><Send className="h-4 w-4" aria-hidden />Enviar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Para" htmlFor="so-to" required hint={recipients.some((r) => r.email) ? undefined : 'Nenhuma pessoa ligada ao contrato tem e-mail cadastrado'}>
          <Input id="so-to" type="email" list="so-to-list" value={to} onChange={(e) => setTo(e.target.value)} />
          <datalist id="so-to-list">{recipients.filter((r) => r.email).map((r) => <option key={r.personId} value={r.email!}>{r.name}</option>)}</datalist>
        </FormField>
        <FormField label="Com cópia" htmlFor="so-cc"><Input id="so-cc" type="email" value={cc} onChange={(e) => setCc(e.target.value)} /></FormField>
        <FormField label="Assunto do e-mail" htmlFor="so-subj" className="sm:col-span-2"><Input id="so-subj" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
        <FormField label="Mensagem" htmlFor="so-msg" className="sm:col-span-2" hint={`O PDF do ofício vai anexo (Oficio-${letter.label.replace('/', '-')}.pdf). Sai pelo e-mail da empresa configurado em Integrações.`}><Textarea id="so-msg" rows={7} value={message} onChange={(e) => setMessage(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

export function IssueOfficeModal({ contractId, open, onClose }: { contractId: string; open: boolean; onClose: () => void }) {
  const [recipient, setRecipient] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const q = useQuery({ queryKey: ['contrato', contractId, 'oficios', recipient, branch], enabled: open, queryFn: () => api<Data>(`/contracts/${contractId}/oficios${qs({ destinatario: recipient || undefined, filial: branch || undefined })}`), placeholderData: (p) => p });
  const [tplId, setTplId] = useState('');
  const [blocks, setBlocks] = useState<OfficeBlock[] | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const d = q.data;
  const tpl = d?.templates.find((t) => t.id === tplId) ?? null;
  // escolhe o primeiro modelo; ao trocar de modelo, o texto volta ao do modelo
  useEffect(() => { if (d && !tplId && d.templates[0]) setTplId(d.templates[0].id); }, [d, tplId]);
  useEffect(() => { if (tpl) { setBlocks(tpl.blocks); setSubject(tpl.name); } }, [tpl]);
  // valores do contrato (refeitos ao trocar destinatário ou filial), sem apagar o que a pessoa já ajustou à mão
  useEffect(() => { if (d) { setVars((v) => ({ ...d.vars, ...Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('destinatario.nome') && !k.startsWith('destinatario.cargo') && !k.startsWith('filial.') && !k.startsWith('assinante.') && k !== 'oficio.numero')) })); if (!branch && d.branchId) setBranch(d.branchId); if (!recipient && d.recipientPersonId) setRecipient(d.recipientPersonId); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // reajuste por item e renovação: ligados quando o modelo usa as variáveis/tabelas deles
  const text = (blocks ?? []).map((b) => b.text).join('\n');
  const usesAdj = /\{\{\s*(reajuste\.|tabela\.)/.test(text), usesRen = /\{\{\s*renovacao\./.test(text);
  const [adjOn, setAdjOn] = useState(false);
  const [renOn, setRenOn] = useState(false);
  useEffect(() => { setAdjOn(usesAdj); setRenOn(usesRen); }, [usesAdj, usesRen]);
  const [anniversary, setAnniversary] = useState('');
  const [adjItems, setAdjItems] = useState<{ description: string; qty: number; unitCents: number; pct: number }[]>([]);
  const [ren, setRen] = useState<{ startAt: string; endAt: string; termMonths: number } | null>(null);
  const ct = d?.contract;
  useEffect(() => { if (ct && !adjItems.length && ct.items.length) setAdjItems(ct.items.map((i) => ({ ...i, pct: 0 }))); if (ct && !anniversary && ct.adjust.anniversary) setAnniversary(ct.adjust.anniversary); if (ct && !ren) setRen(ct.renew.suggestion); }, [ct, adjItems.length, anniversary, ren]);
  const idx = useQuery({ queryKey: ['contrato', contractId, 'oficios', 'indices', anniversary], enabled: open && adjOn && /^\d{4}-\d{2}-\d{2}$/.test(anniversary), staleTime: 3_600_000, queryFn: () => api<{ indices: IndexRef[] }>(`/contracts/${contractId}/oficios/indices${qs({ anniversary })}`) });
  const mine = idx.data?.indices.find((r) => (ct?.index ?? '').toUpperCase().replace(/\s+/g, '').includes(r.index.replace('-', '')) || (ct?.index ?? '').toUpperCase().includes(r.index));
  // com o índice do contrato divulgado, os itens começam com ele (cada item continua ajustável)
  const [seeded, setSeeded] = useState('');
  useEffect(() => { if (mine?.pct != null && seeded !== anniversary && adjItems.length) { setAdjItems((it) => it.map((i) => ({ ...i, pct: mine.pct! }))); setSeeded(anniversary); } }, [mine, seeded, anniversary, adjItems.length]);
  const extra = useMemo(() => ({
    adjustment: adjOn && anniversary && adjItems.length ? { anniversary, index: ct?.index ?? null, items: adjItems } : null,
    indices: adjOn && idx.data ? idx.data.indices : null,
    renewal: renOn && ren ? ren : null,
  }), [adjOn, anniversary, adjItems, ct?.index, idx.data, renOn, ren]);
  const preview = useMemo(() => (b: OfficeBlock[]) => api<{ pdf: string; boxes: { id: string; page: number; x: number; y: number; w: number; h: number }[]; pages: number }>(`/contracts/${contractId}/oficios/previa`, { method: 'POST', body: { blocks: b, vars, branchId: branch || null, ...extra } }), [contractId, vars, branch, extra]);
  const issue = useMutation({
    mutationFn: () => api<{ id: string; label: string }>(`/contracts/${contractId}/oficios`, { method: 'POST', body: { templateId: tpl?.id ?? null, blocks, vars, subject: subject || null, branchId: branch || null, ...extra } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['contrato', contractId, 'oficios'] }); toast({ tone: 'success', message: `Ofício nº ${r.label} emitido` }); window.open(`/api/v1/oficios/${r.id}/pdf`, '_blank'); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const shown = (d?.varDefs ?? []).filter((v) => v.key !== 'oficio.numero' && !/^(reajuste|renovacao|tabela)\./.test(v.key) && (!tpl || tpl.usedVars.includes(v.key)));
  return (
    <Modal open={open} onClose={onClose} title="Emitir ofício" size="xl"
      footer={d?.templates.length ? <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={issue.isPending} disabled={!blocks || !branch} onClick={() => issue.mutate()}>Emitir ofício nº {d.vars['oficio.numero']}</Button></> : undefined}>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d!.templates.length ? (
        <EmptyState title="Nenhum modelo de ofício para esta filial" description="Crie os modelos em Configurações → Modelos → Ofícios." action={<Link to="/settings/modelos?aba=oficios" className="link">Abrir modelos de ofício</Link>} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Modelo" htmlFor="io-tpl"><Select id="io-tpl" value={tplId} onChange={(e) => setTplId(e.target.value)}>{d!.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
            <FormField label="Filial que emite" htmlFor="io-br" hint="Timbrado e numeração dela"><Select id="io-br" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">Escolha</option>{d!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
            <FormField label="Pessoa ligada ao contrato" htmlFor="io-rec" hint="Preenche destinatário e cargo"><Select id="io-rec" value={recipient} onChange={(e) => setRecipient(e.target.value)}><option value="">Digitar abaixo</option>{d!.recipients.map((r) => <option key={r.personId} value={r.personId}>{r.name}{r.title ? ` · ${r.title}` : ''}</option>)}</Select></FormField>
            <FormField label="Assunto (para a lista)" htmlFor="io-subj"><Input id="io-subj" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
          </div>
          <details className="border border-line p-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-ink">Dados do ofício (vindos do contrato, ajustáveis)</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{shown.map((v) => (
              <FormField key={v.key} label={v.label} htmlFor={`io-v-${v.key}`}><Input id={`io-v-${v.key}`} className="h-9" value={vars[v.key] ?? ''} onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })} placeholder={v.sample} /></FormField>
            ))}</div>
          </details>
          <fieldset className="border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={adjOn} onChange={(e) => setAdjOn(e.target.checked)} />Reajuste por item</label></legend>
            {adjOn && (
              <div className="space-y-3">
                {!ct?.items.length ? <Notice tone="warning">O contrato não tem itens cadastrados: cadastre os itens para reajustar por item.</Notice> : (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <FormField label="Aniversário da data-base" htmlFor="io-ann" hint="Define os 12 meses dos índices"><Input id="io-ann" type="date" className="h-9" value={anniversary} onChange={(e) => setAnniversary(e.target.value)} /></FormField>
                      <p className="pb-2 text-xs text-muted">Índice do contrato: <b className="text-ink">{ct.index ?? 'não informado'}</b>. Ajuste o percentual de cada item; o documento mostra o valor atual e o reajustado.</p>
                    </div>
                    <AdjustTable items={adjItems} onPct={(k, v) => setAdjItems((it) => it.map((x, j) => (j === k ? { ...x, pct: v } : x)))} />
                  </>
                )}
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Índices de referência (Banco Central)</h3>
                  {idx.isLoading ? <LoadingRows rows={2} /> : idx.isError ? <ErrorState error={idx.error} onRetry={() => idx.refetch()} /> : idx.data ? (
                    <table className="w-full text-sm" aria-label="Índices de referência">
                      <tbody>{idx.data.indices.map((r) => (
                        <tr key={r.index} className="border-b border-line">
                          <td className="py-1.5 font-medium text-ink">{r.label}{r === mine && <span className="ml-1 text-xs text-primary">· do contrato</span>}</td><td className="text-muted">{mY(r.from)} a {mY(r.to)}</td>
                          <td className="text-right font-semibold tabular-nums">{r.pct === null ? <span className="text-xs font-normal text-muted" title={r.note ?? ''}>não divulgado</span> : pctFmt(r.pct)}</td>
                          <td className="w-40 text-right">{r.pct !== null && adjItems.length > 0 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAdjItems((it) => it.map((x) => ({ ...x, pct: r.pct! })))}>Usar em todos os itens</button>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">Com {'{{tabela.indices}}'} no modelo, esta tabela vai para o ofício; {'{{tabela.reajuste}}'} leva a tabela por item.</p>
                </div>
              </div>
            )}
          </fieldset>
          <fieldset className="border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={renOn} onChange={(e) => setRenOn(e.target.checked)} />Renovação da vigência</label></legend>
            {renOn && ren && (
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Início da nova vigência" htmlFor="io-rs"><Input id="io-rs" type="date" className="h-9" value={ren.startAt} onChange={(e) => setRen({ ...ren, startAt: e.target.value })} /></FormField>
                <FormField label="Término da nova vigência" htmlFor="io-re"><Input id="io-re" type="date" className="h-9" value={ren.endAt} onChange={(e) => setRen({ ...ren, endAt: e.target.value })} /></FormField>
                <FormField label="Prazo (meses)" htmlFor="io-rm"><Input id="io-rm" type="number" min={1} max={120} className="h-9" value={ren.termMonths} onChange={(e) => setRen({ ...ren, termMonths: Math.max(1, Number(e.target.value) || 1) })} /></FormField>
                <p className="text-xs text-muted sm:col-span-3">Vigência atual: {dmy(ct?.startAt)} a {dmy(ct?.endAt)}.{ct?.renewalClause ? ' A cláusula de renovação do contrato está disponível em {{contrato.clausula_renovacao}}.' : ' Cadastre a cláusula de renovação no contrato para usá-la no ofício.'}</p>
              </div>
            )}
          </fieldset>
          {blocks && <OfficeEditor blocks={blocks} onChange={setBlocks} preview={preview} varDefs={d!.varDefs} previewWidth={480} />}
          <p className="text-xs text-muted">O texto e a posição ajustados aqui valem só para este ofício. O número é reservado na emissão; o ofício emitido fica guardado como saiu.</p>
        </div>
      )}
    </Modal>
  );
}
