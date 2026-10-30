import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePoll } from './retroApi';
import RetroCasesTable from './RetroCasesTable';
import RetroPipeline from './RetroPipeline';
import './RetroIntake.css';

const API = `${process.env.REACT_APP_API_URL || ''}/api/v1/qc/retro`;
const CHUNK_BYTES = 40 * 1024 * 1024;
const CHUNK_FILES = 40;

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const getJson = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Request failed (${res.status})`);
  return res.json();
};

const postForm = async (path, form) => {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Request failed (${res.status})`);
  return res.json();
};

// XHR (not fetch) so upload progress events are available.
const uploadChunk = (batchId, entries, onBytes) => new Promise((resolve, reject) => {
  const form = new FormData();
  entries.forEach(({ file, path }) => { form.append('files', file); form.append('paths', path); });
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API}/batches/${batchId}/files`);
  xhr.setRequestHeader('Authorization', authHeaders().Authorization);
  xhr.upload.onprogress = (e) => e.lengthComputable && onBytes(e.loaded);
  xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
  xhr.onerror = () => reject(new Error('Network error during upload'));
  xhr.send(form);
});

// A big zip is sent in ordered pieces so no single request exceeds the proxy's body limit.
const uploadInParts = async (batchId, entry, onBytes) => {
  for (let offset = 0; offset < entry.file.size; offset += CHUNK_BYTES) {
    const piece = entry.file.slice(offset, offset + CHUNK_BYTES);
    await new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('path', entry.path); form.append('offset', String(offset)); form.append('file', piece, entry.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/batches/${batchId}/parts`);
      xhr.setRequestHeader('Authorization', authHeaders().Authorization);
      xhr.upload.onprogress = (e) => e.lengthComputable && onBytes(offset + e.loaded);
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 120)}`)));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    });
  }
};

const toChunks = (entries) => {
  const chunks = [];
  let current = [];
  let bytes = 0;
  entries.forEach((entry) => {
    if (current.length && (bytes + entry.file.size > CHUNK_BYTES || current.length >= CHUNK_FILES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.file.size;
  });
  if (current.length) chunks.push(current);
  return chunks;
};

const fmtBytes = (n) => {
  if (!n && n !== 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
};

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const ICONS = {
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
};

const Stat = ({ label, value, tone, icon, sub }) => (
  <div className={`ri-stat ${tone || ''}`}>
    <div className="ri-stat-ico"><Icon d={ICONS[icon]} /></div>
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <em>{sub}</em>}
    </div>
  </div>
);

const Donut = ({ passed = 0, rejected = 0 }) => {
  const total = passed + rejected;
  const r = 52;
  const c = 2 * Math.PI * r;
  const pass = total ? (passed / total) * c : 0;
  return (
    <svg viewBox="0 0 140 140" className="ri-donut" role="img" aria-label="Pass rate">
      <circle cx="70" cy="70" r={r} fill="none" stroke={total ? '#f3c4cd' : '#e6ecee'} strokeWidth="16" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="#14a394" strokeWidth="16" strokeLinecap="round"
        strokeDasharray={`${pass} ${c}`} transform="rotate(-90 70 70)" style={{ transition: 'stroke-dasharray .6s ease' }} />
      <text x="70" y="68" textAnchor="middle" className="ri-donut-n">{total ? Math.round((passed / total) * 100) : 0}%</text>
      <text x="70" y="88" textAnchor="middle" className="ri-donut-l">pass rate</text>
    </svg>
  );
};

const Bars = ({ title, data, palette }) => {
  const entries = Object.entries(data || {}).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="ri-bars">
      <h4>{title}</h4>
      {entries.length === 0 && <p className="ri-muted">No data yet</p>}
      {entries.map(([k, v]) => (
        <div key={k} className="ri-bar">
          <span>{k}</span>
          <div><i style={{ width: `${(v / max) * 100}%`, background: palette?.[k[0]] || '#14a394' }} /></div>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
};

const STATUS = {
  unassigned: ['Unassigned', 'st-none'], awaiting: ['Awaiting', 'st-wait'], in_progress: ['In progress', 'st-prog'],
  with_radiologist: ['With radiologist', 'st-rad'], radiologist_in_progress: ['Radiologist in progress', 'st-radprog'],
  segmented: ['Segmented', 'st-done'],
};
const STATUS_ORDER = ['awaiting', 'in_progress', 'with_radiologist', 'radiologist_in_progress', 'segmented'];
const fmtDate = (v) => (v ? new Date(v.endsWith('Z') ? v : `${v}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

const BIRADS_COLORS = { 3: '#9bbf2f', 4: '#e89a1c', 5: '#e0526b', 6: '#a63a9b' };
const STEPS = ['Upload', 'Checks', 'Stored'];

const RetroIntake = () => {
  const [vendor, setVendor] = useState('');
  const [entries, setEntries] = useState([]);
  const [sourceName, setSourceName] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | done
  const [uploadPct, setUploadPct] = useState(0);
  const [batch, setBatch] = useState(null);
  const [rejections, setRejections] = useState([]);
  const [error, setError] = useState('');
  const [tally, setTally] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [techs, setTechs] = useState([]);
  const [casesKey, setCasesKey] = useState(0);        // bump to make the cases table reload
  const firstTally = useRef(true);
  const [dragOver, setDragOver] = useState(false);
  const pollRef = useRef(null);
  const folderRef = useRef(null);
  const zipRef = useRef(null);

  const refreshTally = useCallback(() => getJson('/tally').then(setTally).catch(() => {}), []);
  const refreshTechs = useCallback(() => getJson('/mammo-techs').then(setTechs).catch(() => {}), []);
  const refreshCases = useCallback(() => setCasesKey((k) => k + 1), []);

  useEffect(() => {
    refreshTally();
    refreshTechs();
  }, [refreshTally, refreshTechs]);
  usePoll(() => { refreshTally(); refreshTechs(); }, 15000);
  useEffect(() => {
    // while assigning is the main job, start on the Unassigned list (once), if there is anything unassigned
    if (tally && firstTally.current) {
      firstTally.current = false;
      if (tally.by_status?.unassigned > 0) setStatusFilter('unassigned');
    }
  }, [tally]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const setFiles = (files, name) => {
    setEntries(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    setSourceName(name);
  };
  const pickFolder = (e) => {
    const files = Array.from(e.target.files || []);
    setFiles(files, files[0]?.webkitRelativePath?.split('/')[0] || '');
  };
  const pickZip = (e) => {
    const files = Array.from(e.target.files || []);
    setFiles(files, files[0]?.name || '');
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const zip = Array.from(e.dataTransfer.files || []).filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zip.length) setFiles(zip.slice(0, 1), zip[0].name);
    else setError('Drop a .zip here, or use "Choose folder" for a directory.');
  };

  const poll = (batchId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const b = await getJson(`/batches/${batchId}`);
        setBatch(b);
        refreshTally();
        if (b.status === 'completed' || b.status === 'failed') {
          clearInterval(pollRef.current);
          setPhase('done');
          if (b.status === 'failed') setError(b.error || 'Processing failed');
          setRejections(await getJson(`/batches/${batchId}/rejections`));
          refreshCases();
        }
      } catch (err) {
        setError(err.message);
      }
    }, 1500);
  };

  const start = async () => {
    setError('');
    setRejections([]);
    setPhase('uploading');
    setUploadPct(0);
    try {
      const form = new FormData();
      form.append('source_name', sourceName);
      form.append('vendor', vendor);
      const created = await postForm('/batches', form);
      setBatch(created);
      const total = entries.reduce((s, e) => s + e.file.size, 0) || 1;
      let done = 0;
      const bigZips = entries.filter((e) => e.file.size > CHUNK_BYTES && /\.zip$/i.test(e.file.name));
      for (const zip of bigZips) {
        await uploadInParts(created.id, zip, (loaded) => setUploadPct(Math.round(((done + loaded) / total) * 100)));
        done += zip.file.size;
      }
      for (const chunk of toChunks(entries.filter((e) => !bigZips.includes(e)))) {
        const size = chunk.reduce((s, e) => s + e.file.size, 0);
        await uploadChunk(created.id, chunk, (loaded) => setUploadPct(Math.round(((done + loaded) / total) * 100)));
        done += size;
        setUploadPct(Math.round((done / total) * 100));
      }
      const finalized = await postForm(`/batches/${created.id}/finalize`, new FormData());
      setBatch(finalized);
      setPhase('processing');
      poll(created.id);
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    }
  };

  const reset = () => { setPhase('idle'); setEntries([]); setSourceName(''); setBatch(null); setRejections([]); setError(''); setUploadPct(0); };

  const busy = phase === 'uploading' || phase === 'processing';
  const checkedPct = batch && batch.total_cases ? Math.round((batch.checked_cases / batch.total_cases) * 100) : 0;
  const step = phase === 'uploading' ? 0 : phase === 'processing' ? 1 : phase === 'done' ? 3 : -1;
  const totalBytes = entries.reduce((s, e) => s + e.file.size, 0);

  return (
    <div className="ri-page">
      <header className="ri-hero">
        <div>
          <span className="ri-eyebrow">Retrospective study</span>
          <h2>Case intake &amp; quality gate</h2>
          <p>Upload a folder or zip. Only Digital Mammogram (DR) cases with all four views and a report stating
            BI-RADS 3–6 are kept — everything else is rejected and removed automatically.</p>
        </div>
        <div className="ri-hero-rules">
          <span>4 views</span><span>DR only</span><span>PDF / JSON report</span><span>BI-RADS 3–6</span>
        </div>
      </header>

      <RetroPipeline role="admin" counts={tally?.by_status || {}} extra={{ received: tally?.total_cases || 0, rejected: tally?.rejected || 0 }}
        active={statusFilter} onSelect={(k) => { setStatusFilter(k); document.getElementById('ri-cases')?.scrollIntoView({ behavior: 'smooth' }); }} />

      <section className="ri-top">
        <div className="ri-stats">
          <Stat label="Cases received" value={tally?.total_cases ?? '–'} icon="inbox" />
          <Stat label="Checked" value={tally?.checked ?? '–'} icon="scan" />
          <Stat label="Passed" value={tally?.passed ?? '–'} tone="ok" icon="check" />
          <Stat label="Rejected" value={tally ? tally.rejected + (tally.rejected_by_radiologist || 0) : '–'} tone="bad" icon="x"
            sub={tally ? `${tally.rejected} failed checks · ${tally.rejected_by_radiologist || 0} by Radiologist` : ''} />
        </div>
        <div className="ri-card ri-chart">
          <Donut passed={tally?.passed || 0} rejected={tally?.rejected || 0} />
          <div className="ri-legend"><span><i className="g" />Passed</span><span><i className="r" />Rejected</span></div>
        </div>
        <div className="ri-card ri-dist">
          <Bars title="BI-RADS of passed cases" data={tally?.by_birads} palette={BIRADS_COLORS} />
          <Bars title="Breast density" data={tally?.by_density} />
        </div>
      </section>

      <section className="ri-card ri-upload">
        <div className="ri-form">
          <label className="ri-vendor">Vendor / supplying organisation
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={busy} placeholder="e.g. partner hospital name" />
          </label>
        </div>
        <div className={`ri-drop ${dragOver ? 'over' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)} onDrop={busy ? undefined : onDrop}>
          <div className="ri-drop-ico"><Icon d={ICONS.upload} /></div>
          {entries.length === 0 ? (
            <>
              <strong>Drop a .zip here</strong>
              <span className="ri-muted">or choose what to upload</span>
            </>
          ) : (
            <>
              <strong>{sourceName || 'Selected files'}</strong>
              <span className="ri-muted">{entries.length} file(s) · {fmtBytes(totalBytes)}</span>
            </>
          )}
          <div className="ri-drop-actions">
            <button className="ri-btn ghost" disabled={busy} onClick={() => folderRef.current.click()}>Choose folder</button>
            <button className="ri-btn ghost" disabled={busy} onClick={() => zipRef.current.click()}>Choose zip</button>
            <button className="ri-btn" onClick={start} disabled={busy || !entries.length}>{busy ? 'Working…' : 'Upload & check'}</button>
          </div>
          <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={pickFolder} />
          <input ref={zipRef} type="file" accept=".zip" hidden onChange={pickZip} />
        </div>

        {phase !== 'idle' && (
          <div className="ri-progress">
            <ol className="ri-steps">
              {STEPS.map((label, i) => (
                <li key={label} className={i < step ? 'done' : i === step ? 'now' : ''}><b>{i < step ? '✓' : i + 1}</b>{label}</li>
              ))}
            </ol>
            <div className="ri-pbar"><div><span>Uploading</span><span>{uploadPct}%</span></div>
              <div className="ri-track"><i style={{ width: `${uploadPct}%` }} /></div></div>
            <div className="ri-pbar"><div><span>Checking cases {batch?.phase ? `· ${batch.phase}` : ''}</span>
              <span>{batch?.checked_cases ?? 0} / {batch?.total_cases ?? 0}</span></div>
              <div className="ri-track"><i className="alt" style={{ width: `${phase === 'done' ? 100 : checkedPct}%` }} /></div></div>
            {batch && (
              <div className="ri-live">
                <span className="ok">{batch.passed} passed</span>
                <span className="bad">{batch.rejected} rejected</span>
                {phase === 'done' && <button className="ri-link" onClick={reset}>Upload another</button>}
              </div>
            )}
          </div>
        )}
        {error && <p className="ri-error">{error}</p>}
      </section>

      {rejections.length > 0 && (
        <section className="ri-card">
          <h3>Rejected in this upload <span className="ri-count bad">{rejections.length}</span></h3>
          <div className="ri-scroll">
            <table className="ri-table">
              <thead><tr><th>Case folder</th><th>Reason</th></tr></thead>
              <tbody>
                {rejections.map((r, i) => (
                  <tr key={i}><td><strong>{r.case}</strong></td>
                    <td>{(r.reasons || []).map((x, j) => <span key={j} className="ri-reason">{x}</span>)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <RetroCasesTable tally={tally} techs={techs} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        reloadKey={casesKey} onChanged={() => { refreshTally(); refreshTechs(); }} />
    </div>
  );
};

export default RetroIntake;
