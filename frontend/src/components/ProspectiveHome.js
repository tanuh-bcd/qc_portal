import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './RetroIntake.css';
import './Prospective.css';
import { pget, pdownload, qs, fmtWhen } from './prospApi';

const PAGE = 50;
const SOURCES = [['', 'All'], ['portal', 'Portal'], ['pilot', 'Pilot']];
const TECHS = [['', 'All'], ['CR', 'CR'], ['DR', 'DR']];
const Yes = ({ v }) => (v === '1' || v === 1 ? <span className="pr-pill ok">Yes</span> : <span className="pr-pill no">No</span>);
const short = (id) => `${id.slice(0, 8)}…`;
const techLabel = (t) => (t === 'Unknown' ? 'Not set' : t);
const machineSummary = (m) => {                    // m = {names, makes, technologies, total, unique}
  if (!m || (!m.total && !m.names?.length)) return 'No machine recorded';
  const shown = (m.names || []).slice(0, 2).join(', ') + ((m.names || []).length > 2 ? ` +${m.names.length - 2}` : '');
  return `${m.total} machine${m.total > 1 ? 's' : ''}${m.unique ? ` (${m.unique} unique)` : ''}${shown ? `: ${shown}` : ''}`;
};
const machineDetail = (m) => [['Machines', m?.names], ['Makes', m?.makes], ['Technology as recorded', m?.technologies]]
  .filter(([, v]) => v && v.length).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n');

const KV = ({ k, v }) => (v === undefined || v === '' ? null : <div className="pr-kv"><span>{k}</span><b>{v}</b></div>);

const SessionDetail = ({ id, onClose }) => {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { pget(`/sessions/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  const s = d?.session || {};
  let missing = [];
  try { missing = JSON.parse(s.missing_components || '[]'); } catch { missing = []; }
  return (
    <div className="pr-modal-bg" onClick={onClose}>
      <div className="pr-modal ri-page" style={{ padding: 0, minHeight: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="pr-modal-top">
          <div>
            <h3>{s.hospital_name || 'Session'} <span className={`pr-tech ${d?.technology}`}>{techLabel(d?.technology)}</span></h3>
            <p className="pr-id">{id}</p>
          </div>
          <button className="pr-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="pr-modal-body">
          {err && <p className="ri-error">{err}</p>}
          {!d && !err && <p className="ri-muted">Loading…</p>}
          {d && (
            <>
              <section className="pr-sec"><h4>Overview</h4><div className="pr-grid">
                <KV k="Source" v={s.data_source} /><KV k="Hospital" v={`${s.hospital_name} (${s.hospital_id})`} /><KV k="State" v={s.hospital_state} />
                <KV k="Subject ID" v={s.subject_id} /><KV k="Session started" v={fmtWhen(s.session_start_at)} /><KV k="Questionnaire" v={s.questionnaire_type} />
                <KV k="CR / DR (hospital)" v={techLabel(d.technology)} /><KV k="Machines at this hospital" v={machineSummary(d.machines)} /><KV k="Machine names" v={(d.machines?.names || []).join(', ')} /><KV k="Makes" v={(d.machines?.makes || []).join(', ')} />
                <KV k="Sessions for this subject" v={s.n_sessions_for_subject} />
              </div></section>
              <section className="pr-sec"><h4>Questionnaire and risk</h4><div className="pr-grid">
                <KV k="Age" v={s.age} /><KV k="BMI" v={s.bmi} /><KV k="Tobacco" v={s.tobacco_use} /><KV k="Alcohol" v={s.alcohol_use} />
                <KV k="Snehitha risk" v={s.snehita_risk_category} /><KV k="Pilot risk" v={s.pilot_risk_class} /><KV k="Pilot model" v={s.pilot_model_version} />
              </div>
                {d.answers.length > 0 && (
                  <div className="ri-scroll" style={{ marginTop: 12 }}><table className="ri-table"><thead><tr><th>Question</th><th>Answer</th></tr></thead>
                    <tbody>{d.answers.map((a, i) => <tr key={i}><td>{a.question}</td><td>{a.answer}</td></tr>)}</tbody></table></div>
                )}
              </section>
              <section className="pr-sec"><h4>Clinician assessment</h4>
                {s.has_assessment !== '1' ? <p className="ri-muted">No assessment yet.</p> : (
                  <div className="pr-grid">
                    <KV k="BI-RADS right / left" v={`${s.birads_right} / ${s.birads_left}`} /><KV k="Density right / left" v={`${s.density_right} / ${s.density_left}`} />
                    <KV k="Highest BI-RADS" v={s.birads_max} /><KV k="Highest density" v={s.density_max} />
                    <KV k="High-risk outcome" v={s.outcome_high_risk === '1' ? 'Yes' : 'No'} />
                  </div>
                )}
              </section>
              <section className="pr-sec"><h4>Completeness</h4>
                <div className="pr-grid">
                  <div className="pr-kv"><span>Complete datapoint</span><Yes v={s.is_complete_datapoint} /></div>
                  <div className="pr-kv"><span>All 4 views</span><Yes v={s.has_all_4_views} /></div>
                  <div className="pr-kv"><span>Consent</span>{s.consent_not_captured_by_design === '1' ? <span className="pr-pill">Not captured by design (pilot)</span> : <Yes v={s.has_consent} />}</div>
                  <div className="pr-kv"><span>Mammogram report</span><Yes v={s.has_mammo_report} /></div>
                </div>
                {missing.length > 0 && <p className="ri-muted" style={{ marginTop: 10 }}>Missing: {missing.join(', ')}</p>}
              </section>
              <section className="pr-sec"><h4>Files ({d.files.length})</h4>
                {d.files.length === 0 ? <p className="ri-muted">No files for this session.</p> : (
                  <div className="ri-scroll"><table className="ri-table"><thead><tr><th>Type</th><th>View</th><th>Uploaded</th><th>GCS path</th></tr></thead>
                    <tbody>{d.files.map((f, i) => (
                      <tr key={i}><td>{f.file_type}</td><td>{f.view ? `${f.view} ${f.laterality}` : '–'}</td><td>{fmtWhen(f.uploaded_at)}</td><td className="pr-id" style={{ wordBreak: 'break-all' }}>{f.gcs_path}</td></tr>
                    ))}</tbody></table></div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const EMPTY = { q: '', source: '', tech: '', hospital_id: '', birads: '', density: '', complete: false, latest_only: false, include_test: false };

const ProspectiveHome = () => {
  const [status, setStatus] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, stats: {} });
  const [f, setF] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const set = (patch) => { setF((p) => ({ ...p, ...patch })); setPage(1); };

  useEffect(() => { pget('/status').then(setStatus).catch((e) => setError(e.message)); }, []);
  const ready = status?.configured && status?.ok;
  useEffect(() => { if (ready) pget(`/hospitals?${qs({ include_test: f.include_test })}`).then(setHospitals).catch(() => {}); }, [ready, f.include_test]);
  const query = useMemo(() => qs({ ...f, page, page_size: PAGE }), [f, page]);
  const load = useCallback(() => { if (ready) pget(`/sessions?${query}`).then(setData).catch((e) => setError(e.message)); }, [ready, query]);
  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const act = async (kind, name) => { try { await pdownload(`/export?${qs({ ...f, kind })}`, name); } catch (e) { setError(e.message); } };
  const st = data.stats || {};

  return (
    <div className="ri-page">
      <header className="ri-hero">
        <div>
          <span className="ri-eyebrow">Prospective study</span>
          <h2>Hospitals &amp; sessions</h2>
          <p>Data collection and pilot sessions from partner hospitals. Filter and count here; open GCS only to fetch a file.</p>
        </div>
        {ready && <div className="pr-chips"><span>Built {fmtWhen(status.built_at)}</span><span>{status.version}</span><span>{status.rows} sessions</span><span>{status.files} files</span></div>}
      </header>

      {error && <p className="ri-error">{error}</p>}
      {status && !status.configured && (
        <div className="pr-note"><b>The prospective data source is not set up yet.</b><br />
          Point the portal at the master CSVs by setting <code>PROSPECTIVE_MASTER_URI</code> and <code>PROSPECTIVE_FILES_URI</code> to their GCS paths
          (for example <code>gs://breast-cancer-image-dataset/…/prospective_master.csv</code>), then reload.</div>
      )}
      {status?.configured && !status.ok && <div className="pr-note"><b>The master CSV could not be read.</b><br />{status.error}</div>}

      {ready && (
        <>
          <div className="pr-stats">
            <div className="ri-stat"><div><strong>{st.sessions ?? '–'}</strong><span>Sessions (filtered)</span><em>{st.portal || 0} portal · {st.pilot || 0} pilot</em></div></div>
            <div className="ri-stat ok"><div><strong>{st.complete ?? '–'}</strong><span>Complete datapoints</span><em>{st.four_views || 0} with all 4 views</em></div></div>
            <div className="ri-stat"><div><strong>{st.assessed ?? '–'}</strong><span>With clinician assessment</span><em>{st.high_risk || 0} high-risk outcome</em></div></div>
            <div className="ri-stat"><div><strong>{st.cr || 0} / {st.dr || 0}</strong><span>CR / DR sessions</span><em>by hospital machine</em></div></div>
          </div>

          <section className="ri-card">
            <h3>Hospitals <span className="ri-count">{hospitals.length}</span></h3>
            <div className="pr-hospitals">
              {hospitals.map((h) => (
                <button key={h.hospital_id} className={`pr-hosp ${f.hospital_id === h.hospital_ids.join(',') ? 'on' : ''}`} onClick={() => set({ hospital_id: f.hospital_id === h.hospital_ids.join(',') ? '' : h.hospital_ids.join(',') })}>
                  <h4>{h.short_name || h.hospital_id}<span className={`pr-tech ${h.technology}`}>{techLabel(h.technology)}</span></h4>
                  <small>{h.name} · {h.state}</small>
                  <small title={machineDetail(h.machines)}>{machineSummary(h.machines)}</small>
                  {h.sites.filter((s) => s.is_pilot_site).map((s) => (
                    <small key={s.hospital_id} className="pr-site" title={s.name}>Pilot site · <span className={`pr-tech ${s.technology}`}>{techLabel(s.technology)}</span> · {s.sessions} session{s.sessions === 1 ? '' : 's'}</small>
                  ))}
                  <div className="pr-hosp-n"><div><b>{h.sessions}</b>sessions</div><div><b>{h.complete}</b>complete</div><div><b>{h.pilot}</b>pilot</div></div>
                </button>
              ))}
            </div>
          </section>

          <section className="ri-card">
            <h3>Sessions <span className="ri-count">{data.total}</span></h3>
            <div className="pr-filters">
              <input className="ri-search" placeholder="Search session, subject or hospital" value={f.q} onChange={(e) => set({ q: e.target.value })} style={{ minWidth: 260 }} />
              <div className="pr-seg" title="Study">{SOURCES.map(([v, l]) => <button key={v} className={f.source === v ? 'on' : ''} onClick={() => set({ source: v })}>{l}</button>)}</div>
              <div className="pr-seg" title="Mammography technology">{TECHS.map(([v, l]) => <button key={v} className={f.tech === v ? 'on' : ''} onClick={() => set({ tech: v })}>{l}</button>)}</div>
              <select value={f.birads} onChange={(e) => set({ birads: e.target.value })}><option value="">Any BI-RADS</option>{[0, 1, 2, 3, 4, 5, 6].map((b) => <option key={b} value={b}>BI-RADS {b}</option>)}</select>
              <select value={f.density} onChange={(e) => set({ density: e.target.value })}><option value="">Any density</option>{['A', 'B', 'C', 'D'].map((d) => <option key={d} value={d}>Density {d}</option>)}</select>
              <label><input type="checkbox" checked={f.complete} onChange={(e) => set({ complete: e.target.checked })} />Complete only</label>
              <label><input type="checkbox" checked={f.latest_only} onChange={(e) => set({ latest_only: e.target.checked })} />Latest per woman</label>
              <label><input type="checkbox" checked={f.include_test} onChange={(e) => set({ include_test: e.target.checked })} />Include test data</label>
              <button className="ri-btn ghost" onClick={() => { setF(EMPTY); setPage(1); }}>Clear</button>
              <span style={{ flex: 1 }} />
              <button className="ri-btn ghost" onClick={() => act('paths', 'download_list.txt')} title="gs:// paths of the four latest mammogram views of the filtered sessions">⬇ File list</button>
              <button className="ri-btn ghost" onClick={() => act('csv', 'prospective_filtered.csv')}>⬇ CSV</button>
            </div>

            <div className="ri-scroll">
              <table className="ri-table pr-table">
                <thead><tr><th>Session</th><th>Hospital</th><th>Subject</th><th>Study</th><th>Tech</th><th>Started</th><th>Age</th><th>BI-RADS R / L</th><th>Density R / L</th><th>Views</th><th>Complete</th><th /></tr></thead>
                <tbody>
                  {data.items.length === 0 && <tr><td colSpan="12" className="ri-empty">No sessions match.</td></tr>}
                  {data.items.map((r) => (
                    <tr key={r.session_id} className="pr-rowbtn" onClick={() => setOpen(r.session_id)}>
                      <td className="pr-id">{short(r.session_id)}</td>
                      <td>{r.hospital_short_name || r.hospital_id}</td><td>{r.subject_id || '–'}</td>
                      <td><span className={`pr-pill ${r.data_source}`}>{r.data_source}</span></td>
                      <td><span className={`pr-tech ${r.technology}`}>{techLabel(r.technology)}</span></td>
                      <td>{fmtWhen(r.session_start_at)}</td><td>{r.age || '–'}</td>
                      <td>{r.has_assessment === '1' ? `${r.birads_right} / ${r.birads_left}` : '–'}</td>
                      <td>{r.has_assessment === '1' ? `${r.density_right} / ${r.density_left}` : '–'}</td>
                      <td>{r.n_views_present}/4</td><td><Yes v={r.is_complete_datapoint} /></td>
                      <td><button className="ri-view" onClick={(e) => { e.stopPropagation(); setOpen(r.session_id); }}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ri-pager">
              <span>{data.total ? `Showing ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, data.total)} of ${data.total}` : 'No sessions'}</span>
              <button className="ri-pill" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
              <span>Page {page} of {pages}</span>
              <button className="ri-pill" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
            </div>
          </section>
        </>
      )}
      {open && <SessionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default ProspectiveHome;
