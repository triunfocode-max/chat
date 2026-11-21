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
const agentAttachmentInput = document.getElementById('agentAttachmentInput');
const assignTicketBtn = document.getElementById('assignTicketBtn');
const transferTicketBtn = document.getElementById('transferTicketBtn');
const finishTicketBtn = document.getElementById('finishTicketBtn');
const transferDialog = document.getElementById('transferDialog');
const transferDepartment = document.getElementById('transferDepartment');
const transferError = document.getElementById('transferError');
const confirmTransfer = document.getElementById('confirmTransfer');
const queueBadge = document.getElementById('queueBadge');
const notificationBadge = document.getElementById('notificationBadge');
const notificationButton = document.getElementById('notificationButton');
const toastContainer = document.getElementById('toastContainer');
const quickReplyDialog = document.getElementById('quickReplyDialog');
const quickReplyTitle = document.getElementById('quickReplyTitle');
const quickReplySubtitle = document.getElementById('quickReplySubtitle');
const quickReplyMessage = document.getElementById('quickReplyMessage');
const quickReplyError = document.getElementById('quickReplyError');
const sendQuickReply = document.getElementById('sendQuickReply');
const aiSettingsButton = document.getElementById('aiSettingsButton');
const aiSettingsDialog = document.getElementById('aiSettingsDialog');
const aiDepartmentSelect = document.getElementById('aiDepartmentSelect');
const aiEnabledInput = document.getElementById('aiEnabledInput');
const aiInstructionsInput = document.getElementById('aiInstructionsInput');
const aiSettingsStatus = document.getElementById('aiSettingsStatus');
const aiSettingsError = document.getElementById('aiSettingsError');
const saveAiSettingsButton = document.getElementById('saveAiSettingsButton');

let currentAgent = null;
let dashboard = { waiting: [], myTickets: [], closed: [] };
let departments = [];
let selectedTicket = null;
let activeFilter = 'queue';
let quickReplyTicket = null;
let pendingQuickReplyText = null;
let aiSettingsConfigured = false;
let aiDepartments = [];
let selectedAgentAttachment = null;
const notifiedTicketIds = new Set();

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
  queueBadge.textContent = String(dashboard.waiting.length);
  queueBadge.classList.toggle('hidden', dashboard.waiting.length === 0);
  notificationBadge.textContent = String(dashboard.waiting.length);
  notificationBadge.classList.toggle('hidden', dashboard.waiting.length === 0);
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

function findTicket(ticketId) {
  return allTickets().find((ticket) => Number(ticket.ID) === Number(ticketId));
}

function openQuickReply(ticket) {
  quickReplyTicket = ticket;
  quickReplyTitle.textContent = ticket.FULL_NAME || 'Novo chamado';
  quickReplySubtitle.textContent = `Chamado #${ticket.ID} · ${ticket.DEPARTMENT_NAME || 'Fila'}`;
  quickReplyError.classList.add('hidden');
  quickReplyMessage.value = '';
  sendQuickReply.textContent = ticket.STATUS === 'WAITING' ? 'Assumir e enviar' : 'Enviar resposta';
  quickReplyDialog.classList.remove('hidden');
  quickReplyDialog.classList.add('flex');
  quickReplyMessage.focus();
}

function closeQuickReply() {
  quickReplyDialog.classList.add('hidden');
  quickReplyDialog.classList.remove('flex');
  quickReplyTicket = null;
}

function showIncomingNotification(incoming, eventType = 'ticket') {
  const ticketId = Number(incoming.ticketId || incoming.ID);
  const notificationKey = `${ticketId}:${eventType}`;
  if (!ticketId || notifiedTicketIds.has(notificationKey)) return;
  notifiedTicketIds.add(notificationKey);

  const ticket = findTicket(ticketId) || {
    ID: ticketId,
    STATUS: incoming.status || 'WAITING',
    FULL_NAME: incoming.fullName || 'Novo colaborador',
    PHONE: incoming.phone || '',
    ROLE_JOB: incoming.roleJob || '',
    DEPARTMENT_ID: incoming.departmentId,
    DEPARTMENT_NAME: incoming.departmentName || departments.find(
      (department) => Number(department.ID) === Number(incoming.departmentId)
    )?.NAME || 'Seu setor',
    CREATED_AT: new Date().toISOString(),
    UPDATED_AT: new Date().toISOString()
  };

  const toast = document.createElement('article');
  toast.className = 'cursor-pointer rounded-xl border border-sky-200 bg-white p-4 shadow-xl transition hover:-translate-y-0.5';
  const title = document.createElement('p');
  title.className = 'font-semibold text-slate-800';
  title.textContent = eventType === 'handoff'
    ? `${ticket.FULL_NAME} · IA solicitou atendimento humano`
    : eventType === 'message'
    ? `${ticket.FULL_NAME} · nova mensagem`
    : `${ticket.FULL_NAME} · novo chamado`;
  const detail = document.createElement('p');
  detail.className = 'mt-1 text-xs text-slate-500';
  detail.textContent = `${ticket.DEPARTMENT_NAME} · ${ticket.PHONE || 'Chamado na fila'}`;
  const actions = document.createElement('div');
  actions.className = 'mt-3 flex justify-end';
  const replyButton = document.createElement('button');
  replyButton.type = 'button';
  replyButton.className = 'rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800';
  replyButton.textContent = 'Resposta rápida';
  actions.appendChild(replyButton);
  toast.append(title, detail, actions);
  toast.addEventListener('click', () => openQuickReply(findTicket(ticketId) || ticket));
  replyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openQuickReply(findTicket(ticketId) || ticket);
  });
  toastContainer.prepend(toast);
  window.setTimeout(() => toast.remove(), 12000);

  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(
      eventType === 'message' ? `Nova mensagem: ${ticket.FULL_NAME}` : `Novo chamado: ${ticket.FULL_NAME}`,
      {
        body: `${ticket.DEPARTMENT_NAME} · clique para resposta rápida`,
        tag: `ticket-${ticketId}-${eventType}`
      }
    );
    notification.onclick = () => {
      window.focus();
      openQuickReply(findTicket(ticketId) || ticket);
      notification.close();
    };
  }
}

function renderMessage(message) {
  const senderType = String(message.senderType).toUpperCase();
  const isAgent = senderType === 'AGENT';
  const item = document.createElement('div');
  item.className = `max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm shadow-sm ${
    isAgent ? 'ml-auto rounded-br-md bg-sky-700 text-white' : 'mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700'
  }`;

  const meta = document.createElement('div');
  meta.className = `mb-1 flex gap-3 text-[10px] font-semibold uppercase tracking-wide ${isAgent ? 'text-sky-100' : 'text-slate-400'}`;
  const author = document.createElement('span');
  author.textContent = isAgent ? 'Você' : senderType === 'BOT' ? 'Assistente IA' : 'Colaborador';
  const time = document.createElement('span');
  time.textContent = ticketTime(message.createdAt);
  const text = document.createElement('div');
  text.textContent = message.messageText || '';
  meta.append(author, time);
  item.append(meta);
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

function selectedAiDepartment() {
  return aiDepartments.find((department) => Number(department.ID) === Number(aiDepartmentSelect.value));
}

function renderAiDepartmentSettings() {
  const department = selectedAiDepartment();
  aiEnabledInput.checked = Boolean(department?.AI_ENABLED);
  aiEnabledInput.disabled = !aiSettingsConfigured;
  aiInstructionsInput.value = department?.AI_INSTRUCTIONS || '';
}

async function openAiSettings() {
  aiSettingsError.classList.add('hidden');
  try {
    const response = await fetch('/api/departments/ai');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as configurações.');

    aiSettingsConfigured = data.configured;
    aiDepartments = data.departments || [];
    aiDepartmentSelect.replaceChildren(...aiDepartments.map(
      (department) => new Option(department.NAME, department.ID)
    ));
    aiSettingsStatus.textContent = aiSettingsConfigured
      ? `IA configurada · modelo ${data.model}. Ativa somente enquanto o chamado estiver na fila.`
      : 'Configure GEMINI_API_KEY no servidor para ativar respostas automáticas.';
    renderAiDepartmentSettings();
    aiSettingsDialog.classList.remove('hidden');
    aiSettingsDialog.classList.add('flex');
  } catch (error) {
    window.alert(error.message);
  }
}

function closeAiSettings() {
  aiSettingsDialog.classList.add('hidden');
  aiSettingsDialog.classList.remove('flex');
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
    aiSettingsButton.classList.toggle('hidden', !currentAgent.isAdmin);
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
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

notificationButton.addEventListener('click', () => {
  activeFilter = 'queue';
  updateFilterButtons();
  renderTicketList();
});

aiSettingsButton.addEventListener('click', openAiSettings);
aiDepartmentSelect.addEventListener('change', renderAiDepartmentSettings);
document.getElementById('closeAiSettings').addEventListener('click', closeAiSettings);
document.getElementById('cancelAiSettings').addEventListener('click', closeAiSettings);
saveAiSettingsButton.addEventListener('click', async () => {
  const departmentId = Number(aiDepartmentSelect.value);
  saveAiSettingsButton.disabled = true;
  aiSettingsError.classList.add('hidden');
  try {
    const response = await fetch(`/api/departments/${departmentId}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: aiEnabledInput.checked,
        instructions: aiInstructionsInput.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível salvar as configurações.');
    aiDepartments = aiDepartments.map((department) => (
      Number(department.ID) === departmentId ? data.department : department
    ));
    renderAiDepartmentSettings();
    closeAiSettings();
  } catch (error) {
    aiSettingsError.textContent = error.message;
    aiSettingsError.classList.remove('hidden');
  } finally {
    saveAiSettingsButton.disabled = false;
  }
});

socket.on('ticket:ai-handoff', (ticket) => {
  loadDashboard();
  showIncomingNotification(ticket, 'handoff');
});

document.getElementById('closeQuickReply').addEventListener('click', closeQuickReply);
document.getElementById('cancelQuickReply').addEventListener('click', closeQuickReply);
document.querySelectorAll('.quickReplyOption').forEach((button) => {
  button.addEventListener('click', () => {
    quickReplyMessage.value = button.dataset.quickMessage;
    quickReplyMessage.focus();
  });
});

sendQuickReply.addEventListener('click', async () => {
  if (!quickReplyTicket) return;
  const text = quickReplyMessage.value.trim();
  if (!text) {
    quickReplyError.textContent = 'Digite uma mensagem ou escolha uma resposta rápida.';
    quickReplyError.classList.remove('hidden');
    return;
  }

  sendQuickReply.disabled = true;
  try {
    const ticketId = Number(quickReplyTicket.ID);
    if (quickReplyTicket.STATUS === 'WAITING') {
      const response = await fetch(`/api/tickets/${ticketId}/assign`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Não foi possível assumir o chamado.');
    }

    pendingQuickReplyText = { ticketId, text };
    await loadDashboard();
    const ticket = findTicket(ticketId) || { ...quickReplyTicket, STATUS: 'IN_PROGRESS' };
    closeQuickReply();
    await selectTicket(ticket);
  } catch (error) {
    quickReplyError.textContent = error.message;
    quickReplyError.classList.remove('hidden');
  } finally {
    sendQuickReply.disabled = false;
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

agentAttachmentInput.addEventListener('change', () => {
  const file = agentAttachmentInput.files?.[0];
  if (!file) {
    selectedAgentAttachment = null;
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    window.alert('O arquivo excede o limite de 3 MB.');
    agentAttachmentInput.value = '';
    selectedAgentAttachment = null;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    selectedAgentAttachment = { name: file.name, type: file.type || 'application/octet-stream', data: reader.result };
  };
  reader.readAsDataURL(file);
});

agentChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = agentMessageInput.value.trim();
  if (!selectedTicket || (!text && !selectedAgentAttachment) || agentMessageInput.disabled) return;
  sendAgentMessage.disabled = true;
  socket.emit('send-message', {
    ticketId: Number(selectedTicket.ID),
    senderType: 'AGENT',
    text,
    attachment: selectedAgentAttachment
  });
  agentMessageInput.value = '';
  agentAttachmentInput.value = '';
  selectedAgentAttachment = null;
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

socket.on('ticket:incoming', (ticket) => {
  showIncomingNotification(ticket);
  loadDashboard();
});

socket.on('ticket:message', async (activity) => {
  if (selectedTicket && Number(selectedTicket.ID) === Number(activity.ticketId)) return;
  await loadDashboard();
  const ticket = findTicket(activity.ticketId);
  showIncomingNotification({
    ...activity,
    ticketId: activity.ticketId,
    fullName: ticket?.FULL_NAME || 'Nova mensagem',
    departmentName: ticket?.DEPARTMENT_NAME || 'Atendimento',
    status: ticket?.STATUS
  }, 'message');
});

socket.on('ticket:joined', ({ ticketId }) => {
  if (!pendingQuickReplyText || Number(ticketId) !== pendingQuickReplyText.ticketId) return;
  const { text } = pendingQuickReplyText;
  pendingQuickReplyText = null;
  socket.emit('send-message', {
    ticketId: Number(ticketId),
    senderType: 'AGENT',
    text
  });
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
  pendingQuickReplyText = null;
  if (selectedTicket?.STATUS === 'IN_PROGRESS') {
    agentMessageInput.disabled = false;
    sendAgentMessage.disabled = false;
  }
});

