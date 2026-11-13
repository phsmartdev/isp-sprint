import { describe, expect, it } from 'vitest';
import { allowedDecisions, complianceKpis, effectiveLevel, requesterFloor, currentRules, evaluateConcession, splitEvenly, type ComplianceRule, type RequestForEval } from './giftCompliance';

const rule = (p: Partial<ComplianceRule>): ComplianceRule => ({
  id: p.id ?? `r-${p.key ?? 'x'}-${p.version ?? 1}`, key: 'x', version: 1, name: 'Regra fictícia', description: null, param: 'valor_por_concessao', controlType: 'orientativa', approverLevel: 'gerencia',
  limit: null, windowDays: null, allowedKitIds: [], allowedItemIds: [], kinds: [], natures: [], segments: [], purposes: [], kitCategories: [], validFrom: '2026-01-01', validTo: null, active: true, ...p,
});
const req = (p: Partial<RequestForEval> = {}): RequestForEval => ({
  kind: 'kit', purpose: 'relacionamento', totalCents: 10_000, itemUnits: 3, kitIds: ['k1'], itemIds: [],
  accounts: [{ id: 'a1', name: 'Conta Fictícia', nature: 'privada', segment: 'empresarial', shareCents: 10_000 }], budgetAvailableCents: null, on: '2026-11-10', ...p,
});

describe('compliance de concessões', () => {
  it('sem diretrizes cadastradas: conforme, sem inventar limite', () => {
    const ev = evaluateConcession([], req(), []);
    expect(ev.outcome).toBe('conforme');
    expect(ev.findings).toEqual([]);
  });

  it('limite orientativo ultrapassado vira exceção (não rejeita) e explica limite e valor', () => {
    const ev = evaluateConcession([rule({ key: 'valor', limit: 5_000 })], req(), []);
    expect(ev.outcome).toBe('excecao');
    expect(ev.level).toBe('gerencia');
    expect(ev.findings[0]!.message).toMatch(/ultrapassa o recomendado/);
    expect(ev.findings[0]!.message).toMatch(/R\$\s?50,00/);
    expect(ev.findings[0]!.message).toMatch(/R\$\s?100,00/);
  });

  it('acumulado por conta e frequência olham só a janela e cada conta', () => {
    const hist = [{ on: '2026-11-01', totalCents: 30_000, accounts: [{ id: 'a1', shareCents: 30_000 }] }, { on: '2025-01-01', totalCents: 90_000, accounts: [{ id: 'a1', shareCents: 90_000 }] }];
    const rs = [rule({ key: 'acc', param: 'valor_acumulado_conta', limit: 35_000, windowDays: 90, controlType: 'autorizacao', approverLevel: 'diretoria' }), rule({ key: 'freq', param: 'frequencia_conta', limit: 1, windowDays: 90 })];
    const ev = evaluateConcession(rs, req(), hist);
    expect(ev.findings.map((f) => f.ruleKey)).toEqual(['acc', 'freq']);
    expect(ev.findings[0]!.actual).toBe(40_000);
    expect(ev.findings[0]!.history).toMatch(/R\$\s?300,00/);
    expect(ev.outcome).toBe('excecao');
    expect(ev.level).toBe('diretoria');
  });

  it('restrição obrigatória impede e não tem alçada que aprove', () => {
    const r = rule({ key: 'pub', param: 'condicao', controlType: 'restricao', natures: ['publica'], kinds: ['patrocinio_financeiro'] });
    const priv = evaluateConcession([r], req({ kind: 'patrocinio_financeiro' }), []);
    expect(priv.outcome).toBe('conforme');
    const pub = evaluateConcession([r], req({ kind: 'patrocinio_financeiro', accounts: [{ id: 'a2', name: 'Órgão Fictício', nature: 'publica', segment: 'governamental', shareCents: 10_000 }] }), []);
    expect(pub.outcome).toBe('impedido');
    expect(pub.level).toBeNull();
    expect(allowedDecisions(pub, ['gerencia', 'diretoria'], 'gerencia').decisions).toEqual(['ajustes', 'rejeitar']);
  });

  it('composição de kit e quantidade de itens', () => {
    const rs = [rule({ key: 'comp', param: 'composicao_kit', allowedKitIds: ['k2'] }), rule({ key: 'qtd', param: 'quantidade_itens', limit: 2 })];
    const ev = evaluateConcession(rs, req(), []);
    expect(ev.findings.map((f) => f.ruleKey)).toEqual(['comp', 'qtd']);
  });

  it('orçamento: sem lançamento vinculado ou acima do saldo', () => {
    const r = rule({ key: 'orc', param: 'orcamento_disponivel', controlType: 'autorizacao' });
    expect(evaluateConcession([r], req(), []).outcome).toBe('autorizacao');
    expect(evaluateConcession([r], req({ budgetAvailableCents: 20_000 }), []).outcome).toBe('conforme');
    expect(evaluateConcession([r], req({ budgetAvailableCents: 5_000 }), []).findings[0]!.history).toMatch(/saldo/);
  });

  it('vigência e versão: vale a maior versão vigente na data', () => {
    const all = [rule({ key: 'v', version: 1, limit: 1 }), rule({ key: 'v', version: 2, limit: 50_000, validFrom: '2026-06-01' }), rule({ key: 'old', validTo: '2026-03-01', limit: 1 })];
    expect(currentRules(all, '2026-11-10').map((r) => `${r.key}${r.version}`)).toEqual(['v2']);
    expect(currentRules(all, '2026-02-01').map((r) => `${r.key}${r.version}`).sort()).toEqual(['old1', 'v1']);
  });

  it('alçada: gerência não decide o que exige Diretoria; exceção só com aprovação excepcional', () => {
    expect(allowedDecisions({ outcome: 'excecao', level: 'diretoria' }, ['gerencia'], 'diretoria').decisions).toEqual([]);
    expect(allowedDecisions({ outcome: 'excecao', level: 'gerencia' }, ['gerencia'], 'gerencia').decisions).toEqual(['aprovar_excecao', 'ajustes', 'rejeitar']);
    expect(allowedDecisions({ outcome: 'conforme', level: null }, ['diretoria'], 'gerencia').decisions[0]).toBe('aprovar');
    expect(allowedDecisions({ outcome: 'conforme', level: null }, [], 'gerencia').decisions).toEqual([]);
  });

  it('alçada efetiva: sempre o nível acima de quem solicitou', () => {
    expect(requesterFloor(['operacao'])).toBe('gerencia');
    expect(requesterFloor(['supervisao', 'marketing'])).toBe('gerencia');
    expect(requesterFloor(['gerencia'])).toBe('diretoria');
    expect(requesterFloor(['diretoria'])).toBe('diretoria');
    // conforme pedido por gerente: sobe para a Diretoria
    expect(effectiveLevel({ outcome: 'conforme', level: null }, 'gerencia', 'diretoria')).toBe('diretoria');
    // pedido da operação: Gestão comercial, salvo se a diretriz exigir Diretoria
    expect(effectiveLevel({ outcome: 'conforme', level: null }, 'gerencia', 'gerencia')).toBe('gerencia');
    expect(effectiveLevel({ outcome: 'autorizacao', level: 'diretoria' }, 'gerencia', 'gerencia')).toBe('diretoria');
    expect(effectiveLevel({ outcome: 'impedido', level: null }, 'gerencia', 'gerencia')).toBe('gerencia');
  });

  it('política: valor por kit da categoria, matriz por classificação e situações de atenção', () => {
    const rs = [
      rule({ key: 'catB', param: 'valor_por_kit', limit: 250_00, kitCategories: ['B'] }),
      rule({ key: 'matriz', param: 'matriz_stakeholder' }),
      rule({ key: 'atencao', param: 'situacao_atencao', controlType: 'autorizacao' }),
    ];
    const b = req({ kitCategory: 'B', unitCents: 200_00, recipients: [{ name: 'Pessoa INA', powerClass: 'ina' }] });
    expect(evaluateConcession(rs, b, []).outcome).toBe('conforme');
    // NIA só C ou D: B é exceção
    const ev = evaluateConcession(rs, { ...b, recipients: [{ name: 'Pessoa NIA', powerClass: 'nia' }] }, []);
    expect(ev.outcome).toBe('excecao');
    expect(ev.findings[0]!.message).toMatch(/categorias C, D/);
    // limite da categoria B por kit, e a regra da categoria A não se aplica ao kit B
    expect(evaluateConcession([...rs, rule({ key: 'catA', param: 'valor_por_kit', limit: 1, kitCategories: ['A'] })], { ...b, unitCents: 260_00 }, []).findings.map((f) => f.ruleKey)).toEqual(['catB']);
    // entrega coletiva não exige classificação individual
    expect(evaluateConcession(rs, { ...b, collective: true, recipients: [] }, []).outcome).toBe('conforme');
    // sem classificação: aponta
    expect(evaluateConcession(rs, { ...b, recipients: [{ name: 'Sem análise', powerClass: 'nao_avaliado' }] }, []).findings[0]!.message).toMatch(/sem classificação/);
    expect(evaluateConcession(rs, { ...b, attention: ['Negociação comercial'] }, []).outcome).toBe('autorizacao');
  });

  it('rateio soma o total e indicadores usam só executadas', () => {
    expect(splitEvenly(10_001, 3)).toEqual([3_335, 3_333, 3_333]);
    const k = complianceKpis([{ totalCents: 100, accountIds: ['a', 'b'], exception: false, complete: true }, { totalCents: 300, accountIds: ['a'], exception: true, complete: false }], 2);
    expect(k).toEqual({ realizedCents: 400, executed: 2, accounts: 2, exceptions: 1, conformityPct: 50, exceptionPct: 50, traceabilityPct: 50, pendencies: 2 });
    expect(complianceKpis([], 0).conformityPct).toBeNull();
  });
});
