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
const attachmentInput = document.getElementById('attachmentInput');
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
let selectedAttachment = null;
let historySyncTimer = null;
let pendingFlushPromise = null;
const customerQueueKey = 'multiatende_pending_messages';
const customerSessionKey = 'multiatende_customer_session';

function updateCustomerComposer() {
  const unavailable = !currentTicket || currentTicket.status === 'CLOSED';
  messageInput.disabled = unavailable;
  sendButton.disabled = unavailable;
  attachmentInput.disabled = unavailable;
}

function showPanel(panel) {
  [rolePanel, formPanel, chatPanel].forEach((item) => item.classList.add('hidden'));
  panel.classList.remove('hidden');
}

function addMessage(message) {
  if (
    message.id !== undefined
    && [...chatMessages.children].some((item) => item.dataset.messageId === String(message.id))
  ) {
    return;
  }

  const item = document.createElement('div');
  const senderType = String(message.senderType).toUpperCase();
  const isCustomer = senderType === 'CUSTOMER';
  item.className = `max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
    isCustomer
      ? 'ml-auto rounded-br-md bg-sky-700 text-white'
      : 'mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700'
  }`;
  if (message.id !== undefined) {
    item.dataset.messageId = String(message.id);
  }

  const sender = document.createElement('div');
  sender.className = `mb-1 text-[10px] font-semibold uppercase tracking-wide ${isCustomer ? 'text-sky-100' : 'text-slate-400'}`;
  sender.textContent = isCustomer ? 'Você' : senderType === 'BOT' ? 'Assistente IA' : 'Atendente';
  const text = document.createElement('div');
  text.textContent = message.messageText || '';
  item.append(sender);
  if (text.textContent) item.append(text);
  if (message.attachment) {
    const attachment = document.createElement('div');
    attachment.className = 'mt-2';
    if (message.attachment.type?.startsWith('image/') && message.attachment.data) {
      const image = document.createElement('img');
      image.src = message.attachment.data;
      image.alt = message.attachment.name || 'Imagem';
      image.className = 'max-h-64 max-w-full rounded-lg object-contain';
      attachment.appendChild(image);
    }
    const link = document.createElement('a');
    link.href = message.attachment.data;
    link.download = message.attachment.name || 'arquivo';
    link.className = 'mt-2 block text-xs font-semibold underline';
    link.textContent = `📎 ${message.attachment.name || 'Arquivo anexado'}`;
    attachment.appendChild(link);
    item.append(attachment);
  }
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function mergeMessageHistory(messages) {
  const historyIds = new Set(messages.map((message) => String(message.id)));
  const arrivedDuringHistory = [...chatMessages.children].filter((item) => (
    item.dataset.messageId && !historyIds.has(item.dataset.messageId)
  ));
  chatMessages.replaceChildren();
  messages.forEach(addMessage);
  arrivedDuringHistory.forEach((item) => chatMessages.appendChild(item));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function syncCustomerHistory() {
  if (!currentTicket) return;
  const ticketId = Number(currentTicket.id);
  const response = await fetch(`/api/tickets/${ticketId}/customer-messages`, {
    headers: { 'X-Ticket-Token': currentTicket.accessToken }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Não foi possível sincronizar as mensagens.');
  }
  if (!currentTicket || Number(currentTicket.id) !== ticketId) return;

  if (data.status) currentTicket.status = data.status;
  if (data.departmentName) chatDepartment.textContent = data.departmentName;
  updateCustomerComposer();
  mergeMessageHistory(data.messages || []);
}

function startCustomerHistoryPolling() {
  if (historySyncTimer || !currentTicket) return;
  historySyncTimer = setInterval(() => {
    syncCustomerHistory()
      .then(() => flushPendingMessages())
      .catch((error) => {
        if (currentTicket) {
          chatNotice.textContent = error.message || 'Não foi possível sincronizar as mensagens.';
        }
      });
  }, 5000);
  syncCustomerHistory()
    .then(() => flushPendingMessages())
    .catch((error) => {
      chatNotice.textContent = error.message || 'Não foi possível sincronizar as mensagens.';
    });
}

function stopCustomerHistoryPolling() {
  if (!historySyncTimer) return;
  clearInterval(historySyncTimer);
  historySyncTimer = null;
}

function setStatus(status, departmentName, transferred = false) {
  if (currentTicket) {
    currentTicket.status = status;
  }
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
    collaboratorActions.classList.add('hidden');
  }
  updateCustomerComposer();
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
    localStorage.setItem(customerSessionKey, JSON.stringify(currentTicket));
    joinedTicketId = null;
    ticketIdLabel.textContent = `#${currentTicket.id}`;
    chatDepartment.textContent = departmentSelect.selectedOptions[0].textContent;
    chatMessages.replaceChildren();
    chatNotice.textContent = 'Conectando ao atendimento...';
    messageInput.value = '';
    setStatus('WAITING', chatDepartment.textContent);
    showPanel(chatPanel);
    startCustomerHistoryPolling();
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
    updateCustomerComposer();
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

attachmentInput.addEventListener('change', () => {
  const file = attachmentInput.files?.[0];
  if (!file) {
    selectedAttachment = null;
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    chatNotice.textContent = 'O arquivo excede o limite de 3 MB.';
    attachmentInput.value = '';
    selectedAttachment = null;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    selectedAttachment = { name: file.name, type: file.type || 'application/octet-stream', data: reader.result };
    chatNotice.textContent = `Anexo pronto: ${file.name}`;
  };
  reader.readAsDataURL(file);
});

function readPendingMessages() {
  try {
    return JSON.parse(localStorage.getItem(customerQueueKey) || '[]');
  } catch {
    return [];
  }
}

function savePendingMessages(messages) {
  localStorage.setItem(customerQueueKey, JSON.stringify(messages));
}

function flushPendingMessages() {
  if (!currentTicket || pendingFlushPromise) return pendingFlushPromise;

  pendingFlushPromise = (async () => {
    while (currentTicket) {
      const item = readPendingMessages()
        .find((message) => Number(message.ticketId) === Number(currentTicket.id));
      if (!item) return;
      try {
        const response = await fetch(`/api/tickets/${Number(currentTicket.id)}/customer-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ticket-Token': currentTicket.accessToken
          },
          body: JSON.stringify({
            text: item.text,
            attachment: item.attachment,
            tempId: item.tempId
          })
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status < 500) {
            savePendingMessages(readPendingMessages().filter((message) => message.tempId !== item.tempId));
          }
          chatNotice.textContent = data.message || 'Não foi possível enviar a mensagem.';
          return;
        }

        addMessage(data);
        savePendingMessages(readPendingMessages().filter((message) => message.tempId !== item.tempId));
        chatNotice.textContent = 'Mensagem enviada.';
      } catch {
        chatNotice.textContent = 'Sem conexão com o servidor. A mensagem ficará salva para tentar novamente.';
        return;
      }
    }
  })().finally(() => {
    pendingFlushPromise = null;
  });

  return pendingFlushPromise;
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!currentTicket || currentTicket.status === 'CLOSED' || (!text && !selectedAttachment)) {
    return;
  }

  const payload = {
    ticketId: currentTicket.id,
    senderType: 'CUSTOMER',
    text,
    attachment: selectedAttachment,
    tempId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
  };
  savePendingMessages([...readPendingMessages(), payload]);
  chatNotice.textContent = 'Enviando mensagem...';
  messageInput.value = '';
  attachmentInput.value = '';
  selectedAttachment = null;
  updateCustomerComposer();
  flushPendingMessages();
});

socket.on('connect', () => {
  chatNotice.textContent = currentTicket ? 'Reconectando ao atendimento...' : '';
  joinCurrentTicket();
  if (currentTicket) {
    startCustomerHistoryPolling();
    flushPendingMessages();
  }
});

socket.on('disconnect', () => {
  joinedTicketId = null;
  if (currentTicket) {
    updateCustomerComposer();
    chatNotice.textContent = 'Conexão em tempo real indisponível. Sincronizando pelo servidor...';
    startCustomerHistoryPolling();
  }
});

socket.on('connect_error', () => {
  if (!currentTicket) return;
  chatNotice.textContent = 'Conexão em tempo real indisponível. Sincronizando pelo servidor...';
  startCustomerHistoryPolling();
});

socket.on('ticket:joined', ({ ticketId, status }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) {
    return;
  }

  joinedTicketId = Number(ticketId);
  if (status) currentTicket.status = status;
  stopCustomerHistoryPolling();
  updateCustomerComposer();
  messageInput.focus();
  chatNotice.textContent = 'Você está conectado. Pode enviar sua mensagem.';
  flushPendingMessages();
});

socket.on('ticket:history', ({ ticketId, messages }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) return;
  mergeMessageHistory(messages);
});

socket.on('new-message', (message) => {
  if (currentTicket && Number(message.ticketId) === Number(currentTicket.id)) {
    addMessage(message);
    updateCustomerComposer();
    if (message.tempId) {
      savePendingMessages(readPendingMessages().filter((item) => item.tempId !== message.tempId));
    }
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

  currentTicket.status = status;
  setStatus(status, departmentName, transferred);
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
  startCustomerHistoryPolling();
});

socket.on('message:error', ({ message }) => {
  chatNotice.textContent = message;
  updateCustomerComposer();
});

try {
  const savedSession = JSON.parse(localStorage.getItem(customerSessionKey) || 'null');
  if (savedSession?.id && savedSession?.accessToken) {
    currentTicket = savedSession;
    ticketIdLabel.textContent = `#${currentTicket.id}`;
    chatDepartment.textContent = 'Atendimento';
    chatMessages.replaceChildren();
    setStatus(currentTicket.status || 'WAITING');
    showPanel(chatPanel);
    startCustomerHistoryPolling();
    joinCurrentTicket();
  }
} catch {
  localStorage.removeItem(customerSessionKey);
}

loadDepartments().catch((error) => {
  departmentSelect.replaceChildren(new Option('Erro ao carregar setores', ''));
  formError.textContent = error.message;
});

