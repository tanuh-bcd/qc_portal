// Editing logic for the segmentation tools. Plain typed-array code with no browser APIs, so it is unit-testable.

const TILE = 128;
const MAX_UNDO_BYTES = 160 * 1024 * 1024;

/** Full-resolution binary mask with undo/redo that only remembers the tiles an edit touched. */
export class MaskStore {
  constructor(w, h, data) {
    this.w = w; this.h = h; this.data = data || new Uint8Array(w * h);
    this.tw = Math.ceil(w / TILE);
    this.undoStack = []; this.redoStack = []; this.cur = null; this.bytes = 0; this.version = 0;
  }

  _tile(tx, ty) {
    const x0 = tx * TILE; const y0 = ty * TILE;
    const w = Math.min(TILE, this.w - x0); const h = Math.min(TILE, this.h - y0);
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) data.set(this.data.subarray((y0 + y) * this.w + x0, (y0 + y) * this.w + x0 + w), y * w);
    return { x0, y0, w, h, data };
  }

  _write(t) {
    for (let y = 0; y < t.h; y += 1) this.data.set(t.data.subarray(y * t.w, (y + 1) * t.w), (t.y0 + y) * this.w + t.x0);
  }

  begin() { this.cur = new Map(); }

  /** Call before changing pixels in [x0..x1] x [y0..y1] (inclusive) so the edit can be undone. */
  touch(x0, y0, x1, y1) {
    if (!this.cur) this.begin();
    const a = Math.max(0, Math.floor(x0 / TILE)); const b = Math.min(Math.ceil(this.w / TILE) - 1, Math.floor(x1 / TILE));
    const c = Math.max(0, Math.floor(y0 / TILE)); const d = Math.min(Math.ceil(this.h / TILE) - 1, Math.floor(y1 / TILE));
    for (let ty = c; ty <= d; ty += 1) for (let tx = a; tx <= b; tx += 1) {
      const key = ty * this.tw + tx;
      if (!this.cur.has(key)) this.cur.set(key, this._tile(tx, ty));
    }
  }

  commit() {
    if (this.cur && this.cur.size) {
      this.undoStack.push(this.cur); this.redoStack = [];
      this.bytes += [...this.cur.values()].reduce((n, t) => n + t.data.length, 0);
      while (this.bytes > MAX_UNDO_BYTES && this.undoStack.length > 1) {
        const old = this.undoStack.shift();
        this.bytes -= [...old.values()].reduce((n, t) => n + t.data.length, 0);
      }
      this.version += 1;
    }
    this.cur = null;
  }

  _swap(from, to) {
    const rec = from.pop();
    if (!rec) return false;
    const inverse = new Map();
    rec.forEach((t, key) => { inverse.set(key, this._tile(t.x0 / TILE, t.y0 / TILE)); this._write(t); });
    to.push(inverse); this.version += 1;
    return true;
  }

  undo() { return this._swap(this.undoStack, this.redoStack); }

  redo() { return this._swap(this.redoStack, this.undoStack); }

  clear() {
    this.begin();
    for (let ty = 0; ty * TILE < this.h; ty += 1) for (let tx = 0; tx * TILE < this.w; tx += 1) {
      const t = this._tile(tx, ty);
      if (t.data.some(Boolean)) this.cur.set(ty * this.tw + tx, t);
    }
    this.data.fill(0); this.commit();
  }

  count() { let n = 0; const d = this.data; for (let i = 0; i < d.length; i += 1) n += d[i]; return n; }
}

/** Set (value 1) or clear (value 0) a filled circle. Returns its bounding box. */
export const stampCircle = (store, cx, cy, r, value) => {
  const x0 = Math.max(0, Math.floor(cx - r)); const x1 = Math.min(store.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)); const y1 = Math.min(store.h - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  store.touch(x0, y0, x1, y1);
  const r2 = r * r;
  for (let y = y0; y <= y1; y += 1) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) store.data[y * store.w + x] = value;
    }
  }
  return [x0, y0, x1, y1];
};

/** Even-odd scanline fill of a polygon given in image pixels. */
export const fillPolygon = (store, pts, value = 1) => {
  const n = pts.length;
  if (n < 3) return null;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
  const y0 = Math.max(0, Math.floor(minY)); const y1 = Math.min(store.h - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX)); const x1 = Math.min(store.w - 1, Math.ceil(maxX));
  if (y1 < y0 || x1 < x0) return null;
  store.touch(x0, y0, x1, y1);
  for (let y = y0; y <= y1; y += 1) {
    const yc = y + 0.5; const xs = [];
    for (let i = 0; i < n; i += 1) {
      const a = pts[i]; const b = pts[(i + 1) % n];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)); const to = Math.min(store.w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = from; x <= to; x += 1) store.data[y * store.w + x] = value;
    }
  }
  return [x0, y0, x1, y1];
};

// ---- magnetic lasso -----------------------------------------------------------------------------------------------

class MinHeap {
  constructor() { this.k = []; this.v = []; }

  get size() { return this.k.length; }

  push(key, val) {
    const { k, v } = this; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }

  pop() {
    const { k, v } = this; const rk = k[0]; const rv = v[0]; const lk = k.pop(); const lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c += 1;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [rk, rv];
  }
}

/** A typical strong edge strength (99th percentile of Sobel magnitude) used to normalise edge costs. */
export const estimateGradScale = (level, threshold = 0) => {
  const { data, w, h } = level; const mags = [];
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = y * w + x;
    if (data[i] <= threshold) continue;
    const gx = -data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1] + data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1];
    const gy = -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1] + data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
    mags.push(Math.hypot(gx, gy));
  }
  if (!mags.length) return 1;
  mags.sort((p, q) => p - q);
  return Math.max(1, mags[Math.floor(mags.length * 0.99)]);
};

/**
 * Cheapest path along image edges from a to b (level pixel coordinates). Edge cost is computed only inside a window
 * around the two points, so it stays fast on very large images.
 */
export const livewirePath = (level, a, b, gradScale, pad = 48) => {
  const { data, w, h } = level;
  const x0 = Math.max(0, Math.min(a.x, b.x) - pad); const x1 = Math.min(w - 1, Math.max(a.x, b.x) + pad);
  const y0 = Math.max(0, Math.min(a.y, b.y) - pad); const y1 = Math.min(h - 1, Math.max(a.y, b.y) + pad);
  const ww = x1 - x0 + 1; const hh = y1 - y0 + 1;
  // blurred copy of the window with a 2 pixel border, then Sobel on it
  const pw = ww + 4; const ph = hh + 4; const raw = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y += 1) {
    const sy = Math.min(h - 1, Math.max(0, y0 - 2 + y));
    for (let x = 0; x < pw; x += 1) raw[y * pw + x] = data[sy * w + Math.min(w - 1, Math.max(0, x0 - 2 + x))];
  }
  const bl = new Float32Array(pw * ph);
  for (let y = 1; y < ph - 1; y += 1) for (let x = 1; x < pw - 1; x += 1) {
    const i = y * pw + x;
    bl[i] = (4 * raw[i] + 2 * (raw[i - 1] + raw[i + 1] + raw[i - pw] + raw[i + pw]) + raw[i - pw - 1] + raw[i - pw + 1] + raw[i + pw - 1] + raw[i + pw + 1]) / 16;
  }
  const cost = new Float32Array(ww * hh);
  for (let y = 0; y < hh; y += 1) for (let x = 0; x < ww; x += 1) {
    const i = (y + 2) * pw + (x + 2);
    const gx = -bl[i - pw - 1] - 2 * bl[i - 1] - bl[i + pw - 1] + bl[i - pw + 1] + 2 * bl[i + 1] + bl[i + pw + 1];
    const gy = -bl[i - pw - 1] - 2 * bl[i - pw] - bl[i - pw + 1] + bl[i + pw - 1] + 2 * bl[i + pw] + bl[i + pw + 1];
    cost[y * ww + x] = 1.03 - Math.min(1, Math.hypot(gx, gy) / gradScale);   // strong edge -> cheap
  }
  const dist = new Float64Array(ww * hh).fill(Infinity); const prev = new Int32Array(ww * hh).fill(-1);
  const s = (a.y - y0) * ww + (a.x - x0); const t = (b.y - y0) * ww + (b.x - x0);
  const heap = new MinHeap(); dist[s] = 0; heap.push(0, s);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === t) break;
    const ux = u % ww; const uy = (u / ww) | 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const vx = ux + dx; const vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= ww || vy >= hh) continue;
      const v = vy * ww + vx; const nd = d + (dx && dy ? 1.4142 : 1) * cost[v];
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  const path = [];
  for (let n = t; n !== -1; n = prev[n]) path.push({ x: x0 + (n % ww), y: y0 + ((n / ww) | 0) });
  return path.reverse();
};

// ---- region growing -----------------------------------------------------------------------------------------------

/**
 * Grow a region from a seed over pixels whose intensity is within `tol` of the seed's neighbourhood mean.
 * `tol` is an absolute intensity range, normally a percentage of the image's breast range. Returns
 * {x0, y0, w, h, data, count, truncated} in level coordinates; truncated means it hit the size or distance limit.
 */
export const floodGrow = (level, seed, { tol = 300, maxRadius = 500, maxPixels = 1500000 } = {}) => {
  const { data, w, h } = level;
  const sx = Math.min(w - 1, Math.max(0, seed.x)); const sy = Math.min(h - 1, Math.max(0, seed.y));
  let n = 0; let sum = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y += 1) for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x += 1) { sum += data[y * w + x]; n += 1; }
  const mean = sum / n;
  const x0 = Math.max(0, sx - maxRadius); const x1 = Math.min(w - 1, sx + maxRadius);
  const y0 = Math.max(0, sy - maxRadius); const y1 = Math.min(h - 1, sy + maxRadius);
  const ww = x1 - x0 + 1; const hh = y1 - y0 + 1;
  const seen = new Uint8Array(ww * hh); const out = new Uint8Array(ww * hh); const queue = new Int32Array(ww * hh);
  let head = 0; let tail = 0; let count = 0; let truncated = false;
  const start = (sy - y0) * ww + (sx - x0); seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const u = queue[head++]; const ux = u % ww; const uy = (u / ww) | 0;
    if (Math.abs(data[(uy + y0) * w + ux + x0] - mean) > tol) continue;
    out[u] = 1; count += 1;
    if (count >= maxPixels) { truncated = true; break; }
    if ((ux === 0 && x0 > 0) || (uy === 0 && y0 > 0) || (ux === ww - 1 && x1 < w - 1) || (uy === hh - 1 && y1 < h - 1)) truncated = true;
    if (ux > 0 && !seen[u - 1]) { seen[u - 1] = 1; queue[tail++] = u - 1; }
    if (ux < ww - 1 && !seen[u + 1]) { seen[u + 1] = 1; queue[tail++] = u + 1; }
    if (uy > 0 && !seen[u - ww]) { seen[u - ww] = 1; queue[tail++] = u - ww; }
    if (uy < hh - 1 && !seen[u + ww]) { seen[u + ww] = 1; queue[tail++] = u + ww; }
  }
  return { x0, y0, w: ww, h: hh, data: out, truncated, count };
};

// ---- NIfTI-1 --------------------------------------------------------------------------------------------------------
// One uint8 slice: x = column, y = row, so voxel (x, y) is DICOM pixel (row y, column x).

export const buildNifti = (mask, cols, rows, spacing = { row: 1, col: 1 }) => {
  const out = new Uint8Array(352 + cols * rows);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 348, true);
  [2, cols, rows, 1, 1, 1, 1, 1].forEach((v, i) => dv.setInt16(40 + i * 2, v, true));
  dv.setInt16(70, 2, true); dv.setInt16(72, 8, true);                // uint8
  [1, spacing.col, spacing.row, 1, 0, 0, 0, 0].forEach((v, i) => dv.setFloat32(76 + i * 4, v, true));
  dv.setFloat32(108, 352, true); dv.setFloat32(112, 1, true);
  out[123] = 2;                                                       // millimetres
  dv.setInt16(254, 1, true);                                          // sform present
  [spacing.col, 0, 0, 0].forEach((v, i) => dv.setFloat32(280 + i * 4, v, true));
  [0, spacing.row, 0, 0].forEach((v, i) => dv.setFloat32(296 + i * 4, v, true));
  [0, 0, 1, 0].forEach((v, i) => dv.setFloat32(312 + i * 4, v, true));
  out.set([0x6e, 0x2b, 0x31, 0], 344);                                // "n+1"
  for (let i = 0; i < cols * rows; i += 1) out[352 + i] = mask[i] ? 1 : 0;
  return out;
};

/** Read an (already gunzipped) NIfTI-1 file into a 0/1 mask. */
export const readNifti = (raw) => {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const le = dv.getInt32(0, true) === 348;
  if (!le && dv.getInt32(0, false) !== 348) throw new Error('Not a NIfTI-1 file');
  const nx = dv.getInt16(42, le); const ny = dv.getInt16(44, le);
  const type = dv.getInt16(70, le); const off = Math.round(dv.getFloat32(108, le)) || 352;
  const size = { 2: 1, 4: 2, 512: 2, 8: 4, 16: 4 }[type];
  if (!size) throw new Error('Unsupported mask data type');
  const read = (i) => {
    const p = off + i * size;
    if (type === 2) return raw[p];
    if (type === 4) return dv.getInt16(p, le);
    if (type === 512) return dv.getUint16(p, le);
    if (type === 8) return dv.getInt32(p, le);
    return dv.getFloat32(p, le);
  };
  const data = new Uint8Array(nx * ny);
  for (let i = 0; i < data.length; i += 1) data[i] = read(i) ? 1 : 0;
  return { nx, ny, data };
};

/** Nearest-neighbour resample of a mask to a new size (only used if a saved mask does not match the image). */
export const resampleMask = (src, sw, sh, dw, dh) => {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x += 1) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / dw))];
  }
  return out;
};
