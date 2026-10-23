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
};

/** Como o GLPI: data local do servidor (aqui, Brasília), sem fuso. */
const now = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
const body = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const json = (res: ServerResponse, code: number, data: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
const filterBy = <T extends { name: string }>(list: T[], filter: string | null) => {
  const m = filter?.match(/^name=ilike="\*(.*)\*"$/);
  return m ? list.filter((x) => x.name.toLowerCase().includes(m[1]!.toLowerCase())) : list;
};

export async function startFakeGlpi(port = 0): Promise<FakeGlpi> {
  const tickets = new Map<number, Ticket>();
  const tokens = new Set<string>();
  let seq = 100, itemSeq = 500, failNext: number | null = null;

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
