import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import RetroPipeline from './RetroPipeline';
import SegmentationEditor from './SegmentationEditor';
import { API, auth, ReportPane, fmtDate } from './RetroCaseViewer';
import { usePoll } from './retroApi';
import './RetroCaseViewer.css';
import './RetroWorkbench.css';

const STATUS = {
  awaiting: ['Awaiting', 'st-wait'], in_progress: ['In progress', 'st-prog'], with_radiologist: ['With radiologist', 'st-rad'],
  radiologist_in_progress: ['Radiologist in progress', 'st-radprog'], segmented: ['Segmented', 'st-done'],
};

const call = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...auth(), ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
  return body;
};

// ---------------------------------------------------------------- workspace
const Workspace = ({ caseId, role, onClose, onChanged }) => {
  const isRad = role === 'radiologist';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('case');
  const [panel, setPanel] = useState(null);   // null | 'escalate' | 'finish' | 'complete'
  const draftKey = `retro_note_${caseId}`;               // the note being written survives a refresh until it is sent
  const [panelText, setPanelTextState] = useState(() => { try { return localStorage.getItem(draftKey) || ''; } catch { return ''; } });
  const setPanelText = (v) => { setPanelTextState(v); try { if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); } catch { /* storage unavailable */ } };
  const [busy, setBusy] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => { try { return localStorage.getItem('retro_side_open') !== '0'; } catch { return true; } });
  const toggleSide = (open) => { setSideOpen(open); try { localStorage.setItem('retro_side_open', open ? '1' : '0'); } catch { /* storage unavailable */ } };
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    try { setData(await call(`/cases/${caseId}`)); } catch (e) { setError(e.message); }
  }, [caseId]);

  useEffect(() => {
    (async () => {
      try {
        // opening a case starts the clock: Awaiting -> In progress / Waiting -> Radiologist in progress
        const first = await call(`/cases/${caseId}`);
        if (!isRad && first.status === 'awaiting') await call(`/cases/${caseId}/start`, { method: 'POST' });
        if (isRad && first.status === 'with_radiologist') await call(`/cases/${caseId}/radiologist/start`, { method: 'POST' });
        await load();
        onChanged && onChanged();
      } catch (e) { setError(e.message); }
    })();
  }, [caseId]); // eslint-disable-line

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !['TEXTAREA', 'INPUT'].includes(e.target.tagName) && !panel && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, panel]);

  const reports = useMemo(() => (data?.files || []).filter((f) => f.kind === 'report'), [data]);
  useEffect(() => { if (reports.length && !report) setReport(reports.find((r) => r.filename.toLowerCase().endsWith('.pdf')) || reports[0]); }, [reports, report]);

  const open = data && (isRad ? ['with_radiologist', 'radiologist_in_progress'] : ['awaiting', 'in_progress']).includes(data.status);
  const myViews = (data?.masks || []).filter((m) => m.role === role).map((m) => m.view);
  const a = data?.assignment;

  const run = async (fn, okMsg, close) => {
    setBusy(true);
    try {
      await fn();
      setPanelText('');                       // the note was sent, so the saved draft is cleared
      toast.success(okMsg);
      onChanged && onChanged();
      if (close) onClose(); else { await load(); setPanel(null); setPanelText(''); }
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const submitPanel = () => {
    if (panel === 'escalate') return run(() => call(`/cases/${caseId}/escalate`, { method: 'POST', body: JSON.stringify({ note: panelText }) }), 'Sent to a Radiologist', true);
    if (panel === 'finish') return run(() => call(`/cases/${caseId}/complete`, { method: 'POST', body: JSON.stringify({ note: panelText }) }), 'Segmentation finished', true);
    if (panel === 'reject') return run(() => call(`/cases/${caseId}/radiologist/reject`, { method: 'POST', body: JSON.stringify({ note: panelText }) }), 'Case rejected', true);
    return run(() => call(`/cases/${caseId}/radiologist/complete`, { method: 'POST', body: JSON.stringify({ note: panelText }) }), 'Review sent back to the Mammo Tech', true);
  };

  const panelCopy = {
    escalate: ['Not sure it is a lesion?', 'Describe what you are unsure about. Your free-hand marks go with it. The Radiologist replies with marks and a note, and the case returns to you.', 'Send to Radiologist', true],
    finish: ['Finish segmentation', 'This marks the case Segmented and tells the admin the annotation is done. Add a closing note if you like.', 'Finish', false],
    reject: ['Reject this case — no lesion', 'Confirm there is no lesion to segment. The case leaves both work lists and goes to the admin as Rejected by Radiologist. It does not return to the Mammo Tech. Give your reason.', 'Reject case', true],
    complete: ['Complete your review', 'Say where the lesion is and what the Mammo Tech should do. Your free-hand marks go with this note. The case returns to them to segment.', 'Return to Mammo Tech', true],
  }[panel] || [];

  return (
    <div className="rcv-overlay rw-overlay">
      <div className="rcv-modal rw-modal" role="dialog" aria-modal="true">
        <header className="rcv-top">
          <div>
            <h2>{data?.case_code || 'Loading…'}<span className="rcv-ro">{isRad ? 'Radiologist workspace' : 'Mammo Tech workspace'}</span></h2>
            {data && <p>{data.vendor || 'Vendor not set'} · {data.manufacturer || 'Manufacturer unknown'}</p>}
          </div>
          <div className="rcv-chips">
            {data?.birads && <span className={`chip birads b${data.birads[0]}`}>BI-RADS {data.birads}</span>}
            {data?.density && <span className="chip dens">Density {data.density}</span>}
            {data && <span className={`chip st st-${data.status}`}>{data.status_label}</span>}
            <button className="rcv-x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        {error && <div className="rcv-empty err">{error}</div>}
        {!data && !error && <div className="rcv-empty"><i className="rcv-spin dark" />Opening case…</div>}
        {data && (
          <div className={`rw-body ${sideOpen ? '' : 'closed'}`}>
            <div className="rw-editor">
              <SegmentationEditor caseId={caseId} caseCode={data.case_code} files={data.files} masks={data.masks} role={role} author={localStorage.getItem('userName') || ''}
                canEdit={!!open} marks={data.marks} onMarksChanged={load} onSaved={() => { load(); onChanged && onChanged(); }} onError={(m) => toast.error(m)} />
            </div>
            <aside className={`rw-side ${sideOpen ? '' : 'closed'}`}>
              <button className="rw-rail" title="Show the case panel" onClick={() => toggleSide(true)}>‹<span>Case · Report · Notes</span></button>
              <nav className="rcv-tabs">
                <button className="rw-collapse" title="Hide this panel to give the images more room" onClick={() => toggleSide(false)}>Hide ›</button>
                {[['case', 'Case'], ['report', 'Report'], ['notes', `Notes${panelText.trim() ? ' •' : ''}`]].map(([id, label]) => (
                  <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
                ))}
              </nav>
              <div className="rw-pane">
                {tab === 'case' && (
                  <>
                    {data.instruction && (
                      <div className="rw-callout warn"><b>{data.instruction.by} ({data.instruction.role === 'radiologist' ? 'Radiologist' : 'Mammo Tech'}):</b><br />{data.instruction.body}</div>
                    )}
                    {data.marks.some((m) => m.role !== role) && (
                      <div className="rw-callout">Marks drawn by the {isRad ? 'Mammo Tech' : 'Radiologist'} are shown on the images with their name. {isRad ? 'You can remove them and draw your own.' : 'Remove them once you have used them, then segment the lesion.'}</div>
                    )}
                    <p className="rw-hint">Views: drag from the left panel into a box. Use Free hand to circle, point or draw. {isRad ? 'Marks save automatically.' : 'Save each mask, then finish.'}</p>
                  </>
                )}
                {tab === 'notes' && (
                  <div className="rw-notes">
                    {data.instruction ? (
                      <div className="rw-callout warn"><b>{data.instruction.by} ({data.instruction.role === 'radiologist' ? 'Radiologist' : 'Mammo Tech'}) wrote:</b><br />{data.instruction.body}</div>
                    ) : <p className="rw-hint">Nothing from the {isRad ? 'Mammo Tech' : 'Radiologist'} yet.</p>}
                    <label className="rw-notelabel">{isRad ? 'Your note for the Mammo Tech' : 'Your note for the Radiologist'}</label>
                    <textarea rows={7} disabled={!open} value={panelText} onChange={(e) => setPanelText(e.target.value)}
                      placeholder={isRad ? 'Say where the lesion is and what to segment. Draw your marks on the images too.' : 'Say what you are unsure about. Circle or point at it with Free hand on the images.'} />
                    <p className="rw-hint">
                      {isRad ? 'Saved on this computer as you type. It is sent when you press Complete review or Reject.'
                        : 'Saved on this computer as you type. It is sent when you press Not sure — send to Radiologist.'}
                    </p>
                  </div>
                )}
                {tab === 'report' && (
                  <>
                    <div className="rcv-seg" style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                      {reports.map((r) => <button key={r.id} className={`rw-pill ${report?.id === r.id ? 'on' : ''}`} onClick={() => setReport(r)}>{r.filename.toLowerCase().endsWith('.pdf') ? 'PDF report' : 'JSON'}</button>)}
                    </div>
                    <div className="rw-report"><ReportPane file={report} /></div>
                  </>
                )}
              </div>

              <div className="rw-actions">
                {panel ? (
                  <div className="rw-panel">
                    <b>{panelCopy[0]}</b><p>{panelCopy[1]}</p>
                    <textarea autoFocus rows={4} value={panelText} onChange={(e) => setPanelText(e.target.value)}
                      placeholder={panelCopy[3] ? 'Required' : 'Optional'} />
                    <div>
                      <button className="rw-btn ghost" onClick={() => setPanel(null)}>Cancel</button>
                      <button className="rw-btn" disabled={busy || (panelCopy[3] && !panelText.trim())} onClick={submitPanel}>{busy ? 'Working…' : panelCopy[2]}</button>
                    </div>
                  </div>
                ) : !open ? (
                  <p className="rw-readonly">{data.status === 'segmented' ? 'This case is finished.' : isRad ? 'You have returned this case. It is read-only.' : 'With the radiologist. You can read it, and it returns to you when they finish.'}</p>
                ) : isRad ? (
                  <>
                    <button className="rw-btn warn" onClick={() => setPanel('reject')}>Reject — no lesion</button>
                    <button className="rw-btn big" onClick={() => setPanel('complete')}>Complete review and return to Mammo Tech</button>
                  </>
                ) : (
                  <>
                    <button className="rw-btn warn" onClick={() => setPanel('escalate')}>Not sure — send to Radiologist</button>
                    <button className="rw-btn big" disabled={!myViews.length} title={myViews.length ? '' : 'Save at least one mask first'} onClick={() => setPanel('finish')}>
                      Finish segmentation{myViews.length ? ` (${new Set(myViews).size} view${new Set(myViews).size > 1 ? 's' : ''})` : ''}
                    </button>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- list
const RetroWorkbench = ({ role }) => {
  const isRad = role === 'radiologist';
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState(null);

  const refresh = useCallback(async () => {
    try { setCases(await call(isRad ? '/radiologist-cases' : '/my-cases')); setError(''); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [isRad]);
  useEffect(() => { refresh(); }, [refresh]);
  usePoll(refresh, 20000);

  const counts = useMemo(() => {
    const c = { returned: 0 };
    cases.forEach((x) => { c[x.status] = (c[x.status] || 0) + 1; if (x.assignment?.radiologist_reviewed) c.returned += 1; });
    return c;
  }, [cases]);

  const shown = cases.filter((c) => !filter || (filter === 'returned' ? c.assignment?.radiologist_reviewed : c.status === filter));
  const pills = isRad ? ['with_radiologist', 'radiologist_in_progress', 'returned'] : ['awaiting', 'in_progress', 'with_radiologist', 'segmented'];

  return (
    <div className="rw-page">
      <div className="rw-hero">
        <h2>Retrospective segmentation</h2>
        <p>{isRad ? 'Cases a Mammo Tech sent you for review.' : 'Cases assigned to you for lesion segmentation.'}</p>
      </div>
      <RetroPipeline role={role} counts={counts} active={filter} onSelect={setFilter} />
      <div className="rw-card">
        <div className="rw-row">
          <h3>{isRad ? 'Cases for review' : 'My cases'} <span className="rw-count">{shown.length}</span></h3>
          <div className="rw-filters">
            <button className={`rw-pill ${!filter ? 'on' : ''}`} onClick={() => setFilter('')}>All {cases.length}</button>
            {pills.map((k) => (
              <button key={k} className={`rw-pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? '' : k)}>
                {k === 'returned' ? 'Returned' : STATUS[k][0]} {counts[k] || 0}
              </button>
            ))}
          </div>
        </div>
        {loading && <p className="rw-muted">Loading…</p>}
        {error && <p className="rw-error">{error}</p>}
        {!loading && !error && shown.length === 0 && (
          <div className="rw-empty">{cases.length === 0 ? (isRad ? 'Nothing has been sent to you yet. Cases appear here when a Mammo Tech is unsure about a lesion.' : 'No cases assigned to you yet. The admin assigns ranges of cases.') : 'No cases in this step.'}</div>
        )}
        {shown.length > 0 && (
          <div className="rw-scroll">
            <table className="rw-table">
              <thead><tr><th>Case</th><th>BI-RADS</th><th>Density</th><th>Vendor</th><th>{isRad ? 'From' : 'Radiologist'}</th><th>Status</th><th>Masks saved</th><th>{isRad ? 'Question' : 'Assigned'}</th><th /></tr></thead>
              <tbody>
                {shown.map((c) => {
                  const mine = isRad ? c.radiologist_views : c.annotation.views;
                  return (
                    <tr key={c.id} onDoubleClick={() => setOpenId(c.id)}>
                      <td><strong className="rw-code">{c.case_code}</strong></td>
                      <td>{c.birads ? <span className={`rw-tag b${c.birads[0]}`}>{c.birads}</span> : '–'}</td>
                      <td>{c.density || '–'}</td>
                      <td>{c.vendor || '–'}</td>
                      <td>{isRad ? c.assignment?.mammo_tech_name : (c.assignment?.radiologist_name || '–')}</td>
                      <td><span className={`rw-status ${STATUS[c.status]?.[1]}`}>{c.status_label}</span>{c.assignment?.radiologist_reviewed && !isRad && c.status === 'in_progress' && <em className="rw-rev">reviewed</em>}</td>
                      <td>{mine.length ? mine.join(', ') : <span className="rw-muted">none</span>}</td>
                      <td className="rw-q">{isRad ? c.assignment?.escalation_note : fmtDate(c.assignment?.assigned_at)}</td>
                      <td><button className="rw-open" onClick={() => setOpenId(c.id)}>{c.status === 'segmented' || (isRad && c.status === 'in_progress') ? 'View' : 'Open'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openId && <Workspace caseId={openId} role={role} onClose={() => { setOpenId(null); refresh(); }} onChanged={refresh} />}
    </div>
  );
};

export default RetroWorkbench;
