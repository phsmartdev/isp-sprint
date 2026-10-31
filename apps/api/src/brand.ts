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
export type ServerBrand = { id: 'bkt' | 'yepnet'; app: string; company: string; defaultBranches: string[] };

const BRANDS: Record<ServerBrand['id'], ServerBrand> = {
  bkt: { id: 'bkt', app: 'RevOps', company: 'BKT', defaultBranches: ['BKT Soluções', 'UPNET'] },
  yepnet: { id: 'yepnet', app: 'ISP Sprint', company: 'Yepnet', defaultBranches: ['Yepnet'] },
};

export function serverBrand(env: NodeJS.ProcessEnv = process.env): ServerBrand {
  const id = (env.VITE_BRAND ?? env.BRAND) === 'yepnet' ? 'yepnet' : 'bkt';
  return BRANDS[id];
}

export const BRAND = serverBrand();
/** Nome da ferramenta nos textos automáticos ("Abrir no RevOps", "Aberto no ISP Sprint por…"). */
export const APP = BRAND.app;
