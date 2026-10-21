/**
 * Importação em massa dos itens da ata: arquivo (CSV ou Excel) → mapeamento de colunas → prévia validada no servidor → aplicar.
 * O arquivo é lido no navegador; só as linhas já mapeadas vão para o servidor, que valida de novo e grava tudo ou nada.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, autoMap, type ImportField } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, FormField, Input, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';
import { FitText } from '../../components/ui/FitText';

type Cell = string | number | boolean | Date | null;
type Sheet = { name: string; rows: Cell[][] };
type Target = ImportField | 'extra' | '';
type Preview = {
  applied: boolean; valid: number;
  issues: { row: number; field?: ImportField; message: string; level: 'erro' | 'aviso' }[];
  report: { created: string[]; completed: string[]; corrected: string[]; blocked: { row: number; item: string; reason: string }[]; unchanged: number; allocations: number; newAgencies: string[] };
};
const REQUIRED: ImportField[] = ['itemNumber', 'description', 'unit', 'registeredQty'];

/** CSV com ; , ou tab (o separador mais frequente na primeira linha), aspas e quebras dentro de aspas. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = ([';', ',', '\t'] as const).map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function readFile(f: File): Promise<Sheet[]> {
  if (/\.(csv|txt)$/i.test(f.name)) {
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // planilhas salvas no Excel em português
    return [{ name: f.name, rows: parseCsv(text) }];
  }
  if (/\.xlsx$/i.test(f.name)) {
    const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
    const names = await readSheetNames(f);
    const out: Sheet[] = [];
    for (const name of names) out.push({ name, rows: (await readXlsxFile(f, { sheet: name })) as Cell[][] });
    return out;
  }
  throw new Error('Use um arquivo .xlsx ou .csv. Para .xls antigo, salve como .xlsx no Excel.');
}
const cellText = (c: Cell) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

export function ImportWizard({ arpId, open, onClose, onDone, status }: { arpId: string; open: boolean; onClose: () => void; onDone: () => void; status: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIx, setSheetIx] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [map, setMap] = useState<Record<string, Target>>({});
  const [step, setStep] = useState<'arquivo' | 'colunas' | 'previa'>('arquivo');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [authorize, setAuthorize] = useState(false);
  const [reason, setReason] = useState('');
  const [acceptErrors, setAcceptErrors] = useState(false);
  const [mapName, setMapName] = useState('');
  const [reading, setReading] = useState(false);
  const mappings = useQuery({ queryKey: ['arp-import-mappings'], enabled: open, queryFn: () => api<{ items: { id: string; name: string; mapping: Record<string, string> }[] }>('/arp-import-mappings') });

  const sheet = sheets[sheetIx];
  const headers = useMemo(() => {
    const h = (sheet?.rows[headerRow - 1] ?? []).map(cellText);
    // cabeçalhos repetidos ou vazios ganham sufixo para não colidir
    const seen = new Map<string, number>();
    return h.map((x, i) => { const base = x.trim() || `Coluna ${i + 1}`; const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return n > 1 ? `${base} (${n})` : base; });
  }, [sheet, headerRow]);
  const body = useMemo(() => (sheet?.rows.slice(headerRow) ?? []).filter((r) => r.some((c) => cellText(c).trim() !== '')), [sheet, headerRow]);
  const mapped = useMemo(() => body.map((r) => {
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const t = map[h];
      if (!t) return;
      const v = r[i] ?? null;
      const val = v instanceof Date ? v.toISOString().slice(0, 10) : v;
      if (t === 'extra') o[`extra:${h}`] = val;
      else o[t] = val;
    });
    return o;
  }), [body, headers, map]);
  const usedFields = Object.values(map).filter((t): t is ImportField => !!t && t !== 'extra');
  const missing = REQUIRED.filter((f) => !usedFields.includes(f)).concat(usedFields.includes('unitPrice') || usedFields.includes('totalPrice') ? [] : ['unitPrice']);
  const dupFields = usedFields.filter((f, i) => usedFields.indexOf(f) !== i);

  const reset = () => { setFileName(''); setSheets([]); setSheetIx(0); setHeaderRow(1); setMap({}); setStep('arquivo'); setPreview(null); setAuthorize(false); setReason(''); setAcceptErrors(false); };
  const close = () => { reset(); onClose(); };
  const pick = async (f: File) => {
    setReading(true);
    try {
      const sh = (await readFile(f)).filter((s) => s.rows.length);
      if (!sh.length) throw new Error('O arquivo está vazio.');
      setSheets(sh); setSheetIx(0); setFileName(f.name);
      const hr = Math.max(1, sh[0]!.rows.findIndex((r) => r.filter((c) => cellText(c).trim()).length >= 3) + 1);
      setHeaderRow(hr);
      const h = (sh[0]!.rows[hr - 1] ?? []).map(cellText);
      setMap(autoMap(h.map((x, i) => x.trim() || `Coluna ${i + 1}`)) as Record<string, Target>);
      setStep('colunas');
    } catch (e) {
      toast({ tone: 'error', message: errMsg(e) });
    } finally { setReading(false); }
  };
  const remap = (hr: number, ix = sheetIx) => {
    setHeaderRow(hr);
    const h = (sheets[ix]?.rows[hr - 1] ?? []).map((c, i) => cellText(c).trim() || `Coluna ${i + 1}`);
    setMap(autoMap(h) as Record<string, Target>);
  };

  const run = useMutation({
    mutationFn: (apply: boolean) => api<Preview>(`/arps/${arpId}/import`, { method: 'POST', body: { rows: mapped, apply, authorizeCorrections: authorize, reason, fileName } }),
    onSuccess: (r) => {
      setPreview(r);
      if (r.applied) { toast({ tone: 'success', message: `Importação aplicada: ${r.report.created.length} item(ns) novo(s), ${r.report.completed.length + r.report.corrected.length} atualizado(s).` }); onDone(); close(); }
      else setStep('previa');
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveMap = useMutation({
    mutationFn: () => api('/arp-import-mappings', { method: 'POST', body: { name: mapName, mapping: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['arp-import-mappings'] }); setMapName(''); toast({ tone: 'success', message: 'Modelo de mapeamento salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const applySaved = (id: string) => {
    const m = mappings.data?.items.find((x) => x.id === id);
    if (!m) return;
    setMap(Object.fromEntries(headers.map((h) => [h, (m.mapping[h] as Target) ?? ''])));
  };

  const errors = preview?.issues.filter((i) => i.level === 'erro') ?? [];
  const warnings = preview?.issues.filter((i) => i.level === 'aviso') ?? [];
  const r = preview?.report;
  const needsReason = authorize && reason.trim().length < 5;

  return (
    <Modal open={open} onClose={close} title="Importar itens da ata" size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <ol className="flex gap-4 text-sm text-muted" aria-label="Etapas">
            {(['arquivo', 'colunas', 'previa'] as const).map((s, i) => <li key={s} className={clsx(step === s && 'font-semibold text-ink')} aria-current={step === s ? 'step' : undefined}>{i + 1}. {s === 'arquivo' ? 'Arquivo' : s === 'colunas' ? 'Colunas' : 'Prévia'}</li>)}
          </ol>
          <div className="flex gap-2">
            {step !== 'arquivo' && <Button variant="secondary" onClick={() => setStep(step === 'previa' ? 'colunas' : 'arquivo')}>Voltar</Button>}
            {step === 'colunas' && <Button variant="primary" loading={run.isPending} disabled={!!missing.length || !!dupFields.length || !mapped.length} onClick={() => run.mutate(false)}>Validar {mapped.length} linha(s)</Button>}
            {step === 'previa' && <Button variant="primary" loading={run.isPending} disabled={!preview?.valid || (errors.length > 0 && !acceptErrors) || needsReason} onClick={() => run.mutate(true)}>Aplicar importação</Button>}
          </div>
        </div>
      }>
      {step === 'arquivo' && (
        <div className="space-y-4">
          <p className="text-sm text-text">Envie a planilha da ata em Excel (.xlsx) ou CSV. Você confere as colunas e vê a prévia antes de gravar. Nada é gravado até você aplicar.</p>
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-strong bg-surface-2 px-6 py-10 text-center hover:border-primary"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void pick(f); }}>
            <Upload className="h-8 w-8 text-primary" aria-hidden />
            <span className="font-semibold text-ink">{reading ? 'Lendo o arquivo…' : 'Escolher arquivo ou arrastar aqui'}</span>
            <span className="text-sm text-muted">.xlsx ou .csv, até 5.000 linhas</span>
          </button>
          <input ref={input} type="file" className="sr-only" aria-label="Arquivo da planilha" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
          <a className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" href="/api/v1/arps/import-template.csv" download><Download className="h-4 w-4" />Baixar planilha modelo</a>
          {status !== 'rascunho' && <Notice tone="warning">Ata vigente: a importação só completa dados cadastrais vazios. Itens novos, quantidades e preços oficiais não mudam por planilha.</Notice>}
        </div>
      )}

      {step === 'colunas' && sheet && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink"><FileSpreadsheet className="h-5 w-5 text-primary" aria-hidden />{fileName}</p>
            {sheets.length > 1 && <FormField label="Aba" htmlFor="imp-sheet"><Select id="imp-sheet" value={sheetIx} onChange={(e) => { const ix = Number(e.target.value); setSheetIx(ix); remap(1, ix); }}>{sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</Select></FormField>}
            <FormField label="Linha do cabeçalho" htmlFor="imp-hr"><Select id="imp-hr" value={headerRow} onChange={(e) => remap(Number(e.target.value))}>{Array.from({ length: Math.min(15, sheet.rows.length) }, (_, i) => <option key={i} value={i + 1}>Linha {i + 1}</option>)}</Select></FormField>
            {!!mappings.data?.items.length && <FormField label="Modelo salvo" htmlFor="imp-saved"><Select id="imp-saved" defaultValue="" onChange={(e) => applySaved(e.target.value)}><option value="">Escolher…</option>{mappings.data.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></FormField>}
          </div>
          {!!missing.length && <Notice tone="warning">Faltam colunas obrigatórias: {missing.map((f) => IMPORT_FIELD_LABELS[f]).join(', ')}{missing.includes('unitPrice') ? ' (ou valor total)' : ''}.</Notice>}
          {!!dupFields.length && <Notice tone="warning">Campo usado em mais de uma coluna: {[...new Set(dupFields)].map((f) => IMPORT_FIELD_LABELS[f]).join(', ')}.</Notice>}
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Coluna do arquivo</th><th className="px-3 py-2 font-medium">Campo no sistema</th><th className="px-3 py-2 font-medium">Exemplos</th></tr></thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={h} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold text-ink">{h}</td>
                    <td className="px-3 py-2">
                      <Select aria-label={`Campo para a coluna ${h}`} className="h-9" value={map[h] ?? ''} onChange={(e) => setMap({ ...map, [h]: e.target.value as Target })}>
                        <option value="">Ignorar</option>
                        {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{IMPORT_FIELD_LABELS[f]}{REQUIRED.includes(f) ? ' *' : ''}</option>)}
                        <option value="extra">Guardar como informação extra</option>
                      </Select>
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-muted">{body.slice(0, 3).map((r) => cellText(r[i] ?? null)).filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Salvar este mapeamento como modelo" htmlFor="imp-mapname"><Input id="imp-mapname" placeholder="Ex.: Planilha padrão Compras.gov" value={mapName} onChange={(e) => setMapName(e.target.value)} /></FormField>
            <Button variant="secondary" disabled={mapName.trim().length < 2} loading={saveMap.isPending} onClick={() => saveMap.mutate()}>Salvar modelo</Button>
          </div>
        </div>
      )}

      {step === 'previa' && preview && r && (
        <div className="space-y-4">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Itens novos', r.created.length], ['Completados', r.completed.length], ['Corrigidos', r.corrected.length], ['Distribuições por órgão', r.allocations], ['Sem mudança', r.unchanged], ['Órgãos novos', r.newAgencies.length], ['Bloqueados', r.blocked.length], ['Linhas com erro', errors.length]].map(([l, n]) => (
              <li key={l as string} className={clsx('rounded-md border px-3 py-2', (l === 'Bloqueados' || l === 'Linhas com erro') && Number(n) > 0 ? 'border-danger/40 bg-danger-soft' : 'border-line')}>
                <FitText className="num text-xl font-bold text-ink">{n}</FitText><p className="text-xs text-muted">{l}</p>
              </li>
            ))}
          </ul>
          {!errors.length && !r.blocked.length && <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-5 w-5" aria-hidden />Tudo certo: {preview.valid} linha(s) válida(s).</p>}
          {!!r.newAgencies.length && <Notice>Órgãos participantes que serão cadastrados: {r.newAgencies.join(', ')}.</Notice>}
          {(!!errors.length || !!r.blocked.length || !!warnings.length) && (
            <div className="max-h-[280px] overflow-y-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Linha</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">O que acontece</th></tr></thead>
                <tbody>
                  {errors.map((i, k) => <tr key={`e${k}`} className="border-t border-line"><td className="num px-3 py-2">{i.row}</td><td className="px-3 py-2 font-semibold text-danger">Erro</td><td className="px-3 py-2">{i.message} A linha não entra.</td></tr>)}
                  {r.blocked.map((b, k) => <tr key={`b${k}`} className="border-t border-line"><td className="num px-3 py-2">{b.row}</td><td className="px-3 py-2 font-semibold text-danger">Bloqueado</td><td className="px-3 py-2">{b.item}: {b.reason}</td></tr>)}
                  {warnings.map((i, k) => <tr key={`w${k}`} className="border-t border-line"><td className="num px-3 py-2">{i.row}</td><td className="px-3 py-2 font-semibold text-[#C2610C]">Aviso</td><td className="px-3 py-2">{i.message}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          {r.blocked.some((b) => b.reason.includes('autoriza')) && (
            <div className="space-y-2 rounded-md border border-line p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" checked={authorize} onChange={(e) => { setAuthorize(e.target.checked); setPreview(null); setStep('colunas'); }} />Corrigir dados já cadastrados com autorização</label>
              <p className="text-xs text-muted">Só vale com a ata em cadastro e sem movimentações no item. Ao marcar, valide de novo.</p>
            </div>
          )}
          {authorize && <FormField label="Motivo da correção" htmlFor="imp-reason" required error={needsReason ? 'Explique o motivo (mín. 5 caracteres)' : undefined}><Textarea id="imp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
          {!!errors.length && <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" checked={acceptErrors} onChange={(e) => setAcceptErrors(e.target.checked)} /><span><AlertTriangle className="mr-1 inline h-4 w-4 text-[#C2610C]" aria-hidden />Importar só as {preview.valid} linha(s) válida(s) e deixar as linhas com erro de fora.</span></label>}
        </div>
      )}
    </Modal>
  );
}
