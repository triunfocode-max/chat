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

let currentTicket = null;
let joinedTicketId = null;

function showPanel(panel) {
  [rolePanel, formPanel, chatPanel].forEach((item) => item.classList.add('hidden'));
  panel.classList.remove('hidden');
}

function addMessage(message) {
  const item = document.createElement('div');
  const isCustomer = String(message.senderType).toUpperCase() === 'CUSTOMER';
  item.className = `max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
    isCustomer
      ? 'ml-auto rounded-br-md bg-sky-700 text-white'
      : 'mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700'
  }`;

  const sender = document.createElement('div');
  sender.className = `mb-1 text-[10px] font-semibold uppercase tracking-wide ${isCustomer ? 'text-sky-100' : 'text-slate-400'}`;
  sender.textContent = isCustomer ? 'Você' : 'Atendente';
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

socket.on('ticket:status-updated', ({ ticketId, status, departmentName, transferred }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) {
    return;
  }

  setStatus(status, departmentName, transferred);
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
