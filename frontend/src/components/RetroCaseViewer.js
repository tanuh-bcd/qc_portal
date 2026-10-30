import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './RetroCaseViewer.css';

export const API = `${process.env.REACT_APP_API_URL || ''}/api/v1/qc/retro`;
export const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

// Standard hanging protocol: right breast on the viewer's left.
const LAYOUT = ['RCC', 'LCC', 'RMLO', 'LMLO'];
const VIEW_NAMES = { RCC: 'Right CC', LCC: 'Left CC', RMLO: 'Right MLO', LMLO: 'Left MLO' };

export const fmtBytes = (n) => {
  if (n == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export const useBlobUrl = (path, deps = []) => {
  const [state, setState] = useState({ url: null, error: '', loading: !!path, text: '' });
  useEffect(() => {
    if (!path) return undefined;
    let revoked = false;
    let objectUrl = null;
    setState({ url: null, error: '', loading: true, text: '' });
    fetch(`${API}${path}`, { headers: auth() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load (${res.status})`);
        const type = res.headers.get('content-type') || '';
        const blob = await res.blob();
        const text = type.includes('json') ? await blob.text() : '';
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setState({ url: objectUrl, error: '', loading: false, text });
      })
      .catch((e) => !revoked && setState({ url: null, error: e.message, loading: false, text: '' }));
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, ...deps]);
  return state;
};

const Viewport = ({ file, label, tone, invert, resetKey, selected, onSelect }) => {
  const { url, error, loading } = useBlobUrl(file ? `/files/${file.id}/image?invert=${invert}` : null, [invert]);
  const boxRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });          // natural size of the picture
  const [zoom, setZoom] = useState(1);                     // 1 = the whole image fits the box
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);

  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [resetKey]);

  const fit = nat.w && box.w ? Math.min(box.w / nat.w, box.h / nat.h) * 0.98 : 1;
  const scale = fit * zoom;
  const zoomAt = useCallback((factor, px, py) => {            // keep the point under the cursor still
    setZoom((z) => {
      const next = Math.min(40, Math.max(0.5, z * factor));
      const k = next / z;
      const cx = (px ?? box.w / 2) - box.w / 2; const cy = (py ?? box.h / 2) - box.h / 2;
      setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
      return next;
    });
  }, [box.w, box.h]);

  useEffect(() => {
    const el = boxRef.current; if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div ref={boxRef} className={`rcv-viewport ${selected ? 'selected' : ''}`} onClick={onSelect}
      onMouseDown={(e) => setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y })}
      onMouseMove={(e) => drag && setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y })}
      onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}
      onDoubleClick={reset}>
      <span className="rcv-tag">{label}</span>
      {file && <span className="rcv-size">{fmtBytes(file.size_bytes)} · {zoom === 1 ? 'fit' : `${Math.round(scale * 100)}%`}</span>}
      {url && (
        <div className="rcv-zoombar" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button title="Zoom out" onClick={stop(() => zoomAt(1 / 1.3))}>−</button>
          <button title="Zoom in" onClick={stop(() => zoomAt(1.3))}>+</button>
          <button title="Whole image fits the box" onClick={stop(reset)}>Fit</button>
          <button title="One image pixel per screen pixel" onClick={stop(() => { setZoom(1 / fit); setPan({ x: 0, y: 0 }); })}>1:1</button>
        </div>
      )}
      {loading && <div className="rcv-msg"><i className="rcv-spin" />Rendering…</div>}
      {error && <div className="rcv-msg err">{error}</div>}
      {!file && <div className="rcv-msg">View not available</div>}
      {url && (
        <img className="rcv-img" src={url} alt={label} draggable={false}
          onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
          style={{
            width: nat.w || undefined, height: nat.h || undefined, filter: tone, visibility: nat.w ? 'visible' : 'hidden',
            transform: `translate(${box.w / 2 + pan.x - (nat.w * scale) / 2}px, ${box.h / 2 + pan.y - (nat.h * scale) / 2}px) scale(${scale})`,
          }} />
      )}
    </div>
  );
};

export const ReportPane = ({ file }) => {
  const { url, error, loading, text } = useBlobUrl(file ? `/files/${file.id}/content` : null);
  if (!file) return <div className="rcv-empty">No report stored for this case</div>;
  if (loading) return <div className="rcv-empty"><i className="rcv-spin dark" />Loading report…</div>;
  if (error) return <div className="rcv-empty err">{error}</div>;
  if (file.filename.toLowerCase().endsWith('.json')) {
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* show raw */ }
    return <pre className="rcv-json">{pretty}</pre>;
  }
  return <iframe className="rcv-pdf" title="Radiology report" src={url} />;
};

export const fmtDate = (v) => (v ? new Date(v.endsWith('Z') ? v : `${v}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const downloadMask = async (caseId, maskId, filename) => {
  const res = await fetch(`${API}/cases/${caseId}/masks/${maskId}/download`, { headers: auth() });
  if (!res.ok) { alert('Could not download the mask'); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadMasksZip = async (caseId, code) => {
  const res = await fetch(`${API}/cases/${caseId}/masks.zip`, { headers: auth() });
  if (!res.ok) { alert('No masks to download for this case yet'); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `${code}_masks.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ROLE_LABEL = { mammo_tech: 'Mammo Tech', radiologist: 'Radiologist' };
const KIND_LABEL = { escalation: 'Sent to Radiologist', guidance: 'Radiologist guidance', clinical: 'Note' };

export const NotesThread = ({ notes }) => (
  notes.length === 0 ? <div className="rcv-empty">No notes yet</div> : (
    <ul className="rcv-notes">
      {notes.map((n) => (
        <li key={n.id} className={`rcv-note r-${n.role} k-${n.kind}`}>
          <div><b>{n.by}</b><span className="rcv-rolechip">{ROLE_LABEL[n.role] || n.role}</span>
            {n.kind !== 'clinical' && <span className="rcv-kindchip">{KIND_LABEL[n.kind]}</span>}<time>{fmtDate(n.at)}</time></div>
          <p>{n.body}</p>
        </li>
      ))}
    </ul>
  )
);

export const SegPane = ({ data }) => {
  const a = data.assignment;
  const rejected = data.status === 'rejected';
  const steps = [
    { label: 'Assigned to Mammo Tech', at: a?.assigned_at, note: a ? `${a.mammo_tech_name}${a.assigned_by ? ` (by ${a.assigned_by})` : ''}` : 'Not assigned yet' },
    { label: 'Segmentation started', at: a?.started_at },
    ...(a?.escalated_at ? [
      { label: 'Sent to Radiologist', at: a.escalated_at, note: `${a.radiologist_name || ''}: ${a.escalation_note || ''}`, warn: true },
      { label: 'Radiologist opened it', at: a.radiologist_started_at, warn: true },
      { label: 'Radiologist completed review', at: a.radiologist_completed_at, note: 'Returned to the Mammo Tech', warn: true },
    ] : []),
    ...(rejected
      ? [{ label: 'Rejected by Radiologist', at: a?.rejected_at, note: `${a?.rejected_by || ''}: ${a?.reject_reason || ''}`, warn: true }]
      : [{ label: 'Segmented', at: a?.completed_at, note: data.annotation?.done ? `by ${data.annotation.by}` : '' }]),
  ];
  const roleOrder = { mammo_tech: 0, radiologist: 1 };
  const masks = [...data.masks].sort((x, y) => (roleOrder[x.role] - roleOrder[y.role]) || String(x.view).localeCompare(String(y.view)) || y.version - x.version);
  const latest = new Set(); 
  return (
    <div className="rcv-seg-pane">
      <div className="rcv-state">
        <span className={`rcv-pill st-${data.status}`}>{data.status_label}</span>
        <span>{data.annotation?.done ? `Annotation done by ${data.annotation.by}` : data.annotation?.draft ? `Annotation in draft (${data.annotation.views.join(', ')})` : 'Annotation not done'}</span>
        {data.masks.length > 0 && data.status !== 'rejected' && <button className="rcv-dl" onClick={() => downloadMasksZip(data.id, data.case_code)}>⬇ All masks (zip)</button>}
      </div>
      <ol className="rcv-timeline">
        {steps.map((st) => (
          <li key={st.label} className={`${st.at ? 'done' : ''} ${st.warn ? 'warn' : ''}`}>
            <b>{st.label}</b>
            <span>{st.at ? fmtDate(st.at) : 'Pending'}</span>
            {st.note && <em>{st.note}</em>}
          </li>
        ))}
      </ol>
      <h3>Segmentation masks</h3>
      {masks.length === 0 ? <div className="rcv-empty">No mask saved yet</div> : (
        <table className="rcv-files">
          <thead><tr><th>View</th><th>By</th><th>Version</th><th>Size</th><th>Saved</th><th /></tr></thead>
          <tbody>
            {masks.map((m) => {
              const key = `${m.role}-${m.view}`; const isLatest = !latest.has(key); latest.add(key);
              return (
                <tr key={m.id} style={isLatest ? null : { opacity: 0.55 }}>
                  <td>{m.view || '-'}</td><td>{m.by} <span className="rcv-rolechip">{ROLE_LABEL[m.role]}</span></td>
                  <td>v{m.version}{isLatest && <span className="rcv-latest">latest</span>}</td>
                  <td>{fmtBytes(m.size_bytes)}</td><td>{fmtDate(m.at)}</td>
                  <td>{data.status !== 'rejected' && <button className="rcv-dl" onClick={() => downloadMask(data.id, m.id, m.filename)}>⬇</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <h3>Notes</h3>
      <NotesThread notes={data.notes || []} />
    </div>
  );
};

const HeaderPane = ({ views }) => {
  const [active, setActive] = useState(views[0]?.view);
  const [q, setQ] = useState('');
  const file = views.find((v) => v.view === active);
  const rows = useMemo(() => {
    const all = file?.dicom_headers || [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => `${r.tag} ${r.name} ${r.value}`.toLowerCase().includes(needle)) : all;
  }, [file, q]);
  return (
    <div className="rcv-headers">
      <div className="rcv-headbar">
        <div className="rcv-seg">
          {views.map((v) => (
            <button key={v.view} className={v.view === active ? 'on' : ''} onClick={() => setActive(v.view)}>{v.view}</button>
          ))}
        </div>
        <input placeholder="Filter tag, name or value…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="rcv-tablewrap">
        <table>
          <thead><tr><th>Tag</th><th>Name</th><th>VR</th><th>Value</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td className="mono">{r.tag}</td><td>{r.name}</td><td className="mono">{r.vr}</td><td className="val">{r.value}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="4" className="rcv-empty">No matching tags</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const RetroCaseViewer = ({ caseId, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('views');
  const [resetKey, setResetKey] = useState(0);            // bump to put every image back to 'fit'
  const [invert, setInvert] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch(`${API}/cases/${caseId}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load case (${r.status})`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [caseId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const views = (data?.files || []).filter((f) => f.kind === 'view');
  const report = (data?.files || []).find((f) => f.kind === 'report');
  const byView = Object.fromEntries(views.map((v) => [v.view, v]));
  const totalBytes = (data?.files || []).reduce((s, f) => s + (f.size_bytes || 0), 0);
  const tone = `brightness(${brightness}%) contrast(${contrast}%)`;

  const TABS = [['views', 'Mammograms'], ['report', 'Report'], ['headers', 'DICOM headers'], ['files', 'Files'], ['seg', 'Segmentation']];

  return (
    <div className="rcv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rcv-modal" role="dialog" aria-modal="true">
        <header className="rcv-top">
          <div>
            <h2>{data?.case_code || 'Loading…'}<span className="rcv-ro">Read only</span></h2>
            {data && <p>{data.original_name} · {data.vendor || 'Vendor not set'} · {data.manufacturer || 'Manufacturer unknown'}</p>}
          </div>
          <div className="rcv-chips">
            {data && <span className="chip dr">{data.modality}</span>}
            {data && <span className={`chip st st-${data.status}`}>{data.status_label}</span>}
            {data?.birads && <span className={`chip birads b${data.birads[0]}`}>BI-RADS {data.birads}</span>}
            {data?.density && <span className="chip dens">Density {data.density}</span>}
            <button className="rcv-x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>

        <nav className="rcv-tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>

        {error && <div className="rcv-empty err">{error}</div>}
        {!data && !error && <div className="rcv-empty"><i className="rcv-spin dark" />Loading case…</div>}

        {data && tab === 'views' && (
          <>
            <div className="rcv-tools">
              <button title="Show the whole of every image" onClick={() => setResetKey((k) => k + 1)}>Fit all</button>
              <button onClick={() => { setResetKey((k) => k + 1); setBrightness(100); setContrast(100); setInvert(false); }}>Reset</button>
              <label>Brightness<input type="range" min="50" max="170" value={brightness} onChange={(e) => setBrightness(+e.target.value)} /></label>
              <label>Contrast<input type="range" min="50" max="220" value={contrast} onChange={(e) => setContrast(+e.target.value)} /></label>
              <button className={invert ? 'on' : ''} onClick={() => setInvert((v) => !v)}>Invert</button>
              <span className="hint">Wheel zooms the image under the cursor · drag to pan · double-click to fit</span>
            </div>
            <div className="rcv-grid">
              {LAYOUT.map((slot) => (
                <Viewport key={slot} file={byView[slot]} label={`${slot} · ${VIEW_NAMES[slot]}`} tone={tone}
                  invert={invert} resetKey={resetKey} selected={selected === slot} onSelect={() => setSelected(slot)} />
              ))}
            </div>
          </>
        )}

        {data && tab === 'report' && <div className="rcv-body"><ReportPane file={report} /></div>}
        {data && tab === 'seg' && <div className="rcv-body"><SegPane data={data} /></div>}
        {data && tab === 'headers' && <div className="rcv-body"><HeaderPane views={views} /></div>}

        {data && tab === 'files' && (
          <div className="rcv-body">
            <table className="rcv-files">
              <thead><tr><th>Type</th><th>View</th><th>Folder path in upload</th><th>Size</th></tr></thead>
              <tbody>
                {data.files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.kind === 'view' ? 'DICOM' : 'Report'}</td><td>{f.view || '–'}</td>
                    <td className="mono">{f.source_path || f.filename}</td><td>{fmtBytes(f.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan="3">Total</td><td>{fmtBytes(totalBytes)}</td></tr></tfoot>
            </table>
            <p className="rcv-session">Session ID <code>{data.session_id}</code></p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RetroCaseViewer;
