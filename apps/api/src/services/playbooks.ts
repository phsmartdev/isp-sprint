/**
 * Central de Playbooks — regras de acesso, papéis, publicação (transacional) e rotinas (publicação programada e alertas de revisão).
 */
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import {
  DEFAULT_PLAYBOOK_CATEGORIES, PLAYBOOK_TYPE_LABELS, audienceAllows, nextReview, reviewAlertsDue,
  type Audience, type PlaybookContent, type PlaybookType, type ReviewPeriod, type Viewer,
} from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DB, DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { seesAllTeams } from './results';
import { leadsOrManages, todayIn, vacationOrg } from './vacations';
import { ensureGamificationGuideline } from './gamificationGuideline';

export type PlaybookMeta = {
  title: string; description: string; keywords: string[]; type: PlaybookType; criticality: 'baixa' | 'media' | 'alta';
  ownerTeamId: string | null; costCenterId: string | null; maintainerId: string | null;
  visibility: Audience['visibility']; teamIds: string[]; costCenterIds: string[]; profiles: string[]; userIds: string[];
  reviewPeriod: ReviewPeriod; reviewCustomDays: number | null; nextReviewOn: string | null; requiresAck: boolean; contexts: string[];
};

export const isDirector = (auth: AuthContext) => auth.profiles.some((p) => p === 'diretoria' || p === 'administrador') || seesAllTeams(auth);
export const isManager = (auth: AuthContext) => auth.profiles.includes('gerencia');

/** Contexto organizacional real de quem lê: times, centros de custo (do time ou em que opera) e perfis. */
export async function viewerOf(db: DbOrTx, auth: AuthContext): Promise<Viewer> {
  const ccs = await db.select({ id: s.costCenters.id }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.active, true), or(
    auth.teamIds.length ? inArray(s.costCenters.teamId, auth.teamIds) : sql`false`, eq(s.costCenters.leaderId, auth.userId), sql`${auth.userId} = any(${s.costCenters.memberIds})`,
  )));
  return { userId: auth.userId, teamIds: auth.teamIds, costCenterIds: ccs.map((c) => c.id), profiles: auth.profiles };
}

/** Pode criar playbooks: lidera ou gere algum time, ou é Supervisão, Gerência, Diretoria ou administração. */
export async function canCreate(db: DbOrTx, auth: AuthContext) {
  if (isDirector(auth) || isManager(auth) || auth.profiles.includes('supervisor')) return true;
  const org = await vacationOrg(db, auth.tenantId);
  return Object.keys(org.teamNames).some((t) => leadsOrManages(org, t, auth.userId));
}

type PbRow = typeof s.playbooks.$inferSelect;
/** Edita (rascunhos) quem mantém, quem criou, a liderança e a gestão do time dono, a Gerência e a Diretoria. */
export async function canEditPb(db: DbOrTx, auth: AuthContext, p: PbRow, meta?: Partial<PlaybookMeta>) {
  if (isDirector(auth) || isManager(auth)) return true;
  if ([p.maintainerId, p.createdBy, meta?.maintainerId].includes(auth.userId)) return true;
  const team = meta?.ownerTeamId ?? p.ownerTeamId;
  if (!team) return false;
  return leadsOrManages(await vacationOrg(db, auth.tenantId), team, auth.userId);
}

const audOf = (p: PbRow): Audience => ({ visibility: p.visibility as Audience['visibility'], teamIds: p.teamIds, costCenterIds: p.costCenterIds, profiles: p.profiles, userIds: p.userIds });
/** Lê a versão vigente: público autorizado (regra explícita), ativo; suspenso só para quem edita ou aprova. */
export function readerAllows(p: PbRow, v: Viewer) {
  return !!p.currentVersionId && p.status === 'ativo' && audienceAllows(audOf(p), v);
}

/** Categorias e modelos iniciais (uma vez por empresa). */
export async function ensurePlaybookSetup(db: DbOrTx, tenantId: string) {
  // categorias iniciais só na primeira vez (a linha de configuração marca que a Central já foi preparada):
  // depois disso a gestão cria, edita e exclui à vontade, e excluir todas não as recria
  const created = await db.insert(s.playbookSettings).values({ tenantId }).onConflictDoNothing().returning({ t: s.playbookSettings.tenantId });
  if (created.length) {
    const [any] = await db.select({ id: s.playbookCategories.id }).from(s.playbookCategories).where(eq(s.playbookCategories.tenantId, tenantId)).limit(1);
    if (!any) await db.insert(s.playbookCategories).values(DEFAULT_PLAYBOOK_CATEGORIES.map((c) => ({ tenantId, name: c.name, prefix: c.prefix, icon: c.icon, description: c.description }))).onConflictDoNothing();
  }
  const [tpl] = await db.select({ id: s.playbookTemplates.id }).from(s.playbookTemplates).where(and(eq(s.playbookTemplates.tenantId, tenantId), eq(s.playbookTemplates.system, true))).limit(1);
  await ensureGamificationGuideline(db, tenantId);
  if (!tpl) await db.insert(s.playbookTemplates).values(SYSTEM_TEMPLATES.map((t) => ({ tenantId, name: t.name, type: t.type, description: t.description, content: t.content, system: true }))).onConflictDoNothing();
}

let seq = 0;
const bid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;
const H = (text: string) => ({ id: bid(), type: 'heading' as const, level: 1 as const, text });
const T = (text: string) => ({ id: bid(), type: 'text' as const, text });
const C = (kind: 'atencao' | 'importante' | 'exemplo' | 'dica', text: string) => ({ id: bid(), type: 'callout' as const, kind, text });
const CK = (title: string, items: string[], mode: 'aprendizagem' | 'operacional' = 'aprendizagem') => ({ id: bid(), type: 'checklist' as const, mode, title, items: items.map((t, i) => ({ id: `i${i + 1}`, text: t })) });
const ST = (items: string[]) => ({ id: bid(), type: 'steps' as const, items: items.map((t) => ({ title: t })) });
/** Modelos iniciais: estrutura de seções a preencher (sem conteúdo fictício de processo). */
const SYSTEM_TEMPLATES: { name: string; type: PlaybookType; description: string; content: PlaybookContent }[] = [
  { name: PLAYBOOK_TYPE_LABELS.procedimento, type: 'procedimento', description: 'Objetivo, escopo, responsáveis, etapas e registros.', content: { blocks: [H('Objetivo'), T('Descreva para que serve este procedimento.'), H('Escopo e responsáveis'), T('Quem executa, quem aprova e onde se aplica.'), H('Etapas'), ST(['Primeira etapa', 'Segunda etapa']), H('Registros e evidências'), T('O que precisa ficar registrado e onde.')] } },
  { name: PLAYBOOK_TYPE_LABELS.comercial, type: 'comercial', description: 'Jornada comercial por etapas, com objeções e materiais.', content: { blocks: [H('Identificação do cliente'), T('Como qualificar.'), H('Descoberta do contexto'), T('Perguntas-chave.'), H('Apresentação da solução'), T('Como apresentar valor.'), H('Tratamento de objeções'), { id: bid(), type: 'faq', items: [{ q: 'Objeção', a: 'Como responder' }] }, H('Condução da decisão'), T('Próximos passos e fechamento.')] } },
  { name: PLAYBOOK_TYPE_LABELS.atendimento, type: 'atendimento', description: 'Canais, scripts, prazos e escalonamento.', content: { blocks: [H('Canais e horários'), T('Onde e quando atender.'), H('Como atender'), ST(['Saudação e identificação', 'Entendimento da necessidade', 'Solução ou encaminhamento', 'Encerramento']), H('Escalonamento'), C('atencao', 'Quando e para quem escalar.')] } },
  { name: PLAYBOOK_TYPE_LABELS.politica, type: 'politica', description: 'Diretrizes, aplicação, responsabilidades e exceções.', content: { blocks: [H('Finalidade'), T('Por que esta política existe.'), H('Diretrizes'), T('Regras que valem para todos.'), H('Responsabilidades'), T('Quem faz o quê.'), H('Exceções'), C('importante', 'Como pedir e quem autoriza exceções.')] } },
  { name: PLAYBOOK_TYPE_LABELS.checklist, type: 'checklist', description: 'Lista de verificação para execução.', content: { blocks: [H('Antes de começar'), CK('Pré-requisitos', ['Item a conferir'], 'operacional'), H('Execução'), CK('Verificação', ['Item a conferir'], 'operacional')] } },
  { name: PLAYBOOK_TYPE_LABELS.fluxo_aprovacao, type: 'fluxo_aprovacao', description: 'Fluxograma de aprovação com decisões.', content: { blocks: [H('Fluxo'), { id: bid(), type: 'flow', title: 'Fluxo de aprovação', nodes: [{ id: 'n1', kind: 'inicio', label: 'Solicitação', x: 0, y: 0 }, { id: 'n2', kind: 'decisao', label: 'Dentro da alçada?', x: 0, y: 120 }, { id: 'n3', kind: 'etapa', label: 'Aprova a liderança', x: -160, y: 240 }, { id: 'n4', kind: 'etapa', label: 'Aprova a Gerência', x: 160, y: 240 }, { id: 'n5', kind: 'fim', label: 'Concluído', x: 0, y: 360 }], edges: [{ id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3', label: 'Sim' }, { id: 'e3', from: 'n2', to: 'n4', label: 'Não' }, { id: 'e4', from: 'n3', to: 'n5' }, { id: 'e5', from: 'n4', to: 'n5' }] }, H('Alçadas'), { id: bid(), type: 'table', header: true, rows: [['Valor', 'Quem aprova'], ['Até ...', '...']] }] } },
  { name: PLAYBOOK_TYPE_LABELS.treinamento, type: 'treinamento', description: 'Conteúdo de capacitação com checklist de aprendizagem.', content: { blocks: [H('O que você vai aprender'), T('Objetivos do treinamento.'), H('Conteúdo'), T('Explicação.'), H('Confira o que aprendeu'), CK('Aprendizagem', ['Entendi o conceito principal'])] } },
  { name: PLAYBOOK_TYPE_LABELS.integracao, type: 'integracao', description: 'Primeiros dias de quem chega.', content: { blocks: [H('Boas-vindas'), T('Mensagem de boas-vindas.'), H('Primeira semana'), CK('Primeira semana', ['Acessos liberados', 'Conhecer o time']), H('Contatos úteis'), { id: bid(), type: 'table', header: true, rows: [['Assunto', 'Quem procurar'], ['', '']] }] } },
];

/** Publica a versão aprovada (transação): encerra a vigente, vigora a nova e atualiza o retrato do playbook. */
export async function publishVersion(db: DbOrTx, tenantId: string, versionId: string, today: string, actorId: string | null) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook-pub:${versionId}`}))`);
  const [v] = await db.select().from(s.playbookVersions).where(and(eq(s.playbookVersions.id, versionId), eq(s.playbookVersions.tenantId, tenantId)));
  if (!v || v.status !== 'aprovada') return false;
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook:${v.playbookId}`}))`);
  await db.update(s.playbookVersions).set({ status: 'encerrada', validTo: new Date(), updatedAt: new Date() }).where(and(eq(s.playbookVersions.playbookId, v.playbookId), eq(s.playbookVersions.status, 'vigente')));
  await db.update(s.playbookVersions).set({ status: 'vigente', publishedAt: new Date(), updatedAt: new Date() }).where(eq(s.playbookVersions.id, v.id));
  const m = v.meta as unknown as PlaybookMeta;
  const next = m.nextReviewOn && m.nextReviewOn > today ? m.nextReviewOn : nextReview(today, m.reviewPeriod, m.reviewCustomDays);
  await db.update(s.playbooks).set({
    title: m.title, description: m.description, ownerTeamId: m.ownerTeamId, costCenterId: m.costCenterId, maintainerId: m.maintainerId,
    visibility: m.visibility, teamIds: m.teamIds, costCenterIds: m.costCenterIds, profiles: m.profiles, userIds: m.userIds,
    reviewPeriod: m.reviewPeriod, reviewCustomDays: m.reviewCustomDays, lastReviewOn: today, nextReviewOn: next, requiresAck: m.requiresAck,
    currentVersionId: v.id, updatedAt: new Date(),
  }).where(eq(s.playbooks.id, v.playbookId));
  await db.insert(s.playbookEvents).values({ tenantId, playbookId: v.playbookId, versionId: v.id, type: 'publicada', note: `Versão ${v.number} em vigor${v.relevant ? ' (mudança relevante)' : ''}.`, actorId });
  return true;
}

/** Rotinas: vigora as versões com data programada e manda os alertas de revisão (30/15/7 dias e no vencimento, configurável). */
export async function ensurePlaybookJobs(db: DB, tenantId: string, tz: string) {
  const today = todayIn(tz);
  const due = await db.select({ id: s.playbookVersions.id }).from(s.playbookVersions).where(and(eq(s.playbookVersions.tenantId, tenantId), eq(s.playbookVersions.status, 'aprovada'), lte(s.playbookVersions.effectiveFrom, today)));
  for (const d of due) await db.transaction((tx) => publishVersion(tx, tenantId, d.id, today, null));
  const [st] = await db.select().from(s.playbookSettings).where(eq(s.playbookSettings.tenantId, tenantId));
  const days = st?.alertDays ?? [30, 15, 7, 0];
  const live = await db.select({ id: s.playbooks.id, title: s.playbooks.title, code: s.playbooks.code, next: s.playbooks.nextReviewOn, maintainerId: s.playbooks.maintainerId, ownerTeamId: s.playbooks.ownerTeamId })
    .from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), sql`${s.playbooks.currentVersionId} is not null`, sql`${s.playbooks.nextReviewOn} <= (${today}::date + ${Math.max(...days, 0)}::int)`));
  if (!live.length) return;
  const org = await vacationOrg(db, tenantId);
  for (const p of live) {
    for (const d of reviewAlertsDue(p.next, today, days)) {
      const ins = await db.insert(s.playbookAlerts).values({ playbookId: p.id, dueOn: p.next!, days: d }).onConflictDoNothing().returning();
      if (!ins.length) continue;
      const notify = [...new Set([p.maintainerId, ...(p.ownerTeamId ? [...(org.leads[p.ownerTeamId] ?? []), ...(org.managers[p.ownerTeamId] ?? [])] : [])].filter((x): x is string => !!x))];
      const text = d === 0 ? `Revisão de ${p.code} vence hoje` : p.next! < today ? `Revisão de ${p.code} vencida` : `Revisão de ${p.code} em ${d} dias`;
      await db.insert(s.playbookEvents).values({ tenantId, playbookId: p.id, type: 'alerta_revisao', note: text });
      if (notify.length) await db.insert(s.governanceEvents).values({ tenantId, entity: 'playbook', entityId: p.id, type: 'revisao', notify, payload: { title: `${text}: ${p.title}` } });
    }
  }
}
