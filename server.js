require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const store = require('./config/store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = 'agent_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const ticketAccessTokens = new Map();

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

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}${secure}`
  );
}

io.use((socket, next) => {
  const session = getSession(socket.request.headers.cookie);
  socket.data.agentId = session?.agent.ID ?? null;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'multi-atendimento-web' });
});

app.get('/api/departments', async (req, res) => {
  try {
    res.json(await store.listDepartments());
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar departamentos', error: error.message });
  }
});

app.post('/api/departments', async (req, res) => {
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
    return res.status(500).json({ message: 'Erro ao cadastrar setor/departamento', error: error.message });
  }
});

app.post('/api/customers/register', async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const roleJob = String(req.body.roleJob || '').trim();
    const phone = String(req.body.phone || '').trim();
    const departmentId = Number(req.body.departmentId);

    if (!fullName || !phone || !departmentId) {
      return res.status(400).json({ message: 'Nome, telefone e departamento são obrigatórios.' });
    }

    const registration = await store.registerCustomer({
      fullName,
      roleJob,
      phone,
      departmentId
    });
    const accessToken = randomBytes(32).toString('hex');
    ticketAccessTokens.set(accessToken, {
      ticketId: Number(registration.ticket.id),
      customerId: Number(registration.customer.id)
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
    return res.status(500).json({ message: 'Erro ao cadastrar cliente e criar ticket', error: error.message });
  }
});

app.post('/api/agents/login', async (req, res) => {
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
        departmentId: agent.DEPARTMENT_ID
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao autenticar atendente', error: error.message });
  }
});

app.post('/api/agents/logout', (req, res) => {
  const session = getSession(req.headers.cookie);

  if (session) {
    const cookie = req.headers.cookie.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    sessions.delete(cookie.slice(SESSION_COOKIE.length + 1));
  }

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  return res.json({ success: true });
});

app.get('/api/tickets/dashboard', requireAgent, async (req, res) => {
  try {
    const agentId = Number(req.query.agentId || 0);

    return res.json(await store.getDashboard(agentId));
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao consultar fila de atendimento', error: error.message });
  }
});

app.post('/api/tickets/:id/assign', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const agentId = Number(req.agent.ID);

    if (!ticketId || !agentId) {
      return res.status(400).json({ message: 'Ticket e agente são obrigatórios.' });
    }

    await store.assignTicket(ticketId, agentId);

    io.emit('tickets:updated');
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', { ticketId, status: 'IN_PROGRESS', agentId });

    return res.json({ success: true, ticketId, status: 'IN_PROGRESS', agentId });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao puxar atendimento', error: error.message });
  }
});

app.post('/api/tickets/:id/close', requireAgent, async (req, res) => {
  try {
    const ticketId = Number(req.params.id);
    const agentId = Number(req.agent.ID);

    if (!ticketId) {
      return res.status(400).json({ message: 'Ticket é obrigatório.' });
    }

    await store.closeTicket(ticketId, agentId);

    io.emit('tickets:updated');
    io.to(`ticket:${ticketId}`).emit('ticket:status-updated', { ticketId, status: 'CLOSED' });

    return res.json({ success: true, ticketId, status: 'CLOSED' });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao encerrar atendimento', error: error.message });
  }
});

io.on('connection', (socket) => {
  socket.data.customerTickets = new Set();

  socket.on('join-ticket', async ({ ticketId, accessToken }) => {
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

      if (socket.data.agentId !== null) {
        if (Number(ticket.assignedAgentId) !== Number(socket.data.agentId)) {
          socket.emit('ticket:error', { message: 'Você não tem acesso a este atendimento.' });
          return;
        }
      } else {
        const access = ticketAccessTokens.get(String(accessToken || ''));

        if (!access || access.ticketId !== parsedTicketId || access.customerId !== Number(ticket.customerId)) {
          socket.emit('ticket:error', { message: 'Acesso inválido ao atendimento.' });
          return;
        }

        socket.data.customerTickets.add(parsedTicketId);
      }

      socket.join(`ticket:${parsedTicketId}`);
      socket.emit('ticket:joined', { ticketId: parsedTicketId });
    } catch (error) {
      socket.emit('ticket:error', { message: 'Erro ao acessar o atendimento.' });
      console.error('Erro ao validar acesso ao atendimento:', error.message);
    }
  });

  socket.on('send-message', async ({ ticketId, senderType, text }) => {
    const parsedTicketId = Number(ticketId);
    const normalizedSenderType = String(senderType || '').toUpperCase();
    const trimmedText = String(text || '').trim();

    if (!parsedTicketId || !trimmedText || trimmedText.length > 1000) {
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

      const message = await store.createMessage({
        ticketId: parsedTicketId,
        senderType: normalizedSenderType,
        senderId,
        text: trimmedText
      });

      io.to(`ticket:${parsedTicketId}`).emit('new-message', message);
      io.emit('tickets:updated');
    } catch (error) {
      socket.emit('message:error', { message: 'Erro ao enviar mensagem', error: error.message });
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
