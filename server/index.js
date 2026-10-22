'use strict';
const http = require('node:http');
const config = require('./config');
const { q } = require('./db');
const S = require('./secure');
const auth = require('./auth');
const { routes } = require('./api');
const { HttpError, securityHeaders, clientIp, sendJson, serveStatic } = require('./http');

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Origen no permitido.'); }
    if (host !== req.headers.host) throw new HttpError(403, 'Origen no permitido.');
  } else if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new HttpError(403, 'Origen no permitido.');
  }
}

async function handle(req, res) {
  securityHeaders(res);
  const ctx = { req, res, ip: clientIp(req), url: new URL(req.url, 'http://localhost'), params: {}, session: null, user: null };
  const { pathname } = ctx.url;

  if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
    return serveStatic(req, res, pathname);
  }

  let route = null;
  let methodMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    methodMatched = true;
    if (r.method === req.method) { route = r; ctx.params = m.groups || {}; break; }
  }
  if (!route) throw new HttpError(methodMatched ? 405 : 404, methodMatched ? 'Método no permitido.' : 'No encontrado.');

  if (route.auth === 'bot') {
    const token = auth.authBot(req);
    if (!token) throw new HttpError(401, 'Token inválido.');
    return route.handler(ctx);
  }

  if (UNSAFE.has(req.method)) checkOrigin(req);
  ctx.session = auth.loadSession(req);

  if (route.auth === 'public' || route.auth === 'optional') {
    if (UNSAFE.has(req.method) && route.auth === 'optional' && ctx.session) requireCsrf(ctx);
    return route.handler(ctx);
  }

  if (!ctx.session) throw new HttpError(401, 'Sesión requerida.');
  if (route.auth === 'stage' && !route.stages.includes(ctx.session.stage)) throw new HttpError(403, 'Paso de autenticación incorrecto.');
  if (route.auth === 'user' && ctx.session.stage !== 'active') throw new HttpError(403, 'Completá la verificación en dos pasos.');
  if (UNSAFE.has(req.method)) requireCsrf(ctx);
  ctx.user = { id: ctx.session.user_id, username: ctx.session.username };
  return route.handler(ctx);
}

function requireCsrf(ctx) {
  const sent = String(ctx.req.headers['x-csrf-token'] || '');
  if (!sent || !S.safeEqual(sent, ctx.session.csrf)) throw new HttpError(403, 'Token CSRF inválido.');
}

function createServer() {
  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((err) => {
        if (res.headersSent) return res.destroy();
        if (err instanceof HttpError) {
          const headers = err.extra.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : {};
          return sendJson(res, err.status, { error: err.message, ...err.extra }, headers);
        }
        console.error('[error]', err);
        sendJson(res, 500, { error: 'Error interno.' });
      });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.timers = [setInterval(() => auth.purgeExpiredSessions(), 10 * 60_000)];
  server.timers.forEach((t) => t.unref());
  return server;
}

if (require.main === module) {
  process.removeAllListeners('warning');
  const users = q.get('SELECT COUNT(*) AS n FROM users').n;
  const server = createServer();
  server.listen(config.PORT, config.HOST, () => {
    console.log(`StoriesCreator escuchando en http://${config.HOST}:${config.PORT}`);
    if (!config.SECURE) console.log('AVISO: cookies sin flag Secure. En producción usá HTTPS y COOKIE_SECURE=1.');
    if (users === 0) console.log('No hay usuarios. Creá uno con: node server/cli.js user:add <nombre>');
  });
}

module.exports = { createServer };
