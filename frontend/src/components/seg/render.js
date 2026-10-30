// Draws the visible part of the image (plus mask overlays) into a pixel buffer. Used for the main view and the loupe.
import { levelForScale } from './pixels';

/**
 * buf: Uint32Array of outW*outH (RGBA as 0xAABBGGRR). view: {scale, tx, ty} where screen = image*scale + t.
 * mask/ref: Uint8Array(W*H) or null. preview: {x0,y0,w,h,data,level} (coordinates at pyramid `level`, default 0) or null.
 */
export const renderViewport = ({ buf, outW, outH, mips, lut, W, H, view, mask, ref, preview, alpha = 0.55, refAlpha = 0.45, color = [255, 64, 96] }) => {
  const lvl = levelForScale(view.scale, mips.length);
  const { data, w: lw } = mips[lvl];
  const lh = mips[lvl].h;
  const xFull = new Int32Array(outW); const xLvl = new Int32Array(outW);
  for (let ox = 0; ox < outW; ox += 1) {
    const ix = Math.floor((ox + 0.5 - view.tx) / view.scale);
    xFull[ox] = ix >= 0 && ix < W ? ix : -1;
    xLvl[ox] = Math.min(lw - 1, ix >> lvl);
  }
  const a = Math.round(alpha * 256); const ra = Math.round(refAlpha * 256); const pa = Math.round(0.6 * 256);
  const EMPTY = 0xff101010;
  for (let oy = 0; oy < outH; oy += 1) {
    const iy = Math.floor((oy + 0.5 - view.ty) / view.scale);
    const row = oy * outW;
    if (iy < 0 || iy >= H) { buf.fill(EMPTY, row, row + outW); continue; }
    const yl = Math.min(lh - 1, iy >> lvl) * lw;
    const mrow = iy * W;
    for (let ox = 0; ox < outW; ox += 1) {
      const ix = xFull[ox];
      if (ix < 0) { buf[row + ox] = EMPTY; continue; }
      const v = lut[data[yl + xLvl[ox]]];
      let r = v; let g = v; let b = v;
      if (ref && ref[mrow + ix]) { r += ((64 - r) * ra) >> 8; g += ((160 - g) * ra) >> 8; b += ((255 - b) * ra) >> 8; }
      if (mask && mask[mrow + ix]) { r += ((color[0] - r) * a) >> 8; g += ((color[1] - g) * a) >> 8; b += ((color[2] - b) * a) >> 8; }
      if (preview) {
        const pl = preview.level || 0;                       // preview may be at a coarser pyramid level
        const px = (ix >> pl) - preview.x0; const py = (iy >> pl) - preview.y0;
        if (px >= 0 && py >= 0 && px < preview.w && py < preview.h && preview.data[py * preview.w + px]) {
          r += ((255 - r) * pa) >> 8; g += ((210 - g) * pa) >> 8; b += ((74 - b) * pa) >> 8;
        }
      }
      buf[row + ox] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }
};
