'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
process.env.FOOTER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-footer-'));
process.env.HEADER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-header-'));
process.removeAllListeners('warning');

const S = require('../server/secure');
const { q } = require('../server/db');
const { createServer } = require('../server/index');

/* PNG mínimo válido de 1080×1920 (gris, todo negro). */
function makePng(w = 1080, h = 1920) {
  const crcTable = (buf) => { const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(buf) >>> 0); return c; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([len, td, crcTable(td)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

let base;
let server;
test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [name, pw] of [['ana', 'Clave-Segura-123'], ['beto', 'Otra-Clave-Larga-9']]) {
    q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', name, await S.hashPassword(pw), Date.now());
  }
});
test.after(() => { server.close(); server.closeAllConnections?.(); });

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (this.csrf && !h['x-csrf-token']) h['x-csrf-token'] = this.csrf;
    let payload;
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, res };
  }
  async refreshCsrf() { const r = await this.req('GET', '/api/session'); this.csrf = r.data.csrf || ''; return r.data; }
}

async function fullLogin(username, password) {
  const c = new Client();
  let r = await c.req('POST', '/api/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await c.refreshCsrf();
  if (r.data.stage === 'setup2fa') {
    const info = await c.req('GET', '/api/2fa/setup');
    c.secret = info.data.secret;
    assert.match(info.data.uri, /^otpauth:\/\/totp\//);
    r = await c.req('POST', '/api/2fa/enable', { code: S.totpAt(c.secret, Math.floor(Date.now() / 30000)) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    c.recovery = r.data.recoveryCodes;
  }
  await c.refreshCsrf();
  return c;
}

test('cabeceras de seguridad y archivos estáticos', async () => {
  const c = new Client();
  const r = await c.req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.res.headers.get('x-frame-options'), 'DENY');
  assert.equal((await c.req('GET', '/../server/db.js')).status, 404);
  assert.equal((await c.req('GET', '/%2e%2e/server/db.js')).status, 404);
  assert.equal((await c.req('GET', '/data/app.db')).status, 404);
});

test('API protegida sin sesión', async () => {
  const c = new Client();
  for (const url of ['/api/brand', '/api/designs', '/api/account/sessions']) {
    assert.equal((await c.req('GET', url)).status, 401, url);
  }
  assert.equal((await c.req('GET', '/api/bot/images')).status, 401);
});

test('login: error genérico, 2FA obligatorio y rotación de sesión', async () => {
  const c = new Client();
  const bad = await c.req('POST', '/api/login', { username: 'ana', password: 'incorrecta-123' });
  const ghost = await c.req('POST', '/api/login', { username: 'noexiste', password: 'incorrecta-123' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, ghost.data.error);

  await c.req('POST', '/api/login', { username: 'ana', password: 'Clave-Segura-123' });
  const before = c.cookie;
  const info = await c.refreshCsrf();
  assert.equal(info.stage, 'setup2fa');
  assert.equal((await c.req('GET', '/api/designs')).status, 403, 'sin 2FA no accede a la API');

  const setup = await c.req('GET', '/api/2fa/setup');
  assert.equal((await c.req('POST', '/api/2fa/enable', { code: '000000' })).status, 401);
  const ok = await c.req('POST', '/api/2fa/enable', { code: S.totpAt(setup.data.secret, Math.floor(Date.now() / 30000)) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.recoveryCodes.length, 8);
  assert.notEqual(c.cookie, before, 'la cookie de sesión se rota');
  await c.refreshCsrf();
  assert.equal((await c.req('GET', '/api/designs')).status, 200);

  // Segundo login: pide código, no reutiliza el mismo TOTP
  const c2 = new Client();
  await c2.req('POST', '/api/login', { username: 'ana', password: 'Clave-Segura-123' });
  await c2.refreshCsrf();
  assert.equal((await c2.req('POST', '/api/login/2fa', { code: '123456' })).status, 401);
  const stepCode = S.totpAt(setup.data.secret, Math.floor(Date.now() / 30000) + 1);
  // el paso ya usado en la activación no sirve otra vez
  const replay = await c2.req('POST', '/api/login/2fa', { code: S.totpAt(setup.data.secret, Math.floor(Date.now() / 30000)) });
  assert.equal(replay.status, 401, 'el código TOTP no se puede reutilizar');
  const recov = await c2.req('POST', '/api/login/2fa', { code: ok.data.recoveryCodes[0] });
  assert.equal(recov.status, 200, 'el código de recuperación funciona');
  await c2.refreshCsrf();
  assert.equal((await c2.req('GET', '/api/brand')).status, 200);
  // código de recuperación de un solo uso
  const c3 = new Client();
  await c3.req('POST', '/api/login', { username: 'ana', password: 'Clave-Segura-123' });
  await c3.refreshCsrf();
  assert.equal((await c3.req('POST', '/api/login/2fa', { code: ok.data.recoveryCodes[0] })).status, 401);
  void stepCode;
});

test('bloqueo por intentos fallidos', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 6; i++) last = await c.req('POST', '/api/login', { username: 'beto', password: 'mala-clave-123' });
  const locked = await c.req('POST', '/api/login', { username: 'beto', password: 'Otra-Clave-Larga-9' });
  assert.equal(locked.status, 429, 'incluso con la clave correcta queda bloqueado');
  assert.ok(locked.res.headers.get('retry-after'));
  void last;
});

test('marca, diseños y API del bot de punta a punta', async () => {
  // usuario nuevo con 2FA activado
  q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', 'carla', await S.hashPassword('Clave-De-Carla-77'), Date.now());
  const c = await fullLogin('carla', 'Clave-De-Carla-77');

  // CSRF
  const noCsrf = await c.req('PUT', '/api/brand', { primary: '#112233' }, { 'x-csrf-token': 'x' });
  assert.equal(noCsrf.status, 403);
  const crossOrigin = await c.req('PUT', '/api/brand', { primary: '#112233' }, { origin: 'https://evil.example' });
  assert.equal(crossOrigin.status, 403);

  // Marca
  assert.equal((await c.req('PUT', '/api/brand', { primary: 'rojo' })).status, 400);
  const brand = await c.req('PUT', '/api/brand', { name: 'Panadería Sol', primary: '#112233', font: 'Georgia', phone: '11 5555-0000' });
  assert.equal(brand.status, 200);
  assert.equal(brand.data.brand.name, 'Panadería Sol');
  assert.equal((await c.req('PUT', '/api/brand', { font: 'Comic; alert(1)' })).status, 400);

  // Diseños
  const png = makePng();
  const image = png.toString('base64');
  const spec = { template: 'impacto', layers: [{ type: 'text', text: 'Hola' }] };
  assert.equal((await c.req('POST', '/api/designs', { title: 'x', spec, image: 'AAAA' })).status, 400);
  assert.equal((await c.req('POST', '/api/designs', { title: 'chica', spec, image: makePng(100, 100).toString('base64') })).status, 400);
  const created = await c.req('POST', '/api/designs', { title: '30% en medialunas', caption: '#oferta', spec, image, send: false });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.design.id;
  assert.equal(created.data.design.status, 'draft');

  const img = await c.req('GET', `/api/designs/${id}/image`);
  assert.equal(img.status, 200);
  assert.ok(Buffer.isBuffer(img.data) && img.data.equals(png));

  // Aislamiento entre usuarios
  q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', 'dani', await S.hashPassword('Clave-De-Dani-88'), Date.now());
  const other = await fullLogin('dani', 'Clave-De-Dani-88');
  assert.equal((await other.req('GET', `/api/designs/${id}`)).status, 404);
  assert.equal((await other.req('GET', `/api/designs/${id}/image`)).status, 404);
  assert.equal((await other.req('DELETE', `/api/designs/${id}`)).status, 404);
  assert.equal((await other.req('GET', '/api/designs')).data.designs.length, 0);

  // Bot: sin token no ve nada; con token toma solo lo "ready"
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, '../server/cli.js'), 'token:add', 'bot-test'], { env: { ...process.env } }).toString();
  const token = /(sc_[A-Za-z0-9_-]+)/.exec(out)[1];
  const bot = (m, u, b) => new Client().req(m, u, b, { authorization: `Bearer ${token}` });
  assert.equal((await bot('GET', '/api/bot/images')).data.images.length, 0, 'un borrador no es visible para el bot');
  assert.equal((await new Client().req('GET', '/api/bot/images', undefined, { authorization: 'Bearer sc_invalido_invalido_invalido' })).status, 401);

  const sent = await c.req('POST', `/api/designs/${id}/state`, { action: 'send' });
  assert.equal(sent.data.design.status, 'ready');
  const future = await c.req('PUT', `/api/designs/${id}`, { title: 'futuro', spec, send: true, publish_at: Date.now() + 3600_000 });
  assert.equal(future.status, 200);
  assert.equal((await bot('GET', '/api/bot/images')).data.images.length, 0, 'programada a futuro: todavía no');
  await c.req('PUT', `/api/designs/${id}`, { title: 'ahora', spec, send: true, publish_at: Date.now() - 1000 });
  const list = await bot('GET', '/api/bot/images');
  assert.equal(list.data.images.length, 1);
  assert.equal(list.data.images[0].caption, '#oferta');
  const file = await bot('GET', list.data.images[0].file);
  assert.equal(file.status, 200);
  assert.equal(S.sha256(file.data), list.data.images[0].sha256);

  assert.equal((await bot('POST', `/api/bot/images/${id}/status`, { status: 'published' })).status, 409, 'hay que reservar antes');
  assert.equal((await bot('POST', `/api/bot/images/${id}/claim`)).status, 200);
  assert.equal((await bot('POST', `/api/bot/images/${id}/claim`)).status, 409, 'la reserva es exclusiva');
  assert.equal((await c.req('PUT', `/api/designs/${id}`, { title: 'x', spec })).status, 409, 'no se edita mientras se procesa');
  assert.equal((await bot('POST', `/api/bot/images/${id}/status`, { status: 'published', note: 'ok' })).status, 200);
  assert.equal((await c.req('GET', `/api/designs/${id}`)).data.design.status, 'published');

  // Contraseña
  assert.equal((await c.req('POST', '/api/account/password', { current: 'mala', next: 'Nueva-Clave-Muy-Larga-5' })).status, 401);
  assert.equal((await c.req('POST', '/api/account/password', { current: 'Clave-De-Carla-77', next: 'corta' })).status, 400);
  assert.equal((await c.req('POST', '/api/account/password', { current: 'Clave-De-Carla-77', next: 'Nueva-Clave-Muy-Larga-5' })).status, 200);

  // Logout invalida la sesión
  assert.equal((await c.req('POST', '/api/logout')).status, 200);
  assert.equal((await c.req('GET', '/api/designs')).status, 401);
});

test('carpeta footer: lista solo PNG, exige sesión y bloquea rutas raras', async () => {
  const dir = process.env.FOOTER_DIR;
  for (const n of ['a.png', 'b.png', 'c d.png', 'e.png']) fs.writeFileSync(path.join(dir, n), makePng(8, 8));
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'no soy imagen');
  const anon = new Client();
  assert.equal((await anon.req('GET', '/api/footer-images')).status, 401);
  assert.equal((await anon.req('GET', '/api/footer-images/a.png')).status, 401);
  q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', 'dario', await S.hashPassword('Clave-De-Dario-55'), Date.now());
  const c = await fullLogin('dario', 'Clave-De-Dario-55');
  const list = await c.req('GET', '/api/footer-images');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.images, ['a.png', 'b.png', 'c d.png', 'e.png']);
  const one = await c.req('GET', '/api/footer-images/' + encodeURIComponent('c d.png'));
  assert.equal(one.status, 200);
  assert.equal(one.res.headers.get('content-type'), 'image/png');
  assert.equal((await c.req('GET', '/api/footer-images/nota.txt')).status, 404);
  assert.equal((await c.req('GET', '/api/footer-images/' + encodeURIComponent('../secret.png'))).status, 404);
  assert.equal((await c.req('GET', '/api/footer-images/..%2F..%2Fpackage.json')).status, 404);
});

test('carpeta header: acepta PNG/JPG/WebP y bloquea el resto', async () => {
  const dir = process.env.HEADER_DIR;
  for (const n of ['fichas.png', 'lluvia.jpg', 'fondo.webp']) fs.writeFileSync(path.join(dir, n), makePng(8, 8));
  fs.writeFileSync(path.join(dir, 'script.js'), 'alert(1)');
  const anon = new Client();
  assert.equal((await anon.req('GET', '/api/header-images')).status, 401);
  q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?,?,?)', 'eva', await S.hashPassword('Clave-De-Eva-4242'), Date.now());
  const c = await fullLogin('eva', 'Clave-De-Eva-4242');
  const list = await c.req('GET', '/api/header-images');
  assert.deepEqual(list.data.images, ['fichas.png', 'fondo.webp', 'lluvia.jpg']);
  assert.equal((await c.req('GET', '/api/header-images/lluvia.jpg')).res.headers.get('content-type'), 'image/jpeg');
  assert.equal((await c.req('GET', '/api/header-images/script.js')).status, 404);
  assert.equal((await c.req('GET', '/api/header-images/..%2F..%2Fpackage.json')).status, 404);
});

test('validación de contraseñas y TOTP (RFC 6238)', () => {
  assert.ok(S.checkPasswordPolicy('corta'));
  assert.ok(S.checkPasswordPolicy('aaaaaaaaaaaaaaaa'));
  assert.ok(S.checkPasswordPolicy('soloMinusculasYMayus'));
  assert.equal(S.checkPasswordPolicy('Clave-Segura-123', 'ana'), null);
  // Vector de prueba RFC 6238 (SHA-1, secreto "12345678901234567890"), T=59 → 94287082 → últimos 6: 287082
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(S.totpAt(secret, Math.floor(59 / 30)), '287082');
});
