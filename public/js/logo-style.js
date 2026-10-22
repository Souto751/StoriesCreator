// Deduce colores y tipografía a partir del logo (píxeles reales, ignorando transparencia, blancos, negros y grises).

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
}
function hsl2hex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
const lumOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function analyzeLogo(img, fonts = []) {
  const S = 96;
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return null;
  const k = Math.min(1, S / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // Si el logo no tiene transparencia, se ignora el color de fondo (esquinas).
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) { hasAlpha = true; break; }
  const corner = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4].map((i) => [d[i], d[i + 1], d[i + 2]]);
  const isBg = (r, g, b) => !hasAlpha && corner.some((q) => (r - q[0]) ** 2 + (g - q[1]) ** 2 + (b - q[2]) ** 2 < 30 * 30);

  const buckets = new Map(); // tono (24 pasos) x luminosidad (3 niveles)
  let ink = 0, total = 0, minX = w, maxX = 0, minY = h, maxY = 0, neutralLight = 0, neutralDark = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (isBg(r, g, b)) continue;
    ink++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const [hh, s, l] = rgb2hsl(r, g, b);
    if (s < 0.22 || l > 0.93 || l < 0.07) { if (l > 0.6) neutralLight++; else neutralDark++; continue; }
    total++;
    const key = Math.floor(hh / 15) * 3 + (l < 0.33 ? 0 : l < 0.62 ? 1 : 2);
    const e = buckets.get(key) || { n: 0, h: 0, hx: 0, hy: 0, s: 0, l: 0 };
    e.n++; e.s += s; e.l += l;
    e.hx += Math.cos((hh * Math.PI) / 180); e.hy += Math.sin((hh * Math.PI) / 180);
    buckets.set(key, e);
  }
  if (!ink) return null;
  const bbox = (maxX - minX + 1) * (maxY - minY + 1);
  const coverage = ink / Math.max(bbox, 1);
  const aspect = (maxX - minX + 1) / (maxY - minY + 1);

  const cols = [...buckets.values()].map((e) => ({
    n: e.n, h: (Math.atan2(e.hy, e.hx) * 180) / Math.PI + (Math.atan2(e.hy, e.hx) < 0 ? 360 : 0), s: e.s / e.n, l: e.l / e.n,
  })).sort((a, b) => b.n - a.n);

  const pick = (list, fn) => list.find(fn);
  let primary, secondary, accent;
  if (!cols.length) {
    // Logo en blanco/negro/gris: paleta neutra con un acento dorado.
    const dark = neutralDark >= neutralLight;
    primary = dark ? '#1a1a1a' : '#f2f2f2';
    secondary = dark ? '#000000' : '#333333';
    accent = '#ffd166';
  } else {
    const p = cols[0];
    primary = hsl2hex(p.h, Math.min(1, Math.max(0.55, p.s)), Math.min(0.58, Math.max(0.42, p.l)));
    const other = pick(cols, (c) => hueDist(c.h, p.h) > 35 && c.n > total * 0.08);
    // Secundario: versión oscura del color principal (sirve de fondo y mantiene la identidad del logo).
    secondary = hsl2hex(p.h, Math.min(0.7, Math.max(0.35, p.s)), 0.15);
    // Acento: otro color vivo del logo si lo hay; si no, un dorado cálido que contrasta con casi todo.
    accent = other ? hsl2hex(other.h, Math.max(0.7, other.s), Math.min(0.66, Math.max(0.5, other.l))) : '#ffd166';
  }
  const text = lumOf(secondary) > 0.55 ? '#111111' : '#ffffff';

  // Tipografía según el peso visual del logo: compacto y macizo -> extranegrita; fino -> serif elegante.
  const has = (f) => !fonts.length || fonts.includes(f);
  let font = 'Arial Black';
  if (coverage < 0.28) font = has('Georgia') ? 'Georgia' : 'system-ui';
  else if (coverage < 0.45) font = has('Trebuchet MS') ? 'Trebuchet MS' : 'system-ui';
  else if (aspect > 3.4) font = has('Impact') ? 'Impact' : 'Arial Black';
  return { primary, secondary, accent, text, font, coverage };
}
