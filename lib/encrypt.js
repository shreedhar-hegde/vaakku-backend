import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;
const SALT = 'vaakku-sarvam-key';
const KEY_LEN = 32;

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET required in production');
  }
  return crypto.scryptSync(secret || 'dev-encryption-key', SALT, KEY_LEN);
}

export function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

export function decrypt(encrypted) {
  if (!encrypted) return null;
  try {
    const key = getKey();
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const data = buf.subarray(IV_LEN + AUTH_TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(data) + decipher.final('utf8');
  } catch (err) {
    return null;
  }
}
