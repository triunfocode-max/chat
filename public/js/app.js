const socket = io();
const rolePanel = document.getElementById('rolePanel');
const formPanel = document.getElementById('formPanel');
const chatPanel = document.getElementById('chatPanel');
const customerForm = document.getElementById('customerForm');
const chatForm = document.getElementById('chatForm');
const chatMessages = document.getElementById('chatMessages');
const departmentSelect = document.getElementById('departmentId');
const ticketIdLabel = document.getElementById('ticketIdLabel');
const chatDepartment = document.getElementById('chatDepartment');
const statusBadge = document.getElementById('statusBadge');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const chatNotice = document.getElementById('chatNotice');
const formError = document.getElementById('formError');
const startChatButton = document.getElementById('startChatButton');
const collaboratorActions = document.getElementById('collaboratorActions');
const collaboratorTransferDialog = document.getElementById('collaboratorTransferDialog');
const collaboratorTransferDepartment = document.getElementById('collaboratorTransferDepartment');
const collaboratorTransferAgents = document.getElementById('collaboratorTransferAgents');
const collaboratorTransferError = document.getElementById('collaboratorTransferError');
const confirmCollaboratorTransfer = document.getElementById('confirmCollaboratorTransfer');

let currentTicket = null;
let joinedTicketId = null;

function showPanel(panel) {
  [rolePanel, formPanel, chatPanel].forEach((item) => item.classList.add('hidden'));
  panel.classList.remove('hidden');
}

function addMessage(message) {
  const item = document.createElement('div');
  const senderType = String(message.senderType).toUpperCase();
  const isCustomer = senderType === 'CUSTOMER';
  item.className = `max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
    isCustomer
      ? 'ml-auto rounded-br-md bg-sky-700 text-white'
      : 'mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700'
  }`;

  const sender = document.createElement('div');
  sender.className = `mb-1 text-[10px] font-semibold uppercase tracking-wide ${isCustomer ? 'text-sky-100' : 'text-slate-400'}`;
  sender.textContent = isCustomer ? 'Você' : senderType === 'BOT' ? 'Assistente IA' : 'Atendente';
  const text = document.createElement('div');
  text.textContent = message.messageText;
  item.append(sender, text);
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setStatus(status, departmentName, transferred = false) {
  const labels = {
    WAITING: ['Na fila', 'bg-amber-50 text-amber-700'],
    IN_PROGRESS: ['Em atendimento', 'bg-emerald-50 text-emerald-700'],
    CLOSED: ['Encerrado', 'bg-slate-100 text-slate-600']
  };
  const [label, classes] = labels[status] || ['Atualizado', 'bg-slate-100 text-slate-600'];
  statusBadge.className = `rounded-full px-3 py-1.5 text-xs font-semibold ${classes}`;
  statusBadge.textContent = label;

  if (departmentName) {
    chatDepartment.textContent = departmentName;
  }

  if (transferred) {
    chatNotice.textContent = `Seu chamado foi encaminhado para ${departmentName}.`;
  } else if (status === 'IN_PROGRESS') {
    chatNotice.textContent = `${departmentName || 'O setor'} iniciou seu atendimento.`;
  } else if (status === 'WAITING') {
    chatNotice.textContent = 'Seu chamado está aguardando um atendente.';
  }

  if (status === 'CLOSED') {
    chatNotice.textContent = 'Este atendimento foi encerrado.';
    messageInput.disabled = true;
    sendButton.disabled = true;
    collaboratorActions.classList.add('hidden');
  }
}

async function loadDepartments() {
  const response = await fetch('/api/departments');
  const departments = await response.json();
  if (!response.ok) {
    throw new Error(departments.message || 'Não foi possível carregar os setores.');
  }

  departmentSelect.replaceChildren(new Option('Selecione o setor', ''));
  departments.forEach((department) => {
    departmentSelect.add(new Option(department.NAME, department.ID));
  });
}

document.getElementById('collaboratorChoice').addEventListener('click', () => {
  showPanel(formPanel);
  document.getElementById('fullName').focus();
});

document.getElementById('backToRoles').addEventListener('click', () => showPanel(rolePanel));

customerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.classList.add('hidden');
  startChatButton.disabled = true;

  try {
    const response = await fetch('/api/customers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: document.getElementById('fullName').value.trim(),
        roleJob: document.getElementById('roleJob').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        departmentId: Number(departmentSelect.value)
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Não foi possível abrir o atendimento.');
    }

    currentTicket = data.ticket;
    joinedTicketId = null;
    ticketIdLabel.textContent = `#${currentTicket.id}`;
    chatDepartment.textContent = departmentSelect.selectedOptions[0].textContent;
    chatMessages.replaceChildren();
    chatNotice.textContent = 'Conectando ao atendimento...';
    addMessage({
      senderType: 'AGENT',
      messageText: 'Olá! Seu chamado foi criado. Um atendente do setor responderá em breve.'
    });
    messageInput.value = '';
    messageInput.disabled = true;
    sendButton.disabled = true;
    setStatus('WAITING', chatDepartment.textContent);
    showPanel(chatPanel);
    joinCurrentTicket();
  } catch (error) {
    formError.textContent = error.message;
    formError.classList.remove('hidden');
  } finally {
    startChatButton.disabled = false;
  }
});

function joinCurrentTicket() {
  if (!currentTicket || !socket.connected) {
    return;
  }
  socket.emit('join-ticket', {
    ticketId: currentTicket.id,
    accessToken: currentTicket.accessToken
  });
}

async function loadTransferAgents() {
  collaboratorTransferAgents.replaceChildren();
  const departmentId = Number(collaboratorTransferDepartment.value);
  if (!departmentId) return;

  const response = await fetch(`/api/tickets/${currentTicket.id}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ departmentId, accessToken: currentTicket.accessToken })
  });
  const agents = await response.json();
  if (!response.ok) {
    throw new Error(agents.message || 'Não foi possível carregar os atendentes.');
  }

  if (agents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rounded-xl bg-slate-50 p-3 text-sm text-slate-500';
    empty.textContent = 'Não há atendentes cadastrados neste setor.';
    collaboratorTransferAgents.appendChild(empty);
    return;
  }

  agents.forEach((agent) => {
    const label = document.createElement('label');
    label.className = 'flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-3 hover:border-sky-300 hover:bg-sky-50';
    const person = document.createElement('span');
    person.className = 'flex items-center gap-3';
    const dot = document.createElement('span');
    dot.className = `h-2.5 w-2.5 rounded-full ${agent.online ? 'bg-emerald-500' : 'bg-red-500'}`;
    const name = document.createElement('span');
    name.className = 'text-sm font-medium text-slate-700';
    name.textContent = agent.name;
    const presence = document.createElement('span');
    presence.className = `text-xs ${agent.online ? 'text-emerald-700' : 'text-red-600'}`;
    presence.textContent = agent.online ? 'Online' : 'Offline';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'transferAgent';
    radio.value = String(agent.id);
    radio.className = 'accent-sky-700';
    person.append(dot, name);
    label.append(person, presence, radio);
    collaboratorTransferAgents.appendChild(label);
  });
}

function openTransferDialog() {
  if (!currentTicket || currentTicket.status === 'CLOSED') return;
  collaboratorTransferError.classList.add('hidden');
  collaboratorTransferDepartment.replaceChildren(new Option('Selecione o setor', ''));
  Array.from(departmentSelect.options).forEach((option) => {
    if (option.value && Number(option.value) !== Number(currentTicket.departmentId)) {
      collaboratorTransferDepartment.add(new Option(option.textContent, option.value));
    }
  });
  collaboratorTransferAgents.replaceChildren();
  collaboratorTransferDialog.classList.remove('hidden');
  collaboratorTransferDialog.classList.add('flex');
}

function closeTransferDialog() {
  collaboratorTransferDialog.classList.add('hidden');
  collaboratorTransferDialog.classList.remove('flex');
}

document.getElementById('collaboratorTransferButton').addEventListener('click', openTransferDialog);
document.getElementById('closeCollaboratorTransfer').addEventListener('click', closeTransferDialog);
document.getElementById('cancelCollaboratorTransfer').addEventListener('click', closeTransferDialog);
collaboratorTransferDepartment.addEventListener('change', async () => {
  collaboratorTransferError.classList.add('hidden');
  try {
    await loadTransferAgents();
  } catch (error) {
    collaboratorTransferError.textContent = error.message;
    collaboratorTransferError.classList.remove('hidden');
  }
});

confirmCollaboratorTransfer.addEventListener('click', async () => {
  const selectedAgent = collaboratorTransferAgents.querySelector('input[name="transferAgent"]:checked');
  if (!selectedAgent) {
    collaboratorTransferError.textContent = 'Selecione um atendente para receber a conversa.';
    collaboratorTransferError.classList.remove('hidden');
    return;
  }

  confirmCollaboratorTransfer.disabled = true;
  try {
    const response = await fetch(`/api/tickets/${currentTicket.id}/transfer-collaborator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: currentTicket.accessToken,
        departmentId: Number(collaboratorTransferDepartment.value),
        agentId: Number(selectedAgent.value)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível transferir o atendimento.');

    currentTicket.departmentId = data.departmentId;
    currentTicket.status = data.status;
    currentTicket.agentId = data.agentId;
    closeTransferDialog();
    setStatus(data.status, data.departmentName, true);
    messageInput.disabled = !joinedTicketId;
    sendButton.disabled = messageInput.disabled;
  } catch (error) {
    collaboratorTransferError.textContent = error.message;
    collaboratorTransferError.classList.remove('hidden');
  } finally {
    confirmCollaboratorTransfer.disabled = false;
  }
});

document.getElementById('collaboratorCloseButton').addEventListener('click', async () => {
  if (!currentTicket || !window.confirm('Deseja encerrar este atendimento?')) return;
  const closeButton = document.getElementById('collaboratorCloseButton');
  closeButton.disabled = true;
  try {
    const response = await fetch(`/api/tickets/${currentTicket.id}/close-collaborator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: currentTicket.accessToken })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível encerrar o atendimento.');
    currentTicket.status = data.status;
    setStatus(data.status);
  } catch (error) {
    chatNotice.textContent = error.message;
    closeButton.disabled = false;
  }
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!currentTicket || !text || !joinedTicketId) {
    return;
  }

  sendButton.disabled = true;
  socket.emit('send-message', {
    ticketId: currentTicket.id,
    senderType: 'CUSTOMER',
    text
  });
  messageInput.value = '';
});

socket.on('connect', () => {
  chatNotice.textContent = currentTicket ? 'Reconectando ao atendimento...' : '';
  joinCurrentTicket();
});

socket.on('disconnect', () => {
  joinedTicketId = null;
  messageInput.disabled = true;
  sendButton.disabled = true;
  if (currentTicket) {
    chatNotice.textContent = 'Conexão interrompida. Tentando reconectar...';
  }
});

socket.on('ticket:joined', ({ ticketId }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) {
    return;
  }

  joinedTicketId = Number(ticketId);
  messageInput.disabled = false;
  sendButton.disabled = false;
  messageInput.focus();
  chatNotice.textContent = 'Você está conectado. Pode enviar sua mensagem.';
});

socket.on('new-message', (message) => {
  if (currentTicket && Number(message.ticketId) === Number(currentTicket.id)) {
    addMessage(message);
    sendButton.disabled = false;
  }
});

socket.on('ticket:ai-handoff', ({ ticketId }) => {
  if (currentTicket && Number(ticketId) === Number(currentTicket.id)) {
    chatNotice.textContent = 'Vou encaminhar sua solicitação para um atendente do setor.';
  }
});

socket.on('ticket:ai-fallback', ({ ticketId }) => {
  if (currentTicket && Number(ticketId) === Number(currentTicket.id)) {
    chatNotice.textContent = 'A IA não conseguiu responder. Sua mensagem continua na fila para um atendente.';
  }
});

socket.on('ticket:status-updated', ({ ticketId, status, departmentName, transferred }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) {
    return;
  }

  setStatus(status, departmentName, transferred);
  if (status !== 'CLOSED') {
    messageInput.disabled = !joinedTicketId;
    sendButton.disabled = messageInput.disabled;
  }
});

socket.on('agents:presence-updated', () => {
  if (!collaboratorTransferDialog.classList.contains('hidden') && collaboratorTransferDepartment.value) {
    loadTransferAgents().catch((error) => {
      collaboratorTransferError.textContent = error.message;
      collaboratorTransferError.classList.remove('hidden');
    });
  }
});

socket.on('ticket:error', ({ message }) => {
  chatNotice.textContent = message;
});

socket.on('message:error', ({ message }) => {
  chatNotice.textContent = message;
  sendButton.disabled = false;
});

loadDepartments().catch((error) => {
  departmentSelect.replaceChildren(new Option('Erro ao carregar setores', ''));
  formError.textContent = error.message;
});

