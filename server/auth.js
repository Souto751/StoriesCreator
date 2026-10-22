'use strict';
const config = require('./config');
const { q, audit } = require('./db');
const S = require('./secure');
const { HttpError, parseCookies, readJson, sendJson } = require('./http');

const COOKIE = config.SECURE ? '__Host-sid' : 'sid';

const loginIpLimiter = new S.Limiter(20, 10 * 60 * 1000);
const loginUserLimiter = new S.Limiter(10, 15 * 60 * 1000);

/* ---------- Sesiones ---------- */
function setCookie(res, value, maxAgeSec) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function createSession(ctx, userId, stage) {
  const token = S.randomToken(32);
  const now = Date.now();
  const ttl = stage === 'active' ? config.SESSION_MAX_MS : config.PENDING_MS;
  q.run(
    'INSERT INTO sessions (id_hash, user_id, stage, csrf, created_at, last_seen, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?,?,?)',
    S.sha256(token), userId, stage, S.randomToken(24), now, now, now + ttl, ctx.ip,
    String(ctx.req.headers['user-agent'] || '').slice(0, 200),
  );
  setCookie(ctx.res, token, Math.floor(ttl / 1000));
}

function destroySession(idHash) {
  q.run('DELETE FROM sessions WHERE id_hash = ?', idHash);
}

// Cambia el id de sesión (rotación) al subir de nivel, para evitar fijación de sesión.
function rotateSession(ctx, stage) {
  const old = ctx.session;
  destroySession(old.id_hash);
  createSession(ctx, old.user_id, stage);
}

function loadSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return null;
  const idHash = S.sha256(token);
  const row = q.get('SELECT s.*, u.username, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?', idHash);
  if (!row) return null;
  const now = Date.now();
  const idle = now - row.last_seen > config.SESSION_IDLE_MS;
  if (row.expires_at <= now || row.disabled || (row.stage === 'active' && idle)) {
    destroySession(idHash);
    return null;
  }
  if (now - row.last_seen > 60_000) q.run('UPDATE sessions SET last_seen = ? WHERE id_hash = ?', now, idHash);
  return row;
}

function purgeExpiredSessions() {
  q.run('DELETE FROM sessions WHERE expires_at <= ? OR (stage = ? AND last_seen <= ?)', Date.now(), 'active', Date.now() - config.SESSION_IDLE_MS);
}

/* ---------- Bot (token Bearer) ---------- */
const botLimiter = new S.Limiter(240, 60 * 1000);

function authBot(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer (sc_[A-Za-z0-9_-]{20,80})$/.exec(header);
  if (!match) return null;
  const row = q.get('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0', S.sha256(match[1]));
  if (!row) return null;
  if (!botLimiter.hit(`bot:${row.id}`).ok) throw new HttpError(429, 'Demasiadas solicitudes.');
  q.run('UPDATE api_tokens SET last_used = ? WHERE id = ?', Date.now(), row.id);
  return row;
}

/* ---------- Rutas de autenticación ---------- */
const cleanName = (v) => String(v || '').trim().slice(0, 64);
const GENERIC_FAIL = 'Usuario o contraseña incorrectos.';

async function login(ctx) {
  const ipCheck = loginIpLimiter.hit(`ip:${ctx.ip}`);
  if (!ipCheck.ok) throw new HttpError(429, 'Demasiados intentos. Probá más tarde.', { retryAfter: ipCheck.retryAfter });

  const body = await readJson(ctx.req);
  const username = cleanName(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || password.length > 256) throw new HttpError(400, 'Ingresá usuario y contraseña.');

  const nameCheck = loginUserLimiter.hit(`u:${username.toLowerCase()}`);
  if (!nameCheck.ok) throw new HttpError(429, 'Demasiados intentos. Probá más tarde.', { retryAfter: nameCheck.retryAfter });

  const user = q.get('SELECT * FROM users WHERE username = ?', username);
  const now = Date.now();
  if (user && user.locked_until > now) {
    audit('login_locked', { userId: user.id, ip: ctx.ip });
    throw new HttpError(429, 'Cuenta bloqueada temporalmente por intentos fallidos.', { retryAfter: Math.ceil((user.locked_until - now) / 1000) });
  }

  const ok = await S.verifyPassword(password, user ? user.pass_hash : await S.dummyHash());
  if (!user || !ok || user.disabled) {
    if (user) {
      const failed = user.failed + 1;
      // Bloqueo creciente: desde el 5.º fallo, 1 min × 2^(n-5), máximo 1 hora.
      const lock = failed >= 5 ? now + Math.min(60 * 60_000, 60_000 * 2 ** (failed - 5)) : 0;
      q.run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', failed, lock, user.id);
    }
    audit('login_fail', { userId: user?.id ?? null, ip: ctx.ip, detail: username.slice(0, 64) });
    throw new HttpError(401, GENERIC_FAIL);
  }

  q.run('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?', user.id);
  loginUserLimiter.clear(`u:${username.toLowerCase()}`);
  const stage = user.totp_enabled ? '2fa' : 'setup2fa';
  createSession(ctx, user.id, stage);
  audit('login_password_ok', { userId: user.id, ip: ctx.ip });
  sendJson(ctx.res, 200, { stage });
}

async function login2fa(ctx) {
  const body = await readJson(ctx.req);
  const code = String(body.code || '').trim();
  const user = q.get('SELECT * FROM users WHERE id = ?', ctx.session.user_id);

  const attempts = ctx.session.attempts + 1;
  if (attempts > 5) {
    destroySession(ctx.session.id_hash);
    audit('2fa_locked', { userId: user.id, ip: ctx.ip });
    throw new HttpError(429, 'Demasiados intentos. Volvé a iniciar sesión.');
  }
  q.run('UPDATE sessions SET attempts = ? WHERE id_hash = ?', attempts, ctx.session.id_hash);

  let valid = false;
  const secret = S.decryptSecret(user.totp_secret);
  const step = S.verifyTotp(secret, code);
  if (step !== null && step > user.totp_last_step) {
    q.run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id); // evita reutilizar el mismo código
    valid = true;
  } else if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(code)) {
    const hashes = JSON.parse(user.recovery);
    const h = S.hashRecovery(code);
    const idx = hashes.indexOf(h);
    if (idx >= 0) {
      hashes.splice(idx, 1);
      q.run('UPDATE users SET recovery = ? WHERE id = ?', JSON.stringify(hashes), user.id);
      audit('recovery_code_used', { userId: user.id, ip: ctx.ip });
      valid = true;
    }
  }
  if (!valid) {
    audit('2fa_fail', { userId: user.id, ip: ctx.ip });
    throw new HttpError(401, 'Código incorrecto.');
  }
  rotateSession(ctx, 'active');
  audit('login_ok', { userId: user.id, ip: ctx.ip });
  sendJson(ctx.res, 200, { stage: 'active' });
}

function setup2faInfo(ctx) {
  const user = q.get('SELECT * FROM users WHERE id = ?', ctx.session.user_id);
  let secret;
  if (user.totp_secret && !user.totp_enabled) {
    secret = S.decryptSecret(user.totp_secret);
  } else {
    secret = S.newTotpSecret();
    q.run('UPDATE users SET totp_secret = ? WHERE id = ?', S.encryptSecret(secret), user.id);
  }
  sendJson(ctx.res, 200, { secret, uri: S.otpauthUri(secret, user.username) });
}

async function enable2fa(ctx) {
  const body = await readJson(ctx.req);
  const user = q.get('SELECT * FROM users WHERE id = ?', ctx.session.user_id);
  if (!user.totp_secret || user.totp_enabled) throw new HttpError(409, 'No hay una configuración pendiente.');
  const attempts = ctx.session.attempts + 1;
  if (attempts > 8) {
    destroySession(ctx.session.id_hash);
    throw new HttpError(429, 'Demasiados intentos. Volvé a iniciar sesión.');
  }
  q.run('UPDATE sessions SET attempts = ? WHERE id_hash = ?', attempts, ctx.session.id_hash);
  const step = S.verifyTotp(S.decryptSecret(user.totp_secret), String(body.code || '').trim());
  if (step === null) throw new HttpError(401, 'Código incorrecto. Revisá la hora de tu teléfono.');
  const codes = S.generateRecoveryCodes(8);
  q.run('UPDATE users SET totp_enabled = 1, totp_last_step = ?, recovery = ? WHERE id = ?',
    step, JSON.stringify(codes.map(S.hashRecovery)), user.id);
  rotateSession(ctx, 'active');
  audit('2fa_enabled', { userId: user.id, ip: ctx.ip });
  sendJson(ctx.res, 200, { stage: 'active', recoveryCodes: codes });
}

function sessionInfo(ctx) {
  if (!ctx.session) return sendJson(ctx.res, 200, { stage: 'anon' });
  sendJson(ctx.res, 200, {
    stage: ctx.session.stage,
    csrf: ctx.session.csrf,
    user: { id: ctx.session.user_id, username: ctx.session.username },
  });
}

function logout(ctx) {
  if (ctx.session) {
    destroySession(ctx.session.id_hash);
    audit('logout', { userId: ctx.session.user_id, ip: ctx.ip });
  }
  setCookie(ctx.res, '', 0);
  sendJson(ctx.res, 200, { ok: true });
}

async function changePassword(ctx) {
  const body = await readJson(ctx.req);
  const user = q.get('SELECT * FROM users WHERE id = ?', ctx.session.user_id);
  const limit = loginUserLimiter.hit(`pw:${user.id}`);
  if (!limit.ok) throw new HttpError(429, 'Demasiados intentos.', { retryAfter: limit.retryAfter });
  if (!(await S.verifyPassword(String(body.current || ''), user.pass_hash))) throw new HttpError(401, 'La contraseña actual es incorrecta.');
  const problem = S.checkPasswordPolicy(body.next, user.username);
  if (problem) throw new HttpError(400, problem);
  if (body.next === body.current) throw new HttpError(400, 'La nueva contraseña debe ser distinta.');
  q.run('UPDATE users SET pass_hash = ? WHERE id = ?', await S.hashPassword(body.next), user.id);
  q.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', user.id, ctx.session.id_hash);
  audit('password_changed', { userId: user.id, ip: ctx.ip });
  sendJson(ctx.res, 200, { ok: true });
}

function listSessions(ctx) {
  const rows = q.all('SELECT id_hash, created_at, last_seen, ip, ua FROM sessions WHERE user_id = ? AND stage = ? ORDER BY last_seen DESC', ctx.session.user_id, 'active');
  sendJson(ctx.res, 200, {
    sessions: rows.map((r) => ({ current: r.id_hash === ctx.session.id_hash, created_at: r.created_at, last_seen: r.last_seen, ip: r.ip, ua: r.ua })),
  });
}

function logoutOthers(ctx) {
  q.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', ctx.session.user_id, ctx.session.id_hash);
  sendJson(ctx.res, 200, { ok: true });
}

module.exports = {
  COOKIE, loadSession, purgeExpiredSessions, authBot,
  routes: { login, login2fa, setup2faInfo, enable2fa, sessionInfo, logout, changePassword, listSessions, logoutOthers },
};
