import { h, clear, field, button, toast, debounce, readImageFile, downloadBlob, fmtDate } from './ui.js';
import { get, post, put } from './api.js';
import { state, run } from './state.js';
import { W, H, drawDesign, loadImage } from './render.js';
import { Editor } from './editor.js';
import { headerGeometry, ensureHeaderLegible, footerGeometry, packBottomText } from './autofit.js';
import { removeCheckerboard } from './cutout.js';
import { TEMPLATES, CATEGORIES, KINDS, DEFAULT_INPUTS, buildDesign, patchTexts } from './templates.js';

// append() convierte null en el texto "null": este helper descarta los vacíos.
const addNodes = (el, ...nodes) => el.append(...nodes.filter((n) => n !== null && n !== undefined && n !== false));

const STATUS = {
  draft: 'Borrador', ready: 'Lista para el bot', processing: 'El bot la está publicando',
  published: 'Publicada', failed: 'Falló la publicación',
};

// Si la imagen trae pintado el cuadriculado del "fondo transparente", lo recorta y devuelve PNG con transparencia real.
async function cleanFakeTransparency(url, img) {
  const r = removeCheckerboard(img);
  if (!r) return null;
  const clean = r.canvas.toDataURL('image/png');
  return { url: clean, img: await loadImage(clean) };
}

async function loadLogo(brand) {
  if (!brand.hasLogo) return null;
  try {
    const res = await fetch('/api/brand/logo', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

const toLocalInput = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export async function studioView(root, { design = null, copy = false } = {}) {
  const brand = state.brand;
  const S = {
    templateId: 'impacto',
    inputs: { ...DEFAULT_INPUTS },
    photo: null,
    extra: {},
    designId: null,
    title: '',
    caption: '',
    publishAt: null,
    status: 'draft',
    note: null,
    manual: false,
    tab: 'edit',
  };
  const assets = {};
  const logoImg = await loadLogo(brand);
  if (logoImg) assets.logo = logoImg;

  if (design) {
    const sp = design.spec;
    S.templateId = sp.template || 'impacto';
    S.inputs = { ...DEFAULT_INPUTS, ...(sp.inputs || {}) };
    for (const [key, url] of Object.entries(sp.assets || {})) {
      try { assets[key] = await loadImage(url); } catch { /* imagen dañada */ }
      if (key === 'photo') S.photo = url; else S.extra[key] = url;
    }
    if (!copy) {
      S.designId = design.id;
      S.title = design.title;
      S.caption = design.caption;
      S.publishAt = design.publish_at;
      S.status = design.status;
      S.note = design.note;
    } else {
      S.title = `${design.title} (copia)`;
      S.caption = design.caption;
    }
  }

  const locked = ['processing', 'published'].includes(S.status);
  const canvas = h('canvas', { class: 'stage', 'aria-label': 'Vista previa de la historia (arrastrá los elementos para moverlos)' });
  let ready = false;
  const editor = new Editor(canvas, {
    onChange: (info) => { if (ready) onEditorChange(info); },
    onSelect: () => { if (ready) { renderProps(); renderLayers(); updateToolbar(); } },
  });

  /* ---------- Construcción del diseño ---------- */
  const hasLogo = () => Boolean(assets.logo); // el logo de la marca se muestra siempre que exista
  const hasPhoto = () => Boolean(assets.photo) && S.inputs.usePhoto;
  function specFor(templateId) {
    return buildDesign(templateId, S.inputs, brand, { hasLogo: hasLogo(), hasPhoto: hasPhoto() });
  }
  function rebuild() {
    const spec = specFor(S.templateId);
    editor.setSpec(spec, assets);
    S.manual = false;
    state.unsaved = true;
    refreshThumbs();
  }
  function confirmDiscard() {
    return !S.manual || window.confirm('Esto vuelve a generar el diseño y descarta los ajustes manuales que hiciste. ¿Continuar?');
  }

  if (design) {
    editor.setSpec({ template: S.templateId, bg: design.spec.bg, layers: design.spec.layers, assets: {} }, assets);
    state.unsaved = copy;
  } else {
    editor.setSpec(specFor(S.templateId), assets);
    state.unsaved = false;
  }

  /* ---------- Panel izquierdo: datos ---------- */
  const thumbs = new Map();
  const thumbButtons = TEMPLATES.map((t) => {
    const c = h('canvas', { width: 90, height: 160, 'aria-hidden': 'true' });
    thumbs.set(t.id, c);
    const b = h('button', {
      type: 'button', class: `thumb ${t.id === S.templateId ? 'active' : ''}`, title: t.name, disabled: locked,
      onClick: () => {
        if (t.id === S.templateId || !confirmDiscard()) return;
        S.templateId = t.id;
        thumbButtons.forEach((x) => x.classList.toggle('active', x.dataset.id === t.id));
        rebuild();
      },
    }, c, h('span', {}, t.name));
    b.dataset.id = t.id;
    return b;
  });
  // Plantillas agrupadas por categoría (acordeón). Se abre la categoría de la plantilla elegida.
  const groupOf = (id) => (TEMPLATES.find((t) => t.id === id) || {}).group;
  const templateGroups = CATEGORIES.map((cat) => {
    const inCat = thumbButtons.filter((b) => groupOf(b.dataset.id) === cat.id);
    return h('details', { class: 'tgroup', open: groupOf(S.templateId) === cat.id },
      h('summary', {}, `${cat.name} `, h('span', { class: 'tcount' }, String(inCat.length))),
      h('div', { class: 'thumbs', role: 'group', 'aria-label': cat.name }, inCat));
  });

  const drawThumbs = () => {
    for (const t of TEMPLATES) {
      const c = thumbs.get(t.id);
      const ctx = c.getContext('2d');
      ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
      drawDesign(ctx, specFor(t.id), assets);
    }
  };
  const refreshThumbs = debounce(drawThumbs, 250);

  const onField = (key) => (e) => {
    S.inputs[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    patchTexts(editor.spec, S.inputs, brand);
    editor.render();
    state.unsaved = true;
    refreshThumbs();
  };
  const text = (key, label, opts = {}) => field(label, h('input', { type: 'text', value: S.inputs[key] || '', maxLength: opts.max || 80, placeholder: opts.ph || '', disabled: locked, onInput: onField(key) }), opts.hint);

  const kindSelect = h('select', {
    disabled: locked,
    onChange: (e) => { S.inputs.kind = e.target.value; valueLabel.textContent = kindHint(); patchTexts(editor.spec, S.inputs, brand); editor.render(); state.unsaved = true; refreshThumbs(); },
  }, KINDS.map((k) => h('option', { value: k.id, selected: k.id === S.inputs.kind }, k.name)));
  const kindHint = () => (KINDS.find((k) => k.id === S.inputs.kind) || {}).hint || '';
  const valueLabel = h('small', { class: 'hint' }, kindHint());


  const left = h('aside', { class: 'panel' },
    h('h2', {}, 'Diseño'),
    !brand.name && !brand.phone && !brand.instagram
      ? h('p', { class: 'notice' }, 'Completá tu ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); state.navigate('brand'); } }, 'marca'), ' (nombre, logo, contacto y colores) y se aplica solo a todos los diseños.')
      : null,
    h('div', { class: 'tgroups' }, ...templateGroups),
    h('h3', {}, 'Oferta'),
    field('Tipo de descuento', kindSelect),
    field('Valor', h('input', { type: 'text', value: S.inputs.value, maxLength: 30, disabled: locked, onInput: onField('value') }), null),
    valueLabel,
    text('headline', 'Titular', { max: 60 }),
    text('title', 'Producto o servicio', { max: 60 }),
    text('subtitle', 'Detalle', { max: 80 }),
    h('div', { class: 'grid2' }, text('oldPrice', 'Precio anterior', { max: 14 }), text('newPrice', 'Precio ahora', { max: 14 })),
    text('validity', 'Vigencia', { max: 60, ph: 'Válido hasta el domingo' }),
    h('h3', {}, 'Imágenes'),
    h('p', { class: 'hint' }, assets.logo ? 'El logo de tu marca se muestra siempre arriba.' : 'Todavía no cargaste un logo: cargalo en “Marca” y aparece solo en todos los diseños.'),
    button('+ Agregar imágenes', addImageLayer, { disabled: locked }),
    button('Encabezado y pie al azar (todo junto)', async () => { await randomHeader(); await randomFooter(); }, { kind: 'primary', disabled: locked }),
    button('Encabezado al azar (1 imagen)', randomHeader, { disabled: locked }),
    button('Pie de página al azar (3 imágenes)', randomFooter, { disabled: locked }),
    h('p', { class: 'hint' }, 'Podés elegir varias a la vez. Cada una queda como capa: movela, cambiá su tamaño o girala sobre el diseño.'),
    h('p', { class: 'muted small' }, 'Los datos de contacto y los colores salen de tu perfil de “Marca”.'),
    button('Regenerar diseño', () => { if (confirmDiscard()) rebuild(); }, { disabled: locked }),
  );

  /* ---------- Panel derecho ---------- */
  const propsEl = h('div', { class: 'props' });
  const layersEl = h('div', { class: 'layers' });
  const sendEl = h('div', { class: 'send' });
  const tabs = [['edit', 'Editar'], ['layers', 'Capas'], ['send', 'Enviar']];
  const tabBtns = tabs.map(([id, name]) => h('button', { type: 'button', role: 'tab', class: 'tab', onClick: () => setTab(id) }, name));
  const bodyEl = h('div', { class: 'tabbody' });
  function setTab(id) {
    S.tab = id;
    tabs.forEach(([tid], i) => { tabBtns[i].classList.toggle('active', tid === id); tabBtns[i].setAttribute('aria-selected', String(tid === id)); });
    clear(bodyEl);
    bodyEl.append(id === 'edit' ? propsEl : id === 'layers' ? layersEl : sendEl);
    if (id === 'send') renderSend();
  }
  const right = h('aside', { class: 'panel' }, h('div', { class: 'tabs', role: 'tablist' }, tabBtns), bodyEl);

  const geo = {};
  function num(label, key, l, min, max, step = 1) {
    const input = h('input', { type: 'number', value: Math.round(l[key] ?? 0), min, max, step, disabled: l.locked || locked, onInput: (e) => { if (e.target.value === '') return; editor.update(l.id, { [key]: Number(e.target.value) }); }, onChange: () => editor.commit() });
    geo[key] = input;
    return field(label, input);
  }
  function color(label, l, key, fallback = '#ffffff') {
    const val = typeof l[key] === 'string' && /^#[0-9a-f]{6}$/i.test(l[key]) ? l[key] : fallback;
    return field(label, h('input', { type: 'color', value: val, disabled: locked, onInput: (e) => editor.update(l.id, { [key]: e.target.value }), onChange: () => editor.commit() }));
  }
  function range(label, l, key, min, max, step = 1, fallback = 0) {
    return field(`${label}`, h('input', { type: 'range', min, max, step, value: l[key] ?? fallback, disabled: locked, onInput: (e) => editor.update(l.id, { [key]: Number(e.target.value) }), onChange: () => editor.commit() }));
  }

  // Sombreado que sigue la forma del PNG (no crea ningún fondo). Al tocarlo, el acople automático lo respeta.
  function parseShadow(c) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(c || '');
    if (!m) return { hex: '#000000', alpha: 0.6 };
    const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: m[4] === undefined ? 1 : Number(m[4]) };
  }
  function renderImageShadow(l, off) {
    const cur = parseShadow(l.shadowColor);
    const set = (patch, commit = false) => editor.update(l.id, { shadowCustom: true, ...patch }, commit ? { commit: true } : undefined);
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
    const slider = (label, value, min, max, step, onVal) => field(label, h('input', { type: 'range', min, max, step, value, disabled: off || !l.shadow, onInput: (e) => onVal(Number(e.target.value)), onChange: () => editor.commit() }));
    const box = h('div', { class: 'shadowbox' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(l.shadow), disabled: off, onChange: (e) => { set({ shadow: e.target.checked }, true); renderProps(); } }), ' Sombreado de la imagen'),
      h('div', { class: 'grid2' },
        field('Color', h('input', { type: 'color', value: cur.hex, disabled: off || !l.shadow, onInput: (e) => { l.shadowColor = rgba(e.target.value, parseShadow(l.shadowColor).alpha); set({ shadowColor: l.shadowColor }); }, onChange: () => editor.commit() })),
        slider('Intensidad', l.shadowPasses || 1, 1, 4, 1, (v) => set({ shadowPasses: v }))),
      slider('Opacidad de la sombra', cur.alpha, 0.1, 1, 0.05, (v) => set({ shadowColor: rgba(cur.hex, v) })),
      slider('Difuminado', l.shadowBlur ?? 18, 0, 80, 1, (v) => set({ shadowBlur: v })),
      slider('Distancia vertical', l.shadowY ?? 8, -40, 60, 1, (v) => set({ shadowY: v })),
      h('button', { type: 'button', class: 'btn small', disabled: off, onClick: () => { editor.update(l.id, { shadow: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 18, shadowY: 8, shadowPasses: 1, shadowCustom: undefined }, { commit: true }); renderProps(); } }, 'Restablecer sombreado'));
    return box;
  }

  function renderBackground() {
    const bg = editor.spec.bg;
    const setBg = (patch, commit = false) => { editor.spec.bg = { ...editor.spec.bg, ...patch }; if (commit) editor.commit(); editor.render(); onEditorChange({ user: true }); };
    return h('details', { class: 'bgbox' },
      h('summary', {}, 'Fondo'),
      field('Tipo', h('select', { disabled: locked, onChange: (e) => { setBg(e.target.value === 'gradient' ? { type: 'gradient', c2: bg.c2 || '#000000', angle: bg.angle ?? 70 } : { type: 'solid' }, true); renderProps(); } },
        h('option', { value: 'solid', selected: bg.type !== 'gradient' }, 'Color liso'), h('option', { value: 'gradient', selected: bg.type === 'gradient' }, 'Degradé'))),
      field('Color', h('input', { type: 'color', value: bg.c1, disabled: locked, onInput: (e) => setBg({ c1: e.target.value }), onChange: () => editor.commit() })),
      bg.type === 'gradient' ? field('Color 2', h('input', { type: 'color', value: bg.c2, disabled: locked, onInput: (e) => setBg({ c2: e.target.value }), onChange: () => editor.commit() })) : null);
  }

  async function addImageLayer() {
    const picker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true });
    picker.addEventListener('change', async () => {
      const files = Array.from(picker.files || []).slice(0, 12);
      if (!files.length) return;
      await run(async () => {
        let i = 0, cleaned = 0;
        for (const file of files) {
          let url = await readImageFile(file, 1200, file.type === 'image/png' ? 'image/png' : 'image/jpeg');
          const key = `a${Date.now().toString(36)}${i}`;
          let img = await loadImage(url);
          const cut = await cleanFakeTransparency(url, img);
          if (cut) { url = cut.url; img = cut.img; cleaned++; }
          S.extra[key] = url;
          assets[key] = img;
          const nw = img.naturalWidth || img.width || 600;
          const nh = img.naturalHeight || img.height || 600;
          const k = Math.min(600 / nw, 600 / nh, 1);
          const w = Math.round(nw * k), h2 = Math.round(nh * k);
          const off = (i % 6) * 40;
          editor.add({ type: 'image', name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Imagen', src: key, x: Math.round((1080 - w) / 2) + off, y: Math.round((1920 - h2) / 2) + off, w, h: h2, fit: 'contain', rot: 0 });
          i++;
        }
        if (cleaned) toast(cleaned === 1 ? 'Se quitó el cuadriculado de fondo de una imagen.' : `Se quitó el cuadriculado de fondo de ${cleaned} imágenes.`);
      });
    });
    picker.click();
  }

  // Elige una imagen al azar de la carpeta "header" del servidor y la usa de encabezado (detrás de todo).
  async function randomHeader() {
    await run(async () => {
      const list = (await get('/api/header-images')).images || [];
      if (!list.length) throw new Error('No hay imágenes en la carpeta "header". Copiá tus archivos (PNG, JPG o WebP) ahí.');
      const previous = editor.spec.layers.find((l) => l.header);
      // Con más de una opción, evitar repetir la que ya está puesta.
      const options = list.length > 1 && previous && previous.srcName ? list.filter((n) => n !== previous.srcName) : list;
      const name = options[Math.floor(Math.random() * options.length)];
      const resp = await fetch(`/api/header-images/${encodeURIComponent(name)}`, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('No se pudo leer la imagen del encabezado.');
      const blob = await resp.blob();
      const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const url = await readImageFile(new File([blob], name, { type: blob.type }), 1400, type);
      const img = await loadImage(url);
      if (previous) { delete S.extra[previous.src]; delete assets[previous.src]; editor.remove(previous.id); }
      const key = `h${Date.now().toString(36)}`;
      S.extra[key] = url; assets[key] = img;
      const g = headerGeometry(img);
      const layer = editor.add({ type: 'image', header: true, srcName: name, name: `Encabezado: ${name.replace(/\.[^.]+$/, '').slice(0, 24)}`, src: key, x: g.x, y: g.y, w: g.w, h: g.h, fit: 'cover', fadeBottom: g.fadeBottom, rot: 0 });
      // Mandarlo al fondo, por debajo de los textos y de la decoración.
      const arr = editor.spec.layers;
      arr.splice(arr.indexOf(layer), 1);
      arr.unshift(layer);
      // Acople inteligente: ajustar el brillo de la imagen (o el color del texto) hasta que el texto se lea.
      const fit = ensureHeaderLegible(editor.spec, assets, layer);
      editor.commit();
      editor.render();
      editor.onChange({ user: true });
      editor.select(null);
      toast(fit.dim ? 'Encabezado puesto y ajustado para que el texto se lea bien. Tocá de nuevo para sortear otro.' : 'Encabezado puesto. Tocá de nuevo para sortear otro.');
    });
  }

  // Arma un pie de página con 3 PNG elegidos al azar de la carpeta "footer" del servidor.
  async function randomFooter() {
    await run(async () => {
      const list = (await get('/api/footer-images')).images || [];
      if (!list.length) throw new Error('No hay imágenes PNG en la carpeta "footer". Copiá tus archivos ahí.');
      const pool = [...list];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const chosen = pool.slice(0, 3);
      // Descargar y preparar primero: si algo falla no se pierde el pie anterior.
      const loaded = [];
      for (const name of chosen) {
        const resp = await fetch(`/api/footer-images/${encodeURIComponent(name)}`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('No se pudo leer una imagen del pie de página.');
        const blob = await resp.blob();
        let url = await readImageFile(new File([blob], name, { type: 'image/png' }), 700, 'image/png');
        let img = await loadImage(url);
        const cut = await cleanFakeTransparency(url, img); // quita el cuadriculado "de mentira" si la imagen lo trae
        if (cut) { url = cut.url; img = cut.img; }
        loaded.push({ name, url, img });
      }
      for (const old of editor.spec.layers.filter((l) => l.footer)) {
        delete S.extra[old.src]; delete assets[old.src];
        editor.remove(old.id);
      }
      const n = loaded.length;
      packBottomText(editor.spec); // subir las líneas de abajo si hay campos vacíos: más lugar para el pie
      // Acople inteligente: misma altura, superpuestas, centradas y sin pisar el contenido del diseño.
      for (const pos of footerGeometry(loaded.map((it) => it.img), editor.spec)) {
        const it = loaded[pos.i];
        const key = `f${Date.now().toString(36)}${pos.i}`;
        S.extra[key] = it.url; assets[key] = it.img;
        editor.add({ type: 'image', footer: true, name: `Pie: ${it.name.replace(/\.png$/i, '').slice(0, 24)}`, src: key, x: pos.x, y: pos.y, w: pos.w, h: pos.h, fit: 'contain', shadow: true, shadowBlur: 24, shadowY: 10, rot: 0 });
      }
      editor.select(null);
      toast(`Pie de página armado con ${n} imagen${n > 1 ? 'es' : ''}. Volvé a tocar el botón para sortear otras.`);
    });
  }

  function renderProps() {
    clear(propsEl);
    for (const k of Object.keys(geo)) delete geo[k];
    const l = editor.selected;
    addNodes(propsEl, h('div', { class: 'addrow' },
      button('+ Texto', () => editor.add({ type: 'text', name: 'Texto', text: 'Nuevo texto', x: 140, y: 800, w: 800, h: 160, size: 90, weight: '900', color: '#ffffff', align: 'center', valign: 'middle', family: brand.font, fit: true, lh: 1.1, rot: 0 }), { disabled: locked }),
      button('+ Forma', () => editor.add({ type: 'rect', name: 'Forma', x: 240, y: 800, w: 600, h: 300, r: 40, fill: brand.accent, rot: 0 }), { disabled: locked }),
      button('+ Círculo', () => editor.add({ type: 'ellipse', name: 'Círculo', x: 340, y: 800, w: 400, h: 400, fill: brand.secondary, rot: 0 }), { disabled: locked }),
      button('+ Imagen', addImageLayer, { disabled: locked })));
    if (!l) {
      addNodes(propsEl, h('p', { class: 'muted' }, 'Tocá un elemento del diseño para editarlo. Podés moverlo, cambiar su tamaño con las esquinas y girarlo con el círculo de arriba.'), renderBackground());
      return;
    }
    const off = locked || l.locked;
    addNodes(propsEl, h('h3', {}, l.name || l.type));
    if (l.locked) addNodes(propsEl, h('p', { class: 'muted small' }, 'Esta capa está bloqueada (decoración). Desbloqueala abajo para moverla.'));

    if (l.type === 'text') {
      addNodes(propsEl, 
        field('Texto', h('textarea', { rows: 3, value: l.text || '', maxLength: 300, disabled: off, onInput: (e) => editor.update(l.id, { text: e.target.value, bind: undefined, hidden: false }), onChange: () => editor.commit() })),
        h('div', { class: 'grid2' },
          field('Fuente', h('select', { disabled: off, onChange: (e) => editor.update(l.id, { family: e.target.value }, { commit: true }) }, state.fonts.map((f) => h('option', { value: f, selected: f === (l.family || brand.font) }, f)))),
          field('Grosor', h('select', { disabled: off, onChange: (e) => editor.update(l.id, { weight: e.target.value }, { commit: true }) }, [['400', 'Normal'], ['600', 'Seminegrita'], ['700', 'Negrita'], ['900', 'Extranegrita']].map(([v, n]) => h('option', { value: v, selected: v === String(l.weight || '700') }, n))))),
        range('Tamaño', l, 'size', 16, 520, 2, 48),
        h('div', { class: 'grid2' }, color('Color', l, 'color'),
          field('Alineación', h('select', { disabled: off, onChange: (e) => editor.update(l.id, { align: e.target.value }, { commit: true }) }, [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([v, n]) => h('option', { value: v, selected: v === (l.align || 'center') }, n))))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(l.upper), disabled: off, onChange: (e) => editor.update(l.id, { upper: e.target.checked }, { commit: true }) }), ' MAYÚSCULAS'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(l.fit), disabled: off, onChange: (e) => editor.update(l.id, { fit: e.target.checked }, { commit: true }) }), ' Achicar para que entre en el cuadro'),
      );
    } else if (l.type === 'rect' || l.type === 'ellipse') {
      const fillIsColor = typeof l.fill === 'string' && l.fill.startsWith('#');
      addNodes(propsEl, 
        h('div', { class: 'grid2' },
          fillIsColor ? color('Relleno', l, 'fill') : field('Relleno', h('small', { class: 'hint' }, 'Especial (transparente/degradé)')),
          color('Borde', l, 'stroke', '#000000')),
        range('Grosor del borde', l, 'strokeW', 0, 40, 1, 0),
        l.type === 'rect' ? range('Bordes redondeados', l, 'r', 0, 300, 2, 0) : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(l.shadow), disabled: off, onChange: (e) => editor.update(l.id, { shadow: e.target.checked }, { commit: true }) }), ' Sombra'),
      );
      if (!l.stroke) addNodes(propsEl, h('p', { class: 'muted small' }, 'Para ver el borde, poné un grosor mayor a 0 y elegí un color.'));
    } else if (l.type === 'image') {
      addNodes(propsEl, 
        field('Ajuste', h('select', { disabled: off, onChange: (e) => editor.update(l.id, { fit: e.target.value }, { commit: true }) }, [['cover', 'Llenar (recorta)'], ['contain', 'Entera']].map(([v, n]) => h('option', { value: v, selected: v === (l.fit || 'contain') }, n)))),
        range('Bordes redondeados', l, 'r', 0, 300, 2, 0),
        renderImageShadow(l, off),
      );
    }
    addNodes(propsEl, field('Opacidad', h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: l.opacity ?? 1, disabled: off, onInput: (e) => editor.update(l.id, { opacity: Number(e.target.value) }), onChange: () => editor.commit() })));
    addNodes(propsEl, 
      h('div', { class: 'grid2' }, num('X', 'x', l, -2000, 3000), num('Y', 'y', l, -2000, 3000)),
      h('div', { class: 'grid2' }, num('Ancho', 'w', l, 24, 4000), num('Alto', 'h', l, 24, 4000)),
      num('Rotación (°)', 'rot', l, -180, 180),
      h('div', { class: 'row wrap' },
        button('Duplicar', () => editor.duplicate(l.id), { disabled: locked }),
        button('Al frente', () => editor.reorder(l.id, 1), { disabled: locked }),
        button('Atrás', () => editor.reorder(l.id, -1), { disabled: locked }),
        button(l.locked ? 'Desbloquear' : 'Bloquear', () => { editor.update(l.id, { locked: !l.locked }, { commit: true }); renderProps(); renderLayers(); }, { disabled: locked }),
        button('Eliminar', () => editor.remove(l.id), { kind: 'danger', disabled: off })),
      renderBackground(),
    );
  }
  function syncGeo() {
    const l = editor.selected;
    if (!l) return;
    for (const [key, input] of Object.entries(geo)) if (document.activeElement !== input) input.value = Math.round(l[key] ?? 0);
  }

  function renderLayers() {
    clear(layersEl);
    const list = [...editor.spec.layers].reverse();
    addNodes(layersEl, h('p', { class: 'muted small' }, 'De arriba hacia abajo: lo primero queda por encima.'),
      h('ul', { class: 'layerlist' }, list.map((l) => h('li', { class: l.id === editor.selectedId ? 'sel' : '' },
        h('button', { type: 'button', class: 'lname', onClick: () => { editor.select(l.id); setTab('edit'); } },
          h('span', { class: `ico ${l.type}` }), l.name || l.type, l.text ? h('em', {}, ` · ${String(l.text).slice(0, 22)}`) : null),
        h('button', { type: 'button', class: 'mini', title: l.hidden ? 'Mostrar' : 'Ocultar', 'aria-label': l.hidden ? 'Mostrar capa' : 'Ocultar capa', disabled: locked, onClick: () => { editor.update(l.id, { hidden: !l.hidden }, { commit: true }); renderLayers(); } }, l.hidden ? '🚫' : '👁'),
        h('button', { type: 'button', class: 'mini', title: 'Bloquear o desbloquear', 'aria-label': 'Bloquear capa', disabled: locked, onClick: () => { editor.update(l.id, { locked: !l.locked }, { commit: true }); renderLayers(); } }, l.locked ? '🔒' : '🔓')))));
  }

  /* ---------- Enviar / guardar ---------- */
  function specForSave() {
    return {
      template: S.templateId,
      inputs: S.inputs,
      bg: editor.spec.bg,
      layers: editor.spec.layers,
      assets: { ...(S.photo ? { photo: S.photo } : {}), ...S.extra },
    };
  }
  let titleEl, captionEl, dateEl;
  async function save(send) {
    S.title = titleEl.value.trim();
    S.caption = captionEl.value;
    const publishAt = dateEl.value ? new Date(dateEl.value).getTime() : null;
    if (!S.title) { toast('Poné un título para identificar la imagen.', 'error'); titleEl.focus(); return; }
    await run(async () => {
      const body = { title: S.title, caption: S.caption, spec: specForSave(), image: editor.exportDataUrl(), publish_at: publishAt, send };
      const res = S.designId ? await put(`/api/designs/${S.designId}`, body) : await post('/api/designs', body);
      S.designId = res.design.id;
      S.status = res.design.status;
      S.publishAt = res.design.publish_at;
      state.unsaved = false;
      toast(send ? 'Imagen enviada: el bot la va a tomar.' : 'Borrador guardado.');
      renderSend();
    });
  }
  function renderSend() {
    clear(sendEl);
    if (locked) {
      addNodes(sendEl, 
        h('p', { class: 'chip published' }, STATUS[S.status]),
        h('p', { class: 'muted' }, 'El bot ya tomó esta imagen, por eso no se puede editar. Podés crear una copia para modificarla.'),
        button('Crear copia editable', async () => { const d = await run(() => get(`/api/designs/${S.designId}`)); if (d) state.navigate('studio', { design: d.design, copy: true }); }, { kind: 'primary' }));
      return;
    }
    titleEl = h('input', { type: 'text', value: S.title, maxLength: 120, placeholder: 'Ej. 30% en medialunas', onInput: (e) => { S.title = e.target.value; state.unsaved = true; } });
    captionEl = h('textarea', { rows: 5, maxLength: 2200, value: S.caption, placeholder: 'Texto opcional para acompañar la publicación (el bot puede usarlo).', onInput: (e) => { S.caption = e.target.value; state.unsaved = true; } });
    dateEl = h('input', { type: 'datetime-local', value: toLocalInput(S.publishAt) });
    addNodes(sendEl, 
      S.designId ? h('p', { class: `chip ${S.status}` }, STATUS[S.status] || S.status) : null,
      S.note ? h('p', { class: 'error' }, `Nota del bot: ${S.note}`) : null,
      field('Título (solo para vos)', titleEl),
      field('Texto de la publicación', captionEl),
      field('Programar para (opcional)', dateEl, 'Si lo dejás vacío, el bot puede publicarla apenas la tome. Hora de tu dispositivo.'),
      h('div', { class: 'stack' },
        button('Guardar y enviar al bot', () => save(true), { kind: 'primary' }),
        button('Guardar como borrador', () => save(false)),
        button('Descargar PNG', download)),
      h('p', { class: 'muted small' }, 'El bot solo toma imágenes marcadas como “Lista para el bot” cuya fecha ya llegó.'),
    );
  }
  async function download() {
    await run(async () => {
      const name = (S.title || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story';
      downloadBlob(await editor.exportBlob(), `${name}.png`);
    });
  }

  /* ---------- Centro: lienzo ---------- */
  const undoBtn = button('↶ Deshacer', () => editor.undo(), { title: 'Ctrl+Z' });
  const redoBtn = button('↷ Rehacer', () => editor.redo(), { title: 'Ctrl+Y' });
  const guides = h('input', { type: 'checkbox', checked: true, onChange: (e) => { editor.showGuides = e.target.checked; editor.render(); } });
  function updateToolbar() { undoBtn.disabled = locked || !editor.canUndo; redoBtn.disabled = locked || !editor.canRedo; }
  function onEditorChange({ user, live } = {}) {
    if (user) { S.manual = true; state.unsaved = true; }
    updateToolbar();
    if (live) syncGeo(); else { renderLayers(); }
  }
  const center = h('section', { class: 'center' },
    h('div', { class: 'toolbar' }, undoBtn, redoBtn,
      h('label', { class: 'check' }, guides, ' Zonas seguras'),
      h('span', { class: 'grow' }),
      button('Descargar PNG', download),
      button('Guardar y enviar…', () => setTab('send'), { kind: 'primary' })),
    h('div', { class: 'stagewrap' }, canvas),
    h('p', { class: 'muted small center-note' }, `Imagen final: ${W}×${H} px (9:16). Las bandas rojas son zonas que tapa la interfaz de las historias; no se exportan.`));

  // El formulario es la fuente de verdad de los textos ligados: deshacer/rehacer no los revierte.
  editor.onRestore = () => patchTexts(editor.spec, S.inputs, brand);
  ready = true;
  clear(root);
  root.append(h('div', { class: 'studio' }, left, center, right));
  if (locked) { canvas.style.pointerEvents = 'none'; }
  setTab(design && !copy ? 'send' : 'edit');
  renderProps();
  renderLayers();
  updateToolbar();
  drawThumbs();
  return { editor };
}
