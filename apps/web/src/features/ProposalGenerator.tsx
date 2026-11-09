/** Gerar proposta pelo modelo: o vendedor revisa as variáveis, vê a prévia e gera o PDF anexado. */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, ImagePlus, X } from 'lucide-react';
import type { ProposalSectionsConfig } from '@isp/domain';
import { compressImage, fileToBase64 } from '../lib/files';
import { fmtBRL } from '../lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import type { Opportunity } from '../lib/types';
import { WhatsAppSend } from './WhatsAppSend';
import { ProposalCanvas, type PField, type PPage } from './ProposalCanvas';

type Tpl = { id: string; name: string; matches: boolean; sections: ProposalSectionsConfig; variables: { key: string; label: string; type: 'texto' | 'texto_longo' | 'moeda'; default: string }[]; fields: PField[]; pages: PPage[] };

export function ProposalGenerator({ oppId, open, onClose }: { oppId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['proposal-templates', oppId], enabled: open, queryFn: () => api<{ items: Tpl[]; system: Record<string, string> }>(`/opportunities/${oppId}/proposal-templates`) });
  const [tplId, setTplId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [svcText, setSvcText] = useState('');
  const [photos, setPhotos] = useState<{ data: string; mime: string; url: string }[]>([]);
  const [days, setDays] = useState(15);
  const [previewing, setPreviewing] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const itemsQ = useQuery({ queryKey: ['opportunity-items', oppId], enabled: open, queryFn: () => api<{ items: unknown[]; totals: { total: number } }>(`/opportunities/${oppId}/items`) });
  const [sent, setSent] = useState<{ id: string; filename: string } | null>(null);
  const oppQ = useQuery({ queryKey: ['opportunity', oppId], enabled: open, queryFn: () => api<Opportunity>(`/opportunities/${oppId}`) });
  // última proposta da oportunidade (editar e gerar de novo) e o modelo padrão da filial
  const draftQ = useQuery({ queryKey: ['proposal-draft', oppId], enabled: open, queryFn: () => api<{ draft: { templateId: string; values: Record<string, string>; servicesText: string; photos: { data: string; mime: string }[]; validityDays: number | null } | null; branchDefaultTemplateId: string | null }>(`/opportunities/${oppId}/proposal-draft`) });
  const draft = draftQ.data?.draft ?? null;
  useEffect(() => {
    if (!open || !draftQ.data || !q.data) return;
    const want = draft?.templateId ?? draftQ.data.branchDefaultTemplateId;
    if (want && q.data.items.some((t) => t.id === want)) setTplId(want);
    if (draft) {
      setSvcText(draft.servicesText);
      setPhotos(draft.photos.map((p) => { const bin = atob(p.data); const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return { ...p, url: URL.createObjectURL(new Blob([u8], { type: p.mime })) }; }));
    }
  }, [open, draftQ.data, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const tpl = q.data?.items.find((t) => t.id === tplId) ?? q.data?.items[0];
  useEffect(() => {
    if (!tpl) return;
    const fromDraft = draft && draft.templateId === tpl.id;
    setValues(Object.fromEntries(tpl.variables.map((v) => [v.key, fromDraft ? draft.values[v.key] ?? v.default : v.default])));
    setDays(fromDraft && draft.validityDays ? draft.validityDays : tpl.sections?.validityDays ?? 15);
  }, [tpl?.id, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const gen = useMutation({
    mutationFn: () => api<{ id: string; filename: string }>(`/opportunities/${oppId}/proposal`, { method: 'POST', body: payload() }),
    onSuccess: (r) => { for (const k of ['attachments', 'opportunity', 'timeline', 'proposal-draft']) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: `Proposta gerada e anexada: ${r.filename}` }); setSent(r); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const all = { ...(q.data?.system ?? {}), ...values };
  const sec = tpl?.sections?.enabled;
  const payload = () => ({ templateId: tpl!.id, values, ...(sec ? { services: { text: svcText, photos: photos.map(({ data, mime }) => ({ data, mime })) }, validityDays: days } : {}) });
  const addPhotos = async (files: FileList) => {
    const next = [...photos];
    for (const f of [...files].slice(0, 8 - photos.length)) {
      if (!/^image\/(png|jpeg)$/.test(f.type)) { toast({ tone: 'error', message: `${f.name}: envie JPG ou PNG.` }); continue; }
      const c = await compressImage(f, { maxBytes: 380_000, maxDim: 1600 });
      next.push({ data: await fileToBase64(c), mime: c.type === 'image/png' ? 'image/png' : 'image/jpeg', url: URL.createObjectURL(c) });
    }
    setPhotos(next);
  };
  const move = (i: number, d: -1 | 1) => { const n = [...photos]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; setPhotos(n); };
  const preview = async () => {
    setPreviewing(true);
    const win = window.open('', '_blank'); // abre já no clique (bloqueador de pop-up)
    try {
      const r = await fetch(`/api/v1/opportunities/${oppId}/proposal/preview`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { detail?: string }).detail ?? 'Não foi possível gerar a prévia.'); }
      const url = URL.createObjectURL(await r.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (e) { win?.close(); toast({ tone: 'error', message: (e as Error).message }); } finally { setPreviewing(false); }
  };
  if (sent && oppQ.data) return <WhatsAppSend opp={oppQ.data} attachment={sent} open={open} onClose={() => { setSent(null); onClose(); }} />;
  return (
    <Modal open={open} onClose={onClose} title={draft ? 'Editar proposta' : 'Gerar proposta'} size="xl" footer={<><Button onClick={onClose}>Cancelar</Button>{tpl && <Button icon={<Eye className="h-4 w-4" />} loading={previewing} onClick={() => void preview()}>Prévia do PDF</Button>}<Button variant="primary" loading={gen.isPending} disabled={!tpl} onClick={() => gen.mutate()}>{draft ? 'Gerar nova versão e anexar' : 'Gerar PDF e anexar'}</Button></>}>
      {q.isLoading ? <LoadingRows rows={5} /> : !tpl ? (
        <EmptyState title="Nenhum modelo de proposta pronto" description="A gerência cadastra o modelo (com a arte do Canva) em Configurações → Modelos de proposta." />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            {q.data!.items.length > 1 && (
              <FormField label="Modelo" htmlFor="pg-tpl">
                <Select id="pg-tpl" value={tpl.id} onChange={(e) => setTplId(e.target.value)}>{q.data!.items.map((t) => <option key={t.id} value={t.id}>{t.name}{t.matches ? '' : ' (outro tipo de deal)'}</option>)}</Select>
              </FormField>
            )}
            <p className="text-xs text-muted">Cliente, CNPJ, plano, valor e taxa de ativação vêm da oportunidade. Revise os campos abaixo.</p>
            {tpl.variables.map((v) => (
              <FormField key={v.key} label={v.label} htmlFor={`pg-${v.key}`}>
                {v.type === 'texto_longo'
                  ? <Textarea id={`pg-${v.key}`} value={values[v.key] ?? ''} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />
                  : <Input id={`pg-${v.key}`} inputMode={v.type === 'moeda' ? 'decimal' : undefined} value={values[v.key] ?? ''} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />}
              </FormField>
            ))}
            {sec && (
              <div className="space-y-3 border-t border-line pt-3">
                <FormField label={tpl.sections.titles.services} hint="o que será feito; vira o texto da seção" htmlFor="pg-svc"><Textarea id="pg-svc" rows={5} value={svcText} onChange={(e) => setSvcText(e.target.value)} /></FormField>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-ink">Fotos ({photos.length}/8)</p>
                  <p className="text-xs text-muted">Organizadas sozinhas na página, sem cortar nem distorcer. A ordem aqui é a ordem no PDF.</p>
                  {!!photos.length && <ul aria-label="Fotos da proposta" className="grid grid-cols-3 gap-2">{photos.map((p, i) => (
                    <li key={p.url} className="relative border border-line"><img src={p.url} alt={`Foto ${i + 1}`} className="h-20 w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 text-white">
                        <button type="button" aria-label={`Mover foto ${i + 1} para trás`} onClick={() => move(i, -1)} className="p-1"><ArrowUp className="h-3.5 w-3.5 -rotate-90" /></button>
                        <button type="button" aria-label={`Remover foto ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="p-1"><X className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`Mover foto ${i + 1} para frente`} onClick={() => move(i, 1)} className="p-1"><ArrowDown className="h-3.5 w-3.5 -rotate-90" /></button>
                      </div></li>))}</ul>}
                  <input ref={photoRef} type="file" accept="image/png,image/jpeg" multiple className="sr-only" aria-label="Fotos dos serviços" onChange={(e) => { if (e.target.files) void addPhotos(e.target.files); e.target.value = ''; }} />
                  <Button size="sm" icon={<ImagePlus className="h-4 w-4" />} disabled={photos.length >= 8} onClick={() => photoRef.current?.click()}>Adicionar fotos</Button>
                </div>
                <div className="border border-line bg-surface-2 px-3 py-2 text-sm"><span className="font-semibold text-ink">{tpl.sections.titles.investment}:</span> {itemsQ.data ? (itemsQ.data.items.length ? <>{itemsQ.data.items.length} item(ns) da aba Produto · {fmtBRL(itemsQ.data.totals.total)}</> : <span className="text-[#9A6B00]">nenhum item na aba Produto: a tabela não sai</span>) : '…'}</div>
                <FormField label={`${tpl.sections.titles.condition}: prazo (dias)`} htmlFor="pg-days"><Input id="pg-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 15)))} /></FormField>
              </div>
            )}
            {!q.data!.system['cliente.documento'] && <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-[#9A5B00]">O CNPJ do cliente não está cadastrado; o campo sai em branco.</p>}
          </div>
          <div className="min-w-0 space-y-3">
            {tpl.pages.map((p, i) => (
              <div key={p.id} className="mx-auto max-w-[520px] overflow-hidden rounded-md border border-line shadow-sm">
                <ProposalCanvas templateId={tpl.id} page={p} index={i} fields={tpl.fields} values={all} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
