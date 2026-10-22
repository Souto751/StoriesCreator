// Motor de dibujo: convierte una "spec" (fondo + capas) en píxeles sobre un canvas 2D.
export const W = 1080;
export const H = 1920;
export const SAFE = { top: 250, bottom: 240 }; // zonas que tapa la interfaz de historias

/* ---------- Color ---------- */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const alpha = (hex, a) => { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const onColor = (bg) => (contrast(bg, '#111111') >= contrast(bg, '#ffffff') ? '#111111' : '#ffffff');
// Garantiza texto legible: si el color pedido contrasta poco con el fondo, usa blanco o negro.
export const ensure = (fg, bg, min = 3.2) => (contrast(fg, bg) >= min ? fg : onColor(bg));
export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = (p, q) => Math.round(p + (q - p) * t).toString(16).padStart(2, '0');
  return `#${c(x.r, y.r)}${c(x.g, y.g)}${c(x.b, y.b)}`;
}

/* ---------- Texto ---------- */
function breakLongWord(ctx, word, maxW) {
  const parts = [];
  let cur = '';
  for (const ch of word) {
    if (cur && ctx.measureText(cur + ch).width > maxW) { parts.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const rawWord of words) {
      const pieces = ctx.measureText(rawWord).width > maxW ? breakLongWord(ctx, rawWord, maxW) : [rawWord];
      for (const word of pieces) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

const fontFamily = (name) => (name === 'system-ui' ? 'system-ui, sans-serif' : `"${name || 'Arial'}", Arial, sans-serif`);

function layoutText(ctx, layer) {
  const raw = String(layer.text ?? '');
  const text = layer.upper ? raw.toUpperCase() : raw;
  const lh = layer.lh || 1.1;
  const weight = layer.weight || '700';
  let size = Math.max(8, layer.size || 48);
  const min = Math.min(size, 20);
  for (;;) {
    ctx.font = `${weight} ${size}px ${fontFamily(layer.family)}`;
    const lines = wrapText(ctx, text, layer.w);
    const height = lines.length * size * lh;
    const fits = height <= layer.h + 0.5 && lines.every((l) => ctx.measureText(l).width <= layer.w + 0.5);
    if (!layer.fit || fits || size <= min) return { lines, size, lh, height };
    size -= 2;
  }
}

// Caja real que ocupa el texto (no la caja del elemento), para saber sobre qué píxeles se apoya.
let scratchCtx = null;
export function measureTextBox(layer) {
  scratchCtx = scratchCtx || document.createElement('canvas').getContext('2d');
  const { lines, height } = layoutText(scratchCtx, layer);
  const w = Math.min(layer.w, Math.max(1, ...lines.map((l) => scratchCtx.measureText(l).width)));
  const align = layer.align || 'center';
  const x = align === 'left' ? layer.x : align === 'right' ? layer.x + layer.w - w : layer.x + (layer.w - w) / 2;
  const y = layer.valign === 'top' ? layer.y : layer.valign === 'bottom' ? layer.y + layer.h - height : layer.y + (layer.h - height) / 2;
  return { x, y, w, h: height };
}

function drawText(ctx, layer, x, y) {
  if (!layer.text) return;
  const { lines, size, lh, height } = layoutText(ctx, layer);
  ctx.fillStyle = layer.color || '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = layer.align || 'center';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${layer.ls || 0}px`;
  const ax = ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x + layer.w : x + layer.w / 2;
  const startY = layer.valign === 'top' ? y : layer.valign === 'bottom' ? y + layer.h - height : y + (layer.h - height) / 2;
  lines.forEach((line, i) => {
    const cy = startY + (i + 0.5) * size * lh;
    if (layer.stroke && layer.strokeW) {
      ctx.lineWidth = layer.strokeW;
      ctx.strokeStyle = layer.stroke;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, ax, cy);
    }
    ctx.fillText(line, ax, cy);
    if (layer.strike && line) {
      const w = ctx.measureText(line).width;
      const sx = ctx.textAlign === 'left' ? ax : ctx.textAlign === 'right' ? ax - w : ax - w / 2;
      ctx.fillRect(sx, cy - size * 0.02, w, Math.max(3, size * 0.07));
    }
  });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/* ---------- Formas e imágenes ---------- */
function makeFill(ctx, fill, w, h) {
  if (fill && typeof fill === 'object') {
    const ang = ((fill.angle ?? 135) * Math.PI) / 180;
    const dx = (Math.cos(ang) * w) / 2, dy = (Math.sin(ang) * h) / 2;
    const g = ctx.createLinearGradient(-dx, -dy, dx, dy);
    g.addColorStop(0, fill.from);
    g.addColorStop(1, fill.to);
    return g;
  }
  return fill || 'transparent';
}

function shapePath(ctx, layer, x, y) {
  ctx.beginPath();
  if (layer.type === 'ellipse') ctx.ellipse(x + layer.w / 2, y + layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x, y, layer.w, layer.h, Math.max(0, Math.min(layer.r || 0, layer.w / 2, layer.h / 2)));
}

function drawImageLayer(ctx, layer, x, y, assets) {
  const img = assets[layer.src];
  if (!img) {
    ctx.save();
    ctx.setLineDash([16, 12]);
    ctx.strokeStyle = 'rgba(128,128,128,.8)';
    ctx.lineWidth = 4;
    shapePath(ctx, { ...layer, type: 'rect' }, x, y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  // Solo se recorta si hace falta (fit "cover" o esquinas redondeadas). Con "contain" sin redondeo no se recorta,
  // así la sombra sigue únicamente la parte visible de la imagen (respeta la transparencia del PNG).
  if (layer.fit !== 'contain' || (layer.r || 0) > 0) {
    shapePath(ctx, { ...layer, type: 'rect' }, x, y);
    ctx.clip();
  }
  const k = (layer.fit === 'contain' ? Math.min : Math.max)(layer.w / img.width, layer.h / img.height);
  const dw = img.width * k, dh = img.height * k;
  if (layer.fadeTop || layer.fadeBottom || layer.dim) {
    // Efectos "de acople": atenuado (oscurece/aclara la imagen) y fundido de los bordes con el fondo.
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.ceil(layer.w));
    off.height = Math.max(1, Math.ceil(layer.h));
    const o = off.getContext('2d');
    o.drawImage(img, (layer.w - dw) / 2, (layer.h - dh) / 2, dw, dh);
    if (layer.dim) {
      o.globalCompositeOperation = 'source-atop';
      o.fillStyle = alpha(layer.dimColor || '#000000', Math.min(1, layer.dim));
      o.fillRect(0, 0, off.width, off.height);
    }
    if (layer.fadeTop || layer.fadeBottom) {
      o.globalCompositeOperation = 'destination-in';
      const g = o.createLinearGradient(0, 0, 0, off.height);
      const ft = Math.min(0.9, (layer.fadeTop || 0) / layer.h), fb = Math.min(0.9, (layer.fadeBottom || 0) / layer.h);
      g.addColorStop(0, ft ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
      g.addColorStop(Math.max(0.0001, ft), 'rgba(0,0,0,1)');
      g.addColorStop(Math.min(0.9999, 1 - fb), 'rgba(0,0,0,1)');
      g.addColorStop(1, fb ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
      o.fillStyle = g;
      o.fillRect(0, 0, off.width, off.height);
    }
    ctx.drawImage(off, x, y);
  } else {
    ctx.drawImage(img, x + (layer.w - dw) / 2, y + (layer.h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

export function drawLayer(ctx, layer, assets = {}) {
  if (layer.hidden) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
  ctx.rotate(((layer.rot || 0) * Math.PI) / 180);
  const x = -layer.w / 2, y = -layer.h / 2;
  if (layer.shadow) {
    ctx.shadowColor = layer.shadowColor || 'rgba(0,0,0,.35)';
    ctx.shadowBlur = layer.shadowBlur ?? 36;
    ctx.shadowOffsetY = layer.shadowY ?? 14;
  }
  if (layer.type === 'rect' || layer.type === 'ellipse') {
    shapePath(ctx, layer, x, y);
    ctx.fillStyle = makeFill(ctx, layer.fill, layer.w, layer.h);
    ctx.fill();
    if (layer.stroke && layer.strokeW) {
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = layer.strokeW;
      ctx.strokeStyle = layer.stroke;
      if (layer.dash) ctx.setLineDash(layer.dash);
      ctx.stroke();
    }
  } else if (layer.type === 'text') {
    drawText(ctx, layer, x, y);
  } else if (layer.type === 'image') {
    // shadowPasses > 1 repite el dibujo para reforzar el sombreado (halo) que sigue la forma de la imagen.
    for (let k = 0; k < (layer.shadow && layer.shadowPasses ? layer.shadowPasses : 1); k++) drawImageLayer(ctx, layer, x, y, assets);
  }
  ctx.restore();
}

/* ---------- Diseño completo ---------- */
export function drawBackground(ctx, bg) {
  if (bg && bg.type === 'gradient') {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = makeFill(ctx, { from: bg.c1, to: bg.c2, angle: bg.angle ?? 70 }, W, H);
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.restore();
  } else {
    ctx.fillStyle = (bg && bg.c1) || '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }
}

export function drawDesign(ctx, spec, assets = {}) {
  drawBackground(ctx, spec.bg);
  for (const layer of spec.layers) drawLayer(ctx, layer, assets);
}

/* ---------- Geometría para el editor ---------- */
export function toLocal(layer, px, py) {
  const a = (-(layer.rot || 0) * Math.PI) / 180;
  const dx = px - (layer.x + layer.w / 2), dy = py - (layer.y + layer.h / 2);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
export function hitLayer(layer, px, py) {
  if (layer.hidden || layer.locked) return false;
  const p = toLocal(layer, px, py);
  return Math.abs(p.x) <= layer.w / 2 && Math.abs(p.y) <= layer.h / 2;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = src;
  });
}
