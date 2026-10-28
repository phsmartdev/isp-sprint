/** Central de atenção dos contratos e o resumo diário por e-mail. */
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { audit } from '../services/audit';
import { contractScope, requireContractTab } from '../services/contracts';
import { attentionItems, attentionSummary, sendContractDigests } from '../services/contractAttention';

export const contractAttentionRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/attention', summary: 'Central de atenção: notificações, processos atrasados, validações e execução numa fila por gravidade, prazo e valor', tag: 'Contratos', module: 'contratos',
    query: z.object({ mine: z.enum(['0', '1']).default('0') }),
    handler: async ({ app, auth, query }) => {
      const today = new Date().toISOString().slice(0, 10);
      await requireContractTab(app.db, auth, 'atencao');
      let items = await attentionItems(app.db, auth.tenantId, contractScope(auth), today);
      if (query.mine === '1') items = items.filter((x) => x.ownerId === auth.userId || x.commercialOwnerId === auth.userId);
      return { items: items.slice(0, 500), summary: attentionSummary(items), today };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/digest/run', summary: 'Envia agora o resumo diário da central de atenção (uma vez por pessoa por dia)', tag: 'Contratos', module: 'contratos', min: 'total',
    handler: async ({ app, auth, req }) => {
      const r = await sendContractDigests(app.db, app.config, { tenantId: auth.tenantId });
      await audit(app.db, req, { action: 'contract.digest.run', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),
];
