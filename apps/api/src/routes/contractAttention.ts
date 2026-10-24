/** Central de atenção dos contratos e o resumo diário por e-mail. */
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { audit } from '../services/audit';
import { contractScope, hasSector } from '../services/contracts';
import { attentionItems, attentionSummary, sendContractDigests } from '../services/contractAttention';

const COMPANY_SECTORS = ['administracao', 'inteligencia_comercial', 'diretoria', 'juridico', 'financeiro'] as const;

export const contractAttentionRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/attention', summary: 'Central de atenção: notificações, processos atrasados, validações e habilitação numa fila por gravidade, prazo e valor', tag: 'Contratos', module: 'contratos',
    query: z.object({ mine: z.enum(['0', '1']).default('0') }),
    handler: async ({ app, auth, query }) => {
      const today = new Date().toISOString().slice(0, 10);
      const company = hasSector(auth, COMPANY_SECTORS);
      let items = await attentionItems(app.db, auth.tenantId, contractScope(auth), today, { company });
      if (query.mine === '1') items = items.filter((x) => x.ownerId === auth.userId || (x.source !== 'habilitacao' && x.commercialOwnerId === auth.userId) || (x.source === 'habilitacao' && company));
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
