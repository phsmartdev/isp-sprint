import { describe, expect, it } from 'vitest';
import { glpiTicketHeader, glpiBody, glpiOpen, glpiValidationError, pendingValidations, glpiStatusLabel, glpiTicketErrors, glpiTicketUrl, htmlToText, parseTimeline, textToHtml, webhookTicketId } from './glpi';

describe('GLPI', () => {
  it('valida o chamado antes de enviar', () => {
    expect(glpiTicketErrors({ entityId: null, title: 'oi', content: 'curto', type: 3, urgency: 9 }).map((e) => e.path)).toEqual(['entityId', 'title', 'content', 'type', 'urgency']);
    expect(glpiTicketErrors({ entityId: 0, title: 'Link dedicado sem sinal', content: 'Cliente informa queda desde ontem', type: 1, urgency: 4 })).toEqual([]);
  });

  it('converte texto e HTML nos dois sentidos, sem deixar marcação', () => {
    expect(textToHtml('a < b\n\nlinha 2\nlinha 3')).toBe('<p>a &lt; b</p><p>linha 2<br>linha 3</p>');
    expect(glpiBody(glpiTicketHeader('Ana <Lima>'), 'Oi')).toBe('<p><strong>Ticket gerado a partir do RevOps por Ana &lt;Lima&gt;:</strong></p><p>Oi</p>');
    expect(htmlToText('<p>Olá&nbsp;<b>equipe</b></p><ul><li>um</li><li>dois</li></ul><script>x</script>')).toBe('Olá equipe\n• um\n• dois\nx');
  });

  it('linha do tempo: lê acompanhamento, tarefa, solução e documento; ignora o resto', () => {
    const t = parseTimeline([
      { type: 'Solution', item: { id: 9, content: '<p>Trocada a ONU</p>', user: { id: 4, name: 'tecnico' }, date_creation: '2026-10-23 10:00:00' } },
      { type: 'Followup', item: { id: 7, content: '<p>Visita agendada</p>', is_private: false, user: { id: 4, name: 'tecnico' }, date: '2026-10-22 09:00:00' } },
      { type: 'Task', item: { id: 3, content: 'Interno', is_private: true, user_tech: { id: 5, name: 'noc' }, date: '2026-10-22 12:00:00' } },
      { type: 'Document', item: { id: 2, filename: 'laudo.pdf', date_creation: '2026-10-22 13:00:00' } },
      { type: 'Log', item: { id: 1 } }, { type: 'Followup', item: {} }, 'x',
    ]);
    expect(t.map((x) => `${x.externalId}|${x.author}|${x.text}|${x.isPrivate}`)).toEqual([
      'Followup:7|tecnico|Visita agendada|false', 'Task:3|noc|Interno|true', 'Document:2|null|laudo.pdf|false', 'Solution:9|tecnico|Trocada a ONU|false',
    ]);
    expect(parseTimeline({})).toEqual([]);
  });

  it('webhook: acha o chamado no próprio chamado ou no item da linha do tempo; ignora mudança e problema', () => {
    expect(webhookTicketId({ event: 'update', item: { id: 12, status: { id: 5 } } })).toBe(12);
    expect(webhookTicketId({ event: 'new', item: { id: 40, itemtype: 'Ticket', items_id: 12 } })).toBe(12);
    expect(webhookTicketId({ event: 'new', item: { id: 41, itemtype: 'Change', items_id: 12 } })).toBeNull();
    expect(webhookTicketId({ event: 'new', item: { id: 3, tickets_id: '12' } })).toBe(12);
    expect(webhookTicketId('x')).toBeNull();
  });

  it('situação e endereço', () => {
    expect(glpiStatusLabel(5)).toBe('Solucionado');
    expect(glpiOpen(4)).toBe(true);
    expect(glpiOpen(6)).toBe(false);
    expect(glpiTicketUrl('https://glpi.bk.com.br/', 12)).toBe('https://glpi.bk.com.br/front/ticket.form.php?id=12');
  });

  it('validação: cada situação vira um registro; pendente = última situação aguardando', () => {
    const tl = parseTimeline([
      { type: 'Validation', item: { id: 7, status: 2, submission_comment: '<p>Aprovar desconto de 10%</p>', requester: { id: 5, name: 'Técnico NOC' }, submission_date: '2026-10-23 09:45:00' } },
    ]);
    expect(tl[0]).toMatchObject({ kind: 'Validation', externalId: 'Validation:7:2', text: 'Aprovar desconto de 10%', author: 'Técnico NOC', validationId: 7, validationStatus: 2 });
    const later = parseTimeline([{ type: 'Validation', item: { id: 7, status: 3, approval_comment: '<p>ok</p>', approver: { id: 9, name: 'isp.sprint' }, approval_date: '2026-10-23 10:00:00' } }]);
    expect(later[0]).toMatchObject({ externalId: 'Validation:7:3', validationStatus: 3, text: 'ok' });
    const ev = (st: number, at: string) => ({ validationId: 7, validationStatus: st, occurredAt: at });
    expect(pendingValidations([ev(2, '2026-10-23T12:45:00Z')])).toHaveLength(1);
    expect(pendingValidations([ev(2, '2026-10-23T12:45:00Z'), ev(3, '2026-10-23T13:00:00Z')])).toHaveLength(0);
    expect(glpiValidationError('recusar', 'não')).toMatch(/motivo/);
    expect(glpiValidationError('aprovar', '')).toBeNull();
  });
});
