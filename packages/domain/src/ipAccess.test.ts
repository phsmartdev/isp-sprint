import { describe, expect, it } from 'vitest';
import { ipAllowed, ipInRule, parseIp, validateIpPolicy } from './ipAccess';

describe('acesso por IP', () => {
  it('IPv4 exato e por faixa; IPv4 mapeado em IPv6', () => {
    expect(ipInRule('200.150.10.20', '200.150.10.20')).toBe(true);
    expect(ipInRule('200.150.10.99', '200.150.10.0/24')).toBe(true);
    expect(ipInRule('200.150.11.1', '200.150.10.0/24')).toBe(false);
    expect(ipInRule('::ffff:200.150.10.5', '200.150.10.0/24')).toBe(true);
    expect(parseIp('999.1.1.1')).toBeNull();
  });
  it('IPv6 com e sem abreviação', () => {
    expect(ipInRule('2804:14c:1::abcd', '2804:14c:1::/48')).toBe(true);
    expect(ipInRule('2804:14c:2::1', '2804:14c:1::/48')).toBe(false);
    expect(ipInRule('2804:14c:0001:0000:0000:0000:0000:0001', '2804:14c:1::1')).toBe(true);
  });
  it('política: desligada libera tudo; exceção por pessoa; validação', () => {
    const p = { enabled: true, rules: [{ cidr: '10.0.0.0/8', label: 'Escritório' }] };
    expect(ipAllowed('10.1.2.3', p)).toBe(true);
    expect(ipAllowed('8.8.8.8', p)).toBe(false);
    expect(ipAllowed('8.8.8.8', p, true)).toBe(true);
    expect(ipAllowed('8.8.8.8', { ...p, enabled: false })).toBe(true);
    expect(ipAllowed(null, p)).toBe(false);
    expect(validateIpPolicy({ enabled: true, rules: [] })).toHaveLength(1);
    expect(validateIpPolicy({ enabled: true, rules: [{ cidr: '0.0.0.0/0', label: 'tudo' }] })[0]).toMatch(/grande demais/);
    expect(validateIpPolicy({ enabled: true, rules: [{ cidr: 'abc', label: 'x' }] })[0]).toMatch(/não é um IP/);
  });
});
