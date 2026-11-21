const bcrypt = require('bcryptjs');
const {
  DEFAULT_DEPARTMENT_GUIDANCE,
  DEFAULT_ADDITIONAL_DEPARTMENTS,
  DEFAULT_NEW_DEPARTMENT_GUIDANCE,
  TEST_SALES_PRODUCTS
} = require('./ai-seed-data');

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) {
  throw new Error('Em produção, defina ADMIN_EMAIL e ADMIN_PASSWORD com pelo menos 12 caracteres.');
}

const departments = [
  { ID: 1, NAME: 'Atendimento', AI_ENABLED: false, AI_INSTRUCTIONS: DEFAULT_DEPARTMENT_GUIDANCE[1], AI_ADDITIONAL_CONTEXT: '' },
  { ID: 2, NAME: 'Financeiro', AI_ENABLED: false, AI_INSTRUCTIONS: DEFAULT_DEPARTMENT_GUIDANCE[2], AI_ADDITIONAL_CONTEXT: '' },
  { ID: 3, NAME: 'Suporte Técnico', AI_ENABLED: false, AI_INSTRUCTIONS: DEFAULT_DEPARTMENT_GUIDANCE[3], AI_ADDITIONAL_CONTEXT: '' },
  { ID: 4, NAME: 'Vendas', AI_ENABLED: false, AI_INSTRUCTIONS: DEFAULT_DEPARTMENT_GUIDANCE[4], AI_ADDITIONAL_CONTEXT: '' },
  ...DEFAULT_ADDITIONAL_DEPARTMENTS.map((department, index) => ({
    ID: index + 5,
    NAME: department.name,
    AI_ENABLED: false,
    AI_INSTRUCTIONS: department.instructions,
    AI_ADDITIONAL_CONTEXT: ''
  }))
];
const defaultAgent = { 
  ID: 1,
  NAME: 'Atendente Admin',
  EMAIL: process.env.ADMIN_EMAIL || 'admin@empresa.com',
  PASSWORD_HASH: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
  DEPARTMENT_ID: Number(process.env.ADMIN_DEPARTMENT_ID || 1),
  IS_ADMIN: true
};
const configuredAgents = process.env.AGENTS_JSON ? JSON.parse(process.env.AGENTS_JSON) : [];

if (!Array.isArray(configuredAgents)) {
  throw new Error('AGENTS_JSON deve conter uma lista JSON de atendentes.');
}

const demoAgents = process.env.NODE_ENV === 'production' || configuredAgents.length > 0
  ? []
  : [
    { name: 'Atendente Financeiro', email: 'financeiro@empresa.com', password: 'financeiro123', departmentId: 2 },
    { name: 'Atendente Suporte', email: 'suporte@empresa.com', password: 'suporte12345', departmentId: 3 },
    { name: 'Atendente Vendas', email: 'vendas@empresa.com', password: 'vendas12345', departmentId: 4 },
    { name: 'Atendente de Pedidos', email: 'pedidos@empresa.com', password: 'pedidos12345', departmentId: 5 },
    { name: 'Atendente de Logística', email: 'logistica@empresa.com', password: 'logistica12345', departmentId: 6 }
  ];

const agents = [defaultAgent, ...[...demoAgents, ...configuredAgents].map((agent, index) => {
  const departmentId = Number(agent.departmentId);
  const email = String(agent.email || '').trim();
  const password = String(agent.password || '');

  if (
    !String(agent.name || '').trim()
    || !email
    || password.length < (process.env.NODE_ENV === 'production' ? 12 : 1)
    || !departments.some((department) => department.ID === departmentId)
  ) {
    throw new Error(`Atendente inválido na posição ${index + 1} da configuração de atendentes.`);
  }

  return {
    ID: index + 2,
    NAME: String(agent.name).trim(),
    EMAIL: email,
    PASSWORD_HASH: bcrypt.hashSync(password, 10),
    DEPARTMENT_ID: departmentId,
    IS_ADMIN: false
  };
})];

if (agents.some((agent, index) => agents.some((other, otherIndex) => index !== otherIndex && other.EMAIL.toLowerCase() === agent.EMAIL.toLowerCase()))) {
  throw new Error('Os e-mails dos atendentes precisam ser únicos.');
}
const customers = [];
const tickets = [];
const messages = [];

let nextDepartmentId = departments.length + 1;
let nextAgentId = agents.length + 1;
let nextCustomerId = 1;
let nextTicketId = 1;
let nextMessageId = 1;

function createDepartment(name) {
  const existing = departments.find((department) => department.NAME.toUpperCase() === name.toUpperCase());

  if (existing) {
    return { department: { id: existing.ID, name: existing.NAME }, created: false };
  }

  const department = {
    ID: nextDepartmentId++,
    NAME: name,
    AI_ENABLED: false,
    AI_INSTRUCTIONS: DEFAULT_NEW_DEPARTMENT_GUIDANCE,
    AI_ADDITIONAL_CONTEXT: ''
  };
  departments.push(department);

  return { department: { id: department.ID, name: department.NAME }, created: true };
}

function createAgent({ name, email, password, departmentId }) {
  if (!departments.some((department) => department.ID === departmentId)) {
    throw new Error('Departamento não encontrado.');
  }
  if (agents.some((agent) => agent.EMAIL.toLowerCase() === email.toLowerCase())) {
    return null;
  }

  const agent = {
    ID: nextAgentId++,
    NAME: name,
    EMAIL: email,
    PASSWORD_HASH: bcrypt.hashSync(password, 10),
    DEPARTMENT_ID: departmentId,
    IS_ADMIN: false
  };
  agents.push(agent);
  return { ID: agent.ID, NAME: agent.NAME, DEPARTMENT_ID: agent.DEPARTMENT_ID };
}

function updateDepartmentAiSettings(departmentId, { enabled, instructions, additionalContext }) {
  const department = departments.find((item) => item.ID === departmentId);
  if (!department) {
    return null;
  }

  department.AI_ENABLED = enabled;
  department.AI_INSTRUCTIONS = instructions;
  department.AI_ADDITIONAL_CONTEXT = additionalContext ?? department.AI_ADDITIONAL_CONTEXT ?? '';
  return department;
}

function listDepartments() {
  return departments.slice().sort((a, b) => a.NAME.localeCompare(b.NAME));
}

function updateAllDepartmentAiSettings(enabled) {
  departments.forEach((department) => {
    department.AI_ENABLED = enabled;
  });
  return listDepartments();
}

function listProducts() {
  return TEST_SALES_PRODUCTS.map((product) => ({ ...product }));
}

function registerCustomer({ fullName, roleJob, phone, departmentId }) {
  if (!departments.some((department) => department.ID === departmentId)) {
    throw new Error('Departamento não encontrado.');
  }

  let customer = customers.find((item) => item.PHONE === phone);

  if (!customer) {
    customer = {
      ID: nextCustomerId++,
      FULL_NAME: fullName,
      ROLE_JOB: roleJob,
      PHONE: phone
    };
    customers.push(customer);
  }

  const timestamp = new Date().toISOString();
  const ticket = {
    ID: nextTicketId++,
    CUSTOMER_ID: customer.ID,
    DEPARTMENT_ID: departmentId,
    ASSIGNED_AGENT_ID: null,
    AI_HANDOFF: false,
    STATUS: 'WAITING',
    CREATED_AT: timestamp,
    UPDATED_AT: timestamp
  };
  tickets.push(ticket);

  return {
    customer: { id: customer.ID, fullName, phone, roleJob },
    ticket: { id: ticket.ID, status: ticket.STATUS, departmentId }
  };
}

function getDashboard(agentId, departmentId, isAdmin = false) {
  const departmentById = new Map(departments.map((department) => [department.ID, department]));
  const customerById = new Map(customers.map((customer) => [customer.ID, customer]));
  const ticketRows = tickets.map((ticket) => {
    const customer = customerById.get(ticket.CUSTOMER_ID);
    const department = departmentById.get(ticket.DEPARTMENT_ID);

    return {
      ID: ticket.ID,
      STATUS: ticket.STATUS,
      CREATED_AT: ticket.CREATED_AT,
      UPDATED_AT: ticket.UPDATED_AT,
      DEPARTMENT_ID: ticket.DEPARTMENT_ID,
      FULL_NAME: customer.FULL_NAME,
      ROLE_JOB: customer.ROLE_JOB,
      PHONE: customer.PHONE,
      DEPARTMENT_NAME: department.NAME
    };
  });

  return {
    waiting: ticketRows
      .filter((ticket) => ticket.STATUS === 'WAITING' && (isAdmin || ticket.DEPARTMENT_ID === departmentId))
      .sort((a, b) => a.CREATED_AT.localeCompare(b.CREATED_AT)),
    myTickets: ticketRows
      .filter((ticket) => ticket.STATUS === 'IN_PROGRESS' && tickets.find((item) => item.ID === ticket.ID).ASSIGNED_AGENT_ID === agentId)
      .sort((a, b) => b.UPDATED_AT.localeCompare(a.UPDATED_AT)),
    closed: ticketRows
      .filter((ticket) => ticket.STATUS === 'CLOSED' && tickets.find((item) => item.ID === ticket.ID).ASSIGNED_AGENT_ID === agentId)
      .sort((a, b) => b.UPDATED_AT.localeCompare(a.UPDATED_AT))
      .slice(0, 20)
  };
}

function assignTicket(ticketId, agentId) {
  const ticket = tickets.find((item) => item.ID === ticketId);

  if (ticket) {
    ticket.ASSIGNED_AGENT_ID = agentId;
    ticket.STATUS = 'IN_PROGRESS';
    ticket.UPDATED_AT = new Date().toISOString();
  }
}

function closeTicket(ticketId, agentId) {
  const ticket = tickets.find((item) => item.ID === ticketId);

  if (ticket) {
    ticket.STATUS = 'CLOSED';
    ticket.ASSIGNED_AGENT_ID = agentId || null;
    ticket.UPDATED_AT = new Date().toISOString();
  }
}

function transferTicket(ticketId, departmentId) {
  const ticket = tickets.find((item) => item.ID === ticketId);

  if (!ticket || !departments.some((department) => department.ID === departmentId)) {
    return null;
  }

  ticket.DEPARTMENT_ID = departmentId;
  ticket.ASSIGNED_AGENT_ID = null;
  ticket.AI_HANDOFF = false;
  ticket.STATUS = 'WAITING';
  ticket.UPDATED_AT = new Date().toISOString();
  return getTicketAccess(ticketId);
}

function transferTicketToAgent(ticketId, departmentId, agentId) {
  const ticket = tickets.find((item) => item.ID === ticketId);
  const agent = agents.find((item) => item.ID === agentId);

  if (!ticket || !agent || agent.DEPARTMENT_ID !== departmentId) {
    return null;
  }

  ticket.DEPARTMENT_ID = departmentId;
  ticket.ASSIGNED_AGENT_ID = agentId;
  ticket.AI_HANDOFF = false;
  ticket.STATUS = 'IN_PROGRESS';
  ticket.UPDATED_AT = new Date().toISOString();
  return getTicketAccess(ticketId);
}

function createMessage({ ticketId, senderType, senderId, text, attachment }) {
  const message = {
    id: nextMessageId++,
    ticketId,
    senderType,
    senderId: senderId || null,
    messageText: text,
    attachment: attachment ? {
      name: attachment.name,
      type: attachment.type,
      data: attachment.data
    } : null,
    createdAt: new Date().toISOString()
  };
  messages.push(message);
  return message;
}

function createAiMessageIfWaiting({ ticketId, text, expectedLastMessageId }) {
  const ticket = tickets.find((item) => item.ID === ticketId);
  if (!ticket || ticket.STATUS !== 'WAITING' || ticket.ASSIGNED_AGENT_ID || ticket.AI_HANDOFF) {
    return null;
  }
  if (expectedLastMessageId !== undefined) {
    const ticketMessages = getMessages(ticketId);
    const latestMessageId = ticketMessages.length
      ? ticketMessages[ticketMessages.length - 1].id
      : null;
    if (latestMessageId !== expectedLastMessageId) {
      return null;
    }
  }
  return createMessage({ ticketId, senderType: 'BOT', senderId: null, text });
}

function markTicketAiHandoff(ticketId) {
  const ticket = tickets.find((item) => item.ID === ticketId);
  if (!ticket || ticket.STATUS !== 'WAITING' || ticket.ASSIGNED_AGENT_ID) {
    return false;
  }
  ticket.AI_HANDOFF = true;
  return true;
}

function getMessages(ticketId) {
  return messages.filter((message) => message.ticketId === ticketId);
}

function listAgents() {
  return agents.map(({ ID, NAME, DEPARTMENT_ID }) => ({ ID, NAME, DEPARTMENT_ID }));
}

function getTicketAccess(ticketId) {
  const ticket = tickets.find((item) => item.ID === ticketId);

  if (!ticket) {
    return null;
  }

  return {
    customerId: ticket.CUSTOMER_ID,
    assignedAgentId: ticket.ASSIGNED_AGENT_ID,
    aiHandoff: ticket.AI_HANDOFF,
    status: ticket.STATUS,
    departmentId: ticket.DEPARTMENT_ID,
    departmentName: departments.find((department) => department.ID === ticket.DEPARTMENT_ID)?.NAME,
    fullName: customers.find((customer) => customer.ID === ticket.CUSTOMER_ID)?.FULL_NAME,
    phone: customers.find((customer) => customer.ID === ticket.CUSTOMER_ID)?.PHONE,
    roleJob: customers.find((customer) => customer.ID === ticket.CUSTOMER_ID)?.ROLE_JOB
  };
}

module.exports = {
  listDepartments,
  createDepartment,
  createAgent,
  updateDepartmentAiSettings,
  updateAllDepartmentAiSettings,
  listProducts,
  registerCustomer,
  findAgentByEmail: (email) => agents.find((agent) => agent.EMAIL === email) || null,
  getDashboard,
  getTicketAccess,
  assignTicket,
  closeTicket,
  transferTicket,
  transferTicketToAgent,
  getMessages,
  listAgents,
  createMessage,
  createAiMessageIfWaiting,
  markTicketAiHandoff
};

