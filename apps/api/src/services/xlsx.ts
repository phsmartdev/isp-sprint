/** Leitura mínima de .xlsx (sem dependência nova): nomes das abas e valores das células, linha a linha. */
import PizZip from 'pizzip';

const decode = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export type Sheet = { name: string; rows: (string | number | null)[][] };
export function readXlsx(buf: Buffer): Sheet[] {
  const zip = new PizZip(buf);
  const wb = zip.file('xl/workbook.xml')?.asText();
  if (!wb) throw new Error('Arquivo não é uma planilha .xlsx.');
  const rels = zip.file('xl/_rels/workbook.xml.rels')?.asText() ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) target.set(m[2]!, m[1]!);
  const ssXml = zip.file('xl/sharedStrings.xml')?.asText() ?? '';
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const out: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    const name = decode(attrs.match(/\bname="([^"]*)"/)?.[1] ?? '');
    const rid = attrs.match(/\br:id="([^"]*)"/)?.[1] ?? '';
    const t = target.get(rid);
    if (!t) continue;
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    const xml = zip.file(path)?.asText();
    if (!xml) continue;
    const rows: (string | number | null)[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: (string | number | null)[] = [];
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = c[1]!;
        const ref = a.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = a.match(/\bt="([^"]+)"/)?.[1];
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val: string | number | null = null;
        if (type === 's' && v !== undefined) val = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') val = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (type === 'str' || type === 'e') val = v !== undefined ? decode(v) : null;
        else if (type === 'b') val = v === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (v !== undefined) val = Number(v);
        const i = ref ? colIndex(ref) : row.length;
        while (row.length < i) row.push(null);
        row[i] = val;
      }
      rows.push(row);
    }
    out.push({ name, rows });
  }
  return out;
}
/** Número de série de data do Excel → aaaa-mm-dd. */
export const excelDate = (n: number) => new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
