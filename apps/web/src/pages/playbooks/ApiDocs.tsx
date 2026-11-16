/**
 * Wiki → API de integração: guia para desenvolvedores de outros sistemas inserirem e coletarem dados.
 * O guia mostra os casos mais comuns; a referência completa sai do OpenAPI gerado pelas próprias rotas
 * (nunca fica desatualizada). Acesso: usuário de webservice + token (Configurações → Webservice (API)).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, Input, LoadingRows, Select } from '../../components/ui/primitives';

const BASE = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1`;
const TOKEN = 'isk_SEU_TOKEN';

const SECTIONS = [
  ['visao', 'Visão geral'],
  ['autenticacao', 'Autenticação'],
  ['primeiro', 'Testar a conexão'],
  ['inserir', 'Inserir dados'],
  ['coletar', 'Coletar dados'],
  ['paginacao', 'Paginação e filtros'],
  ['erros', 'Erros'],
  ['seguranca', 'Segurança e limites'],
  ['referencia', 'Referência completa'],
] as const;

// ------------------------------------------------------------------ blocos de código
function curl(method: string, path: string, body?: unknown) {
  const lines = [`curl${method === 'GET' ? '' : ` -X ${method}`} "${BASE}${path}"`, `  -H "Authorization: Bearer ${TOKEN}"`];
  if (body !== undefined) lines.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}'`);
  return lines.join(' \\\n');
}
function js(method: string, path: string, body?: unknown) {
  return [
    `const res = await fetch("${BASE}${path}", {`,
    ...(method !== 'GET' ? [`  method: "${method}",`] : []),
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.BKT_REVOPS_TOKEN}\`,`,
    ...(body !== undefined ? [`    "Content-Type": "application/json",`] : []),
    `  },`,
    ...(body !== undefined ? [`  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}),`] : []),
    `});`,
    `if (!res.ok) throw new Error((await res.json()).detail);`,
    `const data = await res.json();`,
  ].join('\n');
}
function python(method: string, path: string, body?: unknown) {
  return [
    'import os, requests',
    '',
    `r = requests.${method.toLowerCase()}(`,
    `    "${BASE}${path}",`,
    `    headers={"Authorization": f"Bearer {os.environ['BKT_REVOPS_TOKEN']}"},`,
    ...(body !== undefined ? [`    json=${JSON.stringify(body, null, 4).replace(/\n/g, '\n    ').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')},`] : []),
    `    timeout=30,`,
    ')',
    'r.raise_for_status()',
    'data = r.json()',
  ].join('\n');
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-white/70 hover:text-white" aria-label="Copiar código">
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden border border-[#2A323B] bg-[#1B2026]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1"><span className="text-xs text-white/50">{label ?? ''}</span><CopyButton text={children} /></div>
      <pre className="scroll-thin overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-[#E6EDF3]"><code>{children}</code></pre>
    </div>
  );
}

const LANGS = [['curl', 'cURL'], ['js', 'JavaScript'], ['py', 'Python']] as const;
type Lang = (typeof LANGS)[number][0];

/** Exemplo de chamada em três linguagens, com a resposta. */
function Example({ method, path, body, response, lang, setLang }: { method: string; path: string; body?: unknown; response?: unknown; lang: Lang; setLang: (l: Lang) => void }) {
  const code = lang === 'curl' ? curl(method, path, body) : lang === 'js' ? js(method, path, body) : python(method, path, body);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm"><Method m={method} /> <span className="text-ink">/api/v1{path}</span></p>
        <div className="flex border border-line" role="tablist" aria-label="Linguagem do exemplo">
          {LANGS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={lang === k} onClick={() => setLang(k)} className={clsx('px-2.5 py-1 text-xs font-semibold', lang === k ? 'bg-ink text-white' : 'bg-surface text-muted hover:text-ink')}>{l}</button>)}
        </div>
      </div>
      <Code label="Requisição">{code}</Code>
      {response !== undefined && <Code label="Resposta">{JSON.stringify(response, null, 2)}</Code>}
    </div>
  );
}

const METHOD_TONE: Record<string, string> = { GET: 'text-[#2E8B57]', POST: 'text-primary', PATCH: 'text-[#B7791F]', PUT: 'text-[#B7791F]', DELETE: 'text-danger' };
function Method({ m }: { m: string }) {
  return <span className={clsx('inline-block w-14 font-mono text-xs font-bold', METHOD_TONE[m.toUpperCase()] ?? 'text-muted')}>{m.toUpperCase()}</span>;
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 border-b border-line pb-2 text-xl font-bold text-ink">{children}</h2>;
}
const P = ({ children }: { children: ReactNode }) => <p className="text-base leading-relaxed text-text">{children}</p>;
const C = ({ children }: { children: ReactNode }) => <code className="bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-ink">{children}</code>;

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-surface-2 text-left text-xs text-muted"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="px-3 py-2 text-text">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ página
export function ApiDocsPage() {
  const { me } = useAuth();
  const isAdmin = me?.access?.configuracoes === 'total';
  const [lang, setLang] = useState<Lang>('curl');
  const ex = { lang, setLang };
  return (
    <div className="w-full">
      <p className="text-sm text-muted"><Link to="/playbooks" className="text-primary hover:underline">Central de Playbooks</Link> / API de integração</p>
      <header className="mt-1 border-b border-line pb-5">
        <h1 className="font-display text-3xl font-bold text-ink">API de integração</h1>
        <p className="mt-2 max-w-3xl text-base text-text">Para desenvolvedores de outros sistemas (ERP, site, BI, atendimento) inserirem e coletarem dados no BKT RevOps, com segurança e com as mesmas regras de quem usa a tela.</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-muted">Endereço base: <C>{BASE}</C></span>
          <span className="text-muted">Formato: <C>JSON</C></span>
          <span className="text-muted">Versão: <C>v1</C></span>
        </div>
      </header>

      <div className="mt-6 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seções" className="hidden lg:block">
          <ol className="sticky top-24 space-y-1 border-l border-line text-sm">
            {SECTIONS.map(([id, l]) => <li key={id}><a href={`#${id}`} className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-muted hover:border-primary hover:text-ink">{l}</a></li>)}
          </ol>
        </nav>

        <article className="min-w-0 max-w-4xl space-y-10">
          <section className="space-y-3">
            <H2 id="visao">Visão geral</H2>
            <P>A API usa um <strong>usuário de webservice</strong>: um usuário da ferramenta criado só para a integração, que não entra pela tela. Ele se identifica por um <strong>token</strong> e enxerga e grava exatamente o que o <strong>perfil</strong> dele permite, como qualquer pessoa da equipe.</P>
            <ol className="grid gap-3 sm:grid-cols-3">
              {[
                ['1', 'Cadastre o usuário', 'Em Configurações → Webservice (API), um usuário por sistema, com o perfil de acesso.'],
                ['2', 'Gere o token', 'O token aparece uma única vez. Entregue ao desenvolvedor por um canal seguro.'],
                ['3', 'Integre', 'O sistema envia o token em cada chamada e usa os endereços desta página.'],
              ].map(([n, t, d]) => (
                <li key={n} className="border border-line bg-surface p-4"><span className="font-display text-sm font-bold text-primary">{n!.padStart(2, '0')}</span><p className="mt-1 font-semibold text-ink">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></li>
              ))}
            </ol>
            {isAdmin && <p className="text-sm"><Link to="/settings/webservice" className="font-semibold text-primary hover:underline">Gerenciar usuários de webservice e tokens</Link></p>}
          </section>

          <section className="space-y-3">
            <H2 id="autenticacao">Autenticação</H2>
            <P>Envie o token no cabeçalho <C>Authorization</C> de <strong>todas</strong> as requisições, no formato Bearer. Os tokens começam com <C>isk_</C>.</P>
            <Code label="Cabeçalho">{`Authorization: Bearer ${TOKEN}`}</Code>
            <ul className="list-disc space-y-1 pl-5 text-base text-text">
              <li>Corpo das requisições em JSON, com <C>Content-Type: application/json</C>.</li>
              <li>O acesso segue o perfil do usuário de webservice (Configurações → Permissões). <strong>Configurações nunca ficam disponíveis pela API</strong>, mesmo com perfil de gerência.</li>
              <li>Token revogado, vencido ou de usuário desativado responde <C>401</C> na hora.</li>
              <li>Tudo o que a integração gravar fica registrado em nome do usuário de webservice (histórico e auditoria).</li>
            </ul>
          </section>

          <section className="space-y-3">
            <H2 id="primeiro">Testar a conexão</H2>
            <P>Confira se o token funciona e qual usuário ele representa:</P>
            <Example method="GET" path="/me" response={{ user: { id: '1247e394-…', name: 'Integração ERP', jobTitle: 'Webservice' }, access: { leads: 'total', oportunidades: 'total', clientes: 'total', contratos: 'total', configuracoes: 'nenhum', '…': '…' } }} {...ex} />
            <p className="text-xs text-muted">Respostas encurtadas (…) para leitura; os campos completos estão na referência.</p>
          </section>

          <section className="space-y-6">
            <H2 id="inserir">Inserir dados</H2>
            <div className="space-y-2">
              <h3 className="text-md font-bold text-ink">Criar um lead</h3>
              <P>Cria o lead e o contato. Sem <C>ownerId</C>, o lead fica com o usuário de webservice e pode ser distribuído depois pela equipe. <C>segment</C>: residencial, empresarial, governamental ou institucional.</P>
              <Example method="POST" path="/leads" body={{ name: 'Prefeitura de Exemplo', phone: '79999990000', email: 'contato@exemplo.gov.br', segment: 'governamental', city: 'Aracaju', channel: 'site', notes: 'Pediu proposta de link dedicado' }} response={{ id: 'af6f5fa4-…', status: 'novo', name: 'Prefeitura de Exemplo', phone: '79999990000', segment: 'governamental', city: 'Aracaju', channel: 'site', contactId: '8a8a9834-…', ownerId: '1247e394-…', ownerName: 'Integração ERP', createdAt: '2026-11-14T17:55:46.378Z', rowVersion: 1, '…': '…' }} {...ex} />
            </div>
            <div className="space-y-2">
              <h3 className="text-md font-bold text-ink">Cadastrar um cliente</h3>
              <P>Se o CNPJ/CPF em <C>document</C> já existir na empresa, a criação é recusada (<C>422</C>) para não duplicar.</P>
              <Example method="POST" path="/contacts" body={{ name: 'Empresa Exemplo Ltda', document: '00.000.000/0001-00', phone: '7932110000', segment: 'empresarial', address: { postalCode: '49000-000', street: 'Rua Exemplo', number: '100', district: 'Centro', city: 'Aracaju', state: 'SE' } }} {...ex} />
            </div>
            <div className="space-y-2">
              <h3 className="text-md font-bold text-ink">Registrar uma atividade</h3>
              <P>Ligue a atividade a um lead, contato ou oportunidade. <C>type</C>: tarefa, ligacao, reuniao, email, whatsapp ou visita. Datas no formato ISO 8601.</P>
              <Example method="POST" path="/activities" body={{ type: 'ligacao', title: 'Retornar sobre a proposta', dueAt: '2026-11-20T14:00:00-03:00', contactId: '8a8a9834-…', notes: 'Registrado pelo ERP' }} {...ex} />
            </div>
          </section>

          <section className="space-y-6">
            <H2 id="coletar">Coletar dados</H2>
            <div className="space-y-2">
              <h3 className="text-md font-bold text-ink">Listar leads</h3>
              <Example method="GET" path="/leads?status=qualificado&page=1&pageSize=100" response={{ items: [{ id: 'af6f5fa4-…', status: 'qualificado', name: 'Prefeitura de Exemplo', segment: 'governamental', city: 'Aracaju', ownerName: 'Ana', createdAt: '2026-11-14T17:55:46.378Z', '…': '…' }], page: 1, pageSize: 100, total: 1 }} {...ex} />
            </div>
            <Table head={['Dado', 'Endereço', 'Observação']} rows={[
              [<strong key="o">Oportunidades</strong>, <C key="1">GET /opportunities</C>, 'Filtros por etapa, funil, responsável e período (from/to).'],
              [<strong key="c">Clientes</strong>, <C key="2">GET /customers</C>, 'Carteira com plano, situação e contrato.'],
              [<strong key="t">Contratos</strong>, <C key="3">GET /contracts</C>, 'Vigência, valor, dias restantes e próxima ação.'],
              [<strong key="a">Atividades</strong>, <C key="4">GET /activities</C>, 'Agenda com filtros por tipo, status e responsável.'],
              [<strong key="d">Um registro</strong>, <C key="5">GET /leads/:id</C>, 'O mesmo vale para /opportunities/:id, /contracts/:id e outros.'],
            ]} />
            <p className="text-sm text-muted">Valores em R$ só aparecem se o perfil tiver a ação “ver financeiro”; sem ela, a resposta traz o cabeçalho <C>x-isp-financeiro: oculto</C>.</p>
          </section>

          <section className="space-y-3">
            <H2 id="paginacao">Paginação e filtros</H2>
            <P>As listas são paginadas com <C>page</C> (a partir de 1) e <C>pageSize</C> (até 100). A resposta traz <C>total</C>: continue pedindo a próxima página até ler todos os registros.</P>
            <Code label="JavaScript · ler todas as páginas">{`let page = 1, all = [];
while (true) {
  const r = await fetch(\`${BASE}/leads?page=\${page}&pageSize=100\`, { headers: { Authorization: \`Bearer \${token}\` } });
  const { items, total } = await r.json();
  all.push(...items);
  if (all.length >= total || items.length === 0) break;
  page++;
}`}</Code>
            <P>Os filtros de cada lista (busca <C>q</C>, situação, responsável, período…) estão na referência completa, logo abaixo.</P>
          </section>

          <section className="space-y-3">
            <H2 id="erros">Erros</H2>
            <P>Erros voltam em <C>application/problem+json</C> com um texto em português e o <C>requestId</C> (informe-o ao suporte).</P>
            <Code label="Exemplo · 422">{JSON.stringify({ type: 'about:blank', requestId: '0876ec48-…', status: 422, title: 'Dados inválidos', detail: 'Confira os dados informados.', errors: [{ path: 'name', message: 'Nome: no mínimo 2 caracteres' }] }, null, 2)}</Code>
            <Table head={['Código', 'Quando acontece']} rows={[
              [<C key="a">401</C>, 'Token ausente, errado, revogado, vencido ou usuário desativado.'],
              [<C key="b">403</C>, 'O perfil não dá acesso a esse módulo, o módulo está desligado, ou o IP não está liberado.'],
              [<C key="c">404</C>, 'Registro inexistente ou de outra empresa.'],
              [<C key="d">409</C>, 'Conflito de versão: o registro mudou desde a leitura (envie o rowVersion atual).'],
              [<C key="e">422</C>, 'Validação ou regra de negócio (os campos com problema vêm em errors).'],
              [<C key="f">429</C>, 'Muitas requisições em pouco tempo: aguarde e tente de novo.'],
            ]} />
          </section>

          <section className="space-y-3">
            <H2 id="seguranca">Segurança e limites</H2>
            <ul className="list-disc space-y-1 pl-5 text-base text-text">
              <li>Guarde o token em cofre ou variável de ambiente do servidor. <strong>Nunca</strong> em código de navegador, aplicativo ou repositório.</li>
              <li>A API é para chamadas de servidor para servidor: navegadores de outros domínios são bloqueados.</li>
              <li>Um usuário de webservice por sistema, com o menor perfil que resolve. Troque o token periodicamente (validade de 30 dias a 1 ano).</li>
              <li>Se a empresa usa “Acesso por IP liberado”, o servidor da integração precisa estar na lista de IPs (Configurações → Segurança).</li>
              <li>Limite de 600 requisições por minuto por endereço de origem. Use paginação de 100 itens.</li>
              <li>Suspeita de vazamento: revogue o token em Configurações → Webservice (API). Ele para de funcionar na hora.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <H2 id="referencia">Referência completa</H2>
            <Reference />
          </section>
        </article>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ referência (OpenAPI)
type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; format?: string; maxLength?: number; anyOf?: Schema[]; nullable?: boolean; default?: unknown; description?: string };
type Op = { summary: string; tags: string[]; parameters: { name: string; in: string; required: boolean; schema: Schema }[]; security: unknown[]; 'x-access': string; requestBody?: { content: { 'application/json': { schema: Schema } } } };
type Spec = { paths: Record<string, Record<string, Op>> };

/** Rotas que um token nunca usa: login/sessão, Configurações e endereços públicos (webhooks, links). */
const usable = (path: string, op: Op) => op.security.length > 0 && !op['x-access'].startsWith('configuracoes') && !['Auth', 'Webservice'].includes(op.tags[0] ?? '') && !path.startsWith('/api/v1/auth/');

function typeOf(s: Schema): string {
  if (s.enum) return s.enum.map(String).join(' · ');
  if (s.anyOf) return s.anyOf.map(typeOf).filter((x) => x !== 'null').join(' ou ');
  const t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join(' ou ') : s.type ?? 'objeto';
  if (t === 'array') return `lista de ${s.items ? typeOf(s.items) : 'itens'}`;
  return ({ string: s.format === 'uuid' ? 'id (uuid)' : s.format === 'date-time' ? 'data e hora (ISO)' : s.format === 'date' ? 'data (AAAA-MM-DD)' : 'texto', number: 'número', integer: 'inteiro', boolean: 'sim/não', object: 'objeto' } as Record<string, string>)[t] ?? t;
}

function Reference() {
  const q = useQuery({ queryKey: ['openapi'], queryFn: async () => { const r = await fetch('/api/v1/openapi.json'); if (!r.ok) throw new Error('Não foi possível carregar a referência.'); return (await r.json()) as Spec; }, staleTime: 10 * 60_000 });
  const [term, setTerm] = useState('');
  const [tag, setTag] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const ops = useMemo(() => {
    const out: { key: string; method: string; path: string; op: Op }[] = [];
    for (const [path, methods] of Object.entries(q.data?.paths ?? {})) for (const [m, op] of Object.entries(methods)) if (usable(path, op)) out.push({ key: `${m} ${path}`, method: m.toUpperCase(), path: path.replace(/^\/api\/v1/, ''), op });
    return out.sort((a, b) => (a.op.tags[0] ?? '').localeCompare(b.op.tags[0] ?? '') || a.path.localeCompare(b.path));
  }, [q.data]);
  const tags = useMemo(() => [...new Set(ops.map((o) => o.op.tags[0] ?? 'Outros'))].sort(), [ops]);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = term.trim().toLowerCase();
  const shown = ops.filter((o) => (!tag || o.op.tags[0] === tag) && (!t || `${o.method} ${o.path} ${o.op.summary}`.toLowerCase().includes(t)));
  const groups = tags.filter((g) => shown.some((o) => o.op.tags[0] === g));
  const download = () => {
    const spec = { ...q.data, paths: Object.fromEntries(Object.entries(q.data!.paths).map(([p, ms]) => [p, Object.fromEntries(Object.entries(ms).filter(([, op]) => usable(p, op)))]).filter(([, ms]) => Object.keys(ms as object).length)), servers: [{ url: window.location.origin }] };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }));
    a.download = 'bkt-revops-openapi.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <P>Todos os endereços disponíveis para o usuário de webservice, gerados direto do sistema (sempre atualizados). O que cada um exige está em “Acesso”: o módulo e o nível mínimo do perfil.</P>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1"><Input aria-label="Buscar na referência" placeholder="Buscar: leads, contrato, POST…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        <Select aria-label="Filtrar por assunto" value={tag} onChange={(e) => setTag(e.target.value)} className="w-auto"><option value="">Todos os assuntos ({ops.length})</option>{tags.map((g) => <option key={g} value={g}>{g}</option>)}</Select>
        <button type="button" onClick={download} className="inline-flex h-10 items-center gap-2 border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2"><Download className="h-4 w-4" />OpenAPI (Postman/Insomnia)</button>
      </div>
      {groups.length === 0 && <p className="text-sm text-muted">Nada encontrado para “{term}”.</p>}
      {groups.map((g) => (
        <div key={g} className="border border-line">
          <h3 className="border-b border-line bg-surface-2 px-4 py-2 text-sm font-bold text-ink">{g}</h3>
          <ul>
            {shown.filter((o) => o.op.tags[0] === g).map((o) => {
              const isOpen = open === o.key;
              const body = o.op.requestBody?.content['application/json'].schema;
              const params = o.op.parameters.filter((p) => p.in === 'query');
              return (
                <li key={o.key} className="border-b border-line last:border-0">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : o.key)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-2">
                    <Method m={o.method} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-mono text-sm text-ink">{o.path}</span><span className="block truncate text-sm text-muted">{o.op.summary}</span></span>
                    <ChevronDown className={clsx('h-4 w-4 shrink-0 text-muted transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="space-y-3 bg-surface px-4 pb-4 pt-1">
                      <p className="text-sm text-muted">Acesso: <C>{o.op['x-access']}</C></p>
                      {params.length > 0 && <Fields title="Parâmetros na URL (?chave=valor)" rows={params.map((p) => ({ name: p.name, required: p.required, s: p.schema }))} />}
                      {body?.properties && <Fields title="Corpo (JSON)" rows={Object.entries(body.properties).map(([n, s]) => ({ name: n, required: body.required?.includes(n) ?? false, s }))} />}
                      {!params.length && !body?.properties && <p className="text-sm text-muted">Sem parâmetros além do que está no endereço.</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Fields({ title, rows }: { title: string; rows: { name: string; required: boolean; s: Schema }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink">{title}</p>
      <Table head={['Campo', 'Tipo', 'Obrigatório']} rows={rows.map((r) => [<C key="n">{r.name}</C>, <span key="t" className="break-words">{typeOf(r.s)}{r.s.maxLength ? ` · até ${r.s.maxLength}` : ''}{r.s.default !== undefined ? ` · padrão ${JSON.stringify(r.s.default)}` : ''}</span>, r.required ? 'Sim' : '—'])} />
    </div>
  );
}
