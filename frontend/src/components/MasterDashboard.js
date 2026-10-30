import React, { useEffect, useState } from 'react';
import './RetroIntake.css';
import './Prospective.css';
import { usePoll } from './retroApi';
import { pget, fmtWhen } from './prospApi';

const Tile = ({ label, value, sub, tone }) => (
  <div className={`ri-stat ${tone || ''}`}><div><strong>{value ?? '–'}</strong><span>{label}</span>{sub && <em>{sub}</em>}</div></div>
);
const Bars = ({ title, data, color }) => {
  const entries = Object.entries(data || {});
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div style={{ marginBottom: 14 }}>
      {title && <h4 style={{ margin: '0 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>{title}</h4>}
      {entries.length === 0 && <p className="ri-muted">No data yet</p>}
      {entries.map(([k, v]) => (
        <div className="pr-bar2" key={k}><span title={k}>{k}</span><div><i style={{ width: `${(v / max) * 100}%`, ...(color ? { background: color } : {}) }} /></div><b>{v}</b></div>
      ))}
    </div>
  );
};
const Columns = ({ data }) => {
  const entries = Object.entries(data || {}); const max = Math.max(1, ...entries.map(([, v]) => v));
  return <div className="pr-colchart">{entries.map(([k, v]) => <div key={k}><b>{v}</b><i style={{ height: `${(v / max) * 100}%` }} /><span>{k.slice(2)}</span></div>)}</div>;
};
const Donut = ({ a, b, labelA, labelB, colorA = '#14a394', colorB = '#6a5bd6' }) => {
  const total = a + b || 1; const r = 42; const c = 2 * Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg viewBox="0 0 110 110" width="120"><circle cx="55" cy="55" r={r} fill="none" stroke={colorB} strokeWidth="14" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={colorA} strokeWidth="14" strokeDasharray={`${(a / total) * c} ${c}`} transform="rotate(-90 55 55)" />
        <text x="55" y="60" textAnchor="middle" style={{ fontSize: 20, fontWeight: 800 }}>{a + b}</text></svg>
      <div className="ri-legend" style={{ flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <span><i style={{ background: colorA }} />{labelA}: <b>{a}</b></span><span><i style={{ background: colorB }} />{labelB}: <b>{b}</b></span>
      </div>
    </div>
  );
};

const RETRO_STATUS = [['unassigned', 'Unassigned'], ['awaiting', 'Awaiting'], ['in_progress', 'In progress'], ['with_radiologist', 'With radiologist'], ['radiologist_in_progress', 'Radiologist reviewing'], ['segmented', 'Segmented'], ['rejected', 'Rejected by Radiologist']];

const MasterDashboard = () => {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = () => pget('/dashboard').then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  usePoll(load, 60000);
  const p = d?.prospective; const r = d?.retrospective;
  const rejectedTotal = r ? r.rejected + (r.rejected_by_radiologist || 0) : null;
  const statusMap = Object.fromEntries(RETRO_STATUS.map(([k, l]) => [l, r?.by_status?.[k] || 0]));
  const passRate = r && r.checked ? Math.round((r.passed / r.checked) * 100) : null;

  return (
    <div className="ri-page">
      <header className="ri-hero">
        <div>
          <span className="ri-eyebrow">Database management</span>
          <h2>Dashboard</h2>
          <p>Prospective and Retrospective studies in one place. Prospective numbers come from the master CSV; Retrospective numbers are live.</p>
        </div>
        <div className="pr-chips">{p?.built_at && <span>Prospective built {fmtWhen(p.built_at)}</span>}{p?.version && <span>{p.version}</span>}</div>
      </header>
      {error && <p className="ri-error">{error}</p>}

      <div className="pr-sectionhead"><h3>Prospective study</h3><span /></div>
      {p && !p.configured && <div className="pr-note"><b>The prospective data source is not set up yet.</b> Set <code>PROSPECTIVE_MASTER_URI</code> and <code>PROSPECTIVE_FILES_URI</code> to the master CSV paths in GCS.</div>}
      {p?.error && <div className="pr-note"><b>The master CSV could not be read.</b> {p.error}</div>}
      {p?.configured && !p.error && (
        <>
          <div className="pr-stats">
            <Tile label="Sessions" value={p.sessions} sub={`${p.portal} portal · ${p.pilot} pilot`} />
            <Tile label="Hospitals" value={p.hospitals} />
            <Tile label="Complete datapoints" value={p.complete} tone="ok" sub={`${p.four_views} with all 4 views`} />
            <Tile label="With assessment" value={p.assessed} sub={`${p.high_risk} high-risk outcome`} />
          </div>
          <div className="pr-dash">
            <section className="ri-card"><h3>Enrolment by month</h3><Columns data={p.by_month} /></section>
            <section className="ri-card"><h3>CR vs DR</h3><Donut a={p.dr} b={p.cr} labelA="DR" labelB="CR" colorA="#3b82f6" colorB="#f2b84b" />
              <div style={{ marginTop: 16 }}><Bars title="Sessions by state" data={p.by_state} /></div></section>
            <section className="ri-card"><h3>Data completeness</h3>
              <Bars data={Object.fromEntries(p.funnel.map((x) => [x.label, x.value]))} /></section>
            <section className="ri-card"><h3>Findings</h3>
              <Bars title="Highest BI-RADS (assessed)" data={p.by_birads} /><Bars title="Highest density (assessed)" data={p.by_density} color="linear-gradient(90deg,#6a5bd6,#a58bff)" /></section>
            <section className="ri-card" style={{ gridColumn: '1 / -1' }}><h3>Sessions by hospital</h3>
              <Bars data={Object.fromEntries(p.by_hospital.map((h) => [`${h.name} (${h.technology})`, h.sessions]))} /></section>
          </div>
          {p.test_rows_excluded > 0 && <p className="ri-muted" style={{ margin: '8px 0 0' }}>{p.test_rows_excluded} test rows are excluded from these numbers.</p>}
        </>
      )}

      <div className="pr-sectionhead" style={{ marginTop: 26 }}><h3>Retrospective study</h3><span /></div>
      {r && (
        <>
          <div className="pr-stats">
            <Tile label="Cases received" value={r.total_cases} sub={`${r.passed} passed · ${passRate ?? '–'}% pass rate`} />
            <Tile label="Segmented" value={r.by_status?.segmented} tone="ok" sub="final mask ready to download" />
            <Tile label="In the work flow" value={(r.by_status?.awaiting || 0) + (r.by_status?.in_progress || 0) + (r.by_status?.with_radiologist || 0) + (r.by_status?.radiologist_in_progress || 0)} sub={`${r.by_status?.unassigned || 0} still unassigned`} />
            <Tile label="Rejected" value={rejectedTotal} tone="bad" sub={`${r.rejected} failed checks · ${r.rejected_by_radiologist || 0} by Radiologist`} />
          </div>
          <div className="pr-dash">
            <section className="ri-card"><h3>Where the cases are</h3><Bars data={statusMap} /></section>
            <section className="ri-card"><h3>Findings of stored cases</h3>
              <Bars title="BI-RADS" data={r.by_birads} /><Bars title="Density" data={r.by_density} color="linear-gradient(90deg,#6a5bd6,#a58bff)" /></section>
            <section className="ri-card"><h3>Supplying organisation</h3><Bars data={r.by_vendor} /></section>
            <section className="ri-card"><h3>Intake checks</h3><Donut a={r.passed} b={r.rejected} labelA="Passed" labelB="Failed checks" colorA="#14a394" colorB="#f3a9b6" /></section>
          </div>
        </>
      )}
    </div>
  );
};

export default MasterDashboard;
