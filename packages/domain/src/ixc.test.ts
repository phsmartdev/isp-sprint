import { describe, expect, it } from 'vitest';
import { ixcCents, ixcDate, ixcDocumentVariants, ixcInvoice, ixcInvoiceSummary, ixcListRequest, ixcOrder, ixcOrigin } from './ixc';

const q = { qtype: 'fn_areceber.id_cliente', query: '10', oper: '=' as const, page: 1, rp: 50, sortname: 'fn_areceber.data_vencimento', sortorder: 'desc' as const };

describe('IXC: trava de leitura', () => {
  it('sempre envia ixcsoft: listar, POST e Basic usuário:token', () => {
    const r = ixcListRequest('https://ixc.exemplo.com.br/', '6', 'abc', 'fn_areceber', q);
    expect(r.url).toBe('https://ixc.exemplo.com.br/webservice/v1/fn_areceber');
    expect(r.init.method).toBe('POST');
    expect(r.init.headers.ixcsoft).toBe('listar');
    expect(r.init.headers.authorization).toBe(`Basic ${btoa('6:abc')}`);
    expect(JSON.parse(r.init.body)).toMatchObject({ qtype: 'fn_areceber.id_cliente', page: '1', rp: '50' });
  });
  it('recusa tabela, campo, operador e paginação fora da lista', () => {
    expect(() => ixcListRequest('https://x', '1', 't', 'usuarios', { ...q, qtype: 'usuarios.id', sortname: 'usuarios.id' })).toThrow(/não liberada/);
    expect(() => ixcListRequest('https://x', '1', 't', 'fn_areceber', { ...q, qtype: 'cliente.id' })).toThrow(/fora da tabela/);
    expect(() => ixcListRequest('https://x', '1', 't', 'fn_areceber', { ...q, qtype: "fn_areceber.id' or 1=1" })).toThrow(/fora da tabela/);
    expect(() => ixcListRequest('https://x', '1', 't', 'fn_areceber', { ...q, oper: 'L' as never })).toThrow(/Operador/);
    expect(() => ixcListRequest('https://x', '1', 't', 'fn_areceber', { ...q, rp: 5000 })).toThrow(/Paginação/);
  });
});

describe('IXC: leitura dos dados', () => {
  it('valores, datas, documentos e origem', () => {
    expect(ixcCents('1234.56')).toBe(123456);
    expect(ixcCents('1.234,56')).toBe(123456);
    expect(ixcCents('')).toBe(0);
    expect(ixcDate('2026-10-28 10:00:00')).toBe('2026-10-28');
    expect(ixcDate('28/10/2026')).toBe('2026-10-28');
    expect(ixcDate('0000-00-00')).toBeNull();
    expect(ixcDocumentVariants('12345678000190')).toEqual(['12.345.678/0001-90', '12345678000190']);
    expect(ixcDocumentVariants('123.456.789-01')).toEqual(['123.456.789-01', '12345678901']);
    expect(ixcOrigin('https://ixc.yepnet.com.br/app/login')).toBe('https://ixc.yepnet.com.br');
  });
  it('faturas: em aberto, vencidas e recebidas', () => {
    const today = '2026-10-28';
    const list = [
      ixcInvoice({ id: 1, status: 'A', valor: '100.00', data_vencimento: '2026-10-10' }, today),
      ixcInvoice({ id: 2, status: 'A', valor: '100.00', data_vencimento: '2026-11-10' }, today),
      ixcInvoice({ id: 3, status: 'R', valor: '100.00', valor_recebido: '100.00', data_vencimento: '2026-09-10', pagamento_data: '2026-09-09' }, today),
      ixcInvoice({ id: 4, status: 'C', valor: '50.00', data_vencimento: '2026-08-10' }, today),
      ixcInvoice({ id: 5, status: 'P', valor: '100.00', valor_aberto: '40.00', valor_recebido: '60.00', data_vencimento: '2026-10-20' }, today),
    ];
    expect(list[0]).toMatchObject({ vencida: true, diasAtraso: 18, statusLabel: 'A receber' });
    expect(list[3]).toMatchObject({ abertoCents: 0, recebidoCents: 0 });
    expect(ixcInvoiceSummary(list)).toEqual({ abertoCents: 24000, abertas: 3, vencidoCents: 14000, vencidas: 2, maiorAtraso: 18, recebidoCents: 16000 });
  });
  it('ordens de serviço', () => {
    expect(ixcOrder({ id: 9, status: 'AG', prioridade: 'A', data_abertura: '2026-10-01 08:00:00' })).toMatchObject({ statusLabel: 'Agendada', prioridade: 'Alta', abertura: '2026-10-01', aberta: true });
    expect(ixcOrder({ id: 9, status: 'F', data_fechamento: '2026-10-02' }).aberta).toBe(false);
  });
});
