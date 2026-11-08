/**
 * Envio de arquivos ao conector: CSV ou planilha Excel (.xlsx). Cada aba vira uma entidade de origem. Como exportações
 * (ex.: negociações do RD Station) não trazem ID, cada linha é identificada por colunas escolhidas aqui — sugeridas
 * automaticamente quando a planilha é uma exportação conhecida.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { Button, FormField, Input, Notice } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Sheet = { name: string; include: boolean; entity: string; headers: string[]; idCols: string[]; rows: number; csv: string; kind: string | null };
const pad = (n: number) => String(n).padStart(2, '0');
/** Valor da célula como texto estável: datas ISO, horas HH:MM, números com ponto decimal. */
function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const y = v.getUTCFullYear(), hh = v.getUTCHours(), mi = v.getUTCMinutes();
    if (y <= 1900) return `${pad(hh)}:${pad(mi)}`;
    const d = `${y}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return hh || mi ? `${d} ${pad(hh)}:${pad(mi)}` : d;
  }
  return String(v);
}
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
function toCsv(rows: unknown[][]): { csv: string; headers: string[]; count: number } {
  const head = (rows[0] ?? []).map((h) => cellText(h).trim());
  const keep = head.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);
  const out = [keep.map((i) => quote(head[i]!)).join(';')];
  let count = 0;
  for (const r of rows.slice(1)) {
    const vals = keep.map((i) => cellText(r[i]));
    if (!vals.some((v) => v.trim())) continue;
    out.push(vals.map(quote).join(';'));
    count++;
  }
  return { csv: out.join('\n') + '\n', headers: keep.map((i) => head[i]!), count };
}
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'aba';

export function UploadFiles({ connectorId, onClose, onDone }: { connectorId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const read = async (f: File) => {
    setReading(true); setFileName(f.name);
    try {
      let raw: { name: string; rows: unknown[][] }[];
      if (/\.xlsx$/i.test(f.name)) {
        const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
        const names = await readSheetNames(f);
        raw = await Promise.all(names.map(async (name) => ({ name, rows: (await readXlsxFile(f, { sheet: name })) as unknown[][] })));
      } else {
        const text = await f.text();
        const sep = (text.split(/\r?\n/, 1)[0]!.match(/;/g)?.length ?? 0) >= (text.split(/\r?\n/, 1)[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
        const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
        for (let i = 0; i < text.length; i++) { const ch = text[i]!; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        raw = [{ name: f.name.replace(/\.csv$/i, ''), rows }];
      }
      const out: Sheet[] = [];
      for (const r of raw) {
        const c = toCsv(r.rows);
        if (!c.count || !c.headers.length) continue;
        const sug = await api<{ columns: string[]; kind: string | null }>('/admin/import/id-columns', { method: 'POST', body: { headers: c.headers } }).catch(() => ({ columns: [], kind: null }));
        out.push({ name: r.name, include: !!sug.kind || raw.length === 1, entity: slug(r.name), headers: c.headers, idCols: sug.columns, rows: c.count, csv: c.csv, kind: sug.kind });
      }
      setSheets(out);
    } catch (e) { toast({ tone: 'error', message: `Não consegui ler o arquivo: ${(e as Error).message}` }); }
    finally { setReading(false); }
  };
  const send = useMutation({
    mutationFn: async () => {
      const list = sheets!.filter((s) => s.include);
      let total = 0;
      for (const [i, s] of list.entries()) {
        setProgress(`Enviando ${s.name} (${i + 1} de ${list.length})…`);
        const r = await api<{ rows: number }>(`/admin/import/connectors/${connectorId}/files`, { method: 'POST', body: { entity: s.entity, name: `${fileName} · ${s.name}`, idColumn: s.idCols.length ? s.idCols.join(' + ') : null, content: s.csv } });
        total += r.rows;
      }
      return { total, n: list.length };
    },
    onSuccess: (r) => { setProgress(null); toast({ tone: 'success', message: `${r.n} aba(s), ${r.total} linha(s) recebidas` }); onDone(); },
    onError: (e) => { setProgress(null); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const upd = (i: number, p: Partial<Sheet>) => setSheets(sheets!.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const chosen = sheets?.filter((s) => s.include) ?? [];
  const entities = chosen.map((s) => s.entity);
  const dupEntity = entities.some((e, i) => entities.indexOf(e) !== i);
  return (
    <Modal open onClose={onClose} size="xl" title="Enviar arquivo" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={send.isPending} disabled={!chosen.length || dupEntity || chosen.some((s) => s.entity.length < 2)} onClick={() => send.mutate()}>{chosen.length > 1 ? `Enviar ${chosen.length} abas` : 'Enviar'}</Button></>}>
      <div className="space-y-4">
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Arquivo CSV ou Excel" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
        {reading && <p className="text-sm text-muted">Lendo a planilha…</p>}
        {progress && <p className="text-sm text-primary" role="status">{progress}</p>}
        {sheets && !sheets.length && <Notice tone="warning">Nenhuma aba com dados.</Notice>}
        {sheets && !!sheets.length && (<>
          <p className="text-sm text-text">Marque as abas que entram. Cada aba vira uma entidade de origem. As colunas de ID identificam cada linha e evitam duplicar quando você reenviar o arquivo.</p>
          <ul className="space-y-2" aria-label="Abas do arquivo">
            {sheets.map((s, i) => (
              <li key={s.name} className={clsx('rounded-md border p-3', s.include ? 'border-primary/50 bg-primary-soft/30' : 'border-line')} aria-label={`Aba ${s.name}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={s.include} onChange={(e) => upd(i, { include: e.target.checked })} />{s.name}</label>
                  <span className="text-xs text-muted">{s.rows} linha(s) · {s.headers.length} coluna(s)</span>
                  {s.kind === 'negociacoes_rd' && <span className="rounded-sm bg-lime/60 px-1.5 text-[11px] font-bold text-navy">Exportação de negociações do RD</span>}
                  {s.kind === 'tarefas_rd' && <span className="rounded-sm bg-lime/60 px-1.5 text-[11px] font-bold text-navy">Exportação de tarefas do RD</span>}
                </div>
                {s.include && (
                  <div className="mt-2 grid gap-2 md:grid-cols-[200px_minmax(0,1fr)]">
                    <FormField label="Entidade" htmlFor={`up-e-${i}`}><Input id={`up-e-${i}`} value={s.entity} onChange={(e) => upd(i, { entity: e.target.value.replace(/[^\w-]/g, '') })} /></FormField>
                    <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Colunas de ID</legend>
                      <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">{s.headers.map((h) => { const on = s.idCols.includes(h); return <button key={h} type="button" aria-pressed={on} onClick={() => upd(i, { idCols: on ? s.idCols.filter((x) => x !== h) : [...s.idCols, h] })} className={clsx('border px-1.5 py-0.5 text-[11px]', on ? 'border-primary bg-primary text-white' : 'border-line text-text')}>{h}</button>; })}</div>
                      <p className="mt-1 text-[11px] text-muted">{s.idCols.length ? `ID = ${s.idCols.join(' + ')}` : 'Sem ID: a linha vira o ID (reenviar pode duplicar).'}</p>
                    </fieldset>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {dupEntity && <p className="text-sm text-danger">Duas abas com o mesmo nome de entidade.</p>}
        </>)}
      </div>
    </Modal>
  );
}
