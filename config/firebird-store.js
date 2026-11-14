const { query } = require('./db');

const normalizeRows = (rows = []) => rows.map((row) => {
  const normalized = {};

  Object.keys(row).forEach((key) => {
    normalized[key.toUpperCase()] = row[key];
  });

  return normalized;
});

async function createDepartment(name) {
  const existing = normalizeRows(
    await query('SELECT ID, NAME FROM DEPARTMENTS WHERE UPPER(NAME) = UPPER(?)', [name])
  );

  if (existing.length > 0) {
    return {
      department: { id: existing[0].ID, name: existing[0].NAME },
      created: false
    };
  }

  const result = normalizeRows(
    await query('INSERT INTO DEPARTMENTS (NAME) VALUES (?) RETURNING ID', [name])
  );

  return {
    department: { id: result[0]?.ID, name },
    created: true
  };
}

async function registerCustomer({ fullName, roleJob, phone, departmentId }) {
  const existing = normalizeRows(
    await query('SELECT ID FROM CUSTOMERS WHERE PHONE = ?', [phone])
  );
  let customerId = existing[0]?.ID;

  if (!customerId) {
    const result = normalizeRows(
      await query(
        `INSERT INTO CUSTOMERS (FULL_NAME, ROLE_JOB, PHONE, IS_VERIFIED, CREATED_AT)
         VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
         RETURNING ID`,
        [fullName, roleJob, phone]
      )
    );
    customerId = result[0]?.ID;
  }

  const result = normalizeRows(
    await query(
      `INSERT INTO TICKETS (CUSTOMER_ID, DEPARTMENT_ID, ASSIGNED_AGENT_ID, STATUS, CREATED_AT, UPDATED_AT)
       VALUES (?, ?, NULL, 'WAITING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING ID`,
      [customerId, departmentId]
    )
  );

  return {
    customer: { id: customerId, fullName, phone, roleJob },
    ticket: { id: result[0]?.ID, status: 'WAITING', departmentId }
  };
}

async function getDashboard(agentId, departmentId, isAdmin = false) {
  const ticketQuery = (where, params = [], orderBy = 'T.UPDATED_AT DESC', limit = '') => query(`
    SELECT
      T.ID,
      T.STATUS,
      T.CREATED_AT,
      T.UPDATED_AT,
      T.DEPARTMENT_ID,
      C.FULL_NAME,
      C.ROLE_JOB,
      C.PHONE,
      D.NAME AS DEPARTMENT_NAME
    FROM TICKETS T
    INNER JOIN CUSTOMERS C ON C.ID = T.CUSTOMER_ID
    INNER JOIN DEPARTMENTS D ON D.ID = T.DEPARTMENT_ID
    WHERE ${where}
    ORDER BY ${orderBy}
    ${limit}
  `, params).then(normalizeRows);

  const [waiting, myTickets, closed] = await Promise.all([
    isAdmin
      ? ticketQuery("T.STATUS = 'WAITING'", [], 'T.CREATED_AT ASC')
      : ticketQuery("T.STATUS = 'WAITING' AND T.DEPARTMENT_ID = ?", [departmentId], 'T.CREATED_AT ASC'),
    ticketQuery("T.STATUS = 'IN_PROGRESS' AND T.ASSIGNED_AGENT_ID = ?", [agentId]),
    ticketQuery("T.STATUS = 'CLOSED' AND T.ASSIGNED_AGENT_ID = ?", [agentId], 'T.UPDATED_AT DESC', 'ROWS 20')
  ]);

  return { waiting, myTickets, closed };
}

async function getTicketAccess(ticketId) {
  const rows = normalizeRows(
    await query(
      `SELECT T.CUSTOMER_ID, T.ASSIGNED_AGENT_ID, T.STATUS, T.DEPARTMENT_ID, D.NAME AS DEPARTMENT_NAME,
              C.FULL_NAME, C.PHONE, C.ROLE_JOB
       FROM TICKETS T
       INNER JOIN DEPARTMENTS D ON D.ID = T.DEPARTMENT_ID
       INNER JOIN CUSTOMERS C ON C.ID = T.CUSTOMER_ID
       WHERE T.ID = ?`,
      [ticketId]
    )
  );
  const ticket = rows[0];

  if (!ticket) {
    return null;
  }

  return {
    customerId: ticket.CUSTOMER_ID,
    assignedAgentId: ticket.ASSIGNED_AGENT_ID,
    status: ticket.STATUS,
    departmentId: ticket.DEPARTMENT_ID,
    departmentName: ticket.DEPARTMENT_NAME,
    fullName: ticket.FULL_NAME,
    phone: ticket.PHONE,
    roleJob: ticket.ROLE_JOB
  };
}

async function transferTicket(ticketId, departmentId) {
  await query(
    `UPDATE TICKETS
     SET DEPARTMENT_ID = ?, ASSIGNED_AGENT_ID = NULL, STATUS = 'WAITING', UPDATED_AT = CURRENT_TIMESTAMP
     WHERE ID = ?`,
    [departmentId, ticketId]
  );
  return getTicketAccess(ticketId);
}

async function transferTicketToAgent(ticketId, departmentId, agentId) {
  await query(
    `UPDATE TICKETS
     SET DEPARTMENT_ID = ?, ASSIGNED_AGENT_ID = ?, STATUS = 'IN_PROGRESS', UPDATED_AT = CURRENT_TIMESTAMP
     WHERE ID = ?`,
    [departmentId, agentId, ticketId]
  );
  return getTicketAccess(ticketId);
}

async function getMessages(ticketId) {
  const rows = normalizeRows(await query(
    `SELECT ID, TICKET_ID, SENDER_TYPE, SENDER_ID, MESSAGE_TEXT, CREATED_AT
     FROM MESSAGES
     WHERE TICKET_ID = ?
     ORDER BY CREATED_AT ASC`,
    [ticketId]
  ));

  return rows.map((row) => ({
    id: row.ID,
    ticketId: row.TICKET_ID,
    senderType: row.SENDER_TYPE,
    senderId: row.SENDER_ID,
    messageText: row.MESSAGE_TEXT,
    createdAt: row.CREATED_AT
  }));
}

module.exports = {
  listDepartments: async () => normalizeRows(await query('SELECT ID, NAME FROM DEPARTMENTS ORDER BY NAME')),
  createDepartment,
  registerCustomer,
  findAgentByEmail: async (email) => {
    const rows = normalizeRows(
      await query('SELECT ID, NAME, EMAIL, PASSWORD_HASH, DEPARTMENT_ID FROM AGENTS WHERE EMAIL = ?', [email])
    );
    return rows[0] || null;
  },
  getDashboard,
  getTicketAccess,
  assignTicket: (ticketId, agentId) => query(
    `UPDATE TICKETS
     SET ASSIGNED_AGENT_ID = ?, STATUS = 'IN_PROGRESS', UPDATED_AT = CURRENT_TIMESTAMP
     WHERE ID = ?`,
    [agentId, ticketId]
  ),
  closeTicket: (ticketId, agentId) => query(
    `UPDATE TICKETS
     SET STATUS = 'CLOSED', ASSIGNED_AGENT_ID = ?, UPDATED_AT = CURRENT_TIMESTAMP
     WHERE ID = ?`,
    [agentId || null, ticketId]
  ),
  transferTicket,
  transferTicketToAgent,
  getMessages,
  listAgents: async () => normalizeRows(
    await query('SELECT ID, NAME, DEPARTMENT_ID FROM AGENTS ORDER BY NAME')
  ),
  createMessage: async ({ ticketId, senderType, senderId, text }) => {
    const result = normalizeRows(
      await query(
        `INSERT INTO MESSAGES (TICKET_ID, SENDER_TYPE, SENDER_ID, MESSAGE_TEXT, CREATED_AT)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         RETURNING ID`,
        [ticketId, senderType, senderId || null, text]
      )
    );

    return {
      id: result[0]?.ID,
      ticketId,
      senderType,
      senderId: senderId || null,
      messageText: text,
      createdAt: new Date().toISOString()
    };
  }
};
