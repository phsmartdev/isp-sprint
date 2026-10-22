/**
 * ABM Fase 7 — inteligência e cobertura. Cobertura de stakeholders explicada item a item, a partir do que a equipe
 * registrou. Influência "não avaliada" é lacuna, nunca estimativa; nada aqui altera avaliações.
 */
import { influenceRank, type InfluenceLevel, type RelationshipStrength, type StakeholderRole, type Stance } from './stakeholders';

export const KEY_ROLES: { key: string; label: string; roles: StakeholderRole[] }[] = [
  { key: 'decisor', label: 'Quem decide', roles: ['decisor'] },
  { key: 'financeiro', label: 'Quem aprova o gasto', roles: ['aprovador_financeiro', 'patrocinador'] },
  { key: 'tecnico', label: 'Quem avalia tecnicamente', roles: ['avaliador_tecnico', 'gestor_tecnico'] },
  { key: 'uso', label: 'Quem usa ou fiscaliza', roles: ['usuario', 'fiscal_contrato', 'responsavel_contratacao'] },
];
export type CoveragePerson = { roles: StakeholderRole[]; influence: InfluenceLevel | null; relationship: RelationshipStrength; stance: Stance; unitId: string | null; active: boolean };
export type CoverageItem = { key: string; label: string; weight: number; score: number; detail: string; gap: string | null };
export type CoverageLevel = 'boa' | 'parcial' | 'baixa';
export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = { boa: 'Boa', parcial: 'Parcial', baixa: 'Baixa' };

const high = (l: InfluenceLevel | null) => { const r = l ? influenceRank(l) : null; return r !== null && r >= 4; };
const close = (r: RelationshipStrength) => r === 'forte' || r === 'moderado';

/**
 * Nota de 0 a 100 com 5 itens: papéis-chave (30), influência avaliada (20), relacionamento com quem tem influência
 * alta (25), departamentos cobertos (10) e defensor com influência (15). `influenceVisible=false` (perfil sem acesso
 * à influência) tira os itens que dependem dela e redistribui o peso.
 */
export function coverageOf(people: CoveragePerson[], activeUnits: number, influenceVisible: boolean) {
  const act = people.filter((p) => p.active);
  const items: CoverageItem[] = [];
  const roleHits = KEY_ROLES.filter((k) => act.some((p) => p.roles.some((r) => k.roles.includes(r))));
  const missing = KEY_ROLES.filter((k) => !roleHits.includes(k));
  items.push({ key: 'papeis', label: 'Papéis-chave mapeados', weight: 30, score: roleHits.length / KEY_ROLES.length, detail: `${roleHits.length} de ${KEY_ROLES.length}`, gap: missing.length ? `Falta mapear: ${missing.map((m) => m.label.toLowerCase()).join(', ')}` : null });
  if (influenceVisible) {
    const assessed = act.filter((p) => p.influence && p.influence !== 'nao_avaliado').length;
    items.push({ key: 'avaliacao', label: 'Influência avaliada pela equipe', weight: 20, score: act.length ? assessed / act.length : 0, detail: `${assessed} de ${act.length}`, gap: act.length - assessed > 0 ? `${act.length - assessed} pessoa(s) sem influência avaliada` : act.length ? null : 'Nenhuma pessoa mapeada' });
    const hi = act.filter((p) => high(p.influence));
    const hiClose = hi.filter((p) => close(p.relationship)).length;
    items.push({ key: 'relacionamento', label: 'Relacionamento com quem tem influência alta', weight: 25, score: hi.length ? hiClose / hi.length : 0, detail: hi.length ? `${hiClose} de ${hi.length}` : 'ninguém avaliado com influência alta', gap: !hi.length ? 'Identifique quem tem influência alta (avaliação da equipe)' : hiClose < hi.length ? `${hi.length - hiClose} pessoa(s) de influência alta sem relacionamento forte ou moderado` : null });
    const champ = act.some((p) => (p.stance === 'defensor' || p.stance === 'favoravel') && p.influence && (influenceRank(p.influence) ?? 0) >= 3);
    const blockers = act.filter((p) => (p.stance === 'opositor' || p.stance === 'resistente') && high(p.influence)).length;
    items.push({ key: 'defensor', label: 'Defensor com influência', weight: 15, score: champ ? (blockers ? 0.5 : 1) : 0, detail: champ ? (blockers ? `sim, mas ${blockers} resistente(s) com influência alta` : 'sim') : 'não', gap: !champ ? 'Nenhum defensor ou favorável com influência média ou maior' : blockers ? `${blockers} pessoa(s) com influência alta resistentes ou opositoras` : null });
  }
  const unitsCovered = new Set(act.map((p) => p.unitId).filter(Boolean)).size;
  items.push({ key: 'departamentos', label: 'Departamentos com alguém mapeado', weight: 10, score: activeUnits ? Math.min(1, unitsCovered / activeUnits) : act.length ? 0.5 : 0, detail: activeUnits ? `${unitsCovered} de ${activeUnits}` : 'estrutura não registrada', gap: !activeUnits ? 'Registre a estrutura organizacional da conta' : unitsCovered < activeUnits ? `${activeUnits - unitsCovered} departamento(s) sem ninguém mapeado` : null });
  const totalW = items.reduce((a, i) => a + i.weight, 0);
  const score = Math.round((items.reduce((a, i) => a + i.score * i.weight, 0) / totalW) * 100);
  const level: CoverageLevel = score >= 70 ? 'boa' : score >= 40 ? 'parcial' : 'baixa';
  return { score, level, items, gaps: items.map((i) => i.gap).filter((g): g is string => !!g), people: act.length };
}

/** Variação simples entre dois números (null quando não há base). */
export const deltaPct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);
