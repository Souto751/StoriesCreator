'use strict';
process.removeAllListeners('warning');
const readline = require('node:readline');
const config = require('./config');
const { q, audit } = require('./db');
const S = require('./secure');

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function askPassword(username) {
  for (;;) {
    const p1 = await ask('Contraseña (mín. 12, 3 tipos de caracteres): ', { hidden: true });
    const problem = S.checkPasswordPolicy(p1, username);
    if (problem) { console.log(problem); continue; }
    const p2 = await ask('Repetí la contraseña: ', { hidden: true });
    if (p1 !== p2) { console.log('No coinciden.'); continue; }
    return p1;
  }
}

const findUser = (name) => {
  const u = q.get('SELECT * FROM users WHERE username = ?', name);
  if (!u) { console.error(`No existe el usuario "${name}".`); process.exit(1); }
  return u;
};

const commands = {
  async 'user:add'(name) {
    if (!name || !/^[A-Za-z0-9._-]{3,32}$/.test(name)) throw new Error('Nombre: 3-32 caracteres (letras, números, . _ -).');
    if (q.get('SELECT 1 FROM users WHERE username = ?', name)) throw new Error('Ese usuario ya existe.');
    if (q.get('SELECT COUNT(*) AS n FROM users').n >= 20) throw new Error('Límite de usuarios alcanzado.');
    const password = process.env.NEW_USER_PASSWORD || (await askPassword(name));
    const problem = S.checkPasswordPolicy(password, name);
    if (problem) throw new Error(problem);
    q.run('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)', name, await S.hashPassword(password), Date.now());
    audit('user_added', { detail: name });
    console.log(`Usuario "${name}" creado. En el primer ingreso deberá activar la verificación en dos pasos.`);
  },
  async 'user:passwd'(name) {
    const u = findUser(name);
    const password = await askPassword(name);
    q.run('UPDATE users SET pass_hash = ?, failed = 0, locked_until = 0 WHERE id = ?', await S.hashPassword(password), u.id);
    q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    audit('user_passwd', { userId: u.id });
    console.log('Contraseña actualizada y sesiones cerradas.');
  },
  'user:reset2fa'(name) {
    const u = findUser(name);
    q.run("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = 0, recovery = '[]' WHERE id = ?", u.id);
    q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    audit('user_reset2fa', { userId: u.id });
    console.log('2FA reiniciado: deberá configurarlo de nuevo al ingresar.');
  },
  'user:disable'(name) {
    const u = findUser(name);
    q.run('UPDATE users SET disabled = 1 WHERE id = ?', u.id);
    q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    console.log('Usuario deshabilitado.');
  },
  'user:enable'(name) {
    const u = findUser(name);
    q.run('UPDATE users SET disabled = 0, failed = 0, locked_until = 0 WHERE id = ?', u.id);
    console.log('Usuario habilitado.');
  },
  'user:list'() {
    for (const u of q.all('SELECT * FROM users ORDER BY id')) {
      console.log(`${u.id}\t${u.username}\t2FA:${u.totp_enabled ? 'sí' : 'no'}\t${u.disabled ? 'DESHABILITADO' : 'activo'}`);
    }
  },
  'token:add'(name) {
    if (!name) throw new Error('Uso: token:add <nombre-del-bot>');
    const token = `sc_${S.randomToken(32)}`;
    q.run('INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)', name, S.sha256(token), Date.now());
    console.log('Token creado. Guardalo ahora, no se puede volver a ver:\n');
    console.log(token);
  },
  'token:list'() {
    for (const t of q.all('SELECT * FROM api_tokens ORDER BY id')) {
      console.log(`${t.id}\t${t.name}\t${t.revoked ? 'REVOCADO' : 'activo'}\túltimo uso: ${t.last_used ? new Date(t.last_used).toISOString() : 'nunca'}`);
    }
  },
  'token:revoke'(id) {
    q.run('UPDATE api_tokens SET revoked = 1 WHERE id = ?', Number(id));
    console.log('Token revocado.');
  },
};

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (!commands[cmd]) {
    console.log('Comandos:\n  ' + Object.keys(commands).join('\n  '));
    console.log(`\nDatos en: ${config.DATA}`);
    process.exit(cmd ? 1 : 0);
  }
  try { await commands[cmd](arg); } catch (err) { console.error(err.message); process.exit(1); }
})();
