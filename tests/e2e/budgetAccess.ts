import type { Page } from '@playwright/test';

/**
 * Orçamento (regra de 26/11/2026): fora da Diretoria, só vê os valores de um centro quem está nele. Nos testes de tela,
 * a Gerência (Carlos) entra como diretor responsável dos centros que ainda não têm um — como a gestão faria no cadastro.
 */
export async function joinCostCenters(page: Page) {
  const headers = { origin: new URL(page.url()).origin };
  const me = (await (await page.request.get('/api/v1/me')).json()).user.id as string;
  const st = await (await page.request.get('/api/v1/budget/structure')).json();
  for (const c of (st.allCostCenters ?? []) as { id: string; directorId: string | null }[]) {
    if (!c.directorId) await page.request.patch(`/api/v1/budget/cost-centers/${c.id}`, { headers, data: { directorId: me } });
  }
}
