const bcrypt = require('bcryptjs');

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) {
  throw new Error('Em produção, defina ADMIN_EMAIL e ADMIN_PASSWORD com pelo menos 12 caracteres.');
}

const departments = [
  { ID: 1, NAME: 'Atendimento' },
  { ID: 2, NAME: 'Financeiro' },
  { ID: 3, NAME: 'Suporte Técnico' },
  { ID: 4, NAME: 'Vendas' }
];
const agents = [{
  ID: 1,
  NAME: 'Atendente Admin',
  EMAIL: process.env.ADMIN_EMAIL || 'admin@empresa.com',
  PASSWORD_HASH: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
  DEPARTMENT_ID: 1
}];
const customers = [];
const tickets = [];
const messages = [];

let nextDepartmentId = 5;
let nextCustomerId = 1;
let nextTicketId = 1;
let nextMessageId = 1;

function createDepartment(name) {
  const existing = departments.find((department) => department.NAME.toUpperCase() === name.toUpperCase());

  if (existing) {
    return { department: { id: existing.ID, name: existing.NAME }, created: false };
  }

  const department = { ID: nextDepartmentId++, NAME: name };
  departments.push(department);

  return { department: { id: department.ID, name: department.NAME }, created: true };
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

function getDashboard(agentId) {
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
      .filter((ticket) => ticket.STATUS === 'WAITING')
      .sort((a, b) => a.CREATED_AT.localeCompare(b.CREATED_AT)),
    myTickets: ticketRows
      .filter((ticket) => ticket.STATUS === 'IN_PROGRESS' && tickets.find((item) => item.ID === ticket.ID).ASSIGNED_AGENT_ID === agentId)
      .sort((a, b) => b.UPDATED_AT.localeCompare(a.UPDATED_AT)),
    closed: ticketRows
      .filter((ticket) => ticket.STATUS === 'CLOSED')
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

function createMessage({ ticketId, senderType, senderId, text }) {
  const message = {
    id: nextMessageId++,
    ticketId,
    senderType,
    senderId: senderId || null,
    messageText: text,
    createdAt: new Date().toISOString()
  };
  messages.push(message);
  return message;
}

function getTicketAccess(ticketId) {
  const ticket = tickets.find((item) => item.ID === ticketId);

  if (!ticket) {
    return null;
  }

  return {
    customerId: ticket.CUSTOMER_ID,
    assignedAgentId: ticket.ASSIGNED_AGENT_ID,
    status: ticket.STATUS
  };
}

module.exports = {
  listDepartments: () => departments.slice().sort((a, b) => a.NAME.localeCompare(b.NAME)),
  createDepartment,
  registerCustomer,
  findAgentByEmail: (email) => agents.find((agent) => agent.EMAIL === email) || null,
  getDashboard,
  getTicketAccess,
  assignTicket,
  closeTicket,
  createMessage
};
