// Arma la demo estática en dist-demo/: la interfaz de public/ + un service
// worker que simula la API (demo/sw.js) + imágenes de ejemplo para el
// encabezado y el pie de página. Sin dependencias: `node demo/build.mjs`.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-demo');
const assets = join(root, 'demo', 'assets');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(root, 'public'), out, { recursive: true });
cpSync(join(root, 'demo', 'sw.js'), join(out, 'sw.js'));
cpSync(join(root, 'demo', 'boot.js'), join(out, 'js', 'demo-boot.js'));
cpSync(assets, join(out, 'demo-assets'), { recursive: true });

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
