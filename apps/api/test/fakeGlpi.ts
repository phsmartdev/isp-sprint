/**
 * GLPI 11 SIMULADO para testes (API de alto nível /api.php + webhook nativo). Não é usado em produção.
 * Segue o formato do código-fonte do GLPI 11.0: token OAuth por senha, entidades/grupos/categorias com filtro RSQL
 * `name=ilike="*x*"`, chamado com status { id, name }, linha do tempo [{ type, item }] e webhook assinado
 * (X-GLPI-signature = HMAC-SHA256(corpo + X-GLPI-timestamp)) sem Content-Type, como o Guzzle envia.
 * Ganchos de teste em /__test/* para o "técnico" responder, solucionar e disparar o webhook.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

type TL = { type: 'Followup' | 'Task' | 'Solution' | 'Document' | 'Validation'; item: Record<string, unknown> };
type Ticket = { id: number; name: string; content: string; type: number; urgency: number; entity: number; category: number | null; status: number; date_mod: string; date_solve: string | null; date_close: string | null; timeline: TL[]; team: { type: string; id: number; role: string }[] };

export const GLPI_CREDS = { clientId: 'isp-sprint', clientSecret: 'glpi-secret', username: 'integracao', password: 'Integra@2026' };
const ENTITIES = [{ id: 0, name: 'Raiz', completename: 'Raiz' }, { id: 3, name: 'Prefeitura de Lagarto', completename: 'Raiz > Clientes > Prefeitura de Lagarto' }, { id: 4, name: 'Hospital São Lucas', completename: 'Raiz > Clientes > Hospital São Lucas' }];
const CATEGORIES = [{ id: 7, name: 'Link dedicado', completename: 'Rede > Link dedicado' }, { id: 8, name: 'Instalação', completename: 'Campo > Instalação' }];
const GROUPS = [{ id: 11, name: 'NOC', completename: 'NOC' }, { id: 12, name: 'Campo', completename: 'Campo' }];
const STATUS: Record<number, string> = { 1: 'Novo', 2: 'Em atendimento (atribuído)', 3: 'Em atendimento (planejado)', 4: 'Pendente', 5: 'Solucionado', 6: 'Fechado' };

export type FakeGlpi = {
  url: string;
  close: () => Promise<void>;
  tickets: Map<number, Ticket>;
  /** O técnico responde/age no GLPI; com `hook`, dispara o webhook assinado como o GLPI faz. */
  act: (ticketId: number, a: { kind: 'followup' | 'task' | 'solution' | 'status' | 'validation'; text?: string; status?: number; isPrivate?: boolean; toOther?: boolean }, hook?: { url: string; secret: string; badSignature?: boolean }) => Promise<number | null>;
  failNext: (status: number) => void;
  /** Arquivos recebidos pela API REST clássica (/apirest.php), com o chamado a que foram ligados. */
  documents: { id: number; name: string; bytes: number; entityId: number | null; ticketId: number | null }[];
};

/** Como o GLPI: data local do servidor (aqui, Brasília), sem fuso. */
const now = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
const body = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const json = (res: ServerResponse, code: number, data: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
const filterBy = <T extends { name: string }>(list: T[], filter: string | null) => {
  const m = filter?.match(/^name=ilike="\*(.*)\*"$/);
  return m ? list.filter((x) => x.name.toLowerCase().includes(m[1]!.toLowerCase())) : list;
};

/** `firstTicketId`: numeração própria por suíte, para chamados de suítes diferentes não colidirem no banco de teste. */
export async function startFakeGlpi(port = 0, opts: { firstTicketId?: number } = {}): Promise<FakeGlpi> {
  const tickets = new Map<number, Ticket>();
  const tokens = new Set<string>();
  let seq = (opts.firstTicketId ?? 101) - 1, itemSeq = 500, failNext: number | null = null;
  const documents: FakeGlpi['documents'] = [];
  const sessions = new Map<string, number | null>();

  async function sendHook(item: Record<string, unknown>, hook: { url: string; secret: string; badSignature?: boolean }) {
    const payload = JSON.stringify({ event: 'new', item }, null, 4);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', hook.secret).update(payload + ts).digest('hex');
    const r = await fetch(hook.url, { method: 'POST', headers: { 'X-GLPI-signature': hook.badSignature ? 'f'.repeat(64) : sig, 'X-GLPI-timestamp': ts }, body: Buffer.from(payload) }); // como o Guzzle: sem Content-Type
    return r.status;
  }

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const p = u.pathname;
    const raw = await body(req);
    try {
      if (p === '/__test/health') return json(res, 200, { ok: true, tickets: tickets.size });
      if (p.startsWith('/__test/tickets/') && req.method === 'POST') {
        const id = Number(p.split('/')[3]);
        const a = JSON.parse(raw || '{}');
        const code = await api.act(id, a, a.hook);
        return json(res, 200, { ok: true, hookStatus: code });
      }
      if (p === '/api.php/token' && req.method === 'POST') {
        const f = new URLSearchParams(raw);
        if (f.get('client_id') !== GLPI_CREDS.clientId || f.get('client_secret') !== GLPI_CREDS.clientSecret) return json(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed' });
        if (f.get('grant_type') !== 'password' || f.get('username') !== GLPI_CREDS.username || f.get('password') !== GLPI_CREDS.password) return json(res, 400, { error: 'invalid_grant' });
        const tk = randomBytes(12).toString('hex');
        tokens.add(tk);
        return json(res, 200, { token_type: 'Bearer', expires_in: 3600, access_token: tk, refresh_token: 'r' });
      }
      // API REST clássica: só o que o anexo de arquivo usa
      if (p.startsWith('/apirest.php/')) {
        const rp = p.slice('/apirest.php'.length);
        if (rp === '/initSession') {
          if (req.headers['app-token'] && req.headers['app-token'] !== 'app-token-ok') return json(res, 400, ['ERROR_WRONG_APP_TOKEN_PARAMETER', 'Parâmetro app_token incorreto']);
          const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
          if (basic !== `${GLPI_CREDS.username}:${GLPI_CREDS.password}`) return json(res, 401, ['ERROR_GLPI_LOGIN', 'Usuário ou senha incorretos']);
          const tk = randomBytes(8).toString('hex'); sessions.set(tk, null);
          return json(res, 200, { session_token: tk });
        }
        const st = String(req.headers['session-token'] ?? '');
        if (!sessions.has(st)) return json(res, 401, ['ERROR_SESSION_TOKEN_INVALID', 'session_token inválido']);
        if (rp === '/changeActiveEntities' && req.method === 'POST') { sessions.set(st, JSON.parse(raw).entities_id); return json(res, 200, true); }
        if (rp === '/Document' && req.method === 'POST') {
          const m = raw.match(/name="uploadManifest"\r\n\r\n(\{.*?\})\r\n/s);
          if (!m || !/name="filename\[0\]"/.test(raw)) return json(res, 400, ['ERROR_UPLOAD_FILE_TOO_BIG_POST_MAX_SIZE', 'arquivo ausente']);
          const id = ++itemSeq; documents.push({ id, name: JSON.parse(m[1]!).input.name, bytes: raw.length, entityId: sessions.get(st) ?? null, ticketId: null });
          return json(res, 201, { id, message: 'Item adicionado' });
        }
        if (rp === '/Document_Item' && req.method === 'POST') {
          const i = JSON.parse(raw).input;
          const d = documents.find((x) => x.id === i.documents_id);
          if (!d || i.itemtype !== 'Ticket' || !tickets.has(i.items_id)) return json(res, 400, ['ERROR_GLPI_ADD', 'ligação inválida']);
          d.ticketId = i.items_id; return json(res, 201, { id: ++itemSeq });
        }
        if (rp === '/killSession') { sessions.delete(st); return json(res, 200, true); }
        return json(res, 404, ['ERROR_RESOURCE_NOT_FOUND_NOR_COMMONDBTM', '']);
      }
      if (!p.startsWith('/api.php/')) return json(res, 404, { status: 'ERROR_ROUTE_NOT_FOUND' });
      const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!tokens.has(auth)) return json(res, 401, { status: 'ERROR_UNAUTHENTICATED', title: 'You are not authenticated' });
      if (failNext) { const c = failNext; failNext = null; return json(res, c, { status: 'ERROR', title: 'Falha simulada', detail: 'Erro simulado pelo teste' }); }
      const path = p.slice('/api.php'.length);
      if (req.method === 'GET' && path === '/Administration/Entity') return json(res, 200, filterBy(ENTITIES, u.searchParams.get('filter')));
      if (req.method === 'GET' && path === '/Administration/Group') return json(res, 200, filterBy(GROUPS, u.searchParams.get('filter')));
      if (req.method === 'GET' && path === '/Dropdowns/ITILCategory') return json(res, 200, filterBy(CATEGORIES, u.searchParams.get('filter')));
      if (req.method === 'POST' && path === '/Assistance/Ticket') {
        const b = JSON.parse(raw);
        // como no GLPI 11: `entity` é somente leitura no corpo; vale a entidade ativa (cabeçalho GLPI-Entity, padrão a raiz 0)
        const hdr = req.headers['glpi-entity'];
        const entity = hdr === undefined ? 0 : Number(hdr);
        if (!b.name || !b.content || !ENTITIES.some((e) => e.id === entity)) return json(res, 400, { status: 'ERROR_INVALID_PARAMETER', title: 'Invalid input parameters', detail: 'entity' });
        const id = ++seq;
        tickets.set(id, { id, name: b.name, content: b.content, type: b.type, urgency: b.urgency, entity, category: b.category ?? null, status: 1, date_mod: now(), date_solve: null, date_close: null, timeline: [], team: [] });
        return json(res, 201, { id, href: `/Assistance/Ticket/${id}` }, { Location: `/Assistance/Ticket/${id}` });
      }
      const m = path.match(/^\/Assistance\/Ticket\/(\d+)(\/.*)?$/);
      if (m) {
        const t = tickets.get(Number(m[1]));
        // como no GLPI 11: só se enxerga o chamado na entidade ativa da sessão (cabeçalho GLPI-Entity; sem ele, a padrão do usuário = raiz, não recursiva)
        const active = req.headers['glpi-entity'] === undefined ? 0 : Number(req.headers['glpi-entity']);
        if (!t || t.entity !== active) return json(res, 404, { status: 'ERROR_ITEM_NOT_FOUND', title: 'Item not found' });
        const sub = m[2] ?? '';
        if (req.method === 'GET' && sub === '') {
          const ent = ENTITIES.find((e) => e.id === t.entity)!;
          return json(res, 200, { id: t.id, name: t.name, content: t.content, type: t.type, urgency: t.urgency, status: { id: t.status, name: STATUS[t.status] }, entity: { id: ent.id, name: ent.name, completename: ent.completename }, category: t.category ? { id: t.category, name: CATEGORIES.find((c) => c.id === t.category)?.name } : null, date_mod: t.date_mod, date_solve: t.date_solve, date_close: t.date_close });
        }
        if (req.method === 'GET' && sub === '/Timeline') return json(res, 200, t.timeline);
        if (req.method === 'POST' && sub === '/Timeline/Followup') {
          const b = JSON.parse(raw);
          const id = ++itemSeq;
          t.timeline.push({ type: 'Followup', item: { id, itemtype: 'Ticket', items_id: t.id, content: b.content, is_private: !!b.is_private, user: { id: 9, name: GLPI_CREDS.username }, date: now() } });
          t.date_mod = now();
          return json(res, 201, { id, href: `/Assistance/Ticket/${t.id}/Timeline/Followup/${id}` });
        }
        const vm = sub.match(/^\/Timeline\/Validation\/(\d+)$/);
        if (req.method === 'GET' && vm) {
          const v = t.timeline.find((x) => x.type === 'Validation' && x.item.id === Number(vm[1]));
          return v ? json(res, 200, v.item) : json(res, 404, { status: 'ERROR_ITEM_NOT_FOUND', title: 'Item not found' });
        }
        if (req.method === 'PATCH' && vm) {
          // como no GLPI 11: só quem foi indicado como aprovador (usuário ou grupo) responde a validação
          const v = t.timeline.find((x) => x.type === 'Validation' && x.item.id === Number(vm[1]));
          if (!v) return json(res, 404, { status: 'ERROR_ITEM_NOT_FOUND', title: 'Item not found' });
          const b = JSON.parse(raw);
          // como no GLPI 11: quem não é o aprovador indicado tem a situação descartada em silêncio, e a resposta ainda é 200
          if (v.item.requested_approver_id !== 9) return json(res, 200, { id: v.item.id });
          if (![3, 4].includes(b.status)) return json(res, 400, { status: 'ERROR_INVALID_PARAMETER', title: 'Invalid input parameters' });
          Object.assign(v.item, { status: b.status, approval_comment: b.approval_comment ?? null, approver: { id: 9, name: GLPI_CREDS.username }, approval_date: now() });
          t.date_mod = now();
          return json(res, 200, { id: v.item.id });
        }
        if (req.method === 'POST' && sub === '/TeamMember') {
          const b = JSON.parse(raw);
          if (!GROUPS.some((g) => g.id === b.id)) return json(res, 400, { status: 'ERROR_INVALID_PARAMETER', title: 'Invalid input parameters' });
          t.team.push({ type: b.type, id: b.id, role: b.role });
          if (t.status === 1) t.status = 2;
          return json(res, 200, t.team);
        }
      }
      return json(res, 404, { status: 'ERROR_ROUTE_NOT_FOUND' });
    } catch (e) {
      return json(res, 500, { status: 'ERROR', title: (e as Error).message });
    }
  });

  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`;

  const api: FakeGlpi = {
    url,
    tickets,
    close: () => new Promise((ok) => server.close(() => ok())),
    failNext: (status) => { failNext = status; },
    documents,
    act: async (ticketId, a, hook) => {
      const t = tickets.get(ticketId);
      if (!t) throw new Error(`chamado ${ticketId} não existe no GLPI simulado`);
      const id = ++itemSeq;
      let item: Record<string, unknown>;
      if (a.kind === 'status') {
        t.status = a.status ?? 2;
        t.date_mod = now();
        item = { id: t.id, name: t.name, status: { id: t.status, name: STATUS[t.status] }, date_mod: t.date_mod };
      } else if (a.kind === 'solution') {
        t.status = 5; t.date_solve = now(); t.date_mod = now();
        item = { id, itemtype: 'Ticket', items_id: t.id, content: `<p>${a.text ?? 'Resolvido'}</p>`, user: { id: 5, name: 'Técnico NOC' }, date_creation: now() };
        t.timeline.push({ type: 'Solution', item });
      } else if (a.kind === 'validation') {
        item = { id, tickets_id: t.id, status: 2, submission_comment: `<p>${a.text ?? 'Aprovar'}</p>`, requester: { id: 5, name: 'Técnico NOC' }, requested_approver_type: 'User', requested_approver_id: a.toOther ? 7 : 9, submission_date: now() };
        t.timeline.push({ type: 'Validation', item });
        t.date_mod = now();
      } else {
        const type = a.kind === 'task' ? 'Task' : 'Followup';
        item = type === 'Task'
          ? { id, tickets_id: t.id, content: `<p>${a.text ?? ''}</p>`, is_private: !!a.isPrivate, user_tech: { id: 5, name: 'Técnico NOC' }, date: now() }
          : { id, itemtype: 'Ticket', items_id: t.id, content: `<p>${a.text ?? ''}</p>`, is_private: !!a.isPrivate, user: { id: 5, name: 'Técnico NOC' }, date: now() };
        t.timeline.push({ type, item });
        if (t.status === 1) t.status = 2;
        t.date_mod = now();
      }
      return hook ? sendHook(item, hook) : null;
    },
  };
  return api;
}
