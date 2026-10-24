/**
 * Mede o tempo de resposta das telas principais (API) numa base: tsx src/db/benchCli.ts [email] [repetições]
 * Usa o mesmo app da produção (rotas, RBAC e consultas), sem rede: app.inject.
 */
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createDb } from './client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definido');
const [email = 'carlos@yepnet.test', reps = '5'] = process.argv.slice(2);
const ORIGIN = 'http://localhost:5173';
const config = loadConfig({ ...process.env, DATABASE_URL: url, WEB_ORIGIN: ORIGIN, NODE_ENV: 'test', LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_PER_MINUTE: '1000' });
const { db, pool } = createDb(url);
const app = await buildApp({ config, db, logger: false, rateLimitMax: 100_000 });
const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email, password: 'Sprint@2026' } });
const cookie = String(res.headers['set-cookie']).split(';')[0]!;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
const y = today.slice(0, 4);
const year = `from=${y}-01-01&to=${today}`;
const wide = `from=2025-01-01&to=${today}`;
const SCREENS: [string, string][] = [
  ['Início', '/home'],
  ['Oportunidades (lista)', '/opportunities?pageSize=50'],
  ['Oportunidades (quadro)', '/pipeline'],
  ['Oportunidades (resumo)', '/opportunities/summary'],
  ['Atividades', '/activities?status=todas&scope=equipe&pageSize=50'],
  ['Leads', '/leads?pageSize=50'],
  ['Contas (clientes)', '/customers?pageSize=50'],
  ['Contratos (lista)', '/contracts?pageSize=50'],
  ['Contratos (painel)', '/contracts/dashboard'],
  ['Contratos (central de atenção)', '/contracts/attention'],
  ['Contratos (calendário do mês)', `/contracts/calendar?from=${today.slice(0, 8)}01&to=${today.slice(0, 8)}28`],
  ['Contratos (relatório completo)', '/contracts/reports/full'],
  ['Contratos (vencendo)', '/contracts/reports/expiring'],
  ['Contratos (processos de renovação)', '/contracts/processes?kind=renovacao&status=todos'],
  ['Contratos (atestados)', '/contracts/certificates'],
  ['Inteligência · Indicadores principais', `/intelligence/kpis?year=${y}`],
  ['Inteligência · contexto do Booking', `/intelligence/kpis/context?year=${y}`],
  ['Inteligência · receita por mês', `/intelligence/revenue?year=${y}`],
  ['Inteligência · Geral (ano)', `/intelligence/general?${year}`],
  ['Inteligência · Comercial (ano)', `/intelligence/overview?${year}`],
  ['Inteligência · Conversão por etapa (ano)', `/intelligence/stage-funnel?${year}`],
  ['Inteligência · Conversão por etapa (desde 2025)', `/intelligence/stage-funnel?${wide}`],
  ['Inteligência · Contratos', `/intelligence/contracts?${year}`],
  ['Inteligência · Concorrentes', '/intelligence/competitors'],
  ['Inteligência · Mapa', `/intelligence/heatmap?${year}`],
  ['Relatórios · Visão geral (ano)', `/reports/overview?${year}`],
  ['Relatórios · Visão geral (desde 2025)', `/reports/overview?${wide}`],
  ['Relatórios · Comissões', `/reports/commissions?${year}`],
  ['Sucesso do Cliente · Carteira', '/cs/portfolio'],
  ['Gestão de Times · Resultados', '/results/overview'],
];
// fichas mais pesadas: o contrato e a negociação com mais histórico
const big = await pool.query<{ c: string; o: string }>(`select (select contract_id from contract_events group by contract_id order by count(*) desc limit 1) c, (select opportunity_id from opportunity_events group by opportunity_id order by count(*) desc limit 1) o`);
const { c: cid, o: oid } = big.rows[0]!;
SCREENS.push(['Contrato · ficha', `/contracts/${cid}`], ['Contrato · linha do tempo', `/contracts/${cid}/timeline`], ['Contrato · execução', `/contracts/${cid}/execution`],
  ['Negociação · ficha', `/opportunities/${oid}`], ['Negociação · histórico', `/opportunities/${oid}/timeline`], ['Negociação · dias por etapa', `/opportunities/${oid}/stage-times`]);
const rows: { tela: string; status: number; mediana: number; max: number; kb: number }[] = [];
for (const [name, path] of SCREENS) {
  const times: number[] = [];
  let status = 0, size = 0;
  for (let i = 0; i <= Number(reps); i++) {
    const t0 = performance.now();
    const r = await app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie, origin: ORIGIN } });
    const ms = performance.now() - t0;
    status = r.statusCode; size = r.body.length;
    if (i > 0) times.push(ms); // a primeira chamada aquece o cache
  }
  times.sort((a, b) => a - b);
  rows.push({ tela: name, status, mediana: Math.round(times[Math.floor(times.length / 2)]!), max: Math.round(times[times.length - 1]!), kb: Math.round(size / 1024) });
}
console.log(JSON.stringify(rows));
await app.close();
await pool.end();
