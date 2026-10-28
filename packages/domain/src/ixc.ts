/**
 * IXC Provedor — regras puras do conector de LEITURA (sem rede).
 *
 * Conferido na documentação oficial (wikiapiprovedor.ixcsoft.com.br, 28/10/2026) e na instância (401 Basic em /webservice/v1):
 *   POST https://HOST/webservice/v1/<tabela>
 *   Authorization: Basic base64("<id do usuário>:<token>")
 *   ixcsoft: listar            ← SEM este cabeçalho o mesmo POST INSERE um registro
 *   corpo: { qtype, query, oper, page, rp, sortname, sortorder }  → { page, total, registros: [...] }
 *
 * O token do IXC não tem modo "só leitura" (o usuário da API segue as permissões de um usuário comum).
 * Por isso a trava fica aqui: só a operação `listar`, só as tabelas abaixo, e nenhum outro método ou cabeçalho.
 */

export const IXC_READ_TABLES = ['cliente', 'cliente_contrato', 'fn_areceber', 'su_oss_chamado', 'su_oss_assunto'] as const;
export type IxcTable = (typeof IXC_READ_TABLES)[number];
export const IXC_OPERS = ['=', '>', '<', '>=', '<=', '!='] as const;
export type IxcOper = (typeof IXC_OPERS)[number];
export type IxcQuery = { qtype: string; query: string; oper: IxcOper; page: number; rp: number; sortname: string; sortorder: 'asc' | 'desc' };

/** Monta a requisição de leitura; recusa qualquer tabela, campo ou operador fora da lista. */
export function ixcListRequest(baseUrl: string, user: string, token: string, table: string, q: IxcQuery) {
  if (!(IXC_READ_TABLES as readonly string[]).includes(table)) throw new Error(`Tabela do IXC não liberada para leitura: ${table}`);
  if (!(IXC_OPERS as readonly string[]).includes(q.oper)) throw new Error(`Operador não permitido: ${q.oper}`);
  for (const f of [q.qtype, q.sortname]) if (!new RegExp(`^${table}\\.[a-z_0-9]+$`).test(f)) throw new Error(`Campo fora da tabela ${table}: ${f}`);
  if (!Number.isInteger(q.page) || q.page < 1 || !Number.isInteger(q.rp) || q.rp < 1 || q.rp > 200) throw new Error('Paginação inválida.');
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/webservice/v1/${table}`,
    init: {
      method: 'POST' as const,
      headers: { 'content-type': 'application/json', ixcsoft: 'listar', authorization: `Basic ${btoa(`${user}:${token}`)}` },
      body: JSON.stringify({ ...q, page: String(q.page), rp: String(q.rp) }),
    },
  };
}

/** Endereço salvo pode vir como a tela de login (https://ixc.empresa.com.br/app/login): fica só a origem. */
export function ixcOrigin(raw: string) {
  const u = new URL(raw.trim());
  return u.origin;
}

/** Valor do IXC ("1234.56" ou "1.234,56") em centavos. */
export function ixcCents(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
/** Data do IXC ("2026-10-28", "2026-10-28 10:00:00" ou "28/10/2026") em AAAA-MM-DD; vazia ou zerada = null. */
export function ixcDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('0000')) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

/** CPF/CNPJ como o IXC costuma guardar (com máscara) e só dígitos: tenta os dois na busca. */
export function ixcDocumentVariants(doc: string | null | undefined): string[] {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return [`${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`, d];
  if (d.length === 14) return [`${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`, d];
  return [];
}

// ------------------------------------------------------------------ faturas (fn_areceber)
export const IXC_INVOICE_STATUS: Record<string, string> = { A: 'A receber', R: 'Recebido', P: 'Parcial', C: 'Cancelado' };
export type IxcInvoice = {
  id: string; documento: string | null; contrato: string | null; emissao: string | null; vencimento: string | null; pagamento: string | null;
  status: string; statusLabel: string; valorCents: number; abertoCents: number; recebidoCents: number; vencida: boolean; diasAtraso: number;
};
export function ixcInvoice(r: Record<string, unknown>, today: string): IxcInvoice {
  const status = String(r.status ?? 'A');
  const valor = ixcCents(r.valor);
  const venc = ixcDate(r.data_vencimento);
  const aberto = status === 'C' || status === 'R' ? 0 : (r.valor_aberto !== undefined && r.valor_aberto !== '' ? ixcCents(r.valor_aberto) : valor);
  const vencida = aberto > 0 && !!venc && venc < today;
  return {
    id: String(r.id), documento: (r.documento as string) || null, contrato: (r.id_contrato as string) || null,
    emissao: ixcDate(r.data_emissao), vencimento: venc, pagamento: ixcDate(r.pagamento_data) ?? ixcDate(r.baixa_data),
    status, statusLabel: IXC_INVOICE_STATUS[status] ?? status, valorCents: valor, abertoCents: aberto,
    recebidoCents: status === 'C' ? 0 : ixcCents(r.valor_recebido) || (status === 'R' ? valor : 0), vencida,
    diasAtraso: vencida ? Math.round((Date.parse(today) - Date.parse(venc!)) / 86_400_000) : 0,
  };
}
export function ixcInvoiceSummary(list: IxcInvoice[]) {
  const open = list.filter((i) => i.abertoCents > 0);
  const late = open.filter((i) => i.vencida);
  return {
    abertoCents: open.reduce((t, i) => t + i.abertoCents, 0), abertas: open.length,
    vencidoCents: late.reduce((t, i) => t + i.abertoCents, 0), vencidas: late.length, maiorAtraso: Math.max(0, ...late.map((i) => i.diasAtraso)),
    recebidoCents: list.reduce((t, i) => t + i.recebidoCents, 0),
  };
}

// ------------------------------------------------------------------ ordens de serviço (su_oss_chamado)
export const IXC_OS_STATUS: Record<string, string> = { A: 'Aberta', AN: 'Análise', EN: 'Encaminhada', AS: 'Assumida', AG: 'Agendada', DS: 'Deslocamento', EX: 'Execução', F: 'Finalizada' };
export const IXC_OS_PRIORITY: Record<string, string> = { B: 'Baixa', N: 'Normal', A: 'Alta', C: 'Crítica' };
export type IxcOrder = { id: string; protocolo: string | null; assuntoId: string | null; status: string; statusLabel: string; prioridade: string | null; abertura: string | null; agenda: string | null; fechamento: string | null; mensagem: string | null; aberta: boolean };
export function ixcOrder(r: Record<string, unknown>): IxcOrder {
  const status = String(r.status ?? 'A');
  const p = String(r.prioridade ?? '');
  return {
    id: String(r.id), protocolo: (r.protocolo as string) || null, assuntoId: (r.id_assunto as string) || null, status, statusLabel: IXC_OS_STATUS[status] ?? status,
    prioridade: IXC_OS_PRIORITY[p] ?? null, abertura: ixcDate(r.data_abertura), agenda: ixcDate(r.data_agenda), fechamento: ixcDate(r.data_fechamento) ?? ixcDate(r.data_final),
    mensagem: r.mensagem ? String(r.mensagem).slice(0, 400) : null, aberta: status !== 'F',
  };
}
