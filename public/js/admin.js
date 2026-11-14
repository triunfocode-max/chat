const socket = io();

const loginPanel = document.getElementById('loginPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const waitingList = document.getElementById('waitingList');
const activeList = document.getElementById('activeList');
const closedList = document.getElementById('closedList');
const waitingCount = document.getElementById('waitingCount');
const activeCount = document.getElementById('activeCount');
const closedCount = document.getElementById('closedCount');
const chatDrawer = document.getElementById('chatDrawer');
const drawerMessages = document.getElementById('drawerMessages');
const chatTitle = document.getElementById('chatTitle');
const agentChatForm = document.getElementById('agentChatForm');
const agentMessageInput = document.getElementById('agentMessageInput');
const finishTicketBtn = document.getElementById('finishTicketBtn');
const closeChatDrawer = document.getElementById('closeChatDrawer');

let currentAgent = null;
let selectedTicket = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function normalizeStatus(value) {
  return value || 'WAITING';
}

function setSelectedTicket(ticket) {
  selectedTicket = ticket;

  if (!ticket) {
    chatDrawer.classList.add('hidden');
    return;
  }

  chatTitle.textContent = `Ticket #${ticket.ID}`;
  chatDrawer.classList.remove('hidden');
  finishTicketBtn.dataset.ticketId = ticket.ID;

  drawerMessages.innerHTML = `
    <div class="text-xs text-slate-500 py-2">Conversa do ticket #${ticket.ID}</div>
  `;
}

function ticketAge(createdAt) {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${minutes}m`;
}

function renderTicketCard(ticket, type) {
  const card = document.createElement('div');
  card.className = 'rounded-xl border border-slate-200 p-3 bg-slate-50';
  card.innerHTML = `
    <div class="flex justify-between items-start gap-3">
      <div>
        <p class="font-bold text-slate-800">${escapeHtml(ticket.FULL_NAME || 'Cliente')}</p>
        <p class="text-xs text-slate-500">${escapeHtml(ticket.ROLE_JOB || 'Sem cargo')}</p>
      </div>
      <span class="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-200 text-slate-700">${escapeHtml(ticketAge(ticket.CREATED_AT))}</span>
    </div>

    <div class="mt-2 text-sm text-slate-600 space-y-1">
      <p>📞 ${escapeHtml(ticket.PHONE || 'Sem telefone')}</p>
      <p>🏢 ${escapeHtml(ticket.DEPARTMENT_NAME || 'Departamento')}</p>
    </div>

    <button data-ticket-id="${ticket.ID}" data-action="${type}" class="mt-3 w-full bg-sky-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-sky-700">
      ${type === 'waiting' ? 'Puxar Atendimento' : 'Abrir chat'}
    </button>
  `;

  return card;
}

function renderDashboard(data) {
  waitingList.innerHTML = '';
  activeList.innerHTML = '';
  closedList.innerHTML = '';

  waitingCount.textContent = String((data.waiting || []).length);
  activeCount.textContent = String((data.myTickets || []).length);
  closedCount.textContent = String((data.closed || []).length);

  (data.waiting || []).forEach((ticket) => {
    const card = renderTicketCard(ticket, 'waiting');
    waitingList.appendChild(card);
  });

  (data.myTickets || []).forEach((ticket) => {
    const card = renderTicketCard(ticket, 'active');
    activeList.appendChild(card);
  });

  (data.closed || []).forEach((ticket) => {
    const card = renderTicketCard(ticket, 'closed');
    closedList.appendChild(card);
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const ticketId = Number(button.dataset.ticketId);
      const action = button.dataset.action;

      if (action === 'waiting') {
        const response = await fetch(`/api/tickets/${ticketId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: currentAgent.id })
        });

        const result = await response.json();
        if (!response.ok) {
          alert(result.message || 'Erro ao puxar ticket.');
          return;
        }

        socket.emit('join-ticket', { ticketId });
        await loadDashboard();
      }

      if (action === 'active' || action === 'closed') {
        const ticket = [...(data.waiting || []), ...(data.myTickets || []), ...(data.closed || [])].find((item) => Number(item.ID) === ticketId);
        if (ticket) {
          setSelectedTicket(ticket);
        }
      }
    });
  });
}

async function loadDashboard() {
  if (!currentAgent) {
    return;
  }

  const response = await fetch(`/api/tickets/dashboard?agentId=${currentAgent.id}`);
  const data = await response.json();

  if (!response.ok) {
    alert(data.message || 'Erro ao carregar fila');
    return;
  }

  renderDashboard(data);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('agentEmail').value;
  const password = document.getElementById('agentPassword').value;

  const response = await fetch('/api/agents/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.message || 'Erro ao autenticar.');
    return;
  }

  currentAgent = data.agent;
  socket.disconnect();
  socket.connect();
  loginPanel.classList.add('hidden');
  dashboardPanel.classList.remove('hidden');

  socket.emit('join-agent-room', { agentId: currentAgent.id });
  await loadDashboard();
});

logoutBtn.addEventListener('click', async () => {
  const response = await fetch('/api/agents/logout', { method: 'POST' });
  if (!response.ok) {
    alert('Erro ao sair do painel.');
    return;
  }

  socket.disconnect();
  currentAgent = null;
  selectedTicket = null;
  dashboardPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  document.getElementById('loginForm').reset();
  chatDrawer.classList.add('hidden');
  socket.connect();
});

closeChatDrawer.addEventListener('click', () => {
  chatDrawer.classList.add('hidden');
  selectedTicket = null;
});

finishTicketBtn.addEventListener('click', async () => {
  if (!selectedTicket) {
    return;
  }

  const ticketId = Number(selectedTicket.ID);
  const response = await fetch(`/api/tickets/${ticketId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: currentAgent.id })
  });

  const result = await response.json();

  if (!response.ok) {
    alert(result.message || 'Erro ao encerrar atendimento.');
    return;
  }

  socket.emit('join-ticket', { ticketId });
  setSelectedTicket(null);
  await loadDashboard();
});

agentChatForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!selectedTicket) {
    return;
  }

  const text = agentMessageInput.value.trim();

  if (!text) {
    return;
  }

  socket.emit('send-message', {
    ticketId: Number(selectedTicket.ID),
    senderType: 'AGENT',
    senderId: currentAgent.id,
    text
  });

  agentMessageInput.value = '';
});

socket.on('new-message', (message) => {
  if (!selectedTicket || Number(message.ticketId) !== Number(selectedTicket.ID)) {
    return;
  }

  const item = document.createElement('div');
  const isAgent = String(message.senderType).toUpperCase() === 'AGENT';

  item.className = `max-w-[80%] rounded-xl px-3 py-2 ${
    isAgent ? 'ml-auto bg-sky-600 text-white' : 'bg-slate-100 text-slate-800'
  }`;

  const sender = document.createElement('div');
  sender.className = 'text-[10px] uppercase tracking-wide opacity-75 mb-1';
  sender.textContent = isAgent ? 'Você' : 'Cliente';
  const text = document.createElement('div');
  text.textContent = message.messageText;
  item.append(sender, text);

  drawerMessages.appendChild(item);
  drawerMessages.scrollTop = drawerMessages.scrollHeight;
});

socket.on('tickets:updated', async () => {
  if (currentAgent) {
    await loadDashboard();
  }
});

socket.on('ticket:status-updated', async ({ ticketId, status }) => {
  if (!currentAgent) {
    return;
  }

  if (selectedTicket && Number(ticketId) === Number(selectedTicket.ID) && status === 'CLOSED') {
    setSelectedTicket(null);
  }

  await loadDashboard();
});

socket.on('ticket:error', ({ message }) => {
  alert(message);
});

socket.on('message:error', ({ message }) => {
  alert(message);
});
