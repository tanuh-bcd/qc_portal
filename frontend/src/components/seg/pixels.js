// Full-resolution image data for the annotation tools: loading, zoom pyramid, window/level and presets.
// Everything here is plain JavaScript on typed arrays, so it can be tested without a browser.

/** All numbers in a DICOM value string, including exponent forms such as '8.5e-002' and multi-values like '[0.07, 0.07]'. */
export const parseNumbers = (value) => (String(value ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);

/** Pyramid of 16-bit images, each half the size of the last (2x2 average). mips[0] is the original. */
export const buildMips = (data, w, h, levels = 4) => {
  const mips = [{ data, w, h }];
  for (let l = 1; l < levels; l += 1) {
    const src = mips[l - 1];
    const nw = Math.max(1, Math.ceil(src.w / 2));
    const nh = Math.max(1, Math.ceil(src.h / 2));
    const out = new Uint16Array(nw * nh);
    for (let y = 0; y < nh; y += 1) {
      const y0 = y * 2; const y1 = Math.min(y0 + 1, src.h - 1);
      for (let x = 0; x < nw; x += 1) {
        const x0 = x * 2; const x1 = Math.min(x0 + 1, src.w - 1);
        out[y * nw + x] = (src.data[y0 * src.w + x0] + src.data[y0 * src.w + x1] + src.data[y1 * src.w + x0] + src.data[y1 * src.w + x1] + 2) >> 2;
      }
    }
    mips.push({ data: out, w: nw, h: nh });
  }
  return mips;
};

/** Level of the pyramid whose pixels are about one screen pixel at this zoom (scale = screen px per image px). */
export const levelForScale = (scale, levels) => Math.max(0, Math.min(levels - 1, Math.floor(Math.log2(1 / Math.max(scale, 1e-6)) + 1e-6)));

/** DICOM linear window (PS3.3 C.11.2.1.2) as an 8-bit lookup table over all 16-bit values. */
export const makeLut = (center, width, invert = false) => {
  const lut = new Uint8Array(65536);
  const w = Math.max(1, width);
  const lo = center - 0.5 - (w - 1) / 2;
  const hi = center - 0.5 + (w - 1) / 2;
  for (let v = 0; v < 65536; v += 1) {
    const y = v <= lo ? 0 : v > hi ? 1 : (v - (center - 0.5)) / (w - 1 || 1) + 0.5;
    lut[v] = Math.round((invert ? 1 - y : y) * 255);
  }
  return lut;
};

/** Otsu threshold on a coarse histogram, to tell breast tissue from the empty background. */
export const otsuThreshold = (data) => {
  let max = 1;
  for (let i = 0; i < data.length; i += 1) if (data[i] > max) max = data[i];
  const bins = 256; const hist = new Float64Array(bins);
  for (let i = 0; i < data.length; i += 1) hist[Math.min(bins - 1, Math.floor((data[i] / max) * (bins - 1)))] += 1;
  const total = data.length;
  let sumAll = 0; for (let b = 0; b < bins; b += 1) sumAll += b * hist[b];
  let wB = 0; let sumB = 0; let best = -1; let bestT = 0;
  for (let b = 0; b < bins; b += 1) {
    wB += hist[b]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += b * hist[b];
    const between = wB * wF * ((sumB / wB - (sumAll - sumB) / wF) ** 2);
    if (between > best) { best = between; bestT = b; }
  }
  return Math.round(((bestT + 1) / (bins - 1)) * max);
};

/** Histogram of breast pixels (above the background threshold) taken from a small pyramid level. */
export const analyzeImage = (mips) => {
  const level = mips[Math.min(2, mips.length - 1)];
  const threshold = otsuThreshold(level.data);
  const hist = new Uint32Array(65536);
  let total = 0; let min = 65535; let max = 0;
  for (let i = 0; i < level.data.length; i += 1) {
    const v = level.data[i];
    if (v > max) max = v; if (v < min) min = v;
    if (v > threshold) { hist[v] += 1; total += 1; }
  }
  if (total < 100) { // nothing separable: use every pixel
    hist.fill(0); total = 0;
    for (let i = 0; i < level.data.length; i += 1) { hist[level.data[i]] += 1; total += 1; }
  }
  return { hist, total, threshold, min, max };
};

/** Values at the given percentiles (0-100) of a histogram. */
export const percentilesFromHist = (hist, total, ps) => {
  const out = new Array(ps.length).fill(0);
  let acc = 0; let k = 0;
  for (let v = 0; v < hist.length && k < ps.length; v += 1) {
    acc += hist[v];
    while (k < ps.length && acc >= (ps[k] * total) / 100) { out[k] = v; k += 1; }
  }
  for (; k < ps.length; k += 1) out[k] = hist.length - 1;
  return out;
};

/** Percentiles of the pixels in a square region of the full-resolution image (for the local "lesion edge" window). */
export const regionPercentiles = (img, cx, cy, size, ps, minValue = 0) => {
  const half = Math.floor(size / 2);
  const x0 = Math.max(0, Math.round(cx) - half); const x1 = Math.min(img.w, x0 + size);
  const y0 = Math.max(0, Math.round(cy) - half); const y1 = Math.min(img.h, y0 + size);
  const hist = new Uint32Array(65536); let total = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const v = img.data[y * img.w + x];
    if (v > minValue) { hist[v] += 1; total += 1; }          // leave out the empty background
  }
  return total >= 400 ? percentilesFromHist(hist, total, ps) : null;   // too little tissue here: caller falls back
};

// Presets are percentile windows of the image's own breast pixels, so they behave the same on every vendor.
// These numbers are starting points to tune with radiologists on real cases.
export const PRESETS = [
  { id: 'default', key: '1', label: 'Default', hint: 'The window stored in the DICOM file' },
  { id: 'auto', key: '2', label: 'Auto', hint: 'Stretches the breast tissue (0.5 to 99.5 percent)', range: [0.5, 99.5] },
  { id: 'dense', key: '3', label: 'Dense tissue', hint: 'Emphasises dense tissue and masses; fat turns dark', range: [40, 99.9] },
  { id: 'edge', key: '4', label: 'Lesion edge', hint: 'Contrast fitted to the area around the cursor', range: [2, 98], local: 384, fallback: [20, 95] },
  { id: 'fat', key: '5', label: 'Skin / fat', hint: 'Shows skin line and fatty tissue', range: [0.5, 70] },
  { id: 'calc', key: '6', label: 'Calcifications', hint: 'Narrow bright window for tiny bright specks', range: [92, 99.95] },
];

const toWindow = (lo, hi) => ({ center: (lo + hi) / 2, width: Math.max(1, hi - lo + 1) });

/** Window {center, width} for a preset. `cursor` is in image pixels; `headerWindow` is the DICOM tag value if any. */
export const presetWindow = (id, stats, { mips, cursor, headerWindow } = {}) => {
  const preset = PRESETS.find((p) => p.id === id) || PRESETS[1];
  const pct = (ps) => percentilesFromHist(stats.hist, stats.total, ps);
  if (id === 'default') {
    if (headerWindow && headerWindow.width > 1) return headerWindow;
    return presetWindow('auto', stats);
  }
  if (id === 'edge' && mips && cursor) {
    const local = regionPercentiles(mips[0], cursor.x, cursor.y, preset.local, preset.range, stats.threshold);
    if (local && local[1] > local[0]) return toWindow(local[0], local[1]);
  }
  const [lo, hi] = pct(id === 'edge' ? preset.fallback : preset.range);
  return toWindow(lo, hi === lo ? lo + 1 : hi);
};

/** Fetch the raw 16-bit pixels of one view. `expectedBytes` (rows*cols*2) drives the progress callback. */
export const loadPixels = async (url, headers, expectedBytes, onProgress, signal) => {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`Could not load the image (${res.status})`);
  const out = new Uint8Array(expectedBytes);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > expectedBytes) throw new Error('Image is larger than its header says');
    out.set(value, got); got += value.length;
    onProgress && onProgress(got / expectedBytes);
  }
  if (got !== expectedBytes) throw new Error('Image data is incomplete');
  return new Uint16Array(out.buffer);
};
