import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY, TARGET_FIELDS, applyTransforms, configIssues, diffConfigs, discoverFields, evaluateRecord, getPath, nextImportVersion, qualityOf, suggestMappings, targetSchema,
  type EntityMapping, type ImportConfig,
} from './dataImport';

const deal = {
  _id: 'd1', name: 'Link dedicado prefeitura fictícia', amount_total: '12.500,90', win: true, closed_at: '2025-03-10T14:00:00-03:00', created_at: '2024-11-02 09:30',
  organization: { _id: 'o1', name: 'Prefeitura Fictícia' }, user: { email: 'vendedor@exemplo.test' }, deal_stage: { _id: 's9', name: 'Proposta' },
  deal_custom_fields: [{ custom_field: { label: 'Modalidade' }, value: 'Pregão Eletrônico' }, { custom_field: { label: 'Número do edital' }, value: '045/2025' }],
  campanha_antiga: 'Feira 2023',
};
const ctx = { timezone: 'America/Sao_Paulo', tables: [{ key: 'modalidade', label: 'Modalidade', refKind: 'valor' as const, rows: [{ from: 'Pregão Eletrônico', to: 'licitacao' }, { from: 'Adesão', to: 'adesao_ata' }], fallback: { kind: 'revisar' as const } }] };

describe('caminhos e descoberta', () => {
  it('lê caminhos aninhados e campos personalizados por rótulo', () => {
    expect(getPath(deal, 'organization.name')).toBe('Prefeitura Fictícia');
    expect(getPath(deal, 'deal_custom_fields[custom_field.label=Modalidade].value')).toBe('Pregão Eletrônico');
    expect(getPath(deal, 'deal_custom_fields[0].value')).toBe('Pregão Eletrônico');
    expect(getPath(deal, 'nada.aqui')).toBeUndefined();
  });
  it('descobre campos reais com tipo, exemplos e preenchimento', () => {
    const f = discoverFields([deal, { ...deal, win: false, closed_at: null }]);
    expect(f.find((x) => x.path === 'deal_custom_fields[custom_field.label=Número do edital].value')).toMatchObject({ type: 'texto', samples: ['045/2025'] });
    expect(f.find((x) => x.path === 'closed_at')).toMatchObject({ type: 'data', filled: 1, total: 2 });
    expect(f.find((x) => x.path === 'win')).toMatchObject({ type: 'booleano' });
  });
});

describe('transformações declarativas', () => {
  it('dinheiro, datas com fuso, documentos, telefones e equivalência', () => {
    expect(applyTransforms('12.500,90', [{ op: 'cents', decimal: ',', unit: 'reais' }], ctx).value).toBe(1_250_090);
    expect(applyTransforms('2024-11-02 09:30', [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], ctx).value).toBe('2024-11-02T12:30:00.000Z');
    expect(applyTransforms('2025-03-10T14:00:00-03:00', [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], ctx).value).toBe('2025-03-10T17:00:00.000Z');
    expect(applyTransforms('31/02/2025', [{ op: 'date', format: 'dd/mm/yyyy' }], ctx).error).toMatch(/Data inválida/);
    expect(applyTransforms('11.222.333/0001-81', [{ op: 'document' }], ctx).value).toBe('11222333000181');
    expect(applyTransforms('11.222.333/0001-80', [{ op: 'document' }], ctx).error).toMatch(/CNPJ inválido/);
    expect(applyTransforms('+55 (79) 99999-0000', [{ op: 'phone' }], ctx).value).toBe('79999990000');
    expect(applyTransforms('Adesão', [{ op: 'equivalence', table: 'modalidade' }], ctx).value).toBe('adesao_ata');
    expect(applyTransforms('Dispensa', [{ op: 'equivalence', table: 'modalidade' }], ctx).review).toMatch(/Sem equivalência/);
    expect(applyTransforms('  ', [{ op: 'trim' }, { op: 'default', value: 'empresarial' }], ctx).value).toBe('empresarial');
  });
});

const oppMapping: EntityMapping = {
  source: 'deals', target: 'oportunidade', enabled: true, legacy: 'preservar', policy: DEFAULT_POLICY, filter: [],
  fields: [
    { id: '1', target: 'title', kind: 'composicao', sources: ['name', 'deal_custom_fields[custom_field.label=Número do edital].value'], template: '{0} (edital {1})', transforms: [{ op: 'trim' }], approved: true },
    { id: '2', target: 'account', kind: 'direta', sources: ['organization._id'], transforms: [], approved: true },
    { id: '3', target: 'owner', kind: 'direta', sources: ['user.email'], transforms: [{ op: 'lower' }], approved: true },
    { id: '4', target: 'stage', kind: 'direta', sources: ['deal_stage._id'], transforms: [], approved: true },
    { id: '5', target: 'status', kind: 'condicional', sources: [], rules: [{ when: [{ path: 'win', op: 'true' }], value: 'ganha' }, { when: [{ path: 'win', op: 'false' }], value: 'perdida' }], value: 'aberta', transforms: [], approved: true },
    { id: '6', target: 'saleKind', kind: 'equivalencia', sources: ['deal_custom_fields[custom_field.label=Modalidade].value'], table: 'modalidade', transforms: [], approved: true },
    { id: '7', target: 'valueCents', kind: 'direta', sources: ['amount_total'], transforms: [{ op: 'cents', decimal: ',', unit: 'reais' }], approved: true },
    { id: '8', target: 'wonAt', kind: 'direta', sources: ['closed_at'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
  ],
};

describe('avaliação do registro', () => {
  it('composição, condicional, equivalência, conversões e legado', () => {
    const r = evaluateRecord(deal, oppMapping, TARGET_FIELDS.oportunidade, ctx);
    expect(r.issues).toEqual([]);
    expect(r.values).toMatchObject({ title: 'Link dedicado prefeitura fictícia (edital 045/2025)', account: 'o1', status: 'ganha', saleKind: 'licitacao', valueCents: 1_250_090, wonAt: '2025-03-10T17:00:00.000Z' });
    expect(r.originals.valueCents).toBe('12.500,90');
    expect(r.converted).toContain('valueCents');
    expect(r.legacy).toMatchObject({ campanha_antiga: 'Feira 2023', created_at: '2024-11-02 09:30' });
    expect(r.legacy).not.toHaveProperty('organization');
  });
  it('sem correspondência segura vai para revisão; erro impede; sugestão não aprovada não entra', () => {
    const r = evaluateRecord({ ...deal, amount_total: 'abc', deal_custom_fields: [{ custom_field: { label: 'Modalidade' }, value: 'Dispensa' }] }, oppMapping, TARGET_FIELDS.oportunidade, ctx);
    expect(r.issues.map((i) => [i.field, i.level])).toEqual([['saleKind', 'revisao'], ['valueCents', 'erro']]);
    const un = evaluateRecord(deal, { ...oppMapping, fields: oppMapping.fields.map((f) => (f.target === 'title' ? { ...f, approved: false } : f)) }, TARGET_FIELDS.oportunidade, ctx);
    expect(un.issues.map((i) => i.level)).toEqual(['revisao', 'erro']); // não aprovada + título obrigatório
  });
});

describe('modelo', () => {
  const cfg: ImportConfig = { source: 'rdstation_crm', timezone: 'America/Sao_Paulo', tables: ctx.tables, execution: { batchSize: 50, largeVolume: 500 }, entities: [oppMapping] };
  it('sugestões trazem motivo e confiança e não se aprovam sozinhas', () => {
    const s = suggestMappings(discoverFields([deal]), TARGET_FIELDS.oportunidade);
    expect(s.find((x) => x.target === 'valueCents')).toMatchObject({ source: 'amount_total' });
    expect(s.every((x) => x.reason.length > 0 && x.confidence > 0)).toBe(true);
    expect(s.find((x) => x.target === 'wonAt')?.ambiguous).toBe(true); // closed_at também serve para perda
  });
  it('valida contra o destino e a origem atuais', () => {
    expect(configIssues(cfg, targetSchema([]))).toEqual([]);
    const broken = { ...cfg, entities: [{ ...oppMapping, fields: oppMapping.fields.filter((f) => f.target !== 'owner').concat({ id: 'x', target: 'naoexiste', kind: 'direta', sources: ['a'], transforms: [], approved: true }) }] };
    expect(configIssues(broken, targetSchema([])).map((i) => i.message)).toEqual(['Oportunidades: o campo "naoexiste" não existe mais no ISP Sprint', 'Oportunidades: falta mapear Responsável']);
    expect(configIssues(cfg, targetSchema([]), { deals: ['name'] }).some((i) => i.message.includes('não apareceu'))).toBe(true);
  });
  it('versões e comparação', () => {
    expect([nextImportVersion(null, false), nextImportVersion('1.0', false), nextImportVersion('1.2', true)]).toEqual(['1.0', '1.1', '2.0']);
    const b = { ...cfg, entities: [{ ...oppMapping, fields: oppMapping.fields.map((f) => (f.target === 'valueCents' ? { ...f, transforms: [{ op: 'cents' as const, decimal: '.' as const, unit: 'reais' as const }] } : f)) }] };
    expect(diffConfigs(cfg, b).map((c) => [c.path, c.kind])).toEqual([['deals→oportunidade · valueCents', 'alterado']]);
  });
  it('indicadores separados', () => {
    const q = qualityOf([
      { entity: 'oportunidade', action: 'criar', mappedFields: 8, totalTargetFields: 14, converted: 3, mapped: 8, issues: [], legacyKeys: 2, refErrors: 0, duplicate: false },
      { entity: 'oportunidade', action: 'erro', mappedFields: 8, totalTargetFields: 14, converted: 1, mapped: 8, issues: [{ field: 'valueCents', level: 'erro', message: 'Valor inválido' }], legacyKeys: 0, refErrors: 1, duplicate: true },
    ]);
    expect(q).toMatchObject({ registros: 50, relacionamentos: 50, duplicidades: 1, legado: 1, impeditivos: 1, porCampo: [{ field: 'oportunidade.valueCents', count: 1 }] });
  });
});
