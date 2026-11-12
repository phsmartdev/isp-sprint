/**
 * Manual do sistema na Central de Playbooks: um playbook por capítulo, na categoria "Manual do sistema" (prefixo SIS).
 *
 * - Instalar cria os capítulos que faltam já publicados (conteúdo do sistema, como a Diretriz de Gamificação).
 * - Atualizar publica nova versão só dos capítulos cujo conteúdo mudou (as tabelas de referência e a lista da API
 *   são geradas do sistema a cada atualização) e só quando a versão vigente é do sistema e não há versão em edição:
 *   o que a empresa editou e aprovou nunca é sobrescrito.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { contentErrors, contentText, nextReview, nextVersion, playbookCode, type Block, type PlaybookContent } from '@isp/domain';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { routeRegistry } from '../http/route';
import { parseManual } from '../manual/dsl';
import { generators, type RouteInfo } from '../manual/generated';
import type { ManualChapter } from '../manual/types';
import { CH_CONTRATOS, CH_CRM, CH_LICITACOES, CH_VISAO } from '../manual/chapters1';
import { CH_MARKETING, CH_ORCAMENTO, CH_PROJETOS, CH_SUCESSO, CH_TIMES } from '../manual/chapters2';
import { CH_CONFIG, CH_EMAIL, CH_INTEGRACOES, CH_INTELIGENCIA, CH_PESSOAS, CH_PLAYBOOKS } from '../manual/chapters3';
import { CH_ACESSOS, CH_API, CH_DESIGN } from '../manual/chapters4';
import { todayIn } from './vacations';

export const MANUAL_CHAPTERS: ManualChapter[] = [
  CH_VISAO, CH_ACESSOS, CH_CRM, CH_LICITACOES, CH_CONTRATOS, CH_SUCESSO, CH_MARKETING, CH_TIMES, CH_PROJETOS,
  CH_ORCAMENTO, CH_PESSOAS, CH_INTELIGENCIA, CH_EMAIL, CH_PLAYBOOKS, CH_CONFIG, CH_INTEGRACOES, CH_API, CH_DESIGN,
];
export const MANUAL_CATEGORY = { name: 'Manual do sistema', prefix: 'SIS', icon: 'book', description: 'Manual do RevOps: uso de cada módulo por perfil, integrações, API e padrões de design.' };
const ctxOf = (slug: string) => `sistema:manual:${slug}`;
const OPEN = ['rascunho', 'revisao_gerencia', 'homologacao_diretoria', 'aprovada'];

export type BuiltChapter = { chapter: ManualChapter; content: PlaybookContent; hash: string; meta: Record<string, unknown> };

/** Monta todos os capítulos (com as partes geradas do sistema) e confere a integridade de cada um. */
export function buildManual(routes: RouteInfo[] = routeRegistry.map((r) => ({ method: r.method, url: r.url, summary: r.summary, tag: r.tag, module: r.module ?? null, min: r.min ?? null, feature: r.feature, public: r.public, anyAuthenticated: r.anyAuthenticated }))): BuiltChapter[] {
  const gens = generators(routes);
  return MANUAL_CHAPTERS.map((chapter) => {
    const blocks: Block[] = parseManual(chapter.slug, chapter.src, gens);
    const content = { blocks };
    const errs = contentErrors(content);
    if (errs.length) throw new Error(`Manual, capítulo ${chapter.slug}: ${errs.slice(0, 3).join(' ')}`);
    const hash = createHash('sha256').update(JSON.stringify({ t: chapter.title, d: chapter.description, k: chapter.keywords, y: chapter.type, blocks })).digest('hex');
    const meta = {
      title: chapter.title, description: chapter.description, keywords: chapter.keywords.slice(0, 20), type: chapter.type, criticality: 'baixa',
      ownerTeamId: null, costCenterId: null, maintainerId: null, visibility: 'corporativo', teamIds: [], costCenterIds: [], profiles: [], userIds: [],
      reviewPeriod: 'semestral', reviewCustomDays: null, nextReviewOn: null, requiresAck: false, contexts: [ctxOf(chapter.slug)],
      manualSystem: true, manualHash: hash,
    };
    return { chapter, content, hash, meta };
  });
}

async function chapterState(db: DB, tenantId: string) {
  const ctxs = MANUAL_CHAPTERS.map((c) => ctxOf(c.slug));
  const rows = await db.execute<{ ctx: string; playbook_id: string }>(sql`select distinct on (ctx) ctx, playbook_id from (
      select jsonb_array_elements_text(meta->'contexts') as ctx, playbook_id, created_at from playbook_versions where tenant_id = ${tenantId}
    ) x where ctx in (${sql.join(ctxs.map((c) => sql`${c}`), sql`, `)}) order by ctx, created_at`);
  const pbIds = rows.rows.map((r) => r.playbook_id);
  const pbs = pbIds.length ? await db.select().from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), inArray(s.playbooks.id, pbIds))) : [];
  const vIds = pbs.map((p) => p.currentVersionId).filter((x): x is string => !!x);
  const cur = vIds.length ? await db.select().from(s.playbookVersions).where(inArray(s.playbookVersions.id, vIds)) : [];
  const open = pbIds.length ? await db.select({ playbookId: s.playbookVersions.playbookId }).from(s.playbookVersions).where(and(inArray(s.playbookVersions.playbookId, pbIds), inArray(s.playbookVersions.status, OPEN))) : [];
  const out = new Map<string, { playbook: (typeof pbs)[number]; current: (typeof cur)[number] | null; hasDraft: boolean }>();
  for (const r of rows.rows) {
    const playbook = pbs.find((p) => p.id === r.playbook_id);
    if (!playbook) continue;
    out.set(r.ctx.slice('sistema:manual:'.length), { playbook, current: cur.find((v) => v.id === playbook.currentVersionId) ?? null, hasDraft: open.some((o) => o.playbookId === playbook.id) });
  }
  return out;
}

export type ManualItem = { slug: string; title: string; playbookId: string | null; code: string | null; version: string | null; state: 'nao_instalado' | 'atualizado' | 'desatualizado' | 'editado_pela_empresa' | 'em_edicao' };

/** Situação de cada capítulo nesta empresa. */
export async function manualStatus(db: DB, tenantId: string): Promise<ManualItem[]> {
  const built = buildManual();
  const st = await chapterState(db, tenantId);
  return built.map((b) => {
    const x = st.get(b.chapter.slug);
    if (!x) return { slug: b.chapter.slug, title: b.chapter.title, playbookId: null, code: null, version: null, state: 'nao_instalado' };
    const m = (x.current?.meta ?? {}) as { manualSystem?: boolean; manualHash?: string };
    const state = x.hasDraft ? 'em_edicao' : !m.manualSystem ? 'editado_pela_empresa' : m.manualHash === b.hash ? 'atualizado' : 'desatualizado';
    return { slug: b.chapter.slug, title: b.chapter.title, playbookId: x.playbook.id, code: x.playbook.code, version: x.current?.number ?? null, state };
  });
}

/** Instala os capítulos que faltam e publica nova versão dos que mudaram (sem passar por cima de edições da empresa). */
export async function syncManual(db: DB, tenantId: string, actorId: string, tz = 'America/Sao_Paulo') {
  const built = buildManual();
  const today = todayIn(tz);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pb-manual:${tenantId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook-code:${tenantId}`}))`);
    await tx.insert(s.playbookSettings).values({ tenantId }).onConflictDoNothing();
    let [cat] = await tx.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.tenantId, tenantId), eq(s.playbookCategories.prefix, MANUAL_CATEGORY.prefix)));
    if (!cat) [cat] = await tx.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.tenantId, tenantId), eq(s.playbookCategories.name, MANUAL_CATEGORY.name)));
    if (!cat) [cat] = await tx.insert(s.playbookCategories).values({ tenantId, ...MANUAL_CATEGORY, approval: { gerencia: true, diretoria: true } }).returning();
    else if (!cat.active) await tx.update(s.playbookCategories).set({ active: true }).where(eq(s.playbookCategories.id, cat.id));
    const [st] = await tx.select().from(s.playbookSettings).where(eq(s.playbookSettings.tenantId, tenantId));
    const pattern = st?.codePattern ?? '{CAT}-PB-{NUM}';
    const state = await chapterState(tx as unknown as DB, tenantId);
    const created: string[] = [], updated: string[] = [], unchanged: string[] = [], skipped: { title: string; reason: string }[] = [];
    let k = (await tx.select({ n: sql<number>`count(*)::int` }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), eq(s.playbooks.categoryId, cat!.id))))[0]!.n;
    for (const b of built) {
      const x = state.get(b.chapter.slug);
      const content = b.content as unknown as { blocks: unknown[] };
      if (!x) {
        let code = playbookCode(pattern, cat!.prefix, ++k);
        while ((await tx.select({ id: s.playbooks.id }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), eq(s.playbooks.code, code)))).length) code = playbookCode(pattern, cat!.prefix, ++k);
        const [p] = await tx.insert(s.playbooks).values({ tenantId, code, categoryId: cat!.id, title: b.chapter.title, description: b.chapter.description, visibility: 'corporativo', reviewPeriod: 'semestral', lastReviewOn: today, nextReviewOn: nextReview(today, 'semestral', null), requiresAck: false, createdBy: actorId }).returning();
        const [v] = await tx.insert(s.playbookVersions).values({ tenantId, playbookId: p!.id, number: '1.0', status: 'vigente', meta: b.meta, content, searchText: contentText(b.content), changeSummary: 'Versão inicial do Manual do sistema.', relevant: true, authorId: actorId, publishedAt: new Date(), effectiveFrom: today }).returning();
        await tx.update(s.playbooks).set({ currentVersionId: v!.id }).where(eq(s.playbooks.id, p!.id));
        await tx.insert(s.playbookEvents).values({ tenantId, playbookId: p!.id, versionId: v!.id, type: 'publicada', note: `${code}: versão 1.0 do Manual do sistema publicada pelo sistema. Edições da empresa seguem a aprovação normal.`, actorId });
        created.push(b.chapter.title);
        continue;
      }
      const m = (x.current?.meta ?? {}) as { manualSystem?: boolean; manualHash?: string };
      if (x.current && m.manualSystem && m.manualHash === b.hash) { unchanged.push(b.chapter.title); continue; }
      if (x.hasDraft) { skipped.push({ title: b.chapter.title, reason: 'Há uma versão em edição ou aprovação; conclua ou descarte para receber a atualização.' }); continue; }
      if (x.current && !m.manualSystem) { skipped.push({ title: b.chapter.title, reason: 'A versão vigente foi editada e aprovada pela empresa; o sistema não sobrescreve.' }); continue; }
      const number = nextVersion(x.current?.number ?? null, false);
      await tx.update(s.playbookVersions).set({ status: 'encerrada', validTo: new Date(), updatedAt: new Date() }).where(and(eq(s.playbookVersions.playbookId, x.playbook.id), eq(s.playbookVersions.status, 'vigente')));
      const [v] = await tx.insert(s.playbookVersions).values({ tenantId, playbookId: x.playbook.id, number, status: 'vigente', meta: b.meta, content, searchText: contentText(b.content), changeSummary: 'Atualização do Manual do sistema (conteúdo e referências geradas do sistema).', relevant: false, basedOnVersionId: x.current?.id ?? null, authorId: actorId, publishedAt: new Date(), effectiveFrom: today }).returning();
      await tx.update(s.playbooks).set({ title: b.chapter.title, description: b.chapter.description, currentVersionId: v!.id, lastReviewOn: today, nextReviewOn: nextReview(today, 'semestral', null), updatedAt: new Date() }).where(eq(s.playbooks.id, x.playbook.id));
      await tx.insert(s.playbookEvents).values({ tenantId, playbookId: x.playbook.id, versionId: v!.id, type: 'publicada', note: `Versão ${number} do Manual do sistema publicada pelo sistema (atualização).`, actorId });
      updated.push(b.chapter.title);
    }
    return { created, updated, unchanged, skipped, categoryId: cat!.id };
  });
}
