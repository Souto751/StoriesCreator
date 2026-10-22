import { alpha, onColor, ensure, mix } from './render.js';
import { DESIGNS, DESIGN_LIST } from './designs.js';

// Categorías para agrupar la lista de plantillas en el estudio (a futuro: una gratis por categoría).
export const CATEGORIES = [
  { id: 'casino', name: 'Casino y noche' },
  { id: 'elegante', name: 'Minimalistas y elegantes' },
  { id: 'color', name: 'Coloridos y promoción' },
  { id: 'composicion', name: 'Composiciones distintas' },
];
const GROUP_OF = {
  oscuro: 'casino', neon: 'casino', jackpot: 'casino', mesa: 'casino', medianoche: 'casino', ruleta: 'casino', vegas: 'casino', cartas: 'casino', galaxia: 'casino',
  elegante: 'elegante', minimal: 'elegante', editorial: 'elegante', marfil: 'elegante', pizarra: 'elegante', nordico: 'elegante', blueprint: 'elegante', oro: 'elegante', kraft: 'elegante',
  impacto: 'color', vibrante: 'color', etiqueta: 'color', explosion: 'color', cinta: 'color', sello: 'color', confeti: 'color', retro: 'color', pop: 'color', ola: 'color', festejo: 'color',
  dividido: 'composicion', diagonal: 'composicion', panel: 'composicion', columnas: 'composicion', cupon: 'composicion', bloques: 'composicion',
};

const BASE_TEMPLATES = [
  { id: 'impacto', name: 'Impacto' },
  { id: 'vibrante', name: 'Vibrante' },
  { id: 'oscuro', name: 'Oscuro' },
  { id: 'elegante', name: 'Elegante' },
  { id: 'etiqueta', name: 'Etiqueta' },
  ...DESIGN_LIST,
];
export const TEMPLATES = BASE_TEMPLATES.map((t) => ({ ...t, group: GROUP_OF[t.id] || 'color' }));

export const KINDS = [
  { id: 'percent', name: 'Porcentaje (30%)', hint: 'Solo el número, ej. 30' },
  { id: '2x1', name: '2x1', hint: '' },
  { id: '3x2', name: '3x2', hint: '' },
  { id: 'price', name: 'Precio especial', hint: 'Ej. 9900' },
  { id: 'custom', name: 'Texto libre', hint: 'Ej. ENVÍO GRATIS' },
];

export const DEFAULT_INPUTS = {
  kind: 'percent',
  value: '30',
  headline: 'Solo este fin de semana',
  title: 'Tu producto o servicio',
  subtitle: '',
  oldPrice: '',
  newPrice: '',
  validity: '',
  useLogo: true,
  usePhoto: true,
};

const money = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && /\d/.test(s) ? `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : s;
};

// Textos derivados de los datos del formulario y la marca.
export function deriveTexts(inputs, brand) {
  let big = '', bigsub = '';
  const value = String(inputs.value ?? '').trim();
  switch (inputs.kind) {
    case 'percent': big = value ? `${value.replace(/[^\d]/g, '').slice(0, 3)}%` : ''; bigsub = 'DE DESCUENTO'; break;
    case '2x1': big = '2x1'; bigsub = 'LLEVÁ 2, PAGÁ 1'; break;
    case '3x2': big = '3x2'; bigsub = 'LLEVÁ 3, PAGÁ 2'; break;
    case 'price': big = money(value); bigsub = 'PRECIO ESPECIAL'; break;
    default: big = value; bigsub = '';
  }
  const price = inputs.newPrice
    ? (inputs.oldPrice ? `Antes ${money(inputs.oldPrice)}  ·  Ahora ${money(inputs.newPrice)}` : `Ahora ${money(inputs.newPrice)}`)
    : '';
  const contact = [
    brand.phone,
    brand.instagram ? `@${brand.instagram.replace(/^@/, '')}` : '',
    brand.website,
    brand.address,
  ].filter(Boolean).join('  ·  ');
  return {
    brandname: brand.name || '',
    headline: inputs.headline || '',
    big, bigsub,
    title: inputs.title || '',
    subtitle: inputs.subtitle || '',
    price,
    validity: inputs.validity || '',
    contact,
  };
}

function palette(id, b, hasPhoto) {
  const dark = '#0e0e13';
  switch (id) {
    case 'vibrante': {
      const bg = { type: 'gradient', c1: b.primary, c2: b.secondary, angle: 70 };
      const mid = mix(b.primary, b.secondary, 0.5);
      const ink = onColor(mid);
      return { bg, ink, headline: ink, big: ensure(b.accent, mid, 2.2), badge: b.accent, badgeInk: onColor(b.accent), cta: b.accent, ctaInk: onColor(b.accent), accent: b.accent, font: b.font, decorKey: 'vibrante' };
    }
    case 'oscuro': {
      const bigColor = ensure(b.primary, dark, 3);
      return { bg: { type: 'solid', c1: dark }, ink: '#ffffff', headline: ensure(b.accent, dark), big: bigColor, badge: b.primary, badgeInk: onColor(b.primary), cta: b.primary, ctaInk: onColor(b.primary), accent: b.accent, font: b.font, decorKey: 'oscuro' };
    }
    case 'elegante': {
      const paper = '#faf7f2';
      const ink = ensure(b.secondary, paper, 6);
      return { bg: { type: 'solid', c1: paper }, ink, headline: ensure(b.primary, paper, 4), big: ensure(b.primary, paper, 4), badge: b.primary, badgeInk: onColor(b.primary), cta: ink, ctaInk: onColor(ink), accent: b.primary, font: 'Georgia', decorKey: 'elegante' };
    }
    case 'etiqueta': {
      const bigColor = hasPhoto ? ensure(b.primary, '#ffffff', 3) : onColor(b.primary);
      return { bg: { type: 'solid', c1: '#ffffff' }, ink: '#141414', headline: ensure(b.primary, '#ffffff', 3.5), big: bigColor, badge: b.primary, badgeInk: onColor(b.primary), cta: b.primary, ctaInk: onColor(b.primary), accent: b.primary, font: b.font, decorKey: 'etiqueta' };
    }
    default: {
      return { bg: { type: 'solid', c1: b.primary }, ink: onColor(b.primary), headline: ensure(b.accent, b.primary, 2.2), big: ensure(b.accent, b.primary, 2.2), badge: b.accent, badgeInk: onColor(b.accent), cta: b.accent, ctaInk: onColor(b.accent), accent: b.accent, font: b.font, decorKey: 'impacto' };
    }
  }
}

function decor(p, b, hasPhoto) {
  const L = (o) => ({ type: 'rect', fill: '#000', locked: true, ...o });
  switch (p.decorKey) {
    case 'impacto':
      return [
        L({ id: 'd1', type: 'ellipse', name: 'Círculo', x: 560, y: -220, w: 760, h: 760, fill: alpha(onColor(b.primary), 0.09) }),
        L({ id: 'd2', type: 'ellipse', name: 'Círculo 2', x: -260, y: 1380, w: 680, h: 680, fill: alpha(b.secondary, 0.4) }),
      ];
    case 'vibrante':
      return [
        L({ id: 'd1', name: 'Franja', x: -300, y: 330, w: 1700, h: 210, rot: -18, fill: 'rgba(255,255,255,.08)' }),
        L({ id: 'd2', name: 'Franja 2', x: -300, y: 1330, w: 1700, h: 280, rot: -18, fill: 'rgba(255,255,255,.08)' }),
      ];
    case 'oscuro':
      return [
        L({ id: 'd1', type: 'ellipse', name: 'Resplandor', x: 100, y: 470, w: 880, h: 880, fill: alpha(b.primary, 0.2) }),
        L({ id: 'd2', name: 'Barra superior', x: 0, y: 0, w: 1080, h: 26, fill: b.primary }),
        L({ id: 'd3', name: 'Barra inferior', x: 0, y: 1894, w: 1080, h: 26, fill: b.primary }),
      ];
    case 'elegante':
      return [
        L({ id: 'd1', name: 'Marco', x: 54, y: 54, w: 972, h: 1812, fill: 'transparent', stroke: b.primary, strokeW: 6 }),
        L({ id: 'd2', name: 'Marco interno', x: 84, y: 84, w: 912, h: 1752, fill: 'transparent', stroke: alpha(b.primary, 0.45), strokeW: 2 }),
      ];
    case 'etiqueta':
      return [
        L({ id: 'd1', name: 'Etiqueta', x: 70, y: 510, w: 940, h: 625, r: 56, rot: -3, fill: b.primary, shadow: true }),
        L({ id: 'd2', type: 'ellipse', name: 'Agujero', x: 128, y: 560, w: 46, h: 46, rot: 0, fill: '#ffffff' }),
      ];
    default:
      return [];
  }
}

const T = (id, text, o) => ({ id, type: 'text', text, fit: true, lh: 1.1, align: 'center', valign: 'middle', weight: '900', name: id, ...o });

// Posición y tamaño base de cada texto (los diseños del catálogo pueden ajustar cualquiera).
const BASE_TEXT = {
  headline: { name: 'Titular', x: 80, y: 410, w: 920, h: 110, size: 60, upper: true },
  big: { name: 'Descuento', x: 40, y: 540, w: 1000, h: 470, size: 470 },
  bigsub: { name: 'Descuento (detalle)', x: 60, y: 1010, w: 960, h: 100, size: 78 },
  title: { name: 'Producto', x: 80, y: 1185, w: 920, h: 120, size: 78 },
  subtitle: { name: 'Detalle', x: 80, y: 1310, w: 920, h: 60, size: 42, weight: '600' },
  price: { name: 'Precios', x: 80, y: 1375, w: 920, h: 85, size: 66 },
  validity: { name: 'Vigencia', x: 80, y: 1470, w: 920, h: 48, size: 34, weight: '600' },
  contact: { name: 'Contacto', x: 60, y: 1545, w: 960, h: 44, size: 32, weight: '600' },
};
const TEXT_ORDER = ['headline', 'big', 'bigsub', 'title', 'subtitle', 'price', 'validity', 'contact'];
const WITH_FONT = new Set(['headline', 'big', 'bigsub', 'title', 'price']);

// Diseños del catálogo (designs.js): decoración + colores + ajustes de cada texto.
function buildFromCatalog(def, templateId, brand, t, hasLogo) {
  const d = def.build(brand);
  const layers = [...d.decor];
  if (hasLogo) layers.push({ id: 'logo', type: 'image', src: 'logo', name: 'Logo', x: 260, y: 262, w: 560, h: 140, fit: 'contain', shadow: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 18, shadowY: 8, ...(d.logo || {}) });
  const colors = Object.fromEntries(TEXT_ORDER.map((id) => [id, d.ink]));
  Object.assign(colors, d.colors || {});
  for (const id of TEXT_ORDER) {
    layers.push(T(id, t[id], { ...BASE_TEXT[id], bind: id, color: colors[id], ...(WITH_FONT.has(id) ? { family: d.font } : {}), ...((d.layout || {})[id] || {}) }));
  }
  for (const l of layers) if (l.bind) l.hidden = !t[l.bind];
  return { template: templateId, bg: d.bg, layers, assets: {} };
}

// Crea la spec (fondo + capas) completa para una plantilla.
export function buildDesign(templateId, inputs, brand, { hasLogo = false, hasPhoto = false } = {}) {
  if (DESIGNS[templateId]) return buildFromCatalog(DESIGNS[templateId], templateId, brand, deriveTexts(inputs, brand), hasLogo);
  const p = palette(templateId, brand, hasPhoto);
  const t = deriveTexts(inputs, brand);
  const layers = [...decor(p, brand, hasPhoto)];

  // El logo va siempre (si la marca tiene uno), centrado arriba; el nombre de la marca no se muestra.
  if (hasLogo) layers.push({ id: 'logo', type: 'image', src: 'logo', name: 'Logo', x: 260, y: 262, w: 560, h: 140, fit: 'contain', shadow: true, shadowColor: 'rgba(0,0,0,.6)', shadowBlur: 18, shadowY: 8 });
  layers.push(T('headline', t.headline, { name: 'Titular', bind: 'headline', x: 80, y: 410, w: 920, h: 110, size: 60, color: p.headline, upper: true, family: p.font }));

  if (hasPhoto) {
    layers.push({ id: 'photo', type: 'image', src: 'photo', name: 'Foto', x: 90, y: 535, w: 900, h: 545, fit: 'cover', r: 40, shadow: true });
    layers.push({ id: 'badge', type: 'ellipse', name: 'Sello', x: 715, y: 850, w: 310, h: 310, fill: p.badge, shadow: true, stroke: '#ffffff', strokeW: 8 });
    layers.push(T('big', t.big, { name: 'Descuento', bind: 'big', x: 745, y: 895, w: 250, h: 135, size: 135, color: p.badgeInk, family: p.font }));
    layers.push(T('bigsub', t.bigsub, { name: 'Descuento (detalle)', bind: 'bigsub', x: 745, y: 1036, w: 250, h: 50, size: 28, color: p.badgeInk, family: p.font }));
  } else {
    layers.push(T('big', t.big, { name: 'Descuento', bind: 'big', x: 40, y: 540, w: 1000, h: 470, size: 470, color: p.big, family: p.font }));
    layers.push(T('bigsub', t.bigsub, { name: 'Descuento (detalle)', bind: 'bigsub', x: 60, y: 1010, w: 960, h: 100, size: 78, color: templateId === 'etiqueta' ? onColor(brand.primary) : p.ink, family: p.font }));
  }

  layers.push(T('title', t.title, { name: 'Producto', bind: 'title', x: 80, y: 1185, w: 920, h: 120, size: 78, color: p.ink, family: p.font }));
  layers.push(T('subtitle', t.subtitle, { name: 'Detalle', bind: 'subtitle', x: 80, y: 1310, w: 920, h: 60, size: 42, weight: '600', color: p.ink }));
  layers.push(T('price', t.price, { name: 'Precios', bind: 'price', x: 80, y: 1375, w: 920, h: 85, size: 66, color: p.big === p.ink ? p.ink : p.headline, family: p.font }));
  layers.push(T('validity', t.validity, { name: 'Vigencia', bind: 'validity', x: 80, y: 1470, w: 920, h: 48, size: 34, weight: '600', color: p.ink }));
  layers.push(T('contact', t.contact, { name: 'Contacto', bind: 'contact', x: 60, y: 1545, w: 960, h: 44, size: 32, weight: '600', color: p.ink }));

  for (const l of layers) {
    if (l.bind) l.hidden = !t[l.bind];
    if (l.showIf) l.hidden = !t[l.showIf];
  }
  return { template: templateId, bg: p.bg, layers, assets: {} };
}

// Actualiza in situ los textos ligados al formulario, sin mover lo que el usuario ya acomodó.
export function patchTexts(spec, inputs, brand) {
  const t = deriveTexts(inputs, brand);
  for (const l of spec.layers) {
    if (l.bind && l.bind in t) { l.text = t[l.bind]; l.hidden = !t[l.bind]; }
    if (l.showIf) l.hidden = !t[l.showIf];
  }
}
