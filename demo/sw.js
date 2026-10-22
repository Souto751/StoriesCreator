/* StoriesCreator — demo sin servidor.
 *
 * Este service worker atiende las rutas /api/* que normalmente responde el
 * servidor Node, así la misma interfaz (public/) funciona como sitio estático.
 * Los datos quedan en IndexedDB del navegador del visitante. No hay login ni
 * 2FA: la sesión de demo siempre está activa. Al tocar "Salir" se borran los
 * datos y la demo vuelve a empezar.
 */
'use strict';

const VERSION = 'demo-1';
const DB_NAME = 'storiescreator-demo';
const MAX_DESIGNS = 50;
const IMG_W = 1080;
const IMG_H = 1920;
const BOT_DELAY_MS = 8000; // el "bot" simulado publica las imágenes listas a los 8 s

const FONTS = ['Arial Black', 'Impact', 'Georgia', 'Trebuchet MS', 'Verdana', 'Courier New', 'Tahoma', 'Palatino Linotype', 'system-ui'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_BRAND = {
  name: 'Café Aurora', tagline: 'Recién horneado, todos los días', primary: '#e63946', secondary: '#1d3557', accent: '#ffd166', text: '#ffffff',
  font: 'Arial Black', phone: '+54 9 223 000-0000', instagram: '@cafe.aurora', address: 'Av. Siempreviva 742', website: 'cafeaurora.example',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/* ---------- IndexedDB mínimo ---------- */
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('designs', { keyPath: 'id' });
        req.result.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const kvGet = (key) => tx('kv', 'readonly', (s) => reqP(s.get(key)));
const kvSet = (key, value) => tx('kv', 'readwrite', (s) => { s.put(value, key); });
const blobGet = (key) => tx('blobs', 'readonly', (s) => reqP(s.get(key)));
const blobSet = (key, value) => tx('blobs', 'readwrite', (s) => { s.put(value, key); });
const blobDel = (key) => tx('blobs', 'readwrite', (s) => { s.delete(key); });
const designsAll = () => tx('designs', 'readonly', (s) => reqP(s.getAll()));
const designGet = (id) => tx('designs', 'readonly', (s) => reqP(s.get(id)));
const designPut = (row) => tx('designs', 'readwrite', (s) => { s.put(row); });
const designDel = (id) => tx('designs', 'readwrite', (s) => { s.delete(id); });

async function resetAll() {
  for (const store of ['kv', 'designs', 'blobs']) await tx(store, 'readwrite', (s) => { s.clear(); });
}

/* ---------- Respuestas ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function dataUrlToBlob(value, maxBytes, label) {
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ''));
  if (!m) throw new HttpError(400, `${label} inválido.`);
  const bin = atob(m[2]);
  if (bin.length > maxBytes) throw new HttpError(413, `${label} demasiado grande.`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

function newId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const publicRow = (r) => ({
  id: r.id, title: r.title, caption: r.caption, status: r.status, publish_at: r.publish_at,
  bytes: r.bytes, note: r.note, created_at: r.created_at, updated_at: r.updated_at,
});

function parsePublishAt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Fecha de publicación inválida.');
  return n;
}

async function readBrand() {
  const data = (await kvGet('brand')) || {};
  const logo = await blobGet('logo');
  return { ...DEFAULT_BRAND, ...data, hasLogo: Boolean(logo) };
}

async function ownDesign(id) {
  const row = /^[a-f0-9]{32}$/.test(id) ? await designGet(id) : null;
  if (!row) throw new HttpError(404, 'No encontrado.');
  return row;
}

// Simula al bot: las imágenes "listas" cuya fecha llegó pasan a "publicada".
async function runFakeBot() {
  const now = Date.now();
  for (const row of await designsAll()) {
    if (row.status === 'ready' && (row.publish_at === null || row.publish_at <= now) && now - row.updated_at >= BOT_DELAY_MS) {
      row.status = 'published';
      row.note = null;
      row.updated_at = now;
      await designPut(row);
    }
  }
}

async function saveDesign(body, existing) {
  const title = str(body.title, 120);
  if (!title) throw new HttpError(400, 'Poné un título.');
  if (!body.spec || typeof body.spec !== 'object' || !Array.isArray(body.spec.layers)) throw new HttpError(400, 'Diseño inválido.');
  const caption = String(body.caption ?? (existing ? existing.caption : '')).replace(/\u0000/g, '').slice(0, 2200);
  const publishAt = parsePublishAt(body.publish_at);
  const now = Date.now();

  let png = null;
  if (body.image !== undefined || !existing) {
    png = dataUrlToBlob(body.image, 8 * 1024 * 1024, 'Imagen');
    const size = pngSize(png);
    if (!size) throw new HttpError(400, 'La imagen debe ser PNG.');
    if (size.w !== IMG_W || size.h !== IMG_H) throw new HttpError(400, `La imagen debe medir ${IMG_W}×${IMG_H} px.`);
  }

  if (!existing) {
    if ((await designsAll()).length >= MAX_DESIGNS) throw new HttpError(409, `La demo guarda hasta ${MAX_DESIGNS} imágenes. Borrá alguna para seguir.`);
    const row = { id: newId(), title, caption, status: body.send ? 'ready' : 'draft', publish_at: publishAt, spec: body.spec, bytes: png.length, note: null, created_at: now, updated_at: now };
    await blobSet(`img:${row.id}`, new Blob([png], { type: 'image/png' }));
    await designPut(row);
    return json(201, { design: publicRow(row) });
  }
  if (['processing', 'published'].includes(existing.status)) throw new HttpError(409, 'Esta imagen ya fue tomada por el bot y no se puede editar. Duplicala para crear otra.');
  if (png) await blobSet(`img:${existing.id}`, new Blob([png], { type: 'image/png' }));
  Object.assign(existing, { title, caption, status: body.send ? 'ready' : 'draft', publish_at: publishAt, spec: body.spec, bytes: png ? png.length : existing.bytes, note: null, updated_at: now });
  await designPut(existing);
  return json(200, { design: publicRow(existing) });
}

/* ---------- Bibliotecas de imágenes (header/footer) incluidas en la demo ---------- */
let manifestPromise;
function manifest() {
  if (!manifestPromise) manifestPromise = fetch('/demo-assets/manifest.json').then((r) => r.json()).catch(() => ({ header: [], footer: [] }));
  return manifestPromise;
}
async function libFile(kind, rawName) {
  let name;
  try { name = decodeURIComponent(rawName); } catch { throw new HttpError(404, 'No encontrado.'); }
  const list = (await manifest())[kind] || [];
  if (!list.includes(name)) throw new HttpError(404, 'No encontrado.');
  return fetch(`/demo-assets/${kind}/${encodeURIComponent(name)}`);
}

/* ---------- Rutas ---------- */
const routes = [
  ['GET', /^\/api\/session$/, async () => json(200, { stage: 'active', csrf: 'demo', user: { id: 1, username: 'demo' } })],
  ['POST', /^\/api\/logout$/, async () => { await resetAll(); return json(200, { ok: true }); }],
  ['POST', /^\/api\/login(\/2fa)?$/, async () => json(200, { stage: 'active' })],

  ['POST', /^\/api\/account\/password$/, async () => { throw new HttpError(400, 'En la demo no hay contraseñas: el login con 2FA está en la versión con servidor.'); }],
  ['GET', /^\/api\/account\/sessions$/, async () => json(200, { sessions: [{ current: true, created_at: Date.now(), last_seen: Date.now(), ip: 'demo', ua: self.navigator.userAgent }] })],
  ['POST', /^\/api\/account\/logout-others$/, async () => json(200, { ok: true })],

  ['GET', /^\/api\/brand$/, async () => json(200, { brand: await readBrand(), fonts: FONTS })],
  ['PUT', /^\/api\/brand$/, async (_m, req) => {
    const b = await req.json();
    const next = { ...DEFAULT_BRAND };
    for (const key of ['primary', 'secondary', 'accent', 'text']) {
      if (b[key] !== undefined && !HEX.test(b[key])) throw new HttpError(400, `Color inválido: ${key}.`);
      next[key] = b[key] ?? DEFAULT_BRAND[key];
    }
    if (b.font !== undefined && !FONTS.includes(b.font)) throw new HttpError(400, 'Tipografía no permitida.');
    next.font = b.font ?? DEFAULT_BRAND.font;
    for (const [key, max] of [['name', 80], ['tagline', 120], ['phone', 40], ['instagram', 60], ['address', 120], ['website', 120]]) next[key] = str(b[key], max);
    await kvSet('brand', next);
    return json(200, { brand: await readBrand() });
  }],
  ['PUT', /^\/api\/brand\/logo$/, async (_m, req) => {
    const body = await req.json();
    const bytes = dataUrlToBlob(body.data, 1024 * 1024, 'Logo');
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) throw new HttpError(400, 'El logo debe ser PNG o JPG.');
    await blobSet('logo', new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' }));
    return json(200, { ok: true });
  }],
  ['GET', /^\/api\/brand\/logo$/, async () => {
    const logo = await blobGet('logo');
    if (!logo) throw new HttpError(404, 'Sin logo.');
    return new Response(logo, { headers: { 'Content-Type': logo.type, 'Cache-Control': 'no-store' } });
  }],
  ['DELETE', /^\/api\/brand\/logo$/, async () => { await blobDel('logo'); return json(200, { ok: true }); }],

  ['GET', /^\/api\/designs$/, async () => {
    await runFakeBot();
    const rows = (await designsAll()).sort((a, b) => b.updated_at - a.updated_at);
    return json(200, { designs: rows.map(publicRow) });
  }],
  ['POST', /^\/api\/designs$/, async (_m, req) => saveDesign(await req.json(), null)],
  ['GET', /^\/api\/designs\/([^/]+)$/, async (m) => {
    await runFakeBot();
    const row = await ownDesign(m[1]);
    return json(200, { design: { ...publicRow(row), spec: row.spec } });
  }],
  ['PUT', /^\/api\/designs\/([^/]+)$/, async (m, req) => saveDesign(await req.json(), await ownDesign(m[1]))],
  ['DELETE', /^\/api\/designs\/([^/]+)$/, async (m) => {
    const row = await ownDesign(m[1]);
    await designDel(row.id);
    await blobDel(`img:${row.id}`);
    return json(200, { ok: true });
  }],
  ['GET', /^\/api\/designs\/([^/]+)\/image$/, async (m) => {
    const row = await ownDesign(m[1]);
    const blob = await blobGet(`img:${row.id}`);
    if (!blob) throw new HttpError(404, 'Imagen no encontrada.');
    return new Response(blob, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }],
  ['POST', /^\/api\/designs\/([^/]+)\/state$/, async (m, req) => {
    const row = await ownDesign(m[1]);
    const { action, publish_at: publishAt } = await req.json();
    if (action === 'send' && ['draft', 'failed'].includes(row.status)) {
      row.status = 'ready';
      row.publish_at = parsePublishAt(publishAt ?? row.publish_at);
    } else if (action === 'cancel' && row.status === 'ready') {
      row.status = 'draft';
    } else if (action === 'retry' && ['failed', 'processing'].includes(row.status)) {
      row.status = 'ready';
    } else {
      throw new HttpError(409, 'Acción no permitida en el estado actual.');
    }
    row.note = null;
    row.updated_at = Date.now();
    await designPut(row);
    return json(200, { design: publicRow(row) });
  }],

  ['GET', /^\/api\/header-images$/, async () => json(200, { images: (await manifest()).header || [] })],
  ['GET', /^\/api\/header-images\/([^/]+)$/, async (m) => libFile('header', m[1])],
  ['GET', /^\/api\/footer-images$/, async () => json(200, { images: (await manifest()).footer || [] })],
  ['GET', /^\/api\/footer-images\/([^/]+)$/, async (m) => libFile('footer', m[1])],
];

async function handle(request) {
  const url = new URL(request.url);
  for (const [method, re, fn] of routes) {
    const m = re.exec(url.pathname);
    if (m && method === request.method) {
      try {
        return await fn(m, request);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        return json(status, { error: err instanceof HttpError ? err.message : 'Error interno de la demo.' });
      }
    }
  }
  return json(404, { error: 'No encontrado.' });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(handle(event.request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source.postMessage({ version: VERSION });
});
