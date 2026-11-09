/**
 * Aba "Medição" da conta: obrigação de envio do Relatório de Medição, consumo ao vivo de qualquer mês (exatamente como
 * o e-mail) e relatórios do mês (rascunho automático → revisão → envio com as propostas anexadas).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, FileText, Mail, RefreshCw, Send } from 'lucide-react';
import { monthLabel, type MeasurementProposal, type MeasurementTexts } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Textarea } from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Totals = { proposals: number; proposalsCents: number; itemsCents: number; attachmentsBytes: number; withoutAttachment: number };
type Settings = { enabled: boolean; dueDay: number; toAddress: string; ccAddress: string; texts: MeasurementTexts };
type ReportItem = { id: string; referenceMonth: string; dueOn: string; status: 'rascunho' | 'enviado'; subject: string; generatedAt: string; automatic: boolean; sentAt: string | null; sentTo: string | null; sentCc: string | null; error: string | null; totals: Totals };
type Home = { settings: Settings; official: { referenceMonth: string; dueOn: string; today: string } | null; defaultTo: string; reports: ReportItem[] };
type Data = { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; partial: boolean };
type Preview = { subject: string; data: Data; html: string; totals: Totals };
type Full = ReportItem & { data: Data; html: string; to: string; cc: string };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const curMonth = () => today().slice(0, 7);
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024)).toLocaleString('pt-BR')} KB` : `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dl = (p: MeasurementProposal) => `/api/v1/opportunities/${p.opportunityId}/attachments/${p.attachment!.id}/download`;

export function MeasurementTab({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['measurement', contactId], queryFn: () => api<Home>(`/contacts/${contactId}/measurement`) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-6">
      <SettingsCard contactId={contactId} s={d.settings} defaultTo={d.defaultTo} official={d.official} />
      <LiveConsumption contactId={contactId} />
      <section aria-label="Relatórios enviados e a enviar" className="space-y-3">
        <h3 className="font-display text-lg font-bold text-ink">Relatórios</h3>
        {!d.reports.length ? <EmptyState title="Nenhum relatório ainda" description={d.settings.enabled ? 'O rascunho do mês fechado aparece aqui a partir do dia 1.' : 'Marque a conta com envio de Relatório de Medição ou gere um relatório pelo consumo ao vivo.'} /> : (
          <ul className="divide-y divide-line border border-line bg-surface">
            {d.reports.map((r) => (
              <li key={r.id} aria-label={`Relatório ${monthLabel(r.referenceMonth)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-[160px] font-semibold text-ink">{cap(monthLabel(r.referenceMonth))}</span>
                <Chip tone={r.status === 'enviado' ? 'green' : r.dueOn < today() ? 'red' : 'yellow'}>{r.status === 'enviado' ? 'Enviado' : r.dueOn < today() ? 'Atrasado' : 'Rascunho'}</Chip>
                <span className="text-sm text-muted">{r.status === 'enviado' ? `enviado ${fmtDateTime(r.sentAt)} para ${r.sentTo}` : `envio previsto ${fmtDate(r.dueOn)}${r.automatic ? ' · gerado automaticamente' : ''}`}</span>
                <span className="num ml-auto text-sm text-ink">{r.totals.proposals} proposta(s) · {fmtBRL(r.totals.proposalsCents)}</span>
                <Button size="sm" onClick={() => setOpen(r.id)}>{r.status === 'enviado' ? 'Ver' : 'Revisar e enviar'}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <ReportModal id={open} contactId={contactId} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SettingsCard({ contactId, s, defaultTo, official }: { contactId: string; s: Settings; defaultTo: string; official: Home['official'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Settings>({ ...s, toAddress: s.toAddress || defaultTo });
  const [texts, setTexts] = useState(false);
  useEffect(() => setF({ ...s, toAddress: s.toAddress || defaultTo }), [s, defaultTo]);
  const m = useMutation({ mutationFn: (v: Settings) => api(`/contacts/${contactId}/measurement/settings`, { method: 'PUT', body: v }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['measurement', contactId] }); toast({ tone: 'success', message: 'Configuração salva' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <section aria-label="Envio de Relatório de Medição" className="border border-line bg-surface">
      <label className="flex cursor-pointer items-start gap-3 border-b border-line p-4">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        <span><span className="block font-bold text-ink">Envio de Relatório de Medição</span><span className="text-sm text-muted">Esta conta exige o relatório mensal das propostas executadas pelas oportunidades de consumo dos contratos.</span></span>
      </label>
      <div className={clsx('space-y-4 p-4', !f.enabled && 'opacity-60')}>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
          <FormField label="Dia previsto de envio" hint="do mês seguinte ao consumo" htmlFor="mr-day"><Input id="mr-day" type="number" min={1} max={31} className="num" value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} /></FormField>
          <FormField label="Para" hint="vários: separe por vírgula" htmlFor="mr-to"><Input id="mr-to" value={f.toAddress} onChange={(e) => setF({ ...f, toAddress: e.target.value })} placeholder="medicao@cliente.com.br" /></FormField>
          <FormField label="Cópia" htmlFor="mr-cc"><Input id="mr-cc" value={f.ccAddress} onChange={(e) => setF({ ...f, ccAddress: e.target.value })} /></FormField>
        </div>
        {official && s.enabled && <p className="text-sm text-muted">Próximo envio: relatório de <strong className="text-ink">{monthLabel(official.referenceMonth)}</strong>, previsto para <strong className="text-ink">{fmtDate(official.dueOn)}</strong>. O rascunho é gerado automaticamente no dia 1 e atualizado com o CRM até o envio.</p>}
        <button type="button" className="text-sm font-semibold text-primary hover:underline" aria-expanded={texts} onClick={() => setTexts(!texts)}>{texts ? 'Ocultar' : 'Editar'} textos do e-mail</button>
        {texts && <TextsFields t={f.texts} set={(t) => setF({ ...f, texts: t })} />}
        <div className="flex justify-end"><Button variant="primary" loading={m.isPending} onClick={() => m.mutate(f)}>Salvar</Button></div>
      </div>
    </section>
  );
}

function TextsFields({ t, set, disabled }: { t: MeasurementTexts; set: (t: MeasurementTexts) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-3">
      <FormField label="Saudação" htmlFor="mr-g"><Input id="mr-g" disabled={disabled} value={t.greeting} onChange={(e) => set({ ...t, greeting: e.target.value })} /></FormField>
      <FormField label="Introdução" hint="{mes} vira o nome do mês" htmlFor="mr-i"><Textarea id="mr-i" rows={2} disabled={disabled} value={t.intro} onChange={(e) => set({ ...t, intro: e.target.value })} /></FormField>
      <FormField label="Encerramento" htmlFor="mr-c"><Textarea id="mr-c" rows={3} disabled={disabled} value={t.closing} onChange={(e) => set({ ...t, closing: e.target.value })} /></FormField>
    </div>
  );
}

function Summary({ t, partial }: { t: Totals; partial?: boolean }) {
  return (
    <div className="grid gap-px border border-line bg-line sm:grid-cols-4">
      <div className="bg-surface p-3"><p className="text-xs text-muted">Propostas</p><p className="num text-xl font-bold text-ink">{t.proposals}</p></div>
      <div className="bg-surface p-3"><p className="text-xs text-muted">Valor das propostas</p><p className="num text-xl font-bold text-ink">{fmtBRL(t.proposalsCents)}</p></div>
      <div className="bg-surface p-3"><p className="text-xs text-muted">Itens consumidos</p><p className={clsx('num text-xl font-bold', t.itemsCents !== t.proposalsCents ? 'text-[#9A6B00]' : 'text-ink')}>{fmtBRL(t.itemsCents)}</p>{t.itemsCents !== t.proposalsCents && <p className="text-xs text-[#9A6B00]">diferente do valor das propostas: confira os itens</p>}</div>
      <div className="bg-surface p-3"><p className="text-xs text-muted">Anexos</p><p className="num text-xl font-bold text-ink">{mb(t.attachmentsBytes)}</p>{t.withoutAttachment > 0 && <p className="text-xs text-danger">{t.withoutAttachment} proposta(s) sem PDF anexado</p>}{partial && <p className="text-xs text-muted">mês em andamento: parcial</p>}</div>
    </div>
  );
}

/** O corpo do e-mail como o cliente vai receber (isolado do estilo do sistema). */
const EmailFrame = ({ html, subject }: { html: string; subject: string }) => (
  <figure className="border border-line bg-white">
    <figcaption className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-sm"><Mail className="h-4 w-4 text-primary" aria-hidden /><span className="text-muted">Assunto:</span><span className="font-semibold text-ink">{subject}</span></figcaption>
    <iframe title="Prévia do e-mail" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:16px;background:#fff">${html}</body>`} className="h-[560px] w-full" />
  </figure>
);

const Attachments = ({ ps }: { ps: MeasurementProposal[] }) => (
  <ul aria-label="Anexos do e-mail" className="flex flex-wrap gap-2">
    {ps.filter((p) => p.included).map((p) => p.attachment
      ? <li key={p.opportunityId}><a href={dl(p)} className="inline-flex items-center gap-2 border border-line px-3 py-1.5 text-sm text-ink hover:border-primary"><FileText className="h-4 w-4 text-primary" aria-hidden />{p.attachment.filename}<Download className="h-3.5 w-3.5 text-muted" aria-hidden /></a></li>
      : <li key={p.opportunityId} className="inline-flex items-center gap-2 border border-dashed border-danger px-3 py-1.5 text-sm text-danger">OP-{p.code}: sem PDF da proposta</li>)}
  </ul>
);

function LiveConsumption({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(curMonth());
  const q = useQuery({ queryKey: ['measurement', contactId, 'preview', month], queryFn: () => api<Preview>(`/contacts/${contactId}/measurement/preview?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  const gen = useMutation({ mutationFn: () => api<{ id: string }>(`/contacts/${contactId}/measurement/reports`, { method: 'POST', body: { month } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['measurement', contactId] }); toast({ tone: 'success', message: 'Relatório gerado: revise e envie na lista abaixo' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <section aria-label="Consumo ao vivo" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="font-display text-lg font-bold text-ink">Consumo dos contratos</h3><p className="text-sm text-muted">Propostas enviadas no mês pelas oportunidades de consumo, exatamente como sairão no e-mail. Atualiza a cada abertura.</p></div>
        <div className="flex items-end gap-2">
          <FormField label="Mês" htmlFor="mr-month"><Input id="mr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField>
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => void q.refetch()}>Atualizar</Button>
          <Button variant="primary" loading={gen.isPending} disabled={!q.data?.totals.proposals} onClick={() => gen.mutate()}>Gerar relatório para envio</Button>
        </div>
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <Summary t={q.data.totals} partial={q.data.data.partial} />
          {q.data.totals.proposals ? <><Attachments ps={q.data.data.proposals} /><EmailFrame html={q.data.html} subject={q.data.subject} /></> : <EmptyState title="Nenhuma proposta enviada no mês" description="Entram aqui as propostas enviadas (por e-mail ou WhatsApp) nas oportunidades vinculadas a um contrato por medição desta conta. Oportunidades perdidas ficam de fora." />}
        </>
      )}
    </section>
  );
}

function ReportModal({ id, contactId, onClose }: { id: string; contactId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['measurement-report', id], queryFn: () => api<Full>(`/measurement-reports/${id}`) });
  const [subject, setSubject] = useState('');
  const [texts, setTexts] = useState<MeasurementTexts | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (q.data) { setSubject(q.data.subject); setTexts(q.data.data.texts); setTo(q.data.to ?? ''); setCc(q.data.cc ?? ''); } }, [q.data]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['measurement-report', id] }); void qc.invalidateQueries({ queryKey: ['measurement', contactId] }); };
  const save = useMutation({ mutationFn: (excluded: string[]) => api(`/measurement-reports/${id}`, { method: 'PUT', body: { subject, texts, excluded } }), onSuccess: refresh, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const send = useMutation({ mutationFn: async () => { await api(`/measurement-reports/${id}`, { method: 'PUT', body: { subject, texts, excluded: excludedNow } }); return api(`/measurement-reports/${id}/send`, { method: 'POST', body: { to, cc } }); }, onSuccess: () => { refresh(); setConfirm(false); toast({ tone: 'success', message: 'Relatório enviado' }); }, onError: (e) => { setConfirm(false); toast({ tone: 'error', message: errMsg(e) }); } });
  const r = q.data;
  const draft = r?.status === 'rascunho';
  const excludedNow = (r?.data.proposals ?? []).filter((p) => !p.included).map((p) => p.opportunityId);
  const toggle = (p: MeasurementProposal) => save.mutate(p.included ? [...excludedNow, p.opportunityId] : excludedNow.filter((x) => x !== p.opportunityId));
  return (
    <Modal open onClose={onClose} size="xl" title={r ? `Relatório de Medição · ${monthLabel(r.referenceMonth)}` : 'Relatório de Medição'}
      footer={r && (draft ? <><Button onClick={onClose}>Fechar</Button><Button loading={save.isPending} icon={<RefreshCw className="h-4 w-4" />} onClick={() => save.mutate(excludedNow)}>Salvar e atualizar com o CRM</Button><Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!r.totals.proposals} onClick={() => setConfirm(true)}>Enviar</Button></> : <Button onClick={onClose}>Fechar</Button>)}>
      {!r || !texts ? <LoadingRows rows={4} /> : (
        <div className="space-y-4">
          {r.status === 'enviado' && <p className="border-l-4 border-[#15803D] bg-[#ECFDF3] px-3 py-2 text-sm">Enviado em {fmtDateTime(r.sentAt)} para {r.sentTo}{r.sentCc ? ` (cópia: ${r.sentCc})` : ''}. Conteúdo congelado.</p>}
          {r.error && draft && <p className="border-l-4 border-danger bg-[#FEF2F2] px-3 py-2 text-sm text-danger">Última tentativa falhou: {r.error}</p>}
          <Summary t={r.totals} partial={r.data.partial} />
          {draft && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Para" htmlFor="mr-sto"><Input id="mr-sto" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
                <FormField label="Cópia" htmlFor="mr-scc"><Input id="mr-scc" value={cc} onChange={(e) => setCc(e.target.value)} /></FormField>
              </div>
              <FormField label="Assunto" htmlFor="mr-sub"><Input id="mr-sub" value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
              <fieldset className="border border-line p-3"><legend className="px-1 text-sm font-semibold text-ink">Propostas no relatório</legend>
                <ul className="space-y-1">{r.data.proposals.map((p) => (
                  <li key={p.opportunityId}><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={p.included} disabled={save.isPending} onChange={() => toggle(p)} /><span className="num text-muted">{fmtDate(p.sentOn)}</span><span className="font-semibold text-ink">OP-{p.code}</span><span className="text-ink">{p.title}</span><span className="num ml-auto">{fmtBRL(p.valueCents)}</span>{!p.attachment && <Chip tone="red">sem PDF</Chip>}</label></li>
                ))}</ul>
              </fieldset>
              <details className="border border-line p-3"><summary className="cursor-pointer text-sm font-semibold text-ink">Textos do e-mail</summary><div className="mt-3"><TextsFields t={texts} set={setTexts} /></div></details>
            </>
          )}
          <Attachments ps={r.data.proposals} />
          <EmailFrame html={r.html} subject={draft ? subject : r.subject} />
        </div>
      )}
      <ConfirmDialog open={confirm} title="Enviar o Relatório de Medição?" confirmLabel="Enviar" loading={send.isPending} onConfirm={() => send.mutate()} onCancel={() => setConfirm(false)}>
        <p>Para <strong>{to}</strong>{cc ? <> com cópia para <strong>{cc}</strong></> : null}, com {r?.totals.proposals ?? 0} proposta(s) anexada(s). Depois de enviado o conteúdo fica congelado.</p>
        <p className="text-sm text-muted">O que foi alterado nos textos e no assunto é salvo antes do envio.</p>
      </ConfirmDialog>
    </Modal>
  );
}
