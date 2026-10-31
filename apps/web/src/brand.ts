/**
 * Marca da instância. Mesmo código, várias empresas: cada deploy escolhe a sua pela variável VITE_BRAND
 * (definida na Vercel antes do build). Sem a variável vale a BKT, como sempre foi.
 *
 *   VITE_BRAND=bkt     → RevOps (BKT): cantos retos, azul/grafite, Orbitron, hexágonos, sem mascote.
 *   VITE_BRAND=yepnet  → ISP Sprint (Yepnet): cantos arredondados, azul/verde, Plus Jakarta Sans,
 *                        Dino nos cabeçalhos e "Confiar ficou fácil." Imagens enviadas em Configurações → Personalização.
 *
 * Cores, raios e fontes moram em styles/tokens.css, sob [data-brand]. Aqui ficam só textos e comportamento.
 */
import type { BrandSlot } from '@isp/shared';

export type BrandId = 'bkt' | 'yepnet';

export type BrandConfig = {
  id: BrandId;
  /** Nome da empresa (texto alternativo do logo e mensagens). */
  company: string;
  /** Nome da ferramenta, ao lado do logo. */
  app: string;
  /** Logo e imagens vêm de Configurações → Personalização (upload) em vez de arquivos fixos. */
  uploads: boolean;
  /** Dino e balões nos cabeçalhos das telas. */
  mascots: boolean;
  /** Slogan da marca (balões, menu, login). */
  slogan: { before: string; highlight: string } | null;
  home: { title: [string, string, string]; text: string; tipTitle: string | null; tip: string | null };
};

const BKT: BrandConfig = {
  id: 'bkt',
  company: 'BKT',
  app: 'RevOps',
  uploads: false,
  mascots: false,
  slogan: null,
  home: { title: ['Nova oportunidade', '', ''], text: 'Qualifique o cliente, consulte a cobertura e monte a proposta em um passo a passo guiado.', tipTitle: null, tip: null },
};

const YEPNET: BrandConfig = {
  id: 'yepnet',
  company: 'Yepnet',
  app: 'ISP Sprint',
  uploads: true,
  mascots: true,
  slogan: { before: 'Confiar ficou', highlight: 'fácil.' },
  home: {
    title: ['Uma venda', 'mais fácil,', 'do início ao fim.'],
    text: 'O ISP Sprint te guia em um passo a passo simples, com perguntas inteligentes e as melhores recomendações para fechar mais vendas.',
    tipTitle: 'Dica do Dino',
    tip: 'Entenda o que o cliente precisa, consulte a cobertura e apresente a melhor oferta.',
  },
};

const ALL: Record<BrandId, BrandConfig> = { bkt: BKT, yepnet: YEPNET };

export const BRAND: BrandConfig = ALL[(import.meta.env.VITE_BRAND as BrandId) ?? 'bkt'] ?? BKT;
export const isYepnet = BRAND.id === 'yepnet';

/** Textos fixos do balão do mascote em cada tela (decisão de 17/10: não são editáveis). */
export const MASCOT_LINES: Partial<Record<BrandSlot, string[]>> = {
  mascote_leads: ['Mais oportunidades', 'para o seu dia.'],
  mascote_oportunidades: ['Arraste as oportunidades', 'pelo funil e acompanhe', 'o progresso das suas vendas.'],
  mascote_clientes: ['Clientes conectados', 'a crescimentos reais.'],
  mascote_atividades: ['Planeje, acompanhe', 'e não perca nenhuma', 'oportunidade.'],
  mascote_relatorios: ['Transforme dados', 'em oportunidades.'],
  mascote_inteligencia: ['Informação certa', 'para você vender mais.'],
  mascote_administracao: ['Tudo sob controle', 'para seu time vender mais.'],
};
