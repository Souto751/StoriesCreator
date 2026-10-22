'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { q, audit } = require('./db');
const S = require('./secure');
const auth = require('./auth');
const { HttpError, readJson, sendJson, sendBuffer } = require('./http');

const FONTS = ['Arial Black', 'Impact', 'Georgia', 'Trebuchet MS', 'Verdana', 'Courier New', 'Tahoma', 'Palatino Linotype', 'system-ui'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-f0-9]{32}$/;
const MAX_DESIGNS_PER_USER = 500;

const DEFAULT_BRAND = {
  name: '', tagline: '', primary: '#e63946', secondary: '#1d3557', accent: '#ffd166', text: '#ffffff',
  font: 'Arial Black', phone: '', instagram: '', address: '', website: '',
};

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/* ---------- Marca ---------- */
function readBrand(userId) {
  const row = q.get('SELECT data, logo_type, logo IS NOT NULL AS has_logo FROM brands WHERE user_id = ?', userId);
  const data = row ? JSON.parse(row.data) : {};
  return { ...DEFAULT_BRAND, ...data, hasLogo: Boolean(row && row.has_logo) };
}

function getBrand(ctx) {
  sendJson(ctx.res, 200, { brand: readBrand(ctx.user.id), fonts: FONTS });
}

async function putBrand(ctx) {
  const b = await readJson(ctx.req);
  const next = { ...DEFAULT_BRAND };
  for (const key of ['primary', 'secondary', 'accent', 'text']) {
    if (b[key] !== undefined && !HEX.test(b[key])) throw new HttpError(400, `Color inválido: ${key}.`);
    next[key] = b[key] ?? DEFAULT_BRAND[key];
  }
  if (b.font !== undefined && !FONTS.includes(b.font)) throw new HttpError(400, 'Tipografía no permitida.');
  next.font = b.font ?? DEFAULT_BRAND.font;
  next.name = str(b.name, 80);
  next.tagline = str(b.tagline, 120);
  next.phone = str(b.phone, 40);
  next.instagram = str(b.instagram, 60);
  next.address = str(b.address, 120);
  next.website = str(b.website, 120);
  q.run(
    'INSERT INTO brands (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data',
    ctx.user.id, JSON.stringify(next),
  );
  sendJson(ctx.res, 200, { brand: readBrand(ctx.user.id) });
}

function decodeBase64Payload(value, maxBytes, label) {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw || raw.length > Math.ceil(maxBytes * 1.4) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new HttpError(400, `${label} inválido.`);
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > maxBytes) throw new HttpError(413, `${label} demasiado grande.`);
  return buf;
}

async function putLogo(ctx) {
  const body = await readJson(ctx.req, config.MAX_LOGO * 2);
  const buf = decodeBase64Payload(body.data, config.MAX_LOGO, 'Logo');
  let type = null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) type = 'image/png';
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) type = 'image/jpeg';
  if (!type) throw new HttpError(400, 'El logo debe ser PNG o JPG.');
  q.run(
    'INSERT INTO brands (user_id, data, logo, logo_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET logo = excluded.logo, logo_type = excluded.logo_type',
    ctx.user.id, JSON.stringify(readBrandData(ctx.user.id)), buf, type,
  );
  sendJson(ctx.res, 200, { ok: true });
}

function readBrandData(userId) {
  const row = q.get('SELECT data FROM brands WHERE user_id = ?', userId);
  return row ? JSON.parse(row.data) : {};
}

function getLogo(ctx) {
  const row = q.get('SELECT logo, logo_type FROM brands WHERE user_id = ?', ctx.user.id);
  if (!row || !row.logo) throw new HttpError(404, 'Sin logo.');
  sendBuffer(ctx.res, 200, Buffer.from(row.logo), { 'Content-Type': row.logo_type, 'Cache-Control': 'private, no-cache' });
}

function deleteLogo(ctx) {
  q.run('UPDATE brands SET logo = NULL, logo_type = NULL WHERE user_id = ?', ctx.user.id);
  sendJson(ctx.res, 200, { ok: true });
}

/* ---------- Diseños ---------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function validatePng(buf) {
  if (buf.length > config.MAX_PNG) throw new HttpError(413, 'Imagen fuera de tamaño permitido.');
  if (buf.length < 67) throw new HttpError(400, 'La imagen debe ser PNG.');
  if (!buf.subarray(0, 8).equals(PNG_SIG) || buf.subarray(12, 16).toString('latin1') !== 'IHDR') throw new HttpError(400, 'La imagen debe ser PNG.');
  if (buf.readUInt32BE(16) !== config.IMG_W || buf.readUInt32BE(20) !== config.IMG_H) {
    throw new HttpError(400, `La imagen debe medir ${config.IMG_W}×${config.IMG_H} px.`);
  }
  if (!buf.subarray(buf.length - 8).equals(PNG_END)) throw new HttpError(400, 'PNG incompleto.');
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new HttpError(400, 'Diseño inválido.');
  if (!Array.isArray(spec.layers) || spec.layers.length > 200) throw new HttpError(400, 'Capas inválidas.');
  const json = JSON.stringify(spec);
  if (json.length > 4_000_000) throw new HttpError(413, 'El diseño es demasiado grande.');
  return json;
}

function parsePublishAt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  const limit = Date.now() + 2 * 365 * 24 * 3600 * 1000;
  if (!Number.isInteger(n) || n < 0 || n > limit) throw new HttpError(400, 'Fecha de publicación inválida.');
  return n;
}

const imagePath = (id) => path.join(config.IMAGES, `${id}.png`);
const publicRow = (r) => ({
  id: r.id, title: r.title, caption: r.caption, status: r.status, publish_at: r.publish_at,
  bytes: r.bytes, note: r.note, created_at: r.created_at, updated_at: r.updated_at,
});

function ownDesign(ctx) {
  const id = ctx.params.id;
  if (!ID.test(id)) throw new HttpError(404, 'No encontrado.');
  const row = q.get('SELECT * FROM designs WHERE id = ? AND user_id = ?', id, ctx.user.id);
  if (!row) throw new HttpError(404, 'No encontrado.');
  return row;
}

function listDesigns(ctx) {
  const rows = q.all('SELECT * FROM designs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200', ctx.user.id);
  sendJson(ctx.res, 200, { designs: rows.map(publicRow) });
}

function getDesign(ctx) {
  const row = ownDesign(ctx);
  sendJson(ctx.res, 200, { design: { ...publicRow(row), spec: JSON.parse(row.spec) } });
}

async function saveDesign(ctx, existing) {
  const b = await readJson(ctx.req, config.MAX_DESIGN_BODY);
  const title = str(b.title, 120);
  if (!title) throw new HttpError(400, 'Poné un título.');
  const caption = String(b.caption ?? (existing ? existing.caption : '')).replace(/\u0000/g, '').slice(0, 2200);
  const specJson = validateSpec(b.spec);
  const publishAt = parsePublishAt(b.publish_at);
  const status = b.send ? 'ready' : 'draft';
  const now = Date.now();

  let png = null;
  if (b.image !== undefined || !existing) {
    png = decodeBase64Payload(b.image, config.MAX_PNG, 'Imagen');
    validatePng(png);
  }
  if (b.send && !png && !existing) throw new HttpError(400, 'Falta la imagen.');

  if (!existing) {
    const count = q.get('SELECT COUNT(*) AS n FROM designs WHERE user_id = ?', ctx.user.id).n;
    if (count >= MAX_DESIGNS_PER_USER) throw new HttpError(409, 'Llegaste al máximo de imágenes guardadas.');
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(imagePath(id), png, { mode: 0o600 });
    q.run(
      'INSERT INTO designs (id, user_id, title, caption, status, publish_at, spec, bytes, sha256, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, ctx.user.id, title, caption, status, publishAt, specJson, png.length, S.sha256(png), now, now,
    );
    audit('design_created', { userId: ctx.user.id, ip: ctx.ip, detail: id });
    return sendJson(ctx.res, 201, { design: publicRow(q.get('SELECT * FROM designs WHERE id = ?', id)) });
  }

  if (['processing', 'published'].includes(existing.status)) throw new HttpError(409, 'Esta imagen ya fue tomada por el bot y no se puede editar. Duplicala para crear otra.');
  if (png) fs.writeFileSync(imagePath(existing.id), png, { mode: 0o600 });
  q.run(
    'UPDATE designs SET title=?, caption=?, status=?, publish_at=?, spec=?, bytes=?, sha256=?, note=NULL, updated_at=? WHERE id=?',
    title, caption, status, publishAt, specJson, png ? png.length : existing.bytes, png ? S.sha256(png) : existing.sha256, now, existing.id,
  );
  audit('design_updated', { userId: ctx.user.id, ip: ctx.ip, detail: existing.id });
  sendJson(ctx.res, 200, { design: publicRow(q.get('SELECT * FROM designs WHERE id = ?', existing.id)) });
}

const createDesign = (ctx) => saveDesign(ctx, null);
const updateDesign = (ctx) => saveDesign(ctx, ownDesign(ctx));

function designImage(ctx) {
  const row = ownDesign(ctx);
  let data;
  try { data = fs.readFileSync(imagePath(row.id)); } catch { throw new HttpError(404, 'Imagen no encontrada.'); }
  sendBuffer(ctx.res, 200, data, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache', 'Content-Disposition': 'inline; filename="story.png"' });
}

async function setDesignState(ctx) {
  const row = ownDesign(ctx);
  const body = await readJson(ctx.req);
  const action = body.action;
  const stale = Date.now() - row.updated_at > 30 * 60 * 1000;
  if (action === 'send' && ['draft', 'failed'].includes(row.status)) {
    q.run("UPDATE designs SET status='ready', publish_at=?, note=NULL, updated_at=? WHERE id=?", parsePublishAt(body.publish_at ?? row.publish_at), Date.now(), row.id);
  } else if (action === 'cancel' && row.status === 'ready') {
    q.run("UPDATE designs SET status='draft', updated_at=? WHERE id=?", Date.now(), row.id);
  } else if (action === 'retry' && (row.status === 'failed' || (row.status === 'processing' && stale))) {
    q.run("UPDATE designs SET status='ready', note=NULL, updated_at=? WHERE id=?", Date.now(), row.id);
  } else {
    throw new HttpError(409, 'Acción no permitida en el estado actual.');
  }
  audit('design_state', { userId: ctx.user.id, ip: ctx.ip, detail: `${row.id}:${action}` });
  sendJson(ctx.res, 200, { design: publicRow(q.get('SELECT * FROM designs WHERE id = ?', row.id)) });
}

function deleteDesign(ctx) {
  const row = ownDesign(ctx);
  if (row.status === 'processing') throw new HttpError(409, 'El bot la está procesando ahora.');
  q.run('DELETE FROM designs WHERE id = ?', row.id);
  try { fs.unlinkSync(imagePath(row.id)); } catch { /* ya no existe */ }
  audit('design_deleted', { userId: ctx.user.id, ip: ctx.ip, detail: row.id });
  sendJson(ctx.res, 200, { ok: true });
}

/* ---------- API para el bot ---------- */
function botList(ctx) {
  const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit')) || 20, 1), 100);
  const dueOnly = ctx.url.searchParams.get('due') !== '0';
  const now = Date.now();
  const rows = q.all(
    `SELECT * FROM designs WHERE status = 'ready' ${dueOnly ? 'AND (publish_at IS NULL OR publish_at <= ?)' : 'AND ? IS NOT NULL'}
     ORDER BY COALESCE(publish_at, created_at) ASC LIMIT ?`,
    now, limit,
  );
  sendJson(ctx.res, 200, {
    images: rows.map((r) => ({
      id: r.id, title: r.title, caption: r.caption, publish_at: r.publish_at, created_at: r.created_at,
      bytes: r.bytes, sha256: r.sha256, width: config.IMG_W, height: config.IMG_H,
      file: `/api/bot/images/${r.id}/file`,
    })),
  });
}

function botDesign(ctx) {
  if (!ID.test(ctx.params.id)) throw new HttpError(404, 'No encontrado.');
  const row = q.get('SELECT * FROM designs WHERE id = ?', ctx.params.id);
  if (!row) throw new HttpError(404, 'No encontrado.');
  return row;
}

function botFile(ctx) {
  const row = botDesign(ctx);
  if (!['ready', 'processing'].includes(row.status)) throw new HttpError(409, 'La imagen no está disponible para el bot.');
  let data;
  try { data = fs.readFileSync(imagePath(row.id)); } catch { throw new HttpError(404, 'Imagen no encontrada.'); }
  sendBuffer(ctx.res, 200, data, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-SHA256': row.sha256 || '' });
}

// Reserva atómica: solo una instancia del bot puede tomar cada imagen.
function botClaim(ctx) {
  const row = botDesign(ctx);
  const res = q.run("UPDATE designs SET status='processing', updated_at=? WHERE id=? AND status='ready'", Date.now(), row.id);
  if (res.changes !== 1) throw new HttpError(409, 'La imagen ya fue reservada o no está lista.');
  audit('bot_claim', { detail: row.id });
  sendJson(ctx.res, 200, { ok: true });
}

async function botStatus(ctx) {
  const row = botDesign(ctx);
  const body = await readJson(ctx.req);
  if (!['published', 'failed'].includes(body.status)) throw new HttpError(400, 'Estado inválido (published o failed).');
  if (row.status !== 'processing') throw new HttpError(409, 'Primero reservá la imagen con /claim.');
  q.run('UPDATE designs SET status=?, note=?, updated_at=? WHERE id=?', body.status, str(body.note, 500) || null, Date.now(), row.id);
  audit('bot_status', { detail: `${row.id}:${body.status}` });
  sendJson(ctx.res, 200, { ok: true });
}

/* ---------- Tabla de rutas ---------- */
const A = auth.routes;
/* ---------- Carpetas de imágenes: pie de página ("footer") y encabezado ("header") ---------- */
const LIB_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const LIB_NAME = /^[\w\-. ()]{1,120}$/;
const MAX_LIB_FILE = 6 * 1024 * 1024;

function libraryHandlers(getDir, allowed) {
  const names = () => {
    let list = [];
    try { list = fs.readdirSync(getDir()); } catch { return []; }
    return list.filter((n) => LIB_NAME.test(n) && !n.includes('..') && allowed.includes(path.extname(n).toLowerCase())).sort().slice(0, 500);
  };
  return {
    list(ctx) { sendJson(ctx.res, 200, { images: names() }); },
    file(ctx) {
      let name;
      try { name = decodeURIComponent(ctx.params.name || ''); } catch { throw new HttpError(404, 'No encontrado.'); }
      if (!names().includes(name)) throw new HttpError(404, 'No encontrado.');
      let data;
      try {
        const full = path.join(getDir(), name);
        if (fs.statSync(full).size > MAX_LIB_FILE) throw new Error('grande');
        data = fs.readFileSync(full);
      } catch { throw new HttpError(404, 'No encontrado.'); }
      sendBuffer(ctx.res, 200, data, { 'Content-Type': LIB_TYPES[path.extname(name).toLowerCase()], 'Cache-Control': 'private, max-age=300' });
    },
  };
}
const footerLib = libraryHandlers(() => config.FOOTER, ['.png']);
const headerLib = libraryHandlers(() => config.HEADER, ['.png', '.jpg', '.jpeg', '.webp']);

const routes = [
  { method: 'GET', re: /^\/healthz$/, auth: 'public', handler: (c) => sendJson(c.res, 200, { ok: true }) },
  { method: 'GET', re: /^\/api\/session$/, auth: 'optional', handler: A.sessionInfo },
  { method: 'POST', re: /^\/api\/login$/, auth: 'public', handler: A.login },
  { method: 'POST', re: /^\/api\/logout$/, auth: 'optional', handler: A.logout },
  { method: 'POST', re: /^\/api\/login\/2fa$/, auth: 'stage', stages: ['2fa'], handler: A.login2fa },
  { method: 'GET', re: /^\/api\/2fa\/setup$/, auth: 'stage', stages: ['setup2fa'], handler: A.setup2faInfo },
  { method: 'POST', re: /^\/api\/2fa\/enable$/, auth: 'stage', stages: ['setup2fa'], handler: A.enable2fa },

  { method: 'POST', re: /^\/api\/account\/password$/, auth: 'user', handler: A.changePassword },
  { method: 'GET', re: /^\/api\/account\/sessions$/, auth: 'user', handler: A.listSessions },
  { method: 'POST', re: /^\/api\/account\/logout-others$/, auth: 'user', handler: A.logoutOthers },

  { method: 'GET', re: /^\/api\/brand$/, auth: 'user', handler: getBrand },
  { method: 'PUT', re: /^\/api\/brand$/, auth: 'user', handler: putBrand },
  { method: 'PUT', re: /^\/api\/brand\/logo$/, auth: 'user', handler: putLogo },
  { method: 'GET', re: /^\/api\/brand\/logo$/, auth: 'user', handler: getLogo },
  { method: 'DELETE', re: /^\/api\/brand\/logo$/, auth: 'user', handler: deleteLogo },

  { method: 'GET', re: /^\/api\/designs$/, auth: 'user', handler: listDesigns },
  { method: 'POST', re: /^\/api\/designs$/, auth: 'user', handler: createDesign },
  { method: 'GET', re: /^\/api\/designs\/(?<id>[^/]+)$/, auth: 'user', handler: getDesign },
  { method: 'PUT', re: /^\/api\/designs\/(?<id>[^/]+)$/, auth: 'user', handler: updateDesign },
  { method: 'DELETE', re: /^\/api\/designs\/(?<id>[^/]+)$/, auth: 'user', handler: deleteDesign },
  { method: 'GET', re: /^\/api\/designs\/(?<id>[^/]+)\/image$/, auth: 'user', handler: designImage },
  { method: 'POST', re: /^\/api\/designs\/(?<id>[^/]+)\/state$/, auth: 'user', handler: setDesignState },

  { method: 'GET', re: /^\/api\/footer-images$/, auth: 'user', handler: footerLib.list },
  { method: 'GET', re: /^\/api\/footer-images\/(?<name>[^/]+)$/, auth: 'user', handler: footerLib.file },

  { method: 'GET', re: /^\/api\/header-images$/, auth: 'user', handler: headerLib.list },
  { method: 'GET', re: /^\/api\/header-images\/(?<name>[^/]+)$/, auth: 'user', handler: headerLib.file },

  { method: 'GET', re: /^\/api\/bot\/images$/, auth: 'bot', handler: botList },
  { method: 'GET', re: /^\/api\/bot\/images\/(?<id>[^/]+)\/file$/, auth: 'bot', handler: botFile },
  { method: 'POST', re: /^\/api\/bot\/images\/(?<id>[^/]+)\/claim$/, auth: 'bot', handler: botClaim },
  { method: 'POST', re: /^\/api\/bot\/images\/(?<id>[^/]+)\/status$/, auth: 'bot', handler: botStatus },
];

module.exports = { routes };
