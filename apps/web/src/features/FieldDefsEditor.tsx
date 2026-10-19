/** Editor da lista de campos personalizados (rótulo, tipo, opções, obrigatório). Usado em clientes e jornadas. */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FIELD_TYPES, FIELD_TYPE_LABELS } from '@isp/shared';
import { Button, EmptyState, FormField, Input, Select } from '../components/ui/primitives';

export type FieldDef = { chave?: string; rotulo: string; tipo: (typeof FIELD_TYPES)[number]; opcoes: string[]; obrigatorio: boolean };
type Row = FieldDef & { opcoesText: string; uid: string };

let seq = 0;
const toRow = (f: FieldDef): Row => ({ ...f, opcoesText: f.opcoes.join(', '), uid: f.chave ?? `n${++seq}` });

export function FieldDefsEditor({ initial, onSave, saving, idPrefix, emptyHint, extraActions }: {
  initial: FieldDef[]; onSave: (fields: FieldDef[]) => void; saving?: boolean; idPrefix: string; emptyHint: string; extraActions?: ReactNode;
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const upd = (i: number, v: Partial<Row>) => setRows((x) => x.map((f, j) => (j === i ? { ...f, ...v } : f)));
  const move = (i: number, d: -1 | 1) => setRows((x) => { const y = [...x]; const [it] = y.splice(i, 1); y.splice(i + d, 0, it!); return y; });
  const listInvalid = rows.some((f) => f.tipo === 'lista' && f.opcoesText.split(',').filter((o) => o.trim()).length < 2);
  return (
    <div className="space-y-3">
      {!rows.length && <EmptyState title="Nenhum campo ainda" description={emptyHint} />}
      <ul className="space-y-2">
        {rows.map((f, i) => (
          <li key={f.uid} className="grid grid-cols-1 gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1fr)_170px_auto_auto] sm:items-end">
            <FormField label="Nome do campo" htmlFor={`${idPrefix}-l-${f.uid}`}><Input id={`${idPrefix}-l-${f.uid}`} value={f.rotulo} maxLength={60} onChange={(e) => upd(i, { rotulo: e.target.value })} /></FormField>
            <FormField label="Tipo" htmlFor={`${idPrefix}-t-${f.uid}`}>
              <Select id={`${idPrefix}-t-${f.uid}`} value={f.tipo} onChange={(e) => upd(i, { tipo: e.target.value as FieldDef['tipo'] })}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}</Select>
            </FormField>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={f.obrigatorio} onChange={(e) => upd(i, { obrigatorio: e.target.checked })} />Obrigatório</label>
            <div className="flex">
              <Button variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="h-4 w-4" />} />
              <Button variant="ghost" aria-label="Descer" disabled={i === rows.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="h-4 w-4" />} />
              <Button variant="ghost" aria-label={`Remover ${f.rotulo || 'campo'}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} icon={<Trash2 className="h-4 w-4 text-danger" />} />
            </div>
            {f.tipo === 'lista' && <FormField className="sm:col-span-4" label="Opções (separadas por vírgula)" htmlFor={`${idPrefix}-o-${f.uid}`}><Input id={`${idPrefix}-o-${f.uid}`} value={f.opcoesText} onChange={(e) => upd(i, { opcoesText: e.target.value })} placeholder="Manhã, Tarde, Noite" /></FormField>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-2">
        <Button icon={<Plus className="h-4 w-4" />} disabled={rows.length >= 40} onClick={() => setRows((x) => [...x, toRow({ rotulo: '', tipo: 'texto', opcoes: [], obrigatorio: false })])}>Adicionar campo</Button>
        <div className="flex flex-wrap gap-2">
          {extraActions}
          <Button variant="primary" loading={saving} disabled={rows.some((f) => f.rotulo.trim().length < 2) || listInvalid}
            onClick={() => onSave(rows.map((f) => ({ chave: f.chave, rotulo: f.rotulo.trim(), tipo: f.tipo, obrigatorio: f.obrigatorio, opcoes: f.tipo === 'lista' ? f.opcoesText.split(',').map((o) => o.trim()).filter(Boolean) : [] })))}>Salvar campos</Button>
        </div>
      </div>
    </div>
  );
}
