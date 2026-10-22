// Acople automático de encabezado y pie: los adapta a la proporción de cada imagen y al diseño,
// y comprueba con los píxeles reales que el texto siga siendo legible.
import { W, H, drawBackground, drawLayer, hexToRgb, measureTextBox } from './render.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const natural = (img) => ({ w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 });

function relLum(r, g, b) {
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const hexLum = (hex) => { const c = hexToRgb(hex); return relLum(c.r, c.g, c.b); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

// Contraste (casi peor caso) de cada texto visible contra lo que realmente tiene detrás. Sirve para auditar diseños.
export function auditTextContrast(spec, assets) {
  const bd = renderBackdrop(spec, assets);
  // Un texto con contorno de color opuesto (strokeW >= 8) se lee sobre cualquier fondo.
  return spec.layers.filter((l) => l.type === 'text' && !l.hidden && l.text).map((t) => ({ id: t.id, c: t.stroke && t.strokeW >= 8 ? 21 : textContrast(t, bd) }));
}

/* ---------- Encabezado ---------- */

// Alto del encabezado según la proporción de la imagen (así se recorta lo mínimo) y fundido inferior.
export function headerGeometry(img) {
  const n = natural(img);
  const h = Math.round(clamp(W / (n.w / n.h), 380, 520));
  return { x: 0, y: 0, w: W, h, fadeBottom: Math.round(h * 0.34) };
}

// Dibuja el diseño SIN los textos, en baja resolución, para leer el fondo real sobre el que se apoyan.
function renderBackdrop(spec, assets, scale = 0.125) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.scale(scale, scale);
  drawBackground(ctx, spec.bg);
  for (const l of spec.layers) if (l.type !== 'text') drawLayer(ctx, l, assets);
  return { ctx, scale, w: c.width, h: c.height };
}

// Contraste "casi peor caso" (percentil 12) del texto contra los píxeles que tiene detrás.
function textContrast(layer, backdrop) {
  const box = measureTextBox(layer);
  const s = backdrop.scale, pad = 6;
  const sx = clamp(Math.floor((box.x - pad) * s), 0, backdrop.w - 1);
  const sy = clamp(Math.floor((box.y - pad) * s), 0, backdrop.h - 1);
  const ex = clamp(Math.ceil((box.x + box.w + pad) * s), sx + 1, backdrop.w);
  const ey = clamp(Math.ceil((box.y + box.h + pad) * s), sy + 1, backdrop.h);
  const data = backdrop.ctx.getImageData(sx, sy, ex - sx, ey - sy).data;
  const tl = hexLum(isHex(layer.color) ? layer.color : '#ffffff');
  const values = [];
  for (let i = 0; i < data.length; i += 4) values.push(ratio(tl, relLum(data[i], data[i + 1], data[i + 2])));
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.12)] ?? 21;
}

// Luminancia media de los píxeles visibles de una imagen (para saber si un logo es claro u oscuro).
function imageLum(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let sum = 0, weight = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; if (a > 0.5) { sum += relLum(d[i], d[i + 1], d[i + 2]) * a; weight += a; } }
  return weight ? sum / weight : 0.5;
}

// Contraste del logo contra lo que tiene detrás (percentil 12), sobre el rectángulo del logo.
function logoContrast(layer, lum, backdrop) {
  const s = backdrop.scale;
  const sx = clamp(Math.floor(layer.x * s), 0, backdrop.w - 1), sy = clamp(Math.floor(layer.y * s), 0, backdrop.h - 1);
  const ex = clamp(Math.ceil((layer.x + layer.w) * s), sx + 1, backdrop.w), ey = clamp(Math.ceil((layer.y + layer.h) * s), sy + 1, backdrop.h);
  const data = backdrop.ctx.getImageData(sx, sy, ex - sx, ey - sy).data;
  const values = [];
  for (let i = 0; i < data.length; i += 4) values.push(ratio(lum, relLum(data[i], data[i + 1], data[i + 2])));
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.12)] ?? 21;
}

/**
 * Deja legibles los textos y el logo que quedan sobre el encabezado. Prueba combinaciones de
 * oscurecer/aclarar la imagen; en cada una, cada texto conserva su color si se lee y, si no, toma
 * blanco o negro según lo que tenga detrás. Si nada alcanza, agrega contorno a los textos.
 * Modifica `header` (dim/dimColor) y, si hace falta, los textos.
 */
export function ensureHeaderLegible(spec, assets, header, min = 3.6, minLogo = 2.4) {
  const bottom = header.y + header.h;
  const over = (l) => l.y < bottom && l.y + l.h > header.y;
  const texts = spec.layers.filter((l) => l.type === 'text' && !l.hidden && l.text && !l.header && !l.footer && over(l));
  const logo = spec.layers.find((l) => l.type === 'image' && l.src === 'logo' && !l.hidden && over(l));
  const logoLum = logo && assets.logo ? imageLum(assets.logo) : null;

  // Diseños guardados con la placa de una versión anterior: se quita. Y el logo vuelve a su sombra normal.
  spec.layers = spec.layers.filter((l) => !l.logoPlate);
  // Si el usuario configuró el sombreado del logo a mano, no se toca.
  const logoManual = Boolean(logo && logo.shadowCustom);
  if (logo && !logoManual) { Object.assign(logo, LOGO_SHADOW_DEFAULT); if (logo.shadowPasses === undefined) delete logo.shadowPasses; }

  // Volver a los colores originales si un encabezado anterior los había cambiado.
  for (const t of texts) {
    if (t.origColor) { t.color = t.origColor; delete t.origColor; }
    delete t.stroke; delete t.strokeW;
  }
  header.dim = 0;
  delete header.dimColor;
  if (!texts.length && logoLum === null) return { dim: 0, changedText: false };

  // Prueba un nivel de atenuado. Devuelve si todo se lee y si cambió algún color de texto.
  const attempt = (dim, dimColor) => {
    header.dim = dim;
    if (dim) header.dimColor = dimColor; else delete header.dimColor;
    const bd = renderBackdrop(spec, assets);
    let textsOk = true, changed = false;
    for (const t of texts) {
      const orig = t.origColor || t.color;
      let bestColor = orig;
      t.color = orig;
      let bestC = textContrast(t, bd);
      if (bestC < min) {
        for (const cand of ['#ffffff', '#111111']) {
          t.color = cand;
          const c = textContrast(t, bd);
          if (c > bestC) { bestC = c; bestColor = cand; }
        }
      }
      t.color = bestColor;
      if (bestColor !== orig) { t.origColor = orig; changed = true; } else delete t.origColor;
      if (bestC < min) textsOk = false;
    }
    const logoOk = logoLum === null || logoManual || logoContrast(logo, logoLum, bd) >= minLogo;
    return { textsOk, logoOk, changed };
  };

  // El logo manda la dirección: logo oscuro -> aclarar la imagen; logo claro -> oscurecerla.
  const textAvg = texts.length ? texts.reduce((s, t) => s + hexLum(isHex(t.color) ? t.color : '#ffffff'), 0) / texts.length : 0.5;
  const pref = (logoLum !== null ? logoLum : textAvg) > 0.4 ? '#000000' : '#ffffff';
  const other = pref === '#000000' ? '#ffffff' : '#000000';
  const plan = [[0, pref], [0.2, pref], [0.35, pref], [0.5, pref], [0.65, pref], [0.25, other], [0.45, other]];
  // 1) Todo legible; 2) si el logo no llega, quedarse con lo que deja los textos legibles y ponerle un fondo al logo.
  let fallback = null;
  for (const [dim, color] of plan) {
    const r = attempt(dim, color);
    if (r.textsOk && r.logoOk) return { dim, changedText: r.changed };
    if (r.textsOk && !fallback) fallback = { dim, color };
  }
  if (fallback) {
    const r = attempt(fallback.dim, fallback.color);
    applyLogoHalo(logo, logoLum);
    return { dim: fallback.dim, changedText: r.changed, halo: true };
  }
  // Último recurso: contorno de color opuesto para que el texto se lea sobre cualquier cosa.
  const r = attempt(0.45, other);
  for (const t of texts) { t.stroke = hexLum(t.color) > 0.4 ? '#000000' : '#ffffff'; t.strokeW = 8; }
  if (logoLum !== null && !r.logoOk) applyLogoHalo(logo, logoLum);
  return { dim: header.dim, changedText: r.changed, stroke: true };
}

// Sombreado que sigue únicamente la forma visible del logo (sin crear ningún fondo): halo oscuro si el logo es
// claro, halo claro si es oscuro, para que se despegue del encabezado.
const LOGO_SHADOW_DEFAULT = { shadow: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 18, shadowY: 8, shadowPasses: undefined };
function applyLogoHalo(logo, lum) {
  if (!logo || logo.shadowCustom) return;
  Object.assign(logo, {
    shadow: true,
    shadowColor: lum > 0.4 ? 'rgba(0,0,0,.95)' : 'rgba(255,255,255,.95)',
    shadowBlur: 26,
    shadowY: 0,
    shadowPasses: 3,
  });
}

/* ---------- Pie ---------- */

// Abajo del último elemento de contenido (sin contar decoración ni encabezado/pie).
export function contentBottom(spec) {
  let bottom = 0;
  for (const l of spec.layers) {
    if (l.hidden || l.header || l.footer || l.locked) continue;
    if (l.type === 'text') {
      if (!l.text) continue;
      const b = measureTextBox(l);
      bottom = Math.max(bottom, b.y + b.h);
    } else {
      bottom = Math.max(bottom, l.y + l.h);
    }
  }
  return bottom;
}

/**
 * Sube las líneas de abajo (detalle, precios, vigencia, contacto) para que sigan pegadas a la anterior
 * cuando hay campos vacíos, y así dejar más lugar al pie. Nunca las baja y el primer texto visible no se mueve.
 */
const BOTTOM_ORDER = ['title', 'subtitle', 'price', 'validity', 'contact'];
export function packBottomText(spec, gap = 16) {
  let prevBottom = null;
  for (const id of BOTTOM_ORDER) {
    const l = spec.layers.find((x) => x.id === id && x.type === 'text' && !x.hidden && x.text && !x.rot);
    if (!l) continue;
    if (prevBottom !== null) {
      const off = measureTextBox(l).y - l.y; // dónde arranca el texto dentro de su caja
      const y = Math.round(prevBottom + gap - off);
      if (y < l.y) l.y = y;
    }
    const box = measureTextBox(l);
    prevBottom = box.y + box.h;
  }
}

/**
 * Reparte las imágenes del pie en una fila compacta: la del medio (si son 3) más grande y al frente,
 * y las laterales asomando por detrás de ella (no hace falta que estén separadas). Todas pegadas justo
 * debajo del contenido, lo más grandes que se pueda, y pueden salirse un poco del encuadre.
 * Devuelve [{ i, x, y, w, h }] en el orden de dibujo (la del medio queda última, al frente).
 */
export function footerGeometry(imgs, spec) {
  const n = imgs.length;
  const scale = imgs.map((_, i) => (n === 3 && i === 1 ? 1.18 : 1));
  const maxScale = Math.max(...scale);
  const ratios = imgs.map((im) => { const d = natural(im); return d.w / d.h; });
  const mid = (n - 1) / 2;
  const TUCK = 0.32;     // fracción del ancho de la imagen lateral que queda escondida detrás de la central
  const BLEED_X = 60;    // cuánto se puede salir del encuadre a los costados
  const BLEED_Y = 110;   // ...y por abajo (esa franja igual la tapa la interfaz de historias)
  const MAX_H = 520;     // altura máxima de la imagen base
  // En cada unión, la que queda detrás es la más alejada del centro.
  const behind = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (Math.abs(i - mid) >= Math.abs(i + 1 - mid) ? i : i + 1));
  const units = ratios.reduce((s, r, i) => s + r * scale[i], 0) - behind.reduce((s, b) => s + TUCK * ratios[b] * scale[b], 0);
  const top0 = contentBottom(spec) + 14;
  const bottomMax = H + BLEED_Y;
  const room = bottomMax - top0;
  const h = clamp(Math.min(room / maxScale, (W + 2 * BLEED_X) / Math.max(units, 0.5), MAX_H), 120, MAX_H);
  const sizes = imgs.map((_, i) => ({ w: Math.round(ratios[i] * h * scale[i]), h: Math.round(h * scale[i]) }));
  const tuck = behind.map((b) => Math.round(TUCK * sizes[b].w));
  const total = sizes.reduce((s, z) => s + z.w, 0) - tuck.reduce((s, t) => s + t, 0);
  const bottom = Math.min(bottomMax, Math.round(top0 + h * maxScale)); // pegado al contenido si sobra lugar
  let x = Math.round((W - total) / 2);
  const out = sizes.map((z, i) => {
    const item = { i, x, y: bottom - z.h, w: z.w, h: z.h };
    if (i < n - 1) x += z.w - tuck[i];
    return item;
  });
  return out.sort((a, b) => Math.abs(b.i - mid) - Math.abs(a.i - mid));
}
