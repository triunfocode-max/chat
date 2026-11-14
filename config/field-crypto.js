const {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes
} = require('crypto');

const ENCRYPTED_FIELD_PREFIX = 'enc:v1:';
let encryptionKey;
let blindIndexKey;

function getEncryptionKey() {
  if (encryptionKey) {
    return encryptionKey;
  }

  const encodedKey = process.env.DATA_ENCRYPTION_KEY;
  const key = Buffer.from(encodedKey || '', 'base64');

  if (
    key.length !== 32
    || key.toString('base64') !== encodedKey
  ) {
    throw new Error('DATA_ENCRYPTION_KEY deve ser uma chave Base64 válida de 32 bytes.');
  }

  encryptionKey = key;
  return encryptionKey;
}

function encryptField(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const plaintext = String(value);
  if (plaintext.startsWith(ENCRYPTED_FIELD_PREFIX)) {
    decryptField(plaintext);
    return plaintext;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'enc',
    'v1',
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64')
  ].join(':');
}

function decryptField(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const encryptedValue = String(value);
  if (!encryptedValue.startsWith(ENCRYPTED_FIELD_PREFIX)) {
    return encryptedValue;
  }

  const parts = encryptedValue.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Formato de dado criptografado inválido.');
  }

  try {
    const iv = Buffer.from(parts[2], 'base64');
    const authTag = Buffer.from(parts[3], 'base64');
    const ciphertext = Buffer.from(parts[4], 'base64');
    if (iv.length !== 12 || authTag.length !== 16) {
      throw new Error('Parâmetros criptográficos inválidos.');
    }

    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Não foi possível descriptografar os dados. Verifique a chave de criptografia.');
  }
}

function createBlindIndex(namespace, value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (!blindIndexKey) {
    blindIndexKey = Buffer.from(hkdfSync(
      'sha256',
      getEncryptionKey(),
      Buffer.from('multi-atendimento-field-crypto-v1'),
      Buffer.from('blind-index'),
      32
    ));
  }
  return createHmac('sha256', blindIndexKey)
    .update(`${namespace}\0${normalizedValue}`, 'utf8')
    .digest('hex');
}

module.exports = {
  createBlindIndex,
  decryptField,
  encryptField
};
