/** Pastas da caixa de e-mail com regra de armazenamento: lista no trilho do E-mail e janela para criar/editar. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FolderOpen, Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import { RULE_FIELDS, RULE_FIELD_LABELS, RULE_OPS, RULE_OP_LABELS, type RuleField, type RuleOp } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, FormField, Input, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Cond = { field: RuleField; op: RuleOp; value: string };
export type Folder = { id: string; mailboxId: string; name: string; position: number; def: { match: 'todas' | 'qualquer'; conditions: Cond[] }; open: number; unread: number; canEdit: boolean };
type Box = { id: string; kind: string; address: string; displayName: string | null; ownerId: string | null };

export const useFolders = () => useQuery({ queryKey: ['mail', 'folders'], queryFn: () => api<{ items: Folder[] }>('/mail/folders') });

export function FolderRail({ boxes, canConfigure, myId, box, value, onChange }: { boxes: Box[]; canConfigure: boolean; myId: string | null; box: string; value: string; onChange: (folder: string) => void }) {
  const q = useFolders();
  const [editing, setEditing] = useState<Folder | 'nova' | null>(null);
  const items = (q.data?.items ?? []).filter((f) => !box || f.mailboxId === box);
  const manageable = boxes.filter((b) => (b.kind === 'pessoal' ? b.ownerId === myId : canConfigure));
  const boxName = (id: string) => { const b = boxes.find((x) => x.id === id); return !b ? '' : b.kind === 'pessoal' ? b.address : b.displayName ?? b.address; };
  const multi = new Set(items.map((f) => f.mailboxId)).size > 1;
  return (
    <div className="px-3 pb-3" aria-label="Pastas">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">Pastas</span>
        {!!manageable.length && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={() => setEditing('nova')}><Plus className="h-3.5 w-3.5" aria-hidden />Nova pasta</button>}
      </div>
      <ul className="space-y-0.5">
        <li><button type="button" aria-pressed={value === ''} onClick={() => onChange('')} className={clsx('flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm', value === '' ? 'bg-primary-soft font-semibold text-primary' : 'text-text hover:bg-surface-2')}><FolderOpen className="h-4 w-4" aria-hidden />Todas as pastas</button></li>
        <li><button type="button" aria-pressed={value === 'entrada'} onClick={() => onChange('entrada')} className={clsx('flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm', value === 'entrada' ? 'bg-primary-soft font-semibold text-primary' : 'text-text hover:bg-surface-2')}><Inbox className="h-4 w-4" aria-hidden />Entrada</button></li>
        {items.map((f) => (
          <li key={f.id} className="group flex items-center">
            <button type="button" aria-pressed={value === f.id} onClick={() => onChange(f.id)} title={multi ? boxName(f.mailboxId) : undefined}
              className={clsx('flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm', value === f.id ? 'bg-primary-soft font-semibold text-primary' : 'text-text hover:bg-surface-2')}>
              <FolderOpen className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 truncate">{f.name}</span>
              {f.open > 0 && <span className="num ml-auto text-xs text-muted">{f.open}</span>}
            </button>
            {f.canEdit && <button type="button" className="p-1 text-muted hover:text-primary" aria-label={`Editar pasta ${f.name}`} onClick={() => setEditing(f)}><Pencil className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
      </ul>
      {editing && <FolderDialog folder={editing === 'nova' ? null : editing} boxes={manageable} defaultBox={box} onClose={() => setEditing(null)} onRemoved={(id) => { if (value === id) onChange(''); }} />}
    </div>
  );
}

function FolderDialog({ folder, boxes, defaultBox, onClose, onRemoved }: { folder: Folder | null; boxes: Box[]; defaultBox: string; onClose: () => void; onRemoved: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(folder?.name ?? '');
  const [mailboxId, setMailboxId] = useState(folder?.mailboxId ?? (boxes.find((b) => b.id === defaultBox)?.id ?? boxes[0]?.id ?? ''));
  const [match, setMatch] = useState<'todas' | 'qualquer'>(folder?.def.match ?? 'qualquer');
  const [conds, setConds] = useState<Cond[]>(folder?.def.conditions.length ? folder.def.conditions : [{ field: 'de', op: 'contem', value: '' }]);
  const [apply, setApply] = useState(true);
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: 'success', message: msg }); onClose(); };
  const body = { name: name.trim(), def: { match, conditions: conds.filter((c) => c.value.trim()) }, applyExisting: apply };
  const save = useMutation({
    mutationFn: () => (folder ? api<{ moved: number }>(`/mail/folders/${folder.id}`, { method: 'PATCH', body }) : api<{ moved: number }>('/mail/folders', { method: 'POST', body: { ...body, mailboxId } })),
    onSuccess: (r) => done(`${folder ? 'Pasta salva' : 'Pasta criada'}${r.moved ? `: ${r.moved} conversa(s) movida(s)` : ''}`),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/mail/folders/${folder!.id}`, { method: 'PATCH', body: { active: false } }),
    onSuccess: () => { onRemoved(folder!.id); done('Pasta excluída; as conversas voltaram para a Entrada'); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const set = (i: number, p: Partial<Cond>) => setConds(conds.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <Modal open onClose={onClose} title={folder ? `Pasta ${folder.name}` : 'Nova pasta'} size="lg"
      footer={<>{folder && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>Excluir pasta</Button>}<span className="flex-1" /><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>{folder ? 'Salvar pasta' : 'Criar pasta'}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Nome da pasta" htmlFor="fd-name"><Input id="fd-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Licitações" /></FormField>
          <FormField label="Caixa" htmlFor="fd-box"><Select id="fd-box" value={mailboxId} disabled={!!folder} onChange={(e) => setMailboxId(e.target.value)}>{boxes.map((b) => <option key={b.id} value={b.id}>{b.kind === 'pessoal' ? b.address : b.displayName ?? b.address}</option>)}</Select></FormField>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Regra de armazenamento</legend>
          <p className="text-xs text-muted">Conversa nova que bater com a regra cai nesta pasta. Sem condição, a pasta só recebe o que você mover.</p>
          <label className="flex items-center gap-2 text-sm">Guardar quando
            <Select aria-label="Como combinar as condições" className="w-auto" value={match} onChange={(e) => setMatch(e.target.value as 'todas' | 'qualquer')}><option value="qualquer">qualquer condição</option><option value="todas">todas as condições</option></Select>
            bater</label>
          {conds.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Campo da condição ${i + 1}`} className="w-auto" value={c.field} onChange={(e) => set(i, { field: e.target.value as RuleField })}>{RULE_FIELDS.map((f) => <option key={f} value={f}>{RULE_FIELD_LABELS[f]}</option>)}</Select>
              <Select aria-label={`Operador da condição ${i + 1}`} className="w-auto" value={c.op} onChange={(e) => set(i, { op: e.target.value as RuleOp })}>{RULE_OPS.map((o) => <option key={o} value={o}>{RULE_OP_LABELS[o]}</option>)}</Select>
              <Input aria-label={`Valor da condição ${i + 1}`} className="min-w-0 flex-1" value={c.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={c.field === 'dominio' ? 'gov.br' : c.field === 'de' ? 'compras@' : 'pregão'} />
              <button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Tirar condição ${i + 1}`} onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {conds.length < 10 && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setConds([...conds, { field: 'assunto', op: 'contem', value: '' }])}>Adicionar condição</Button>}
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={apply} onChange={(e) => setApply(e.target.checked)} />Aplicar também às conversas que já estão na Entrada</label>
      </div>
    </Modal>
  );
}
