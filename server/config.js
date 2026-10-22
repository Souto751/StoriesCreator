'use strict';
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

const config = {
  ROOT,
  PUBLIC: path.join(ROOT, 'public'),
  DATA,
  IMAGES: path.join(DATA, 'images'),
  // Carpeta con los PNG que se usan para armar el pie de página (logos de juegos, sellos, etc.).
  FOOTER: process.env.FOOTER_DIR ? path.resolve(process.env.FOOTER_DIR) : path.join(ROOT, 'footer'),
  // Carpeta con las imágenes (PNG, JPG o WebP) que se usan como encabezado.
  HEADER: process.env.HEADER_DIR ? path.resolve(process.env.HEADER_DIR) : path.join(ROOT, 'header'),
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '127.0.0.1',
  // En producción (detrás de HTTPS) definir COOKIE_SECURE=1 y TRUST_PROXY=1 si hay proxy inverso.
  SECURE: process.env.COOKIE_SECURE === '1',
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  SESSION_IDLE_MS: 30 * 60 * 1000,
  SESSION_MAX_MS: 12 * 60 * 60 * 1000,
  PENDING_MS: 5 * 60 * 1000,
  MAX_JSON: 256 * 1024,
  MAX_DESIGN_BODY: 12 * 1024 * 1024,
  MAX_PNG: 8 * 1024 * 1024,
  MAX_LOGO: 1024 * 1024,
  IMG_W: 1080,
  IMG_H: 1920,
  MIN_PASSWORD: 12,
};

for (const dir of [config.DATA, config.IMAGES, config.FOOTER, config.HEADER]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

module.exports = config;
