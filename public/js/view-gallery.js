import { h, clear, button, toast, fmtDate } from './ui.js';
import { get, post, del } from './api.js';
import { state, run } from './state.js';

const STATUS = {
  draft: ['Borrador', 'draft'],
  ready: ['Lista para el bot', 'ready'],
  processing: ['El bot la está publicando', 'processing'],
  published: ['Publicada', 'published'],
  failed: ['Falló', 'failed'],
};

export async function galleryView(root) {
  const data = await get('/api/designs');
  clear(root);
  const list = data.designs;
  const grid = h('div', { class: 'gallery' });

  const reload = () => state.navigate('gallery');
  const act = (id, action) => run(async () => { await post(`/api/designs/${id}/state`, { action }); reload(); });
  const edit = (id, copy = false) => run(async () => { const d = await get(`/api/designs/${id}`); state.navigate('studio', { design: d.design, copy }); });

  for (const d of list) {
    const [label, cls] = STATUS[d.status] || [d.status, ''];
    const stale = d.status === 'processing' && Date.now() - d.updated_at > 30 * 60 * 1000;
    grid.append(h('article', { class: 'card' },
      h('img', { src: `/api/designs/${d.id}/image?v=${d.updated_at}`, alt: `Vista previa: ${d.title}`, loading: 'lazy', width: 180, height: 320 }),
      h('div', { class: 'cardbody' },
        h('h3', { title: d.title }, d.title),
        h('p', { class: `chip ${cls}` }, label),
        d.publish_at ? h('p', { class: 'muted small' }, `Programada: ${fmtDate(d.publish_at)}`) : null,
        d.note ? h('p', { class: 'error small' }, `Bot: ${d.note}`) : null,
        h('p', { class: 'muted small' }, `Actualizada ${fmtDate(d.updated_at)}`),
        h('div', { class: 'row wrap' },
          ['draft', 'ready', 'failed'].includes(d.status) ? button('Editar', () => edit(d.id)) : null,
          d.status === 'draft' ? button('Enviar al bot', () => act(d.id, 'send'), { kind: 'primary' }) : null,
          d.status === 'ready' ? button('Quitar de la cola', () => act(d.id, 'cancel')) : null,
          d.status === 'failed' ? button('Reintentar', () => act(d.id, 'retry'), { kind: 'primary' }) : null,
          stale ? button('Reintentar', () => act(d.id, 'retry'), { kind: 'primary' }) : null,
          ['published', 'processing'].includes(d.status) ? button('Duplicar', () => edit(d.id, true)) : null,
          h('a', { class: 'btn secondary', href: `/api/designs/${d.id}/image`, download: `${d.title.replace(/[^\w-]+/g, '-')}.png` }, 'Descargar'),
          d.status !== 'processing' ? button('Eliminar', async () => {
            if (!window.confirm(`¿Eliminar “${d.title}”? No se puede deshacer.`)) return;
            await run(async () => { await del(`/api/designs/${d.id}`); toast('Imagen eliminada.'); reload(); });
          }, { kind: 'danger' }) : null))));
  }

  root.append(h('section', { class: 'page' },
    h('div', { class: 'pagehead' }, h('h1', {}, 'Mis imágenes'), button('+ Crear nueva', () => state.navigate('studio'), { kind: 'primary' })),
    list.length ? grid : h('div', { class: 'empty' }, h('p', {}, 'Todavía no guardaste ninguna imagen.'), button('Crear la primera', () => state.navigate('studio'), { kind: 'primary' }))));
}
