'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (config.SECURE) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

function clientIp(req) {
  if (config.TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie malformada: se ignora */ }
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(new HttpError(413, 'El contenido es demasiado grande.'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'El contenido es demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = config.MAX_JSON) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Se esperaba application/json.');
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendBuffer(res, status, buffer, headers = {}) {
  res.writeHead(status, { 'Content-Length': buffer.length, ...headers });
  res.end(buffer);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Ruta inválida.'); }
  if (rel.includes('\0')) throw new HttpError(400, 'Ruta inválida.');
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(config.PUBLIC, '.' + rel);
  if (!full.startsWith(config.PUBLIC + path.sep)) throw new HttpError(404, 'No encontrado.');
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext]) throw new HttpError(404, 'No encontrado.');
  let stat;
  try { stat = fs.statSync(full); } catch { throw new HttpError(404, 'No encontrado.'); }
  if (!stat.isFile()) throw new HttpError(404, 'No encontrado.');
  const data = fs.readFileSync(full);
  sendBuffer(res, 200, data, {
    'Content-Type': MIME[ext],
    'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache, must-revalidate',
  });
}

module.exports = { HttpError, securityHeaders, clientIp, parseCookies, readBody, readJson, sendJson, sendBuffer, serveStatic };
