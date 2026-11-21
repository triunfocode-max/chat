const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  createBlindIndex,
  decryptField,
  encryptField
} = require('./field-crypto');

const databaseUrl = process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  throw new Error('Defina SUPABASE_DB_URL com a string de conexão PostgreSQL do Supabase.');
}

const connectionUrl = new URL(databaseUrl);
if (connectionUrl.protocol !== 'postgres:' && connectionUrl.protocol !== 'postgresql:') {
  throw new Error('SUPABASE_DB_URL precisa usar o protocolo PostgreSQL.');
}
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((parameter) => {
  connectionUrl.searchParams.delete(parameter);
});

if (process.env.NODE_ENV === 'production' && (
  !process.env.ADMIN_EMAIL
  || !process.env.ADMIN_PASSWORD
  || process.env.ADMIN_PASSWORD.length < 12
)) {
  throw new Error('Em produção, defina ADMIN_EMAIL e ADMIN_PASSWORD com pelo menos 12 caracteres.');
}

const configuredAgents = process.env.AGENTS_JSON ? JSON.parse(process.env.AGENTS_JSON) : [];

if (!Array.isArray(configuredAgents)) {
  throw new Error('AGENTS_JSON deve conter uma lista JSON de atendentes.');
}

const departments = [
  { id: 1, name: 'Atendimento' },
  { id: 2, name: 'Financeiro' },
  { id: 3, name: 'Suporte Técnico' },
  { id: 4, name: 'Vendas' }
];
const demoAgents = process.env.NODE_ENV === 'production' || configuredAgents.length > 0
  ? []
  : [
    { name: 'Atendente Financeiro', email: 'financeiro@empresa.com', password: 'financeiro123', departmentId: 2 },
    { name: 'Atendente Suporte', email: 'suporte@empresa.com', password: 'suporte12345', departmentId: 3 },
    { name: 'Atendente Vendas', email: 'vendas@empresa.com', password: 'vendas12345', departmentId: 4 }
  ];
const agentsToSeed = [
  {
    name: 'Atendente Admin',
    email: process.env.ADMIN_EMAIL || 'admin@empresa.com',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    departmentId: Number(process.env.ADMIN_DEPARTMENT_ID || 1),
    isAdmin: true
  },
  ...[...demoAgents, ...configuredAgents].map((agent) => ({
    name: String(agent.name || '').trim(),
    email: String(agent.email || '').trim(),
    password: String(agent.password || ''),
    departmentId: Number(agent.departmentId),
    isAdmin: false
  }))
];

const agentEmails = new Set();
agentsToSeed.forEach((agent, index) => {
  const email = agent.email.toLowerCase();
  const minimumPasswordLength = process.env.NODE_ENV === 'production' ? 12 : 1;

  if (
    !agent.name
    || !email
    || agent.password.length < minimumPasswordLength
    || !departments.some((department) => department.id === agent.departmentId)
  ) {
    throw new Error(`Atendente inválido na posição ${index + 1} da configuração.`);
  }

  if (agentEmails.has(email)) {
    throw new Error('Os e-mails dos atendentes precisam ser únicos.');
  }
  agentEmails.add(email);
});

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl: {
    rejectUnauthorized: true,
    ...(process.env.SUPABASE_CA_CERT
      ? { ca: fs.readFileSync(path.resolve(process.env.SUPABASE_CA_CERT), 'utf8') }
      : {})
  },
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  application_name: 'multi-atendimento-web'
});

function normalizeRows(rows = []) {
  return rows.map((row) => Object.entries(row).reduce((normalized, [key, value]) => {
    const upperKey = key.toUpperCase();
    normalized[upperKey] = value !== null && (upperKey === 'ID' || upperKey.endsWith('_ID'))
      ? Number(value)
      : value;
    return normalized;
  }, {}));
}

async function encryptExistingData() {
  const customers = await pool.query(
    `SELECT id, full_name, role_job, phone, phone_lookup_hash
     FROM customers
     ORDER BY id`
  );
  for (const customer of customers.rows) {
    const phone = decryptField(customer.phone);
    const phoneLookupHash = createBlindIndex('customer-phone', phone);
    if (
      [customer.full_name, customer.role_job, customer.phone]
        .every((value) => value === null || String(value).startsWith('enc:v1:'))
      && customer.phone_lookup_hash === phoneLookupHash
    ) {
      continue;
    }

    await pool.query(
      `UPDATE customers
       SET full_name = $2, role_job = $3, phone = $4, phone_lookup_hash = $5
       WHERE id = $1`,
      [
        customer.id,
        encryptField(customer.full_name),
        encryptField(customer.role_job),
        encryptField(customer.phone),
        phoneLookupHash
      ]
    );
  }

  const agents = await pool.query(
    `SELECT id, name, email, email_lookup_hash
     FROM agents
     ORDER BY id`
  );
  for (const agent of agents.rows) {
    const email = decryptField(agent.email).trim().toLowerCase();
    const emailLookupHash = createBlindIndex('agent-email', email);
    if (
      String(agent.name).startsWith('enc:v1:')
      && String(agent.email).startsWith('enc:v1:')
      && agent.email_lookup_hash === emailLookupHash
    ) {
      continue;
    }

    await pool.query(
      `UPDATE agents
       SET name = $2, email = $3, email_lookup_hash = $4
       WHERE id = $1`,
      [
        agent.id,
        encryptField(agent.name),
        encryptField(agent.email),
        emailLookupHash
      ]
    );
  }  

  const messages = await pool.query(
    `SELECT id, message_text
     FROM messages
     ORDER BY id`
  );
  for (const message of messages.rows) {
    if (String(message.message_text).startsWith('enc:v1:')) {
      decryptField(message.message_text);
      continue;
    }
    await pool.query(
      'UPDATE messages SET message_text = $2 WHERE id = $1',
      [message.id, encryptField(message.message_text)]
    );
  }
}

async function initialize() {
  createBlindIndex('key-check', 'initialized');
  await pool.query(`
    ALTER TABLE departments
      ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_instructions TEXT NOT NULL DEFAULT ''
  `);
  await pool.query(`
    ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS ai_handoff BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE customers
      ALTER COLUMN full_name TYPE TEXT,
      ALTER COLUMN role_job TYPE TEXT,
      ALTER COLUMN phone TYPE TEXT,
      ADD COLUMN IF NOT EXISTS phone_lookup_hash VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE agents
      ALTER COLUMN name TYPE TEXT,
      ALTER COLUMN email TYPE TEXT,
      ADD COLUMN IF NOT EXISTS email_lookup_hash VARCHAR(64)
  `);
  await pool.query(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS attachment_name TEXT,
      ADD COLUMN IF NOT EXISTS attachment_type TEXT,
      ADD COLUMN IF NOT EXISTS attachment_data TEXT,
      ALTER COLUMN message_text SET DEFAULT ''
  `);
  await encryptExistingData();
  await pool.query('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_type_check');
  await pool.query(`
    ALTER TABLE messages
      ADD CONSTRAINT messages_sender_type_check
      CHECK (sender_type IN ('CUSTOMER', 'AGENT', 'BOT'))
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_customers_phone_lookup_hash ON customers (phone_lookup_hash)'
  );
  await pool.query('DROP INDEX IF EXISTS idx_customers_phone');
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_email_lookup_hash
     ON agents (email_lookup_hash)
     WHERE email_lookup_hash IS NOT NULL`
  );

  for (const department of departments) {
    await pool.query(
      'INSERT INTO departments (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [department.id, department.name]
    );
  }

  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('departments', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM departments), 1)
    )
  `);

  for (const agent of agentsToSeed) {
    const passwordHash = await bcrypt.hash(agent.password, 10);
    await pool.query(
      `INSERT INTO agents (name, email, email_lookup_hash, password_hash, department_id, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email_lookup_hash) WHERE email_lookup_hash IS NOT NULL DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           department_id = EXCLUDED.department_id,
           is_admin = EXCLUDED.is_admin`,
      [
        encryptField(agent.name),
        encryptField(agent.email.toLowerCase()),
        createBlindIndex('agent-email', agent.email),
        passwordHash,
        agent.departmentId,
        agent.isAdmin
      ]
    );
  }
}

async function createDepartment(name) {
  const inserted = await pool.query(
    `INSERT INTO departments (name) VALUES ($1)
     ON CONFLICT (LOWER(name)) DO NOTHING
     RETURNING id AS "ID", name AS "NAME"`,
    [name]
  );
  const department = inserted.rows[0] || (await pool.query(
    'SELECT id AS "ID", name AS "NAME" FROM departments WHERE LOWER(name) = LOWER($1)',
    [name]
  )).rows[0];

  return {
    department: { id: Number(department.ID), name: department.NAME },
    created: inserted.rowCount > 0
  };
}

async function updateDepartmentAiSettings(departmentId, { enabled, instructions }) {
  const result = await pool.query(
    `UPDATE departments
     SET ai_enabled = $2, ai_instructions = $3
     WHERE id = $1
     RETURNING id AS "ID", name AS "NAME", ai_enabled AS "AI_ENABLED",
               ai_instructions AS "AI_INSTRUCTIONS"`,
    [departmentId, enabled, instructions]
  );
  return normalizeRows(result.rows)[0] || null;
}

async function registerCustomer({ fullName, roleJob, phone, departmentId, accessTokenHash }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const phoneLookupHash = createBlindIndex('customer-phone', phone);
    let customerResult = await client.query(
      `SELECT id AS "ID" FROM customers
       WHERE phone_lookup_hash = $1
       ORDER BY id
       LIMIT 1`,
      [phoneLookupHash]
    );
    let customerId = customerResult.rows[0]?.ID;

    if (!customerId) {
      customerResult = await client.query(
        `INSERT INTO customers (full_name, role_job, phone, phone_lookup_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id AS "ID"`,
        [
          encryptField(fullName),
          encryptField(roleJob),
          encryptField(phone),
          phoneLookupHash
        ]
      );
      customerId = customerResult.rows[0].ID;
    }

    const ticketResult = await client.query(
      `INSERT INTO tickets (customer_id, department_id, status, access_token_hash)
       VALUES ($1, $2, 'WAITING', $3)
       RETURNING id AS "ID"`,
      [customerId, departmentId, accessTokenHash || null]
    );
    await client.query('COMMIT');

    return {
      customer: { id: Number(customerId), fullName, phone, roleJob },
      ticket: { id: Number(ticketResult.rows[0].ID), status: 'WAITING', departmentId }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getDashboard(agentId, departmentId, isAdmin = false) {
  const ticketQuery = (where, values, orderBy, limit = '') => pool.query(`
    SELECT
      T.ID AS "ID",
      T.STATUS AS "STATUS",
      T.CREATED_AT AS "CREATED_AT",
      T.UPDATED_AT AS "UPDATED_AT",
      T.DEPARTMENT_ID AS "DEPARTMENT_ID",
      C.FULL_NAME AS "FULL_NAME",
      C.ROLE_JOB AS "ROLE_JOB",
      C.PHONE AS "PHONE",
      D.NAME AS "DEPARTMENT_NAME"
    FROM TICKETS T
    INNER JOIN CUSTOMERS C ON C.ID = T.CUSTOMER_ID
    INNER JOIN DEPARTMENTS D ON D.ID = T.DEPARTMENT_ID
    WHERE ${where}
    ORDER BY ${orderBy}
    ${limit}
  `, values).then((result) => normalizeRows(result.rows).map((row) => ({
    ...row,
    FULL_NAME: decryptField(row.FULL_NAME),
    ROLE_JOB: decryptField(row.ROLE_JOB),
    PHONE: decryptField(row.PHONE)
  })));

  const [waiting, myTickets, closed] = await Promise.all([
    isAdmin
      ? ticketQuery("T.STATUS = 'WAITING'", [], 'T.CREATED_AT ASC')
      : ticketQuery("T.STATUS = 'WAITING' AND T.DEPARTMENT_ID = $1", [departmentId], 'T.CREATED_AT ASC'),
    ticketQuery("T.STATUS = 'IN_PROGRESS' AND T.ASSIGNED_AGENT_ID = $1", [agentId], 'T.UPDATED_AT DESC'),
    ticketQuery("T.STATUS = 'CLOSED' AND T.ASSIGNED_AGENT_ID = $1", [agentId], 'T.UPDATED_AT DESC', 'LIMIT 20')
  ]);

  return { waiting, myTickets, closed };
}

async function getTicketAccess(ticketId) {
  const result = await pool.query(
    `SELECT T.CUSTOMER_ID AS "CUSTOMER_ID",
            T.ASSIGNED_AGENT_ID AS "ASSIGNED_AGENT_ID",
            T.STATUS AS "STATUS",
            T.DEPARTMENT_ID AS "DEPARTMENT_ID",
            T.AI_HANDOFF AS "AI_HANDOFF",
            D.NAME AS "DEPARTMENT_NAME",
            C.FULL_NAME AS "FULL_NAME",
            C.PHONE AS "PHONE",
            C.ROLE_JOB AS "ROLE_JOB"
     FROM TICKETS T
     INNER JOIN DEPARTMENTS D ON D.ID = T.DEPARTMENT_ID
     INNER JOIN CUSTOMERS C ON C.ID = T.CUSTOMER_ID
     WHERE T.ID = $1`,
    [ticketId]
  );
  const ticket = normalizeRows(result.rows)[0];

  if (!ticket) {
    return null;
  }

  return {
    customerId: ticket.CUSTOMER_ID,
    assignedAgentId: ticket.ASSIGNED_AGENT_ID,
    aiHandoff: Boolean(ticket.AI_HANDOFF),
    status: ticket.STATUS,
    departmentId: ticket.DEPARTMENT_ID,
    departmentName: ticket.DEPARTMENT_NAME,
    fullName: decryptField(ticket.FULL_NAME),
    phone: decryptField(ticket.PHONE),
    roleJob: decryptField(ticket.ROLE_JOB)
  };
}

async function transferTicket(ticketId, departmentId) {
  await pool.query(
    `UPDATE tickets
     SET department_id = $1, assigned_agent_id = NULL, status = 'WAITING',
         ai_handoff = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [departmentId, ticketId]
  );
  return getTicketAccess(ticketId);
}

async function transferTicketToAgent(ticketId, departmentId, agentId) {
  const result = await pool.query(
    `UPDATE tickets
     SET department_id = $1, assigned_agent_id = $2, status = 'IN_PROGRESS',
         ai_handoff = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
       AND EXISTS (SELECT 1 FROM agents WHERE id = $2 AND department_id = $1)`,
    [departmentId, agentId, ticketId]
  );

  return result.rowCount ? getTicketAccess(ticketId) : null;
}

async function getMessages(ticketId) {
  const result = await pool.query(
    `SELECT id AS "ID", ticket_id AS "TICKET_ID", sender_type AS "SENDER_TYPE",
            sender_id AS "SENDER_ID", message_text AS "MESSAGE_TEXT",
            attachment_name AS "ATTACHMENT_NAME", attachment_type AS "ATTACHMENT_TYPE",
            attachment_data AS "ATTACHMENT_DATA", created_at AS "CREATED_AT"
     FROM messages
     WHERE ticket_id = $1
     ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );

  return normalizeRows(result.rows).map((row) => ({
    id: row.ID,
    ticketId: row.TICKET_ID,
    senderType: row.SENDER_TYPE,
    senderId: row.SENDER_ID,
    messageText: decryptField(row.MESSAGE_TEXT),
    attachment: row.ATTACHMENT_DATA ? {
      name: decryptField(row.ATTACHMENT_NAME),
      type: decryptField(row.ATTACHMENT_TYPE),
      data: decryptField(row.ATTACHMENT_DATA)
    } : null,
    createdAt: row.CREATED_AT
  }));
}

async function createMessage({ ticketId, senderType, senderId, text, attachment }) {
  const result = await pool.query(
    `INSERT INTO messages (
       ticket_id, sender_type, sender_id, message_text,
       attachment_name, attachment_type, attachment_data
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id AS "ID", created_at AS "CREATED_AT"`,
    [
      ticketId,
      senderType,
      senderId || null,
      encryptField(text || ''),
      attachment ? encryptField(attachment.name) : null,
      attachment ? encryptField(attachment.type) : null,
      attachment ? encryptField(attachment.data) : null
    ]
  );

  return {
    id: Number(result.rows[0].ID),
    ticketId,
    senderType,
    senderId: senderId || null,
    messageText: text,
    attachment: attachment || null,
    createdAt: result.rows[0].CREATED_AT
  };
}

async function createAiMessageIfWaiting({ ticketId, text }) {
  const result = await pool.query(
    `INSERT INTO messages (ticket_id, sender_type, sender_id, message_text)
     SELECT t.id, 'BOT', NULL, $2
     FROM tickets t
     WHERE t.id = $1 AND t.status = 'WAITING'
       AND t.assigned_agent_id IS NULL AND t.ai_handoff = FALSE
     RETURNING id AS "ID", created_at AS "CREATED_AT"`,
    [ticketId, encryptField(text)]
  );
  const message = result.rows[0];
  return message ? {
    id: Number(message.ID),
    ticketId,
    senderType: 'BOT',
    senderId: null,
    messageText: text,
    createdAt: message.CREATED_AT
  } : null;
}

async function markTicketAiHandoff(ticketId) {
  const result = await pool.query(
    `UPDATE tickets SET ai_handoff = TRUE
     WHERE id = $1 AND status = 'WAITING' AND assigned_agent_id IS NULL`,
    [ticketId]
  );
  return result.rowCount > 0;
}

module.exports = {
  initialize,
  close: () => pool.end(),
  listDepartments: async () => {
    const result = await pool.query(
      `SELECT id AS "ID", name AS "NAME", ai_enabled AS "AI_ENABLED",
              ai_instructions AS "AI_INSTRUCTIONS"
       FROM departments ORDER BY name`
    );
    return normalizeRows(result.rows);
  },
  createDepartment,
  updateDepartmentAiSettings,
  registerCustomer,
  findAgentByEmail: async (email) => {
    const result = await pool.query(
      `SELECT id AS "ID", name AS "NAME", email AS "EMAIL",
              password_hash AS "PASSWORD_HASH", department_id AS "DEPARTMENT_ID",
              is_admin AS "IS_ADMIN"
       FROM agents
       WHERE email_lookup_hash = $1`,
      [createBlindIndex('agent-email', email)]
    );
    const agent = normalizeRows(result.rows)[0];
    return agent
      ? {
        ...agent,
        NAME: decryptField(agent.NAME),
        EMAIL: decryptField(agent.EMAIL)
      }
      : null;
  },
  getDashboard,
  getTicketAccess,
  assignTicket: (ticketId, agentId) => pool.query(
    `UPDATE tickets
     SET assigned_agent_id = $1, status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [agentId, ticketId]
  ),
  closeTicket: (ticketId, agentId) => pool.query(
    `UPDATE tickets
     SET status = 'CLOSED', assigned_agent_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [agentId || null, ticketId]
  ),
  transferTicket,
  transferTicketToAgent,
  getMessages,
  listAgents: async () => {
    const result = await pool.query(
      'SELECT id AS "ID", name AS "NAME", department_id AS "DEPARTMENT_ID" FROM agents'
    );
    return normalizeRows(result.rows).map((agent) => ({
      ...agent,
      NAME: decryptField(agent.NAME)
    })).sort((first, second) => first.NAME.localeCompare(second.NAME));
  },
  createMessage,
  createAiMessageIfWaiting,
  markTicketAiHandoff,
  findTicketByAccessTokenHash: async (ticketId, accessTokenHash) => {
    const result = await pool.query(
      `SELECT id AS "TICKET_ID", customer_id AS "CUSTOMER_ID"
       FROM tickets
       WHERE id = $1 AND access_token_hash = $2`,
      [ticketId, accessTokenHash]
    );
    const access = normalizeRows(result.rows)[0];
    return access ? { ticketId: access.TICKET_ID, customerId: access.CUSTOMER_ID } : null;
  }
};

