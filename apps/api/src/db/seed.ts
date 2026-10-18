/**
 * Seed 100% FICTÍCIA e determinística (spec §11) para demonstrar as telas Yepnet.
 * Pessoas, telefones (DDD 00, inexistente), e-mails (.test), planos e preços são inventados.
 * Clientes vêm marcados `seed_ficticio`: não representam a base real do IXC.
 * Datas são relativas ao momento da execução (últimos ~6 meses).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ACCESS, MODULES, OPPORTUNITY_STAGES, PROFILE_KEYS, PROFILE_LABELS, type ProfileKey } from '@isp/domain';
import { createHash } from 'node:crypto';
import { getActiveInstruction } from '../services/instructions';
import { createDb, type DB } from './client';
import * as s from './schema';
import { hashPassword } from '../auth/password';

export const SEED_PASSWORD = 'Sprint@2026';

/** PDF mínimo válido com texto fictício (só para demonstração). */
function fakeProposalPdf(client: string, plan: string, cents: number) {
  const ascii = (t: string) => t.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '');
  const lines = ['PROPOSTA COMERCIAL - DADOS FICTICIOS', `Cliente: ${ascii(client)}`, `Plano: ${ascii(plan)}`, `Valor mensal: R$ ${(cents / 100).toFixed(2).replace('.', ',')}`];
  const stream = `BT /F1 14 Tf 60 760 Td ${lines.map((l, i) => `${i ? '0 -24 Td ' : ''}(${l}) Tj`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function rng(seed = 42) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Mariana', 'Rafael', 'Sabrina', 'Diego', 'Juliana', 'Lucas', 'Fernanda', 'Neto', 'Carlos', 'Pedro', 'Gustavo', 'Ricardo', 'Thaís', 'Rodrigo', 'Vitória', 'Larissa', 'Felipe', 'Marcela', 'Bruno', 'Ana Paula', 'João', 'Beatriz', 'Henrique', 'Camila', 'Eduardo', 'Patrícia', 'Renato', 'Aline', 'Sérgio', 'Débora'];
const LAST = ['Costa', 'Lima', 'Oliveira', 'Santos', 'Ribeiro', 'Cardoso', 'Alves', 'Vieira', 'Mendes', 'Ferreira', 'Teixeira', 'Barbosa', 'Correia', 'Martins', 'Torres', 'Souza', 'Cunha', 'Rocha', 'Carvalho', 'Pereira'];
const ORGS = ['Prefeitura de Estância', 'Secretaria de Educação', 'SEPLAG', 'Câmara de Lagarto', 'Colégio Horizonte', 'Clínica Bem Viver', 'Padaria Pão Quente', 'Mercadinho Central', 'Oficina Rota 101', 'Escola Saber Mais'];
// Cidades reais de Sergipe (dado geográfico público), com peso para Aracaju.
const CITIES: [string, number][] = [
  ['Aracaju', 38], ['Nossa Senhora do Socorro', 15], ['São Cristóvão', 11], ['Estância', 8], ['Lagarto', 7], ['Itabaiana', 5],
  ['Barra dos Coqueiros', 4], ['Tobias Barreto', 3], ['Simão Dias', 2], ['Propriá', 2], ['Itaporanga d\'Ajuda', 2], ['Capela', 2], ['Boquim', 1],
];
const SOURCES: [string, number][] = [['WhatsApp', 27], ['Site', 23], ['Indicação', 20], ['Campanha', 13], ['Instagram', 11], ['Evento', 3], ['Tráfego', 3]];
const INTERESTS = ['Oferta', 'Velocidade', 'Benefícios', 'Curiosidade', 'Preço', 'Estabilidade'];
const CHANNELS = ['WhatsApp', 'Telefone', 'Site', 'Instagram', 'Presencial'];
const INTERACTIONS = ['Formulário site', 'Ligação realizada', 'Proposta enviada', 'WhatsApp', 'Reunião agendada', 'Direct Instagram'];

export async function seedTenant(
  db: DB,
  opts: {
    name: string;
    slug: string;
    users: { name: string; email: string; profiles: ProfileKey[]; jobTitle: string; teams: string[]; leads?: string[]; goals?: [number, number, number] }[];
    volume: number;
    seed: number;
  },
) {
  const r = rng(opts.seed);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)] as T;
  const weighted = <T,>(arr: [T, number][]) => {
    const total = arr.reduce((a, [, w]) => a + w, 0);
    let x = r() * total;
    for (const [v, w] of arr) if ((x -= w) <= 0) return v;
    return arr[0]![0];
  };
  const now = Date.now();
  const DAY = 86_400_000;
  const at = (daysFromNow: number, hour: number, minute = 0) => {
    const d = new Date(now + daysFromNow * DAY);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  // datas recentes com mais peso (curva de crescimento para os gráficos)
  const recentDay = () => Math.floor(Math.pow(r(), 1.6) * 170);

  const [tenant] = await db.insert(s.tenants).values({ name: opts.name, slug: opts.slug }).returning();
  if (!tenant) throw new Error('tenant');

  const roleIds: Record<string, string> = {};
  for (const key of PROFILE_KEYS) {
    const [role] = await db.insert(s.roles).values({ tenantId: tenant.id, key, name: PROFILE_LABELS[key], isSystem: true }).returning();
    roleIds[key] = role!.id;
    await db.insert(s.accessPolicies).values(MODULES.map((module) => ({ roleId: role!.id, module, level: DEFAULT_ACCESS[key][module] })));
  }

  const teamNames = [...new Set(opts.users.flatMap((u) => u.teams))];
  const teamIds: Record<string, string> = {};
  for (const name of teamNames) {
    const [t] = await db.insert(s.teams).values({ tenantId: tenant.id, name }).returning();
    teamIds[name] = t!.id;
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const users: { id: string; profiles: ProfileKey[] }[] = [];
  for (const u of opts.users) {
    const [user] = await db
      .insert(s.users)
      .values({ tenantId: tenant.id, name: u.name, email: u.email, passwordHash, jobTitle: u.jobTitle, goalSales: u.goals?.[0] ?? 8, goalProposals: u.goals?.[1] ?? 10, goalLeads: u.goals?.[2] ?? 40 })
      .returning();
    users.push({ id: user!.id, profiles: u.profiles });
    await db.insert(s.userRoles).values(u.profiles.map((k) => ({ userId: user!.id, roleId: roleIds[k]! })));
    for (const t of u.teams) await db.insert(s.teamMemberships).values({ teamId: teamIds[t]!, userId: user!.id, isLead: !!u.leads?.includes(t) });
  }
  const sellers = users.map((u) => u.id); // todos vendem, inclusive gerência e supervisão
  const sellerWeights: [string, number][] = sellers.map((id, i) => [id, [5, 4, 4, 3, 2][i] ?? 2]);

  const sources = await db.insert(s.leadSources).values(SOURCES.map(([name]) => ({ tenantId: tenant.id, name }))).returning();
  const sourceByName = Object.fromEntries(sources.map((x) => [x.name, x.id]));
  const [campaign] = await db.insert(s.campaigns).values({ tenantId: tenant.id, name: 'Campanha Fibra — Outubro (fictícia)', sourceId: sourceByName['Campanha'], startsOn: at(-25, 0) }).returning();

  const planRows = await db
    .insert(s.plans)
    .values([
      { tenantId: tenant.id, name: '350 Mega', line: 'Yep Mais', segment: 'residencial', priceCents: 9990 },
      { tenantId: tenant.id, name: '450 Mega', line: 'Yep Mais', segment: 'residencial', priceCents: 11990 },
      { tenantId: tenant.id, name: '500 Mega', line: 'Yep Família', segment: 'residencial', priceCents: 13990 },
      { tenantId: tenant.id, name: '800 Mega', line: 'Yep Ultra', segment: 'residencial', priceCents: 16990 },
      { tenantId: tenant.id, name: 'Link Dedicado', line: 'Empresas', segment: 'empresarial', priceCents: 24990 },
      { tenantId: tenant.id, name: 'Solução Educ+', line: 'Institucional', segment: 'institucional', priceCents: 49990 },
    ])
    .returning();
  const planWeights: [typeof planRows[number], number][] = [[planRows[0]!, 17], [planRows[1]!, 8], [planRows[2]!, 25], [planRows[3]!, 42], [planRows[4]!, 12], [planRows[5]!, 4]];

  // jornadas vêm do modelo de instrução inicial (Residencial e Empresarial)
  await getActiveInstruction(db, tenant.id);
  const pipes = await db.select().from(s.pipelines).where(eq(s.pipelines.tenantId, tenant.id));
  const pipeRes = pipes.find((p) => p.key === 'residencial')!;
  const pipeEmp = pipes.find((p) => p.key === 'empresarial')!;
  const EMP_STAGE: Record<string, string> = { qualificacao: 'diagnostico', cobertura: 'visita_tecnica', fechamento: 'negociacao' };

  const makeContact = async (ownerId: string | null, segment?: 'residencial' | 'empresarial' | 'governamental' | 'institucional') => {
    const seg = segment ?? (r() < 0.78 ? 'residencial' : 'empresarial');
    const name = seg === 'governamental' || seg === 'institucional' ? pick(ORGS) : `${pick(FIRST)} ${pick(LAST)}`;
    const digits = String(Math.floor(r() * 90_000_000) + 10_000_000);
    const [c] = await db
      .insert(s.contacts)
      .values({
        tenantId: tenant.id,
        name,
        phone: `(00) 9 ${digits.slice(0, 4)}-${digits.slice(4)}`,
        email: r() > 0.5 ? `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}${Math.floor(r() * 99)}@exemplo.test` : null,
        ownerId,
        segment: seg,
        city: weighted(CITIES),
      })
      .returning();
    return c!;
  };

  // ---------- leads
  const leadStatus: ['novo' | 'em_contato' | 'qualificado' | 'descartado', number][] = [['novo', 25], ['em_contato', 37], ['qualificado', 27], ['descartado', 11]];
  for (let i = 0; i < opts.volume * 3; i++) {
    const ownerId = r() > 0.06 ? weighted(sellerWeights) : null;
    const c = await makeContact(ownerId);
    const created = at(-recentDay(), 8 + Math.floor(r() * 10), Math.floor(r() * 60));
    const status = weighted(leadStatus);
    const contacted = status !== 'novo';
    const first = contacted ? new Date(created.getTime() + r() * 30 * 3_600_000) : null;
    const last = first ? new Date(Math.min(now - 600_000, first.getTime() + r() * 5 * DAY)) : created;
    await db.insert(s.leads).values({
      tenantId: tenant.id,
      contactId: c.id,
      status,
      sourceId: sourceByName[weighted(SOURCES)],
      campaignId: r() > 0.85 ? campaign!.id : null,
      ownerId,
      channel: pick(CHANNELS),
      interests: [pick(INTERESTS)],
      nextAction: status === 'descartado' ? null : pick(['Enviar condições da oferta', 'Verificar cobertura no endereço', 'Retornar com comparação', 'Agendar visita técnica']),
      nextActionAt: status === 'descartado' ? null : new Date(Math.max(created.getTime() + 3_600_000, now + (r() * 6 - 2) * DAY)),
      firstContactAt: first,
      lastContactAt: first ? last : null,
      lastInteractionNote: pick(INTERACTIONS),
      createdAt: created,
      updatedAt: last,
    });
  }

  // ---------- oportunidades + eventos
  const stageW: [(typeof OPPORTUNITY_STAGES)[number], number][] = [['novo_lead', 10], ['qualificacao', 8], ['cobertura', 7], ['proposta', 8], ['fechamento', 6], ['ganha', 30], ['perdida', 8]];
  const opps: { id: string; ownerId: string; contactId: string; stage: string; segment: string }[] = [];
  for (let i = 0; i < opts.volume * 2; i++) {
    const ownerId = weighted(sellerWeights);
    const plan = weighted(planWeights);
    const c = await makeContact(ownerId, plan.segment === 'institucional' ? 'institucional' : plan.segment === 'empresarial' ? (r() > 0.7 ? 'governamental' : 'empresarial') : 'residencial');
    const baseStage = weighted(stageW);
    const business = c.segment !== 'residencial';
    const stage = business ? (EMP_STAGE[baseStage] ?? baseStage) : baseStage;
    const terminal = stage === 'ganha' || stage === 'perdida';
    const created = terminal ? at(-recentDay() - 3, 9 + Math.floor(r() * 8), Math.floor(r() * 60)) : at(-Math.floor(Math.pow(r(), 1.3) * 50), 8 + Math.floor(r() * 9), Math.floor(r() * 60));
    const changed = new Date(Math.min(now - 3_600_000, created.getTime() + (1 + r() * 12) * DAY));
    const [o] = await db
      .insert(s.opportunities)
      .values({
        tenantId: tenant.id,
        contactId: c.id,
        ownerId,
        title: `${plan.name} — ${c.segment === 'residencial' ? 'Internet residencial' : 'Internet empresarial'}`,
        pipelineId: business ? pipeEmp.id : pipeRes.id,
        stage,
        planId: plan.id,
        reasons: [pick(['oferta', 'comparacao', 'nova_instalacao', 'satisfeito_aberto', 'problema'] as const)],
        channel: pick(CHANNELS),
        sourceId: sourceByName[weighted(SOURCES)],
        valueCents: plan.priceCents,
        coverageStatus: ['proposta', 'fechamento', 'ganha'].includes(baseStage) ? 'elegivel' : baseStage === 'cobertura' ? 'pendente' : 'nao_consultada',
        proposalStatus: baseStage === 'ganha' ? 'aceita' : ['proposta', 'fechamento'].includes(baseStage) ? 'enviada' : 'nao_criada',
        // nenhuma venda da seed tem contrato confirmado: isso exige confirmação externa (IXC)
        contractRequestStatus: baseStage === 'ganha' || baseStage === 'fechamento' ? 'pendente' : 'nao_solicitada',
        nextAction: terminal ? null : pick(['Retornar com comparação', 'Verificar cobertura no endereço', 'Enviar condições da oferta', 'Confirmar decisão com cliente', 'Agendar instalação']),
        nextActionAt: terminal ? null : at(Math.floor(r() * 4) - 1, 9 + Math.floor(r() * 8), [0, 15, 30, 45][Math.floor(r() * 4)]!),
        lossReason: stage === 'perdida' ? pick(['preco', 'sem_cobertura', 'satisfeito_atual', 'sem_resposta']) : null,
        wonAt: stage === 'ganha' ? changed : null,
        lostAt: stage === 'perdida' ? changed : null,
        stageChangedAt: terminal ? changed : created,
        sprintElapsedSeconds: Math.floor(240 + r() * 420),
        createdBy: ownerId,
        createdAt: created,
        updatedAt: terminal ? changed : created,
      })
      .returning();
    opps.push({ id: o!.id, ownerId, contactId: c.id, stage, segment: c.segment });
    if (['fechamento', 'ganha'].includes(baseStage)) {
      const pdf = fakeProposalPdf(c.name, plan.name, plan.priceCents);
      await db.insert(s.opportunityAttachments).values({ tenantId: tenant.id, opportunityId: o!.id, kind: 'proposta', filename: `Proposta ${plan.name} - ${c.name}.pdf`, mime: 'application/pdf', sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), data: pdf, uploadedBy: ownerId, createdAt: changed });
    }
    // boa parte das oportunidades nasceu de um lead convertido (alimenta o funil por coorte da Inteligência)
    if (r() < 0.55) {
      const leadCreated = new Date(created.getTime() - (2 + r() * 48) * 3_600_000);
      await db.insert(s.leads).values({
        tenantId: tenant.id, contactId: c.id, status: 'convertido', ownerId, sourceId: sourceByName[weighted(SOURCES)], channel: pick(CHANNELS),
        interests: [pick(INTERESTS)], firstContactAt: new Date(leadCreated.getTime() + 3_600_000), lastContactAt: created, lastInteractionNote: 'Convertido em oportunidade',
        convertedOpportunityId: o!.id, createdAt: leadCreated, updatedAt: created,
      });
    }
    await db.insert(s.opportunityEvents).values({ tenantId: tenant.id, opportunityId: o!.id, type: 'created', actorId: ownerId, toValue: 'novo_lead', rowVersion: 1, occurredAt: created, observedAt: created });
    if (stage !== 'novo_lead') {
      const when = terminal ? changed : created;
      await db.insert(s.opportunityEvents).values({ tenantId: tenant.id, opportunityId: o!.id, type: 'stage_changed', actorId: ownerId, fromValue: 'novo_lead', toValue: stage, rowVersion: 1, occurredAt: when, observedAt: when });
    }
  }

  // ---------- clientes (fictícios, marcados): a base real virá do IXC (Fases 3/4)
  const lifeW: ['ativo' | 'em_implantacao' | 'inadimplente' | 'cancelado', number][] = [['ativo', 88], ['em_implantacao', 4], ['inadimplente', 3], ['cancelado', 5]];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  for (let i = 0; i < Math.round(opts.volume * 6.6); i++) {
    const ownerId = weighted(sellerWeights);
    const plan = weighted(planWeights);
    const seg = plan.segment === 'institucional' ? 'institucional' : plan.segment === 'empresarial' ? (r() > 0.75 ? 'governamental' : 'empresarial') : 'residencial';
    const c = await makeContact(ownerId, seg);
    const start = at(-30 - Math.floor(r() * 600), 0);
    const anniversary = new Date(start);
    while (anniversary.getTime() < now) anniversary.setFullYear(anniversary.getFullYear() + 1);
    const ext = `FIC-${opts.seed}${String(10000 + i)}`;
    const ingested = i % 9 === 0 ? at(-3, 6) : at(0, 2);
    const [cust] = await db
      .insert(s.customers)
      .values({
        tenantId: tenant.id,
        contactId: c.id,
        displayName: c.name,
        lifecycle: weighted(lifeW),
        planId: plan.id,
        contractStart: iso(start),
        nextDueOn: iso(anniversary),
        sourceSystem: 'seed_ficticio',
        externalId: ext,
        sourceUpdatedAt: ingested,
        ingestedAt: ingested,
      })
      .returning();
    await db.insert(s.customerExternalIds).values({ tenantId: tenant.id, customerId: cust!.id, system: 'seed_ficticio', externalId: ext });
    await db.insert(s.addresses).values({ tenantId: tenant.id, contactId: c.id, customerId: cust!.id, street: 'Rua Fictícia', number: String(10 + i), district: pick(['Centro', 'Bairro Exemplo', 'Jardim Teste']), city: c.city, state: 'SE' });
  }

  // ---------- atividades: hoje, próximos dias e histórico concluído (para "Atividades da equipe")
  const types = ['ligacao', 'reuniao', 'whatsapp', 'email', 'tarefa'] as const;
  const titles: Record<(typeof types)[number], [string, string][]> = {
    ligacao: [['Ligação para', 'Qualificação de interesse'], ['Ligação de follow-up', 'Verificar interesse']],
    reuniao: [['Reunião com', 'Apresentar proposta'], ['Reunião online com', 'Fechamento da proposta'], ['Reunião presencial', 'Apresentação institucional']],
    whatsapp: [['WhatsApp para', 'Confirmar documentação'], ['WhatsApp com', 'Enviar condições especiais']],
    email: [['Enviar proposta para', 'Plano 500 Mega'], ['Enviar apresentação', 'Material institucional']],
    tarefa: [['Ajustes de plano', 'Validar cobertura'], ['Atualizar cadastro de', 'Conferir dados']],
  };
  const openOpps = opps.filter((o) => !['ganha', 'perdida'].includes(o.stage));
  const slots = [[9, 0], [10, 30], [11, 0], [14, 0], [15, 30], [16, 30]] as const;
  for (const [idx, sid] of sellers.entries()) {
    for (let day = -1; day <= 6; day++) {
      const perDay = day === 0 ? 5 - Math.min(idx, 2) : day < 0 ? 2 : 1 + Math.floor(r() * 3);
      for (let k = 0; k < perDay; k++) {
        const type = pick(types);
        const [prefix, sub] = pick(titles[type]);
        const o = pick(openOpps.filter((x) => x.ownerId === sid).concat(openOpps).slice(0, 40));
        const [cn] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eqId(s.contacts.id, o.contactId));
        const slot = slots[(k + idx) % slots.length]!;
        await db.insert(s.activities).values({
          tenantId: tenant.id,
          type,
          title: prefix.endsWith(' para') || prefix.endsWith(' com') ? `${prefix} ${cn!.name.split(' ').slice(0, 2).join(' ')}` : prefix,
          notes: sub,
          dueAt: at(day, slot[0], slot[1]),
          priority: pick(['baixa', 'media', 'media', 'alta'] as const),
          ownerId: sid,
          opportunityId: o.id,
          contactId: o.contactId,
          completedAt: day < 0 && r() > 0.5 ? at(day, slot[0] + 1) : null,
          completedBy: null,
          createdBy: sid,
        });
      }
    }
    // histórico concluído dos últimos 30 dias
    const done = 40 - idx * 6;
    for (let k = 0; k < done; k++) {
      const type = weighted<(typeof types)[number]>([['ligacao', 45], ['email', 30], ['reuniao', 18], ['whatsapp', 5], ['tarefa', 2]]);
      const o = pick(opps);
      const due = at(-1 - Math.floor(r() * 29), 9 + Math.floor(r() * 8));
      await db.insert(s.activities).values({
        tenantId: tenant.id, type, title: titles[type][0]![0].replace(/ (para|com)$/, ''), notes: titles[type][0]![1], dueAt: due, priority: 'media',
        ownerId: sid, opportunityId: o.id, contactId: o.contactId, completedAt: new Date(due.getTime() + 1_800_000), completedBy: sid, createdBy: sid,
      });
    }
  }

  return { tenant, users };
}

import { eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
const eqId = (col: PgColumn, v: string) => eq(col, v);

export async function seed(url: string) {
  const { db, pool } = createDb(url);
  try {
    await seedTenant(db, {
      name: 'Yepnet (demonstração)',
      slug: 'yepnet',
      seed: 42,
      volume: 48,
      users: [
        { name: 'Carlos Silva', email: 'carlos@yepnet.test', profiles: ['gerencia'], jobTitle: 'Comercial', teams: [], goals: [10, 12, 50] },
        { name: 'Ana Souza', email: 'ana@yepnet.test', profiles: ['supervisor'], jobTitle: 'Supervisora comercial', teams: ['Residencial', 'Empresarial'], leads: ['Residencial', 'Empresarial'] },
        { name: 'Lucas Lima', email: 'lucas@yepnet.test', profiles: ['vendedor'], jobTitle: 'Consultor de vendas', teams: ['Residencial'] },
        { name: 'Rafael Mendes', email: 'rafael@yepnet.test', profiles: ['vendedor'], jobTitle: 'Consultor de vendas', teams: ['Empresarial'] },
        { name: 'Mariana Costa', email: 'mariana@yepnet.test', profiles: ['vendedor'], jobTitle: 'Consultora de vendas', teams: ['Governo'] },
      ],
    });
    await seedTenant(db, {
      name: 'Outro Provedor (fictício — teste de isolamento)',
      slug: 'outro',
      seed: 7,
      volume: 4,
      users: [{ name: 'Vendedor Outro', email: 'vendedor@outro.test', profiles: ['vendedor'], jobTitle: 'Vendedor', teams: ['Vendas'] }],
    });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  seed(url)
    .then(() => console.log(`Seed fictícia criada. Senha de todos os usuários de demo: ${SEED_PASSWORD}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
