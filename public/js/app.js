const socket = io();
const customerForm = document.getElementById('customerForm');
const chatForm = document.getElementById('chatForm');
const chatMessages = document.getElementById('chatMessages');
const chatPanel = document.getElementById('chatPanel');
const formPanel = document.getElementById('formPanel');
const ticketIdLabel = document.getElementById('ticketIdLabel');
const statusBadge = document.getElementById('statusBadge');
const messageInput = document.getElementById('messageInput');
const departmentSelect = document.getElementById('departmentId');
const customDepartmentWrap = document.getElementById('customDepartmentWrap');
const customDepartmentInput = document.getElementById('customDepartment');

let currentTicket = null;
let customerId = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function toggleCustomDepartment() {
  const isCustom = departmentSelect.value === 'custom';
  customDepartmentWrap.classList.toggle('hidden', !isCustom);

  if (!isCustom) {
    customDepartmentInput.value = '';
  }
}

async function createDepartmentIfNeeded(name) {
  const response = await fetch('/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Erro ao cadastrar setor.');
  }

  return Number(data.department.id);
}

async function loadDepartments() {
  const response = await fetch('/api/departments');
  const departments = await response.json();

  departmentSelect.innerHTML = '<option value="">Selecione</option>';
  departments.forEach((department) => {
    const option = document.createElement('option');
    option.value = department.ID;
    option.textContent = department.NAME;
    departmentSelect.appendChild(option);
  });

  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Outro (digitar setor)';
  departmentSelect.appendChild(customOption);
  departmentSelect.addEventListener('change', toggleCustomDepartment);
}

function setStatus(status) {
  const map = {
    WAITING: ['bg-yellow-100', 'text-yellow-700', 'Aguardando'],
    IN_PROGRESS: ['bg-blue-100', 'text-blue-700', 'Atendente online'],
    CLOSED: ['bg-slate-200', 'text-slate-700', 'Encerrado']
  };

  const [bg, text, label] = map[status] || ['bg-slate-200', 'text-slate-700', 'Sem status'];

  statusBadge.className = `px-3 py-1 rounded-full text-xs font-semibold ${bg} ${text}`;
  statusBadge.textContent = label;
}

function renderMessage(message) {
  const item = document.createElement('div');
  const isCustomer = String(message.senderType).toUpperCase() === 'CUSTOMER';

  item.className = `max-w-[80%] rounded-xl px-3 py-2 ${
    isCustomer ? 'ml-auto bg-sky-600 text-white' : 'bg-slate-100 text-slate-800'
  }`;

  const sender = document.createElement('div');
  sender.className = 'text-[10px] uppercase tracking-wide opacity-75 mb-1';
  sender.textContent = isCustomer ? 'Você' : 'Atendente';
  const text = document.createElement('div');
  text.textContent = message.messageText;
  item.append(sender, text);

  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function openChat() {
  formPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
}

function showWaitingMessage() {
  chatMessages.innerHTML = '<div class="text-sm text-slate-500 text-center mt-10">Aguardando a primeira resposta do atendimento...</div>';
}

customerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    let departmentId = Number(departmentSelect.value);

    if (departmentSelect.value === 'custom') {
      const customName = customDepartmentInput.value.trim();

      if (!customName) {
        throw new Error('Informe o setor ou departamento que não aparece na lista.');
      }

      departmentId = await createDepartmentIfNeeded(customName);
    }

    if (!departmentId) {
      throw new Error('Selecione um setor ou departamento.');
    }

    const payload = {
      fullName: document.getElementById('fullName').value,
      roleJob: document.getElementById('roleJob').value,
      phone: document.getElementById('phone').value,
      departmentId
    };

    const response = await fetch('/api/customers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Erro ao iniciar atendimento.');
    }

    currentTicket = data.ticket;
    customerId = data.customer.id;

    ticketIdLabel.textContent = currentTicket.id;
    setStatus('WAITING');
    showWaitingMessage();
    openChat();

    socket.emit('join-ticket', {
      ticketId: currentTicket.id,
      accessToken: currentTicket.accessToken
    });
  } catch (error) {
    alert(error.message);
  }
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!currentTicket) {
    return;
  }

  const text = messageInput.value.trim();

  if (!text) {
    return;
  }

  socket.emit('send-message', {
    ticketId: currentTicket.id,
    senderType: 'CUSTOMER',
    senderId: customerId,
    text
  });

  messageInput.value = '';
});

socket.on('new-message', (message) => {
  if (!currentTicket || Number(message.ticketId) !== Number(currentTicket.id)) {
    return;
  }

  renderMessage(message);
});

socket.on('ticket:status-updated', ({ ticketId, status }) => {
  if (!currentTicket || Number(ticketId) !== Number(currentTicket.id)) {
    return;
  }

  setStatus(status);

  if (status === 'CLOSED') {
    chatMessages.innerHTML = '<div class="text-sm text-slate-500 text-center mt-10">Atendimento encerrado. Obrigado por entrar em contato.</div>';
    messageInput.disabled = true;
  }
});

socket.on('ticket:error', ({ message }) => {
  alert(message);
});

socket.on('message:error', ({ message }) => {
  alert(message);
});

loadDepartments();
