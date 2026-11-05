import { describe, expect, it } from 'vitest';
import {
  ERP_FIELDS, canTransition, compareWithIxc, criticalChanges, effectiveValue, erpField, erpIssues, formatError, personTypeOf, validCnpj, validCpf, type ErpItem,
} from './contractErp';
import { RACI_MATRIX, holdersOf, slaDueAt, taskSlaState } from './playbook';

const item: ErpItem = { description: 'Link', qty: 1, unitCents: 100, ixcCode: '5', unit: 'UN', periodicity: 'Mensal', location: null, notes: null };

describe('Playbook', () => {
  it('matriz do documento: um único A por atividade, sem siglas fora da lista', () => {
    expect(RACI_MATRIX).toHaveLength(39);
    expect(new Set(RACI_MATRIX.map((r) => r.key)).size).toBe(39);
    const all = RACI_MATRIX.flatMap((r) => [...r.R, r.A, ...r.C, ...r.I]);
    expect(all.every((x) => !['AC', 'TC', 'ANS'].includes(x))).toBe(true);
  });
  it('SLA em aberto não gera prazo; com SLA, prazo e situação', () => {
    const t0 = new Date('2026-11-04T12:00:00Z');
    expect(slaDueAt(t0, null)).toBeNull();
    expect(slaDueAt(t0, 48)?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(taskSlaState(null, null, t0)).toBe('sem_sla');
    expect(taskSlaState('2026-11-04T10:00:00Z', null, t0)).toBe('atrasada');
    expect(taskSlaState('2026-11-04T20:00:00Z', null, t0)).toBe('vence_hoje');
    expect(taskSlaState('2026-11-10T20:00:00Z', null, t0)).toBe('no_prazo');
    expect(taskSlaState('2026-11-04T10:00:00Z', t0, t0)).toBe('concluida');
  });
  it('titulares: só usuários do sistema contam para permissão (ator externo não loga)', () => {
    expect(holdersOf([{ role: 'SC', userId: 'u1', externalName: null }, { role: 'SC', userId: null, externalName: 'Fulano' }, { role: 'GC', userId: 'u2', externalName: null }], ['SC'])).toEqual(['u1']);
  });
});

describe('Cadastro ERP', () => {
  it('documentos e formatos', () => {
    expect(validCnpj('11.222.333/0001-81')).toBe(true);
    expect(validCnpj('11.222.333/0001-80')).toBe(false);
    expect(validCpf('529.982.247-25')).toBe(true);
    expect(validCpf('111.111.111-11')).toBe(false);
    expect(personTypeOf('529.982.247-25')).toBe('F');
    expect(personTypeOf('11222333000181')).toBe('J');
    expect(formatError(erpField('d_vencimento')!, '32')).toBe('Dia entre 1 e 31');
    expect(formatError(erpField('a_uf')!, 'se')).toBeNull();
    expect(formatError(erpField('a_contribuinte_icms')!, 'X')).toBe('Opção inválida');
    expect(formatError(erpField('a_cnpj_cpf')!, 'qualquer', { personType: 'E' })).toBeNull();
  });
  it('manual vence herdado; vazio volta ao herdado', () => {
    const def = erpField('a_razao')!;
    expect(effectiveValue(def, {}, { 'contact.name': 'Conta' })).toEqual({ value: 'Conta', origin: 'herdado' });
    expect(effectiveValue(def, { a_razao: 'Razão' }, { 'contact.name': 'Conta' })).toEqual({ value: 'Razão', origin: 'manual' });
    expect(effectiveValue(def, { a_razao: '  ' }, {})).toEqual({ value: null, origin: 'vazio' });
  });
  it('pendências: obrigatórios, senha, coerência do tipo de pessoa e itens', () => {
    const full = Object.fromEntries(ERP_FIELDS.filter((f) => f.required && f.type !== 'secret').map((f) => [f.key, f.options ? f.options[0]!.value : f.type === 'date' ? '2026-01-01' : f.type === 'month' ? '2026-01' : f.type === 'int' || f.type === 'money' ? '10' : f.type === 'email' ? 'a@b.co' : f.type === 'phone' ? '79999990000' : f.type === 'cep' ? '49040460' : f.type === 'uf' ? 'SE' : f.type === 'doc' ? '11222333000181' : 'x']));
    full.a_tipo_pessoa = 'J';
    expect(erpIssues(full, [item], true)).toEqual([]);
    expect(erpIssues(full, [item], false).map((i) => i.key)).toEqual(['a_senha']);
    expect(erpIssues({ ...full, a_tipo_pessoa: 'F' }, [item], true)[0]).toMatchObject({ key: 'a_tipo_pessoa', message: 'O documento é CNPJ: pessoa jurídica' });
    expect(erpIssues(full, [], true).map((i) => i.key)).toEqual(['items']);
    expect(erpIssues(full, [{ ...item, ixcCode: null }], true).map((i) => i.key)).toEqual(['items.0.ixcCode']);
  });
  it('críticos: só os marcados e os itens (ordem das chaves não importa)', () => {
    expect(criticalChanges({ a_razao: 'A', f_banda: '1' }, { a_razao: 'A', f_banda: '2' }, [item], [item])).toEqual([]);
    expect(criticalChanges({ d_vencimento: '10' }, { d_vencimento: '15' }, [item], [item])).toEqual(['d_vencimento']);
    const reordered = JSON.parse(JSON.stringify({ notes: null, unit: 'UN', qty: 1, description: 'Link', unitCents: 100, ixcCode: '5', location: null, periodicity: 'Mensal' })) as ErpItem;
    expect(criticalChanges({}, {}, [item], [reordered])).toEqual([]);
    expect(criticalChanges({}, {}, [item], [{ ...item, unitCents: 200 }])).toEqual(['items']);
  });
  it('fluxo: aprovação só depois da conferência; lançamento só depois de aprovado; divergente volta a conferir', () => {
    expect(canTransition('em_preenchimento', 'approve')).toBe(false);
    expect(canTransition('aguardando_conferencia', 'approve')).toBe(true);
    expect(canTransition('em_preenchimento', 'launch')).toBe(false);
    expect(canTransition('aprovado', 'launch')).toBe(true);
    expect(canTransition('divergente', 'check')).toBe(true);
    expect(canTransition('conferido_ixc', 'check')).toBe(false);
  });
  it('conferência no IXC: normaliza, marca divergência e não lido nunca vira ok', () => {
    const r = compareWithIxc({ a_razao: 'Ação Ltda', a_cnpj_cpf: '11.222.333/0001-81', a_filial: '1', a_cep: '49040-460', g_obs_internas: 'x', b_modelo: '03' }, { cliente: { razao: 'ACAO  LTDA', cnpj_cpf: '11222333000181', filial_id: '2' }, contrato: { id_modelo: '3' } });
    const by = Object.fromEntries(r.map((x) => [x.key, x.status]));
    expect(by).toEqual({ a_razao: 'ok', a_cnpj_cpf: 'ok', a_filial: 'divergente', a_cep: 'nao_lido', b_modelo: 'ok' });
  });
});

describe('avisos por nível de responsabilidade', () => {
  it('regras normalizadas: letras válidas, antecedência e escalonamento em aberto por padrão', async () => {
    const { normalizeNotifyRules, rolesToNotify, escalationReached, raciRow } = await import('./playbook');
    const d = normalizeNotifyRules(null);
    expect(d).toMatchObject({ dueSoonHours: null, escalation: [], events: { criada: ['R'], concluida: ['A', 'I'] } });
    const r = normalizeNotifyRules({ events: { criada: ['R', 'X', 'A', 'A'] }, dueSoonHours: 0, escalation: [{ afterHours: 48, role: 'GC' }, { afterHours: 4, role: 'SC' }, { afterHours: 5, role: 'NADA' }] });
    expect(r.events.criada).toEqual(['R', 'A']);
    expect(r.dueSoonHours).toBeNull();
    expect(r.escalation).toEqual([{ afterHours: 4, role: 'SC' }, { afterHours: 48, role: 'GC' }]);
    expect(rolesToNotify(raciRow('cadastro_erp'), ['A', 'C', 'I'])).toEqual([{ letter: 'A', roles: ['SC'] }, { letter: 'C', roles: ['FIN'] }, { letter: 'I', roles: ['GC'] }]);
    expect(escalationReached(10, r.escalation).map((l) => l.role)).toEqual(['SC']);
  });
});
