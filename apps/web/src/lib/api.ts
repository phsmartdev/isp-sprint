import type { Problem } from '@isp/shared';

export class ApiError extends Error {
  constructor(public status: number, public problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

const BASE = '/api/v1';

/** Única porta de saída HTTP do frontend. Cookie de sessão vai junto; nada de token em storage. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      // keepalive permite concluir o salvamento ao sair da página
      keepalive: init.keepalive,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, { type: 'network', title: 'Sem conexão', status: 0, detail: 'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.' });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // resposta que não é JSON (ex.: limite da hospedagem): mensagem legível em vez de erro técnico
    const detail = res.status === 413 ? 'Arquivo grande demais para enviar. Reduza o tamanho (até 3 MB) e tente de novo.'
      : res.status >= 500 ? 'O servidor não respondeu como esperado. Tente de novo em instantes.'
      : `Resposta inesperada do servidor (${res.status}).`;
    throw new ApiError(res.status || 0, { type: 'about:blank', title: 'Erro', status: res.status, detail });
  }
  if (!res.ok) {
    const problem: Problem = (data as Problem | undefined) ?? { type: 'about:blank', title: 'Erro', status: res.status };
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('isp:unauthorized'));
    throw new ApiError(res.status, problem);
  }
  return data as T;
}

export function qs(params: Record<string, string | number | undefined | null | false>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
