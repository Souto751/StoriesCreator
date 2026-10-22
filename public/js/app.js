import { h, clear, button } from './ui.js';
import { get, post, setCsrf } from './api.js';
import { state, loadBrand, run } from './state.js';
import { loginView, twoFaView, setup2faView } from './views-auth.js';
import { studioView } from './view-studio.js';
import { galleryView } from './view-gallery.js';
import { brandView } from './view-brand.js';
import { accountView } from './view-account.js';

const root = document.getElementById('app');
state.reboot = () => { state.unsaved = false; boot(); };

const NAV = [['studio', 'Crear'], ['gallery', 'Mis imágenes'], ['brand', 'Marca'], ['account', 'Cuenta']];
let mainEl;
let navBtns = {};
let current = 'studio';

function shell() {
  clear(root);
  navBtns = {};
  const nav = h('nav', { class: 'nav', 'aria-label': 'Principal' }, NAV.map(([id, name]) => {
    const b = h('button', { type: 'button', class: 'navbtn', onClick: () => state.navigate(id) }, name);
    navBtns[id] = b;
    return b;
  }));
  mainEl = h('main', { id: 'main' });
  root.append(
    h('header', { class: 'topbar' },
      h('div', { class: 'logo' }, 'Stories', h('b', {}, 'Creator')),
      nav,
      h('div', { class: 'user' }, h('span', { class: 'muted small' }, state.session.user.username),
        button('Salir', async () => {
          if (state.unsaved && !window.confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
          await post('/api/logout').catch(() => {});
          state.reboot();
        }, { kind: 'link' }))),
    mainEl);
}

state.navigate = async (view, opts = {}) => {
  if (state.unsaved && current === 'studio' && !opts.force && !window.confirm('Tenés cambios sin guardar en el diseño. ¿Salir igual?')) return;
  state.unsaved = false;
  current = view;
  for (const [id, b] of Object.entries(navBtns)) b.classList.toggle('active', id === view || (view === 'studio' && id === 'studio'));
  clear(mainEl);
  mainEl.append(h('p', { class: 'muted loading' }, 'Cargando…'));
  const target = h('div', {});
  const views = { studio: studioView, gallery: galleryView, brand: brandView, account: accountView };
  const ok = await run(async () => { await views[view](target, opts); return true; });
  clear(mainEl);
  if (ok) mainEl.append(target);
};

window.addEventListener('beforeunload', (e) => {
  if (state.unsaved) { e.preventDefault(); e.returnValue = ''; }
});

async function boot() {
  let info;
  try {
    info = await get('/api/session');
  } catch (err) {
    clear(root);
    root.append(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Sin conexión'), h('p', { class: 'muted' }, err.message), button('Reintentar', boot, { kind: 'primary' }))));
    return;
  }
  state.session = info;
  setCsrf(info.csrf);
  if (info.stage === 'anon') return loginView(root);
  if (info.stage === '2fa') return twoFaView(root);
  if (info.stage === 'setup2fa') return run(() => setup2faView(root));
  await run(loadBrand);
  shell();
  state.navigate('studio', { force: true });
}

boot();
