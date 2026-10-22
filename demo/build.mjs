// Arma la demo estática en dist-demo/: la interfaz de public/ + un service
// worker que simula la API (demo/sw.js) + imágenes de ejemplo para el
// encabezado y el pie de página. Sin dependencias: `node demo/build.mjs`.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Plantillas que trae la demo, además de las 5 básicas (impacto, vibrante, oscuro,
// elegante y etiqueta, que viven en templates.js). El resto del catálogo de
// designs.js no se publica en la demo: se arma un designs.js recortado.
const DEMO_CATALOG = ['dividido'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-demo');
const assets = join(root, 'demo', 'assets');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(root, 'public'), out, { recursive: true });
cpSync(join(root, 'demo', 'sw.js'), join(out, 'sw.js'));
cpSync(join(root, 'demo', 'boot.js'), join(out, 'js', 'demo-boot.js'));
cpSync(assets, join(out, 'demo-assets'), { recursive: true });

// designs.js recortado: helpers del principio + solo las entradas elegidas.
// Cada entrada del catálogo empieza en "  id: {" y termina en "  }," (2 espacios).
{
  const src = readFileSync(join(root, 'public', 'js', 'designs.js'), 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const startAt = lines.indexOf('export const DESIGNS = {');
  if (startAt < 0) throw new Error('designs.js cambió: no encuentro "export const DESIGNS = {"');
  const blocks = {};
  for (let i = startAt; i < lines.length; i++) {
    const m = /^ {2}(\w+): \{$/.exec(lines[i]);
    if (!m) continue;
    const end = lines.indexOf('  },', i);
    if (end < 0) throw new Error(`designs.js: no encuentro el cierre de "${m[1]}"`);
    blocks[m[1]] = lines.slice(i, end + 1).join('\n');
    i = end;
  }
  const missing = DEMO_CATALOG.filter((id) => !blocks[id]);
  if (missing.length) throw new Error(`designs.js: faltan plantillas para la demo: ${missing.join(', ')}`);
  const trimmed = [
    ...lines.slice(0, startAt),
    '// Versión recortada para la demo (ver demo/build.mjs).',
    'export const DESIGNS = {',
    ...DEMO_CATALOG.map((id) => blocks[id]),
    '};',
    '',
    'export const DESIGN_LIST = Object.entries(DESIGNS).map(([id, d]) => ({ id, name: d.name }));',
    '',
  ].join('\n');
  writeFileSync(join(out, 'js', 'designs.js'), trimmed);
}

const list = (dir, exts) => readdirSync(join(assets, dir)).filter((n) => exts.some((e) => n.toLowerCase().endsWith(e))).sort();
writeFileSync(join(out, 'demo-assets', 'manifest.json'), JSON.stringify({
  header: list('header', ['.png', '.jpg', '.jpeg', '.webp']),
  footer: list('footer', ['.png']),
}, null, 2));

// index.html: arranca por demo-boot.js, permite indexar la demo y agrega el estilo de la franja.
let html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
html = html
  .replace('<meta name="robots" content="noindex, nofollow">', '<meta name="description" content="Demo de StoriesCreator: editor web de historias 9:16 con plantillas, marca y capas. Funciona en el navegador, sin registrarse.">')
  .replace('<title>StoriesCreator</title>', '<title>StoriesCreator — demo</title>')
  .replace('<link rel="stylesheet" href="/css/app.css">', '<link rel="stylesheet" href="/css/app.css">\n  <link rel="stylesheet" href="/css/demo.css">')
  .replace('<script type="module" src="/js/app.js"></script>', '<script type="module" src="/js/demo-boot.js"></script>');
if (!html.includes('demo-boot.js')) throw new Error('index.html cambió: actualizar demo/build.mjs');
writeFileSync(join(out, 'index.html'), html);
cpSync(join(root, 'demo', 'demo.css'), join(out, 'css', 'demo.css'));

console.log(`Demo lista en ${out}`);
