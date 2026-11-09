/**
 * Badges da gamificação (sem ranking): cinco dimensões de comportamento. Cada badge soma, no ano, os pontos de
 * origens específicas da mesma regra aprovada (nenhuma origem conta em duas badges) e tem faixas por pontos
 * mínimos (mínima, média, alta…). Todos podem chegar a todas as faixas: ninguém depende de outro ficar abaixo.
 * As badges não mudam a nota; são outra leitura dos mesmos pontos.
 */
import { BUSINESS_EVENT_TYPES } from './performance';

export const BADGE_KEYS = ['humanizacao', 'excelencia', 'dinamismo', 'crescimento', 'compromisso'] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

/** Origens de pontos que um badge pode somar. Eventos de negócio entram como `evento:<tipo>` (crédito direto). */
export const BADGE_BASE_SOURCES = [
  { key: 'tarefas', label: 'Tarefas da jornada (pontos da tarefa, sem bônus)' },
  { key: 'pontualidade', label: 'Bônus de tarefa concluída no prazo' },
  { key: 'aderencia', label: 'Bônus de tarefa aprovada pela gerência' },
  { key: 'acima_alcada', label: 'Adicional de atividade acima da alçada' },
  { key: 'ganhos', label: 'Negócios ganhos (minha parte na jornada)' },
  { key: 'participacao', label: 'Participação em resultados de colegas' },
  { key: 'apoio_dado', label: 'Pedido de Apoio: apoiei um colega' },
  { key: 'apoio_pedido', label: 'Pedido de Apoio: pedi apoio cedo' },
  { key: 'certificados', label: 'Certificados de cursos complementares' },
] as const;
export const badgeSourceLabel = (k: string) =>
  BADGE_BASE_SOURCES.find((s) => s.key === k)?.label ?? (k.startsWith('evento:') ? BUSINESS_EVENT_TYPES.find((t) => t.key === k.slice(7))?.label ?? k.slice(7) : k);
export const BADGE_SOURCE_KEYS: string[] = [...BADGE_BASE_SOURCES.map((s) => s.key), ...BUSINESS_EVENT_TYPES.map((t) => `evento:${t.key}`)];

export type BadgeTier = { name: string; minPoints: number };
export type BadgeDef = { key: BadgeKey; name: string; description: string; sources: string[]; tiers: BadgeTier[] };

const ev = (...k: string[]) => k.map((x) => `evento:${x}`);
const tiers = (a: number, b: number, c: number): BadgeTier[] => [{ name: 'Faixa mínima', minPoints: a }, { name: 'Faixa média', minPoints: b }, { name: 'Faixa alta', minPoints: c }];

/** Ponto de partida sugerido para a regra (vale só depois de proposto e aprovado). */
export const DEFAULT_BADGES: BadgeDef[] = [
  { key: 'humanizacao', name: 'Humanização', description: 'Cuidar de pessoas: apoiar colegas, contribuir no resultado de outros e acompanhar o cliente de perto.', sources: ['apoio_dado', 'apoio_pedido', 'participacao', ...ev('acompanhamento_registrado', 'pesquisa_respondida', 'email_respondido', 'abm_stakeholder_mapeado')], tiers: tiers(30, 80, 160) },
  { key: 'excelencia', name: 'Excelência', description: 'Qualidade reconhecida: entregas aprovadas, vendas validadas, contratos assinados e conversas resolvidas.', sources: ['aderencia', ...ev('entrega_validada', 'venda_validada', 'contrato_assinado', 'email_resolvido', 'aprovacao_concluida', 'abm_influencia_avaliada')], tiers: tiers(50, 150, 300) },
  { key: 'dinamismo', name: 'Dinamismo', description: 'Ritmo e iniciativa: tarefas da jornada feitas, leads qualificados, oportunidades abertas, propostas enviadas e contas ativadas.', sources: ['tarefas', ...ev('tarefa_concluida', 'lead_qualificado', 'oportunidade_criada', 'proposta_enviada', 'abm_interacao', 'abm_sinal_tratado', 'abm_play_concluido', 'movimentacao_ata_autorizada', 'adesao_ata_autorizada')], tiers: tiers(300, 700, 1200) },
  { key: 'crescimento', name: 'Crescimento', description: 'Crescer e fazer o negócio crescer: cursos complementares, atividades acima da alçada e negócios ganhos.', sources: ['certificados', 'acima_alcada', 'ganhos', ...ev('negociacao_ganha', 'abm_oportunidade_gerada', 'abm_conta_ativada')], tiers: tiers(40, 120, 250) },
  { key: 'compromisso', name: 'Compromisso', description: 'Cumprir o combinado: tarefas no prazo, marcos e projetos concluídos, processos de contrato encerrados e renovações.', sources: ['pontualidade', ...ev('marco_concluido', 'projeto_concluido', 'processo_contrato_concluido', 'contrato_renovado')], tiers: tiers(40, 120, 240) },
];

export function badgeSettingsErrors(badges: BadgeDef[] | undefined): string[] {
  if (!badges) return [];
  const e: string[] = [];
  const seen = new Map<string, string>();
  const keys = new Set<string>();
  for (const b of badges) {
    if (!(BADGE_KEYS as readonly string[]).includes(b.key) || keys.has(b.key)) e.push(`Badge "${b.name}": chave inválida ou repetida.`);
    keys.add(b.key);
    if (!b.name.trim() || b.name.length > 40) e.push('Todo badge precisa de nome (até 40 letras).');
    if (!b.description.trim() || b.description.length > 400) e.push(`Badge "${b.name}": descreva o que ela reconhece (até 400 letras).`);
    if (!b.sources.length) e.push(`Badge "${b.name}": escolha pelo menos uma origem de pontos.`);
    for (const s of b.sources) {
      if (!BADGE_SOURCE_KEYS.includes(s)) e.push(`Badge "${b.name}": origem desconhecida (${s}).`);
      else if (seen.has(s) && seen.get(s) !== b.key) e.push(`"${badgeSourceLabel(s)}" está em duas badges; cada origem conta em um só.`);
      seen.set(s, b.key);
    }
    if (!b.tiers.length || b.tiers.length > 5) e.push(`Badge "${b.name}": de 1 a 5 faixas.`);
    for (const t of b.tiers) if (!t.name.trim() || t.name.length > 30 || !Number.isInteger(t.minPoints) || t.minPoints < 1 || t.minPoints > 1_000_000) e.push(`Badge "${b.name}": faixa com nome ou mínimo inválido.`);
    for (let i = 1; i < b.tiers.length; i++) if (b.tiers[i]!.minPoints <= b.tiers[i - 1]!.minPoints) e.push(`Badge "${b.name}": as faixas devem ter mínimos crescentes.`);
  }
  return e;
}

export type BadgeProgress = {
  key: BadgeKey; name: string; description: string; points: number;
  /** faixa alcançada (índice e nome); null = ainda abaixo da primeira */
  tierIndex: number | null; tier: string | null;
  next: { name: string; minPoints: number; missing: number } | null;
  tiers: BadgeTier[];
  /** de onde vieram os pontos do badge */
  parts: { source: string; label: string; points: number }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Faixa de cada badge pelos pontos por origem (no período, normalmente o ano). */
export function badgeProgress(bySource: Record<string, number>, badges: BadgeDef[]): BadgeProgress[] {
  return badges.map((b) => {
    const parts = b.sources.map((s) => ({ source: s, label: badgeSourceLabel(s), points: r1(bySource[s] ?? 0) })).filter((p) => p.points > 0).sort((a, c) => c.points - a.points);
    const points = r1(parts.reduce((t, p) => t + p.points, 0));
    let idx: number | null = null;
    b.tiers.forEach((t, i) => { if (points >= t.minPoints) idx = i; });
    const nt = b.tiers[idx === null ? 0 : idx + 1];
    return { key: b.key, name: b.name, description: b.description, points, tierIndex: idx, tier: idx === null ? null : b.tiers[idx]!.name, next: nt ? { name: nt.name, minPoints: nt.minPoints, missing: r1(nt.minPoints - points) } : null, tiers: b.tiers, parts };
  });
}

type JourneyLike = { userId: string; source: 'tarefa' | 'ganho'; points: number; split?: { base: number; onTime: number; adherence: number; above: number } };
/** Pontos por origem de cada pessoa, a partir das mesmas fontes da nota. */
export function pointsBySource(input: {
  journey: JourneyLike[];
  events: { userId: string; type: string; kind: string; points: number }[];
  support: { userId: string; role: 'apoiou' | 'pediu'; points: number }[];
  certificates: { userId: string; points: number }[];
}): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const add = (u: string, k: string, v: number) => { if (!v) return; const m = out.get(u) ?? {}; m[k] = (m[k] ?? 0) + v; out.set(u, m); };
  for (const j of input.journey) {
    if (j.source === 'ganho') { add(j.userId, 'ganhos', j.points); continue; }
    if (!j.split) { add(j.userId, 'tarefas', j.points); continue; }
    add(j.userId, 'tarefas', j.split.base); add(j.userId, 'pontualidade', j.split.onTime); add(j.userId, 'aderencia', j.split.adherence); add(j.userId, 'acima_alcada', j.split.above);
  }
  for (const e of input.events) add(e.userId, e.kind === 'participacao' ? 'participacao' : `evento:${e.type}`, e.points);
  for (const s of input.support) add(s.userId, s.role === 'apoiou' ? 'apoio_dado' : 'apoio_pedido', s.points);
  for (const c of input.certificates) add(c.userId, 'certificados', c.points);
  return out;
}
