import { W, H, SAFE, drawDesign, hitLayer, toLocal } from './render.js';

const DISPLAY = 720 / W; // el canvas visible mide 720×1280 y se escala por CSS
const HANDLE = 30;
const ROT_DIST = 70;

export class Editor {
  constructor(canvas, { onChange = () => {}, onSelect = () => {} } = {}) {
    this.canvas = canvas;
    canvas.width = Math.round(W * DISPLAY);
    canvas.height = Math.round(H * DISPLAY);
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.spec = { bg: { type: 'solid', c1: '#ffffff' }, layers: [], assets: {} };
    this.assets = {};
    this.selectedId = null;
    this.showGuides = true;
    this.history = [];
    this.future = [];
    this.drag = null;
    this.snapX = false;
    this.counter = 0;
    this.bind();
  }

  /* ---------- Estado ---------- */
  setSpec(spec, assets = this.assets) {
    this.spec = spec;
    this.assets = assets;
    this.selectedId = null;
    this.history = [this.snapshot()];
    this.future = [];
    this.counter = spec.layers.length + 100;
    this.render();
    this.onSelect(null);
  }
  snapshot() { return JSON.stringify({ bg: this.spec.bg, layers: this.spec.layers }); }
  restore(json) {
    const s = JSON.parse(json);
    this.spec.bg = s.bg;
    this.spec.layers = s.layers;
    if (!this.layer(this.selectedId)) this.selectedId = null;
    if (this.onRestore) this.onRestore();
    this.render();
    this.onSelect(this.selectedId);
    this.onChange({ user: true });
  }
  commit() {
    const snap = this.snapshot();
    if (snap === this.history[this.history.length - 1]) return;
    this.history.push(snap);
    if (this.history.length > 80) this.history.shift();
    this.future = [];
  }
  undo() {
    if (this.history.length < 2) return;
    this.future.push(this.history.pop());
    this.restore(this.history[this.history.length - 1]);
  }
  redo() {
    if (!this.future.length) return;
    const next = this.future.pop();
    this.history.push(next);
    this.restore(next);
  }
  get canUndo() { return this.history.length > 1; }
  get canRedo() { return this.future.length > 0; }

  layer(id) { return this.spec.layers.find((l) => l.id === id) || null; }
  get selected() { return this.layer(this.selectedId); }
  newId() { let id; do { id = `l${++this.counter}`; } while (this.layer(id)); return id; }

  select(id) {
    this.selectedId = id;
    this.render();
    this.onSelect(id);
  }
  update(id, patch, { commit = false } = {}) {
    const l = this.layer(id);
    if (!l) return;
    Object.assign(l, patch);
    if (commit) this.commit();
    this.render();
    this.onChange({ user: true });
  }
  add(layer) {
    const l = { id: this.newId(), opacity: 1, ...layer };
    this.spec.layers.push(l);
    this.commit();
    this.select(l.id);
    this.onChange({ user: true });
    return l;
  }
  remove(id) {
    this.spec.layers = this.spec.layers.filter((l) => l.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.commit();
    this.render();
    this.onSelect(this.selectedId);
    this.onChange({ user: true });
  }
  duplicate(id) {
    const src = this.layer(id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: this.newId(), x: src.x + 40, y: src.y + 40, name: `${src.name || src.type} (copia)`, locked: false };
    delete copy.bind; delete copy.showIf;
    this.spec.layers.push(copy);
    this.commit();
    this.select(copy.id);
    this.onChange({ user: true });
  }
  reorder(id, dir) {
    const arr = this.spec.layers;
    const i = arr.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.commit();
    this.render();
    this.onChange({ user: true });
    this.onSelect(this.selectedId);
  }

  /* ---------- Dibujo ---------- */
  render() {
    const { ctx } = this;
    ctx.setTransform(DISPLAY, 0, 0, DISPLAY, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawDesign(ctx, this.spec, this.assets);
    if (this.showGuides) this.drawGuides(ctx);
    const sel = this.selected;
    if (sel && !sel.hidden) this.drawSelection(ctx, sel);
    if (this.snapX) {
      ctx.strokeStyle = '#ff2d95';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    }
  }
  drawGuides(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,60,60,.14)';
    ctx.fillRect(0, 0, W, SAFE.top);
    ctx.fillRect(0, H - SAFE.bottom, W, SAFE.bottom);
    ctx.strokeStyle = 'rgba(255,60,60,.8)';
    ctx.setLineDash([18, 14]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, SAFE.top); ctx.lineTo(W, SAFE.top);
    ctx.moveTo(0, H - SAFE.bottom); ctx.lineTo(W, H - SAFE.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '600 26px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Zona tapada por la interfaz de la historia', W / 2, SAFE.top / 2);
    ctx.fillText('Zona tapada por la interfaz de la historia', W / 2, H - SAFE.bottom / 2);
    ctx.restore();
  }
  drawSelection(ctx, l) {
    ctx.save();
    ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
    ctx.rotate(((l.rot || 0) * Math.PI) / 180);
    ctx.strokeStyle = '#1fa2ff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h);
    ctx.beginPath(); ctx.moveTo(0, -l.h / 2); ctx.lineTo(0, -l.h / 2 - ROT_DIST); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -l.h / 2 - ROT_DIST, HANDLE / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.fillRect(sx * (l.w / 2) - HANDLE / 2, sy * (l.h / 2) - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(sx * (l.w / 2) - HANDLE / 2, sy * (l.h / 2) - HANDLE / 2, HANDLE, HANDLE);
    }
    ctx.restore();
  }

  /* ---------- Interacción ---------- */
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }
  bind() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('keydown', (e) => this.key(e));
  }
  down(e) {
    if (e.button !== 0) return;
    this.canvas.focus();
    const p = this.point(e);
    const sel = this.selected;
    if (sel && !sel.hidden && !sel.locked) {
      const q = toLocal(sel, p.x, p.y);
      if (Math.hypot(q.x, q.y + sel.h / 2 + ROT_DIST) <= HANDLE) {
        this.drag = { mode: 'rotate', id: sel.id };
      } else if (Math.abs(Math.abs(q.x) - sel.w / 2) <= HANDLE && Math.abs(Math.abs(q.y) - sel.h / 2) <= HANDLE) {
        this.drag = { mode: 'resize', id: sel.id };
      }
    }
    if (!this.drag) {
      const hit = [...this.spec.layers].reverse().find((l) => hitLayer(l, p.x, p.y));
      if (hit) {
        this.select(hit.id);
        this.drag = { mode: 'move', id: hit.id, start: p, x: hit.x, y: hit.y };
      } else {
        this.select(null);
      }
    }
    if (this.drag) { this.canvas.setPointerCapture(e.pointerId); this.drag.moved = false; }
  }
  move(e) {
    const d = this.drag;
    if (!d) return;
    const l = this.layer(d.id);
    if (!l) return;
    const p = this.point(e);
    d.moved = true;
    if (d.mode === 'move') {
      l.x = Math.round(d.x + (p.x - d.start.x));
      l.y = Math.round(d.y + (p.y - d.start.y));
      const cx = l.x + l.w / 2;
      this.snapX = Math.abs(cx - W / 2) < 14;
      if (this.snapX) l.x = Math.round(W / 2 - l.w / 2);
    } else if (d.mode === 'resize') {
      const q = toLocal(l, p.x, p.y);
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      l.w = Math.max(24, Math.round(Math.abs(q.x) * 2));
      l.h = Math.max(24, Math.round(Math.abs(q.y) * 2));
      l.x = Math.round(cx - l.w / 2);
      l.y = Math.round(cy - l.h / 2);
    } else if (d.mode === 'rotate') {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      l.rot = Math.round(((deg + 180) % 360 + 360) % 360 - 180);
    }
    this.render();
    this.onChange({ user: true, live: true });
  }
  up(e) {
    const d = this.drag;
    this.drag = null;
    this.snapX = false;
    if (!d) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    if (d.moved) this.commit();
    this.render();
    this.onSelect(this.selectedId);
    this.onChange({ user: true });
  }
  key(e) {
    const l = this.selected;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (!l) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicate(l.id); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!l.locked) this.remove(l.id); return; }
    if (l.locked) return;
    const step = e.shiftKey ? 20 : 2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      l.x += moves[e.key][0];
      l.y += moves[e.key][1];
      this.commit();
      this.render();
      this.onChange({ user: true });
    }
  }

  /* ---------- Exportación (1080×1920, sin guías) ---------- */
  exportCanvas() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawDesign(c.getContext('2d'), this.spec, this.assets);
    return c;
  }
  exportBlob() {
    return new Promise((resolve, reject) => {
      this.exportCanvas().toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/png');
    });
  }
  exportDataUrl() { return this.exportCanvas().toDataURL('image/png'); }
}
