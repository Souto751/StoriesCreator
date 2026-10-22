// Catálogo de diseños adicionales. Cada uno recibe la marca y devuelve: fondo, colores de texto,
// decoración (capas bloqueadas) y ajustes de posición/alineación de cada texto. Los colores se calculan
// con ensure()/onColor() para que el texto se lea sea cual sea la paleta de la marca.
import { alpha, onColor, ensure, mix } from './render.js';

const R = (o) => ({ type: 'rect', fill: '#000', locked: true, ...o });
const E = (o) => R({ type: 'ellipse', ...o });
const ids = (list) => list.map((l, i) => ({ id: `d${i + 1}`, ...l }));

// Generador pseudoaleatorio con semilla: el confeti es siempre el mismo para la misma marca.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Centro de un rectángulo girado, desplazado `d` px sobre su eje perpendicular (para franjas paralelas).
const shift = (cx, cy, rot, d) => {
  const a = (rot * Math.PI) / 180;
  return { x: cx - d * Math.sin(a), y: cy + d * Math.cos(a) };
};

const DARK = '#0e0e13';

export const DESIGNS = {
  /* ---------- Casino / neón ---------- */
  neon: {
    name: 'Neón',
    build(b) {
      const bg = '#08040f';
      const neon = ensure(mix(b.primary, '#ffffff', 0.25), bg, 4.5);
      const neon2 = ensure(mix(b.accent, '#ffffff', 0.2), bg, 4.5);
      const glow = (c, blur = 46) => ({ shadow: true, shadowColor: c, shadowBlur: blur, shadowY: 0 });
      const frame = (inset, r) => [
        R({ name: 'Neón (halo)', x: inset, y: inset, w: 1080 - 2 * inset, h: 1920 - 2 * inset, r, fill: 'transparent', stroke: alpha(neon, 0.1), strokeW: 34 }),
        R({ name: 'Neón (brillo)', x: inset, y: inset, w: 1080 - 2 * inset, h: 1920 - 2 * inset, r, fill: 'transparent', stroke: alpha(neon, 0.28), strokeW: 16 }),
        R({ name: 'Neón (tubo)', x: inset, y: inset, w: 1080 - 2 * inset, h: 1920 - 2 * inset, r, fill: 'transparent', stroke: neon, strokeW: 5 }),
      ];
      return {
        bg: { type: 'solid', c1: bg }, ink: '#ffffff', font: b.font,
        colors: { headline: neon2, big: '#ffffff', bigsub: neon, price: neon2 },
        decor: ids([
          E({ name: 'Resplandor', x: -300, y: 1200, w: 900, h: 900, fill: alpha(b.secondary, 0.35) }),
          E({ name: 'Resplandor 2', x: 640, y: -260, w: 800, h: 800, fill: alpha(neon, 0.16) }),
          ...frame(46, 70),
        ]),
        layout: {
          headline: glow(neon2, 30),
          big: { ...glow(neon, 70), y: 560, h: 450 },
          bigsub: glow(neon, 30),
        },
      };
    },
  },

  jackpot: {
    name: 'Jackpot',
    build(b) {
      const gold = '#f5c542', goldL = '#fff2b0';
      const rays = Array.from({ length: 8 }, (_, k) => R({ name: `Rayo ${k + 1}`, x: -300, y: 715, w: 1680, h: 84, rot: k * 22.5, fill: alpha(gold, 0.07) }));
      return {
        bg: { type: 'gradient', c1: '#2b0a4d', c2: '#050008', angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: goldL, big: goldL, bigsub: gold, price: goldL },
        decor: ids([
          ...rays,
          E({ name: 'Resplandor', x: 90, y: 300, w: 900, h: 900, fill: alpha(gold, 0.13) }),
          R({ name: 'Barra superior', x: 0, y: 0, w: 1080, h: 22, fill: gold }),
          R({ name: 'Barra inferior', x: 0, y: 1898, w: 1080, h: 22, fill: gold }),
        ]),
        layout: {
          big: { stroke: '#7a4a00', strokeW: 12, shadow: true, shadowColor: gold, shadowBlur: 60, shadowY: 0 },
          headline: { shadow: true, shadowColor: 'rgba(0,0,0,.7)', shadowBlur: 12, shadowY: 4 },
        },
      };
    },
  },

  mesa: {
    name: 'Mesa verde',
    build(b) {
      const gold = '#f6d365';
      const chip = (x, y, d, c) => [
        E({ name: 'Ficha', x, y, w: d, h: d, fill: c, stroke: '#ffffff', strokeW: 12 }),
        E({ name: 'Ficha (aro)', x: x + d * 0.2, y: y + d * 0.2, w: d * 0.6, h: d * 0.6, fill: 'transparent', stroke: alpha('#ffffff', 0.75), strokeW: 5 }),
      ];
      return {
        bg: { type: 'gradient', c1: '#0e6b43', c2: '#04291a', angle: 80 }, ink: '#ffffff', font: b.font,
        colors: { headline: gold, big: gold, bigsub: '#ffffff', price: gold },
        decor: ids([
          R({ name: 'Borde dorado', x: 40, y: 40, w: 1000, h: 1840, r: 70, fill: 'transparent', stroke: gold, strokeW: 10 }),
          R({ name: 'Borde interno', x: 72, y: 72, w: 936, h: 1776, r: 50, fill: 'transparent', stroke: alpha(gold, 0.4), strokeW: 3 }),
          ...chip(-80, 1610, 200, '#c1121f'),
          ...chip(900, 1650, 190, '#1d4ed8'),
          ...chip(900, 250, 190, '#111111'),
        ]),
        layout: { big: { stroke: '#04291a', strokeW: 14, shadow: true, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 24, shadowY: 10 } },
      };
    },
  },

  medianoche: {
    name: 'Medianoche',
    build(b) {
      const ac = ensure(b.accent, '#05101f', 4);
      const lines = Array.from({ length: 9 }, (_, k) => R({ name: `Línea ${k + 1}`, x: 0, y: 200 + k * 190, w: 1080, h: 2, fill: alpha('#ffffff', 0.05) }));
      const L = { align: 'left' };
      return {
        bg: { type: 'gradient', c1: '#0b1f45', c2: '#02060f', angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: ac, big: '#ffffff', bigsub: ac, price: ac },
        decor: ids([
          ...lines,
          E({ name: 'Resplandor', x: 520, y: -240, w: 900, h: 900, fill: alpha(ac, 0.16) }),
          R({ name: 'Barra', x: 60, y: 430, w: 8, h: 1120, fill: ac }),
        ]),
        layout: {
          headline: { ...L, x: 100, w: 900 }, big: { ...L, x: 90, w: 940, shadow: true, shadowColor: alpha(ac, 0.7), shadowBlur: 50, shadowY: 0 },
          bigsub: { ...L, x: 100, w: 900 }, title: { ...L, x: 100, w: 900 }, subtitle: { ...L, x: 100, w: 900 },
          price: { ...L, x: 100, w: 900 }, validity: { ...L, x: 100, w: 900 }, contact: { ...L, x: 100, w: 900 },
        },
      };
    },
  },

  /* ---------- Minimalista / elegante ---------- */
  minimal: {
    name: 'Minimal',
    build(b) {
      const ink = '#111111';
      const ac = ensure(b.primary, '#ffffff', 3.5);
      const L = { align: 'left', x: 90, w: 900 };
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: ink, big: ink, bigsub: ac, price: ac },
        decor: ids([R({ name: 'Línea de acento', x: 90, y: 1140, w: 140, h: 12, fill: ac })]),
        layout: {
          headline: { ...L, size: 42, weight: '600', ls: 6 }, big: { ...L, x: 70, w: 940 }, bigsub: { ...L, size: 60 },
          title: { ...L, size: 84 }, subtitle: L, price: L, validity: L, contact: L,
        },
      };
    },
  },

  editorial: {
    name: 'Editorial',
    build(b) {
      const paper = '#f4efe6', ink = '#1b1b1b';
      const ac = ensure(b.primary, paper, 4);
      const rule = (y) => R({ name: 'Regla', x: 90, y, w: 900, h: 3, fill: ink });
      return {
        bg: { type: 'solid', c1: paper }, ink, font: 'Georgia',
        colors: { headline: ink, big: ink, bigsub: ac, price: ac },
        decor: ids([rule(408), rule(526), rule(1135), R({ name: 'Marca', x: 90, y: 1135, w: 120, h: 12, fill: ac })]),
        layout: {
          headline: { size: 38, weight: '700', ls: 9, y: 420, h: 96 }, big: { y: 545, h: 450 },
          bigsub: { y: 1000, h: 110, size: 60, weight: '400', ls: 4 }, title: { y: 1170, weight: '700' },
        },
      };
    },
  },

  marfil: {
    name: 'Marfil',
    build(b) {
      const paper = '#fbf6ea', gold = '#9a6f24', ink = '#3a2f1f';
      return {
        bg: { type: 'solid', c1: paper }, ink, font: 'Georgia',
        colors: { headline: gold, big: gold, bigsub: ink, price: gold },
        decor: ids([
          R({ name: 'Marco', x: 56, y: 56, w: 968, h: 1808, fill: 'transparent', stroke: alpha(gold, 0.6), strokeW: 3 }),
          E({ name: 'Aro', x: 160, y: 520, w: 760, h: 760, fill: 'transparent', stroke: gold, strokeW: 5 }),
          E({ name: 'Aro interno', x: 190, y: 550, w: 700, h: 700, fill: 'transparent', stroke: alpha(gold, 0.45), strokeW: 2 }),
        ]),
        layout: {
          big: { x: 235, y: 650, w: 610, h: 300 }, bigsub: { x: 235, y: 960, w: 610, h: 80, size: 52, weight: '400', ls: 3 },
          title: { y: 1315, h: 100, size: 70 }, subtitle: { y: 1420, h: 50, size: 38 }, price: { y: 1475, h: 70, size: 56 },
          validity: { y: 1550, h: 44, size: 32 }, contact: { y: 1605 },
        },
      };
    },
  },

  pizarra: {
    name: 'Pizarra',
    build(b) {
      const bg = '#1f2529';
      const ac = ensure(b.accent, bg, 4);
      const Rr = { align: 'right', x: 90, w: 890 };
      return {
        bg: { type: 'solid', c1: bg }, ink: '#f2f2f2', font: b.font,
        colors: { headline: ac, big: ac, bigsub: '#f2f2f2', price: ac },
        decor: ids([
          R({ name: 'Marco', x: 56, y: 56, w: 968, h: 1808, fill: 'transparent', stroke: alpha('#ffffff', 0.22), strokeW: 3 }),
          R({ name: 'Barra', x: 1000, y: 430, w: 14, h: 1120, fill: ac }),
        ]),
        layout: {
          headline: Rr, big: { ...Rr, x: 40, w: 940 }, bigsub: Rr, title: Rr, subtitle: Rr, price: Rr, validity: Rr, contact: Rr,
        },
      };
    },
  },

  /* ---------- Colorido / promoción fuerte ---------- */
  explosion: {
    name: 'Explosión',
    build(b) {
      const red = '#e4262f', dk = '#111111';
      const star = Array.from({ length: 6 }, (_, k) => R({ name: `Estrella ${k + 1}`, x: 170, y: 410, w: 740, h: 740, rot: k * 15, fill: red }));
      const outline = { stroke: dk, strokeW: 16 };
      return {
        bg: { type: 'solid', c1: '#ffdd2d' }, ink: dk, font: b.font,
        colors: { headline: dk, big: '#ffffff', bigsub: '#ffffff', price: red },
        decor: ids([
          ...star,
          E({ name: 'Punto', x: 50, y: 80, w: 90, h: 90, fill: alpha(red, 0.9) }),
          E({ name: 'Punto 2', x: 950, y: 150, w: 60, h: 60, fill: alpha(red, 0.9) }),
        ]),
        layout: {
          headline: { stroke: '#ffffff', strokeW: 14, y: 400, h: 100 },
          big: { ...outline, x: 190, y: 590, w: 700, h: 420, shadow: true, shadowColor: 'rgba(0,0,0,.35)', shadowBlur: 0, shadowY: 12 },
          bigsub: { ...outline, strokeW: 10, x: 200, y: 990, w: 680, h: 90, size: 62 },
          title: { y: 1330 }, subtitle: { y: 1450 }, price: { y: 1510 }, validity: { y: 1595 }, contact: { y: 1650 },
        },
      };
    },
  },

  cinta: {
    name: 'Cinta',
    build(b) {
      const bg = mix(b.secondary, '#000000', 0.35);
      const rib = b.accent;
      const on = onColor(rib);
      return {
        bg: { type: 'solid', c1: bg }, ink: '#ffffff', font: b.font,
        colors: { headline: on, big: '#ffffff', bigsub: ensure(rib, bg, 3), price: ensure(rib, bg, 3) },
        decor: ids([
          R({ name: 'Cinta (sombra)', x: -100, y: 590, w: 1280, h: 200, rot: 5, fill: alpha('#000000', 0.25) }),
          R({ name: 'Cinta', x: -100, y: 560, w: 1280, h: 200, rot: -8, fill: rib, shadow: true }),
          R({ name: 'Cinta (borde)', x: -100, y: 560, w: 1280, h: 200, rot: -8, fill: 'transparent', stroke: alpha('#ffffff', 0.5), strokeW: 4 }),
        ]),
        layout: {
          headline: { x: 140, y: 600, w: 800, h: 120, size: 70, rot: -8 },
          big: { y: 800, h: 400 }, bigsub: { y: 1190, h: 80, size: 58 },
          title: { y: 1290, h: 100, size: 72 }, subtitle: { y: 1395, h: 50, size: 38 }, price: { y: 1450, h: 72, size: 58 },
          validity: { y: 1530, h: 44, size: 32 }, contact: { y: 1585 },
        },
      };
    },
  },

  sello: {
    name: 'Sello',
    build(b) {
      const mid = mix(b.primary, b.secondary, 0.5);
      const ink = onColor(mid);
      const bigC = ensure(b.primary, '#ffffff', 4.5);
      return {
        bg: { type: 'gradient', c1: b.primary, c2: b.secondary, angle: 60 }, ink, font: b.font,
        colors: { headline: ink, big: bigC, bigsub: '#141414', price: ink },
        decor: ids([
          E({ name: 'Sello (borde)', x: 150, y: 450, w: 780, h: 780, fill: b.accent, stroke: '#ffffff', strokeW: 12, shadow: true }),
          E({ name: 'Sello', x: 190, y: 490, w: 700, h: 700, fill: '#ffffff' }),
          E({ name: 'Sello (aro)', x: 208, y: 508, w: 664, h: 664, fill: 'transparent', stroke: alpha(b.accent, 0.8), strokeW: 4 }),
        ]),
        layout: {
          headline: { y: 372, h: 76, size: 52 }, big: { x: 250, y: 620, w: 580, h: 360 }, bigsub: { x: 250, y: 985, w: 580, h: 70, size: 52 },
          title: { y: 1265, h: 100, size: 72 }, subtitle: { y: 1370, h: 50, size: 38 }, price: { y: 1425, h: 70, size: 56 },
          validity: { y: 1500, h: 44, size: 32 }, contact: { y: 1555 },
        },
      };
    },
  },

  confeti: {
    name: 'Confeti',
    build(b) {
      const r = rng(7 + Math.round(b.primary.length * 13));
      const cols = [b.primary, b.secondary, b.accent, mix(b.primary, b.accent, 0.5), mix(b.secondary, '#ffffff', 0.4)];
      const bits = [];
      let guard = 0;
      while (bits.length < 64 && guard++ < 2000) {
        const x = -20 + r() * 1100, y = r() * 1900;
        if (x > 30 && x < 1050 && y > 360 && y < 1575) continue; // dejar libre la zona del texto
        const c = cols[Math.floor(r() * cols.length)];
        const rot = Math.round(r() * 180);
        if (r() < 0.45) { const d = 18 + r() * 20; bits.push(E({ name: 'Confeti', x, y, w: d, h: d, fill: c })); }
        else bits.push(R({ name: 'Confeti', x, y, w: 26 + r() * 26, h: 11 + r() * 8, r: 3, rot, fill: c }));
      }
      const ink = '#141414';
      return {
        bg: { type: 'solid', c1: '#fffaf0' }, ink, font: b.font,
        colors: { headline: ensure(b.primary, '#fffaf0', 4), big: ensure(b.primary, '#fffaf0', 4), bigsub: ink, price: ensure(b.primary, '#fffaf0', 4) },
        decor: ids(bits),
        layout: {},
      };
    },
  },

  /* ---------- Composiciones distintas ---------- */
  dividido: {
    name: 'Dividido',
    build(b) {
      const top = b.primary;
      const onTop = onColor(top);
      const ac = b.accent;
      const ink = '#141414';
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: onTop, big: onTop, bigsub: onColor(ac), price: ensure(b.primary, '#ffffff', 4) },
        decor: ids([
          R({ name: 'Bloque superior', x: 0, y: 0, w: 1080, h: 1000, fill: top }),
          R({ name: 'Píldora', x: 130, y: 940, w: 820, h: 130, r: 65, fill: ac, shadow: true }),
        ]),
        layout: {
          big: { y: 510, h: 430, color: onTop }, bigsub: { x: 150, y: 940, w: 780, h: 130, size: 62 },
          title: { y: 1140 }, subtitle: { y: 1265 }, price: { y: 1330 }, validity: { y: 1425 }, contact: { y: 1500 },
        },
      };
    },
  },

  diagonal: {
    name: 'Diagonal',
    build(b) {
      const rot = -14, cx = 540, cy = 980, th = 440;
      const band = b.primary, on = onColor(band), ac = b.accent, ink = '#141414';
      const stripe = shift(cx, cy, rot, -(th / 2 + 22));
      const at = (d, w, h) => { const c = shift(cx, cy, rot, d); return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, rot }; };
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: ensure(b.primary, '#ffffff', 4), big: on, bigsub: ensure(ac, band, 2.2), price: ensure(b.primary, '#ffffff', 4) },
        decor: ids([
          R({ name: 'Franja acento', x: Math.round(stripe.x - 1000), y: Math.round(stripe.y - 18), w: 2000, h: 36, rot, fill: ac }),
          R({ name: 'Franja', x: cx - 1000, y: cy - th / 2, w: 2000, h: th, rot, fill: band }),
        ]),
        layout: {
          headline: { y: 410 },
          big: { ...at(-40, 900, 330), size: 330 }, bigsub: { ...at(150, 800, 90), size: 62 },
          title: { y: 1320, h: 100, size: 72 }, subtitle: { y: 1425, h: 46, size: 38 }, price: { y: 1478, h: 64, size: 56 },
          validity: { y: 1550, h: 44, size: 32 }, contact: { y: 1605 },
        },
      };
    },
  },

  panel: {
    name: 'Panel',
    build(b) {
      const on = onColor(b.primary);
      const ink = '#141414';
      return {
        bg: { type: 'solid', c1: b.primary }, ink, font: b.font,
        colors: { headline: on, big: ensure(b.primary, '#ffffff', 4.5), bigsub: ink, price: ensure(b.primary, '#ffffff', 4.5) },
        decor: ids([
          R({ name: 'Franja', x: 0, y: 0, w: 1080, h: 26, fill: b.accent }),
          R({ name: 'Franja inferior', x: 0, y: 1894, w: 1080, h: 26, fill: b.accent }),
          R({ name: 'Panel', x: 60, y: 480, w: 960, h: 1150, r: 64, fill: '#ffffff', shadow: true }),
        ]),
        layout: { headline: { y: 392, h: 80, size: 54 }, big: { y: 520, h: 440 }, bigsub: { y: 965, h: 90 } },
      };
    },
  },
};

/* ====================== Segunda tanda ====================== */
const TXT = (o) => ({ type: 'text', locked: true, fit: false, align: 'center', valign: 'middle', weight: '400', family: 'system-ui', lh: 1, ...o });
const perimeter = (inset, step) => {
  const pts = [];
  for (let x = inset; x <= 1080 - inset; x += step) { pts.push([x, inset]); pts.push([x, 1920 - inset]); }
  for (let y = inset + step; y < 1920 - inset; y += step) { pts.push([inset, y]); pts.push([1080 - inset, y]); }
  return pts;
};

const MORE = {
  /* ---------- Casino / noche ---------- */
  ruleta: {
    name: 'Ruleta',
    build(b) {
      const gold = '#e6c25a';
      const wheel = (cx, cy, r) => [
        E({ name: 'Ruleta (base)', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: alpha(gold, 0.07) }),
        E({ name: 'Ruleta (aro)', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: 'transparent', stroke: alpha(gold, 0.8), strokeW: 8 }),
        E({ name: 'Ruleta (aro 2)', x: cx - r * 0.78, y: cy - r * 0.78, w: r * 1.56, h: r * 1.56, fill: 'transparent', stroke: alpha(gold, 0.45), strokeW: 4 }),
        E({ name: 'Ruleta (centro)', x: cx - r * 0.2, y: cy - r * 0.2, w: r * 0.4, h: r * 0.4, fill: alpha(gold, 0.5) }),
        ...Array.from({ length: 8 }, (_, k) => R({ name: `Radio ${k + 1}`, x: cx - r * 0.78, y: cy - 2, w: r * 1.56, h: 4, rot: k * 22.5, fill: alpha(gold, 0.3) })),
      ];
      return {
        bg: { type: 'gradient', c1: '#4a0a14', c2: '#12030a', angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: gold, big: '#fff1c1', bigsub: gold, price: gold },
        decor: ids([...wheel(930, 250, 430), ...wheel(120, 1640, 300)]),
        layout: { big: { shadow: true, shadowColor: alpha(gold, 0.75), shadowBlur: 55, shadowY: 0 } },
      };
    },
  },

  vegas: {
    name: 'Vegas',
    build(b) {
      const bulbs = perimeter(46, 80).map(([x, y], k) => E({ name: 'Foco', x: x - 12, y: y - 12, w: 24, h: 24, fill: k % 2 ? '#ffe680' : '#ffb703' }));
      return {
        bg: { type: 'solid', c1: '#0c0708' }, ink: '#ffffff', font: b.font,
        colors: { headline: '#ffffff', big: '#ffd84a', bigsub: '#ffffff', price: '#ffd84a' },
        decor: ids([
          ...bulbs,
          R({ name: 'Cartel', x: 100, y: 398, w: 880, h: 116, r: 22, fill: '#c1121f', stroke: '#ffd84a', strokeW: 6, shadow: true, shadowColor: 'rgba(255,60,60,.6)', shadowBlur: 40, shadowY: 0 }),
        ]),
        layout: {
          headline: { x: 120, y: 404, w: 840, h: 104, size: 54 },
          big: { stroke: '#7a3a00', strokeW: 12, shadow: true, shadowColor: 'rgba(255,190,40,.7)', shadowBlur: 60, shadowY: 0 },
        },
      };
    },
  },

  cartas: {
    name: 'Cartas',
    build(b) {
      const suit = (ch, x, y, c) => TXT({ name: `Palo ${ch}`, text: ch, x, y, w: 460, h: 460, size: 440, color: c });
      const wh = alpha('#ffffff', 0.07), rd = alpha('#ff5a5f', 0.14);
      return {
        bg: { type: 'gradient', c1: '#0f3b2e', c2: '#06170f', angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: '#f2d16b', big: '#ffffff', bigsub: '#f2d16b', price: '#f2d16b' },
        decor: ids([
          suit('♣', -120, 60, wh), suit('♥', 760, 60, rd), suit('♠', -110, 1400, wh), suit('♦', 740, 1420, rd),
          R({ name: 'Marco', x: 56, y: 56, w: 968, h: 1808, r: 46, fill: 'transparent', stroke: alpha('#ffffff', 0.5), strokeW: 4 }),
        ]),
        layout: { big: { shadow: true, shadowColor: 'rgba(0,0,0,.55)', shadowBlur: 26, shadowY: 12 } },
      };
    },
  },

  galaxia: {
    name: 'Galaxia',
    build(b) {
      const r = rng(21);
      const stars = Array.from({ length: 56 }, () => {
        const d = 3 + r() * 7;
        return E({ name: 'Estrella', x: r() * 1080, y: r() * 1920, w: d, h: d, fill: alpha('#ffffff', 0.25 + r() * 0.6) });
      });
      const glow = ensure(mix(b.primary, '#ffffff', 0.3), '#0a0620', 4.5);
      return {
        bg: { type: 'gradient', c1: '#1c0b3d', c2: '#040816', angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: ensure(b.accent, '#0a0620', 4.5), big: '#ffffff', bigsub: glow, price: ensure(b.accent, '#0a0620', 4.5) },
        decor: ids([
          E({ name: 'Nebulosa', x: -260, y: 300, w: 900, h: 900, fill: alpha(b.primary, 0.22) }),
          E({ name: 'Nebulosa 2', x: 500, y: -200, w: 800, h: 800, fill: alpha(b.secondary, 0.35) }),
          ...stars,
          E({ name: 'Planeta', x: 780, y: 1590, w: 440, h: 440, fill: { from: mix(b.primary, '#ffffff', 0.25), to: mix(b.secondary, '#000000', 0.5), angle: 135 } }),
          E({ name: 'Anillo', x: 690, y: 1740, w: 620, h: 130, rot: -20, fill: 'transparent', stroke: alpha('#ffffff', 0.55), strokeW: 6 }),
        ]),
        layout: { big: { shadow: true, shadowColor: alpha(glow, 0.85), shadowBlur: 60, shadowY: 0 } },
      };
    },
  },

  /* ---------- Minimalista / elegante ---------- */
  nordico: {
    name: 'Nórdico',
    build(b) {
      const bg = '#e9e6df', ink = '#22262b';
      const soft = mix(b.primary, bg, 0.72);
      const ac = ensure(b.primary, bg, 4);
      const L = { align: 'left', x: 100, w: 880 };
      return {
        bg: { type: 'solid', c1: bg }, ink, font: 'Trebuchet MS',
        colors: { headline: ac, big: ink, bigsub: ac, price: ac },
        decor: ids([
          E({ name: 'Círculo', x: 520, y: 60, w: 640, h: 640, fill: soft }),
          E({ name: 'Círculo chico', x: 880, y: 1440, w: 120, h: 120, fill: mix(b.accent, bg, 0.6) }),
        ]),
        layout: {
          headline: { ...L, size: 44, weight: '700', ls: 4 }, big: { ...L, x: 80, w: 920, weight: '700' }, bigsub: { ...L, size: 56, weight: '600' },
          title: { ...L, size: 76, weight: '700' }, subtitle: L, price: { ...L, weight: '700' }, validity: L, contact: L,
        },
      };
    },
  },

  blueprint: {
    name: 'Blueprint',
    build(b) {
      const lines = [
        ...Array.from({ length: 8 }, (_, k) => R({ name: 'Cuadrícula', x: 120 + k * 120, y: 0, w: 2, h: 1920, fill: alpha('#ffffff', 0.1) })),
        ...Array.from({ length: 15 }, (_, k) => R({ name: 'Cuadrícula', x: 0, y: 120 + k * 120, w: 1080, h: 2, fill: alpha('#ffffff', 0.1) })),
      ];
      const mono = 'Courier New';
      return {
        bg: { type: 'solid', c1: '#0a3a8a' }, ink: '#ffffff', font: mono,
        colors: { headline: '#a8d8ff', big: '#ffffff', bigsub: '#a8d8ff', price: '#ffe66d' },
        decor: ids([
          ...lines,
          R({ name: 'Marco', x: 50, y: 50, w: 980, h: 1820, fill: 'transparent', stroke: alpha('#ffffff', 0.7), strokeW: 4 }),
          R({ name: 'Marco interno', x: 66, y: 66, w: 948, h: 1788, fill: 'transparent', stroke: alpha('#ffffff', 0.3), strokeW: 2, dash: [18, 12] }),
        ]),
        layout: { headline: { weight: '700', ls: 3 }, big: { weight: '700' }, subtitle: { weight: '400' } },
      };
    },
  },

  oro: {
    name: 'Oro',
    build(b) {
      const gold = '#d4af37';
      const corner = (x, y) => R({ name: 'Esquina', x, y, w: 28, h: 28, fill: gold });
      return {
        bg: { type: 'solid', c1: '#0a0a0a' }, ink: '#f5efe0', font: 'Georgia',
        colors: { headline: gold, big: gold, bigsub: '#f5efe0', price: gold },
        decor: ids([
          R({ name: 'Marco', x: 50, y: 50, w: 980, h: 1820, fill: 'transparent', stroke: gold, strokeW: 4 }),
          R({ name: 'Marco interno', x: 72, y: 72, w: 936, h: 1776, fill: 'transparent', stroke: alpha(gold, 0.45), strokeW: 2 }),
          corner(36, 36), corner(1016, 36), corner(36, 1856), corner(1016, 1856),
          R({ name: 'Línea', x: 140, y: 1147, w: 800, h: 2, fill: alpha(gold, 0.7) }),
          R({ name: 'Rombo', x: 529, y: 1137, w: 22, h: 22, rot: 45, fill: gold }),
        ]),
        layout: {
          headline: { weight: '700', ls: 8, size: 46 }, bigsub: { weight: '400', ls: 8, size: 60 }, title: { weight: '700', y: 1175 },
          big: { shadow: true, shadowColor: alpha(gold, 0.45), shadowBlur: 40, shadowY: 0 },
        },
      };
    },
  },

  kraft: {
    name: 'Kraft',
    build(b) {
      const paper = '#f7efe0', ink = '#3b2a1a';
      const red = ensure('#a63d2f', paper, 4.5);
      return {
        bg: { type: 'solid', c1: '#c8a274' }, ink, font: b.font,
        colors: { headline: ink, big: red, bigsub: ink, price: red },
        decor: ids([
          R({ name: 'Costura', x: 44, y: 44, w: 992, h: 1832, r: 30, fill: 'transparent', stroke: alpha('#3b2a1a', 0.55), strokeW: 5, dash: [26, 18] }),
          R({ name: 'Etiqueta', x: 90, y: 480, w: 900, h: 1110, r: 34, rot: -1.2, fill: paper, shadow: true }),
          R({ name: 'Etiqueta (borde)', x: 118, y: 508, w: 844, h: 1054, r: 20, rot: -1.2, fill: 'transparent', stroke: alpha(red, 0.6), strokeW: 4, dash: [14, 10] }),
        ]),
        layout: {
          headline: { y: 398, h: 80, size: 54 }, big: { x: 130, w: 820, y: 520, h: 440 }, bigsub: { y: 960, h: 90 },
          title: { x: 140, w: 800 }, subtitle: { x: 140, w: 800 }, price: { x: 140, w: 800 }, validity: { x: 140, w: 800 }, contact: { x: 140, w: 800 },
        },
      };
    },
  },

  /* ---------- Colorido / promoción fuerte ---------- */
  retro: {
    name: 'Retro 80',
    build(b) {
      const c1 = '#1b0b46', c2 = '#c2185b';
      const at = (y) => mix(c1, c2, y / 1920);
      const slats = [930, 985, 1030, 1070, 1105, 1135, 1160].map((y, k) => R({ name: `Persiana ${k + 1}`, x: 220, y, w: 640, h: 6 + k * 3, fill: at(y + 10) }));
      const floor = Array.from({ length: 8 }, (_, k) => R({ name: `Piso ${k + 1}`, x: 0, y: Math.round(1215 + Math.pow(k, 1.7) * 26), w: 1080, h: 3, fill: alpha('#00e5ff', 0.4) }));
      const spokes = [-50, -30, -15, 0, 15, 30, 50].map((phi) => {
        const c = shift(540, 1180, -phi, -350); // eje "hacia abajo" girado
        return R({ name: 'Piso (fuga)', x: Math.round(c.x - 1.5), y: Math.round(c.y - 350 + 700), w: 3, h: 700, rot: -phi, fill: alpha('#00e5ff', 0.35) });
      });
      const out = { stroke: '#2b0a55', strokeW: 14 };
      return {
        bg: { type: 'gradient', c1, c2, angle: 90 }, ink: '#ffffff', font: b.font,
        colors: { headline: '#00e5ff', big: '#ffffff', bigsub: '#ffffff', price: '#ffe14d' },
        decor: ids([
          E({ name: 'Sol', x: 210, y: 540, w: 660, h: 660, fill: { from: '#ffe14d', to: '#ff3d81', angle: 90 } }),
          ...slats,
          ...floor,
        ]),
        layout: {
          headline: { shadow: true, shadowColor: '#ff3d81', shadowBlur: 0, shadowY: 6 },
          big: { ...out, x: 220, y: 650, w: 640, h: 380 },
          bigsub: { ...out, strokeW: 10, x: 250, y: 1030, w: 580, h: 80, size: 54 },
        },
      };
    },
  },

  pop: {
    name: 'Pop',
    build(b) {
      const bg = mix(b.accent, '#ffffff', 0.6);
      const dk = '#111111';
      const dots = [];
      for (let j = 0; j < 8; j++) for (let i = 0; i < 6; i++) {
        const d = Math.max(0, 34 - (i + j) * 4);
        if (d > 4) dots.push(E({ name: 'Punto', x: 20 + i * 52 - d / 2, y: 20 + j * 52 - d / 2, w: d, h: d, fill: alpha(b.primary, 0.55) }));
      }
      const dots2 = dots.map((d) => ({ ...d, x: 1080 - d.x - d.w, y: 1920 - d.y - d.h }));
      return {
        bg: { type: 'solid', c1: bg }, ink: dk, font: b.font,
        colors: { headline: '#ffffff', big: b.primary, bigsub: dk, price: ensure(b.primary, bg, 4) },
        decor: ids([
          ...dots, ...dots2,
          R({ name: 'Barra (sombra)', x: 70, y: 425, w: 960, h: 96, rot: -2, fill: b.primary }),
          R({ name: 'Barra', x: 60, y: 415, w: 960, h: 96, rot: -2, fill: dk }),
        ]),
        layout: {
          headline: { x: 60, y: 415, w: 960, h: 96, size: 54, rot: -2 },
          big: { stroke: dk, strokeW: 20, shadow: true, shadowColor: dk, shadowBlur: 0, shadowY: 16 },
        },
      };
    },
  },

  ola: {
    name: 'Ola',
    build(b) {
      const ink = '#141414';
      const ac = ensure(b.primary, '#ffffff', 4);
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: ac, big: ac, bigsub: ink, price: ac },
        decor: ids([
          E({ name: 'Ola 3', x: -350, y: -640, w: 1780, h: 980, fill: alpha(b.accent, 0.9) }),
          E({ name: 'Ola 2', x: -300, y: -680, w: 1680, h: 980, fill: b.secondary }),
          E({ name: 'Ola 1', x: -250, y: -720, w: 1580, h: 980, fill: b.primary }),
          E({ name: 'Ola inferior', x: -300, y: 1640, w: 1680, h: 900, fill: alpha(b.secondary, 0.9) }),
          E({ name: 'Ola inferior 2', x: -200, y: 1720, w: 1480, h: 900, fill: b.primary }),
        ]),
        layout: { headline: { y: 400 } },
      };
    },
  },

  festejo: {
    name: 'Festejo',
    build(b) {
      const cols = [b.primary, b.accent, b.secondary, mix(b.primary, b.accent, 0.5)];
      const balloon = (cx, top, c, k) => [
        R({ name: 'Cuerda', x: cx - 1.5, y: top + 150, w: 3, h: 190, rot: (k % 2 ? 4 : -4), fill: alpha('#000000', 0.35) }),
        E({ name: 'Globo', x: cx - 62, y: top, w: 124, h: 158, fill: c, shadow: true }),
        E({ name: 'Brillo', x: cx - 38, y: top + 24, w: 26, h: 44, rot: 20, fill: alpha('#ffffff', 0.45) }),
      ];
      const r = rng(5);
      const bits = Array.from({ length: 26 }, () => {
        const x = r() < 0.5 ? r() * 200 : 880 + r() * 200, y = 560 + r() * 1000;
        return R({ name: 'Confeti', x, y, w: 22 + r() * 18, h: 10, r: 3, rot: Math.round(r() * 180), fill: cols[Math.floor(r() * cols.length)] });
      });
      const ink = '#2a1b2d';
      return {
        bg: { type: 'gradient', c1: '#fff7e6', c2: '#ffe1ec', angle: 90 }, ink, font: b.font,
        colors: { headline: ensure(b.primary, '#fff2e8', 4), big: ensure(b.primary, '#fff2e8', 4), bigsub: ink, price: ensure(b.primary, '#fff2e8', 4) },
        decor: ids([...balloon(85, 40, cols[0], 0), ...balloon(210, 110, cols[1], 1), ...balloon(870, 90, cols[2], 2), ...balloon(995, 30, cols[3], 3), ...bits]),
        layout: {},
      };
    },
  },

  /* ---------- Composiciones distintas ---------- */
  columnas: {
    name: 'Columnas',
    build(b) {
      const band = b.primary, on = onColor(band);
      const ink = '#141414';
      const ac = ensure(b.primary, '#ffffff', 4);
      const L = { align: 'left', x: 310, w: 720 };
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: on, big: ac, bigsub: ink, price: ac },
        decor: ids([
          R({ name: 'Columna', x: 0, y: 0, w: 250, h: 1920, fill: band }),
          R({ name: 'Filete', x: 250, y: 0, w: 16, h: 1920, fill: b.accent }),
        ]),
        logo: { x: 320, w: 700 },
        layout: {
          headline: { x: -575, y: 900, w: 1400, h: 120, size: 64, rot: -90, ls: 6 },
          big: { ...L, x: 290, w: 760, y: 520, h: 420 }, bigsub: { ...L, y: 940, h: 90, size: 60 },
          title: { ...L, y: 1090, size: 70 }, subtitle: { ...L, y: 1230 }, price: { ...L, y: 1300 }, validity: { ...L, y: 1395 }, contact: { ...L, y: 1470 },
        },
      };
    },
  },

  cupon: {
    name: 'Cupón',
    build(b) {
      const bg = b.primary, on = onColor(bg);
      const ink = '#141414';
      const ac = ensure(b.primary, '#ffffff', 4.5);
      return {
        bg: { type: 'solid', c1: bg }, ink, font: b.font,
        colors: { headline: on, big: ac, bigsub: ink, price: ac },
        decor: ids([
          R({ name: 'Cupón', x: 70, y: 480, w: 940, h: 1100, r: 40, fill: '#ffffff', shadow: true }),
          E({ name: 'Corte izq.', x: 20, y: 1000, w: 100, h: 100, fill: bg }),
          E({ name: 'Corte der.', x: 960, y: 1000, w: 100, h: 100, fill: bg }),
          R({ name: 'Línea de corte', x: 140, y: 1050, w: 800, h: 0, fill: 'transparent', stroke: '#9a9a9a', strokeW: 4, dash: [18, 12] }),
          TXT({ name: 'Tijera', text: '✂', x: 118, y: 1020, w: 60, h: 60, size: 46, color: '#7a7a7a', family: 'system-ui' }),
        ]),
        layout: {
          headline: { y: 398, h: 70, size: 50 }, big: { y: 500, h: 420 }, bigsub: { y: 925, h: 90 },
          title: { y: 1095, h: 110, size: 68 }, subtitle: { y: 1205, h: 50, size: 38 }, price: { y: 1265, h: 75, size: 58 },
          validity: { y: 1355, h: 44, size: 32 }, contact: { y: 1425 },
        },
      };
    },
  },

  bloques: {
    name: 'Bloques',
    build(b) {
      const on1 = onColor(b.primary), on2 = onColor(b.secondary);
      const ink = '#141414';
      return {
        bg: { type: 'solid', c1: '#ffffff' }, ink, font: b.font,
        colors: { headline: on1, big: ensure(b.accent, b.secondary, 3.5), bigsub: on2, price: ensure(b.primary, '#ffffff', 4) },
        decor: ids([
          R({ name: 'Bloque 1', x: 0, y: 0, w: 1080, h: 560, fill: b.primary }),
          R({ name: 'Bloque 2', x: 0, y: 560, w: 1080, h: 620, fill: b.secondary }),
          R({ name: 'Filete', x: 0, y: 1180, w: 1080, h: 16, fill: b.accent }),
        ]),
        layout: {
          headline: { y: 420 }, big: { y: 580, h: 440 }, bigsub: { y: 1030, h: 110 },
          title: { y: 1225, h: 110, size: 74 }, subtitle: { y: 1340, h: 55, size: 40 }, price: { y: 1400, h: 80, size: 60 },
          validity: { y: 1490, h: 46, size: 34 }, contact: { y: 1550 },
        },
      };
    },
  },
};
Object.assign(DESIGNS, MORE);

export const DESIGN_LIST = Object.entries(DESIGNS).map(([id, d]) => ({ id, name: d.name }));
