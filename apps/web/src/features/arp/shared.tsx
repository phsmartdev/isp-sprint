/** Atas de registro de preços: tipos das respostas, consultas e peças comuns das telas. */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import {
  AGENCY_KIND_LABELS, ARP_STATUS_LABELS, fmtQty, parseNumberBR, toMilli,
  type AgencyKind, type ArpRegime, type ArpRules, type ArpStatus, type Bucket, type OperationKind,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fileToBase64, fmtBytes, MAX_ATTACHMENT_BYTES } from '../../lib/files';
import { Chip, Input, Select, type Tone } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export { errMsg };
export const qty = (m: number | null | undefined) => (m === null || m === undefined ? '—' : fmtQty(m));
/** "1.234,5" → milésimos; vazio/inválido → null */
export const parseQty = (v: string) => { const n = parseNumberBR(v); return n === null || n < 0 ? null : toMilli(n); };
export const parseMoney = (v: string) => { const n = parseNumberBR(v); return n === null || n <= 0 ? null : Math.round(n * 100); };

export type Agency = { id: string; kind: AgencyKind; name: string; document: string | null; contactId: string | null; joinedOn: string | null; effectiveOn: string | null; notes: string | null; documentId: string | null; createdAt: string };
export type ItemView = {
  id: string; itemNumber: string; lot: string | null; code: string | null; classification: string | null; version: number; moved: boolean; description: string; specification: string | null; unit: string; unitCents: number; brandModel: string | null; notes: string | null;
  originalMilli: number; registeredMilli: number; reservedMilli: number; contractedMilli: number; executedMilli: number; billedMilli: number; availableMilli: number;
  adhesionAuthorizedMilli: number; adhesionAvailableMilli: number; registeredValueCents: number; availableValueCents: number; contractedValueCents: number;
  byAgency: ({ agencyId: string } & Bucket)[];
};
export type ArpDetail = {
  id: string; number: string; object: string; processNumber: string | null; regime: ArpRegime; supplierName: string; supplierDocument: string | null;
  signedAt: string | null; startAt: string | null; endAt: string | null; notes: string | null; status: ArpStatus; rowVersion: number; ownerName: string | null;
  agencies: Agency[]; items: ItemView[];
  totals: { registeredValueCents: number; contractedValueCents: number; availableValueCents: number; reservedValueCents: number; adhesionValueCents: number; movements: number };
  alerts: { level: 'alta' | 'media'; text: string }[];
  rules: { rules: ArpRules; version: number; caps: { adhesionPerAgencyBp: number; adhesionTotalBp: number } };
  contracts: { id: string; stage: string; number: string; monthlyCents: number | null; totalCents: number | null; opportunityId: string | null }[];
  can: { manage: boolean; effect: boolean };
};
export type ArpListRow = {
  id: string; number: string; object: string; status: ArpStatus; regime: ArpRegime; supplierName: string; startAt: string | null; endAt: string | null; managerName: string | null;
  itemCount: number; agencyCount: number; registeredValueCents: number; contractedValueCents: number; availableValueCents: number; adhesions: number; openOpportunities: number; alerts: number;
};
export type ArpDoc = { id: string; category: DocCategory; name: string; sizeBytes: number; createdAt: string; uploadedBy: string | null; adhesionId: string | null; operationId: string | null; opportunityId: string | null };
export type Simulation = {
  ok: boolean; errors: string[]; warnings: string[]; sourceValueCents: number; targetValueCents: number; ruleVersion: number; legalBasis: string;
  impact: { itemId: string; agencyId: string; before: Bucket; after: Bucket }[];
  entries: { kind: string; itemId: string; agencyId: string; qtyMilli: number; dir?: 'saida' | 'entrada' | null }[];
};
export type Operation = {
  id: string; kind: OperationKind; label: string; status: 'solicitada' | 'aprovada' | 'reprovada' | 'efetivada'; justification: string; createdAt: string; decidedAt: string | null; effectedAt: string | null; decisionNote: string | null;
  simulation: Simulation; requestedByName: string | null; decidedByName: string | null; effectedByName: string | null; canDecide: boolean; canEffect: boolean; exception: Record<string, unknown> | null;
  input: { kind: OperationKind; sources: { itemId: string; agencyId: string; qtyMilli: number }[]; targets: { itemId: string; agencyId: string; qtyMilli: number }[]; newUnitCents: number | null; itemPatch?: Record<string, string | null> | null; criteria?: string | null; effectiveOn?: string | null };
};

export const DOC_CATEGORIES = ['ata', 'edital', 'publicacao', 'adesao', 'aceite_fornecedor', 'autorizacao_gerenciador', 'empenho', 'contrato', 'ordem_servico', 'parecer_juridico', 'outro'] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export const DOC_LABELS: Record<DocCategory, string> = {
  ata: 'Ata assinada', edital: 'Edital', publicacao: 'Publicação', adesao: 'Pedido de adesão', aceite_fornecedor: 'Aceite do fornecedor', autorizacao_gerenciador: 'Autorização do gerenciador',
  empenho: 'Nota de empenho', contrato: 'Contrato', ordem_servico: 'Ordem de serviço', parecer_juridico: 'Parecer jurídico', outro: 'Outro',
};

const STATUS_TONE: Record<ArpStatus, Tone> = { rascunho: 'yellow', vigente: 'green', encerrada: 'neutral', cancelada: 'red' };
export const ArpStatusChip = ({ status }: { status: ArpStatus }) => <Chip tone={STATUS_TONE[status]}>{ARP_STATUS_LABELS[status]}</Chip>;
const KIND_TONE: Record<AgencyKind, Tone> = { gerenciador: 'blue', participante: 'sky', nao_participante: 'purple' };
export const AgencyChip = ({ kind }: { kind: AgencyKind }) => <Chip tone={KIND_TONE[kind]}>{AGENCY_KIND_LABELS[kind]}</Chip>;
export const itemLabel = (i: Pick<ItemView, 'lot' | 'itemNumber'>) => `${i.lot ? `Lote ${i.lot} · ` : ''}Item ${i.itemNumber}`;

export const useArp = (id: string) => useQuery({ queryKey: ['arp', id], queryFn: () => api<ArpDetail>(`/arps/${id}`) });
export const useArpDocs = (id: string) => useQuery({ queryKey: ['arp', id, 'docs'], queryFn: () => api<{ items: ArpDoc[] }>(`/arps/${id}/documents`) });
/** Invalida tudo o que depende da ata (saldos, livro, oportunidades, adesões...). */
export function useArpRefresh(id: string) {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['arp', id] }); void qc.invalidateQueries({ queryKey: ['arps'] }); };
}

/** Barra de uso do saldo: contratado, reservado e disponível sobre a quantidade registrada. */
export function BalanceBar({ registered, contracted, reserved, label }: { registered: number; contracted: number; reserved: number; label: string }) {
  const pct = (v: number) => (registered > 0 ? Math.max(0, Math.min(100, (v / registered) * 100)) : 0);
  return (
    <div className="h-2 w-full min-w-[90px] overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
      <div className="flex h-full">
        <span className="h-full bg-primary" style={{ width: `${pct(contracted)}%` }} />
        <span className="h-full bg-lime" style={{ width: `${pct(reserved)}%` }} />
      </div>
    </div>
  );
}

/** Quantidade com vírgula; devolve o texto e o valor em milésimos. */
export function QtyInput({ id, value, onChange, unit, invalid, label }: { id?: string; value: string; onChange: (v: string) => void; unit?: string; invalid?: boolean; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input id={id} aria-label={label} inputMode="decimal" className="num w-28" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />
      {unit && <span className="text-sm text-muted">{unit}</span>}
    </div>
  );
}

/**
 * Escolhe um documento da ata de certas categorias, ou anexa um novo ali mesmo.
 * Movimentações oficiais exigem documento: este é o caminho mais curto para tê-lo.
 */
/** Envia um documento para a ata e devolve o id (limite de 3 MB, igual ao servidor). */
export function useDocUpload(arpId: string, category: () => DocCategory, onDone: (d: { id: string; name: string }) => void) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: File) => {
      if (f.size > MAX_ATTACHMENT_BYTES) throw new Error(`Arquivo de ${fmtBytes(f.size)}: o limite é ${fmtBytes(MAX_ATTACHMENT_BYTES)}.`);
      return api<{ id: string; name: string }>(`/arps/${arpId}/documents`, { method: 'POST', body: { category: category(), name: f.name, mime: f.type || 'application/octet-stream', data: await fileToBase64(f) } });
    },
    onSuccess: (d) => { void qc.invalidateQueries({ queryKey: ['arp', arpId, 'docs'] }); void qc.invalidateQueries({ queryKey: ['arp', arpId, 'events'] }); onDone(d); toast({ tone: 'success', message: `${d.name} anexado` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

export function DocPicker({ arpId, categories, value, onChange, label, id, optional }: { arpId: string; categories: DocCategory[]; value: string; onChange: (id: string) => void; label: string; id: string; optional?: boolean }) {
  const docs = useArpDocs(arpId);
  const file = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState<DocCategory>(categories[0]!);
  const up = useDocUpload(arpId, () => cat, (d) => onChange(d.id));
  const list = (docs.data?.items ?? []).filter((d) => categories.includes(d.category));
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}{!optional && <span className="text-danger"> *</span>}</label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{list.length ? (optional ? 'Nenhum' : 'Escolha o documento') : 'Nenhum documento deste tipo ainda'}</option>
        {list.map((d) => <option key={d.id} value={d.id}>{d.name} ({DOC_LABELS[d.category]})</option>)}
      </Select>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {categories.length > 1 && (
          <Select aria-label="Tipo do novo documento" className="h-9 w-auto text-sm" value={cat} onChange={(e) => setCat(e.target.value as DocCategory)}>
            {categories.map((c) => <option key={c} value={c}>{DOC_LABELS[c]}</option>)}
          </Select>
        )}
        <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline disabled:opacity-60" disabled={up.isPending} onClick={() => file.current?.click()}>
          <Paperclip className="h-4 w-4" aria-hidden />{up.isPending ? 'Anexando…' : `Anexar ${categories.length > 1 ? 'novo documento' : DOC_LABELS[categories[0]!].toLowerCase()}`}
        </button>
        <input ref={file} type="file" className="sr-only" aria-label={`Arquivo para ${label}`} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

/** Tabela simples com rolagem horizontal e cabeçalho cinza (padrão das telas de contratos). */
export function Table({ head, children, min = 820, foot }: { head: string[]; children: React.ReactNode; min?: number; foot?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth: min }}>
        <thead className="bg-surface-2 text-xs text-muted"><tr>{head.map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
        {foot}
      </table>
    </div>
  );
}
