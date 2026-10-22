// Quita el "falso fondo transparente": muchas imágenes que se bajan de internet traen pintado el
// cuadriculado gris/blanco (o rosa/blanco) en lugar de transparencia real. Se detecta ese patrón en
// los bordes y se borra solo el fondo conectado al borde, dejando intacto lo que está dentro del dibujo.

const dist2 = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

// Distancia (al cuadrado) de un color al segmento entre A y B: cubre los tonos intermedios que deja el suavizado.
function distToSegment2(r, g, b, A, B) {
  const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  let t = ((r - A[0]) * abx + (g - A[1]) * aby + (b - A[2]) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = A[0] + abx * t - r, py = A[1] + aby * t - g, pz = A[2] + abz * t - b;
  return px * px + py * py + pz * pz;
}

// Los dos colores dominantes del borde. Devuelve null si el borde no es un cuadriculado.
function borderColors(d, w, h) {
  const ring = 3;
  const px = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) px.push((y * w + x) * 4);
    }
  }
  const bucket = (i) => ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
  const top = (list) => {
    const counts = new Map();
    for (const i of list) counts.set(bucket(i), (counts.get(bucket(i)) || 0) + 1);
    let best = null, n = 0;
    for (const [k, c] of counts) if (c > n) { best = k; n = c; }
    if (best === null) return null;
    let sr = 0, sg = 0, sb = 0, m = 0;
    for (const i of list) if (bucket(i) === best) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; m++; }
    return { color: [sr / m, sg / m, sb / m], share: m / px.length };
  };
  const A = top(px);
  if (!A || A.share < 0.18) return null;
  const rest = px.filter((i) => dist2(d[i], d[i + 1], d[i + 2], A.color) > 34 * 34);
  const B = top(rest);
  if (!B || B.share < 0.18) return null;
  const sep = Math.sqrt(dist2(A.color[0], A.color[1], A.color[2], B.color));
  if (sep < 8 || sep > 200) return null;
  if (A.share + B.share < 0.6) return null;
  return [A.color, B.color];
}

// Cuenta cuántas veces alterna el borde entre los dos colores (un cuadriculado alterna muchas veces).
function alternations(d, w, h, A, B) {
  const cls = (i) => (dist2(d[i], d[i + 1], d[i + 2], A) <= dist2(d[i], d[i + 1], d[i + 2], B) ? 0 : 1);
  const tol = 34 * 34;
  const ok = (i) => distToSegment2(d[i], d[i + 1], d[i + 2], A, B) <= tol;
  const count = (idx) => {
    let last = -1, n = 0;
    for (const i of idx) { if (!ok(i)) continue; const c = cls(i); if (last !== -1 && c !== last) n++; last = c; }
    return n;
  };
  const row = (y) => Array.from({ length: w }, (_, x) => (y * w + x) * 4);
  const col = (x) => Array.from({ length: h }, (_, y) => (y * w + x) * 4);
  return Math.max(count(row(1)), count(row(h - 2)), count(col(1)), count(col(w - 2)));
}

/**
 * Recibe una imagen ya cargada. Devuelve { canvas, cleared } con el fondo cuadriculado vuelto transparente,
 * o null si no se detecta un cuadriculado (o la imagen ya tiene transparencia real).
 */
export function removeCheckerboard(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (w < 48 || h < 48) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const total = w * h;

  // Ya tiene transparencia real: no tocar.
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  if (transparent > total * 0.02) return null;

  const pair = borderColors(d, w, h);
  if (!pair) return null;
  const [A, B] = pair;
  if (alternations(d, w, h, A, B) < 6) return null; // fondo liso o degradé: no es un cuadriculado

  const TOL = 34 * 34;
  const like = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    like[p] = distToSegment2(d[i], d[i + 1], d[i + 2], A, B) <= TOL ? 1 : 0;
  }

  const clear = new Uint8Array(total);
  const stack = [];
  const push = (p) => { if (like[p] && !clear[p]) { clear[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < total - w) push(p + w);
  }

  // Huecos cerrados que también son cuadriculado (entre brazos, dentro de un aro): se reconocen porque
  // mezclan los dos colores; una zona blanca real del dibujo es de un solo color y se respeta.
  const seen = new Uint8Array(total);
  for (let s = 0; s < total; s++) {
    if (!like[s] || clear[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    let nA = 0, nB = 0;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k], i = p * 4;
      if (dist2(d[i], d[i + 1], d[i + 2], A) <= dist2(d[i], d[i + 1], d[i + 2], B)) nA++; else nB++;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < total - w ? p + w : -1];
      for (const q of nb) if (q >= 0 && like[q] && !clear[q] && !seen[q]) { seen[q] = 1; comp.push(q); }
    }
    if (comp.length >= 300 && Math.min(nA, nB) >= comp.length * 0.2) for (const p of comp) clear[p] = 1;
  }

  // Un paso para el "halo" de píxeles suavizados pegados al borde del recorte.
  const HALO = 52 * 52;
  const edge = [];
  for (let p = 0; p < total; p++) {
    if (clear[p]) continue;
    const x = p % w;
    const touches = (x > 0 && clear[p - 1]) || (x < w - 1 && clear[p + 1]) || (p >= w && clear[p - w]) || (p < total - w && clear[p + w]);
    if (!touches) continue;
    const i = p * 4;
    if (distToSegment2(d[i], d[i + 1], d[i + 2], A, B) <= HALO) edge.push(p);
  }
  for (const p of edge) clear[p] = 1;

  let cleared = 0;
  for (let p = 0; p < total; p++) if (clear[p]) { d[p * 4 + 3] = 0; cleared++; }
  // Solo si de verdad había un fondo: ni casi nada ni casi todo.
  if (cleared < total * 0.04 || cleared > total * 0.92) return null;
  ctx.putImageData(data, 0, 0);
  return { canvas, cleared: cleared / total };
}
