/**
 * IXC Provedor — conector de LEITURA (regras e trava em packages/domain/src/ixc.ts).
 * Nunca insere, altera ou apaga: toda chamada passa por ixcListRequest (só `ixcsoft: listar`, só tabelas liberadas).
 * A conta do CRM encontra o cliente no IXC pelo código já ligado (IDs externos do sistema IXC) ou pelo CPF/CNPJ:
 * o do cadastro da conta ou, se vazio, o de um campo personalizado de cliente chamado CPF/CNPJ (ou CPF, CNPJ, documento).
 */
import { isIP } from 'node:net';
import { and, eq, ilike } from 'drizzle-orm';
import { ixcDocumentVariants, ixcListRequest, ixcOrigin, type IxcQuery, type IxcTable } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { decryptSecret } from './email';
import { integrationRow } from './integrations';
import { unprocessable } from '../http/errors';

export type IxcCfg = { tenantId: string; baseUrl: string; user: string; token: string };
export class IxcError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}
const isProd = () => process.env.NODE_ENV === 'production';

/** Em produção, só https e nunca rede interna (o servidor não pode ser usado para sondar a rede). */
export function assertIxcUrl(raw: string): string {
  let origin: string;
  try { origin = ixcOrigin(raw); } catch { throw unprocessable('Endereço do IXC inválido.', [{ path: 'baseUrl', message: 'Use o endereço completo, ex.: https://ixc.suaempresa.com.br' }]); }
  const u = new URL(origin);
  const host = u.hostname.toLowerCase();
  if (isProd()) {
    const privateHost = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
      || (isIP(host) === 4 && /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) || isIP(host) === 6;
    if (u.protocol !== 'https:') throw unprocessable('O IXC precisa estar em https.', [{ path: 'baseUrl', message: 'Endereço sem https' }]);
    if (privateHost) throw unprocessable('O IXC precisa estar acessível pela internet.', [{ path: 'baseUrl', message: 'Endereço interno não é alcançável pelo servidor' }]);
  }
  return origin;
}

export async function ixcConfig(db: DbOrTx, tenantId: string, opts: { requireEnabled?: boolean } = {}): Promise<IxcCfg | null> {
  const r = await integrationRow(db, tenantId, 'ixc');
  if ((opts.requireEnabled ?? true) && !r.enabled) return null;
  const token = r.secrets.token ? decryptSecret(r.secrets.token) : null;
  // com o token no formato do IXC ("6:código") o número do usuário já vem nele
  if (!r.config.baseUrl || !token || (!r.config.user && !/^\s*\d+:/.test(token))) {
    if (opts.requireEnabled === false) throw unprocessable('Integração com o IXC incompleta: informe endereço, usuário e token em Configurações → Integrações.');
    return null;
  }
  return { tenantId, baseUrl: assertIxcUrl(r.config.baseUrl), user: (r.config.user ?? '').trim(), token: token.trim() };
}

/** Uma página de uma tabela liberada. */
export async function ixcList(c: IxcCfg, table: IxcTable, q: Partial<IxcQuery> & Pick<IxcQuery, 'qtype' | 'query'>) {
  const req = ixcListRequest(c.baseUrl, c.user, c.token, table, { oper: '=', page: 1, rp: 50, sortname: `${table}.id`, sortorder: 'desc', ...q });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  let res: Response;
  try { res = await fetch(req.url, { ...req.init, redirect: 'manual', signal: ctl.signal }); }
  catch (e) { throw new IxcError((e as Error).name === 'AbortError' ? 'O IXC não respondeu a tempo.' : 'Não foi possível falar com o IXC (endereço fora do ar ou bloqueado para o servidor).'); }
  finally { clearTimeout(t); }
  if (res.status === 401) throw new IxcError('O IXC recusou o usuário/token (401). Confira: o Usuário/ID é o número do usuário do webservice (não o login); o token foi copiado inteiro do cadastro desse usuário; e o usuário tem “Permite acesso ao webservice” marcado.', 502);
  if (res.status === 404) throw new IxcError('A API do IXC não foi encontrada (404). Confira o endereço ou a liberação do webservice no servidor do IXC.', 502);
  if (!res.ok) throw new IxcError(`O IXC respondeu ${res.status}.`);
  const text = await res.text();
  let j: { total?: string | number; registros?: Record<string, unknown>[]; type?: string; message?: string };
  try { j = JSON.parse(text); } catch { throw new IxcError('O IXC respondeu algo que não é JSON (confira se o endereço aponta para o IXC).'); }
  if (j.type === 'error') throw new IxcError(`O IXC recusou a consulta: ${String(j.message ?? '').slice(0, 200)}`);
  return { total: Number(j.total ?? 0), registros: j.registros ?? [] };
}

/** Cliente do IXC ligado à conta: código já registrado (IDs externos do sistema IXC) ou busca pelo CPF/CNPJ. */
export async function ixcClientFor(db: DbOrTx, c: IxcCfg, contactId: string): Promise<{ id: string; name: string; via: 'codigo' | 'documento' } | null> {
  const [ct] = await db.select({ document: s.contacts.document, custom: s.contacts.custom, customerId: s.customers.id, externalId: s.customers.externalId, sourceSystem: s.customers.sourceSystem })
    .from(s.contacts).leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id)).where(and(eq(s.contacts.id, contactId), eq(s.contacts.tenantId, c.tenantId))).limit(1);
  if (!ct) return null;
  const linked = ct.customerId
    ? (await db.select({ externalId: s.customerExternalIds.externalId }).from(s.customerExternalIds).where(and(eq(s.customerExternalIds.customerId, ct.customerId), ilike(s.customerExternalIds.system, 'ixc%'))).limit(1))[0]?.externalId
      ?? (ct.sourceSystem?.toLowerCase().startsWith('ixc') ? ct.externalId : null)
    : null;
  if (linked && /^\d+$/.test(linked)) {
    const r = await ixcList(c, 'cliente', { qtype: 'cliente.id', query: linked, rp: 1 });
    const x = r.registros[0];
    if (x) return { id: String(x.id), name: String(x.razao ?? x.fantasia ?? ''), via: 'codigo' };
  }
  for (const doc of [...new Set((await documentsOf(db, c.tenantId, ct)).flatMap(ixcDocumentVariants))]) {
    const r = await ixcList(c, 'cliente', { qtype: 'cliente.cnpj_cpf', query: doc, rp: 2 });
    const x = r.registros[0];
    if (x) return { id: String(x.id), name: String(x.razao ?? x.fantasia ?? ''), via: 'documento' };
  }
  return null;
}

/** CPF/CNPJ da conta: o do cadastro e, depois, o de campos personalizados de cliente com CPF, CNPJ ou documento no nome. */
async function documentsOf(db: DbOrTx, tenantId: string, ct: { document: string | null; custom: Record<string, unknown> | null }) {
  const fields = await db.select({ key: s.customerFields.key, label: s.customerFields.label }).from(s.customerFields).where(eq(s.customerFields.tenantId, tenantId));
  const docFields = fields.filter((f) => /cpf|cnpj|documento/i.test(`${f.label} ${f.key}`));
  return [ct.document, ...docFields.map((f) => ct.custom?.[f.key])].map((v) => (typeof v === 'number' ? String(v) : v)).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
