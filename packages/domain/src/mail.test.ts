import { describe, expect, it } from 'vitest';
import { autoLinkContact, domainAllowed, evaluateRules, externalParticipants, mailSettingsErrors, parseAddresses, pickAssignee, replySubject, ruleErrors, slaState, statusAfterMessage, type MailRule } from './mail';

describe('e-mail: endereços e domínios', () => {
  it('lê cabeçalhos com nome, aspas e vírgulas', () => {
    expect(parseAddresses('"Prado, Helena" <Helena@Cliente.test>, rui@cliente.test, lixo')).toEqual([{ name: 'Prado, Helena', email: 'helena@cliente.test' }, { name: null, email: 'rui@cliente.test' }]);
    expect(parseAddresses(null)).toEqual([]);
  });
  it('domínio permitido e configuração', () => {
    expect(domainAllowed('comercial@yepnet.test', ['@yepnet.test'])).toBe(true);
    expect(domainAllowed('x@gmail.com', ['yepnet.test'])).toBe(false);
    expect(mailSettingsErrors({ allowedDomains: [], syncDays: 30 })[0]).toMatch(/domínio/);
    expect(mailSettingsErrors({ allowedDomains: ['yepnet.test'], syncDays: 120 })[0]).toMatch(/90 dias/);
    expect(externalParticipants(['ana@yepnet.test', 'Rui@Cliente.test', 'rui@cliente.test'], ['yepnet.test'])).toEqual(['rui@cliente.test']);
  });
  it('conta só é ligada sozinha quando não há dúvida', () => {
    expect(autoLinkContact([{ email: 'a@c.test', contactId: 'c1' }, { email: 'b@c.test', contactId: 'c1' }])).toEqual({ contactId: 'c1', ambiguous: false });
    expect(autoLinkContact([{ email: 'a@c.test', contactId: 'c1' }, { email: 'b@d.test', contactId: 'c2' }])).toEqual({ contactId: null, ambiguous: true });
    expect(replySubject('Re: Proposta')).toBe('Re: Proposta');
    expect(replySubject('Proposta')).toBe('Re: Proposta');
  });
});

describe('e-mail: regras, direcionamento e prazo', () => {
  const rule = (id: string, position: number, def: MailRule['def'], mailboxId: string | null = null): MailRule => ({ id, name: id, position, active: true, mailboxId, def });
  const facts = { from: 'compras@prefeitura.test', to: ['comercial@yepnet.test'], subject: 'Pedido de cotação de link dedicado', text: 'Precisamos de 200 Mbps', mailboxId: 'm1' };
  it('primeira regra que casa vence; "todas" × "qualquer"; regra de outra caixa não vale', () => {
    const rules = [
      rule('outra-caixa', 0, { match: 'qualquer', conditions: [{ field: 'dominio', op: 'igual', value: 'prefeitura.test' }], actions: { tag: 'x' } }, 'm2'),
      rule('ambas', 1, { match: 'todas', conditions: [{ field: 'dominio', op: 'igual', value: '@prefeitura.test' }, { field: 'assunto', op: 'contem', value: 'boleto' }], actions: { queueId: 'fin' } }),
      rule('cotacao', 2, { match: 'qualquer', conditions: [{ field: 'assunto', op: 'contem', value: 'cotação' }, { field: 'texto', op: 'contem', value: 'nada' }], actions: { queueId: 'com', priority: 'alta' } }),
    ];
    expect(evaluateRules(rules, facts)!.rule.id).toBe('cotacao');
    expect(evaluateRules(rules, { ...facts, subject: 'Boleto vencido' })!.rule.id).toBe('ambas');
    expect(evaluateRules([rule('n', 0, { match: 'todas', conditions: [{ field: 'de', op: 'nao_contem', value: 'prefeitura' }], actions: { tag: 'y' } })], facts)).toBeNull();
    expect(ruleErrors({ name: 'Regra', def: { match: 'todas', conditions: [{ field: 'de', op: 'contem', value: 'x' }], actions: {} } })[0]).toMatch(/ação/);
    expect(ruleErrors({ name: 'Regra', def: { match: 'todas', conditions: [{ field: 'de', op: 'contem', value: 'x' }], actions: { ignore: true, queueId: 'q' } } })[0]).toMatch(/ignora/);
  });
  it('rodízio por carga, carteira e manual', () => {
    const base = { members: ['a', 'b', 'c'], openLoad: { a: 3, b: 1, c: 1 }, lastAssignedAt: { a: null, b: '2026-10-22T10:00:00Z', c: '2026-10-22T09:00:00Z' }, accountOwnerId: null };
    expect(pickAssignee({ ...base, mode: 'rodizio' })).toBe('c');
    expect(pickAssignee({ ...base, mode: 'carteira', accountOwnerId: 'a' })).toBe('a');
    expect(pickAssignee({ ...base, mode: 'carteira', accountOwnerId: 'fora' })).toBe('c');
    expect(pickAssignee({ ...base, mode: 'manual' })).toBeNull();
    expect(pickAssignee({ ...base, mode: 'rodizio', available: ['a'] })).toBe('a');
  });
  it('prazo de primeira resposta e mudança de situação', () => {
    const t = { firstInboundAt: '2026-10-22T08:00:00Z', firstReplyAt: null, slaHours: 10 };
    expect(slaState(t, '2026-10-22T09:00:00Z').state).toBe('no_prazo');
    expect(slaState(t, '2026-10-22T16:30:00Z').state).toBe('vencendo');
    expect(slaState(t, '2026-10-22T19:00:00Z')).toEqual({ state: 'vencido', dueAt: '2026-10-22T18:00:00.000Z' });
    expect(slaState({ ...t, firstReplyAt: '2026-10-22T20:00:00Z' }, '2026-10-23T00:00:00Z').state).toBe('respondida_fora');
    expect(slaState({ ...t, slaHours: null }, '2026-10-23T00:00:00Z').state).toBe('sem_prazo');
    expect(statusAfterMessage('em_atendimento', 'saida', true)).toBe('aguardando_cliente');
    expect(statusAfterMessage('aguardando_cliente', 'entrada', true)).toBe('em_atendimento');
    expect(statusAfterMessage('resolvida', 'entrada', false)).toBe('nova');
  });
});
