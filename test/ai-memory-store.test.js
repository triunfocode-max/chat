const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../config/memory-store');

test('persists department instructions and stops AI after handing a ticket to a human', () => {
  const departmentId = 2;
  const settings = store.updateDepartmentAiSettings(departmentId, {
    enabled: true,
    instructions: 'Orientar sobre pagamentos.'
  });
  assert.equal(settings.AI_ENABLED, true);
  assert.equal(settings.AI_INSTRUCTIONS, 'Orientar sobre pagamentos.');

  const { ticket } = store.registerCustomer({
    fullName: 'Teste',
    roleJob: 'Colaborador',
    phone: '5511999999999',
    departmentId
  });
  const firstReply = store.createAiMessageIfWaiting({
    ticketId: ticket.id,
    text: 'Vou encaminhar para o Financeiro.'
  });

  assert.equal(firstReply.senderType, 'BOT');
  assert.equal(store.markTicketAiHandoff(ticket.id), true);
  assert.equal(store.getTicketAccess(ticket.id).aiHandoff, true);
  assert.equal(store.createAiMessageIfWaiting({ ticketId: ticket.id, text: 'Resposta repetida.' }), null);

  store.transferTicket(ticket.id, 3);
  assert.equal(store.getTicketAccess(ticket.id).aiHandoff, false);
  assert.ok(store.createAiMessageIfWaiting({ ticketId: ticket.id, text: 'Resposta após transferência.' }));
});
