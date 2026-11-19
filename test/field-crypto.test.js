const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const {
  createBlindIndex,
  decryptField,
  encryptField
} = require('../config/field-crypto');

test('encrypts and decrypts strings without storing their plaintext', () => {
  const plaintext = 'mensagem confidencial';
  const encrypted = encryptField(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(decryptField(encrypted), plaintext);
  assert.equal(encryptField(encrypted), encrypted);
});

test('uses a fresh nonce and detects tampered ciphertext', () => {
  const first = encryptField('dados privados');
  const second = encryptField('dados privados');

  assert.notEqual(first, second);

  const parts = first.split(':');
  parts[4] = Buffer.from('alterado').toString('base64');
  assert.throws(() => decryptField(parts.join(':')), /descriptografar/);
});

test('leaves legacy plaintext and null values readable during migration', () => {
  assert.equal(decryptField('registro antigo'), 'registro antigo');
  assert.equal(encryptField(null), null);
});

test('creates stable, scoped blind indexes', () => {
  assert.equal(createBlindIndex('email', 'Pessoa@Exemplo.com'), createBlindIndex('email', ' pessoa@exemplo.com '));
  assert.notEqual(createBlindIndex('email', 'pessoa@exemplo.com'), createBlindIndex('phone', 'pessoa@exemplo.com'));
});

