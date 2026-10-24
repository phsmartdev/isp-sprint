/**
 * Operação fictícia de demonstração (jan/2025 até hoje) para o CRM e a Gestão de Contratos:
 * contas públicas e privadas, negociações com histórico de etapas datado, atividades e tarefas de
 * viabilidade, itens, participantes de pregão, leads, contratos com versões (reajuste, aditivo,
 * renovação), saldo e consumo de medição, faturamentos, empenhos, SLA, ocorrências, fiscais,
 * cláusulas, atestados e pesquisas do Sucesso do Cliente.
 *
 * Tudo é inventado: nomes de empresas, órgãos, municípios e pessoas não existem; CNPJs são gerados
 * (válidos no formato, sem dono real); e-mails usam .test. Contatos vêm marcados com
 * source_system = 'demo_operacao' e saem com "Limpar base" (Configuração → Base de dados).
 * As datas são do passado real (append-only): os registros entram já com a data em que teriam acontecido.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DB, DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { recomputeAccounts } from './cs';

export const OPS_SOURCE = 'demo_operacao';
const DAY = 86_400_000;

// ------------------------------------------------------------------ aleatório determinístico
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ nomes inventados
const TOWNS = ['Serra Azul do Norte', 'Lagoa Clara', 'Porto das Garças', 'Vale do Mandacaru', 'Santa Aurora do Agreste', 'Boa Vista da Maré', 'Riacho Dourado', 'Campo Alegre do Sertão',
  'Nova Esperança do Litoral', 'Pedra Branca do Oeste', 'São Bento da Várzea', 'Coqueiral', 'Ilha do Farol', 'Monte Sereno', 'Águas Mansas', 'Cajueiro Grande', 'Jardim do Rio Seco', 'Brejo Verde',
  'Barra do Sol', 'Canto da Serra', 'Arraial Novo', 'Vila dos Pescadores', 'Ribeira Alta', 'Tabuleiro Velho', 'Palmeiral', 'Sítio das Flores', 'Morro do Vento', 'Lajedo Grande'];
const TOWN_ORGANS = ['Prefeitura Municipal de', 'Secretaria Municipal de Educação de', 'Secretaria Municipal de Saúde de', 'Câmara Municipal de', 'Serviço Autônomo de Água de', 'Fundo Municipal de Saúde de'];
const STATE_ORGANS = ['Secretaria de Estado da Fazenda do Litoral', 'Secretaria de Estado da Educação do Litoral', 'Tribunal de Contas do Litoral', 'Universidade Estadual do Agreste', 'Instituto Federal do Litoral Norte',
  'Departamento Estadual de Trânsito do Litoral', 'Companhia Estadual de Saneamento do Agreste', 'Defensoria Pública do Litoral', 'Assembleia Legislativa do Litoral', 'Hospital Regional do Sertão', 'Polícia Científica do Litoral',
  'Junta Comercial do Litoral', 'Agência Reguladora do Agreste', 'Fundação Estadual de Cultura do Litoral'];
const COMPANY_KIND = ['Grupo', 'Indústria', 'Rede', 'Hospital', 'Colégio', 'Clínica', 'Transportadora', 'Supermercados', 'Construtora', 'Hotel', 'Faculdade', 'Laboratório', 'Atacadão', 'Agroindústria', 'Shopping', 'Cooperativa', 'Logística', 'Distribuidora', 'Condomínio Empresarial', 'Usina'];
const COMPANY_NAME = ['Atlântico', 'Serra Verde', 'Horizonte', 'Mandacaru', 'Coqueiral', 'Sol Nascente', 'Maré Alta', 'Cajá', 'Litoral Norte', 'Ventos do Sul', 'Pedra Azul', 'Rio Claro', 'Aroeira', 'Juazeiro', 'Caatinga',
  'Brisa Mar', 'Três Barras', 'Ipê Amarelo', 'Barra Nova', 'Vale Real', 'Canoa', 'Farol', 'Jangada', 'Sertãozinho', 'Mangue Seco', 'Ouro Verde', 'Alvorada', 'Cumbuca', 'Bom Jesus do Vale', 'Quatro Ventos'];
const COMPANY_SUFFIX = ['Ltda.', 'S.A.', 'Ltda. (fictícia)', 'Eireli', 'S.A. (fictícia)'];
const COMPETITORS = ['NetSul Telecom', 'FibraMax Soluções', 'Conecta Litoral', 'TeleAgreste Redes', 'Onda Digital', 'ViaLink Nordeste', 'MegaRede Corporativa', 'Infovia Sertão', 'Linkar Telecom', 'Rota Dados', 'NuvemNorte TI', 'Sinal Forte Telecom'];
const FIRST = ['Mariana', 'Rafael', 'Sabrina', 'Diego', 'Juliana', 'Fernanda', 'Pedro', 'Gustavo', 'Ricardo', 'Thaís', 'Rodrigo', 'Larissa', 'Felipe', 'Marcela', 'Bruno', 'João', 'Beatriz', 'Henrique', 'Camila', 'Eduardo', 'Patrícia', 'Renato', 'Aline', 'Sérgio', 'Débora'];
const LAST = ['Costa', 'Lima', 'Oliveira', 'Santos', 'Ribeiro', 'Cardoso', 'Alves', 'Vieira', 'Mendes', 'Ferreira', 'Teixeira', 'Barbosa', 'Correia', 'Martins', 'Torres', 'Souza', 'Cunha', 'Rocha'];
const CITIES: [string, number][] = [['Aracaju', 40], ['Nossa Senhora do Socorro', 12], ['São Cristóvão', 9], ['Estância', 8], ['Lagarto', 8], ['Itabaiana', 7], ['Barra dos Coqueiros', 4], ['Tobias Barreto', 3], ['Simão Dias', 3], ['Propriá', 3], ['Capela', 2], ['Boquim', 2]];

type Product = { name: string; unit: 'un' | 'km' | 'h' | 'rs'; min: number; max: number; billing: 'recorrente' | 'medicao' | 'frequente'; sla: boolean };
/** Portfólio fictício (conectividade, nuvem, energia e cidades inteligentes), em centavos por mês. */
const PRODUCTS: Product[] = [
  { name: 'Link dedicado com IP fixo', unit: 'un', min: 150_000, max: 1_200_000, billing: 'recorrente', sla: true },
  { name: 'Internet corporativa em fibra', unit: 'un', min: 60_000, max: 350_000, billing: 'recorrente', sla: true },
  { name: 'Rede MPLS / SD-WAN entre unidades', unit: 'un', min: 400_000, max: 2_500_000, billing: 'recorrente', sla: true },
  { name: 'Nuvem privada e backup gerenciado', unit: 'un', min: 200_000, max: 1_500_000, billing: 'recorrente', sla: true },
  { name: 'Colocation em datacenter', unit: 'un', min: 180_000, max: 900_000, billing: 'recorrente', sla: true },
  { name: 'Wi-Fi gerenciado', unit: 'un', min: 80_000, max: 600_000, billing: 'recorrente', sla: false },
  { name: 'Videomonitoramento urbano', unit: 'un', min: 300_000, max: 2_800_000, billing: 'recorrente', sla: true },
  { name: 'Iluminação pública inteligente', unit: 'un', min: 250_000, max: 2_200_000, billing: 'recorrente', sla: false },
  { name: 'Geração solar compartilhada', unit: 'un', min: 300_000, max: 1_800_000, billing: 'recorrente', sla: false },
  { name: 'Fibra apagada', unit: 'km', min: 20_000, max: 90_000, billing: 'recorrente', sla: true },
  { name: 'Horas técnicas e instalações sob demanda', unit: 'h', min: 18_000, max: 32_000, billing: 'medicao', sla: false },
  { name: 'Suporte e manutenção sob demanda', unit: 'h', min: 15_000, max: 28_000, billing: 'frequente', sla: false },
];
const PUBLIC_PRODUCTS = [0, 1, 2, 5, 6, 7, 9, 10, 10, 10];
const PRIVATE_PRODUCTS = [0, 0, 1, 1, 1, 2, 3, 3, 4, 5, 8, 9, 11];

type SaleKind = 'licitacao' | 'adesao_ata' | 'consumo_contrato' | 'venda_consultiva';
const WIN: Record<SaleKind, number> = { licitacao: 0.36, adesao_ata: 0.72, consumo_contrato: 0.88, venda_consultiva: 0.31 };
const LOSS_W: [string, number][] = [['preco', 40], ['sem_resposta', 18], ['satisfeito_atual', 14], ['fidelidade_atual', 10], ['nao_quer_trocar', 8], ['sem_cobertura', 5], ['outro', 5]];
/** Índices de reajuste dos 12 meses (aproximação ilustrativa, não é série oficial). */
const INDEX_12M: Record<string, Record<number, number>> = { IPCA: { 2023: 0.0462, 2024: 0.0483, 2025: 0.0468, 2026: 0.0452 }, 'IGP-M': { 2023: 0.039, 2024: 0.0618, 2025: 0.071, 2026: 0.0295 } };

// ------------------------------------------------------------------ datas (dias desde 1970)
const dayOf = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoOf = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const yearOf = (d: number) => Number(isoOf(d).slice(0, 4));
const addMonthsDay = (d: number, m: number) => { const x = new Date(d * DAY); x.setUTCMonth(x.getUTCMonth() + m); return Math.round(x.getTime() / DAY); };
const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** CNPJ com dígitos verificadores corretos, gerado (sem dono real). */
function cnpj(r: () => number) {
  const n = Array.from({ length: 8 }, () => Math.floor(r() * 10)).concat([0, 0, 0, 1]);
  const dv = (base: number[]) => { const w = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = base.reduce((a, x, i) => a + x * w[i]!, 0) % 11; return s < 2 ? 0 : 11 - s; };
  n.push(dv(n)); n.push(dv(n));
  const t = n.join('');
  return `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}/${t.slice(8, 12)}-${t.slice(12)}`;
}

type Row = Record<string, unknown>;
type Acc = { id: string; name: string; doc: string; nature: 'publica' | 'privada'; ownerId: string; city: string; since: number };
type Ctr = {
  id: string; accId: string; nature: 'publica' | 'privada'; billing: 'recorrente' | 'medicao' | 'frequente'; product: Product; start: number; end: number; monthly: number; saldo: number; oppId: string | null;
  ownerId: string; ended: boolean; endsAt: number | null; number: string;
};

export async function hasOpsDemo(db: DbOrTx, tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.contacts).where(and(eq(s.contacts.tenantId, tenantId), eq(s.contacts.sourceSystem, OPS_SOURCE)));
  return (r?.n ?? 0) > 0;
}

/** Empresas de demonstração (usuários .test) que ainda não têm a operação fictícia. */
export async function tenantsForOpsDemo(db: DbOrTx) {
  const r = await db.execute<{ id: string }>(sql`
    select t.id from tenants t
     where exists (select 1 from users u where u.tenant_id = t.id and u.email like '%@yepnet.test')
       and not exists (select 1 from contacts c where c.tenant_id = t.id and c.source_system = ${OPS_SOURCE})`);
  return r.rows.map((x) => x.id);
}

/**
 * Gera e grava a operação. scale 1 ≈ uma operação regional de um ano e meio (~1.400 negociações, ~650 contratos).
 * Retorna a contagem por tabela.
 */
export async function loadOpsDemo(db: DB, tenantId: string, opts: { today: string; scale?: number; seed?: number; start?: string }) {
  const scale = opts.scale ?? 1;
  const r = rng(opts.seed ?? 2025);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)] as T;
  const weighted = <T,>(a: [T, number][]) => { let x = r() * a.reduce((t, [, w]) => t + w, 0); for (const [v, w] of a) if ((x -= w) <= 0) return v; return a[0]![0]; };
  const between = (a: number, b: number) => a + r() * (b - a);
  const int = (a: number, b: number) => Math.floor(between(a, b + 1));
  const expo = (mean: number) => -Math.log(1 - r()) * mean;
  const T = dayOf(opts.today);
  const D0 = dayOf(opts.start ?? '2025-01-01');
  const nowMs = Date.now();
  const stamp = (d: number, hour = 9 + r() * 9) => new Date(Math.min(nowMs - 3_600_000, d * DAY + (hour + 3) * 3_600_000 + Math.floor(r() * 60) * 60_000));

  const out: Record<string, Row[]> = {};
  const push = (table: string, row: Row) => (out[table] ??= []).push(row);

  // ---------------- base da empresa: usuários, funil, filiais, origens
  const users = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)));
  if (!users.length) throw new Error('Empresa sem usuários');
  const byMail = (m: string) => users.find((u) => u.email.startsWith(m))?.id;
  const mgr = byMail('carlos') ?? users[0]!.id;
  const sup = byMail('ana') ?? mgr;
  const gov = [byMail('mariana'), byMail('rafael'), mgr].filter(Boolean) as string[];
  const priv = [byMail('rafael'), byMail('lucas'), sup, mgr].filter(Boolean) as string[];
  const ops = byMail('ana') ?? mgr;
  const [pipe] = await db.select().from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, 'empresarial'))).limit(1);
  if (!pipe) throw new Error('Funil Corporativo não encontrado');
  const stages = (await db.select().from(s.pipelineStages).where(and(eq(s.pipelineStages.pipelineId, pipe.id), eq(s.pipelineStages.active, true)))).filter((x) => x.kind === 'open').sort((a, b) => a.position - b.position).map((x) => x.key);
  let branches = await db.select().from(s.salesBranches).where(eq(s.salesBranches.tenantId, tenantId));
  if (!branches.length) branches = await db.insert(s.salesBranches).values([{ tenantId, name: 'BKT Soluções', position: 0 }, { tenantId, name: 'UPNET', position: 1 }]).returning();
  const sourceRows = await db.select().from(s.leadSources).where(eq(s.leadSources.tenantId, tenantId));
  const srcId = async (name: string) => {
    const f = sourceRows.find((x) => x.name === name);
    if (f) return f.id;
    const [n] = await db.insert(s.leadSources).values({ tenantId, name }).returning();
    sourceRows.push(n!);
    return n!.id;
  };
  const SRC_PRIV: [string, number][] = [[await srcId('Prospecção ativa'), 30], [await srcId('Indicação'), 22], [await srcId('Site'), 18], [await srcId('Evento'), 10], [await srcId('WhatsApp'), 12], [await srcId('Campanha'), 8]];
  const SRC_PUB: [string, number][] = [[await srcId('Portal de compras'), 60], [await srcId('Prospecção ativa'), 25], [await srcId('Indicação'), 15]];

  // ---------------- contas
  const accs: Acc[] = [];
  const usedNames = new Set<string>();
  const nPub = Math.round(140 * scale), nPriv = Math.round(310 * scale);
  for (let i = 0; i < nPub; i++) {
    let name = '';
    for (let k = 0; k < 20 && (!name || usedNames.has(name)); k++) name = r() < 0.75 ? `${pick(TOWN_ORGANS)} ${pick(TOWNS)}` : pick(STATE_ORGANS);
    if (usedNames.has(name)) name = `${name} ${i}`;
    usedNames.add(name);
    accs.push({ id: randomUUID(), name: `${name} (fictício)`, doc: cnpj(r), nature: 'publica', ownerId: pick(gov), city: weighted(CITIES), since: D0 - int(30, 900) });
  }
  for (let i = 0; i < nPriv; i++) {
    let name = '';
    for (let k = 0; k < 20 && (!name || usedNames.has(name)); k++) name = `${pick(COMPANY_KIND)} ${pick(COMPANY_NAME)}`;
    if (usedNames.has(name)) name = `${name} ${i}`;
    usedNames.add(name);
    accs.push({ id: randomUUID(), name: `${name} ${pick(COMPANY_SUFFIX)}`, doc: cnpj(r), nature: 'privada', ownerId: pick(priv), city: weighted(CITIES), since: D0 - int(30, 900) });
  }
  for (const a of accs) {
    const slug = a.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, 14);
    push('contacts', {
      id: a.id, tenantId, name: a.name, document: a.doc, nature: a.nature, segment: a.nature === 'publica' ? 'governamental' : 'empresarial', city: a.city, ownerId: a.ownerId,
      email: `contato@${slug}.test`, phone: `(00) 3${int(100, 999)}-${int(1000, 9999)}`, sourceSystem: OPS_SOURCE, externalId: `OPS-${a.id.slice(0, 8)}`,
      custom: { cnpj: a.doc }, createdAt: stamp(Math.min(a.since, T - 1)), updatedAt: stamp(Math.min(a.since, T - 1)), createdBy: a.ownerId,
    });
  }
  const pubAccs = accs.filter((a) => a.nature === 'publica');
  const privAccs = accs.filter((a) => a.nature === 'privada');

  // ---------------- contratos (base anterior a 2025 e os que nascem das vendas)
  const ctrs: Ctr[] = [];
  let ctrSeq = 0;
  const contractNumber = (nature: 'publica' | 'privada', d: number) => (nature === 'publica' ? `${String(++ctrSeq).padStart(3, '0')}/${yearOf(d)}` : `CTR-${yearOf(d)}-${String(++ctrSeq).padStart(4, '0')}`);

  /** Monta um contrato inteiro (versões, eventos, processos, saldo/consumo, empenhos, execução) até hoje. */
  const buildContract = (a: Acc, product: Product, monthly: number, signed: number, oppId: string | null, ownerId: string, _legacy: boolean) => {
    const id = randomUUID();
    const pub = a.nature === 'publica';
    const billing = product.billing;
    const start = signed + int(0, 10);
    const activation = start + int(8, 45);
    const term = pub ? 12 : pick([12, 24, 24, 36]);
    let end = addMonthsDay(start, term) - 1;
    const saldo = billing === 'medicao' ? monthly * 12 : 0;
    const number = contractNumber(a.nature, signed);
    const index = pub || r() < 0.7 ? 'IPCA' : 'IGP-M';
    const object = `${product.name} (fictício)`;
    const items = [{ planId: null, description: product.name, qty: 1, unitCents: monthly }];
    const pt = pub ? { agency: a.name, processNumber: `PROC-${yearOf(signed)}-${int(1000, 9999)}`, modality: r() < 0.8 ? 'Pregão eletrônico' : 'Adesão à ata', commitmentNote: null, budgetLine: `${int(10, 99)}.${int(100, 999)}.${int(1000, 9999)}`, extensionMaxMonths: 60 } : null;
    const guarantee = pub && monthly > 500_000 ? { type: 'Seguro-garantia', amountCents: Math.round(monthly * 12 * 0.05), insurer: 'Seguradora Fictícia', policy: `AP-${int(1000, 9999)}`, expiresAt: isoOf(end + 90), renewalAt: null } : null;
    const created = Math.max(signed - 2, D0 - 1200);
    let ver = 0;
    let cur = { monthly, start, end, term, effective: null as number | null };
    const versions: Row[] = [];
    const addVersion = (day: number, kind: string, reason: string, patch: Partial<typeof cur>) => {
      cur = { ...cur, ...patch };
      ver += 1;
      versions.push({
        id: randomUUID(), tenantId, contractId: id, version: ver, changeKind: kind, reason, number, object, signedAt: isoOf(signed), startAt: isoOf(cur.start), endAt: isoOf(cur.end), termMonths: cur.term,
        activationAt: activation <= T ? isoOf(activation) : null, billingStartAt: activation <= T ? isoOf(activation + 1) : null, renewalAt: isoOf(cur.end), monthlyCents: billing === 'recorrente' ? cur.monthly : 0,
        effectiveFrom: cur.effective === null ? null : isoOf(cur.effective), totalCents: billing === 'medicao' ? saldo : cur.monthly * cur.term, billingDay: 10, billingTerms: 'Fatura mensal, vencimento no dia 10',
        items: billing === 'recorrente' ? items.map((x) => ({ ...x, unitCents: cur.monthly })) : [], guarantee, publicTerms: pt, adjustmentIndex: index, adjustmentBaseDate: isoOf(start),
        createdBy: ownerId, createdAt: stamp(Math.min(day, T)),
      });
      push('contract_events', { tenantId, contractId: id, type: ver === 1 ? 'cadastro' : 'versao', actorId: ownerId, summary: ver === 1 ? `Contrato ${number} (${billing === 'recorrente' ? 'Recorrente' : billing === 'medicao' ? 'Medição' : 'Frequente'}) cadastrado${oppId ? ' a partir da negociação ganha' : ''}` : `Versão ${ver} (${kind}): ${reason}`, payload: { version: ver }, occurredAt: stamp(Math.min(day, T)) });
    };
    addVersion(created, 'cadastro', 'Cadastro inicial', {});
    const ev = (day: number, type: string, summary: string, payload: Row | null = null) => { if (day <= T) push('contract_events', { tenantId, contractId: id, type, actorId: ownerId, summary, payload, occurredAt: stamp(day) }); };
    ev(created + 1, 'validado', 'Cadastro validado');
    // implantação
    push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'implantacao', cycleKey: 'inicial', status: activation <= T ? 'concluido' : 'aberto', steps: {}, ownerId: ops, dueAt: isoOf(activation), outcome: activation <= T ? 'Serviço ativado' : null, openedBy: ownerId, openedAt: stamp(Math.min(created + 1, T)), closedAt: activation <= T ? stamp(activation) : null, closedBy: activation <= T ? ops : null });
    ev(created + 1, 'processo_aberto', `Processo de implantacao aberto (prazo ${isoOf(activation)})`);
    if (activation <= T) ev(activation, 'etapa', 'Etapa: implantação concluída; contrato vigente');

    // ciclos anuais: reajuste, aditivo, renovação/prorrogação ou encerramento
    let ended = false, endsAt: number | null = null, stage = activation > T ? (created + 1 > T ? 'cadastro_validacao' : 'implantacao') : 'vigente';
    let anniversary = addMonthsDay(start, 12);
    let total = term;
    for (let guard = 0; guard < 12 && !ended; guard++) {
      // reajuste no aniversário (até o fim da vigência atual)
      while (anniversary <= Math.min(T, cur.end) && billing === 'recorrente') {
        const pct = INDEX_12M[index]![yearOf(anniversary) - 1] ?? 0.045;
        if (anniversary > T - 45 && r() < 0.35) { // reajuste ainda em análise
          push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'reajuste', cycleKey: isoOf(anniversary).slice(0, 4), status: 'aberto', steps: {}, ownerId: ops, dueAt: isoOf(anniversary + 30), openedBy: ownerId, openedAt: stamp(anniversary - 30) });
          ev(anniversary - 30, 'processo_aberto', `Processo de reajuste aberto (prazo ${isoOf(anniversary + 30)})`);
          stage = 'reajuste';
        } else {
          const nm = Math.round(cur.monthly * (1 + pct));
          addVersion(anniversary + int(0, 20), 'reajuste', `Reajuste anual pelo ${index} de ${(pct * 100).toFixed(2).replace('.', ',')}%`, { monthly: nm, effective: anniversary });
          push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'reajuste', cycleKey: isoOf(anniversary).slice(0, 4), status: 'concluido', steps: {}, ownerId: ops, dueAt: isoOf(anniversary + 30), outcome: `Aplicado ${(pct * 100).toFixed(2).replace('.', ',')}%`, openedBy: ownerId, openedAt: stamp(anniversary - 30), closedAt: stamp(Math.min(anniversary + 15, T)), closedBy: ops });
        }
        anniversary = addMonthsDay(anniversary, 12);
      }
      // aditivo de acréscimo/supressão no meio da vigência
      if (r() < 0.14) {
        const day = cur.start + int(60, Math.max(61, cur.end - cur.start - 30));
        if (day <= T && day < cur.end) {
          const up = r() < 0.8;
          const p = up ? between(0.06, pub ? 0.25 : 0.4) : -between(0.05, 0.2);
          const delta = Math.round(cur.monthly * p);
          const num = `${pub ? 'TA' : 'ADT'}-${String(int(1, 9)).padStart(2, '0')}/${yearOf(day)}`;
          push('contract_amendments', { tenantId, contractId: id, number: num, kind: up ? 'acrescimo' : 'supressao', signedOn: isoOf(day), valueDeltaCents: delta * Math.max(1, Math.round((cur.end - day) / 30)), monthlyDeltaCents: delta, description: up ? 'Inclusão de novas unidades atendidas (fictício)' : 'Desativação de pontos (fictício)', version: ver + 1, createdBy: ownerId, createdAt: stamp(day) });
          if (billing === 'recorrente') addVersion(day, 'aditivo', `Termo aditivo ${num}: ${up ? 'acréscimo' : 'supressão'} de ${brl(Math.abs(delta))}/mês`, { monthly: cur.monthly + delta, effective: day });
          ev(day, 'aditivo', `Termo aditivo ${num}: ${up ? 'acréscimo' : 'supressão'} de ${brl(Math.abs(delta))} por mês.`);
        }
      }
      if (cur.end >= T) break;
      // vigência acabou antes de hoje: renova/prorroga ou encerra
      const renew = pub ? total + 12 <= 60 && r() < 0.82 : r() < 0.74;
      if (renew) {
        const nt = 12;
        const ns = cur.end + 1;
        const ne = addMonthsDay(ns, nt) - 1;
        const decided = cur.end - int(10, 60);
        push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'renovacao', cycleKey: isoOf(cur.end).slice(0, 4), status: 'concluido', steps: {}, ownerId: ownerId, dueAt: isoOf(cur.end), outcome: pub ? 'Prorrogado por termo aditivo' : 'Renovado', openedBy: ownerId, openedAt: stamp(cur.end - 90), closedAt: stamp(decided), closedBy: ownerId });
        if (pub) push('contract_amendments', { tenantId, contractId: id, number: `TA-P${String(int(1, 9)).padStart(2, '0')}/${yearOf(decided)}`, kind: 'prazo', signedOn: isoOf(decided), valueDeltaCents: 0, monthlyDeltaCents: 0, newEndAt: isoOf(ne), description: 'Prorrogação de prazo por mais 12 meses (fictício)', version: ver + 1, createdBy: ownerId, createdAt: stamp(decided) });
        addVersion(decided, 'renovacao', pub ? 'Prorrogação por mais 12 meses' : 'Renovação por mais 12 meses', { start: ns, end: ne, term: nt, effective: ns });
        ev(decided, 'renovado', `Contrato Renovado: vigência ${isoOf(ns)} a ${isoOf(ne)}.`);
        total += nt;
      } else {
        ended = true;
        endsAt = cur.end;
        push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'encerramento', cycleKey: isoOf(cur.end).slice(0, 4), status: cur.end + 20 <= T ? 'concluido' : 'aberto', steps: {}, ownerId: ownerId, dueAt: isoOf(cur.end + 20), outcome: cur.end + 20 <= T ? 'Encerrado sem pendências' : null, openedBy: ownerId, openedAt: stamp(cur.end - 60), closedAt: cur.end + 20 <= T ? stamp(cur.end + 20) : null, closedBy: cur.end + 20 <= T ? ownerId : null });
        ev(cur.end - 60, 'encerramento_previsto', `Sem renovação: ${pick(['cliente migrou para outro fornecedor', 'órgão não prorrogou', 'redução de orçamento', 'unidade desativada'])}. Encerramento previsto para ${isoOf(cur.end)}.`);
        if (cur.end + 20 <= T) { addVersion(cur.end + 20, 'encerramento', 'Contrato encerrado', {}); ev(cur.end + 20, 'arquivado', 'Contrato encerrado e arquivado em “Drive/Contratos/Encerrados (fictício)”.'); stage = 'arquivado'; } else stage = 'encerramento';
      }
    }
    if (!ended && stage === 'vigente' && cur.end - T <= 75 && r() < 0.45) {
      stage = 'renovacao';
      push('contract_processes', { id: randomUUID(), tenantId, contractId: id, kind: 'renovacao', cycleKey: isoOf(cur.end).slice(0, 4), status: 'aberto', steps: {}, ownerId, dueAt: isoOf(cur.end - 15), openedBy: ownerId, openedAt: stamp(cur.end - 90) });
      ev(cur.end - 90, 'processo_aberto', `Processo de renovacao aberto (prazo ${isoOf(cur.end - 15)})`);
    }
    for (const v of versions) push('contract_versions', v);
    const archived = stage === 'arquivado';
    push('contracts', {
      id, tenantId, contactId: a.id, opportunityId: oppId, kind: pub ? 'publico' : 'privado', legalRegime: pub ? (signed < dayOf('2024-01-01') ? 'lei_8666' : 'lei_14133') : 'privado', stage,
      stageChangedAt: stamp(Math.min(T, stage === 'vigente' ? activation : stage === 'arquivado' ? cur.end + 20 : stage === 'implantacao' ? created + 1 : T - int(1, 30))),
      currentVersion: ver, commercialOwnerId: ownerId, operationalOwnerId: ops, csmId: sup, validatedAt: created + 1 <= T ? stamp(created + 1) : null, validatedBy: created + 1 <= T ? mgr : null,
      erpRef: activation <= T ? `ERP-${int(10000, 99999)}` : null, renewed: total > term, closureExpected: ended, closureAt: ended ? isoOf(cur.end) : null, closedAt: archived ? stamp(cur.end + 20) : null, archivedAt: archived ? stamp(cur.end + 20) : null,
      archiveLocation: archived ? 'Drive/Contratos/Encerrados (fictício)' : null, finalNote: archived ? 'Encerrado sem pendências (fictício)' : null, billingType: billing, createdBy: ownerId,
      createdAt: stamp(Math.min(created, T)), updatedAt: stamp(Math.min(T, Math.max(created, cur.start))),
    });
    const c: Ctr = { id, accId: a.id, nature: a.nature, billing, product, start, end: cur.end, monthly: cur.monthly, saldo, oppId, ownerId, ended, endsAt, number };
    ctrs.push(c);

    // saldo e consumo (medição), faturamentos (frequente), empenhos (público)
    const lastDay = Math.min(T, ended ? (endsAt ?? T) : T);
    if (billing === 'medicao') {
      push('contract_ledger', { tenantId, contractId: id, kind: 'credito', amountCents: saldo, occurredOn: isoOf(start), description: 'Saldo contratado (fictício)', createdBy: ownerId, createdAt: stamp(Math.min(start, T)) });
      ev(start, 'credito', `Crédito de ${brl(saldo)}: Saldo contratado`);
      if (total > term) for (let k = 1; k * 12 < total; k++) { const d = addMonthsDay(start, 12 * k); if (d <= T) { push('contract_ledger', { tenantId, contractId: id, kind: 'credito', amountCents: saldo, occurredOn: isoOf(d), description: 'Saldo da prorrogação (fictício)', createdBy: ownerId, createdAt: stamp(d) }); ev(d, 'credito', `Crédito de ${brl(saldo)}: Saldo da prorrogação`); } }
      for (let d = activation + int(10, 30); d <= lastDay; d += int(20, 40)) {
        const amt = Math.round((saldo / 12) * between(0.35, 0.9));
        push('contract_ledger', { tenantId, contractId: id, kind: 'consumo', amountCents: amt, occurredOn: isoOf(d), description: `Ordem de serviço ${int(100, 999)}/${yearOf(d)} (fictícia)`, createdBy: ownerId, createdAt: stamp(d) });
        ev(d, 'consumo', `Consumo de ${brl(amt)}: Ordem de serviço`);
        if (r() < 0.03) { const e = Math.round(amt * between(0.1, 0.5)); push('contract_ledger', { tenantId, contractId: id, kind: 'estorno', amountCents: e, occurredOn: isoOf(Math.min(d + 5, T)), description: 'Estorno de medição glosada (fictício)', createdBy: ownerId, createdAt: stamp(Math.min(d + 5, T)) }); }
      }
    }
    if (billing === 'frequente') {
      for (let d = activation + int(5, 20); d <= lastDay; d += int(9, 25)) {
        const amt = Math.round(monthly * between(0.25, 0.8));
        push('contract_ledger', { tenantId, contractId: id, kind: 'faturamento', amountCents: amt, occurredOn: isoOf(d), description: `Atendimento avulso ${int(1000, 9999)} (fictício)`, createdBy: ownerId, createdAt: stamp(d) });
        ev(d, 'faturamento', `Faturamento de ${brl(amt)}: Atendimento avulso`);
      }
    }
    if (pub) {
      const annual = billing === 'medicao' ? saldo : monthly * 12;
      for (let y = yearOf(start); y <= Math.min(yearOf(T), yearOf(lastDay)); y++) {
        const issued = Math.max(start, dayOf(`${y}-01-15`) + int(0, 30));
        if (issued > T) continue;
        const share = y === yearOf(start) ? Math.max(0.2, (dayOf(`${y}-12-31`) - start) / 365) : 1;
        const amt = Math.round(annual * share * between(0.7, 1.05));
        const num = `${y}NE${String(int(100, 99999)).padStart(6, '0')}`;
        push('contract_commitments', { tenantId, contractId: id, number: num, issuedOn: isoOf(issued), fiscalYear: y, amountCents: amt, notes: 'Empenho estimativo (fictício)', createdBy: ownerId, createdAt: stamp(issued) });
        ev(issued, 'empenho', `Empenho ${num} de ${brl(amt)} (${isoOf(issued)}).`);
      }
    }

    // execução: SLA medido todo mês, ocorrências, fiscais, cláusulas, atestados
    if (product.sla && activation < T - 30 && r() < 0.6) {
      const slaId = randomUUID();
      const target = pick([99.5, 99.5, 99.7, 99.8]);
      push('contract_slas', { id: slaId, tenantId, contractId: id, metric: 'disponibilidade', label: 'Disponibilidade mensal', target, unit: '%', direction: 'maior', penaltyNote: pub ? '1% da fatura por 0,1 p.p. abaixo da meta' : 'Desconto proporcional na fatura', createdBy: mgr, createdAt: stamp(activation) });
      ev(activation, 'sla', `SLA cadastrado: Disponibilidade mensal ≥ ${target}%`);
      const sla2 = r() < 0.5 ? randomUUID() : null;
      if (sla2) { push('contract_slas', { id: sla2, tenantId, contractId: id, metric: 'tempo_reparo', label: 'Tempo de reparo', target: pub ? 4 : 6, unit: 'h', direction: 'menor', penaltyNote: null, createdBy: mgr, createdAt: stamp(activation) }); }
      for (let m = addMonthsDay(activation, 1); m <= Math.min(T, lastDay); m = addMonthsDay(m, 1)) {
        const period = isoOf(m - 3).slice(0, 7);
        const bad = r() < 0.06;
        const value = bad ? Math.round(between(target - 1.2, target - 0.05) * 100) / 100 : Math.round(between(target + 0.02, 99.99) * 100) / 100;
        push('contract_sla_measurements', { tenantId, contractId: id, slaId, period, value, note: bad ? 'Rompimento de fibra na rede de acesso (fictício)' : null, source: 'informado', createdBy: ops, createdAt: stamp(m + int(1, 5)) });
        ev(m + 1, 'sla_medicao', `SLA Disponibilidade mensal em ${period}: ${String(value).replace('.', ',')}% (meta ≥ ${target}%) — ${bad ? 'VIOLADO' : 'cumprido'}.`, { slaId, period, status: bad ? 'violado' : 'cumprido' });
        if (sla2) push('contract_sla_measurements', { tenantId, contractId: id, slaId: sla2, period, value: Math.round(between(1, bad ? 9 : 5) * 10) / 10, source: 'informado', createdBy: ops, createdAt: stamp(m + int(1, 5)) });
        if (bad && r() < 0.5) {
          const occ = randomUUID();
          const day = m + int(1, 8);
          if (day > T) continue;
          const kind = pub ? weighted<string>([['falha_servico', 40], ['notificacao_orgao', 30], ['glosa', 18], ['multa', 12]]) : weighted<string>([['falha_servico', 70], ['reclamacao', 30]]);
          const amount = kind === 'multa' || kind === 'glosa' ? Math.round(cur.monthly * between(0.01, 0.05)) || 50_000 : null;
          const due = kind === 'notificacao_orgao' || kind === 'multa' || kind === 'glosa' ? day + 5 : null;
          push('contract_occurrences', { id: occ, tenantId, contractId: id, kind, occurredOn: isoOf(day), title: kind === 'falha_servico' ? `Indisponibilidade em ${period}` : kind === 'notificacao_orgao' ? `Notificação por indisponibilidade em ${period}` : kind === 'glosa' ? `Glosa na fatura de ${period}` : kind === 'multa' ? `Multa por descumprimento de SLA (${period})` : `Reclamação de lentidão em ${period}`, description: 'Registro fictício de demonstração', amountCents: amount, responseDueAt: due ? isoOf(due) : null, reference: pub ? `Ofício ${int(10, 300)}/${yearOf(day)}` : null, ownerId, createdBy: ownerId, createdAt: stamp(day) });
          ev(day, 'ocorrencia', `Ocorrência registrada: ${kind}${amount ? ` (${brl(amount)})` : ''}.`, { occurrenceId: occ, kind });
          const closeDay = day + int(3, 25);
          if (closeDay <= T) {
            const st = due ? pick(['defesa_enviada', 'aceita', 'revertida', 'revertida']) : 'encerrada';
            push('contract_occurrence_updates', { tenantId, occurrenceId: occ, status: st === 'defesa_enviada' ? 'defesa_enviada' : st, note: st === 'revertida' ? 'Defesa acolhida pelo órgão (fictício)' : st === 'aceita' ? 'Penalidade aplicada (fictício)' : st === 'defesa_enviada' ? 'Defesa protocolada (fictício)' : 'Causa corrigida (fictício)', amountCents: null, createdBy: ownerId, createdAt: stamp(closeDay) });
            if (st === 'defesa_enviada' && closeDay + 20 <= T) push('contract_occurrence_updates', { tenantId, occurrenceId: occ, status: pick(['aceita', 'revertida']), note: 'Decisão do órgão (fictício)', amountCents: null, createdBy: ownerId, createdAt: stamp(closeDay + 20) });
          }
        }
      }
    }
    if (pub && !archived) {
      const since = Math.min(start, T);
      for (const role of ['gestor', 'fiscal_tecnico'] as const) push('contract_parties', { tenantId, contractId: id, role, name: `${pick(FIRST)} ${pick(LAST)} (fictício)`, email: `${role}.${id.slice(0, 6)}@orgao.test`, appointment: `Portaria ${int(10, 400)}/${yearOf(since)}`, since: isoOf(since), createdBy: ownerId, createdAt: stamp(since) });
      ev(since, 'fiscal', 'Gestor do contrato e fiscal técnico designados.');
      if (r() < 0.6) {
        const dl = T + int(-10, 120);
        push('contract_clauses', { tenantId, contractId: id, kind: pick(['obrigacao', 'entrega', 'garantia'] as const), reference: `Cláusula ${int(5, 14)}.${int(1, 6)}`, title: pick(['Relatório mensal de disponibilidade', 'Renovação da garantia contratual', 'Entrega de inventário de equipamentos', 'Comprovação de regularidade fiscal']), excerpt: 'Trecho fictício da cláusula.', deadline: isoOf(dl), remindDays: 15, createdBy: ownerId, createdAt: stamp(since) });
      }
      if (T - start > (cur.end - start) / 2 && r() < 0.55) {
        const st = pick(['solicitado', 'recebido', 'recebido'] as const);
        const day = Math.min(T, start + Math.round((cur.end - start) / 2) + int(0, 40));
        push('technical_certificates', { tenantId, contractId: id, contactId: a.id, status: st, issuer: a.name, issuedOn: st === 'recebido' ? isoOf(day) : null, services: `${product.name} — ${brl(cur.monthly)}/mês`, quantities: '1 lote', note: 'Atestado fictício', createdBy: ownerId, createdAt: stamp(day) });
        ev(day, 'atestado', `Atestado de capacidade técnica: ${st === 'recebido' ? 'Recebido' : 'Solicitado'}.`);
      }
    }
    return c;
  };

  // base anterior a 2025 (o faturamento de 2025 precisa de contratos que já existiam)
  const nLegacy = Math.round(420 * scale);
  for (let i = 0; i < nLegacy; i++) {
    const a = r() < 0.4 ? pick(pubAccs) : pick(privAccs);
    const product = PRODUCTS[pick(a.nature === 'publica' ? PUBLIC_PRODUCTS : PRIVATE_PRODUCTS)]!;
    const monthly = Math.round(between(product.min, product.max) / 1000) * 1000;
    buildContract(a, product, monthly, D0 - int(20, 1000), null, a.ownerId, true);
  }

  // ---------------- negociações (coortes mensais com crescimento e sazonalidade)
  const months: number[] = [];
  for (let m = D0; m <= T; m = addMonthsDay(m, 1)) months.push(m);
  const STAGE_MEAN: Record<string, number> = { novo_lead: 3, diagnostico: 8, visita_tecnica: 9, proposta: 16, negociacao: 12 };
  let oppCount = 0;
  for (const [mi, m0] of months.entries()) {
    const month = Number(isoOf(m0).slice(5, 7));
    const season = month === 12 || month === 1 ? 0.7 : month === 2 ? 0.85 : month >= 9 && month <= 11 ? 1.15 : 1;
    const n = Math.round(52 * scale * Math.pow(1.022, mi) * season);
    const mEnd = Math.min(addMonthsDay(m0, 1) - 1, T);
    for (let k = 0; k < n; k++) {
      const created = m0 + Math.floor(r() * (mEnd - m0 + 1));
      if (created > T) continue;
      const pub = r() < 0.42;
      const a = pick(pub ? pubAccs : privAccs);
      // consumo de contrato: conta com contrato de medição vigente nessa data
      const meas = ctrs.filter((c) => c.accId === a.id && c.billing === 'medicao' && c.start <= created && c.end >= created && !c.ended);
      let kind: SaleKind = pub ? weighted<SaleKind>([['licitacao', 55], ['adesao_ata', 20], ['consumo_contrato', 25]]) : weighted<SaleKind>([['venda_consultiva', 88], ['consumo_contrato', 12]]);
      if (kind === 'consumo_contrato' && !meas.length) kind = pub ? 'licitacao' : 'venda_consultiva';
      const product = kind === 'consumo_contrato' ? meas[0]!.product : PRODUCTS[pick(pub ? PUBLIC_PRODUCTS : PRIVATE_PRODUCTS)]!;
      const big = kind === 'licitacao' ? 1.6 : 1;
      const monthly = Math.round((between(product.min, product.max) * big) / 1000) * 1000;
      const value = kind === 'consumo_contrato' ? Math.round((meas[0]!.saldo / 12) * between(0.2, 0.8)) : product.billing === 'medicao' ? monthly * 12 : monthly;
      const owner = a.ownerId;
      const id = randomUUID();
      oppCount++;
      // caminho pelas etapas
      const win = r() < WIN[kind] * (pub ? 1 : 1) * (mi > 12 ? 1.06 : 1);
      const lostAtIdx = win ? -1 : weighted<number>(stages.map((_, i) => [i, [8, 22, 18, 30, 22][i] ?? 10]));
      const path: { at: number; to: string }[] = [{ at: created, to: stages[0]! }];
      let t = created;
      const lastIdx = win ? stages.length - 1 : lostAtIdx;
      const mult = kind === 'licitacao' ? 1.5 : kind === 'consumo_contrato' ? 0.35 : kind === 'adesao_ata' ? 0.8 : 1;
      let i = 0;
      while (i < lastIdx) {
        t += Math.max(0.3, expo(STAGE_MEAN[stages[i]!]! * mult));
        let next = i + 1;
        if ((kind === 'licitacao' || kind === 'consumo_contrato') && next < lastIdx && (stages[next] === 'diagnostico' || stages[next] === 'visita_tecnica') && r() < 0.55) next++;
        else if (kind === 'venda_consultiva' && stages[next] === 'visita_tecnica' && next < lastIdx && r() < 0.3) next++;
        path.push({ at: t, to: stages[next]! });
        i = next;
        if (stages[i] === 'negociacao' && r() < 0.08 && i <= lastIdx) { t += expo(3); path.push({ at: t, to: 'proposta' }); t += expo(4); path.push({ at: t, to: 'negociacao' }); }
      }
      t += Math.max(0.5, expo(STAGE_MEAN[stages[lastIdx]!]! * mult));
      path.push({ at: t, to: win ? 'ganha' : 'perdida' });
      const visible = path.filter((p, j) => j === 0 || p.at <= T - 0.05);
      const final = visible[visible.length - 1]!;
      const closed = final.to === 'ganha' || final.to === 'perdida';
      const reachedIdx = Math.max(...visible.map((p) => stages.indexOf(p.to)));
      const reached = (key: string) => reachedIdx >= stages.indexOf(key) || final.to === 'ganha';
      const lossReason = final.to === 'perdida' ? weighted(LOSS_W) : null;
      const title = `${product.name} — ${a.name.replace(/ \(fictíci[oa]\)$/, '')}`;
      const branch = pick(branches).id;
      const evAt = (d: number) => new Date(Math.min(nowMs - 120_000, d * DAY + 14 * 3_600_000));
      const meas0 = kind === 'consumo_contrato' ? meas[0]! : null;
      push('opportunities', {
        id, tenantId, contactId: a.id, ownerId: owner, title: title.slice(0, 160), pipelineId: pipe.id, stage: final.to, saleKind: kind, branchId: branch, valueCents: value,
        proposalStatus: final.to === 'ganha' ? 'aceita' : reached('proposta') ? (final.to === 'perdida' ? 'recusada' : 'enviada') : 'nao_criada',
        coverageStatus: reached('visita_tecnica') || reached('proposta') ? 'elegivel' : 'nao_consultada',
        reasons: [], channel: pub ? 'Portal de compras' : pick(['Telefone', 'Presencial', 'E-mail', 'WhatsApp']), sourceId: weighted(pub ? SRC_PUB : SRC_PRIV),
        nextAction: closed ? null : pick(['Enviar proposta revisada', 'Agendar visita técnica', 'Confirmar data do pregão', 'Retornar sobre aprovação do orçamento', 'Validar viabilidade com a engenharia']),
        nextActionAt: closed ? null : stamp(T + int(-3, 10)), lossReason, stageChangedAt: evAt(final.at), wonAt: final.to === 'ganha' ? evAt(final.at) : null, lostAt: final.to === 'perdida' ? evAt(final.at) : null,
        sprintElapsedSeconds: int(300, 2400), createdBy: owner, createdAt: evAt(created), updatedAt: evAt(final.at), custom: { cnpj: a.doc },
        bidMode: kind === 'licitacao' ? 'global' : null, bidGlobalCents: kind === 'licitacao' && reached('proposta') ? Math.round(value * 12 * between(0.88, 0.99)) : null,
        measurementContractId: meas0?.id ?? null, measurementCents: meas0 ? value : null, rowVersion: visible.length,
      });
      visible.forEach((p, j) => push('opportunity_events', {
        tenantId, opportunityId: id, type: j === 0 ? 'created' : 'stage_changed', actorId: owner, fromValue: j === 0 ? null : visible[j - 1]!.to, toValue: p.to,
        reason: p.to === 'perdida' ? `Perdida: ${lossReason}` : null, payload: j === 0 ? { pipeline: 'empresarial', saleKind: kind } : p.to === 'perdida' ? { lossReason } : null, rowVersion: j + 1, occurredAt: evAt(p.at), observedAt: evAt(p.at),
      }));
      // itens
      const nItems = kind === 'licitacao' ? int(2, 5) : int(1, 3);
      let left = value;
      for (let it = 0; it < nItems; it++) {
        const part = it === nItems - 1 ? left : Math.round(value * between(0.15, 0.5));
        left -= part;
        if (part <= 0) continue;
        const qty = product.unit === 'h' ? int(10, 200) : product.unit === 'km' ? int(2, 40) : int(1, 8);
        push('opportunity_items', { tenantId, opportunityId: id, position: it, description: it === 0 ? product.name : pick(['Instalação e ativação', 'Equipamentos em comodato', 'Ponto adicional', 'Suporte 24x7', 'Treinamento da equipe']), unit: product.unit, qtyMilli: qty * 1000, unitCents: Math.max(1, Math.round(part / qty)), createdBy: owner, createdAt: evAt(created) });
      }
      // participantes do pregão
      if (kind === 'licitacao' && reached('proposta')) {
        const n2 = int(2, 6);
        const ours = Math.round(value * 12 * between(0.88, 0.99));
        const comps = [...COMPETITORS].sort(() => r() - 0.5).slice(0, n2);
        const weWin = final.to === 'ganha';
        const winnerIdx = weWin ? -1 : final.to === 'perdida' ? 0 : -2;
        push('bid_participants', { tenantId, opportunityId: id, position: 0, company: 'Nós (BKT)', lot: 'Único', bidCents: ours, status: 'ativo', winner: weWin, isUs: true, createdBy: owner, createdAt: evAt(path[3]?.at ?? created) });
        comps.forEach((cName, ci) => push('bid_participants', {
          tenantId, opportunityId: id, position: ci + 1, company: `${cName} (fictícia)`, document: cnpj(r), lot: 'Único',
          bidCents: ci === winnerIdx ? Math.round(ours * between(0.86, 0.98)) : Math.round(ours * between(1.01, 1.3)), status: r() < 0.1 ? 'desclassificado' : 'ativo', winner: ci === winnerIdx, isUs: false, createdBy: owner, createdAt: evAt(path[3]?.at ?? created),
        }));
      }
      // atividades: contato em cada etapa, viabilidade da engenharia/infraestrutura, próxima ação
      for (const [j, p] of visible.entries()) {
        if (p.to === 'ganha' || p.to === 'perdida') continue;
        const until = visible[j + 1]?.at ?? T;
        const nAct = int(1, 3);
        for (let q = 0; q < nAct; q++) {
          const due = p.at + (until - p.at) * r();
          if (due > T - 0.1) continue;
          const type = weighted<string>([['ligacao', 35], ['email', 25], ['reuniao', 20], ['whatsapp', 12], ['visita', 8]]);
          push('activities', { tenantId, type, title: `${{ ligacao: 'Ligação', email: 'E-mail', reuniao: 'Reunião', whatsapp: 'WhatsApp', visita: 'Visita' }[type]} — ${a.name.slice(0, 50)}`, notes: 'Contato registrado (fictício)', dueAt: stamp(Math.floor(due)), priority: 'media', ownerId: owner, opportunityId: id, contactId: a.id, completedAt: stamp(Math.floor(due), 17), completedBy: owner, status: 'concluida', createdBy: owner, createdAt: stamp(Math.floor(p.at)), updatedAt: stamp(Math.floor(due), 17) });
        }
        if ((p.to === 'visita_tecnica' || (p.to === 'proposta' && j <= 2)) && r() < 0.85) {
          for (const cat of r() < 0.55 ? ['Viabilidade - Engenharia', 'Viabilidade - Infraestrutura'] : [pick(['Viabilidade - Engenharia', 'Viabilidade - Infraestrutura'])]) {
            const improve = 1 - Math.min(0.35, mi * 0.015);
            const lead = Math.max(0.2, expo((cat.endsWith('Engenharia') ? 3.5 : 5) * improve));
            const doneAt = p.at + lead;
            const done = doneAt <= T - 0.05;
            push('activities', { tenantId, type: 'tarefa', title: `${cat}: ${a.name.slice(0, 60)}`, notes: 'Análise de viabilidade técnica (fictício)', category: cat, dueAt: stamp(Math.floor(p.at + 5)), priority: 'alta', ownerId: ops, opportunityId: id, contactId: a.id, completedAt: done ? new Date(Math.min(nowMs - 60_000, doneAt * DAY + 12 * 3_600_000)) : null, completedBy: done ? ops : null, status: done ? 'concluida' : 'em_andamento', createdBy: owner, createdAt: new Date(p.at * DAY + 12 * 3_600_000), updatedAt: stamp(Math.min(T, Math.floor(doneAt))) });
          }
        }
      }
      if (!closed) push('activities', { tenantId, type: pick(['ligacao', 'reuniao', 'email', 'tarefa']), title: `Próxima ação — ${a.name.slice(0, 60)}`, notes: 'Acompanhar decisão do cliente (fictício)', dueAt: stamp(T + int(-4, 10)), priority: pick(['media', 'alta']), ownerId: owner, opportunityId: id, contactId: a.id, status: 'a_fazer', createdBy: owner, createdAt: stamp(Math.floor(final.at)), updatedAt: stamp(Math.floor(final.at)) });
      // lead de origem (vendas privadas)
      if (!pub && r() < 0.45) push('leads', { tenantId, contactId: a.id, status: 'convertido', sourceId: weighted(SRC_PRIV), ownerId: owner, channel: pick(['Site', 'WhatsApp', 'Telefone', 'Evento']), interests: [product.name], firstContactAt: stamp(Math.floor(created - 1)), lastContactAt: stamp(Math.floor(created)), lastInteractionNote: 'Convertido em oportunidade', convertedOpportunityId: id, createdBy: owner, createdAt: stamp(Math.floor(created - between(1, 6))), updatedAt: stamp(Math.floor(created)) });
      // venda ganha vira contrato; consumo sai do saldo do contrato de medição
      if (final.to === 'ganha') {
        const wonDay = Math.floor(final.at);
        if (kind === 'consumo_contrato' && meas0) {
          push('contract_ledger', { tenantId, contractId: meas0.id, kind: 'consumo', amountCents: value, occurredOn: isoOf(wonDay), description: `Consumo da negociação ganha: ${title.slice(0, 80)}`, opportunityId: id, createdBy: owner, createdAt: stamp(wonDay) });
          push('contract_events', { tenantId, contractId: meas0.id, type: 'consumo', actorId: owner, summary: `Consumo de ${brl(value)}: negociação ganha`, payload: { opportunityId: id }, occurredAt: stamp(wonDay) });
        } else if (wonDay + 3 <= T) {
          buildContract(a, product, monthly, wonDay + int(3, 20), id, owner, false);
        }
      }
    }
  }
  // leads que não viraram negociação
  const nLooseLeads = Math.round(oppCount * 0.6);
  for (let i = 0; i < nLooseLeads; i++) {
    const created = D0 + Math.floor(Math.pow(r(), 0.8) * (T - D0));
    const a = pick(privAccs);
    const st = weighted<string>([['descartado', 45], ['qualificado', 15], ['em_contato', 25], ['novo', 15]]);
    push('leads', { tenantId, contactId: a.id, status: st, sourceId: weighted(SRC_PRIV), ownerId: a.ownerId, channel: pick(['Site', 'WhatsApp', 'Telefone', 'Evento', 'Instagram']), interests: [pick(PRODUCTS).name], firstContactAt: st === 'novo' ? null : stamp(created + 1), lastContactAt: st === 'novo' ? null : stamp(Math.min(T, created + int(1, 10))), lastInteractionNote: st === 'descartado' ? 'Sem perfil no momento' : 'Em conversa', createdBy: a.ownerId, createdAt: stamp(created), updatedAt: stamp(Math.min(T, created + 2)) });
  }

  // ---------------- Sucesso do Cliente: pesquisas trimestrais e saúde por trimestre (histórico)
  const ctrAccs = [...new Set(ctrs.map((c) => c.accId))];
  for (const accId of ctrAccs) {
    const first = Math.min(...ctrs.filter((c) => c.accId === accId).map((c) => c.start));
    const base = between(55, 95);
    // risco de cancelamento informado pelo CS e acompanhamentos de relacionamento (contatos, visitas, reuniões)
    const risk = base > 80 ? 'baixo' : base > 65 ? weighted<string>([['baixo', 70], ['medio', 30]]) : weighted<string>([['medio', 60], ['alto', 40]]);
    push('cs_accounts', { tenantId, contactId: accId, csmId: sup, churnRisk: risk, createdAt: stamp(Math.max(first, D0)) });
    for (let d = Math.max(first + 20, D0); d <= T - 2; d += int(25, base > 75 ? 50 : 110)) {
      const kind = weighted<string>([['contato', 55], ['reuniao', 25], ['visita', 15], ['contratual', 5]]);
      push('activities', { tenantId, type: kind === 'contato' ? 'ligacao' : kind === 'visita' ? 'visita' : kind === 'reuniao' ? 'reuniao' : 'tarefa', title: `Acompanhamento de conta (${kind})`, notes: 'Acompanhamento do Sucesso do Cliente (fictício)', dueAt: stamp(d), priority: 'media', ownerId: sup, contactId: accId, csKind: kind, csPlannedAt: isoOf(d), completedAt: stamp(d, 16), completedBy: sup, csResult: pick(['Cliente satisfeito com o serviço', 'Alinhado plano de expansão', 'Tratada reclamação de lentidão', 'Apresentado roadmap de produtos', 'Revisado SLA do último trimestre']), status: 'concluida', createdBy: sup, createdAt: stamp(d - 7), updatedAt: stamp(d, 16) });
    }
    for (let q = Math.max(first + 90, D0); q <= T; q += 91) {
      if (r() < 0.65) push('cs_surveys', { tenantId, contactId: accId, kind: 'NPS', score: Math.max(0, Math.min(10, Math.round(base / 10 + between(-2, 1.5)))), scale: 10, respondent: `${pick(FIRST)} ${pick(LAST)} (fictício)`, comment: null, respondedAt: isoOf(q), actorId: sup, createdAt: stamp(q) });
      const score = Math.round(Math.max(20, Math.min(100, base + between(-12, 10))));
      push('cs_assessments', { tenantId, contactId: accId, kind: 'saude', data: { demo: true }, score, level: score >= 75 ? 'Saudável' : score >= 50 ? 'Atenção' : 'Em risco', ruleVersion: 0, actorId: null, createdAt: stamp(q) });
    }
  }

  // ---------------- gravação em lote, na ordem das dependências
  const ORDER: [string, unknown][] = [
    ['contacts', s.contacts], ['opportunities', s.opportunities], ['opportunity_events', s.opportunityEvents], ['opportunity_items', s.opportunityItems], ['bid_participants', s.bidParticipants],
    ['leads', s.leads], ['activities', s.activities], ['contracts', s.contracts], ['contract_versions', s.contractVersions], ['contract_events', s.contractEvents], ['contract_processes', s.contractProcesses],
    ['contract_amendments', s.contractAmendments], ['contract_ledger', s.contractLedger], ['contract_commitments', s.contractCommitments], ['contract_slas', s.contractSlas],
    ['contract_sla_measurements', s.contractSlaMeasurements], ['contract_occurrences', s.contractOccurrences], ['contract_occurrence_updates', s.contractOccurrenceUpdates], ['contract_parties', s.contractParties],
    ['contract_clauses', s.contractClauses], ['technical_certificates', s.technicalCertificates], ['cs_accounts', s.csAccounts], ['cs_surveys', s.csSurveys], ['cs_assessments', s.csAssessments],
  ];
  // contratos precisam existir antes das oportunidades que apontam para eles (consumo) e vice-versa: grava contratos sem a oportunidade e liga depois
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    const insert = async (name: string, table: unknown, rows: Row[]) => {
      if (!rows.length) return;
      const cols = Math.max(...rows.slice(0, 20).map((x) => Object.keys(x).length));
      const size = Math.max(50, Math.floor(30_000 / cols));
      for (let i = 0; i < rows.length; i += size) await tx.insert(table as typeof s.contacts).values(rows.slice(i, i + size) as never);
      counts[name] = rows.length;
    };
    const oppOfContract = new Map((out.contracts ?? []).map((c) => [c.id as string, c.opportunityId as string | null]));
    await insert('contacts', s.contacts, out.contacts ?? []);
    await insert('contracts', s.contracts, (out.contracts ?? []).map((c) => ({ ...c, opportunityId: null })));
    for (const [name, table] of ORDER) if (name !== 'contacts' && name !== 'contracts') await insert(name, table, out[name] ?? []);
    const links = [...oppOfContract].filter(([, o]) => o);
    for (let i = 0; i < links.length; i += 500) {
      const chunk = links.slice(i, i + 500);
      await tx.execute(sql`update contracts c set opportunity_id = v.opp::uuid from (values ${sql.join(chunk.map(([cid, o]) => sql`(${cid}, ${o})`), sql`, `)}) as v(cid, opp) where c.id = v.cid::uuid`);
    }
  });
  counts.lead_time_categorias = await setLeadTimeCategories(db, tenantId, mgr) ? 1 : 0;
  try { counts.cards_cs = await demoAccountCards(db, tenantId); } catch (e) { counts.cards_cs = -1; console.warn('[ops-demo] cards do CS', e); }
  // fotografia atual das contas (Tier, saúde, criticidade)
  try { counts.contas_cs = await recomputeAccounts(db, tenantId); } catch (e) { counts.contas_cs = -1; console.warn('[ops-demo] recomputeAccounts falhou', e); }
  return counts;
}

/** Quantos registros da operação fictícia existem (para a tela de dados de demonstração). */
export async function opsDemoSummary(db: DbOrTx, tenantId: string) {
  const r = await db.execute<{ contas: number; negociacoes: number; contratos: number }>(sql`
    select (select count(*)::int from contacts where tenant_id = ${tenantId} and source_system = ${OPS_SOURCE}) contas,
           (select count(*)::int from opportunities o join contacts c on c.id = o.contact_id where o.tenant_id = ${tenantId} and c.source_system = ${OPS_SOURCE}) negociacoes,
           (select count(*)::int from contracts k join contacts c on c.id = k.contact_id where k.tenant_id = ${tenantId} and c.source_system = ${OPS_SOURCE}) contratos`);
  return r.rows[0]!;
}


export const DEMO_TASK_CATEGORIES = ['Viabilidade - Engenharia', 'Viabilidade - Infraestrutura'];
/** Indicador "Lead time viabilidade" sem categorias escolhidas passa a usar as das tarefas fictícias (nova versão da ficha). */
async function setLeadTimeCategories(db: DB, tenantId: string, actorId: string) {
  const r = await db.execute<{ id: string; current_version: number; def: Record<string, unknown> }>(sql`
    select i.id, i.current_version, v.def from indicators i join indicator_versions v on v.indicator_id = i.id and v.version = i.current_version
     where i.tenant_id = ${tenantId} and i.key = 'kpi_lead_time_viabilidade' limit 1`);
  const i = r.rows[0];
  if (!i) return false;
  const sheet = (i.def.sheet ?? {}) as Record<string, unknown>;
  if (Array.isArray(sheet.taskCategories) && sheet.taskCategories.length) return false;
  await db.transaction(async (tx) => {
    await tx.insert(s.indicatorVersions).values({ tenantId, indicatorId: i.id, version: i.current_version + 1, def: { ...i.def, sheet: { ...sheet, taskCategories: DEMO_TASK_CATEGORIES } } as never, note: 'Categorias de tarefa da operação fictícia (ajuste na ficha quando criar os tipos reais)', createdBy: actorId });
    await tx.update(s.indicators).set({ currentVersion: i.current_version + 1 }).where(eq(s.indicators.id, i.id));
  });
  return true;
}

/**
 * Funil Sucesso do Cliente da operação fictícia: um card por conta com contrato vigente, com os contratos dela
 * e etapas distribuídas (a maioria em acompanhamento). Idempotente: conta que já tem card não ganha outro.
 */
export async function demoAccountCards(db: DB, tenantId: string, seed = 99) {
  const { accountContracts, ensureAccountCard } = await import('./customerSuccess');
  const r = rng(seed);
  const accs = await db.execute<{ id: string; csm: string | null }>(sql`
    select c.id, (select k.csm_id from contracts k where k.contact_id = c.id and k.csm_id is not null limit 1) csm from contacts c
     where c.tenant_id = ${tenantId} and c.source_system = ${OPS_SOURCE}
       and exists (select 1 from contracts k where k.contact_id = c.id and k.stage <> 'arquivado' and k.validated_at is not null and k.arp_id is null)`);
  const STAGES: [string, number][] = [['acionado', 10], ['planejamento', 15], ['diagnostico', 18], ['plano_acao', 15], ['acompanhamento', 42]];
  const ORDER = ['acionado', 'planejamento', 'diagnostico', 'plano_acao', 'acompanhamento'];
  let n = 0;
  for (const a of accs.rows) {
    const card = await ensureAccountCard(db, tenantId, null, { contactId: a.id, sourceOpportunityId: null, ownerId: a.csm, reason: 'Operação fictícia: conta com contrato vigente' });
    if (!card.created) continue;
    n++;
    const list = await accountContracts(db, tenantId, [a.id]);
    for (const c of [...list].reverse()) {
      await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: card.id, type: 'contrato_incluido', actorId: null, payload: { contractId: c.id, number: c.number, object: c.object, monthlyCents: c.monthlyCents, billingType: c.billingType, kind: c.kind, endAt: c.endAt }, occurredAt: c.validatedAt ?? new Date() });
    }
    let x = r() * 100, target = 'acompanhamento';
    for (const [k, w] of STAGES) if ((x -= w) <= 0) { target = k; break; }
    const steps = ORDER.slice(1, ORDER.indexOf(target) + 1);
    let prev = 'acionado';
    for (const st of steps) { await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: card.id, type: 'stage_changed', actorId: null, fromValue: prev, toValue: st, reason: 'Operação fictícia' }); prev = st; }
    const monthly = list.filter((c) => c.billingType === 'recorrente').reduce((t, c) => t + c.monthlyCents, 0);
    await db.update(s.opportunities).set({ stage: target, stageChangedAt: new Date(Date.now() - Math.floor(r() * 40) * DAY), valueCents: monthly, nextAction: pick(r, ['Agendar reunião de acompanhamento', 'Revisar SLA do trimestre', 'Apresentar plano de expansão', 'Coletar pesquisa de satisfação']), nextActionAt: new Date(Date.now() + Math.floor(r() * 12 - 3) * DAY) }).where(eq(s.opportunities.id, card.id));
  }
  return n;
}
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)] as T;
