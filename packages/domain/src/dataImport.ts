/**
 * Data Import Engine — regras puras (sem banco, sem rede): esquema de destino do ISP Sprint, mapeamento de campos,
 * transformações declarativas, validação, sugestões de correspondência, comparação de versões e indicadores.
 * Nada aqui executa código fornecido pelo usuário: cada transformação é uma operação conhecida com parâmetros.
 */
import { validCnpj, validCpf } from './contractErp';

export const IMPORT_SOURCES = ['rdstation_crm', 'csv'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = { rdstation_crm: 'RD Station CRM', csv: 'Arquivo CSV' };

// ------------------------------------------------------------------ destino (ISP Sprint)
export const TARGET_ENTITIES = ['conta', 'pessoa', 'oportunidade', 'tarefa', 'anotacao'] as const;
export type TargetEntity = (typeof TARGET_ENTITIES)[number];
export const TARGET_ENTITY_LABELS: Record<TargetEntity, string> = { conta: 'Contas', pessoa: 'Pessoas (contatos)', oportunidade: 'Oportunidades', tarefa: 'Tarefas', anotacao: 'Anotações' };
/** Ordem de dependência (a mesma das chaves estrangeiras do banco). */
export const TARGET_ORDER: TargetEntity[] = ['conta', 'pessoa', 'oportunidade', 'tarefa', 'anotacao'];

export type RefKind = TargetEntity | 'usuario' | 'etapa' | 'origem' | 'filial';
export type FieldType = 'text' | 'longtext' | 'number' | 'cents' | 'percent' | 'date' | 'datetime' | 'boolean' | 'enum' | 'document' | 'phone' | 'email' | 'ref';
export type TargetField = { key: string; label: string; type: FieldType; required?: boolean; values?: readonly string[]; ref?: RefKind; hint?: string };

export const OPP_STATUSES = ['aberta', 'ganha', 'perdida'] as const;
export const SALE_KINDS_IMPORT = ['licitacao', 'adesao_ata', 'consumo_contrato', 'venda_consultiva'] as const;

const S = (key: string, label: string, type: FieldType, extra: Partial<TargetField> = {}): TargetField => ({ key, label, type, ...extra });
/** Campos de destino fixos (os personalizados de cada empresa entram como custom.<chave>). */
export const TARGET_FIELDS: Record<TargetEntity, TargetField[]> = {
  conta: [
    S('name', 'Nome / razão social', 'text', { required: true }), S('document', 'CPF/CNPJ', 'document'), S('phone', 'Telefone', 'phone'), S('email', 'E-mail', 'email'),
    S('segment', 'Segmento', 'enum', { required: true, values: ['residencial', 'empresarial', 'governamental', 'institucional'] }),
    S('nature', 'Natureza', 'enum', { values: ['publica', 'privada'] }), S('city', 'Cidade', 'text'), S('owner', 'Responsável pela carteira', 'ref', { ref: 'usuario' }),
  ],
  pessoa: [
    S('name', 'Nome', 'text', { required: true }), S('email', 'E-mail', 'email'), S('phone', 'Telefone', 'phone'), S('title', 'Cargo', 'text'),
    S('account', 'Conta', 'ref', { ref: 'conta', required: true, hint: 'ID da empresa na origem' }), S('notes', 'Observações', 'longtext'),
  ],
  oportunidade: [
    S('title', 'Título', 'text', { required: true }), S('account', 'Conta', 'ref', { ref: 'conta', required: true, hint: 'ID da empresa na origem' }),
    S('owner', 'Responsável', 'ref', { ref: 'usuario', required: true }), S('stage', 'Jornada e etapa', 'ref', { ref: 'etapa', required: true }),
    S('status', 'Situação', 'enum', { required: true, values: OPP_STATUSES }), S('saleKind', 'Tipo de venda', 'enum', { values: SALE_KINDS_IMPORT }),
    S('valueCents', 'Valor', 'cents'), S('wonAt', 'Data de ganho', 'datetime'), S('lostAt', 'Data de perda', 'datetime'), S('lossReason', 'Motivo de perda', 'text'),
    S('source', 'Origem', 'ref', { ref: 'origem' }), S('branch', 'Filial', 'ref', { ref: 'filial' }), S('createdAt', 'Criada na origem em', 'datetime'), S('notes', 'Observações', 'longtext'),
  ],
  tarefa: [
    S('title', 'Título', 'text', { required: true }), S('type', 'Tipo', 'enum', { values: ['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'] }),
    S('owner', 'Responsável', 'ref', { ref: 'usuario', required: true }), S('opportunity', 'Oportunidade', 'ref', { ref: 'oportunidade', hint: 'ID da negociação na origem' }),
    S('account', 'Conta', 'ref', { ref: 'conta' }), S('dueAt', 'Prazo', 'datetime'), S('completedAt', 'Concluída em', 'datetime'), S('notes', 'Descrição', 'longtext'),
  ],
  anotacao: [
    S('text', 'Texto', 'longtext', { required: true }), S('opportunity', 'Oportunidade', 'ref', { ref: 'oportunidade', required: true, hint: 'ID da negociação na origem' }),
    S('author', 'Autor', 'ref', { ref: 'usuario' }), S('occurredAt', 'Data', 'datetime'),
  ],
};
export type CustomFieldDef = { entity: 'conta' | 'oportunidade'; key: string; label: string; type: 'texto' | 'numero' | 'data' | 'opcao' | 'booleano' | string; options?: string[] };
/** Esquema de destino com os campos personalizados da empresa (lidos do banco). */
export function targetSchema(custom: CustomFieldDef[]): Record<TargetEntity, TargetField[]> {
  const out = { ...TARGET_FIELDS } as Record<TargetEntity, TargetField[]>;
  for (const c of custom) {
    const type: FieldType = c.type === 'numero' ? 'number' : c.type === 'moeda' ? 'cents' : c.type === 'data' ? 'date' : c.type === 'sim_nao' || c.type === 'booleano' ? 'boolean' : c.type === 'texto_longo' ? 'longtext' : c.options?.length ? 'enum' : 'text';
    if (out[c.entity].some((f) => f.key === `custom.${c.key}`)) continue;
    out[c.entity] = [...out[c.entity], { key: `custom.${c.key}`, label: `${c.label} (personalizado)`, type, values: c.options?.length ? c.options : undefined }];
  }
  return out;
}

// ------------------------------------------------------------------ configuração do modelo
export type Transform =
  | { op: 'trim' } | { op: 'upper' } | { op: 'lower' } | { op: 'digits' }
  | { op: 'truncate'; max: number }
  | { op: 'default'; value: string }
  | { op: 'null_if'; values: string[] }
  | { op: 'date'; format: 'iso' | 'dd/mm/yyyy' | 'mm/dd/yyyy' }
  | { op: 'datetime'; timezone: string }
  | { op: 'cents'; decimal: ',' | '.'; unit: 'reais' | 'centavos' }
  | { op: 'number'; decimal: ',' | '.' }
  | { op: 'percent'; decimal: ',' | '.' }
  | { op: 'phone' } | { op: 'document' } | { op: 'email' }
  | { op: 'boolean'; trueValues: string[] }
  | { op: 'equivalence'; table: string }
  | { op: 'split_first'; sep: string };
export const TRANSFORM_LABELS: Record<Transform['op'], string> = {
  trim: 'Tirar espaços', upper: 'Maiúsculas', lower: 'Minúsculas', digits: 'Só dígitos', truncate: 'Cortar no tamanho', default: 'Valor padrão se vazio', null_if: 'Tratar como vazio',
  date: 'Data', datetime: 'Data e hora (fuso)', cents: 'Dinheiro → centavos', number: 'Número', percent: 'Percentual', phone: 'Telefone', document: 'CPF/CNPJ', email: 'E-mail', boolean: 'Sim/não', equivalence: 'Tabela de equivalência', split_first: 'Primeiro de uma lista',
};

export type ConditionOp = 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty' | 'in' | 'true' | 'false';
export type Condition = { path: string; op: ConditionOp; value?: string };
export type MappingKind = 'direta' | 'composicao' | 'condicional' | 'equivalencia' | 'constante';
export const MAPPING_KIND_LABELS: Record<MappingKind, string> = { direta: 'Direta (1:1)', composicao: 'Composição (N:1)', condicional: 'Condicional', equivalencia: 'Tabela de equivalência', constante: 'Valor fixo' };
export type FieldMapping = {
  id: string;
  target: string;
  kind: MappingKind;
  /** caminhos na origem (ex.: "organization.name", "deal_custom_fields[custom_field.label=Modalidade].value") */
  sources: string[];
  /** composição: "{0} — {1}" */
  template?: string;
  /** constante, ou valor de uma regra condicional */
  value?: string;
  table?: string;
  rules?: { when: Condition[]; value?: string; path?: string }[];
  transforms: Transform[];
  /** sugestões automáticas só valem depois de aprovadas por uma pessoa */
  approved: boolean;
  confidence?: number;
  reason?: string;
};
export type ImportPolicy = {
  onNew: 'criar' | 'ignorar' | 'revisar';
  onExisting: 'atualizar' | 'ignorar' | 'revisar';
  /** valor vazio na origem: não apaga o que existe no ISP Sprint (padrão) ou limpa */
  emptyValues: 'manter' | 'limpar';
  /** registro já existente achado por documento/e-mail (sem vínculo de importação): revisar (padrão) ou vincular */
  matchByKey: 'revisar' | 'vincular' | 'desligado';
};
export const DEFAULT_POLICY: ImportPolicy = { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'revisar' };
export type EntityMapping = {
  source: string; target: TargetEntity; enabled: boolean; fields: FieldMapping[]; legacy: 'preservar' | 'descartar'; policy: ImportPolicy; filter: Condition[];
  /**
   * Identidade do registro de destino montada por colunas (ex.: a empresa de uma linha de negociação). Linhas com a
   * mesma chave viram um registro só. Sem isto, cada registro da origem é um registro de destino.
   */
  keyFrom?: string[];
  /** Chave alternativa para outras entidades acharem este registro (ex.: tarefas ligadas por "nome da negociação + empresa"). */
  altKeyFrom?: string[];
};
/** Normalização das chaves montadas por colunas: sem acento, minúsculas, espaços simples, partes separadas por "|". */
export const keyNorm = (parts: unknown[]) => parts.map((p) => String(p ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
export const keyOf = (record: unknown, paths: string[]): string | null => { const parts = paths.map((p) => getPath(record, p)); return parts.every((x) => x == null || String(x).trim() === '') ? null : keyNorm(parts); };
export type EquivalenceRow = { from: string; to: string | null; label?: string };
export type EquivalenceTable = { key: string; label: string; refKind: RefKind | 'valor'; rows: EquivalenceRow[]; fallback: { kind: 'revisar' | 'padrao' | 'vazio'; value?: string } };
export type ImportConfig = {
  source: ImportSource;
  timezone: string;
  entities: EntityMapping[];
  tables: EquivalenceTable[];
  execution: { batchSize: number; largeVolume: number };
};
export const DEFAULT_EXECUTION = { batchSize: 50, largeVolume: 500 };

// ------------------------------------------------------------------ escopo da execução
export type ImportScope =
  | { mode: 'uma_oportunidade'; accountId: string; opportunityId: string }
  | { mode: 'uma_conta'; accountId: string }
  | { mode: 'base_completa' }
  | { mode: 'personalizado'; accountIds: string[]; opportunityIds: string[]; ownerIds: string[]; pipelineIds: string[]; stageIds: string[]; status: ('aberta' | 'ganha' | 'perdida')[]; createdFrom: string | null; createdTo: string | null; closedFrom: string | null; closedTo: string | null; imported: 'todos' | 'importados' | 'nao_importados' };
export const SCOPE_LABELS: Record<ImportScope['mode'], string> = { uma_oportunidade: 'Uma conta e uma oportunidade', uma_conta: 'Uma conta e todas as oportunidades', base_completa: 'Todas as contas e oportunidades', personalizado: 'Seleção personalizada' };

// ------------------------------------------------------------------ caminhos na origem
type Json = unknown;
/** Lê "a.b", "a[0].b" e "lista[campo.x=Valor].y". */
export function getPath(obj: Json, path: string): Json {
  if (!path) return undefined;
  const parts = path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [];
  let cur: Json = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (p.startsWith('[')) {
      const inner = p.slice(1, -1);
      if (!Array.isArray(cur)) return undefined;
      if (/^\d+$/.test(inner)) { cur = cur[Number(inner)]; continue; }
      const eq = inner.indexOf('=');
      if (eq < 0) return undefined;
      const k = inner.slice(0, eq), v = inner.slice(eq + 1);
      cur = cur.find((x) => String(getPath(x, k) ?? '') === v);
    } else cur = (cur as Record<string, Json>)[p];
  }
  return cur;
}

export type DiscoveredField = { path: string; type: 'texto' | 'numero' | 'booleano' | 'data' | 'lista' | 'objeto' | 'vazio'; samples: string[]; filled: number; total: number };
const looksDate = (s: string) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
/**
 * Descoberta: percorre registros reais e lista cada campo folha com tipo, exemplos e preenchimento.
 * Listas de campos personalizados ("[{custom_field:{label}, value}]") viram caminhos por rótulo.
 */
export function discoverFields(records: Json[], maxSamples = 3): DiscoveredField[] {
  const acc = new Map<string, DiscoveredField>();
  const touch = (path: string, v: Json) => {
    const f = acc.get(path) ?? { path, type: 'vazio' as DiscoveredField['type'], samples: [], filled: 0, total: 0 };
    f.total += 1;
    if (v != null && v !== '') {
      f.filled += 1;
      const t: DiscoveredField['type'] = typeof v === 'number' ? 'numero' : typeof v === 'boolean' ? 'booleano' : typeof v === 'string' && looksDate(v) ? 'data' : 'texto';
      if (f.type === 'vazio') f.type = t; else if (f.type !== t && f.type !== 'texto') f.type = 'texto';
      const sv = String(v).slice(0, 80);
      if (f.samples.length < maxSamples && !f.samples.includes(sv)) f.samples.push(sv);
    }
    acc.set(path, f);
  };
  const walk = (v: Json, path: string, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      // lista de campos personalizados: indexa por rótulo
      const labelled = v.filter((x) => x && typeof x === 'object' && ('value' in (x as object)) && (getPath(x, 'custom_field.label') != null || getPath(x, 'label') != null));
      if (labelled.length && labelled.length === v.length) {
        for (const x of labelled) {
          const lk = getPath(x, 'custom_field.label') != null ? 'custom_field.label' : 'label';
          touch(`${path}[${lk}=${String(getPath(x, lk))}].value`, (x as Record<string, Json>).value);
        }
        return;
      }
      if (v.length && v.every((x) => x == null || typeof x !== 'object')) { touch(path, v.join(', ')); return; }
      if (v.length) walk(v[0], `${path}[0]`, depth + 1);
      return;
    }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, Json>)) if (!k.startsWith('_ctx')) walk(x, path ? `${path}.${k}` : k, depth + 1); return; }
    touch(path, v);
  };
  for (const r of records) walk(r, '', 0);
  return [...acc.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// ------------------------------------------------------------------ transformações
const str = (v: Json) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const onlyDigits = (s: string) => s.replace(/\D/g, '');
function parseNumber(s: string, decimal: ',' | '.'): number | null {
  let t = s.trim().replace(/[^\d,.-]/g, '');
  if (!t) return null;
  t = decimal === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** Data local (sem hora) → ISO; datas com hora são convertidas para o fuso indicado e voltam em UTC. */
function toIsoDate(s: string, format: 'iso' | 'dd/mm/yyyy' | 'mm/dd/yyyy'): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  if (format === 'iso') { const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (!r) return null; [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])]; }
  else { const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); if (!r) return null; const a = Number(r[1]), b = Number(r[2]); y = Number(r[3]); [d, m] = format === 'dd/mm/yyyy' ? [a, b] : [b, a]; }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
/** Deslocamento do fuso (em minutos) num instante, sem bibliotecas: usa o Intl do próprio ambiente. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - at.getTime()) / 60000;
}
function toIsoDateTime(s: string, tz: string): string | null {
  const t = s.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) { const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  let r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  let parts: number[] | null = r ? [Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4] ?? 0), Number(r[5] ?? 0), Number(r[6] ?? 0)] : null;
  if (!parts) { r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t); if (r) parts = [Number(r[3]), Number(r[2]), Number(r[1]), Number(r[4] ?? 0), Number(r[5] ?? 0), Number(r[6] ?? 0)]; }
  if (!parts) return null;
  const [y, mo, d, h, mi, se] = parts as [number, number, number, number, number, number];
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (guess.getUTCMonth() !== mo - 1) return null;
  const utc = new Date(guess.getTime() - tzOffsetMinutes(tz, guess) * 60000);
  return utc.toISOString();
}
export function documentIssue(v: string): string | null {
  const d = onlyDigits(v);
  if (d.length === 11) return validCpf(d) ? null : 'CPF inválido';
  if (d.length === 14) return validCnpj(d) ? null : 'CNPJ inválido';
  return 'CPF/CNPJ com tamanho inválido';
}

export type StepResult = { value: unknown; error?: string; review?: string };
export function applyTransforms(input: unknown, transforms: Transform[], ctx: { timezone: string; tables: EquivalenceTable[] }): StepResult {
  let v: unknown = input;
  for (const t of transforms) {
    const s = str(v);
    const empty = v == null || s.trim() === '';
    switch (t.op) {
      case 'trim': v = empty ? null : s.trim().replace(/\s+/g, ' '); break;
      case 'upper': v = empty ? v : s.toUpperCase(); break;
      case 'lower': v = empty ? v : s.toLowerCase(); break;
      case 'digits': v = empty ? null : onlyDigits(s) || null; break;
      case 'truncate': v = empty ? v : s.slice(0, Math.max(1, t.max)); break;
      case 'default': if (empty) v = t.value; break;
      case 'null_if': if (t.values.some((x) => x.trim().toLowerCase() === s.trim().toLowerCase())) v = null; break;
      case 'date': { if (empty) { v = null; break; } const r = toIsoDate(s, t.format); if (!r) return { value: input, error: `Data inválida: "${s}"` }; v = r; break; }
      case 'datetime': { if (empty) { v = null; break; } const r = toIsoDateTime(s, t.timezone || ctx.timezone); if (!r) return { value: input, error: `Data e hora inválidas: "${s}"` }; v = r; break; }
      case 'cents': { if (empty) { v = null; break; } const n = typeof v === 'number' ? v : parseNumber(s, t.decimal); if (n == null) return { value: input, error: `Valor inválido: "${s}"` }; if (n < 0) return { value: input, error: 'Valor negativo' }; v = t.unit === 'centavos' ? Math.round(n) : Math.round(n * 100); break; }
      case 'number': { if (empty) { v = null; break; } const n = typeof v === 'number' ? v : parseNumber(s, t.decimal); if (n == null) return { value: input, error: `Número inválido: "${s}"` }; v = n; break; }
      case 'percent': { if (empty) { v = null; break; } const n = typeof v === 'number' ? v : parseNumber(s.replace('%', ''), t.decimal); if (n == null || n < 0 || n > 100) return { value: input, error: `Percentual inválido: "${s}"` }; v = n; break; }
      case 'phone': { if (empty) { v = null; break; } let d = onlyDigits(s); if (d.startsWith('55') && d.length >= 12) d = d.slice(2); if (d.length < 10 || d.length > 11) return { value: input, review: `Telefone fora do padrão: "${s}"`, }; v = d; break; }
      case 'document': { if (empty) { v = null; break; } const issue = documentIssue(s); if (issue) return { value: input, error: `${issue}: "${s}"` }; v = onlyDigits(s); break; }
      case 'email': { if (empty) { v = null; break; } const e = s.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { value: input, review: `E-mail fora do padrão: "${s}"` }; v = e; break; }
      case 'boolean': { if (empty) { v = null; break; } v = t.trueValues.map((x) => x.toLowerCase()).includes(s.trim().toLowerCase()) || v === true; break; }
      case 'split_first': v = empty ? null : (s.split(t.sep || ',')[0] ?? '').trim() || null; break;
      case 'equivalence': {
        if (empty) { v = null; break; }
        const tb = ctx.tables.find((x) => x.key === t.table);
        if (!tb) return { value: input, error: `Tabela de equivalência "${t.table}" não existe no modelo` };
        const row = tb.rows.find((r) => r.from.trim().toLowerCase() === s.trim().toLowerCase());
        if (row) { v = row.to; break; }
        if (tb.fallback.kind === 'padrao' && tb.fallback.value) { v = tb.fallback.value; break; }
        if (tb.fallback.kind === 'vazio') { v = null; break; }
        return { value: null, review: `Sem equivalência em "${tb.label}" para "${s}"` };
      }
    }
  }
  return { value: v };
}

export function conditionHolds(record: Json, c: Condition): boolean {
  const v = getPath(record, c.path);
  const s = str(v).trim().toLowerCase();
  const want = (c.value ?? '').trim().toLowerCase();
  switch (c.op) {
    case 'eq': return s === want;
    case 'neq': return s !== want;
    case 'contains': return !!want && s.includes(want);
    case 'empty': return !s;
    case 'not_empty': return !!s;
    case 'in': return want.split(',').map((x) => x.trim()).includes(s);
    case 'true': return v === true || s === 'true' || s === 'sim' || s === '1';
    case 'false': return v === false || s === 'false' || s === 'nao' || s === 'não' || s === '0';
  }
}

// ------------------------------------------------------------------ avaliação de um registro
export type IssueLevel = 'erro' | 'revisao' | 'aviso';
export type Issue = { field: string; level: IssueLevel; message: string };
export type Evaluated = {
  values: Record<string, unknown>;
  /** valor original de cada campo de destino (preservado para auditoria) */
  originals: Record<string, unknown>;
  converted: string[];
  issues: Issue[];
  /** caminhos da origem não usados em nenhum mapeamento (vão como legado, se o modelo preservar) */
  legacy: Record<string, unknown>;
};

/** Aplica o mapeamento de uma entidade a um registro de origem. Não resolve referências (isso depende do banco). */
export function evaluateRecord(record: Json, em: EntityMapping, fields: TargetField[], ctx: { timezone: string; tables: EquivalenceTable[] }): Evaluated {
  const out: Evaluated = { values: {}, originals: {}, converted: [], issues: [], legacy: {} };
  const used = new Set<string>();
  for (const m of em.fields) {
    const tf = fields.find((f) => f.key === m.target);
    if (!tf) { out.issues.push({ field: m.target, level: 'erro', message: 'Campo de destino não existe mais no ISP Sprint' }); continue; }
    if (!m.approved) { out.issues.push({ field: m.target, level: 'revisao', message: 'Correspondência sugerida ainda não aprovada' }); continue; }
    m.sources.forEach((p) => used.add(p.replace(/\[.*$/, '').split('.')[0]!));
    let raw: unknown;
    if (m.kind === 'constante') raw = m.value ?? null;
    else if (m.kind === 'composicao') raw = (m.template ?? m.sources.map((_, i) => `{${i}}`).join(' ')).replace(/\{(\d+)\}/g, (_, i) => str(getPath(record, m.sources[Number(i)] ?? '')).trim()).replace(/\s+/g, ' ').trim() || null;
    else if (m.kind === 'condicional') {
      const rule = (m.rules ?? []).find((r) => r.when.every((c) => conditionHolds(record, c)));
      raw = rule ? (rule.path ? getPath(record, rule.path) : rule.value ?? null) : m.sources[0] ? getPath(record, m.sources[0]) : m.value ?? null;
    } else raw = m.sources[0] ? getPath(record, m.sources[0]) : undefined;
    const transforms = m.kind === 'equivalencia' && m.table && !m.transforms.some((t) => t.op === 'equivalence') ? [...m.transforms, { op: 'equivalence' as const, table: m.table }] : m.transforms;
    const r = applyTransforms(raw, transforms, ctx);
    out.originals[m.target] = raw ?? null;
    if (r.error) { out.issues.push({ field: m.target, level: 'erro', message: r.error }); continue; }
    if (r.review) out.issues.push({ field: m.target, level: 'revisao', message: r.review });
    let v = r.value;
    // tipagem final pelo campo de destino
    if (v != null && v !== '') {
      if (tf.type === 'enum' && tf.values && !tf.values.includes(String(v))) { out.issues.push({ field: m.target, level: 'erro', message: `"${String(v)}" não é um valor aceito (${tf.values.join(', ')})` }); continue; }
      if ((tf.type === 'cents' || tf.type === 'number') && typeof v !== 'number') { const n = parseNumber(String(v), '.'); if (n == null) { out.issues.push({ field: m.target, level: 'erro', message: `Número inválido: "${String(v)}"` }); continue; } v = tf.type === 'cents' ? Math.round(n) : n; }
      if (tf.type === 'datetime' && !/T/.test(String(v))) { const iso = toIsoDateTime(String(v), ctx.timezone); if (!iso) { out.issues.push({ field: m.target, level: 'erro', message: `Data inválida: "${String(v)}"` }); continue; } v = iso; }
      if (tf.type === 'date') { const iso = toIsoDate(String(v), 'iso'); if (!iso) { out.issues.push({ field: m.target, level: 'erro', message: `Data inválida: "${String(v)}"` }); continue; } v = iso; }
      if (tf.type === 'document' && !/^\d{11}$|^\d{14}$/.test(String(v))) { const issue = documentIssue(String(v)); if (issue) { out.issues.push({ field: m.target, level: 'erro', message: issue }); continue; } v = onlyDigits(String(v)); }
      if (tf.type === 'text' || tf.type === 'longtext') v = String(v).slice(0, tf.type === 'text' ? 500 : 20000);
    } else v = null;
    if (str(raw) !== str(v) && v != null) out.converted.push(m.target);
    // 1:N — mais de um mapeamento pode alimentar destinos diferentes; o mesmo destino duas vezes: vale o primeiro preenchido
    if (out.values[m.target] == null) out.values[m.target] = v;
  }
  for (const f of fields) if (f.required && (out.values[f.key] == null || out.values[f.key] === '') && !out.issues.some((i) => i.field === f.key && i.level === 'erro')) out.issues.push({ field: f.key, level: 'erro', message: `${f.label} é obrigatório` });
  if (em.legacy === 'preservar' && record && typeof record === 'object') {
    for (const [k, v] of Object.entries(record as Record<string, unknown>)) if (!used.has(k) && !k.startsWith('_ctx') && v != null && v !== '' && !(Array.isArray(v) && !v.length)) out.legacy[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ sugestões
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Sinônimos que valem entre CRMs (português e inglês). Nada é aprovado sozinho: só sugere, com motivo e confiança. */
const SYNONYMS: Record<string, string[]> = {
  name: ['name', 'nome', 'razao social', 'title', 'titulo'], title: ['name', 'nome', 'title', 'titulo', 'subject', 'assunto'], document: ['cnpj', 'cpf', 'documento', 'cpf cnpj', 'document'],
  phone: ['phone', 'telefone', 'celular', 'phones phone', 'whatsapp'], email: ['email', 'e mail', 'emails email'], city: ['city', 'cidade', 'municipio'],
  valueCents: ['amount total', 'amount', 'valor', 'value', 'valor total'], wonAt: ['closed at', 'data fechamento', 'fechada em'], lostAt: ['closed at', 'data perda'],
  lossReason: ['deal lost reason name', 'motivo perda', 'lost reason'], createdAt: ['created at', 'criado em', 'data criacao'], dueAt: ['date', 'due date', 'prazo', 'hour'],
  completedAt: ['done date', 'concluida em', 'markup'], notes: ['notes', 'description', 'descricao', 'observacoes'], text: ['text', 'texto', 'note', 'anotacao'],
  occurredAt: ['created at', 'date', 'data'], owner: ['user email', 'user id', 'responsavel', 'owner'], author: ['user email', 'user id', 'autor'],
  account: ['organization id', 'organization id', 'organization', 'empresa id', 'ctx organization id'], opportunity: ['deal id', 'negociacao id', 'ctx deal id'],
  stage: ['deal stage id', 'etapa', 'stage'], source: ['deal source id', 'deal source name', 'fonte', 'origem'],
};
export type MappingSuggestion = { target: string; source: string; confidence: number; reason: string; ambiguous: boolean };
/** Sugere correspondências por nome, tipo e exemplos. Confiança < 0,8 ou empate = ambígua (precisa de decisão). */
export function suggestMappings(src: DiscoveredField[], fields: TargetField[]): MappingSuggestion[] {
  const out: MappingSuggestion[] = [];
  for (const f of fields) {
    const syn = SYNONYMS[f.key] ?? [norm(f.label)];
    const scored = src.filter((s) => s.type !== 'objeto' && s.filled > 0).map((s) => {
      const n = norm(s.path.replace(/\[[^\]]*=([^\]]*)\]/g, ' $1 ').replace(/\[\d+\]/g, ' '));
      let score = 0; let why = '';
      for (const w of syn) { if (n === w) { score = 0.9; why = `nome equivalente ("${s.path}")`; break; } if (n.endsWith(` ${w}`) || n.includes(w)) { score = Math.max(score, 0.65); why = `nome parecido ("${s.path}")`; } }
      if (norm(f.label) && n.includes(norm(f.label))) { score = Math.max(score, 0.7); why = why || `rótulo parecido ("${s.path}")`; }
      // tipo e exemplos
      const sample = s.samples[0] ?? '';
      if (score && f.type === 'document' && /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$|^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(sample)) { score += 0.08; why += ', exemplo tem formato de documento'; }
      if (score && f.type === 'email' && sample.includes('@')) { score += 0.08; why += ', exemplo tem @'; }
      if (score && (f.type === 'datetime' || f.type === 'date') && s.type === 'data') { score += 0.05; why += ', exemplo é data'; }
      if (score && f.type === 'cents' && s.type === 'numero') { score += 0.05; why += ', exemplo é número'; }
      if (score && (f.type === 'datetime' || f.type === 'cents') && s.type === 'texto' && sample && !/\d/.test(sample)) score -= 0.4;
      return { s, score: Math.min(0.97, score), why };
    }).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const best = scored[0]!;
    const tie = scored.length > 1 && scored[1]!.score >= best.score - 0.05;
    out.push({ target: f.key, source: best.s.path, confidence: Math.round(best.score * 100) / 100, reason: best.why + (tie ? `; empate com "${scored[1]!.s.path}"` : ''), ambiguous: tie || best.score < 0.8 });
  }
  // a mesma origem sugerida para destinos diferentes (ex.: data de fechamento → ganho e perda) pede regra condicional
  for (const x of out) {
    const others = out.filter((y) => y !== x && y.source === x.source);
    if (others.length) { x.ambiguous = true; x.reason += `; também sugerido para ${others.map((o) => o.target).join(', ')} (use uma condição)`; }
  }
  return out;
}

// ------------------------------------------------------------------ validação do modelo
export function configIssues(c: ImportConfig, schema: Record<TargetEntity, TargetField[]>, sourceFields?: Partial<Record<string, string[]>>): Issue[] {
  const out: Issue[] = [];
  const tableKeys = new Set(c.tables.map((t) => t.key));
  const enabled = c.entities.filter((e) => e.enabled);
  if (!enabled.length) out.push({ field: 'entities', level: 'erro', message: 'Ative ao menos uma entidade' });
  for (const e of enabled) {
    const fields = schema[e.target];
    const label = TARGET_ENTITY_LABELS[e.target];
    for (const m of e.fields) {
      if (!fields.some((f) => f.key === m.target)) out.push({ field: `${e.target}.${m.target}`, level: 'erro', message: `${label}: o campo "${m.target}" não existe mais no ISP Sprint` });
      if (m.kind !== 'constante' && !m.sources.length && !(m.kind === 'condicional' && m.rules?.length)) out.push({ field: `${e.target}.${m.target}`, level: 'erro', message: `${label}: escolha o campo de origem de "${m.target}"` });
      const tb = m.table ?? m.transforms.find((t): t is Extract<Transform, { op: 'equivalence' }> => t.op === 'equivalence')?.table;
      if ((m.kind === 'equivalencia' || tb) && (!tb || !tableKeys.has(tb))) out.push({ field: `${e.target}.${m.target}`, level: 'erro', message: `${label}: tabela de equivalência de "${m.target}" não encontrada` });
      if (!m.approved) out.push({ field: `${e.target}.${m.target}`, level: 'revisao', message: `${label}: aprove ou ajuste a sugestão para "${m.target}"` });
      const known = sourceFields?.[e.source];
      if (known && known.length) for (const p of m.sources) if (!known.includes(p) && !p.startsWith('_ctx')) out.push({ field: `${e.target}.${m.target}`, level: 'revisao', message: `${label}: o campo de origem "${p}" não apareceu nos registros atuais (mudança na origem?)` });
    }
    for (const f of fields) if (f.required && !e.fields.some((m) => m.target === f.key)) out.push({ field: `${e.target}.${f.key}`, level: 'erro', message: `${label}: falta mapear ${f.label}` });
  }
  return out;
}

// ------------------------------------------------------------------ versões
export function nextImportVersion(current: string | null, major: boolean): string {
  if (!current) return '1.0';
  const [a, b] = current.split('.').map(Number) as [number, number];
  return major ? `${a + 1}.0` : `${a}.${b + 1}`;
}
export type ConfigChange = { path: string; kind: 'adicionado' | 'removido' | 'alterado'; before?: string; after?: string };
/** Diferenças legíveis entre duas configurações (por entidade, campo e tabela). */
export function diffConfigs(a: ImportConfig, b: ImportConfig): ConfigChange[] {
  const out: ConfigChange[] = [];
  const j = (x: unknown) => JSON.stringify(x);
  const cmp = (path: string, x: unknown, y: unknown) => { if (j(x) !== j(y)) out.push({ path, kind: x === undefined ? 'adicionado' : y === undefined ? 'removido' : 'alterado', before: x === undefined ? undefined : j(x), after: y === undefined ? undefined : j(y) }); };
  cmp('fuso', a.timezone, b.timezone);
  cmp('execução', a.execution, b.execution);
  const keys = new Set([...a.entities, ...b.entities].map((e) => `${e.source}→${e.target}`));
  for (const k of keys) {
    const ea = a.entities.find((e) => `${e.source}→${e.target}` === k), eb = b.entities.find((e) => `${e.source}→${e.target}` === k);
    if (!ea || !eb) { cmp(`entidade ${k}`, ea ? 'ativa' : undefined, eb ? 'ativa' : undefined); continue; }
    cmp(`${k} · ativa`, ea.enabled, eb.enabled); cmp(`${k} · política`, ea.policy, eb.policy); cmp(`${k} · legado`, ea.legacy, eb.legacy); cmp(`${k} · filtro`, ea.filter, eb.filter); cmp(`${k} · chave`, ea.keyFrom ?? null, eb.keyFrom ?? null); cmp(`${k} · chave alternativa`, ea.altKeyFrom ?? null, eb.altKeyFrom ?? null);
    const targets = new Set([...ea.fields, ...eb.fields].map((f) => f.target));
    for (const t of targets) {
      const fa = ea.fields.find((f) => f.target === t), fb = eb.fields.find((f) => f.target === t);
      const strip = (f?: FieldMapping) => f && { kind: f.kind, sources: f.sources, template: f.template, value: f.value, table: f.table, rules: f.rules, transforms: f.transforms, approved: f.approved };
      cmp(`${k} · ${t}`, strip(fa), strip(fb));
    }
  }
  const tk = new Set([...a.tables, ...b.tables].map((t) => t.key));
  for (const k of tk) cmp(`tabela ${k}`, a.tables.find((t) => t.key === k), b.tables.find((t) => t.key === k));
  return out;
}

// ------------------------------------------------------------------ resultado e indicadores
export const RECORD_ACTIONS = ['criar', 'atualizar', 'ignorar', 'revisar', 'erro'] as const;
export type RecordAction = (typeof RECORD_ACTIONS)[number];
export const RECORD_ACTION_LABELS: Record<RecordAction, string> = { criar: 'Criar', atualizar: 'Atualizar', ignorar: 'Ignorar', revisar: 'Revisar', erro: 'Erro' };
/** mesclados: linhas que repetem um registro já tratado na execução (ex.: a mesma empresa em várias negociações); filtrados: fora do filtro da entidade. */
export type RunCounters = { identificados: number; processados: number; criados: number; atualizados: number; ignorados: number; revisar: number; erros: number; pendentes: number; mesclados: number; filtrados: number };
export const EMPTY_COUNTERS: RunCounters = { identificados: 0, processados: 0, criados: 0, atualizados: 0, ignorados: 0, revisar: 0, erros: 0, pendentes: 0, mesclados: 0, filtrados: 0 };

export type QualityInput = { entity: TargetEntity; action: RecordAction; mappedFields: number; totalTargetFields: number; converted: number; mapped: number; issues: Issue[]; legacyKeys: number; refErrors: number; duplicate: boolean };
export type Quality = { campos: number; registros: number; transformacoes: number; relacionamentos: number; duplicidades: number; legado: number; impeditivos: number; revisao: number; porEntidade: Record<string, { total: number; erros: number; revisao: number }>; porCampo: { field: string; count: number }[] };
/** Indicadores separados (nenhum percentual único prova que a migração está certa). */
export function qualityOf(rows: QualityInput[]): Quality {
  const pct = (x: number, d: number) => (d ? Math.round((x / d) * 1000) / 10 : 100);
  const fieldsMapped = rows.reduce((s, r) => s + r.mappedFields, 0), fieldsTotal = rows.reduce((s, r) => s + r.totalTargetFields, 0);
  const transformed = rows.reduce((s, r) => s + r.mapped, 0), transformErrors = rows.reduce((s, r) => s + r.issues.filter((i) => i.level === 'erro' && !i.message.includes('obrigatório')).length, 0);
  const byField = new Map<string, number>();
  const byEntity: Quality['porEntidade'] = {};
  for (const r of rows) {
    const e = (byEntity[r.entity] ??= { total: 0, erros: 0, revisao: 0 });
    e.total++; if (r.action === 'erro') e.erros++; if (r.action === 'revisar') e.revisao++;
    for (const i of r.issues) if (i.level !== 'aviso') byField.set(`${r.entity}.${i.field}`, (byField.get(`${r.entity}.${i.field}`) ?? 0) + 1);
  }
  return {
    campos: pct(fieldsMapped, fieldsTotal),
    registros: pct(rows.filter((r) => r.action !== 'erro').length, rows.length),
    transformacoes: pct(transformed - transformErrors, transformed),
    relacionamentos: pct(rows.filter((r) => !r.refErrors).length, rows.length),
    duplicidades: rows.filter((r) => r.duplicate).length,
    legado: rows.filter((r) => r.legacyKeys > 0).length,
    impeditivos: rows.filter((r) => r.action === 'erro').length,
    revisao: rows.filter((r) => r.action === 'revisar').length,
    porEntidade: byEntity,
    porCampo: [...byField.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

// ------------------------------------------------------------------ permissões
export const IMPORT_CAPS = ['painel', 'conectores', 'modelos', 'aprovar_versao', 'simular', 'executar', 'grande_volume', 'auditoria'] as const;
export type ImportCap = (typeof IMPORT_CAPS)[number];
/** Quem pode o quê no motor (perfis do sistema). */
export const IMPORT_CAP_PROFILES: Record<ImportCap, readonly string[]> = {
  painel: ['administrador', 'diretoria', 'gerencia'], auditoria: ['administrador', 'diretoria', 'gerencia'], modelos: ['administrador', 'diretoria', 'gerencia'], simular: ['administrador', 'diretoria', 'gerencia'],
  conectores: ['administrador', 'diretoria'], aprovar_versao: ['administrador', 'diretoria'], executar: ['administrador', 'diretoria'], grande_volume: ['administrador', 'diretoria'],
};
export const importCan = (profiles: readonly string[], cap: ImportCap) => profiles.some((p) => IMPORT_CAP_PROFILES[cap].includes(p));
