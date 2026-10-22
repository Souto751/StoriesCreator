'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* ---------- Contraseñas (scrypt) ---------- */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Hash de relleno para que el tiempo de respuesta no revele si el usuario existe.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ||= hashPassword(randomToken(16)));

function checkPasswordPolicy(password, username = '') {
  if (typeof password !== 'string') return 'Contraseña inválida.';
  if (password.length < config.MIN_PASSWORD) return `La contraseña debe tener al menos ${config.MIN_PASSWORD} caracteres.`;
  if (password.length > 128) return 'La contraseña es demasiado larga (máximo 128).';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'La contraseña no puede contener el nombre de usuario.';
  if (/^(.)\1+$/.test(password)) return 'La contraseña es demasiado simple.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Usá al menos 3 tipos de caracteres: minúsculas, mayúsculas, números y símbolos.';
  return null;
}

/* ---------- Cifrado de secretos en reposo (AES-256-GCM) ---------- */
function loadKey() {
  const keyPath = path.join(config.DATA, 'secret.key');
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
}
const KEY = loadKey();

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptSecret(blob) {
  const raw = Buffer.from(blob, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/* ---------- TOTP (RFC 6238) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// Devuelve el paso (time step) válido o null. Acepta ±1 paso de desfase de reloj.
function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const current = Math.floor(now / 30000);
  for (const delta of [0, -1, 1]) {
    if (safeEqual(totpAt(secret, current + delta), String(code))) return current + delta;
  }
  return null;
}

const otpauthUri = (secret, account) =>
  `otpauth://totp/StoriesCreator:${encodeURIComponent(account)}?secret=${secret}&issuer=StoriesCreator&algorithm=SHA1&digits=6&period=30`;

/* ---------- Códigos de recuperación ---------- */
function generateRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
const hashRecovery = (code) => sha256(String(code).trim().toLowerCase());

/* ---------- Límite de intentos en memoria ---------- */
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
  // Cuenta un intento; devuelve { ok, retryAfter } en segundos.
  hit(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) entry = { count: 0, reset: now + this.windowMs };
    entry.count += 1;
    this.hits.set(key, entry);
    return { ok: entry.count <= this.max, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  clear(key) { this.hits.delete(key); }
}

module.exports = {
  randomToken, sha256, safeEqual,
  hashPassword, verifyPassword, dummyHash, checkPasswordPolicy,
  encryptSecret, decryptSecret,
  newTotpSecret, verifyTotp, totpAt, otpauthUri, base32Decode,
  generateRecoveryCodes, hashRecovery,
  Limiter,
};
