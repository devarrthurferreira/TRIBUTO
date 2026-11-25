import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password, minimumLength = 12) {
  if (typeof password !== 'string' || password.length < minimumLength || password.length > 128) {
    throw new Error(`Senha deve ter entre ${minimumLength} e 128 caracteres`);
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256 || !stored) return false;
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1') return false;
  const expected = Buffer.from(hashB64 || '', 'base64');
  const salt = Buffer.from(saltB64 || '', 'base64');
  if (expected.length !== 64 || salt.length !== 16) return false;
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

export function newSecret() { return randomBytes(32).toString('hex'); }

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
