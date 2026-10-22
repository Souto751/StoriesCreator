// Arranque de la demo: registra el service worker que simula la API y recién
// cuando controla la página carga la app normal (public/js/app.js).
const REPO = 'https://github.com/Souto751/StoriesCreator';

function banner() {
  const bar = document.createElement('div');
  bar.className = 'demo-banner';
  const text = document.createElement('span');
  text.textContent = 'Demo: sin servidor ni login, todo queda guardado en tu navegador. "Salir" reinicia la demo. ';
  const link = document.createElement('a');
  link.href = REPO;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Ver código en GitHub';
  bar.append(text, link);
  document.body.prepend(bar);
}

function fail(message) {
  const app = document.getElementById('app');
  const box = document.createElement('main');
  box.className = 'auth';
  const card = document.createElement('div');
  card.className = 'auth-card';
  const h1 = document.createElement('h1');
  h1.textContent = 'No se pudo iniciar la demo';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = message;
  card.append(h1, p);
  box.append(card);
  app.replaceChildren(box);
}

async function start() {
  banner();
  if (!('serviceWorker' in navigator)) {
    fail('Tu navegador no permite service workers (por ejemplo, una ventana privada de Firefox). Probá con otro navegador o una ventana normal.');
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  } catch (err) {
    fail(`El service worker no se pudo registrar: ${err.message}`);
    return;
  }
  await import('/js/app.js');
}

start();
