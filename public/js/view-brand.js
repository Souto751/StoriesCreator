import { h, clear, field, button, toast, readImageFile } from './ui.js';
import { get, put, del } from './api.js';
import { state, run, loadBrand } from './state.js';
import { analyzeLogo } from './logo-style.js';

export async function brandView(root) {
  await loadBrand();
  const b = { ...state.brand };
  clear(root);

  const text = (key, label, max = 80, hint) => field(label, h('input', { type: 'text', value: b[key] || '', maxLength: max, onInput: (e) => { b[key] = e.target.value; } }), hint);
  const inputs = {};
  const color = (key, label) => field(label, inputs[key] = h('input', { type: 'color', value: b[key], onInput: (e) => { b[key] = e.target.value; } }));

  let fontSel;
  const logoBox = h('div', { class: 'logobox' });
  async function paintLogo() {
    clear(logoBox);
    if (!state.brand.hasLogo) { logoBox.append(h('p', { class: 'muted' }, 'Sin logo cargado.')); return; }
    const res = await fetch('/api/brand/logo', { credentials: 'same-origin' });
    if (!res.ok) { logoBox.append(h('p', { class: 'muted' }, 'Sin logo cargado.')); return; }
    const url = URL.createObjectURL(await res.blob());
    logoBox.append(h('img', { src: url, alt: 'Logo actual', class: 'logoimg' }));
  }
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => {
      let data = await readImageFile(file, 600, 'image/png');
      if (data.length > 1_300_000) data = await readImageFile(file, 360, 'image/png');
      await put('/api/brand/logo', { data });
      await loadBrand();
      toast('Logo actualizado.');
      paintLogo();
    });
  } });

  const form = h('form', { class: 'stack', onSubmit: async (e) => {
    e.preventDefault();
    await run(async () => { const res = await put('/api/brand', b); state.brand = res.brand; toast('Marca guardada.'); });
  } },
  h('div', { class: 'grid2' }, text('name', 'Nombre del negocio'), text('tagline', 'Frase (opcional)', 120)),
  h('h3', {}, 'Colores y tipografía'),
  h('div', { class: 'row wrap' },
    button('Elegir según mi logo', async () => {
      if (!state.brand.hasLogo) { toast('Primero subí un logo.'); return; }
      const res = await fetch('/api/brand/logo', { credentials: 'same-origin' });
      if (!res.ok) { toast('No se pudo leer el logo.'); return; }
      const url = URL.createObjectURL(await res.blob());
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; }).catch(() => null);
      const r = img.naturalWidth ? analyzeLogo(img, state.fonts) : null;
      URL.revokeObjectURL(url);
      if (!r) { toast('No pude detectar colores en el logo.'); return; }
      for (const key of ['primary', 'secondary', 'accent', 'text']) { b[key] = r[key]; inputs[key].value = r[key]; }
      b.font = r.font; fontSel.value = r.font;
      toast('Listo: revisá los colores y tocá “Guardar marca” para aplicarlos.');
    }),
    h('small', { class: 'hint' }, 'Toma los colores del logo; la tipografía es una sugerencia según su estilo.')),
  h('div', { class: 'grid4' }, color('primary', 'Principal'), color('secondary', 'Secundario'), color('accent', 'Acento'), color('text', 'Texto claro')),
  field('Tipografía de títulos', fontSel = h('select', { onChange: (e) => { b.font = e.target.value; } }, state.fonts.map((f) => h('option', { value: f, selected: f === b.font }, f))), 'Se usa la que tenga instalada el dispositivo; “Arial Black” e “Impact” suelen estar en Windows y Mac.'),
  h('h3', {}, 'Contacto (aparece en el pie de la imagen)'),
  h('div', { class: 'grid2' }, text('phone', 'Teléfono / WhatsApp', 40), text('instagram', 'Instagram (sin @)', 60)),
  h('div', { class: 'grid2' }, text('website', 'Sitio web', 120), text('address', 'Dirección', 120)),
  button('Guardar marca', null, { kind: 'primary', type: 'submit' }));

  root.append(h('section', { class: 'page narrow' },
    h('h1', {}, 'Tu marca'),
    h('p', { class: 'muted' }, 'Estos datos se aplican automáticamente a todos los diseños nuevos.'),
    h('div', { class: 'block' }, h('h3', {}, 'Logo'), logoBox,
      h('div', { class: 'row' }, button('Subir logo', () => fileInput.click()),
        button('Quitar', () => run(async () => { await del('/api/brand/logo'); await loadBrand(); paintLogo(); }), { kind: 'link' }), fileInput),
      h('p', { class: 'muted small' }, 'PNG con fondo transparente queda mejor. Máximo 1 MB.')),
    form));
  paintLogo();
}
