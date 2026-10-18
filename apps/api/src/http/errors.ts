import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Problem } from '@isp/shared';

export class AppError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
    public extra: Partial<Problem> = {},
  ) {
    super(detail ?? title);
  }
}

export const unauthorized = () => new AppError(401, 'Não autenticado', 'Faça login para continuar.');
export const forbidden = (detail = 'Você não tem permissão para esta ação.') => new AppError(403, 'Acesso negado', detail);
/** Também usado para recursos de outro tenant: não revela existência. */
export const notFound = (detail = 'Registro não encontrado.') => new AppError(404, 'Não encontrado', detail);
export const conflict = (currentRowVersion: number) =>
  new AppError(409, 'Conflito de versão', 'Este registro foi alterado por outra pessoa. Recarregue para ver a versão atual.', { currentRowVersion });
export const unprocessable = (detail: string, errors?: Problem['errors']) => new AppError(422, 'Dados inválidos', detail, { errors });

export function zodToProblemErrors(e: ZodError): NonNullable<Problem['errors']> {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function sendProblem(reply: FastifyReply, req: FastifyRequest, p: Omit<Problem, 'requestId' | 'type'> & { type?: string }) {
  const body: Problem = { type: p.type ?? 'about:blank', requestId: String(req.id), ...p };
  return reply.code(p.status).header('content-type', 'application/problem+json; charset=utf-8').send(body);
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return sendProblem(reply, req, { status: err.status, title: err.title, detail: err.detail, ...err.extra });
  }
  if (err instanceof ZodError) {
    return sendProblem(reply, req, { status: 422, title: 'Dados inválidos', detail: 'Revise os campos destacados.', errors: zodToProblemErrors(err) });
  }
  const fe = err as FastifyError;
  if (fe.statusCode === 429) return sendProblem(reply, req, { status: 429, title: 'Muitas requisições', detail: 'Aguarde um instante e tente novamente.' });
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return sendProblem(reply, req, { status: fe.statusCode, title: 'Requisição inválida', detail: fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Envie JSON.' : 'Requisição inválida.' });
  }
  // Postgres: violação de unicidade / FK → mensagens genéricas, sem vazar SQL
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') return sendProblem(reply, req, { status: 409, title: 'Registro duplicado', detail: 'Já existe um registro com estes dados.' });
  if (pgCode === '23503' || pgCode === '23514') return sendProblem(reply, req, { status: 422, title: 'Dados inválidos', detail: 'Referência ou valor não permitido.' });
  const msg = String(err.message ?? '');
  if (/max clients|too many clients|remaining connection slots|Connection terminated|ECONNRESET|timeout exceeded when trying to connect/i.test(msg)) {
    req.log.warn({ err }, 'banco sem conexão disponível');
    reply.header('retry-after', '2');
    return sendProblem(reply, req, { status: 503, title: 'Banco ocupado', detail: 'O banco de dados está sem conexões livres no momento. Tente de novo em alguns segundos.' });
  }
  req.log.error({ err }, 'erro não tratado');
  // Gerência (Configurações = total) vê a causa técnica para diagnosticar sem acesso aos logs.
  const auth = (req as { auth?: { access?: Record<string, string> } | null }).auth;
  const diagnostic = auth?.access?.configuracoes === 'total' ? `${pgCode ? `[${pgCode}] ` : ''}${String(err.message ?? '').slice(0, 300)}` : undefined;
  return sendProblem(reply, req, { status: 500, title: 'Erro interno', detail: 'Algo deu errado. Informe o código da requisição ao suporte.', ...(diagnostic ? { diagnostic } : {}) });
}
