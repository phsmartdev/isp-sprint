/**
 * Modelo pronto para a exportação de negociações do RD Station CRM (planilha/CSV: "Nome", "Empresa", "Funil de vendas",
 * "Etapa", "Estado"… e a exportação de tarefas com "Negociação vinculada"). A exportação não traz IDs do RD, então:
 * - cada linha de negociação vira Oportunidade, e dela saem a Conta (pela coluna Empresa) e a Pessoa (pelo contato);
 * - linhas da mesma empresa viram uma conta só; a empresa que já existe com o mesmo nome vai para revisão;
 * - tarefas acham a negociação por "nome da negociação + empresa" (ambíguo vai para revisão).
 * Nada sai aprovado: as correspondências chegam sugeridas, com motivo, e as equivalências pré-preenchidas só por nome exato.
 */
import { and, eq } from 'drizzle-orm';
import { DEFAULT_EXECUTION, DEFAULT_POLICY, keyNorm, type EntityMapping, type EquivalenceTable, type FieldMapping, type ImportConfig, type Transform } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const DEAL_COLS = ['Nome', 'Empresa', 'Funil de vendas', 'Etapa', 'Estado'];
const TASK_COLS = ['Negociação vinculada', 'Assunto', 'Tipo'];
export const isRdDealsExport = (headers: string[]) => DEAL_COLS.every((c) => headers.includes(c));
export const isRdTasksExport = (headers: string[]) => TASK_COLS.every((c) => headers.includes(c));
/** Colunas que identificam uma linha da exportação (o RD não exporta o ID). */
/** A exportação repete a negociação numa linha por contato: a linha inclui o contato; a negociação é a mesma pelas 4 primeiras. */
export const RD_DEAL_ID_COLS = ['Nome', 'Empresa', 'Data de criação', 'Hora de criação', 'Contatos'];
const RD_DEAL_KEY = ['Nome', 'Empresa', 'Data de criação', 'Hora de criação'];
export const RD_TASK_ID_COLS = ['Negociação vinculada', 'Assunto', 'Data de criação', 'Hora de criação'];

const WHY = 'Padrão da exportação de negociações do RD Station';
let n = 0;
const F = (target: string, sources: string[], extra: Partial<FieldMapping> = {}): FieldMapping => ({ id: `rd${++n}`, target, kind: 'direta', sources, transforms: [], approved: false, confidence: 0.95, reason: WHY, ...extra });
const DT: Transform = { op: 'datetime', timezone: 'America/Sao_Paulo' };
const when = (h: string[], col: string, f: FieldMapping) => (h.includes(col) || f.kind === 'constante' || f.kind === 'condicional' ? [f] : []);

export async function rdExportPreset(db: DbOrTx, tenantId: string, files: { entity: string; headers: string[]; rows: Record<string, string>[] }[]): Promise<ImportConfig | null> {
  const deals = files.filter((f) => isRdDealsExport(f.headers));
  const tasks = files.filter((f) => isRdTasksExport(f.headers));
  if (!deals.length) return null;
  const entities: EntityMapping[] = [];
  for (const d of deals) {
    const h = d.headers;
    entities.push({ source: d.entity, target: 'conta', enabled: true, legacy: 'descartar', policy: DEFAULT_POLICY, filter: [{ path: 'Empresa', op: 'not_empty' }], keyFrom: ['Empresa'], fields: [
      F('name', ['Empresa'], { transforms: [{ op: 'trim' }] }),
      F('segment', [], { kind: 'constante', value: 'empresarial', confidence: 0.5, reason: 'A exportação não traz o segmento: escolha o padrão' }),
    ] });
    entities.push({ source: d.entity, target: 'pessoa', enabled: h.includes('Contatos'), legacy: 'descartar', policy: DEFAULT_POLICY, filter: [{ path: 'Contatos', op: 'not_empty' }, { path: 'Empresa', op: 'not_empty' }], keyFrom: ['Contatos', 'Empresa'], fields: [
      F('name', ['Contatos'], { transforms: [{ op: 'trim' }] }),
      ...when(h, 'Email', F('email', ['Email'], { transforms: [{ op: 'email' }] })),
      ...when(h, 'Telefone', F('phone', ['Telefone'], { transforms: [{ op: 'phone' }] })),
      ...when(h, 'Cargo', F('title', ['Cargo'], { transforms: [{ op: 'trim' }] })),
      F('account', ['Empresa']),
    ] });
    entities.push({ source: d.entity, target: 'oportunidade', enabled: true, legacy: 'preservar', policy: DEFAULT_POLICY, filter: [], keyFrom: RD_DEAL_KEY.filter((c) => h.includes(c)), altKeyFrom: ['Nome', 'Empresa'], fields: [
      F('title', ['Nome'], { transforms: [{ op: 'trim' }] }),
      F('account', ['Empresa']),
      F('owner', ['Responsável'], { kind: 'equivalencia', table: 'usuarios' }),
      F('stage', ['Funil de vendas', 'Etapa'], { kind: 'composicao', template: '{0} · {1}', transforms: [{ op: 'equivalence', table: 'etapas' }] }),
      F('status', [], { kind: 'condicional', rules: [{ when: [{ path: 'Estado', op: 'eq', value: 'Vendida' }], value: 'ganha' }, { when: [{ path: 'Estado', op: 'eq', value: 'Perdida' }], value: 'perdida' }, { when: [{ path: 'Estado', op: 'eq', value: 'Em Andamento' }], value: 'aberta' }], value: '', reason: `${WHY}: Vendida = ganha, Perdida = perdida, Em Andamento = aberta (outro valor = linha com erro)` }),
      ...when(h, 'Valor Único', F('valueCents', ['Valor Único'], { transforms: [{ op: 'cents', decimal: '.', unit: 'reais' }], reason: `${WHY}: Valor Único (o Recorrente fica no legado)` })),
      ...when(h, 'Data de criação', F('createdAt', ['Data de criação', 'Hora de criação'], { kind: 'composicao', template: '{0} {1}', transforms: [DT] })),
      ...when(h, 'Data de fechamento', F('wonAt', ['Data de fechamento', 'Hora de fechamento'], { kind: 'composicao', template: '{0} {1}', transforms: [DT] })),
      ...when(h, 'Data de fechamento', F('lostAt', ['Data de fechamento', 'Hora de fechamento'], { kind: 'composicao', template: '{0} {1}', transforms: [DT] })),
      ...when(h, 'Motivo de Perda', F('lossReason', ['Motivo de Perda'], { transforms: [{ op: 'null_if', values: ['Nada'] }] })),
      ...when(h, 'Fonte', F('source', ['Fonte'], { kind: 'equivalencia', table: 'origens' })),
      ...when(h, 'Filial', F('branch', ['Filial'], { kind: 'equivalencia', table: 'filiais' })),
      ...when(h, 'Modalidade da Contratação:', F('saleKind', ['Modalidade da Contratação:'], { kind: 'equivalencia', table: 'modalidades' })),
    ] });
  }
  for (const t of tasks) {
    const h = t.headers;
    entities.push({ source: t.entity, target: 'tarefa', enabled: true, legacy: 'preservar', policy: DEFAULT_POLICY, filter: [{ path: 'Assunto', op: 'not_empty' }], fields: [
      F('title', ['Assunto'], { transforms: [{ op: 'trim' }, { op: 'truncate', max: 300 }] }),
      F('type', ['Tipo'], { kind: 'equivalencia', table: 'tipos_tarefa' }),
      F('owner', ['Responsáveis'], { transforms: [{ op: 'split_first', sep: ',' }, { op: 'equivalence', table: 'usuarios' }], reason: `${WHY}: o primeiro dos responsáveis` }),
      F('opportunity', ['Negociação vinculada', 'Empresa vinculada'], { kind: 'composicao', template: '{0}|{1}', reason: `${WHY}: a negociação é achada por nome + empresa` }),
      ...when(h, 'Empresa vinculada', F('account', ['Empresa vinculada'])),
      ...when(h, 'Data agendada', F('dueAt', ['Data agendada', 'Hora agendada'], { kind: 'composicao', template: '{0} {1}', transforms: [DT] })),
      ...when(h, 'Data da conclusão', F('completedAt', ['Data da conclusão', 'Hora da conclusão'], { kind: 'composicao', template: '{0} {1}', transforms: [DT] })),
      ...when(h, 'Descrição', F('notes', ['Descrição'])),
    ] });
  }
  // equivalências: valores reais das colunas; pré-preenche só quando o nome é exatamente igual no ISP Sprint
  const nk = (x: string) => keyNorm([x]);
  // linhas quebradas da exportação (colunas deslocadas) trazem datas e horas onde deveria haver nomes: ficam fora das equivalências
  const junk = (v: string) => /^\d{4}-\d{2}-\d{2}|^\d{1,2}:\d{2}/.test(v);
  const distinct = (vals: (string | undefined)[]) => [...new Set(vals.map((v) => (v ?? '').trim()).filter((v) => v && !junk(v)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const dealRows = deals.flatMap((d) => d.rows), taskRows = tasks.flatMap((t) => t.rows);
  const [users, stages, sources, branches] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))),
    db.select({ p: s.pipelines.id, pn: s.pipelines.name, k: s.pipelineStages.key, n: s.pipelineStages.name }).from(s.pipelineStages).innerJoin(s.pipelines, eq(s.pipelines.id, s.pipelineStages.pipelineId)).where(eq(s.pipelines.tenantId, tenantId)),
    db.select({ id: s.leadSources.id, name: s.leadSources.name }).from(s.leadSources).where(eq(s.leadSources.tenantId, tenantId)),
    db.select({ id: s.salesBranches.id, name: s.salesBranches.name }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, tenantId)),
  ]);
  const exact = <T extends { id: string; name: string }>(list: T[], v: string) => list.find((x) => nk(x.name) === nk(v))?.id ?? null;
  const tables: EquivalenceTable[] = [
    { key: 'usuarios', label: 'Responsáveis do RD → usuários', refKind: 'usuario', fallback: { kind: 'revisar' }, rows: distinct([...dealRows.map((r) => r['Responsável']), ...taskRows.map((r) => (r['Responsáveis'] ?? '').split(',')[0])]).map((v) => ({ from: v, to: exact(users, v) })) },
    { key: 'etapas', label: 'Funil · etapa do RD → jornada e etapa', refKind: 'etapa', fallback: { kind: 'revisar' }, rows: distinct(dealRows.map((r) => (r['Funil de vendas'] || r['Etapa'] ? `${(r['Funil de vendas'] ?? '').trim()} · ${(r['Etapa'] ?? '').trim()}` : ''))).map((v) => {
      const [, st] = v.split(' · ');
      const m = stages.filter((x) => nk(x.n) === nk(st ?? ''));
      return { from: v, to: m.length === 1 ? `${m[0]!.p}:${m[0]!.k}` : null };
    }) },
    { key: 'filiais', label: 'Filiais do RD → filiais', refKind: 'filial', fallback: { kind: 'vazio' }, rows: distinct(dealRows.map((r) => r['Filial'])).map((v) => ({ from: v, to: exact(branches, v) })) },
    { key: 'origens', label: 'Fontes do RD → origens', refKind: 'origem', fallback: { kind: 'vazio' }, rows: distinct(dealRows.map((r) => r['Fonte'])).map((v) => ({ from: v, to: exact(sources, v) })) },
    { key: 'modalidades', label: 'Modalidade da contratação → tipo de venda', refKind: 'valor', fallback: { kind: 'vazio' }, rows: distinct(dealRows.map((r) => r['Modalidade da Contratação:'])).map((v) => ({ from: v, to: /preg[aã]o|concorr[eê]ncia|presencial|procedimento licitat/i.test(v) ? 'licitacao' : null })) },
  ];
  if (tasks.length) tables.push({ key: 'tipos_tarefa', label: 'Tipo de tarefa do RD → tipo', refKind: 'valor', fallback: { kind: 'revisar' }, rows: distinct(taskRows.map((r) => r['Tipo'])).map((v) => ({ from: v, to: ({ tarefa: 'tarefa', 'reuniao': 'reuniao', 'ligacao': 'ligacao', 'e-mail': 'email', email: 'email', visita: 'visita', whatsapp: 'whatsapp' } as Record<string, string>)[nk(v)] ?? null })) });
  return { source: 'csv', timezone: 'America/Sao_Paulo', entities, tables, execution: DEFAULT_EXECUTION };
}
