/**
 * Conquistas automáticas no feed de Pessoas & Cultura (ligadas à gamificação da ISP):
 *  - venda fechada: cartão animado com a pessoa, os pontos que a negociação rendeu e os badges conquistados
 *    (nunca o valor da venda);
 *  - nova faixa de badge: celebração com um texto próprio de cada badge.
 * Cada conquista sai uma vez só (source_key); na primeira execução, faixas já existentes são registradas sem publicar.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type BadgeKey } from '@isp/domain';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { AuthContext } from '../../http/context';
import { gamificationSettingsOf } from '../gamification';
import { opportunityPointsFor } from '../scoreJourneys';
import { ensureFreshEvents } from '../businessEvents';
import { badgesBetween } from '../../routes/gamification';
import { peopleSettingsOf, PeopleSettings } from './settings';

/** Texto de cada badge (o nome da faixa entra no fim). Tom positivo, sem comparar pessoas. */
export const BADGE_CELEBRATION: Record<BadgeKey, { emoji: string; text: (first: string) => string }> = {
  humanizacao: { emoji: '🤝', text: (n) => `${n} conquistou o badge Humanização! Apoiar colegas, contribuir com o resultado dos outros e cuidar do cliente de perto é o que faz a nossa cultura. Obrigado por estar junto de verdade.` },
  excelencia: { emoji: '🏅', text: (n) => `${n} conquistou o badge Excelência! Entregas aprovadas, vendas validadas e conversas resolvidas: qualidade que o cliente sente. Que orgulho!` },
  dinamismo: { emoji: '⚡', text: (n) => `${n} conquistou o badge Dinamismo! Ritmo, iniciativa e tarefas da jornada em dia: é assim que as coisas acontecem. Bora!` },
  crescimento: { emoji: '🚀', text: (n) => `${n} conquistou o badge Crescimento! Aprender, ir além da alçada e fazer o negócio crescer. A evolução é de todo o time.` },
  compromisso: { emoji: '🎯', text: (n) => `${n} conquistou o badge Compromisso! Prazos cumpridos, marcos entregues e processos encerrados: palavra dada é palavra cumprida.` },
};

const moduleOn = async (db: DbOrTx, tenantId: string) => {
  const [m] = await db.select({ enabled: s.tenantModules.enabled }).from(s.tenantModules).where(and(eq(s.tenantModules.tenantId, tenantId), eq(s.tenantModules.module, 'pessoas_cultura'))).limit(1);
  return m ? m.enabled : true;
};
const tzOf = async (db: DbOrTx, tenantId: string) => (await db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1))[0]?.tz ?? 'America/Sao_Paulo';
const firstName = (n: string) => n.split(' ')[0] ?? n;

type NewBadge = { key: string; name: string; tier: string; tierIndex: number; description: string };

/**
 * Confere as faixas de badge do ano para as pessoas; devolve as novas (e publica a celebração de cada uma).
 * Na primeira vez da empresa, registra o que já existia sem publicar (para não inundar o feed na implantação).
 */
export async function checkBadges(db: DbOrTx, tenantId: string, userIds: string[], opts: { publish?: boolean } = {}): Promise<Map<string, NewBadge[]>> {
  const out = new Map<string, NewBadge[]>();
  const ps = await peopleSettingsOf(db, tenantId);
  const { settings: gs } = await gamificationSettingsOf(db, tenantId);
  if (!gs || !userIds.length || !(await moduleOn(db, tenantId))) return out;
  const tz = await tzOf(db, tenantId);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const year = Number(today.slice(0, 4));
  const auth = { tenantId, timezone: tz } as AuthContext;
  let baseline = !ps.badgeBaselineAt;
  let targets = userIds;
  if (baseline) targets = (await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)))).map((u) => u.id);
  const progress = await badgesBetween(db, auth, gs, `${year}-01-01`, today, targets);
  const have = await db.select({ userId: s.peopleBadgeAwards.userId, badgeKey: s.peopleBadgeAwards.badgeKey, tierIndex: s.peopleBadgeAwards.tierIndex }).from(s.peopleBadgeAwards)
    .where(and(eq(s.peopleBadgeAwards.tenantId, tenantId), eq(s.peopleBadgeAwards.year, year), inArray(s.peopleBadgeAwards.userId, targets)));
  const got = new Set(have.map((h) => `${h.userId}:${h.badgeKey}:${h.tierIndex}`));
  const names = new Map((await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, targets))).map((u) => [u.id, u.name]));
  for (const [userId, badges] of progress) {
    for (const b of badges) {
      if (b.tierIndex === null) continue;
      const missing: number[] = [];
      for (let i = 0; i <= b.tierIndex; i++) if (!got.has(`${userId}:${b.key}:${i}`)) missing.push(i);
      if (!missing.length) continue;
      // várias faixas de uma vez (ex.: pulou da mínima para a alta): uma celebração só, da maior
      for (const i of missing) await db.insert(s.peopleBadgeAwards).values({ tenantId, userId, badgeKey: b.key, year, tierIndex: i, tierName: b.tiers[i]!.name, silent: baseline }).onConflictDoNothing();
      if (baseline) continue;
      const nb = { key: b.key, name: b.name, tier: b.tier!, tierIndex: b.tierIndex, description: b.description };
      out.set(userId, [...(out.get(userId) ?? []), nb]);
      if (opts.publish !== false && ps.celebrations.badges) {
        const def = BADGE_CELEBRATION[b.key as BadgeKey] ?? { emoji: '🏆', text: (n: string) => `${n} conquistou o badge ${b.name}!` };
        const body = `${def.emoji} ${def.text(firstName(names.get(userId) ?? ''))}\nFaixa alcançada: ${nb.tier}.`;
        const [p] = await db.insert(s.peoplePosts).values({
          tenantId, authorId: userId, kind: 'conquista', audience: 'organizacao', body, status: 'publicado', publishedAt: new Date(),
          meta: { type: 'badge', badge: nb, year }, sourceKey: `badge:${userId}:${b.key}:${year}:${b.tierIndex}`,
        }).onConflictDoNothing().returning({ id: s.peoplePosts.id });
        if (p) await db.update(s.peopleBadgeAwards).set({ postId: p.id }).where(and(eq(s.peopleBadgeAwards.userId, userId), eq(s.peopleBadgeAwards.badgeKey, b.key), eq(s.peopleBadgeAwards.year, year), eq(s.peopleBadgeAwards.tierIndex, b.tierIndex)));
      }
    }
  }
  if (baseline) {
    await db.insert(s.peopleSettings).values({ tenantId, settings: { ...ps, badgeBaselineAt: new Date().toISOString() } })
      .onConflictDoUpdate({ target: s.peopleSettings.tenantId, set: { settings: sql`people_settings.settings || ${JSON.stringify({ badgeBaselineAt: new Date().toISOString() })}::jsonb` } });
    baseline = false;
    // a pessoa da venda que disparou a implantação ainda pode ter subido de faixa agora: confere de novo
    return checkBadges(db, tenantId, userIds, opts);
  }
  return out;
}

/** Venda fechada: conquista no feed com pontos e badges (nunca valores). Uma vez por negociação. */
export async function celebrateDealWon(db: DbOrTx, tenantId: string, opportunityId: string) {
  const ps: PeopleSettings = await peopleSettingsOf(db, tenantId);
  if (!ps.celebrations.dealWon || !(await moduleOn(db, tenantId))) return null;
  const [o] = await db.select({ id: s.opportunities.id, ownerId: s.opportunities.ownerId, stage: s.opportunities.stage, contactName: s.contacts.name, ownerName: s.users.name })
    .from(s.opportunities).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId)).innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
    .where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId))).limit(1);
  if (!o || o.stage !== 'ganha') return null;
  const [dup] = await db.select({ id: s.peoplePosts.id }).from(s.peoplePosts).where(and(eq(s.peoplePosts.tenantId, tenantId), eq(s.peoplePosts.sourceKey, `venda:${o.id}`))).limit(1);
  if (dup) return dup.id;
  const { settings: gs } = await gamificationSettingsOf(db, tenantId);
  let points: number | null = null;
  if (gs) {
    await ensureFreshEvents(db, tenantId, 0);
    points = (await opportunityPointsFor(db, tenantId, gs, o.id, o.ownerId))?.total ?? 0;
  }
  const badges = (await checkBadges(db, tenantId, [o.ownerId])).get(o.ownerId) ?? [];
  const first = firstName(o.ownerName);
  const body = `🎉 Venda fechada! Parabéns, ${first}!${ps.celebrations.showClient ? ` ${o.contactName} agora é cliente.` : ''}${points ? ` Foram ${points.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos nesta conquista.` : ''}`;
  const [p] = await db.insert(s.peoplePosts).values({
    tenantId, authorId: o.ownerId, kind: 'conquista', audience: 'organizacao', body, status: 'publicado', publishedAt: new Date(),
    meta: { type: 'venda', opportunityId: o.id, client: ps.celebrations.showClient ? o.contactName : null, points, badges }, sourceKey: `venda:${o.id}`,
  }).onConflictDoNothing().returning({ id: s.peoplePosts.id });
  return p?.id ?? null;
}

