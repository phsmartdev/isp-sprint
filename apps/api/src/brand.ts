/**
 * Marca da instância no servidor. É a MESMA variável do front (VITE_BRAND, ver apps/web/src/brand.ts):
 * na Vercel ela vale para o build e para a API, então basta configurar uma vez por projeto.
 *
 *   bkt (padrão) → RevOps, filiais iniciais BKT Soluções e UPNET.
 *   yepnet       → ISP Sprint, filial inicial Yepnet.
 *
 * Só textos que o sistema escreve sozinho (e-mails automáticos, exportações, GLPI, modelos iniciais) e os
 * cadastros iniciais. Tudo o que a empresa edita em Configurações continua valendo como ela deixou.
 */
import { BUSINESS_MODULE_HINTS, BUSINESS_MODULE_LABELS, defaultTenantModule, type BusinessModule, type TenantModule } from '@isp/domain';

export type ServerBrand = {
  id: 'bkt' | 'yepnet'; app: string; company: string; defaultBranches: string[];
  /**
   * Módulos de uma empresa que ainda não mexeu em Configurações → Módulos. O que a empresa salvar lá vale por cima.
   * Ausente = tudo ligado (comportamento de sempre).
   */
  modules?: Partial<Record<BusinessModule, { enabled: boolean; disabledFeatures?: string[] }>>;
  /** Nome e descrição de módulo próprios da marca (ex.: Marketing vira Inbound Marketing na Yepnet). */
  moduleLabels?: Partial<Record<BusinessModule, string>>;
  moduleHints?: Partial<Record<BusinessModule, string>>;
};

const BRANDS: Record<ServerBrand['id'], ServerBrand> = {
  bkt: { id: 'bkt', app: 'RevOps', company: 'BKT', defaultBranches: ['BKT Soluções', 'UPNET'] },
  yepnet: {
    id: 'yepnet', app: 'ISP Sprint', company: 'Yepnet', defaultBranches: ['Yepnet'],
    // Pedido do Paulo (31/10/2026): CRM, Inbound Marketing, Gestão de Time, Contratos sem licitação, Relatórios e Orçamento.
    modules: {
      crm: { enabled: true, disabledFeatures: ['crm.chamados', 'crm.sucesso_cliente'] },
      marketing: { enabled: true, disabledFeatures: ['marketing.abm'] },
      produto: { enabled: false },
      gestao_time: { enabled: true },
      contratos: { enabled: true, disabledFeatures: ['contratos.atas', 'contratos.empenhos', 'contratos.atestados'] },
      projetos: { enabled: false },
      relatorios: { enabled: true },
      orcamento: { enabled: true },
    },
    moduleLabels: { marketing: 'Inbound Marketing' },
    moduleHints: { marketing: 'Captação e nutrição de leads: leads e campanhas.' },
  },
};

export function serverBrand(env: NodeJS.ProcessEnv = process.env): ServerBrand {
  const id = (env.VITE_BRAND ?? env.BRAND) === 'yepnet' ? 'yepnet' : 'bkt';
  return BRANDS[id];
}

export const BRAND = serverBrand();
/** Nome da ferramenta nos textos automáticos ("Abrir no RevOps", "Aberto no ISP Sprint por…"). */
export const APP = BRAND.app;

/** Configuração do módulo quando a empresa ainda não salvou nada para ele. */
export function brandTenantModule(m: BusinessModule): TenantModule {
  const d = BRAND.modules?.[m];
  return d ? { module: m, enabled: d.enabled, mode: 'todos', disabledFeatures: d.disabledFeatures ?? [] } : defaultTenantModule(m);
}
export const moduleLabel = (m: BusinessModule) => BRAND.moduleLabels?.[m] ?? BUSINESS_MODULE_LABELS[m];
export const moduleHint = (m: BusinessModule) => BRAND.moduleHints?.[m] ?? BUSINESS_MODULE_HINTS[m];
