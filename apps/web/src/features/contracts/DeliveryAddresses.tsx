/**
 * Contrato → Endereços de entrega: tabela editável (sequência, endereço, banda/serviço e colunas extras),
 * colar do Excel com a linha de títulos, importar planilha (.xlsx/.csv) e baixar o modelo.
 */
import { useState } from 'react';
import { ClipboardPaste, Download, FileSpreadsheet, Plus, Trash2, Columns3 } from 'lucide-react';
import { deliveryTemplateCsv, mergeDelivery, parseDeliveryTable, type DeliveryAddresses } from '@isp/domain';
import { Button, Input, Notice, Textarea } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlay';

export const EMPTY_DELIVERY: DeliveryAddresses = { columns: [], rows: [] };

export function DeliveryEditor({ value, onChange }: { value: DeliveryAddresses; onChange: (v: DeliveryAddresses) => void }) {
  const [msg, setMsg] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const d = value;
  const add = (table: (string | number | null)[][], from: string) => {
    const r = parseDeliveryTable(table, d);
    if (r.missing.length) { setMsg({ tone: 'warning', text: `${from}: falta a coluna Endereço. A primeira linha precisa ter os títulos, em qualquer ordem: Sequência, Endereço (obrigatória) e Banda/Serviço; outros títulos viram colunas extras.` }); return; }
    if (!r.rows.length && r.errors.length) { setMsg({ tone: 'warning', text: `${from}: ${r.errors[0]!.message}` }); return; }
    onChange(mergeDelivery(d, { columns: r.columns, rows: r.rows }));
    setMsg({ tone: r.errors.length ? 'warning' : 'info', text: `${from}: ${r.rows.length} endereço(s) incluído(s)${r.errors.length ? `; ${r.errors.length} linha(s) ignorada(s): ${r.errors.slice(0, 4).map((e) => `linha ${e.row} (${e.message})`).join('; ')}` : ''}. Sequência repetida substitui a linha anterior. Confira antes de salvar.` });
  };
  const onFile = async (file: File) => {
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const { default: readXlsx } = await import('read-excel-file');
        add((await readXlsx(file)) as (string | number | null)[][], file.name);
      } else {
        const text = await file.text();
        const first = text.split('\n')[0] ?? '';
        const sep = text.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
        add(text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, ''))), file.name);
      }
    } catch { setMsg({ tone: 'warning', text: `Não foi possível ler ${file.name}. Use Excel (.xlsx) ou CSV.` }); }
  };
  const template = () => {
    const blob = new Blob([`﻿${deliveryTemplateCsv(d.columns)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'modelo-enderecos-de-entrega.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const setRow = (i: number, p: Partial<DeliveryAddresses['rows'][number]>) => onChange({ ...d, rows: d.rows.map((r, k) => (k === i ? { ...r, ...p } : r)) });
  const setExtra = (i: number, col: string, v: string) => { const r = d.rows[i]!; const extra = { ...r.extra }; if (v) extra[col] = v; else delete extra[col]; setRow(i, { extra }); };
  const renameCol = (k: number, name: string) => {
    const old = d.columns[k]!;
    onChange({ columns: d.columns.map((c, j) => (j === k ? name : c)), rows: d.rows.map((r) => { if (!(old in r.extra)) return r; const { [old]: v, ...rest } = r.extra; return { ...r, extra: { ...rest, [name]: v! } }; }) });
  };
  const removeCol = (k: number) => { const old = d.columns[k]!; onChange({ columns: d.columns.filter((_, j) => j !== k), rows: d.rows.map((r) => { const { [old]: _x, ...rest } = r.extra; return { ...r, extra: rest }; }) }); };
  const nextSeq = d.rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => { setPaste(''); setPasting(true); }}>Colar do Excel</Button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">
          <FileSpreadsheet className="h-4 w-4" aria-hidden />Importar planilha
          <input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label="Importar planilha de endereços de entrega" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); e.target.value = ''; }} />
        </label>
        <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={template}>Baixar modelo</Button>
        <Button size="sm" icon={<Columns3 className="h-4 w-4" />} disabled={d.columns.length >= 12} onClick={() => { let n = d.columns.length + 1, name = `Coluna ${n}`; while (d.columns.includes(name)) name = `Coluna ${++n}`; onChange({ ...d, columns: [...d.columns, name] }); }}>Nova coluna</Button>
      </div>
      {msg && <div className="mb-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {d.rows.length === 0 && !d.columns.length ? (
        <p className="text-sm text-muted">Nenhum endereço de entrega. Um contrato pode ter vários pontos: digite, cole do Excel ou importe a planilha.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" style={{ minWidth: 640 + d.columns.length * 170 }} aria-label="Endereços de entrega">
            <thead className="text-xs text-muted">
              <tr>
                <th className="w-[80px] px-1 py-1 font-medium">Sequência</th>
                <th className="min-w-[300px] px-1 py-1 font-medium">Endereço</th>
                <th className="w-[180px] px-1 py-1 font-medium">Banda/Serviço</th>
                {d.columns.map((c, k) => (
                  <th key={k} className="w-[170px] px-1 py-1 font-medium">
                    <span className="flex items-center gap-1">
                      <Input aria-label={`Nome da coluna ${k + 1}`} className="h-7 text-xs font-semibold" value={c} onChange={(e) => renameCol(k, e.target.value)} />
                      <button type="button" className="p-0.5 text-muted hover:text-danger" aria-label={`Tirar coluna ${c}`} onClick={() => removeCol(k)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-1 py-1"><Input aria-label={`Sequência da linha ${i + 1}`} inputMode="numeric" className="num h-8" value={String(r.seq)} onChange={(e) => setRow(i, { seq: Number(e.target.value.replace(/\D/g, '') || 0) })} /></td>
                  <td className="px-1 py-1"><Input aria-label={`Endereço da linha ${i + 1}`} className="h-8" value={r.address} onChange={(e) => setRow(i, { address: e.target.value })} /></td>
                  <td className="px-1 py-1"><Input aria-label={`Banda/Serviço da linha ${i + 1}`} className="h-8" value={r.service ?? ''} onChange={(e) => setRow(i, { service: e.target.value || null })} /></td>
                  {d.columns.map((c) => <td key={c} className="px-1 py-1"><Input aria-label={`${c} da linha ${i + 1}`} className="h-8" value={r.extra[c] ?? ''} onChange={(e) => setExtra(i, c, e.target.value)} /></td>)}
                  <td className="px-1 py-1"><button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Tirar endereço da linha ${i + 1}`} onClick={() => onChange({ ...d, rows: d.rows.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange({ ...d, rows: [...d.rows, { seq: nextSeq, address: '', service: null, extra: {} }] })}>Adicionar endereço</Button>
        {d.rows.length > 0 && <p className="text-sm text-muted">{d.rows.length} endereço(s) de entrega</p>}
      </div>
      <Modal open={pasting} onClose={() => setPasting(false)} title="Colar endereços do Excel" size="lg"
        footer={<><Button onClick={() => setPasting(false)}>Cancelar</Button><Button variant="primary" disabled={!paste.trim()} onClick={() => { add(paste.split(/\r?\n/).map((l) => l.split('\t')), 'Colado'); setPasting(false); }}>Incluir endereços</Button></>}>
        <p className="mb-2 text-sm text-muted">Copie no Excel as linhas com a linha de títulos: Sequência, Endereço e Banda/Serviço, em qualquer ordem. Outros títulos (ex.: Contato local, Prazo) viram colunas extras. Sem sequência, os endereços são numerados na ordem.</p>
        <Textarea aria-label="Endereços colados" rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} />
      </Modal>
    </div>
  );
}

/** Leitura na ficha do contrato. */
export function DeliveryList({ value }: { value: DeliveryAddresses | null | undefined }) {
  const d = value ?? EMPTY_DELIVERY;
  if (!d.rows.length) return null;
  return (
    <div>
      <h2 className="mb-1 font-bold text-ink">Endereços de entrega <span className="text-sm font-normal text-muted">({d.rows.length})</span></h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm" aria-label="Endereços de entrega do contrato">
          <thead className="text-xs text-muted"><tr>{['Seq.', 'Endereço', 'Banda/Serviço', ...d.columns].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.seq} className="border-t border-line"><td className="num px-2 py-1.5">{r.seq}</td><td className="px-2 py-1.5">{r.address}</td><td className="px-2 py-1.5">{r.service ?? '—'}</td>{d.columns.map((c) => <td key={c} className="px-2 py-1.5">{r.extra[c] ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
