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

async function getDashboard(agentId) {
  const ticketQuery = (where, params = [], limit = '') => query(`
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
    ORDER BY ${where === "T.STATUS = 'WAITING'" ? 'T.CREATED_AT ASC' : 'T.UPDATED_AT DESC'}
    ${limit}
  `, params).then(normalizeRows);

  const [waiting, myTickets, closed] = await Promise.all([
    ticketQuery("T.STATUS = 'WAITING'"),
    ticketQuery("T.STATUS = 'IN_PROGRESS' AND T.ASSIGNED_AGENT_ID = ?", [agentId]),
    ticketQuery("T.STATUS = 'CLOSED'", [], 'ROWS 20')
  ]);

  return { waiting, myTickets, closed };
}

async function getTicketAccess(ticketId) {
  const rows = normalizeRows(
    await query('SELECT CUSTOMER_ID, ASSIGNED_AGENT_ID, STATUS FROM TICKETS WHERE ID = ?', [ticketId])
  );
  const ticket = rows[0];

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
