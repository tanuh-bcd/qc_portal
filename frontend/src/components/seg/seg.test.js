import { buildMips, parseNumbers, levelForScale, makeLut, analyzeImage, percentilesFromHist, presetWindow, PRESETS } from './pixels';
import { renderViewport } from './render';
import { MaskStore, stampCircle, fillPolygon, livewirePath, estimateGradScale, floodGrow, buildNifti, readNifti, resampleMask } from './segTools';

const img = (w, h, f) => { const d = new Uint16Array(w * h); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) d[y * w + x] = f(x, y); return d; };

describe('DICOM number strings', () => {
  test('reads exponent forms, lists and plain values', () => {
    expect(parseNumbers('8.5e-002')).toEqual([0.085]);
    expect(parseNumbers('[0.07, 0.085]')).toEqual([0.07, 0.085]);
    expect(parseNumbers('0.1\\0.1')).toEqual([0.1, 0.1]);
    expect(parseNumbers('2048')).toEqual([2048]);
    expect(parseNumbers('')).toEqual([]); expect(parseNumbers(undefined)).toEqual([]);
  });
});

describe('pyramid and windowing', () => {
  test('mips halve the size and average 2x2 blocks', () => {
    const m = buildMips(img(4, 4, (x, y) => (x < 2 ? 100 : 300)), 4, 4, 3);
    expect([m[1].w, m[1].h, m[2].w, m[2].h]).toEqual([2, 2, 1, 1]);
    expect(Array.from(m[1].data)).toEqual([100, 300, 100, 300]);
    expect(m[2].data[0]).toBe(200);
  });
  test('odd sizes do not lose the last row or column', () => {
    const m = buildMips(img(5, 3, () => 1000), 5, 3, 2);
    expect([m[1].w, m[1].h]).toEqual([3, 2]);
    expect(Array.from(m[1].data)).toEqual(new Array(6).fill(1000));
  });
  test('pyramid level follows zoom', () => {
    expect([1, 2, 0.5, 0.25, 0.12, 0.01].map((s) => levelForScale(s, 4))).toEqual([0, 0, 1, 2, 3, 3]);
  });
  test('DICOM linear window: below is black, above is white, centre is mid grey', () => {
    const lut = makeLut(2000, 1000);
    expect(lut[0]).toBe(0); expect(lut[1400]).toBe(0); expect(lut[2600]).toBe(255); expect(lut[65535]).toBe(255);
    expect(Math.abs(lut[2000] - 128)).toBeLessThanOrEqual(1);
    const inv = makeLut(2000, 1000, true);
    expect(inv[0]).toBe(255); expect(inv[65535]).toBe(0);
  });
  test('percentiles come from a histogram', () => {
    const hist = new Uint32Array(65536); for (let v = 0; v < 100; v += 1) hist[v] = 1;
    expect(percentilesFromHist(hist, 100, [50, 99])).toEqual([49, 98]);
  });
});

describe('presets use the breast pixels, not the empty background', () => {
  // 60% empty background (value 0..20), the rest tissue between 1000 and 3000, with a bright small mass
  const W = 200; const H = 160;
  const data = img(W, H, (x, y) => (x < 120 ? (x * 7 + y) % 20 : 1000 + ((x * 13 + y * 7) % 2000)));
  const mips = buildMips(data, W, H, 4);
  const stats = analyzeImage(mips);
  test('background is excluded from the statistics', () => {
    expect(stats.threshold).toBeGreaterThan(20);
    expect(stats.total).toBeLessThan(mips[2].data.length);
    const auto = presetWindow('auto', stats);
    expect(auto.center - auto.width / 2).toBeGreaterThan(500);   // would be ~0 if the background counted
  });
  test('dense window starts higher than auto, fat window ends lower', () => {
    const lo = (w) => w.center - w.width / 2; const hi = (w) => w.center + w.width / 2;
    const auto = presetWindow('auto', stats); const dense = presetWindow('dense', stats); const fat = presetWindow('fat', stats);
    expect(lo(dense)).toBeGreaterThan(lo(auto)); expect(hi(fat)).toBeLessThan(hi(auto));
  });
  test('default uses the DICOM window when present, otherwise auto', () => {
    expect(presetWindow('default', stats, { headerWindow: { center: 2048, width: 4096 } })).toEqual({ center: 2048, width: 4096 });
    expect(presetWindow('default', stats)).toEqual(presetWindow('auto', stats));
  });
  test('lesion edge window is fitted to the area around the cursor', () => {
    const local = img(W, H, (x, y) => (Math.hypot(x - 150, y - 80) < 12 ? 2900 : 2000));
    const m2 = buildMips(local, W, H, 4);
    const w = presetWindow('edge', analyzeImage(m2), { mips: m2, cursor: { x: 150, y: 80 } });
    expect(w.center - w.width / 2).toBeGreaterThanOrEqual(1999); expect(w.center + w.width / 2).toBeLessThanOrEqual(2901);
  });
  test('lesion edge ignores background: a cursor over empty space falls back to the global window', () => {
    const w = presetWindow('edge', stats, { mips, cursor: { x: 10, y: 10 } });        // inside the empty background
    expect(w.center - w.width / 2).toBeGreaterThan(500);
  });
  test('every preset has a unique key', () => { expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length); });
});

describe('viewport renderer', () => {
  const W = 4; const H = 4; const data = img(W, H, (x) => x * 1000);
  const mips = buildMips(data, W, H, 2); const lut = makeLut(1500, 3001);
  test('zoomed in shows each image pixel as a block and leaves the outside empty', () => {
    const buf = new Uint32Array(12 * 8);
    renderViewport({ buf, outW: 12, outH: 8, mips, lut, W, H, view: { scale: 2, tx: 2, ty: 0 }, mask: null, ref: null });
    const px = (x, y) => buf[y * 12 + x] & 0xff;
    expect(px(0, 0)).toBe(0x10); expect(px(1, 1)).toBe(0x10);                       // left of the image
    expect(px(2, 0)).toBe(lut[0]); expect(px(3, 0)).toBe(lut[0]); expect(px(4, 0)).toBe(lut[1000]); expect(px(9, 0)).toBe(lut[3000]);
    expect(px(10, 0)).toBe(0x10);                                                   // right of the image
    expect(px(4, 7)).toBe(lut[1000]);                                               // y is 0..7 -> image rows 0..3
  });
  test('a mask is blended in red over the image and a preview in yellow', () => {
    const mask = new Uint8Array(W * H); mask[0] = 1;
    const buf = new Uint32Array(8 * 8);
    renderViewport({ buf, outW: 8, outH: 8, mips, lut, W, H, view: { scale: 2, tx: 0, ty: 0 }, mask, ref: null, alpha: 1,
      preview: { x0: 3, y0: 3, w: 1, h: 1, data: Uint8Array.of(1) } });
    expect(buf[0] & 0xff).toBe(255); expect((buf[0] >> 8) & 0xff).toBe(64);        // red mask, fully opaque
    expect((buf[7 * 8 + 7] >> 8) & 0xff).toBeGreaterThan(150);                     // yellow preview in the last block
    expect(buf[0 * 8 + 4] & 0xff).toBe(lut[2000]);                                  // untouched pixel
  });
  test('zoomed out reads from a smaller pyramid level', () => {
    const big = img(8, 8, (x) => (x < 4 ? 0 : 2000)); const m = buildMips(big, 8, 8, 3);
    const buf = new Uint32Array(4 * 4);
    renderViewport({ buf, outW: 4, outH: 4, mips: m, lut: makeLut(1000, 2001), W: 8, H: 8, view: { scale: 0.5, tx: 0, ty: 0 }, mask: null, ref: null });
    expect(buf[0] & 0xff).toBe(0); expect(buf[3] & 0xff).toBe(255);
  });
});

describe('mask editing', () => {
  test('brush strokes can be undone and redone, across tile borders', () => {
    const s = new MaskStore(300, 200);
    s.begin(); stampCircle(s, 127, 100, 10, 1); s.commit();          // straddles the 128 px tile border
    const after1 = s.count(); expect(after1).toBeGreaterThan(250);
    s.begin(); stampCircle(s, 200, 50, 8, 1); s.commit();
    expect(s.count()).toBeGreaterThan(after1);
    expect(s.undo()).toBe(true); expect(s.count()).toBe(after1);
    expect(s.undo()).toBe(true); expect(s.count()).toBe(0);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true); expect(s.count()).toBe(after1);
  });
  test('erasing is undoable and a new edit drops the redo history', () => {
    const s = new MaskStore(100, 100);
    s.begin(); stampCircle(s, 50, 50, 20, 1); s.commit();
    const full = s.count();
    s.begin(); stampCircle(s, 50, 50, 20, 0); s.commit(); expect(s.count()).toBe(0);
    s.undo(); expect(s.count()).toBe(full);
    s.begin(); stampCircle(s, 10, 10, 3, 1); s.commit(); expect(s.redo()).toBe(false);
  });
  test('clear can be undone', () => {
    const s = new MaskStore(256, 256);
    s.begin(); stampCircle(s, 128, 128, 40, 1); s.commit(); const n = s.count();
    s.clear(); expect(s.count()).toBe(0); s.undo(); expect(s.count()).toBe(n);
  });
  test('polygon fill covers the right area and can subtract', () => {
    const s = new MaskStore(100, 100);
    s.begin(); fillPolygon(s, [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 10, y: 30 }], 1); s.commit();
    expect(s.count()).toBe(30 * 20);
    s.begin(); fillPolygon(s, [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 20, y: 30 }], 0); s.commit();
    expect(s.count()).toBe(30 * 20 - 10 * 20);
    s.begin(); fillPolygon(s, [{ x: -50, y: 50 }, { x: 5, y: 50 }, { x: 5, y: 60 }], 1); s.commit(); // partly outside: no crash
    expect(s.count()).toBeGreaterThan(400); expect(s.count()).toBeLessThan(480);
  });
  test('triangle area is about half its bounding box', () => {
    const s = new MaskStore(120, 120);
    s.begin(); fillPolygon(s, [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 90 }], 1); s.commit();
    expect(Math.abs(s.count() - 3200)).toBeLessThan(120);
  });
});

describe('magnetic lasso', () => {
  // dark left half, bright right half, a vertical edge at x = 50
  const level = { data: img(100, 100, (x) => (x < 50 ? 1000 : 3000)), w: 100, h: 100 };
  const scale = estimateGradScale(level);
  test('the path snaps onto the edge instead of running straight', () => {
    const path = livewirePath(level, { x: 46, y: 20 }, { x: 46, y: 80 }, scale);
    expect(path[0]).toEqual({ x: 46, y: 20 }); expect(path[path.length - 1]).toEqual({ x: 46, y: 80 });
    const middle = path.filter((p) => p.y > 35 && p.y < 65);
    expect(middle.length).toBeGreaterThan(20);
    middle.forEach((p) => { expect(p.x).toBeGreaterThanOrEqual(48); expect(p.x).toBeLessThanOrEqual(51); });
  });
  test('on a flat area the path is straight and short', () => {
    const flat = { data: img(100, 100, () => 2000), w: 100, h: 100 };
    const path = livewirePath(flat, { x: 10, y: 10 }, { x: 60, y: 10 }, 1000);
    expect(path.length).toBe(51);
    path.forEach((p) => expect(p.y).toBe(10));
  });
  test('works at the image border and for identical points', () => {
    expect(livewirePath(level, { x: 0, y: 0 }, { x: 0, y: 0 }, scale)).toEqual([{ x: 0, y: 0 }]);
    expect(livewirePath(level, { x: 0, y: 0 }, { x: 99, y: 99 }, scale).length).toBeGreaterThan(99);
  });
});

describe('region growing', () => {
  const disc = { data: img(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 25 ? 3000 : 1200) + ((x * 7 + y * 3) % 50)), w: 200, h: 200 };
  test('grows to the lesion and stops at its edge', () => {
    const r = floodGrow(disc, { x: 100, y: 100 }, { tol: 300 });
    expect(r.truncated).toBe(false);
    expect(Math.abs(r.count - Math.PI * 25 * 25)).toBeLessThan(Math.PI * 25 * 25 * 0.1);
    expect(r.data[(100 - r.y0) * r.w + (100 - r.x0)]).toBe(1);
    expect(r.data[(100 - r.y0) * r.w + (140 - r.x0)]).toBe(0);
  });
  test('a tighter tolerance stops earlier', () => {
    const loose = floodGrow(disc, { x: 100, y: 100 }, { tol: 300 }).count;
    const wide = floodGrow(disc, { x: 100, y: 100 }, { tol: 4000 });
    expect(wide.count).toBeGreaterThan(loose * 5);   // 4000 also swallows the darker surroundings
  });
  test('a flat image leaks to the limit and says so', () => {
    const flat = { data: img(200, 200, () => 2000), w: 200, h: 200 };
    const r = floodGrow(flat, { x: 100, y: 100 }, { tol: 300, maxPixels: 5000 });
    expect(r.truncated).toBe(true);
  });
});

describe('NIfTI', () => {
  test('write then read gives the same mask and a valid header', () => {
    const mask = new Uint8Array(7 * 5); mask[3] = 1; mask[20] = 1; mask[34] = 1;
    const raw = buildNifti(mask, 7, 5, { row: 0.07, col: 0.085 });
    const dv = new DataView(raw.buffer);
    expect([dv.getInt32(0, true), dv.getInt16(42, true), dv.getInt16(44, true), dv.getInt16(70, true)]).toEqual([348, 7, 5, 2]);
    expect(String.fromCharCode(...raw.slice(344, 347))).toBe('n+1');
    expect(dv.getFloat32(80, true)).toBeCloseTo(0.085, 5); expect(dv.getFloat32(84, true)).toBeCloseTo(0.07, 5);   // x = column spacing, y = row spacing
    const back = readNifti(raw);
    expect([back.nx, back.ny]).toEqual([7, 5]); expect(Array.from(back.data)).toEqual(Array.from(mask));
  });
  test('rejects things that are not NIfTI and resamples mismatched masks', () => {
    expect(() => readNifti(new Uint8Array(400))).toThrow();
    const m = Uint8Array.of(1, 0, 0, 1);
    expect(Array.from(resampleMask(m, 2, 2, 4, 4)).reduce((a, b) => a + b, 0)).toBe(8);
    expect(resampleMask(m, 2, 2, 2, 2)).toBe(m);
  });
});
