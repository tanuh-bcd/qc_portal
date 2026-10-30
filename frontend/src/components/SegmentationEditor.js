import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API, auth, useBlobUrl } from './RetroCaseViewer';
import { PRESETS } from './seg/pixels';
import SegViewport from './SegViewport';
import './SegmentationEditor.css';

const ORDER = ['RCC', 'RMLO', 'LCC', 'LMLO'];
const TOOLS = [
  ['pan', 'Pan / zoom', 'H', 'Drag to move the image. The wheel zooms. Nothing is drawn.'],
  ['brush', 'Paintbrush', 'B', 'Paint the lesion by dragging. Release the mouse to end a stroke.'],
  ['polygon', 'Polygon', 'P', 'Click each corner of the lesion. Complete when the outline is closed.'],
  ['lasso', 'Magnetic lasso', 'W', 'Click along the lesion edge; the line snaps to it. Complete when the outline is closed.'],
  ['grow', 'Grow region', 'G', 'Click inside the lesion, adjust the tolerance, then accept the highlighted region.'],
];
const MARK_TOOLS = [['markpen', 'Pen', 'Draw freely, like marking up a picture to show where to look.'], ['markcircle', 'Circle', 'Drag to circle an area.'], ['markarrow', 'Arrow', 'Drag from the tail to the point you want to show.']];
const MARK_COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ff2d9b', '#ffffff', '#000000'];
const SWATCHES = [['Red', [255, 64, 96]], ['Yellow', [255, 210, 74]], ['Green', [60, 220, 120]], ['Cyan', [60, 210, 255]], ['Magenta', [255, 90, 220]], ['Orange', [255, 150, 50]]];
const LAYOUTS = [1, 2, 4];

const Thumb = ({ file, view, used, saved, onPick }) => {
  const { url } = useBlobUrl(file ? `/files/${file.id}/image?thumb=true` : null);
  return (
    <div className={`segt ${used ? 'used' : ''}`} draggable={!!file} onDragStart={(e) => { e.dataTransfer.setData('text/view', view); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => file && onPick(view)} title={file ? 'Drag into a box, or double-click to open it in the active box' : 'This view is missing'}>
      <div className="segt-img">{url ? <img src={url} alt={view} draggable={false} /> : <i className="rcv-spin" />}</div>
      <span>{view}{saved && <b> ✓</b>}</span>
    </div>
  );
};

const LayoutIcon = ({ n }) => (
  <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
    {n === 1 && <rect x="1" y="1" width="20" height="16" rx="2" />}
    {n === 2 && (<><rect x="1" y="1" width="9.5" height="16" rx="2" /><rect x="11.5" y="1" width="9.5" height="16" rx="2" /></>)}
    {n === 4 && (<><rect x="1" y="1" width="9.5" height="7.5" rx="1.5" /><rect x="11.5" y="1" width="9.5" height="7.5" rx="1.5" /><rect x="1" y="9.5" width="9.5" height="7.5" rx="1.5" /><rect x="11.5" y="9.5" width="9.5" height="7.5" rx="1.5" /></>)}
  </svg>
);

const SegmentationEditor = ({ caseId, caseCode, files, masks, role, canEdit, author = '', marks = [], onSaved, onMarksChanged, onError }) => {
  const isRad = role === 'radiologist';
  const toolList = isRad ? TOOLS.filter((t) => t[0] === 'pan') : TOOLS;     // Radiologists mark with free hand; they do not segment
  const otherLabel = isRad ? 'Mammo Tech' : 'Radiologist';
  const shapesFor = (view, mine) => marks.filter((m) => m.view === view && (m.role === role) === mine && !m.removed_at)
    .flatMap((m) => m.shapes.map((s, i) => ({ ...s, id: `${m.id}-${i}`, author: mine ? m.by : `${mine ? '' : `${otherLabel}: `}${m.by}` })));
  const byView = useMemo(() => Object.fromEntries(files.filter((f) => f.kind === 'view').map((f) => [f.view, f])), [files]);
  const [layout, setLayout] = useState(1);
  const [slots, setSlots] = useState(() => [ORDER.find((v) => byView[v]) || null, null, null, null]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState({});                 // per view, reported by each viewport
  const [tool, setTool] = useState('pan');
  const [mode, setMode] = useState('add');
  const [brush, setBrush] = useState(28);
  const [growPct, setGrowPct] = useState(8);
  const [opacity, setOpacity] = useState(0.55);
  const [color, setColor] = useState(SWATCHES[0][1]);
  const [showRef, setShowRef] = useState(true);
  const [markColor, setMarkColor] = useState(MARK_COLORS[0]);
  const [markWidth, setMarkWidth] = useState(4);
  const [over, setOver] = useState(-1);
  const refs = useRef({});
  const savedMarks = useRef({});                         // last marks version stored, per view

  const activeView = slots[active] && active < layout ? slots[active] : null;
  const st = (activeView && status[activeView]) || {};
  const handle = () => (activeView ? refs.current[active] : null);
  const savedViews = useMemo(() => new Set(masks.filter((m) => m.role === role).map((m) => m.view)), [masks, role]);
  const onStatus = useCallback((view, s) => setStatus((p) => ({ ...p, [view]: { ...(p[view] || {}), ...s } })), []);

  const dirtyViews = () => slots.slice(0, 4).filter((v, i) => v && refs.current[i]?.isDirty && refs.current[i].isDirty());
  const placeView = (slot, view) => {
    const cur = slots[slot];
    if (cur === view) { setActive(slot); return; }
    const open = slots.slice(0, layout).indexOf(view);
    if (open >= 0) { setActive(open); return; }                              // already in a box: just go to it
    if (cur && refs.current[slot]?.isDirty() && !window.confirm(`${cur} has unsaved changes. Replace it anyway?`)) return;
    setSlots((s) => {
      const n = [...s];
      n[slot] = view; return n;
    });
    setActive(slot);
  };
  const closeSlot = (slot) => {
    if (refs.current[slot]?.isDirty() && !window.confirm(`${slots[slot]} has unsaved changes. Close it anyway?`)) return;
    setSlots((s) => { const n = [...s]; n[slot] = null; return n; });
  };
  const changeLayout = (n) => {
    if (n < layout) {
      const lost = slots.slice(n, layout).map((v, i) => (v && refs.current[n + i]?.isDirty() ? v : null)).filter(Boolean);
      if (lost.length && !window.confirm(`${lost.join(', ')} has unsaved changes. Hide it anyway?`)) return;
      setSlots((s) => s.map((v, i) => (i >= n ? null : v)));
      if (active >= n) setActive(0);
    } else if (n > layout && !slots[0]) setSlots((s) => [ORDER.find((v) => byView[v]) || null, ...s.slice(1)]);
    setLayout(n);
  };
  const pickInActive = (view) => placeView(active < layout ? active : 0, view);

  const selectTool = (id) => { handle()?.cancel(); setTool((cur) => (cur === id && id !== 'pan' ? 'pan' : id)); };   // clicking the chosen tool again puts it down
  const confirmClear = () => { if (window.confirm(`Erase the whole ${activeView} mask? You can still press Undo, and nothing changes on the server until you Save.`)) handle()?.clearMask(); };
  const confirmCopy = () => { if (st.area && !window.confirm('Replace your current mask with the Mammo Tech mask? You can Undo.')) return; handle()?.copyRef(); };

  // free-hand marks save themselves a moment after each change
  useEffect(() => {
    const timers = [];
    slots.slice(0, layout).forEach((v, i) => {
      const s = status[v];
      if (!v || !s || s.marksVer == null || s.marksVer === (savedMarks.current[v] || 0)) return;
      timers.push(setTimeout(async () => {
        const h = refs.current[i]; if (!h) return;
        const shapes = h.getMarks().map(({ type, color, width, pts, box }) => ({ type, color, width, ...(pts ? { pts } : { box }) }));
        try {
          const res = await fetch(`${API}/cases/${caseId}/marks`, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ view: v, shapes }) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not save the marks');
          savedMarks.current[v] = s.marksVer; onStatus(v, { message: 'Marks saved' });
        } catch (e) { onError && onError(e.message); }
      }, 700));
    });
    return () => timers.forEach(clearTimeout);
  }, [status, slots, layout]); // eslint-disable-line

  // keyboard acts on the active box
  const act = useRef({}); act.current = { handle, setTool, activeView, selectTool, st, tool, toolList };
  useEffect(() => {
    const down = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase(); const h = act.current.handle();
      if (k === ' ') { Object.values(refs.current).forEach((r) => r && r.setSpace(true)); e.preventDefault(); return; }
      if (!h) return;
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); (e.shiftKey ? h.redo : h.undo)(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); h.redo(); return; }
      const preset = PRESETS.find((p) => p.key === k);
      if (preset) { h.applyPreset(preset.id); return; }
      if (!act.current.toolList.length) return;
      const t = act.current.toolList.find((x) => x[2].toLowerCase() === k);
      if (t) act.current.selectTool(t[0]);
      else if (k === 'x') setMode((m) => (m === 'add' ? 'sub' : 'add'));
      else if (k === '[') setBrush((b) => Math.max(2, b - 4)); else if (k === ']') setBrush((b) => Math.min(240, b + 4));
      else if (k === '0') h.fit(); else if (k === 'z') h.zoomOneToOne();
      else if (k === '=' || k === '+') h.zoomBy(1.3); else if (k === '-') h.zoomBy(1 / 1.3);
      else if (k === 'enter') h.finish(); else if (k === 'escape') { const a = act.current; if (a.st.points || a.st.preview) h.cancel(); else a.setTool('pan'); } else if (k === 'backspace') h.removePoint();
    };
    const up = (e) => { if (e.key === ' ') Object.values(refs.current).forEach((r) => r && r.setSpace(false)); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {                                           // warn before leaving with unsaved work
    const warn = (e) => { if (dirtyViews().length) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }); // eslint-disable-line

  const drawing = tool === 'polygon' || tool === 'lasso';
  const isOtherMarks = !!activeView && shapesFor(activeView, false).length > 0;
  const removeOther = async () => {
    if (!window.confirm(`Remove the ${otherLabel}'s marks on ${activeView}? The admin keeps them in the case history.`)) return;
    try {
      const res = await fetch(`${API}/cases/${caseId}/marks/clear-other`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ body: activeView }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not remove the marks');
      onMarksChanged && onMarksChanged();
    } catch (e) { onError && onError(e.message); }
  };
  const isMarkTool = tool.startsWith('mark');
  const tooltip = toolList.find((t) => t[0] === tool);
  const win = st.win;

  return (
    <div className="seg2">
      <aside className="seg-left">
        <section>
          <h4>Layout</h4>
          <div className="seg-layouts">
            {LAYOUTS.map((n) => (
              <button key={n} className={layout === n ? 'on' : ''} onClick={() => changeLayout(n)} title={`${n} image${n > 1 ? 's' : ''}`}><LayoutIcon n={n} /><span>{n}</span></button>
            ))}
          </div>
        </section>

        <section>
          <h4>Views <small>drag into a box</small></h4>
          <div className="seg-thumbs">
            {ORDER.map((v) => <Thumb key={v} view={v} file={byView[v]} used={slots.slice(0, layout).includes(v)} saved={savedViews.has(v)} onPick={pickInActive} />)}
          </div>
        </section>

        {canEdit && (
          <section>
            <h4>Tools</h4>
            <div className="seg-toolgrid">
              {toolList.map(([id, label, key]) => (
                <button key={id} className={tool === id ? 'on' : ''} onClick={() => selectTool(id)} title={`${label} (${key})`}>{label}<kbd>{key}</kbd></button>
              ))}
            </div>
            <p className="seg-tip">{tooltip?.[3]}{tool !== 'pan' && <em> Click the tool again, or press Esc, to put it down.</em>}</p>
            {tool !== 'pan' && !isMarkTool && !isRad && (
              <div className="seg-seg2" title="Add to or subtract from the mask (X)">
                <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Add</button>
                <button className={mode === 'sub' ? 'on sub' : ''} onClick={() => setMode('sub')}>Subtract</button>
              </div>
            )}
            <h4 style={{ marginTop: 12 }}>Free hand <small>markup, not the mask</small></h4>
            <div className="seg-toolgrid">
              {MARK_TOOLS.map(([id, label]) => <button key={id} className={tool === id ? 'on' : ''} onClick={() => selectTool(id)}>{label}</button>)}
            </div>
            {isMarkTool && (
              <>
                <p className="seg-tip">{MARK_TOOLS.find((m) => m[0] === tool)?.[2]}</p>
                <div className="seg-swatches">
                  {MARK_COLORS.map((c) => <button key={c} className={markColor === c ? 'on' : ''} style={{ background: c }} title={c} onClick={() => setMarkColor(c)} />)}
                </div>
                <label className="seg-row">Thickness<input type="range" min="1" max="14" value={markWidth} onChange={(e) => setMarkWidth(+e.target.value)} /><b>{markWidth}</b></label>
              </>
            )}
            {tool === 'brush' && <label className="seg-row">Size<input type="range" min="2" max="240" value={brush} onChange={(e) => setBrush(+e.target.value)} /><b>{brush}</b></label>}
            {tool === 'grow' && <label className="seg-row">Tolerance<input type="range" min="1" max="40" value={growPct} onChange={(e) => setGrowPct(+e.target.value)} /><b>{growPct}%</b></label>}
          </section>
        )}

        {!isRad && (
        <section>
          <h4>Label colour</h4>
          <div className="seg-swatches">
            {SWATCHES.map(([name, rgb]) => (
              <button key={name} className={color === rgb ? 'on' : ''} title={name} style={{ background: `rgb(${rgb.join(',')})` }} onClick={() => setColor(rgb)} />
            ))}
          </div>
          <label className="seg-row">Opacity<input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
        </section>
        )}

        <section>
          <h4>Image</h4>
          <div className="seg-wrap">
            {PRESETS.map((p) => <button key={p.id} className={st.presetId === p.id ? 'on' : ''} disabled={!activeView} title={`${p.hint} (${p.key})`} onClick={() => handle()?.applyPreset(p.id)}>{p.label}</button>)}
          </div>
          <label className="seg-row">Level<input type="range" disabled={!win} min={st.min || 0} max={st.max || 4095} value={win ? Math.round(win.center) : 0} onChange={(e) => handle()?.setCustomWindow(+e.target.value, win.width)} /></label>
          <label className="seg-row">Width<input type="range" disabled={!win} min="2" max={Math.max(2, (st.max || 4095) - (st.min || 0))} value={win ? Math.round(win.width) : 2} onChange={(e) => handle()?.setCustomWindow(win.center, +e.target.value)} /></label>
          <div className="seg-wrap">
            <button className={st.invert ? 'on' : ''} disabled={!activeView} onClick={() => handle()?.toggleInvert()}>Invert</button>
            <button disabled={!activeView} onClick={() => handle()?.zoomTo(1)}>1×</button>
            <button disabled={!activeView} onClick={() => handle()?.zoomTo(2)}>2×</button>
            <button disabled={!activeView} onClick={() => handle()?.zoomTo(4)}>4×</button>
            <button disabled={!activeView} onClick={() => handle()?.fit()}>Zoom to fit</button>
          </div>
        </section>
      </aside>

      <div className="seg-main">
        <div className={`seg-grid g${layout}`}>
          {Array.from({ length: layout }, (_, i) => {
            const v = slots[i];
            return (
              <div key={i} className={`seg-box ${active === i ? 'active' : ''} ${over === i ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(-1)}
                onDrop={(e) => { e.preventDefault(); setOver(-1); const d = e.dataTransfer.getData('text/view'); if (d && byView[d]) placeView(i, d); }}
                onMouseDown={() => setActive(i)}>
                {v ? (
                  <>
                    <SegViewport key={v} ref={(h) => { refs.current[i] = h; }} caseId={caseId} caseCode={caseCode} file={byView[v]} view={v} masks={masks} role={role}
                      canEdit={canEdit} author={author} myMarks={shapesFor(v, true)} otherMarks={shapesFor(v, false)} markColor={markColor} markWidth={markWidth} tool={tool} mode={mode} brush={brush} opacity={opacity} growPct={growPct} color={color} showRef={showRef}
                      active={active === i} onActivate={() => setActive(i)} onStatus={onStatus} onSaved={onSaved} onError={onError} />
                    {layout > 1 && <button className="seg-box-x" onClick={() => closeSlot(i)} title="Remove this view from the box">×</button>}
                  </>
                ) : (
                  <div className="seg-empty"><b>Drag a view here</b><span>from the panel on the left</span></div>
                )}
              </div>
            );
          })}
        </div>

        <div className="seg-actbar">
          <span className="seg-msg">{st.message || (activeView ? `${activeView}${st.dirty ? ' · unsaved changes' : st.saved || savedViews.has(activeView) ? ' · mask saved ✓' : ''}` : 'Choose a view')}</span>
          {canEdit && activeView && (
            <>
              {!isRad && (<>
              <span className="seg-area">{st.area ? 'Mask drawn' : 'No mask yet'}</span>
              {drawing && (
                <>
                  <button className="on" disabled={!(st.points >= 3)} onClick={() => handle()?.finish()} title="Close the outline and fill it (Enter)">Complete</button>
                  <button disabled={!st.points} onClick={() => handle()?.removePoint()} title="Backspace">Undo last point</button>
                  <button disabled={!st.points} onClick={() => handle()?.cancel()} title="Esc">Clear outline</button>
                </>
              )}
              {tool === 'grow' && (
                <>
                  <button className="on" disabled={!st.preview} onClick={() => handle()?.finish()} title="Enter">Accept region</button>
                  <button disabled={!st.preview} onClick={() => handle()?.cancel()} title="Esc">Cancel</button>
                </>
              )}
              </>)}
              {isMarkTool && (
                <>
                  <button disabled={!st.marks} onClick={() => handle()?.undoMark()}>Undo mark</button>
                  <button className="danger" disabled={!st.marks} onClick={() => handle()?.clearMarks()}>Clear marks</button>
                </>
              )}
              {isOtherMarks && <button onClick={removeOther} title={`Remove the ${otherLabel}'s marks on this view so you can draw your own`}>Remove {otherLabel}'s marks</button>}
              {!isRad && (<>
              <span className="seg-sepv" />
              <button onClick={() => handle()?.undo()} title="Ctrl+Z">Undo</button>
              <button onClick={() => handle()?.redo()} title="Ctrl+Shift+Z">Redo</button>
              <button className="danger" disabled={!st.area} onClick={confirmClear} title="Erase everything drawn on this view">Clear mask</button>
              <button className="seg-save" disabled={st.saving || !st.dirty || !st.loaded} onClick={() => handle()?.save()}>
                {st.saving ? 'Saving…' : st.dirty || !activeView ? `Save ${activeView || ''} mask` : savedViews.has(activeView) || st.saved ? `${activeView} saved ✓` : `Save ${activeView} mask`}
              </button>
              </>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SegmentationEditor;
