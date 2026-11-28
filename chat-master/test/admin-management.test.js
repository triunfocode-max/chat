const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const store = require('../config/memory-store');

test('creates departments and agents with a single department assignment', async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const departmentName = `Setor de teste ${suffix}`;
  const createdDepartment = store.createDepartment(departmentName);

  assert.equal(createdDepartment.created, true);
  assert.equal(store.createDepartment(departmentName.toUpperCase()).created, false);

  const email = `atendente-${suffix}@example.test`;
  const agent = store.createAgent({
    name: 'Atendente de teste',
    email,
    password: 'senha-forte-de-teste',
    departmentId: createdDepartment.department.id
  });
  const storedAgent = await store.findAgentByEmail(email);

  assert.equal(agent.NAME, 'Atendente de teste');
  assert.equal(agent.DEPARTMENT_ID, createdDepartment.department.id);
  assert.equal(storedAgent.DEPARTMENT_ID, createdDepartment.department.id);
  assert.equal(await bcrypt.compare('senha-forte-de-teste', storedAgent.PASSWORD_HASH), true);
  assert.equal(store.createAgent({
    name: 'E-mail duplicado',
    email: email.toUpperCase(),
    password: 'outra-senha-forte',
    departmentId: createdDepartment.department.id
  }), null);
});
