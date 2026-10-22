import { h, clear, field, button, toast, downloadBlob } from './ui.js';
import { get, post } from './api.js';
import { state } from './state.js';

function shell(root, title, subtitle, ...content) {
  clear(root);
  root.append(
    h('main', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'logo' }, 'Stories', h('b', {}, 'Creator')),
        h('h1', {}, title),
        subtitle ? h('p', { class: 'muted' }, subtitle) : null,
        ...content)));
}

export function loginView(root) {
  const error = h('p', { class: 'error', role: 'alert' });
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, maxLength: 64, autofocus: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxLength: 256 });
  const submit = button('Ingresar', null, { kind: 'primary', type: 'submit' });
  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await post('/api/login', { username: user.value.trim(), password: pass.value });
        pass.value = '';
        state.reboot();
      } catch (err) {
        error.textContent = err.message;
        pass.value = '';
        submit.disabled = false;
      }
    },
  }, field('Usuario', user), field('Contraseña', pass), error, submit);
  shell(root, 'Iniciar sesión', 'Acceso privado. Vas a necesitar tu código de verificación.', form);
}

export function twoFaView(root) {
  const error = h('p', { class: 'error', role: 'alert' });
  const code = h('input', { type: 'text', name: 'code', inputMode: 'text', autocomplete: 'one-time-code', required: true, maxLength: 12, placeholder: '123456', autofocus: true });
  const submit = button('Verificar', null, { kind: 'primary', type: 'submit' });
  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await post('/api/login/2fa', { code: code.value.trim() });
        state.reboot();
      } catch (err) {
        error.textContent = err.message;
        code.value = '';
        submit.disabled = false;
        if (err.status === 429) setTimeout(state.reboot, 1500);
      }
    },
  }, field('Código de la app autenticadora', code, 'También podés usar un código de recuperación (formato abcde-12345).'), error, submit,
  button('Cancelar', async () => { await post('/api/logout'); state.reboot(); }, { kind: 'link' }));
  shell(root, 'Verificación en dos pasos', 'Ingresá el código de 6 dígitos que muestra tu app.', form);
}

export async function setup2faView(root) {
  const info = await get('/api/2fa/setup');
  const grouped = info.secret.replace(/(.{4})/g, '$1 ').trim();
  const error = h('p', { class: 'error', role: 'alert' });
  const code = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxLength: 6, required: true, placeholder: '123456' });
  const submit = button('Activar', null, { kind: 'primary', type: 'submit' });
  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const res = await post('/api/2fa/enable', { code: code.value.trim() });
        recoveryView(root, res.recoveryCodes);
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    },
  },
  h('ol', { class: 'steps' },
    h('li', {}, 'Instalá una app autenticadora (Google Authenticator, Microsoft Authenticator, Aegis, 2FAS o similar).'),
    h('li', {}, 'Elegí “Ingresar clave de configuración” y cargá esta clave (tipo: basada en tiempo):'),
  ),
  h('code', { class: 'secret', 'aria-label': 'Clave de configuración' }, grouped),
  button('Copiar clave', async () => { await navigator.clipboard?.writeText(info.secret); toast('Clave copiada.'); }, { kind: 'link' }),
  h('p', { class: 'muted small' }, `Cuenta: ${state.session.user.username} · Emisor: StoriesCreator`),
  field('Código de 6 dígitos que muestra la app', code),
  error, submit);
  shell(root, 'Activá la verificación en dos pasos', 'Es obligatoria para proteger tu cuenta.', form);
}

function recoveryView(root, codes) {
  const text = `Códigos de recuperación de StoriesCreator\nCada código se puede usar una sola vez.\n\n${codes.join('\n')}\n`;
  const done = h('input', { type: 'checkbox' });
  const next = button('Continuar', () => state.reboot(), { kind: 'primary', disabled: true });
  done.addEventListener('change', () => { next.disabled = !done.checked; });
  shell(root, 'Guardá tus códigos de recuperación', 'Si perdés el teléfono, con estos códigos podés entrar. Se muestran una sola vez.',
    h('ul', { class: 'codes' }, codes.map((c) => h('li', {}, h('code', {}, c)))),
    h('div', { class: 'row' },
      button('Copiar', async () => { await navigator.clipboard?.writeText(text); toast('Códigos copiados.'); }),
      button('Descargar .txt', () => downloadBlob(new Blob([text], { type: 'text/plain' }), 'storiescreator-recuperacion.txt'))),
    h('label', { class: 'check' }, done, ' Ya guardé estos códigos en un lugar seguro'),
    next);
}
