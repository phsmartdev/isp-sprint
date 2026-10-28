/** IXC Provedor (somente leitura): teste de conexão, faturas e ordens de serviço da conta. */
import { and, eq, isNull } from 'drizzle-orm';
import { ixcInvoice, ixcInvoiceSummary, ixcOrder } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, notFound } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { ownerScope } from '../services/scope';
import { requireAction } from '../services/modules';
import { logEvent } from '../services/integrations';
import { IxcError, egressIp, ixcClientFor, ixcConfig, ixcList } from '../services/ixc';

async function via<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof IxcError) throw new AppError(e.status, 'Falha no IXC', e.message);
    throw e;
  }
}
async function visibleContact(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select({ id: s.contacts.id }).from(s.contacts)
    .where(and(eq(s.contacts.id, id), isNull(s.contacts.deletedAt), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt }))).limit(1);
  if (!c) throw notFound('Cliente não encontrado.');
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export const ixcRoutes = [
  defineRoute({
    method: 'POST', url: '/admin/integrations/ixc/test', summary: 'Confere endereço, usuário e token do IXC com uma consulta de leitura', tag: 'Integrações', module: 'configuracoes', min: 'total',
    handler: async ({ app, auth }) => {
      let c;
      try { c = (await ixcConfig(app.db, auth.tenantId, { requireEnabled: false }))!; } catch (e) { return { ok: false, message: (e as Error).message }; }
      // IP por onde o servidor saiu neste teste (para conferir a liberação no IXC; sem proxy, ele muda)
      const ip = await egressIp(c);
      const ipText = ip ? ` IP de saída neste teste: ${ip}${c.proxyUrl ? ' (proxy de IP fixo)' : ' (sem proxy, pode mudar na próxima consulta)'}.` : ' IP de saída: não foi possível identificar neste teste.';
      try {
        const r = await ixcList(c, 'cliente', { qtype: 'cliente.id', query: '0', oper: '>', rp: 1 });
        const message = `Conectado (somente leitura). O IXC tem ${r.total.toLocaleString('pt-BR')} cliente(s) cadastrados.${ipText}`;
        await logEvent(app.db, auth.tenantId, 'ixc', 'recebido', `Teste de conexão: ${message}`);
        return { ok: true, message, ip };
      } catch (e) {
        await logEvent(app.db, auth.tenantId, 'ixc', 'erro', `Teste de conexão: ${(e as Error).message}${ipText}`);
        return { ok: false, message: `${(e as Error).message}${ipText}`, ip };
      }
    },
  }),

  defineRoute({
    method: 'GET', url: '/contacts/:id/ixc/financeiro', summary: 'Faturas do cliente no IXC (contas a receber): em aberto, vencidas e recebidas', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await visibleContact(app.db, auth, params.id);
      requireAction(auth, 'ver_financeiro', 'As faturas do IXC mostram valores financeiros que seu perfil não vê.');
      const c = await ixcConfig(app.db, auth.tenantId);
      if (!c) return { enabled: false as const };
      return via(async () => {
        const client = await ixcClientFor(app.db, c, params.id);
        if (!client) return { enabled: true as const, client: null };
        const r = await ixcList(c, 'fn_areceber', { qtype: 'fn_areceber.id_cliente', query: client.id, rp: 60, sortname: 'fn_areceber.data_vencimento', sortorder: 'desc' });
        const t = today();
        const invoices = r.registros.map((x) => ixcInvoice(x, t)).filter((i) => i.status !== 'C' || i.valorCents > 0);
        return { enabled: true as const, client, total: r.total, invoices, summary: ixcInvoiceSummary(invoices), today: t };
      });
    },
  }),

  defineRoute({
    method: 'GET', url: '/contacts/:id/ixc/atendimentos', summary: 'Ordens de serviço do cliente no IXC, com assunto e situação', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await visibleContact(app.db, auth, params.id);
      const c = await ixcConfig(app.db, auth.tenantId);
      if (!c) return { enabled: false as const };
      return via(async () => {
        const client = await ixcClientFor(app.db, c, params.id);
        if (!client) return { enabled: true as const, client: null };
        const r = await ixcList(c, 'su_oss_chamado', { qtype: 'su_oss_chamado.id_cliente', query: client.id, rp: 40, sortname: 'su_oss_chamado.id', sortorder: 'desc' });
        const orders = r.registros.map(ixcOrder);
        // nome do assunto (até 15 assuntos diferentes por consulta)
        const ids = [...new Set(orders.map((o) => o.assuntoId).filter(Boolean) as string[])].slice(0, 15);
        const names = new Map<string, string>();
        for (const id of ids) {
          const a = await ixcList(c, 'su_oss_assunto', { qtype: 'su_oss_assunto.id', query: id, rp: 1 });
          if (a.registros[0]) names.set(id, String(a.registros[0].assunto ?? ''));
        }
        return { enabled: true as const, client, total: r.total, orders: orders.map((o) => ({ ...o, assunto: (o.assuntoId && names.get(o.assuntoId)) || null })), open: orders.filter((o) => o.aberta).length };
      });
    },
  }),
];
