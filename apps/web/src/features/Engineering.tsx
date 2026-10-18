/**
 * Fora da autonomia da operação: viabilidade da engenharia antes de fechar e projeto executivo depois.
 * O texto do chamado é montado com os dados da oportunidade, pronto para copiar.
 */
import { useState } from 'react';
import { Copy, HardHat } from 'lucide-react';
import { SALE_TYPE_LABELS, SEGMENT_LABELS, REASON_LABELS, type SaleType } from '@isp/domain';
import type { Opportunity } from '../lib/types';
import { fmtBRL, fmtDate } from '../lib/format';
import { Button, FormField, Input, Select } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';

export type EngineeringValue = { engineeringStatus: Opportunity['engineeringStatus']; engineeringTicket: string; executiveTicket: string };
const STATUS_LABELS: Record<Opportunity['engineeringStatus'], string> = { nao_necessaria: 'Não solicitada', pendente: 'Chamado aberto, aguardando', aprovada: 'Aprovada pela engenharia', reprovada: 'Reprovada pela engenharia' };

type Ctx = { opp: Opportunity; planName: string | null; speedMbps: number | null; notes: string; value: EngineeringValue };

function addressLine(o: Opportunity) {
  const parts = [
    [o.installStreet, o.installNumber].filter(Boolean).join(', '),
    o.condominiumName ? `Condomínio ${o.condominiumName}${o.installBlock ? `, bloco ${o.installBlock}` : ''}${o.installUnit ? `, ap. ${o.installUnit}` : ''}` : null,
    o.installDistrict, o.installCity, o.installCep ? `CEP ${o.installCep}` : null,
  ].filter(Boolean);
  return parts.join(' — ') || 'não informado';
}

function common({ opp, planName, speedMbps }: Ctx) {
  const v = opp.viability;
  const equip = v?.oneTimeCosts.filter((l) => l.label.startsWith('Equipamento · ')).map((l) => `${l.label.replace('Equipamento · ', '')}${l.detail ? ` (${l.detail.split(' × ')[0]})` : ''}`) ?? [];
  return [
    `Oportunidade: OP-${opp.code} · ${opp.title}`,
    `Cliente: ${opp.contactName}${opp.contactPhone ? ` · ${opp.contactPhone}` : ''}${opp.contactEmail ? ` · ${opp.contactEmail}` : ''}`,
    `Tipo: ${SEGMENT_LABELS[opp.contactSegment]}${opp.saleType ? ` · venda ${SALE_TYPE_LABELS[opp.saleType as SaleType].toLowerCase()}` : ''}`,
    `Endereço de instalação: ${addressLine(opp)}`,
    `Local: ${opp.condominiumId ? 'condomínio' : 'rua'}${opp.regionName ? ` · região ${opp.regionName}` : ''}`,
    `Plano: ${planName ?? 'não definido'}${speedMbps ? ` · ${speedMbps} Mbps` : ''}${opp.valueCents ? ` · ${fmtBRL(opp.valueCents)}/mês` : ''}`,
    `Metragem de cabo estimada: ${opp.cableMeters ?? 'não informada'}${opp.cableMeters !== null ? ' m' : ''}`,
    `Caminho de entrega previsto: ${v?.route?.name ?? 'não definido'}`,
    equip.length ? `Equipamentos: ${equip.join(', ')}` : null,
  ].filter(Boolean) as string[];
}

export function viabilityTicketText(c: Ctx) {
  const reasons = c.opp.viability?.engineering?.reasons ?? [];
  return [
    'CHAMADO DE VIABILIDADE TÉCNICA — ENGENHARIA',
    '',
    `Motivo: fora da autonomia da operação${reasons.length ? ` (${reasons.join('; ')})` : ''}.`,
    '',
    ...common(c),
    c.opp.reasons.length ? `Motivo do contato: ${c.opp.reasons.map((r) => REASON_LABELS[r]).join(', ')}` : null,
    c.notes.trim() ? `Observações do comercial: ${c.notes.trim()}` : null,
    `Responsável comercial: ${c.opp.ownerName}`,
    '',
    'Pedido: confirmar se é possível atender, rota/caminho, metragem real e prazo.',
  ].filter((x) => x !== null).join('\n');
}

export function executiveTicketText(c: Ctx) {
  return [
    'CHAMADO DE PROJETO EXECUTIVO — ENGENHARIA',
    '',
    `Venda fechada em ${fmtDate(c.opp.wonAt)}.`,
    c.value.engineeringTicket ? `Viabilidade aprovada no chamado ${c.value.engineeringTicket}.` : 'Viabilidade aprovada pela engenharia.',
    '',
    ...common(c),
    c.notes.trim() ? `Observações do comercial: ${c.notes.trim()}` : null,
    `Responsável comercial: ${c.opp.ownerName}`,
    '',
    'Pedido: elaborar o projeto executivo para instalação.',
  ].filter((x) => x !== null).join('\n');
}

function TicketText({ title, text }: { title: string; text: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" className="text-sm font-semibold text-primary" onClick={() => setOpen((x) => !x)}>{open ? 'Ocultar' : 'Ver'} texto do {title}</button>
        <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={async () => { try { await navigator.clipboard.writeText(text); toast({ tone: 'success', message: 'Texto copiado' }); } catch { setOpen(true); toast({ tone: 'error', message: 'Não deu para copiar: selecione o texto e copie.' }); } }}>Copiar</Button>
      </div>
      {open && <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line bg-surface-2 px-3 py-2 font-sans text-sm text-text">{text}</pre>}
    </div>
  );
}

export function EngineeringPanel({ opp, planName, speedMbps, notes, value, onChange, disabled }: Ctx & { onChange: (v: Partial<EngineeringValue>) => void; disabled?: boolean }) {
  const eng = opp.viability?.engineering;
  if (!eng?.required && value.engineeringStatus === 'nao_necessaria') return null;
  const ctx = { opp, planName, speedMbps, notes, value };
  const won = opp.stage === 'ganha';
  return (
    <section className="card space-y-3 border-warning/40 p-5">
      <h2 className="flex items-center gap-2 text-md font-bold text-ink"><HardHat className="h-5 w-5 text-warning" />Engenharia</h2>
      {eng?.required && <p className="text-sm text-text">Fora da autonomia da operação: {eng.reasons.join(' e ')}. {won ? 'Abra agora o chamado de projeto executivo.' : 'A venda só fecha com a viabilidade aprovada.'}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Viabilidade" htmlFor="eng-status">
          <Select id="eng-status" value={value.engineeringStatus} disabled={disabled && !won} onChange={(e) => onChange({ engineeringStatus: e.target.value as EngineeringValue['engineeringStatus'] })}>
            {(Object.keys(STATUS_LABELS) as EngineeringValue['engineeringStatus'][]).map((k) => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
          </Select>
        </FormField>
        <FormField label="Nº do chamado de viabilidade" htmlFor="eng-ticket"><Input id="eng-ticket" value={value.engineeringTicket} disabled={disabled && !won} onChange={(e) => onChange({ engineeringTicket: e.target.value })} placeholder="Ex.: 12345" /></FormField>
      </div>
      {!won && <TicketText title="chamado de viabilidade" text={viabilityTicketText(ctx)} />}
      {won && (
        <>
          <FormField label="Nº do chamado de projeto executivo" htmlFor="eng-exec"><Input id="eng-exec" value={value.executiveTicket} onChange={(e) => onChange({ executiveTicket: e.target.value })} placeholder="Ex.: 12399" /></FormField>
          <TicketText title="chamado de projeto executivo" text={executiveTicketText(ctx)} />
        </>
      )}
    </section>
  );
}
