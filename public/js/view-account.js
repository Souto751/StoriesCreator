import { h, clear, field, button, toast, fmtDate } from './ui.js';
import { get, post } from './api.js';
import { state, run } from './state.js';

export async function accountView(root) {
  const { sessions } = await get('/api/account/sessions');
  clear(root);

  const error = h('p', { class: 'error', role: 'alert' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxLength: 256 });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxLength: 128 });
  const again = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxLength: 128 });
  const pwForm = h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (next.value !== again.value) { error.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
    try {
      await post('/api/account/password', { current: cur.value, next: next.value });
      cur.value = next.value = again.value = '';
      toast('Contraseña actualizada. Se cerraron tus otras sesiones.');
      accountView(root);
    } catch (err) {
      if (err.status === 401 && /sesión/i.test(err.message)) return state.reboot();
      error.textContent = err.message;
    }
  } }, field('Contraseña actual', cur), field('Contraseña nueva', next, 'Mínimo 12 caracteres, con al menos 3 tipos: minúsculas, mayúsculas, números y símbolos.'), field('Repetir contraseña nueva', again), error, button('Cambiar contraseña', null, { kind: 'primary', type: 'submit' }));

  root.append(h('section', { class: 'page narrow' },
    h('h1', {}, 'Cuenta'),
    h('p', {}, 'Usuario: ', h('b', {}, state.session.user.username), ' · Verificación en dos pasos: activada'),
    h('div', { class: 'block' }, h('h3', {}, 'Cambiar contraseña'), pwForm),
    h('div', { class: 'block' }, h('h3', {}, 'Sesiones activas'),
      h('ul', { class: 'sessions' }, sessions.map((s) => h('li', {}, h('b', {}, s.current ? 'Esta sesión' : 'Otra sesión'), ` · último uso ${fmtDate(s.last_seen)} · ${s.ip || ''}`, h('br'), h('span', { class: 'muted small' }, (s.ua || '').slice(0, 90))))),
      sessions.length > 1 ? button('Cerrar las demás sesiones', () => run(async () => { await post('/api/account/logout-others'); toast('Sesiones cerradas.'); accountView(root); })) : null),
    h('div', { class: 'block' }, h('h3', {}, 'Conexión con el bot'),
      h('p', {}, 'Las imágenes marcadas como “Lista para el bot” quedan disponibles en una API protegida con token. El administrador crea el token en el servidor con ', h('code', {}, 'node server/cli.js token:add nombre-del-bot'), '.'),
      h('pre', { class: 'apidoc' }, [
        'GET  /api/bot/images?due=1&limit=20     lista de imágenes listas',
        'GET  /api/bot/images/{id}/file           descarga el PNG (1080x1920)',
        'POST /api/bot/images/{id}/claim          reserva la imagen (evita duplicados)',
        'POST /api/bot/images/{id}/status         {"status":"published"|"failed","note":"..."}',
        '',
        'Cabecera: Authorization: Bearer sc_xxxxxxxx',
      ].join('\n'))),
  ));
}
