const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getAvailablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => (
    error ? reject(error) : resolve()
  )));
  return port;
}

test('customer HTTP fallback loads history and safely deduplicates messages without Socket.IO', async (context) => {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      STORAGE: 'memory',
      HOST: '127.0.0.1',
      PORT: String(port),
      GEMINI_API_KEY: ''
    },
    stdio: 'ignore'
  });
  context.after(async () => {
    if (server.exitCode !== null) return;
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  });

  let ready = false;
  let connectionError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error('Test server exited before becoming ready.');
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      connectionError = error;
    }
    await delay(100);
  }
  assert.equal(ready, true, `test server did not become ready: ${connectionError?.message || 'no health response'}`);

  const registrationResponse = await fetch(`${baseUrl}/api/customers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Teste offline',
      roleJob: 'Validação',
      phone: `55${Date.now()}`,
      departmentId: 1
    })
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const ticketId = registration.ticket.id;
  const headers = { 'X-Ticket-Token': registration.ticket.accessToken };

  const emptyHistory = await fetch(`${baseUrl}/api/tickets/${ticketId}/customer-messages`, { headers });
  assert.equal(emptyHistory.status, 200);
  assert.deepEqual((await emptyHistory.json()).messages, []);

  const request = {
    text: 'Mensagem enviada sem conexão em tempo real.',
    tempId: 'offline-fallback-test'
  };
  const firstResponse = await fetch(`${baseUrl}/api/tickets/${ticketId}/customer-messages`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  assert.equal(firstResponse.status, 201);
  const firstMessage = await firstResponse.json();

  const duplicateResponse = await fetch(`${baseUrl}/api/tickets/${ticketId}/customer-messages`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).id, firstMessage.id);

  const historyResponse = await fetch(`${baseUrl}/api/tickets/${ticketId}/customer-messages`, { headers });
  const history = await historyResponse.json();
  assert.equal(historyResponse.status, 200);
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].messageText, request.text);

  const deniedResponse = await fetch(`${baseUrl}/api/tickets/${ticketId}/customer-messages`, {
    headers: { 'X-Ticket-Token': 'invalid-token' }
  });
  assert.equal(deniedResponse.status, 403);
});
