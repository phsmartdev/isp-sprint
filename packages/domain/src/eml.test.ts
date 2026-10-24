import { describe, expect, it } from 'vitest';
import { buildEml, emlFilename } from './eml';

describe('.eml do e-mail de origem', () => {
  it('cabeçalhos com acento codificados, corpo em base64 e quebra de linha CRLF', () => {
    const eml = buildEml({ from: 'compras@prefeitura.gov.br', fromName: 'Setor de Compras — Prefeitura', to: ['comercial@bkt.com.br'], cc: ['x@y.com'], subject: 'Cotação de link dedicado', date: new Date('2026-10-23T12:00:00Z'), messageId: '<abc@mail>', text: 'Olá,\nsegue a solicitação.' });
    expect(eml).toMatch(/^From: =\?UTF-8\?B\?.+\?= <compras@prefeitura\.gov\.br>\r\n/);
    expect(eml).toContain('Subject: =?UTF-8?B?');
    expect(eml).toContain('Cc: x@y.com');
    expect(eml).toContain('Message-ID: <abc@mail>');
    const body = eml.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Olá,\nsegue a solicitação.');
    expect(eml).not.toMatch(/[^\r]\n/);
  });
  it('quebra de linha no assunto não injeta cabeçalho; nome de arquivo seguro', () => {
    const eml = buildEml({ from: 'a@b.com', to: ['c@d.com'], subject: 'Oi\r\nBcc: z@z.com', date: new Date(), text: '' });
    expect(eml).not.toMatch(/\r\nBcc:/);
    expect(emlFilename('Pedido: link/fibra?')).toBe('E-mail de origem - Pedido link fibra.eml');
  });
});
