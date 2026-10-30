import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { API, auth } from './RetroCaseViewer';
import { buildMips, parseNumbers, levelForScale, makeLut, analyzeImage, percentilesFromHist, presetWindow, loadPixels } from './seg/pixels';
import { renderViewport } from './seg/render';
import { MaskStore, stampCircle, fillPolygon, livewirePath, estimateGradScale, floodGrow, buildNifti, readNifti, resampleMask } from './seg/segTools';

const LEVELS = 4;

const headerValue = (file, name) => (file?.dicom_headers || []).find((h) => h.name === name)?.value;
export const imageSize = (file) => {
  const cols = parseInt(headerValue(file, 'Columns'), 10); const rows = parseInt(headerValue(file, 'Rows'), 10);
  return cols > 0 && rows > 0 ? { cols, rows } : null;
};
const pixelSpacing = (file) => {
  const n = parseNumbers(headerValue(file, 'PixelSpacing'));
  return n.length >= 2 && n[0] > 0 && n[1] > 0 ? { row: n[0], col: n[1] } : { row: 1, col: 1 };
};
const firstNumber = (v) => { const n = parseNumbers(v); return n.length ? n[0] : NaN; };
const headerWindow = (file) => {
  const center = firstNumber(headerValue(file, 'WindowCenter')); const width = firstNumber(headerValue(file, 'WindowWidth'));
  return center > 0 && width > 1 ? { center, width } : null;
};
const isMono1 = (file) => /MONOCHROME1/i.test(String(headerValue(file, 'PhotometricInterpretation') || ''));

const gzip = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzip = async (buf) => new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
const fetchMask = async (caseId, maskId, W, H) => {
  const res = await fetch(`${API}/cases/${caseId}/masks/${maskId}/data`, { headers: auth() });
  if (!res.ok) throw new Error(`Could not load a saved mask (${res.status})`);
  const { nx, ny, data } = readNifti(await gunzip(await res.arrayBuffer()));
  return resampleMask(data, nx, ny, W, H);
};

/**
 * One image box of the segmentation workspace. It owns the pixels, the mask and the zoom/pan of ONE view.
 * Tool choices come from the parent; the parent drives it through the ref handle (undo, finish, clear, save...).
 */
const SegViewport = forwardRef(({ caseId, caseCode, file, view, masks, role, canEdit, tool, mode, brush, opacity, growPct, color, markColor, markWidth, author, myMarks, otherMarks, showRef, active, onActivate, onStatus, onSaved, onError }, handle) => {
  const [loading, setLoading] = useState(null);
  const [info, setInfo] = useState({});
  const [ready, setReady] = useState(0);
  const [, setPend] = useState(0);
  const bump = () => setPend((n) => n + 1);

  const stageRef = useRef(null); const canvasRef = useRef(null); const overlayRef = useRef(null);
  const imgRef = useRef(null); const storeRef = useRef(null); const refMaskRef = useRef(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 }); const sizeRef = useRef({ w: 0, h: 0 });
  const lutRef = useRef(null); const frameRef = useRef(null); const idataRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, ix: 0, iy: 0, inside: false });
  const drawingRef = useRef(null); const panRef = useRef(null); const spaceRef = useRef(false);
  const pathRef = useRef({ anchors: [], segs: [], live: [] });
  const previewRef = useRef(null);
  const savedVersion = useRef(0); const infoTimer = useRef(null);
  const winRef = useRef({ win: null, presetId: 'auto', invert: false });
  const statusRef = useRef({});
  const optsRef = useRef({});
  const marksRef = useRef([]); const markDraft = useRef(null);   // free-hand markup (separate from the mask): [{id,type,color,width,author,pts|box}]
  const otherMarksRef = useRef([]); otherMarksRef.current = otherMarks || [];
  const marksVer = useRef(0);

  const size = file ? imageSize(file) : null;
  const refRole = role === 'radiologist' ? 'mammo_tech' : 'radiologist';
  optsRef.current = { tool, mode, brush, opacity, showRef, growPct, canEdit, color, markColor, markWidth, author };
  const isMark = (t) => t === 'markpen' || t === 'markcircle' || t === 'markarrow';

  const emit = useCallback((patch) => {
    statusRef.current = { ...statusRef.current, ...patch };
    onStatus && onStatus(view, statusRef.current);
  }, [onStatus, view]);

  const toImage = (sx, sy) => { const v = viewRef.current; return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale }; };
  const toScreen = (ix, iy) => { const v = viewRef.current; return { x: ix * v.scale + v.tx, y: iy * v.scale + v.ty }; };
  const levelFor = useCallback((cap = 2) => Math.min(cap, levelForScale(viewRef.current.scale, LEVELS)), []);
  const gradFor = (lvl) => {
    const img = imgRef.current;
    if (img.grad[lvl] === undefined) img.grad[lvl] = estimateGradScale(img.mips[lvl], img.stats.threshold);
    return img.grad[lvl];
  };
  const pendingState = () => ({ points: pathRef.current.anchors.length, preview: !!previewRef.current });

  const lassoPath = (a, b) => {
    const img = imgRef.current;
    if (optsRef.current.tool !== 'lasso') return [a, b];
    const lvl = levelFor(2); const f = 2 ** lvl; const L = img.mips[lvl];
    const clamp = (p) => ({ x: Math.min(L.w - 1, Math.max(0, Math.floor(p.x / f))), y: Math.min(L.h - 1, Math.max(0, Math.floor(p.y / f))) });
    return livewirePath(L, clamp(a), clamp(b), gradFor(lvl), 48).map((p, i, arr) => (i === 0 ? a : i === arr.length - 1 ? b : { x: (p.x + 0.5) * f, y: (p.y + 0.5) * f }));
  };

  const drawOverlay = () => {
    const c = overlayRef.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    const o = optsRef.current; const { anchors, segs, live } = pathRef.current;
    const line = (pts, style, dash) => {
      if (pts.length < 2) return;
      ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = style; ctx.lineWidth = 2;
      pts.forEach((p, i) => { const s = toScreen(p.x, p.y); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    const rgb = `rgb(${o.color.join(',')})`;
    segs.forEach((s) => line(s, rgb));
    if (anchors.length) line(live, '#4fe3ff', [5, 4]);
    anchors.forEach((p, i) => { const s = toScreen(p.x, p.y); ctx.beginPath(); ctx.arc(s.x, s.y, i === 0 ? 6 : 4, 0, 7); ctx.fillStyle = i === 0 ? '#fff' : rgb; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); });
    if (previewRef.current?.seed) { const s = toScreen(previewRef.current.seed.x, previewRef.current.seed.y); ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.stroke(); }
    const drawMark = (k) => {
      ctx.strokeStyle = k.color; ctx.fillStyle = k.color; ctx.lineWidth = k.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
      if (k.type === 'pen') {
        ctx.beginPath(); k.pts.forEach((p, i) => { const q = toScreen(p.x, p.y); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
      } else if (k.type === 'circle') {
        const a = toScreen(k.box.x0, k.box.y0); const b = toScreen(k.box.x1, k.box.y1);
        ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2 || 1, Math.abs(b.y - a.y) / 2 || 1, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (k.type === 'arrow') {
        const a = toScreen(k.box.x0, k.box.y0); const b = toScreen(k.box.x1, k.box.y1);
        const ang = Math.atan2(b.y - a.y, b.x - a.x); const hd = 10 + k.width * 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - hd * Math.cos(ang - 0.45), b.y - hd * Math.sin(ang - 0.45)); ctx.lineTo(b.x - hd * Math.cos(ang + 0.45), b.y - hd * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      }
      if (k.author) {
        const q = toScreen(...(k.type === 'pen' ? [k.pts[0].x, k.pts[0].y] : [Math.min(k.box.x0, k.box.x1), Math.min(k.box.y0, k.box.y1)]));
        ctx.font = '600 11px system-ui, sans-serif'; const w = ctx.measureText(k.author).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(q.x, q.y - 17, w, 15); ctx.fillStyle = k.color; ctx.fillText(k.author, q.x + 4, q.y - 6);
      }
    };
    otherMarksRef.current.forEach((k) => { ctx.globalAlpha = 0.9; drawMark(k); ctx.globalAlpha = 1; });
    marksRef.current.forEach(drawMark); if (markDraft.current) drawMark(markDraft.current);
    const m = mouseRef.current;
    if (m.inside && isMark(o.tool) && o.canEdit) {
      ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(2, o.markWidth / 2 + 1), 0, 7); ctx.fillStyle = o.markColor; ctx.fill();
    } else if (m.inside && o.canEdit && o.tool === 'brush') {
      ctx.beginPath(); ctx.arc(m.x, m.y, o.brush / 2, 0, 7); ctx.strokeStyle = o.mode === 'sub' ? '#ffd24a' : '#fff'; ctx.setLineDash(o.mode === 'sub' ? [4, 3] : []); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    } else if (m.inside && o.canEdit && (o.tool === 'lasso' || o.tool === 'polygon' || o.tool === 'grow')) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.x - 8, m.y); ctx.lineTo(m.x + 8, m.y); ctx.moveTo(m.x, m.y - 8); ctx.lineTo(m.x, m.y + 8); ctx.stroke();
    }
  };

  const draw = useCallback(() => {
    frameRef.current = null;
    const cv = canvasRef.current; const img = imgRef.current; const { w, h } = sizeRef.current;
    if (!cv || !w || !h) return;
    const ctx = cv.getContext('2d');
    if (!img || !storeRef.current || !lutRef.current) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); drawOverlay(); return; }
    const o = optsRef.current;
    if (o.tool === 'lasso' || o.tool === 'polygon') {
      const { anchors } = pathRef.current; const m = mouseRef.current;
      if (anchors.length && m.inside) pathRef.current.live = lassoPath(anchors[anchors.length - 1], { x: Math.round(m.ix), y: Math.round(m.iy) });
    }
    if (!idataRef.current || idataRef.current.width !== w || idataRef.current.height !== h) idataRef.current = ctx.createImageData(w, h);
    renderViewport({
      buf: new Uint32Array(idataRef.current.data.buffer), outW: w, outH: h, mips: img.mips, lut: lutRef.current, W: img.W, H: img.H,
      view: viewRef.current, mask: storeRef.current.data, ref: o.showRef ? refMaskRef.current : null, preview: previewRef.current, alpha: o.opacity, color: o.color,
    });
    ctx.putImageData(idataRef.current, 0, 0);
    drawOverlay();
  }, []); // eslint-disable-line

  const invalidate = useCallback(() => { if (!frameRef.current) frameRef.current = requestAnimationFrame(draw); }, [draw]);
  useEffect(() => () => { cancelAnimationFrame(frameRef.current); clearTimeout(infoTimer.current); }, []);
  useEffect(() => { invalidate(); }, [opacity, showRef, tool, mode, brush, color, otherMarks, invalidate]);

  // ---- zoom / pan -------------------------------------------------------------------------------------------------
  const fitView = useCallback(() => {
    const img = imgRef.current; const { w, h } = sizeRef.current;
    if (!img || !w) return;
    const s = Math.min(w / img.W, h / img.H) * 0.97;
    viewRef.current = { scale: s, tx: (w - img.W * s) / 2, ty: (h - img.H * s) / 2 };
    setInfo((i) => ({ ...i, zoom: s })); invalidate();
  }, [invalidate]);
  const zoomAt = useCallback((sx, sy, factor) => {
    const img = imgRef.current; if (!img) return;
    const v = viewRef.current; const fit = Math.min(sizeRef.current.w / img.W, sizeRef.current.h / img.H);
    const s = Math.min(24, Math.max(fit * 0.4, v.scale * factor)); const k = s / v.scale;
    viewRef.current = { scale: s, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
    setInfo((i) => ({ ...i, zoom: s })); invalidate();
  }, [invalidate]);
  const zoomTo = (scale) => { const { w, h } = sizeRef.current; const c = toImage(w / 2, h / 2); viewRef.current = { scale, tx: w / 2 - c.x * scale, ty: h / 2 - c.y * scale }; setInfo((i) => ({ ...i, zoom: scale })); invalidate(); };

  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const apply = () => {
      const w = Math.max(50, Math.floor(el.clientWidth)); const h = Math.max(50, Math.floor(el.clientHeight));
      const first = !sizeRef.current.w; sizeRef.current = { w, h };
      [canvasRef.current, overlayRef.current].forEach((c) => { if (c) { c.width = w; c.height = h; } });
      idataRef.current = null;
      if (first) fitView(); else invalidate();
    };
    apply();
    const ro = new ResizeObserver(apply); ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, invalidate]);

  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- window / level -----------------------------------------------------------------------------------------------
  const setWindow = (win, presetId, invert) => {
    winRef.current = { win, presetId, invert };
    if (win && imgRef.current) lutRef.current = makeLut(win.center, win.width, imgRef.current.mono1 !== invert);
    emit({ win, presetId, invert }); invalidate();
  };
  const applyPreset = (id) => {
    const img = imgRef.current; if (!img) return;
    const m = mouseRef.current;
    const cursor = m.inside ? { x: m.ix, y: m.iy } : { x: img.W / 2, y: img.H / 2 };
    setWindow(presetWindow(id, img.stats, { mips: img.mips, cursor, headerWindow: img.headerWin }), id, winRef.current.invert);
  };

  // ---- loading ----------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!file || !size) { imgRef.current = null; setLoading(null); return undefined; }
    const abort = new AbortController(); let cancelled = false;
    imgRef.current = null; storeRef.current = null; refMaskRef.current = null; lutRef.current = null; invalidate();
    setLoading({ pct: 0 });
    pathRef.current = { anchors: [], segs: [], live: [] }; previewRef.current = null;
    (async () => {
      try {
        const data = await loadPixels(`${API}/files/${file.id}/pixels`, auth(), size.cols * size.rows * 2, (p) => !cancelled && setLoading({ pct: p }), abort.signal);
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 0));
        const mips = buildMips(data, size.cols, size.rows, LEVELS);
        const img = { mips, W: size.cols, H: size.rows, stats: analyzeImage(mips), grad: [], mono1: isMono1(file), headerWin: headerWindow(file), file };
        const store = new MaskStore(size.cols, size.rows);
        const mine = masks.find((m) => m.view === view && m.role === role);
        const other = masks.find((m) => m.view === view && m.role === refRole);
        if (mine) store.data = await fetchMask(caseId, mine.id, size.cols, size.rows);
        refMaskRef.current = other ? await fetchMask(caseId, other.id, size.cols, size.rows) : null;
        if (cancelled) return;
        storeRef.current = store; imgRef.current = img; savedVersion.current = store.version;
        setLoading(null); setReady((n) => n + 1);
        const hw = img.headerWin; const id = hw ? 'default' : 'auto';
        setWindow(presetWindow(id, img.stats, { headerWindow: hw }), id, false);
        marksRef.current = (myMarks || []).map((k) => ({ ...k }));
        emit({ loaded: true, marks: marksRef.current.length, dirty: false, area: store.count(), min: img.stats.min, max: img.stats.max, hasRef: !!refMaskRef.current, ...pendingState() });
        fitView();
      } catch (e) { if (!cancelled && e.name !== 'AbortError') { setLoading({ error: e.message }); onError && onError(e.message); } }
    })();
    return () => { cancelled = true; abort.abort(); };
  }, [file?.id]); // eslint-disable-line

  // ---- editing --------------------------------------------------------------------------------------------------------
  const value = () => (optsRef.current.mode === 'sub' ? 0 : 1);
  const afterEdit = () => {
    const s = storeRef.current; emit({ dirty: s.version !== savedVersion.current, message: '', ...pendingState() });
    setTimeout(() => storeRef.current && emit({ area: storeRef.current.count() }), 0); invalidate();
  };
  const note = (message) => emit({ message, ...pendingState() });
  const undo = () => { if (storeRef.current?.undo()) afterEdit(); };
  const redo = () => { if (storeRef.current?.redo()) afterEdit(); };
  const cancelPending = () => { pathRef.current = { anchors: [], segs: [], live: [] }; previewRef.current = null; emit({ message: '', ...pendingState() }); bump(); invalidate(); };
  const clearMask = () => { if (storeRef.current) { cancelPending(); storeRef.current.clear(); afterEdit(); } };
  const copyRef = () => {
    const store = storeRef.current; const r = refMaskRef.current; const img = imgRef.current;
    if (!store || !r || !img) return;
    store.begin(); store.touch(0, 0, img.W - 1, img.H - 1); store.data.set(r); store.commit(); afterEdit();
  };
  const stampLine = (a, b) => {
    const r = Math.max(0.5, optsRef.current.brush / 2 / viewRef.current.scale);
    const dist = Math.hypot(b.x - a.x, b.y - a.y); const step = Math.max(0.5, r / 3);
    for (let d = 0; d <= dist; d += step) { const t = dist ? d / dist : 0; stampCircle(storeRef.current, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, value()); }
  };
  const removePoint = () => { const p = pathRef.current; if (p.anchors.length) { p.anchors.pop(); p.segs.pop(); p.live = []; emit(pendingState()); bump(); invalidate(); } };
  const closeShape = () => {
    const p = pathRef.current;
    if (p.anchors.length < 3) { note('Click at least three points around the lesion before completing the shape.'); return; }
    const first = p.anchors[0]; const last = p.anchors[p.anchors.length - 1];
    const closing = p.anchors.length > 1 ? lassoPath(last, first) : [];
    const poly = [first, ...p.segs.flat(), ...closing];
    const store = storeRef.current;
    store.begin(); fillPolygon(store, poly, value()); store.commit();
    pathRef.current = { anchors: [], segs: [], live: [] };
    bump(); afterEdit();
  };
  const computeGrow = (seed) => {
    const img = imgRef.current; if (!img) return;
    const lvl = levelFor(2); const f = 2 ** lvl; const L = img.mips[lvl];
    const [p05, p995] = percentilesFromHist(img.stats.hist, img.stats.total, [0.5, 99.5]);
    const tol = (optsRef.current.growPct / 100) * Math.max(1, p995 - p05);
    const r = floodGrow(L, { x: Math.floor(seed.x / f), y: Math.floor(seed.y / f) }, { tol, maxRadius: 600, maxPixels: 1500000 });
    previewRef.current = { ...r, level: lvl, seed };
    emit({ message: r.truncated ? 'The region ran past the size limit. Lower the tolerance or click closer to the lesion centre.' : '', ...pendingState() });
    bump(); invalidate();
  };
  useEffect(() => { if (previewRef.current?.seed) computeGrow(previewRef.current.seed); }, [growPct]); // eslint-disable-line
  const acceptGrow = () => {
    const pv = previewRef.current; const store = storeRef.current; const img = imgRef.current;
    if (!pv || !store || !img) return;
    const f = 2 ** pv.level;
    const X0 = pv.x0 * f; const Y0 = pv.y0 * f; const X1 = Math.min(img.W - 1, (pv.x0 + pv.w) * f - 1); const Y1 = Math.min(img.H - 1, (pv.y0 + pv.h) * f - 1);
    const v = value();
    store.begin(); store.touch(X0, Y0, X1, Y1);
    for (let y = Y0; y <= Y1; y += 1) {
      const row = (Math.floor(y / f) - pv.y0) * pv.w;
      for (let x = X0; x <= X1; x += 1) if (pv.data[row + Math.floor(x / f) - pv.x0]) store.data[y * img.W + x] = v;
    }
    store.commit(); previewRef.current = null; bump(); afterEdit();
  };
  const finish = () => { if (previewRef.current) acceptGrow(); else closeShape(); };

  const save = async () => {
    const store = storeRef.current;
    if (pathRef.current.anchors.length || previewRef.current) { note('Complete or cancel the shape you are drawing first.'); return false; }
    if (!store || !store.count()) { note('Draw the lesion first. An empty mask cannot be saved.'); return false; }
    emit({ saving: true, message: '' });
    try {
      const gz = await gzip(buildNifti(store.data, size.cols, size.rows, pixelSpacing(file)));
      const form = new FormData();
      form.append('view', view);
      form.append('file', new Blob([gz], { type: 'application/gzip' }), `${caseCode}_${view}.nii.gz`);
      const res = await fetch(`${API}/cases/${caseId}/masks`, { method: 'POST', headers: auth(), body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Save failed (${res.status})`);
      savedVersion.current = store.version; emit({ saving: false, dirty: false, saved: true, message: `${view} mask saved` });
      onSaved && onSaved(body);
      return true;
    } catch (e) { emit({ saving: false, message: e.message }); onError && onError(e.message); return false; }
  };

  const pushMarks = () => { marksVer.current += 1; emit({ marks: marksRef.current.length, marksVer: marksVer.current }); };
  const undoMark = () => { if (marksRef.current.length) { marksRef.current = marksRef.current.slice(0, -1); pushMarks(); invalidate(); } };
  const clearMarks = () => { marksRef.current = []; markDraft.current = null; pushMarks(); invalidate(); };

  useImperativeHandle(handle, () => ({
    undoMark, clearMarks, getMarks: () => marksRef.current, setMarks: (m) => { marksRef.current = m || []; pushMarks(); invalidate(); },
    undo, redo, finish, cancel: cancelPending, removePoint, clearMask, copyRef, save, applyPreset, fit: fitView,
    zoomBy: (f) => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, f), zoomTo, setSpace: (v) => { spaceRef.current = v; },
    zoomOneToOne: () => { const m = mouseRef.current; if (m.inside) { viewRef.current = { scale: 1, tx: m.x - m.ix, ty: m.y - m.iy }; setInfo((i) => ({ ...i, zoom: 1 })); invalidate(); } else zoomTo(1); },
    setCustomWindow: (center, width) => setWindow({ center, width: Math.max(2, width) }, 'custom', winRef.current.invert),
    toggleInvert: () => setWindow(winRef.current.win, winRef.current.presetId, !winRef.current.invert),
    isDirty: () => !!storeRef.current && storeRef.current.version !== savedVersion.current,
  }));

  // ---- pointer ----------------------------------------------------------------------------------------------------------
  const local = (e) => { const r = stageRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e) => {
    onActivate && onActivate(view);
    const img = imgRef.current; if (!img) return;
    const s = local(e); const o = optsRef.current;
    if (e.button === 1 || o.tool === 'pan' || spaceRef.current || e.altKey) { panRef.current = { x: s.x - viewRef.current.tx, y: s.y - viewRef.current.ty }; return; }
    if (e.button !== 0 || !o.canEdit) return;
    if (isMark(o.tool)) {
      const q = toImage(s.x, s.y);
      const base = { id: `${Date.now()}${Math.random()}`, color: o.markColor, width: o.markWidth, author: o.author || '' };
      markDraft.current = o.tool === 'markpen' ? { ...base, type: 'pen', pts: [q] } : { ...base, type: o.tool === 'markcircle' ? 'circle' : 'arrow', box: { x0: q.x, y0: q.y, x1: q.x, y1: q.y } };
      invalidate(); return;
    }
    const p = toImage(s.x, s.y); const pt = { x: Math.round(p.x), y: Math.round(p.y) };
    if (pt.x < 0 || pt.y < 0 || pt.x >= img.W || pt.y >= img.H) return;
    if (o.tool === 'brush') {
      storeRef.current.begin(); drawingRef.current = { last: p }; stampLine(p, p); invalidate();
    } else if (o.tool === 'lasso' || o.tool === 'polygon') {
      const path = pathRef.current;
      if (path.anchors.length >= 3) {
        const f = toScreen(path.anchors[0].x, path.anchors[0].y);
        if (Math.hypot(f.x - s.x, f.y - s.y) <= 10) { closeShape(); return; }
      }
      if (path.anchors.length) path.segs.push(path.live.length ? path.live : [path.anchors[path.anchors.length - 1], pt]);
      path.anchors.push(pt); path.live = []; emit({ message: '', ...pendingState() }); bump(); invalidate();
    } else if (o.tool === 'grow') computeGrow(pt);
  };
  const onMove = (e) => {
    const s = local(e); const img = imgRef.current;
    if (panRef.current) { viewRef.current = { ...viewRef.current, tx: s.x - panRef.current.x, ty: s.y - panRef.current.y }; invalidate(); return; }
    if (!img) return;
    const p = toImage(s.x, s.y);
    mouseRef.current = { x: s.x, y: s.y, ix: p.x, iy: p.y, inside: true };
    if (markDraft.current) {
      const d = markDraft.current;
      if (d.type === 'pen') d.pts.push(p); else { d.box.x1 = p.x; d.box.y1 = p.y; }
    }
    if (drawingRef.current) { stampLine(drawingRef.current.last, p); drawingRef.current.last = p; }
    if (!infoTimer.current) {
      infoTimer.current = setTimeout(() => {
        infoTimer.current = null;
        const q = mouseRef.current; const cur = imgRef.current; if (!cur) return;
        const ix = Math.floor(q.ix); const iy = Math.floor(q.iy);
        const inImg = ix >= 0 && iy >= 0 && ix < cur.W && iy < cur.H;
        setInfo((i) => ({ ...i, x: inImg ? ix : null, y: iy, v: inImg ? cur.mips[0].data[iy * cur.W + ix] : null, zoom: viewRef.current.scale }));
      }, 100);
    }
    invalidate();
  };
  const onUp = () => {
    panRef.current = null;
    if (markDraft.current) {
      const d = markDraft.current; markDraft.current = null;
      const tiny = d.type === 'pen' ? d.pts.length < 2 : Math.hypot(d.box.x1 - d.box.x0, d.box.y1 - d.box.y0) * viewRef.current.scale < 6;
      if (!tiny) {
        if (d.type === 'pen') {                          // drop points closer than ~1.5 image pixels so a stroke stays small
          const keep = [d.pts[0]]; d.pts.forEach((p) => { const l = keep[keep.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 1.5) keep.push(p); });
          if (keep.length < 2) keep.push(d.pts[d.pts.length - 1]); d.pts = keep.slice(0, 6000);
        }
        marksRef.current = [...marksRef.current, d]; pushMarks();
      }
      invalidate();
    } if (drawingRef.current) { drawingRef.current = null; storeRef.current.commit(); afterEdit(); } };
  const onLeave = () => { onUp(); mouseRef.current.inside = false; invalidate(); };

  const spacing = file ? pixelSpacing(file) : null;
  const cmPx = spacing && info.zoom ? (10 / spacing.col) * info.zoom : 0;     // 1 cm in screen pixels
  const barPx = cmPx > 240 ? cmPx / 10 : cmPx; const barLabel = cmPx > 240 ? '1 mm' : '1 cm';
  const pct = loading && loading.pct != null ? Math.round(loading.pct * 100) : 0;
  const side = view && view[0] === 'R' ? ['R', 'L'] : ['L', 'R'];

  return (
    <div className={`segv ${active ? 'active' : ''}`} ref={stageRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onLeave}
      onDoubleClick={() => (tool === 'lasso' || tool === 'polygon') && closeShape()}
      onContextMenu={(e) => { e.preventDefault(); if (pathRef.current.anchors.length || previewRef.current) finish(); }}
      style={{ cursor: !canEdit || tool === 'pan' ? 'grab' : 'none' }}>
      <canvas ref={canvasRef} className="seg-canvas" />
      <canvas ref={overlayRef} className="seg-canvas seg-overlay" />
      {loading && !loading.error && (
        <div className="seg-loading"><div>Loading {view}…</div><div className="seg-bar"><i style={{ width: `${pct}%` }} /></div></div>
      )}
      {loading?.error && <div className="seg-loading err">{loading.error}</div>}
      {!file && <div className="seg-loading">No image</div>}
      {file && !size && <div className="seg-loading err">Image size missing from the header, so it cannot be opened.</div>}
      <span className="seg-tag">{view}</span>
      <span className="seg-side l">{side[0]}</span><span className="seg-side r">{side[1]}</span>
      <span className="seg-dims">
        {info.x != null ? `(${info.x}, ${info.y}) = ${info.v}  ·  ` : ''}{info.zoom ? `${Math.round(info.zoom * 100)}%` : ''}
      </span>
      {barPx > 12 && <span className="seg-scale" style={{ width: barPx }}><i />{barLabel}</span>}
    </div>
  );
});

export default SegViewport;
