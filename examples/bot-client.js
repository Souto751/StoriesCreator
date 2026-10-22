'use strict';
/**
 * Ejemplo de cliente para el bot que publica las imágenes (Node ≥ 18, sin dependencias).
 *
 *   STORIES_URL=https://tu-dominio STORIES_TOKEN=sc_xxx node examples/bot-client.js
 *
 * Flujo seguro para varios bots o reintentos:
 *   1. lista las imágenes "listas" cuya fecha ya llegó
 *   2. las reserva (claim): si otro proceso ya la tomó, responde 409 y se salta
 *   3. descarga el PNG y verifica su SHA-256
 *   4. publica (acá va la lógica de tu bot) y reporta published / failed
 */
const crypto = require('node:crypto');

const BASE = (process.env.STORIES_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.STORIES_TOKEN;
const EVERY_MS = Number(process.env.STORIES_POLL_MS) || 60_000;
if (!TOKEN) { console.error('Falta STORIES_TOKEN (crealo con: node server/cli.js token:add mi-bot)'); process.exit(1); }

const api = (path, options = {}) => fetch(BASE + path, {
  ...options,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
});

// >>> REEMPLAZÁ ESTA FUNCIÓN por la lógica de tu bot actual <<<
async function publish({ png, caption, title }) {
  console.log(`   (simulación) publicando "${title}" — ${png.length} bytes — texto: ${caption || '(sin texto)'}`);
}

async function tick() {
  const res = await api('/api/bot/images?due=1&limit=10');
  if (!res.ok) throw new Error(`No se pudo listar: ${res.status}`);
  const { images } = await res.json();
  for (const img of images) {
    const claim = await api(`/api/bot/images/${img.id}/claim`, { method: 'POST', body: '{}' });
    if (claim.status === 409) continue; // otro proceso la reservó
    if (!claim.ok) { console.error('claim falló', claim.status); continue; }
    try {
      const file = await api(img.file);
      const png = Buffer.from(await file.arrayBuffer());
      if (crypto.createHash('sha256').update(png).digest('hex') !== img.sha256) throw new Error('El archivo no coincide con el SHA-256');
      await publish({ png, caption: img.caption, title: img.title });
      await api(`/api/bot/images/${img.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'published' }) });
      console.log('publicada:', img.title);
    } catch (err) {
      console.error('falló:', img.title, err.message);
      await api(`/api/bot/images/${img.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'failed', note: String(err.message).slice(0, 300) }) });
    }
  }
}

(async () => {
  for (;;) {
    try { await tick(); } catch (err) { console.error(err.message); }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
})();
