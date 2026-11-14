const socket = io();

const loginPanel = document.getElementById('loginPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginButton = document.getElementById('loginButton');
const logoutBtn = document.getElementById('logoutBtn');
const ticketList = document.getElementById('ticketList');
const searchInput = document.getElementById('searchInput');
const drawerMessages = document.getElementById('drawerMessages');
const emptyConversation = document.getElementById('emptyConversation');
const conversationPanel = document.getElementById('conversationPanel');
const chatTitle = document.getElementById('chatTitle');
const chatSubtitle = document.getElementById('chatSubtitle');
const agentChatForm = document.getElementById('agentChatForm');
const agentMessageInput = document.getElementById('agentMessageInput');
const sendAgentMessage = document.getElementById('sendAgentMessage');
const assignTicketBtn = document.getElementById('assignTicketBtn');
const transferTicketBtn = document.getElementById('transferTicketBtn');
const finishTicketBtn = document.getElementById('finishTicketBtn');
const transferDialog = document.getElementById('transferDialog');
const transferDepartment = document.getElementById('transferDepartment');
const transferError = document.getElementById('transferError');
const confirmTransfer = document.getElementById('confirmTransfer');

let currentAgent = null;
let dashboard = { waiting: [], myTickets: [], closed: [] };
let departments = [];
let selectedTicket = null;
let activeFilter = 'queue';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function ticketTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function allTickets() {
  return [...dashboard.waiting, ...dashboard.myTickets, ...dashboard.closed];
}

function ticketsForFilter() {
  if (activeFilter === 'mine') return dashboard.myTickets;
  if (activeFilter === 'closed') return dashboard.closed;
  return dashboard.waiting;
}

function updateFilterButtons() {
  document.querySelectorAll('.filterButton').forEach((button) => {
    const active = button.dataset.filter === activeFilter;
    button.className = `filterButton rounded-full border px-3 py-1.5 text-xs font-semibold ${
      active ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
    }`;
  });
}

function renderTicketList() {
  const search = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const tickets = ticketsForFilter().filter((ticket) => {
    const content = `${ticket.FULL_NAME || ''} ${ticket.PHONE || ''} ${ticket.DEPARTMENT_NAME || ''}`.toLocaleLowerCase('pt-BR');
    return content.includes(search);
  });

  document.getElementById('totalCount').textContent = String(
    dashboard.waiting.length + dashboard.myTickets.length
  );
  ticketList.replaceChildren();

  if (tickets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'px-2 py-12 text-center text-sm text-slate-400';
    empty.textContent = search ? 'Nenhum chamado encontrado.' : activeFilter === 'queue'
      ? `Não existem chamados na fila ${currentAgent?.isAdmin ? '' : 'do seu setor'}.`
      : activeFilter === 'mine' ? 'Você ainda não assumiu chamados.' : 'Nenhum chamado concluído.';
    ticketList.appendChild(empty);
    return;
  }

  tickets.forEach((ticket) => {
    const card = document.createElement('button');
    card.type = 'button';
    const isSelected = selectedTicket && Number(selectedTicket.ID) === Number(ticket.ID);
    card.className = `block w-full rounded-xl border p-3 text-left transition ${
      isSelected ? 'border-sky-300 bg-sky-50' : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
    }`;
    const excerpt = ticket.STATUS === 'WAITING' ? 'Aguardando atendente' : ticket.STATUS === 'CLOSED' ? 'Atendimento concluído' : 'Conversa em andamento';
    card.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">${escapeHtml((ticket.FULL_NAME || 'C').slice(0, 1).toUpperCase())}</span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center justify-between gap-2">
            <span class="truncate text-sm font-semibold text-slate-800">${escapeHtml(ticket.FULL_NAME || 'Colaborador')}</span>
            <span class="shrink-0 text-[10px] text-slate-400">${escapeHtml(ticketTime(ticket.UPDATED_AT || ticket.CREATED_AT))}</span>
          </span>
          <span class="mt-1 block truncate text-xs text-slate-500">${escapeHtml(ticket.PHONE || '')} · ${escapeHtml(ticket.DEPARTMENT_NAME || '')}</span>
          <span class="mt-1.5 block truncate text-xs ${ticket.STATUS === 'WAITING' ? 'text-amber-700' : 'text-slate-400'}">${escapeHtml(excerpt)}</span>
        </span>
      </div>
    `;
    card.addEventListener('click', () => selectTicket(ticket));
    ticketList.appendChild(card);
  });
}

function renderMessage(message) {
  const isAgent = String(message.senderType).toUpperCase() === 'AGENT';
  const item = document.createElement('div');
  item.className = `max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
    isAgent ? 'ml-auto rounded-br-md bg-sky-700 text-white' : 'mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700'
  }`;

  const meta = document.createElement('div');
  meta.className = `mb-1 flex gap-3 text-[10px] font-semibold uppercase tracking-wide ${isAgent ? 'text-sky-100' : 'text-slate-400'}`;
  const author = document.createElement('span');
  author.textContent = isAgent ? 'Você' : 'Colaborador';
  const time = document.createElement('span');
  time.textContent = ticketTime(message.createdAt);
  const text = document.createElement('div');
  text.textContent = message.messageText;
  meta.append(author, time);
  item.append(meta, text);
  drawerMessages.appendChild(item);
  drawerMessages.scrollTop = drawerMessages.scrollHeight;
}

function updateConversationControls() {
  if (!selectedTicket) return;
  const waiting = selectedTicket.STATUS === 'WAITING';
  const closed = selectedTicket.STATUS === 'CLOSED';
  assignTicketBtn.classList.toggle('hidden', !waiting);
  transferTicketBtn.classList.toggle('hidden', closed);
  finishTicketBtn.classList.toggle('hidden', waiting || closed);
  agentMessageInput.disabled = waiting || closed || !socket.connected;
  sendAgentMessage.disabled = agentMessageInput.disabled;
  agentMessageInput.placeholder = waiting
    ? 'Assuma o chamado para responder...'
    : closed ? 'Este chamado foi encerrado.' : 'Escreva uma mensagem...';
}

async function selectTicket(ticket) {
  selectedTicket = ticket;
  emptyConversation.classList.add('hidden');
  conversationPanel.classList.remove('hidden');
  conversationPanel.classList.add('flex');
  chatTitle.textContent = ticket.FULL_NAME || 'Colaborador';
  chatSubtitle.textContent = `Chamado #${ticket.ID} · ${ticket.DEPARTMENT_NAME || 'Setor'}`;
  drawerMessages.replaceChildren();
  updateConversationControls();
  renderTicketList();

  try {
    const response = await fetch(`/api/tickets/${ticket.ID}/messages`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as mensagens.');
    if (!selectedTicket || Number(selectedTicket.ID) !== Number(ticket.ID)) return;
    drawerMessages.replaceChildren();
    if (data.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.emptyMessages = 'true';
      empty.className = 'my-auto text-center text-sm text-slate-400';
      empty.textContent = 'Ainda não há mensagens. Inicie a conversa.';
      drawerMessages.appendChild(empty);
    } else {
      data.forEach(renderMessage);
    }
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'my-auto text-center text-sm text-red-600';
    message.textContent = error.message;
    drawerMessages.replaceChildren(message);
  }

  if (ticket.STATUS === 'IN_PROGRESS' || ticket.STATUS === 'CLOSED') {
    socket.emit('join-ticket', { ticketId: Number(ticket.ID) });
  }
}

async function loadDashboard() {
  if (!currentAgent) return;

  try {
    const response = await fetch('/api/tickets/dashboard');
    const data = await response.json();
    if (response.status === 401) {
      currentAgent = null;
      dashboardPanel.classList.add('hidden');
      loginPanel.classList.remove('hidden');
      return;
    }
    if (!response.ok) throw new Error(data.message || 'Erro ao carregar chamados.');

    dashboard = {
      waiting: data.waiting || [],
      myTickets: data.myTickets || [],
      closed: data.closed || []
    };
    currentAgent.isAdmin = Boolean(data.isAdmin);
    document.getElementById('agentDepartment').textContent = data.departmentName || 'Setor';
    document.getElementById('agentName').textContent = currentAgent.name;
    if (selectedTicket) {
      const updated = allTickets().find((item) => Number(item.ID) === Number(selectedTicket.ID));
      if (updated) {
        selectedTicket = updated;
        chatSubtitle.textContent = `Chamado #${updated.ID} · ${updated.DEPARTMENT_NAME || data.departmentName}`;
        updateConversationControls();
      } else {
        selectedTicket = null;
        conversationPanel.classList.add('hidden');
        conversationPanel.classList.remove('flex');
        emptyConversation.classList.remove('hidden');
      }
    }
    renderTicketList();
  } catch (error) {
    window.alert(error.message);
  }
}

function showTransferDialog() {
  transferError.classList.add('hidden');
  transferDepartment.replaceChildren(new Option('Selecione o setor', ''));
  departments.forEach((department) => {
    if (Number(department.ID) !== Number(selectedTicket?.DEPARTMENT_ID)) {
      transferDepartment.add(new Option(department.NAME, department.ID));
    }
  });
  transferDialog.classList.remove('hidden');
  transferDialog.classList.add('flex');
}

function hideTransferDialog() {
  transferDialog.classList.add('hidden');
  transferDialog.classList.remove('flex');
}

document.querySelectorAll('.filterButton').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    updateFilterButtons();
    renderTicketList();
  });
});

searchInput.addEventListener('input', renderTicketList);

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.classList.add('hidden');
  loginButton.disabled = true;

  try {
    const response = await fetch('/api/agents/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('agentEmail').value.trim(),
        password: document.getElementById('agentPassword').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível entrar.');

    currentAgent = data.agent;
    socket.disconnect();
    socket.connect();
    loginPanel.classList.add('hidden');
    dashboardPanel.classList.remove('hidden');
    departments = await fetch('/api/departments').then((result) => result.json());
    await loadDashboard();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove('hidden');
  } finally {
    loginButton.disabled = false;
  }
});

assignTicketBtn.addEventListener('click', async () => {
  if (!selectedTicket) return;
  assignTicketBtn.disabled = true;
  try {
    const response = await fetch(`/api/tickets/${selectedTicket.ID}/assign`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível assumir o chamado.');

    selectedTicket.STATUS = 'IN_PROGRESS';
    selectedTicket.ASSIGNED_AGENT_ID = currentAgent.id;
    socket.emit('join-ticket', { ticketId: Number(selectedTicket.ID) });
    await loadDashboard();
    const activeTicket = dashboard.myTickets.find((ticket) => Number(ticket.ID) === Number(data.ticketId));
    if (activeTicket) await selectTicket(activeTicket);
  } catch (error) {
    window.alert(error.message);
    await loadDashboard();
  } finally {
    assignTicketBtn.disabled = false;
  }
});

transferTicketBtn.addEventListener('click', showTransferDialog);
document.getElementById('cancelTransfer').addEventListener('click', hideTransferDialog);
document.getElementById('cancelTransferTop').addEventListener('click', hideTransferDialog);

confirmTransfer.addEventListener('click', async () => {
  if (!selectedTicket || !transferDepartment.value) {
    transferError.textContent = 'Selecione o setor que receberá o chamado.';
    transferError.classList.remove('hidden');
    return;
  }

  confirmTransfer.disabled = true;
  try {
    const response = await fetch(`/api/tickets/${selectedTicket.ID}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ departmentId: Number(transferDepartment.value) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível transferir o chamado.');

    hideTransferDialog();
    selectedTicket = null;
    conversationPanel.classList.add('hidden');
    conversationPanel.classList.remove('flex');
    emptyConversation.classList.remove('hidden');
    await loadDashboard();
  } catch (error) {
    transferError.textContent = error.message;
    transferError.classList.remove('hidden');
  } finally {
    confirmTransfer.disabled = false;
  }
});

finishTicketBtn.addEventListener('click', async () => {
  if (!selectedTicket) return;
  try {
    const response = await fetch(`/api/tickets/${selectedTicket.ID}/close`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível encerrar o chamado.');
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
  }
});

agentChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = agentMessageInput.value.trim();
  if (!selectedTicket || !text || agentMessageInput.disabled) return;
  sendAgentMessage.disabled = true;
  socket.emit('send-message', {
    ticketId: Number(selectedTicket.ID),
    senderType: 'AGENT',
    text
  });
  agentMessageInput.value = '';
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/agents/logout', { method: 'POST' });
  socket.disconnect();
  currentAgent = null;
  selectedTicket = null;
  dashboardPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  loginForm.reset();
  socket.connect();
});

socket.on('connect', () => {
  updateConversationControls();
  if (selectedTicket && selectedTicket.STATUS !== 'WAITING') {
    socket.emit('join-ticket', { ticketId: Number(selectedTicket.ID) });
  }
});

socket.on('new-message', (message) => {
  if (!selectedTicket || Number(message.ticketId) !== Number(selectedTicket.ID)) return;
  drawerMessages.querySelector('[data-empty-messages]')?.remove();
  renderMessage(message);
  agentMessageInput.disabled = selectedTicket.STATUS !== 'IN_PROGRESS';
  sendAgentMessage.disabled = agentMessageInput.disabled;
});

socket.on('tickets:updated', () => loadDashboard());

socket.on('ticket:status-updated', ({ ticketId, status, departmentName, transferred }) => {
  if (selectedTicket && Number(ticketId) === Number(selectedTicket.ID)) {
    if (transferred) {
      selectedTicket = null;
      conversationPanel.classList.add('hidden');
      conversationPanel.classList.remove('flex');
      emptyConversation.classList.remove('hidden');
    } else {
      selectedTicket.STATUS = status;
      if (departmentName) selectedTicket.DEPARTMENT_NAME = departmentName;
      updateConversationControls();
    }
  }
  loadDashboard();
});

socket.on('ticket:error', ({ message }) => {
  window.alert(message);
});

socket.on('message:error', ({ message }) => {
  window.alert(message);
  if (selectedTicket?.STATUS === 'IN_PROGRESS') {
    agentMessageInput.disabled = false;
    sendAgentMessage.disabled = false;
  }
});
