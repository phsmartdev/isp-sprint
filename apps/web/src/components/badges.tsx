import {
  ACTIVITY_TAG_LABELS, CONTRACT_LABELS, COVERAGE_LABELS, LEAD_STATUS_LABELS, LIFECYCLE_LABELS, PRIORITY_LABELS, PROPOSAL_LABELS, SEGMENT_LABELS, SEGMENT_PRODUCT_LABELS, STAGE_LABELS,
  type ActivityPriority, type ActivityType, type ContractRequestStatus, type CoverageStatus, type CustomerLifecycle, type LeadStatus, type OpportunityStage, type ProposalStatus, type Segment,
} from '@isp/domain';
import { Chip, type Tone } from './ui/primitives';

/** Cores por etapa (Kanban, gráficos e selos) — iguais ao design. */
export const STAGE_STYLE: Record<OpportunityStage, { col: string; badge: string; text: string; bar: string; tone: Tone }> = {
  novo_lead: { col: 'bg-[#EAF3FC]', badge: 'bg-[#3885D3]', text: 'text-[#2C6CAE]', bar: '#3885D3', tone: 'blue' },
  qualificacao: { col: 'bg-[#E8F6FF]', badge: 'bg-[#4FBBFF]', text: 'text-[#1F7DB8]', bar: '#4FBBFF', tone: 'sky' },
  cobertura: { col: 'bg-[#EEF1F3]', badge: 'bg-[#677680]', text: 'text-[#4E5A62]', bar: '#677680', tone: 'neutral' },
  proposta: { col: 'bg-[#E9EFF6]', badge: 'bg-[#2F5986]', text: 'text-[#2F5986]', bar: '#2F5986', tone: 'blue' },
  fechamento: { col: 'bg-[#E5FAFD]', badge: 'bg-[#00A9C6]', text: 'text-[#007F95]', bar: '#00C2E0', tone: 'sky' },
  ganha: { col: 'bg-[#E7F7EC]', badge: 'bg-[#16A34A]', text: 'text-[#15803D]', bar: '#22A447', tone: 'green' },
  perdida: { col: 'bg-[#FFECEC]', badge: 'bg-[#E04646]', text: 'text-[#C23434]', bar: '#FF5050', tone: 'red' },
};
const FALLBACK = ['#2F5986', '#3885D3', '#4FBBFF', '#677680', '#00A9C6', '#87362F', '#AAAAAA', '#002233'];
/** Cores padrão antigas (antes da identidade BKT) trocadas pela paleta da marca; cores escolhidas pelo admin ficam como estão. */
const LEGACY: Record<string, string> = { '#3B82F6': '#3885D3', '#F59E0B': '#4FBBFF', '#8B5CF6': '#677680', '#A78BFA': '#677680', '#60A5FA': '#2F5986', '#7CB3FF': '#2F5986', '#4ADE80': '#00C2E0', '#22C55E': '#22A447', '#EF4444': '#FF5050', '#14B8A6': '#00A9C6', '#EC4899': '#87362F', '#F97316': '#AAAAAA' };
/** Cor da etapa: a cadastrada na jornada; senão a do design; senão uma da paleta pela posição. */
export function stageColor(key: string, color?: string | null, index = 0) {
  if (color && LEGACY[color.toUpperCase()]) return LEGACY[color.toUpperCase()]!;
  return color ?? (STAGE_STYLE as Record<string, { bar: string }>)[key]?.bar ?? FALLBACK[index % FALLBACK.length]!;
}
/** Escurece a cor para texto legível sobre fundo claro. */
export function inkOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c * 0.62);
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
export const StageChip = ({ stage, name, color }: { stage: string; name?: string | null; color?: string | null }) => {
  const c = stageColor(stage, color);
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold" style={{ background: `${c}22`, color: inkOf(c) }}>
      {name ?? (STAGE_LABELS as Record<string, string>)[stage] ?? stage}
    </span>
  );
};

/** Selos de origem com as cores do design (Site azul, Indicação roxo, WhatsApp verde…). */
const SOURCE_TONE: Record<string, Tone> = { Site: 'sky', Indicação: 'purple', WhatsApp: 'green', Campanha: 'purple', Instagram: 'sky', Evento: 'neutral', Tráfego: 'sky' };
export const SourceChip = ({ name }: { name: string | null }) => <Chip tone={SOURCE_TONE[name ?? ''] ?? 'neutral'}>{name ?? 'Não informada'}</Chip>;

/** Interesse: "Oferta" em destaque laranja como no design; demais em texto simples. */
export function InterestTag({ value }: { value?: string }) {
  if (!value) return <span className="text-faint">—</span>;
  if (value === 'Oferta' || value === 'Preço') return <Chip tone="orange">{value}</Chip>;
  return <span className="text-sm text-text">{value}</span>;
}

const LEAD_TONE: Record<LeadStatus, Tone> = { novo: 'sky', em_contato: 'sky', qualificado: 'green', convertido: 'purple', descartado: 'neutral' };
const LEAD_SHORT: Record<LeadStatus, string> = { novo: 'Novo', em_contato: 'Em contato', qualificado: 'Qualificado', convertido: 'Convertido', descartado: 'Descartado' };
export const LeadStatusChip = ({ status }: { status: LeadStatus }) => <Chip tone={LEAD_TONE[status]} title={LEAD_STATUS_LABELS[status]}>{LEAD_SHORT[status]}</Chip>;

const LIFE_TONE: Record<CustomerLifecycle, Tone> = { prospect: 'neutral', em_implantacao: 'sky', ativo: 'green', inadimplente: 'orange', suspenso: 'yellow', cancelado: 'red', reativado: 'green' };
export const LifecycleChip = ({ s }: { s: CustomerLifecycle }) => <Chip tone={LIFE_TONE[s]} className="min-w-[80px] justify-center">{LIFECYCLE_LABELS[s]}</Chip>;

const COV_TONE: Record<CoverageStatus, Tone> = { nao_consultada: 'neutral', pendente: 'orange', elegivel: 'green', inelegivel: 'red', indeterminada: 'orange' };
export const CoverageChip = ({ s }: { s: CoverageStatus }) => <Chip tone={COV_TONE[s]}>Cobertura: {COVERAGE_LABELS[s]}</Chip>;
const PROP_TONE: Record<ProposalStatus, Tone> = { nao_criada: 'neutral', rascunho: 'neutral', enviada: 'sky', aceita: 'green', recusada: 'red', expirada: 'orange' };
export const ProposalChip = ({ s }: { s: ProposalStatus }) => <Chip tone={PROP_TONE[s]}>Proposta: {PROPOSAL_LABELS[s]}</Chip>;
const CONTRACT_TONE: Record<ContractRequestStatus, Tone> = { nao_solicitada: 'neutral', pendente: 'orange', enviada: 'sky', erro: 'red', confirmada: 'green', rejeitada: 'red' };
export const ContractChip = ({ s }: { s: ContractRequestStatus }) => <Chip tone={CONTRACT_TONE[s]}>Contrato: {CONTRACT_LABELS[s]}</Chip>;

/** Selo do card na coluna Fechamento: situação do pedido de contrato (nunca "confirmado" sem IXC). */
export const CLOSING_TAG: Record<ContractRequestStatus, { label: string; tone: Tone }> = {
  nao_solicitada: { label: 'Aguard. contrato', tone: 'orange' },
  pendente: { label: 'Contrato enviado', tone: 'purple' },
  enviada: { label: 'Contrato enviado', tone: 'purple' },
  erro: { label: 'Erro no contrato', tone: 'red' },
  confirmada: { label: 'Contrato confirmado', tone: 'green' },
  rejeitada: { label: 'Contrato recusado', tone: 'red' },
};

const ACT_TONE: Record<ActivityType, Tone> = { tarefa: 'blue', ligacao: 'orange', reuniao: 'purple', email: 'sky', whatsapp: 'green', visita: 'purple' };
export const ActivityTag = ({ t }: { t: ActivityType }) => <Chip tone={ACT_TONE[t]}>{ACTIVITY_TAG_LABELS[t]}</Chip>;
const PRIO_TONE: Record<ActivityPriority, Tone> = { baixa: 'neutral', media: 'sky', alta: 'red' };
export const PriorityChip = ({ p }: { p: ActivityPriority }) => <Chip tone={PRIO_TONE[p]}>{PRIORITY_LABELS[p]}</Chip>;

export const segmentLabel = (s?: Segment | null) => (s ? SEGMENT_LABELS[s] : '');
export const productLabel = (s?: Segment | null) => (s ? SEGMENT_PRODUCT_LABELS[s] : '');
