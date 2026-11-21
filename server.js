require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const store = require('./config/store');
const { generateDepartmentReply } = require('./config/ai-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 4 * 1024 * 1024,
  perMessageDeflate: false
});

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'agent_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const ticketAccessTokens = new Map();
const onlineAgents = new Map();
const aiReplyQueues = new Map();
const messageDeliveryCache = new Map();

function safeErrorDetail(error) {
  return error?.code || error?.name || 'erro interno';
}

function requireAdmin(req, res, next) {
  if (!req.agent.IS_ADMIN) {
    return res.status(403).json({ message: 'Somente administradores podem configurar a IA.' });
  }
  return next();
}

async function getTicketAccessForToken(ticketId, accessToken) {
  const token = String(accessToken || '');
  const inMemoryAccess = ticketAccessTokens.get(token);

  if (
    inMemoryAccess
    && inMemoryAccess.ticketId === ticketId
  ) {
    return inMemoryAccess;
  }

  if (!token || typeof store.findTicketByAccessTokenHash !== 'function') {
    return null;
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  return store.findTicketByAccessTokenHash(ticketId, tokenHash);
}

function getSession(cookieHeader = '') {
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

  if (!cookie) {
    return null;
  }

  const token = cookie.slice(SESSION_COOKIE.length + 1);
  const session = sessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function requireAgent(req, res, next) {
  const session = getSession(req.headers.cookie);

  if (!session) {
    return res.status(401).json({ message: 'Faça login para acessar os atendimentos.' });
  }

  req.agent = session.agent;
  return next();
}

function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin = req.get('origin');
  if (!origin) {
    if (IS_PRODUCTION) {
      return res.status(403).json({ message: 'Origem da solicitação não autorizada.' });
    }
    return next();
  }

  try {
    const parsedOrigin = new URL(origin);
    const sameHost = parsedOrigin.host.toLowerCase() === req.get('host')?.toLowerCase();
    const secureOrigin = !IS_PRODUCTION || parsedOrigin.protocol === 'https:';
    if (sameHost && secureOrigin) {
      return next();
    }
  } catch {
    return res.status(403).json({ message: 'Origem da solicitação não autorizada.' });
  }

  return res.status(403).json({ message: 'Origem da solicitação não autorizada.' });
}

function sendServerError(res, error, context, message) {
  console.error(`${context}:`, safeErrorDetail(error));
  return res.status(500).json({ message });
}

function setSessionCookie(res, token) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}; Priority=High${secure}`
  );
}

async function replyWithAi(ticketId) {
  const ticket = await store.getTicketAccess(ticketId);
  if (!ticket || ticket.status !== 'WAITING' || ticket.assignedAgentId || ticket.aiHandoff) {
    return;
  }

  const department = (await store.listDepartments())
    .find((item) => Number(item.ID) === Number(ticket.departmentId));
  if (!department || !department.AI_ENABLED) {
    return;
  }

  const messages = await store.getMessages(ticketId);
  const generated = await generateDepartmentReply({
    departmentName: department.NAME,
    instructions: department.AI_INSTRUCTIONS,
    messages
  });

  const currentTicket = await store.getTicketAccess(ticketId);
  if (
    !currentTicket
    || currentTicket.status !== 'WAITING'
    || currentTicket.assignedAgentId
    || Number(currentTicket.departmentId) !== Number(ticket.departmentId)
  ) {
    return;
  }

  const message = await store.createAiMessageIfWaiting({ ticketId, text: generated.reply });
  if (!message) return;

  const handedOff = generated.handoff && await store.markTicketAiHandoff(ticketId);

  io.to(`ticket:${ticketId}`).emit('new-message', message);
  io.emit('tickets:updated');

  if (handedOff) {
    io.to(`department:${ticket.departmentId}`).to('administrators').emit('ticket:ai-handoff', {
      ticketId,
      departmentId: ticket.departmentId,
      departmentName: ticket.departmentName,
      fullName: ticket.fullName
    });
  }
}

function queueAiReply(ticketId) {
  const previous = aiReplyQueues.get(ticketId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => replyWithAi(ticketId))
    .catch((error) => {
      console.error('Falha ao gerar resposta da IA:', error?.message || safeErrorDetail(error));
      io.to(`ticket:${ticketId}`).emit('ticket:ai-fallback', { ticketId });
      io.emit('tickets:updated');
    })
    .finally(() => {
      if (aiReplyQueues.get(ticketId) === next) {
        aiReplyQueues.delete(ticketId);
      }
    });
  aiReplyQueues.set(ticketId, next);
}

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  const host = socket.handshake.headers.host;
  if (IS_PRODUCTION && (!origin || !host)) {
    return next(new Error('Origem não autorizada.'));
  }
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.host.toLowerCase() !== host?.toLowerCase()
        || (IS_PRODUCTION && parsedOrigin.protocol !== 'https:')
      ) {
        return next(new Error('Origem não autorizada.'));
      }
    } catch {
      return next(new Error('Origem não autorizada.'));
    }
  }

  const session = getSession(socket.request.headers.cookie);
  socket.data.agentId = session?.agent.ID ?? null;
  socket.data.departmentId = session?.agent.DEPARTMENT_ID ?? null;
  socket.data.isAdmin = Boolean(session?.agent.IS_ADMIN);
  return next();
});

app.disable('x-powered-by');
app.set('trust proxy', IS_PRODUCTION ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.tailwindcss.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(IS_PRODUCTION ? { upgradeInsecureRequests: [] } : {})
    }
  },
  hsts: IS_PRODUCTION
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  return requireSameOrigin(req, res, next);
});
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas solicitações. Tente novamente em instantes.' }
});
const registrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas solicitações. Tente novamente mais tarde.' }
});
app.use('/api', apiRateLimit);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'multi-atendimento-web' });
});

app.get('/api/departments', async (req, res) => {
  try {
    const departments = await store.listDepartments();
    res.json(departments.map(({ ID, NAME }) => ({ ID, NAME })));
  } catch (error) {
    sendServerError(res, error, 'Falha ao listar departamentos', 'Não foi possível listar os setores.');
  }
});

app.get('/api/departments/ai', requireAgent, requireAdmin, async (req, res) => {
  try {
    return res.json({
      configured: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      departments: await store.listDepartments()
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao consultar configurações da IA', 'Não foi possível carregar as configurações da IA.');
  }
});

app.post('/api/departments/:id/ai', requireAgent, requireAdmin, async (req, res) => {
  try {
    const departmentId = Number(req.params.id);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    const enabled = body.enabled;
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : null;

    if (
      !Number.isSafeInteger(departmentId) || departmentId < 1
      || typeof enabled !== 'boolean'
      || instructions === null || instructions.length > 4000
    ) {
      return res.status(400).json({ message: 'Setor ou orientações inválidas. O limite das orientações é 4000 caracteres.' });
    }
    if (enabled && !process.env.GEMINI_API_KEY) {
      return res.status(503).json({ message: 'Configure GEMINI_API_KEY no servidor antes de ativar a IA.' });
    }

    const department = await store.updateDepartmentAiSettings(departmentId, { enabled, instructions });
    if (!department) {
      return res.status(404).json({ message: 'Setor não encontrado.' });
    }
    return res.json({ success: true, department });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao salvar configurações da IA', 'Não foi possível salvar as configurações da IA.');
  }
});

app.post('/api/departments', requireAgent, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'Nome do setor/departamento é obrigatório.' });
    }

    const result = await store.createDepartment(name);

    return res.status(result.created ? 201 : 200).json({
      success: true,
      department: result.department
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao cadastrar setor', 'Não foi possível cadastrar o setor.');
  }
});

app.post('/api/customers/register', registrationRateLimit, async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const roleJob = String(req.body.roleJob || '').trim();
    const phone = String(req.body.phone || '').trim();
    const departmentId = Number(req.body.departmentId);

    if (
      !fullName || fullName.length > 150
      || !roleJob || roleJob.length > 150
      || !phone || phone.length > 40
      || !Number.isSafeInteger(departmentId) || departmentId < 1
    ) {
      return res.status(400).json({ message: 'Nome, cargo, telefone e departamento são obrigatórios.' });
    }

    const accessToken = randomBytes(32).toString('hex');
    const accessTokenHash = createHash('sha256').update(accessToken).digest('hex');
    const registration = await store.registerCustomer({
      fullName,
      roleJob,
      phone,
      departmentId,
      accessTokenHash
    });
    ticketAccessTokens.set(accessToken, {
      ticketId: Number(registration.ticket.id),
      customerId: Number(registration.customer.id)
    });

    const ticket = await store.getTicketAccess(Number(registration.ticket.id));
    io.to(`department:${departmentId}`).to('administrators').emit('ticket:incoming', {
      ...ticket,
      ticketId: Number(registration.ticket.id),
      fullName,
      phone,
      roleJob
    });
    io.emit('tickets:updated');

    return res.status(201).json({
      success: true,
      ...registration,
      ticket: {
        ...registration.ticket,
        accessToken
      }
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao cadastrar cliente', 'Não foi possível abrir o chamado.');
  }
});

app.post('/api/agents/login', loginRateLimit, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    }

    const agent = await store.findAgentByEmail(email);

    if (!agent) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    const passwordMatch = await bcrypt.compare(password, agent.PASSWORD_HASH);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    agent.IS_ADMIN = Boolean(agent.IS_ADMIN) || email.toLowerCase() === String(process.env.ADMIN_EMAIL || 'admin@empresa.com').toLowerCase();
    const token = randomBytes(32).toString('hex');
    sessions.set(token, {
      agent,
      expiresAt: Date.now() + SESSION_DURATION_MS
    });
    setSessionCookie(res, token);

    return res.json({
      success: true,
      agent: {
        id: agent.ID,
        name: agent.NAME,
        email: agent.EMAIL,
        departmentId: agent.DEPARTMENT_ID,
        isAdmin: agent.IS_ADMIN
      }
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha na autenticação', 'Não foi possível autenticar.');
  }
});

app.post('/api/agents/logout', (req, res) => {
  const session = getSession(req.headers.cookie);

  if (session) {
    const cookie = req.headers.cookie.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    sessions.delete(cookie.slice(SESSION_COOKIE.length + 1));
  }

  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Priority=High${secure}`);
  return res.json({ success: true });
});

app.get('/api/tickets/dashboard', requireAgent, async (req, res) => {
  try {
    const agentId = Number(req.agent.ID);
    const departmentId = Number(req.agent.DEPARTMENT_ID || 0);
    const isAdmin = Boolean(req.agent.IS_ADMIN);
    const dashboard = await store.getDashboard(agentId, departmentId, isAdmin);
    return res.json({
      ...dashboard,
      departmentId,
      isAdmin,
      departmentName: isAdmin
        ? 'Todos os setores'
        : (await store.listDepartments()).find((department) => Number(department.ID) === departmentId)?.NAME || 'Setor'
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao consultar fila', 'Não foi possível carregar os atendimentos.');
  }
});

app.post('/api/tickets/:id/assign', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const agentId = Number(req.agent.ID);

    if (!ticketId || !agentId) {
      return res.status(400).json({ message: 'Ticket e agente são obrigatórios.' });
    }

    const ticket = await store.getTicketAccess(ticketId);
    if (
      !ticket
      || ticket.status !== 'WAITING'
      || (!req.agent.IS_ADMIN && Number(ticket.departmentId) !== Number(req.agent.DEPARTMENT_ID))
    ) {
      return res.status(409).json({ message: 'Este chamado não está mais disponível na fila do seu setor.' });
    }

    await store.assignTicket(ticketId, agentId);

    io.emit('tickets:updated');
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', {
      ticketId,
      status: 'IN_PROGRESS',
      departmentId: ticket.departmentId,
      departmentName: ticket.departmentName,
      agentId
    });

    return res.json({ success: true, ticketId, status: 'IN_PROGRESS', agentId });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao assumir chamado', 'Não foi possível assumir o chamado.');
  }
});

app.post('/api/tickets/:id/close', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const agentId = Number(req.agent.ID);

    if (!ticketId) {
      return res.status(400).json({ message: 'Ticket é obrigatório.' });
    }

    const ticket = await store.getTicketAccess(ticketId);
    if (!ticket || Number(ticket.assignedAgentId) !== agentId) {
      return res.status(403).json({ message: 'Somente o atendente responsável pode encerrar este chamado.' });
    }

    await store.closeTicket(ticketId, agentId);

    io.emit('tickets:updated');
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', { ticketId, status: 'CLOSED' });

    return res.json({ success: true, ticketId, status: 'CLOSED' });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao encerrar atendimento', 'Não foi possível encerrar o chamado.');
  }
});

app.post('/api/tickets/:id/close-collaborator', async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const access = await getTicketAccessForToken(ticketId, req.body.accessToken);
    const ticket = await store.getTicketAccess(ticketId);

    if (!ticket || !access || access.ticketId !== ticketId || access.customerId !== Number(ticket.customerId)) {
      return res.status(403).json({ message: 'Acesso inválido a este chamado.' });
    }
    if (ticket.status === 'CLOSED') {
      return res.status(409).json({ message: 'Este chamado já foi encerrado.' });
    }

    await store.closeTicket(ticketId, ticket.assignedAgentId);
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', { ticketId, status: 'CLOSED' });
    io.emit('tickets:updated');
    return res.json({ success: true, ticketId, status: 'CLOSED' });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao encerrar chamado', 'Não foi possível encerrar o chamado.');
  }
});

app.post('/api/tickets/:id/agents', async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const departmentId = Number(req.body.departmentId);
    const access = await getTicketAccessForToken(ticketId, req.body.accessToken);
    const ticket = await store.getTicketAccess(ticketId);

    if (!ticket || !access || access.ticketId !== ticketId || access.customerId !== Number(ticket.customerId)) {
      return res.status(403).json({ message: 'Acesso inválido a este chamado.' });
    }
    if (ticket.status === 'CLOSED') {
      return res.status(409).json({ message: 'Este chamado já foi encerrado.' });
    }

    const departments = await store.listDepartments();
    if (!departments.some((department) => Number(department.ID) === departmentId)) {
      return res.status(404).json({ message: 'Setor não encontrado.' });
    }

    const agents = (await store.listAgents())
      .filter((agent) => Number(agent.DEPARTMENT_ID) === departmentId)
      .map((agent) => ({
        id: Number(agent.ID),
        name: agent.NAME,
        online: onlineAgents.has(Number(agent.ID))
      }));

    return res.json(agents);
  } catch (error) {
    return sendServerError(res, error, 'Falha ao listar atendentes', 'Não foi possível listar os atendentes.');
  }
});

app.post('/api/tickets/:id/transfer-collaborator', async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const departmentId = Number(req.body.departmentId);
    const agentId = Number(req.body.agentId);
    const access = await getTicketAccessForToken(ticketId, req.body.accessToken);
    const ticket = await store.getTicketAccess(ticketId);

    if (!ticket || !access || access.ticketId !== ticketId || access.customerId !== Number(ticket.customerId)) {
      return res.status(403).json({ message: 'Acesso inválido a este chamado.' });
    }
    if (ticket.status === 'CLOSED') {
      return res.status(409).json({ message: 'Este chamado já foi encerrado.' });
    }
    if (!departmentId || !agentId) {
      return res.status(400).json({ message: 'Selecione o setor e o atendente de destino.' });
    }

    const departments = await store.listDepartments();
    const targetDepartment = departments.find((department) => Number(department.ID) === departmentId);
    const targetAgent = (await store.listAgents()).find((agent) => Number(agent.ID) === agentId);
    if (!targetDepartment || !targetAgent || Number(targetAgent.DEPARTMENT_ID) !== departmentId) {
      return res.status(400).json({ message: 'O atendente selecionado não pertence ao setor escolhido.' });
    }

    const updatedTicket = await store.transferTicketToAgent(ticketId, departmentId, agentId);
    if (!updatedTicket) {
      return res.status(409).json({ message: 'O chamado mudou. Atualize a tela e tente novamente.' });
    }
    const update = {
      ticketId,
      status: updatedTicket.status,
      departmentId,
      departmentName: targetDepartment.NAME,
      agentId,
      agentName: targetAgent.NAME,
      transferred: true
    };
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', update);
    io.to(`agent:${agentId}`).emit('ticket:incoming', {
      ...updatedTicket,
      ticketId,
      fullName: updatedTicket.fullName || 'Colaborador',
      departmentName: targetDepartment.NAME,
      transferred: true
    });
    io.emit('tickets:updated');
    return res.json({ success: true, ...update });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao transferir chamado', 'Não foi possível transferir o chamado.');
  }
});

app.post('/api/tickets/:id/transfer', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const departmentId = Number(req.body.departmentId);

    if (!ticketId || !departmentId) {
      return res.status(400).json({ message: 'Chamado e setor de destino são obrigatórios.' });
    }

    const [ticket, departments] = await Promise.all([
      store.getTicketAccess(ticketId),
      store.listDepartments()
    ]);
    const targetDepartment = departments.find((department) => Number(department.ID) === departmentId);

    if (!ticket || !targetDepartment) {
      return res.status(404).json({ message: 'Chamado ou setor não encontrado.' });
    }

    const isAssignedToAgent = Number(ticket.assignedAgentId) === Number(req.agent.ID);
    const isWaitingInAgentDepartment = ticket.status === 'WAITING'
      && (req.agent.IS_ADMIN || Number(ticket.departmentId) === Number(req.agent.DEPARTMENT_ID));
    if (ticket.status === 'CLOSED' || (!isAssignedToAgent && !isWaitingInAgentDepartment)) {
      return res.status(403).json({ message: 'Você não pode transferir este chamado.' });
    }
    if (Number(ticket.departmentId) === departmentId) {
      return res.status(400).json({ message: 'Selecione um setor diferente do atual.' });
    }

    const updatedTicket = await store.transferTicket(ticketId, departmentId);
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', {
      ticketId,
      status: 'WAITING',
      departmentId,
      departmentName: targetDepartment.NAME,
      transferred: true
    });
    io.to(`department:${departmentId}`).to('administrators').emit('ticket:incoming', {
      ...updatedTicket,
      ticketId,
      departmentName: targetDepartment.NAME,
      transferred: true
    });
    io.emit('tickets:updated');

    return res.json({
      success: true,
      ticketId,
      status: updatedTicket.status,
      departmentId,
      departmentName: targetDepartment.NAME
    });
  } catch (error) {
    return sendServerError(res, error, 'Falha ao transferir chamado', 'Não foi possível transferir o chamado.');
  }
});

app.get('/api/tickets/:id/messages', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await store.getTicketAccess(ticketId);
    if (!ticket || (
      Number(ticket.assignedAgentId) !== Number(req.agent.ID)
      && !(ticket.status === 'WAITING' && (
        req.agent.IS_ADMIN || Number(ticket.departmentId) === Number(req.agent.DEPARTMENT_ID)
      ))
    )) {
      return res.status(403).json({ message: 'Você não tem acesso às mensagens deste chamado.' });
    }

    return res.json(await store.getMessages(ticketId));
  } catch (error) {
    return sendServerError(res, error, 'Falha ao carregar mensagens', 'Não foi possível carregar as mensagens.');
  }
});

io.on('connection', (socket) => {
  socket.data.customerTickets = new Set();
  let messageWindowStartedAt = Date.now();
  let messagesInWindow = 0;
  if (socket.data.agentId !== null) {
    const agentId = Number(socket.data.agentId);
    const connections = onlineAgents.get(agentId) || new Set();
    connections.add(socket.id);
    onlineAgents.set(agentId, connections);
    socket.join(`agent:${agentId}`);
    if (socket.data.departmentId !== null) {
      socket.join(`department:${socket.data.departmentId}`);
    }
    if (socket.data.isAdmin) {
      socket.join('administrators');
    }
    io.emit('agents:presence-updated');
  }

  socket.on('join-ticket', async (payload = {}) => {
    const { ticketId, accessToken } = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};
    const parsedTicketId = Number(ticketId);

    if (!parsedTicketId) {
      return;
    }

    try {
      const ticket = await store.getTicketAccess(parsedTicketId);

      if (!ticket) {
        socket.emit('ticket:error', { message: 'Atendimento não encontrado.' });
        return;
      }

      const access = await getTicketAccessForToken(parsedTicketId, accessToken);
      const isCustomer = access
        && access.ticketId === parsedTicketId
        && access.customerId === Number(ticket.customerId);
      const isAssignedAgent = socket.data.agentId !== null
        && Number(ticket.assignedAgentId) === Number(socket.data.agentId);
      const isQueueAgent = socket.data.agentId !== null
        && ticket.status === 'WAITING'
        && (socket.data.isAdmin || Number(ticket.departmentId) === Number(socket.data.departmentId));

      if (isCustomer) {
        socket.data.customerTickets.add(parsedTicketId);
      } else if (!isAssignedAgent && !isQueueAgent) {
        socket.emit('ticket:error', { message: 'Você não tem acesso a este atendimento.' });
        return;
      }

      socket.join(`ticket:${parsedTicketId}`);
      socket.emit('ticket:joined', { ticketId: parsedTicketId });
      socket.emit('ticket:history', {
        ticketId: parsedTicketId,
        messages: await store.getMessages(parsedTicketId)
      });
    } catch (error) {
      socket.emit('ticket:error', { message: 'Erro ao acessar o atendimento.' });
      console.error('Falha ao validar acesso ao atendimento:', safeErrorDetail(error));
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.agentId === null) {
      return;
    }

    const agentId = Number(socket.data.agentId);
    const connections = onlineAgents.get(agentId);
    connections?.delete(socket.id);
    if (connections?.size === 0) {
      onlineAgents.delete(agentId);
    }
    io.emit('agents:presence-updated');
  });

  socket.on('send-message', async (payload = {}) => {
    const now = Date.now();
    if (now - messageWindowStartedAt >= 60 * 1000) {
      messageWindowStartedAt = now;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    if (messagesInWindow > 30) {
      socket.emit('message:error', { message: 'Limite de mensagens atingido. Aguarde um minuto.' });
      return;
    }

    const { ticketId, senderType, text, attachment, tempId } = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};
    const parsedTicketId = Number(ticketId);
    const normalizedSenderType = String(senderType || '').toUpperCase();
    const trimmedText = String(text || '').trim();

    if (!parsedTicketId || (!trimmedText && !attachment) || trimmedText.length > 1000) {
      socket.emit('message:error', { message: 'Mensagem inválida ou maior que 1000 caracteres.' });
      return;
    }

    if (normalizedSenderType !== 'CUSTOMER' && normalizedSenderType !== 'AGENT') {
      socket.emit('message:error', { message: 'Tipo de remetente inválido.' });
      return;
    }

    try {
      const ticket = await store.getTicketAccess(parsedTicketId);

      if (!ticket || ticket.status === 'CLOSED') {
        socket.emit('message:error', { message: 'Este atendimento não está disponível para mensagens.' });
        return;
      }

      let senderId;

      if (normalizedSenderType === 'AGENT') {
        if (
          socket.data.agentId === null
          || Number(ticket.assignedAgentId) !== Number(socket.data.agentId)
        ) {
          socket.emit('message:error', { message: 'Faça login e assuma este atendimento antes de enviar mensagens.' });
          return;
        }

        senderId = socket.data.agentId;
      } else {
        if (!socket.data.customerTickets.has(parsedTicketId)) {
          socket.emit('message:error', { message: 'Acesse o atendimento antes de enviar mensagens.' });
          return;
        }

        senderId = ticket.customerId;
      }

      let normalizedAttachment = null;
      if (attachment) {
        const name = String(attachment.name || '').trim().slice(0, 255);
        const type = String(attachment.type || '').trim().slice(0, 100);
        const data = typeof attachment.data === 'string' ? attachment.data : '';
        const allowed = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/i.test(type);
        if (!name || !allowed || data.length > 4 * 1024 * 1024 || !/^data:[^;]+;base64,[A-Za-z0-9+/=]+$/.test(data)) {
          socket.emit('message:error', { message: 'Anexo inválido. Use imagem, PDF ou documento de até 3 MB.' });
          return;
        }
        normalizedAttachment = { name, type, data };
      }

      const deliveryKey = tempId ? `${parsedTicketId}:${String(tempId).slice(0, 100)}` : null;
      let message = deliveryKey ? messageDeliveryCache.get(deliveryKey) : null;
      if (!message) {
        message = await store.createMessage({
          ticketId: parsedTicketId,
          senderType: normalizedSenderType,
          senderId,
          text: trimmedText,
          attachment: normalizedAttachment
        });
        if (deliveryKey) {
          messageDeliveryCache.set(deliveryKey, message);
          if (messageDeliveryCache.size > 10000) {
            messageDeliveryCache.delete(messageDeliveryCache.keys().next().value);
          }
        }
      }

      io.to(`ticket:${parsedTicketId}`).emit('new-message', { ...message, tempId: tempId || null });
      if (normalizedSenderType === 'CUSTOMER' && ticket.assignedAgentId) {
        io.to(`agent:${ticket.assignedAgentId}`).emit('ticket:message', {
          ticketId: parsedTicketId,
          messageText: trimmedText,
          customerId: ticket.customerId,
          departmentId: ticket.departmentId
        });
      }
      io.emit('tickets:updated');
      if (normalizedSenderType === 'CUSTOMER' && ticket.status === 'WAITING' && !ticket.assignedAgentId) {
        queueAiReply(parsedTicketId);
      }
    } catch (error) {
      console.error('Falha ao enviar mensagem:', safeErrorDetail(error));
      socket.emit('message:error', { message: 'Não foi possível enviar a mensagem.' });
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  const status = Number(error.status || error.statusCode);
  const isClientError = status >= 400 && status < 500;
  console.error('Falha ao processar solicitação:', error?.type || safeErrorDetail(error));
  return res.status(isClientError ? status : 500).json({
    message: isClientError
      ? 'Solicitação inválida ou muito grande.'
      : 'Ocorreu um erro interno.'
  });
});

async function startServer() {
  if (typeof store.initialize === 'function') {
    await store.initialize();
  }

  server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer().catch(async (error) => {
  console.error('Falha ao iniciar o servidor:', safeErrorDetail(error));
  if (typeof store.close === 'function') {
    await store.close();
  }
  process.exitCode = 1;
});

