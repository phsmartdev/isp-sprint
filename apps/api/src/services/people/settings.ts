/**
 * Pessoas & Cultura — parâmetros do módulo e papéis.
 *
 * Papéis reaproveitam o controle de acesso existente (nada paralelo):
 *  - nível no módulo técnico "pessoas" (matriz de Segurança): Próprio = colaborador, Equipe = gestor, Total = administração do módulo;
 *  - setores da empresa (cadastro de usuários) indicados nas configurações do módulo: Comunicação Interna,
 *    Pessoas e Cultura e Moderação.
 * Nenhum papel dá acesso a conteúdo privado de comunidade: isso depende só de ser membro.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast } from '@isp/domain';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { AuthContext } from '../../http/context';
import { level } from '../scope';

const sectorKeys = z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(20).default([]);
export const PeopleSettings = z.object({
  roles: z.object({
    /** comunicados oficiais e publicações institucionais */
    comunicacao: sectorKeys,
    /** categorias de reconhecimento, comunidades institucionais, indicadores e parâmetros */
    pessoasCultura: sectorKeys,
    /** análise de denúncias */
    moderacao: sectorKeys,
  }).default({}),
  limits: z.object({
    imageMb: z.number().int().min(1).max(10).default(5),
    videoMb: z.number().int().min(1).max(50).default(50),
    mediaPerPost: z.number().int().min(1).max(10).default(6),
    postChars: z.number().int().min(100).max(5000).default(3000),
  }).default({}),
  /** conquistas automáticas no feed */
  celebrations: z.object({
    /** venda fechada: pontos e badges da negociação (nunca o valor) */
    dealWon: z.boolean().default(true),
    /** nome da conta (cliente) no cartão da venda */
    showClient: z.boolean().default(true),
    /** nova faixa de badge alcançada */
    badges: z.boolean().default(true),
  }).default({}),
  /** canais externos por evento (a notificação interna é sempre o canal principal); nunca levam o conteúdo da publicação */
  notifications: z.record(z.string(), z.object({ email: z.boolean().default(false), whatsapp: z.boolean().default(false) })).default({
    comunicado_urgente: { email: true, whatsapp: false },
    comunicado_pendente: { email: true, whatsapp: false },
  }),
  /** implantação das celebrações de badge: faixas que já existiam foram registradas sem publicar */
  badgeBaselineAt: z.string().nullable().default(null),
});
export type PeopleSettings = z.infer<typeof PeopleSettings>;

export async function peopleSettingsOf(db: DbOrTx, tenantId: string): Promise<PeopleSettings> {
  const [r] = await db.select({ settings: s.peopleSettings.settings }).from(s.peopleSettings).where(eq(s.peopleSettings.tenantId, tenantId)).limit(1);
  const parsed = PeopleSettings.safeParse(r?.settings ?? {});
  return parsed.success ? parsed.data : PeopleSettings.parse({});
}

export type PeopleCaps = {
  /** colaborador: ver, publicar, interagir, participar e reconhecer */
  member: boolean;
  /** comunicados oficiais e conteúdo institucional (em nome da empresa) */
  communicate: boolean;
  /** categorias, comunidades institucionais, indicadores agregados e parâmetros funcionais */
  administer: boolean;
  /** triagem e decisão de denúncias */
  moderate: boolean;
  /** parâmetros do módulo (papéis por setor, limites): administração do módulo ou administração do sistema; não abre conteúdo privado */
  configure: boolean;
  /** RH (setor de Pessoas e Cultura): políticas de desenvolvimento e mediação de feedback confidencial; a administração técnica não ganha isso */
  hr: boolean;
};

export function peopleCaps(auth: AuthContext, st: PeopleSettings): PeopleCaps {
  const lv = level(auth, 'pessoas');
  const total = lv === 'total';
  const has = (keys: string[]) => keys.some((k) => (auth.sectors as string[]).includes(k));
  const pc = has(st.roles.pessoasCultura);
  return {
    member: atLeast(lv, 'proprio'),
    administer: total || pc,
    communicate: total || pc || has(st.roles.comunicacao),
    moderate: total || pc || has(st.roles.moderacao) || has(st.roles.comunicacao),
    configure: total || pc || auth.access.configuracoes === 'total',
    hr: pc,
  };
}
